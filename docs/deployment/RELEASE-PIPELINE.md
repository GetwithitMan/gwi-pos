# Release Pipeline -- End-to-End

> Canonical reference for how code moves from commit to Vercel to MC to NUC.
> All other docs defer to this one for pipeline mechanics.

---

## Overview

```
Developer pushes to main
  |
Vercel auto-deploys (runs vercel-build.js -- see vercel.json buildCommand)
  |
  +-- 1. prisma generate
  +-- 2. generate-schema-sql.mjs  (pre-pass for migrations)
  +-- 3. nuc-pre-migrate.js       (runs migrations on master Neon)
  +-- 4. prisma db push            (push full schema to master Neon)
  +-- 5. generate-schema-sql.mjs  (REGENERATE -- post-push = final truth)
  |      -> prisma/schema.sql -> public/schema.sql
  +-- 6. generate-version-contract.mjs
  |      -> src/generated/version-contract.json -> public/version-contract.json
  +-- 7. generate-artifacts.mjs
  |      -> public/artifacts/manifest.json + versioned files
  +-- 8. deploy-tools/build.sh
  |      -> public/artifacts/deploy-tools-<releaseId>.tar.gz
  +-- 9. build-installer-bundle.sh
  |      -> public/installer.run (stamps version/sha, embeds modules)
  +-- 10. next build
  +-- 11. build-server.mjs        (server.ts -> server.js via esbuild)
  +-- 12. build-nuc-artifact.sh
          -> public/artifacts/pos-release-<releaseId>.tar.zst
          -> public/artifacts/manifest.json (artifact-metadata.json)
          -> smoke tests (require chain + boot test)
          -> minisign signature (mandatory on CI)
  |
Vercel deploy webhook -> POST /api/webhooks/vercel-deploy (MC)
  |
MC checkAndRolloutSchema()
  +-- Fetches version-contract.json from POS Vercel
  +-- Compares against previous contract hash
  +-- If changed -> schema rollout to all venue Neon DBs
  +-- Canary verification -> fanout
  |
MC admin creates Release (POST /api/admin/releases)
  +-- version, channel (STABLE/BETA), imageTag, releaseNotes
  +-- minSchemaVersion, rollbackVersion
  +-- Creates git tag via GitHub API
  |
MC admin deploys Release to locations
  +-- Pre-deploy schema sync to venue Neon DB
  +-- Creates FleetCommand (FORCE_UPDATE) per server
  +-- Sets ServerNode.targetVersion
  |
NUC update-agent receives FleetCommand
  +-- Downloads artifact from MC proxy (HMAC-authed)
  +-- Extracts pos-release-<releaseId>.tar.zst
  +-- Runs deploy-tools: migrate.js + apply-schema.js
  +-- Restarts services
  +-- ACKs back to MC with deploy result
```

---

## Build Orchestration: vercel-build.js vs package.json build

There are **two build entry points**. They are NOT the same.

### Vercel Production (CI/CD)

`vercel.json` sets `"buildCommand": "node scripts/vercel-build.js"`. This is the canonical production build. It runs:

1. `prisma generate`
2. `generate-schema-sql.mjs` (pre-pass)
3. `nuc-pre-migrate.js` against master Neon (with `NEON_MIGRATE=true`)
4. `prisma db push` on master Neon (no `--accept-data-loss`)
5. `generate-schema-sql.mjs` (post-push regeneration -- final truth)
6. Copy `prisma/schema.sql` to `public/schema.sql`
7. `generate-version-contract.mjs`
8. Copy `version-contract.json` to `public/version-contract.json`
9. `generate-artifacts.mjs`
10. `deploy-tools/build.sh`
11. `build-installer-bundle.sh`
12. `next build`
13. `build-server.mjs` (esbuild: server.ts -> server.js CJS)
14. `build-nuc-artifact.sh` (package + smoke test + sign)

If DATABASE_URL / DIRECT_URL is absent (e.g., preview deploys), steps 3-8 are skipped gracefully.

### Local / NUC build (`npm run build`)

The `package.json` `build` script runs a simpler chain:

```
bash scripts/bump-version.sh
&& rm -rf node_modules/.prisma && prisma generate
&& node scripts/generate-schema-sql.mjs
&& cp prisma/schema.sql public/schema.sql
&& node scripts/generate-version-contract.mjs
&& cp src/generated/version-contract.json public/version-contract.json
&& node scripts/generate-artifacts.mjs
&& bash scripts/build-installer-bundle.sh
&& next build
&& node scripts/build-server.mjs
```

Key differences from vercel-build.js:
- Runs `bump-version.sh` (Vercel does not)
- Does NOT run migrations or `prisma db push` against Neon
- Does NOT build deploy-tools artifact
- Does NOT build NUC release artifact or sign it

---

## Version Bumping Rules

### Source: `scripts/bump-version.sh`

The version in `package.json` is the source of truth for MC, NUC, and all artifact naming.

### Auto-bump (1.1.X format)

If the current version matches `^1\.1\.`:
- Counts total commits: `git rev-list --count HEAD`
- Sets version to `1.1.<commit-count>` (e.g., `1.1.847`)
- This happens automatically during `npm run build`

### MC-managed versions (anything else)

If the version does NOT match `^1\.1\.` (e.g., `1.2.62`), bump-version.sh **preserves it** and exits:

```
[bump-version] Version 1.2.62 was set by deploy pipeline -- preserving
```

**This means: for 1.2.X, 2.0.X, or any non-1.1.X version, YOU must bump manually in package.json before committing.**

The current version is `1.2.62`.

### Skip conditions

If `package.json` is not writable (NUC deploys where the file is root-owned), the script skips silently.

---

## CI Version Gates

Two CI scripts enforce version discipline. Both live in `scripts/ci/`.

### 1. `enforce-version-bump.sh`

**Purpose:** If protected paths changed, package.json version MUST differ from main.

**Protected paths:**
- `public/installer.run`
- `public/installer-modules/`
- `public/scripts/deploy-release.sh`
- `scripts/build-nuc-artifact.sh`
- `scripts/vercel-build.js`
- `deploy-tools/`
- `public/install.sh`
- `public/setup-remote.sh`
- `public/uninstall.sh`
- `public/usb-remote-setup.sh`

**Logic:**
1. `git diff --name-only origin/main...HEAD` to find changed files
2. Check if any match protected paths
3. If yes, compare `package.json` version between base and HEAD
4. If version unchanged -> FAIL
5. Also rejects version downgrades (semver comparison)

### 2. `check-version-stamps.sh`

**Purpose:** Installer version stamps must match `package.json`.

**Checks:**
1. **Version match:** `INSTALLER_VERSION` in `public/installer.run` must equal `package.json` version. Placeholder `__INSTALLER_VERSION__` skips this check.
2. **SHA drift:** If `INSTALLER_GIT_SHA` differs from HEAD and protected installer paths changed since that SHA, it fails. Placeholder `__INSTALLER_GIT_SHA__` skips this check.

### The Installer SHA Chicken-and-Egg

The installer embeds the git SHA at build time (`build-installer-bundle.sh`). But committing changes the SHA. Solution:

- In your commit, use placeholder SHA: `__INSTALLER_GIT_SHA__`
- CI skips SHA check for placeholders
- `build-installer-bundle.sh` stamps real values during the Vercel build (step 11)
- Never let a committed `installer.run` contain a real SHA that doesn't match HEAD

To reset installer stamps before committing:
```bash
perl -pi -e 's/^INSTALLER_VERSION="[^"]*"/INSTALLER_VERSION="__INSTALLER_VERSION__"/' public/installer.run
perl -pi -e 's/^INSTALLER_GIT_SHA="[^"]*"/INSTALLER_GIT_SHA="__INSTALLER_GIT_SHA__"/' public/installer.run
```

Then `build-installer-bundle.sh` will stamp the correct values at build time.

---

## Version Contract

**Source:** `scripts/generate-version-contract.mjs`
**Output:** `src/generated/version-contract.json` (copied to `public/version-contract.json`)

MC reads this file after every Vercel deploy to decide if a schema rollout is needed.

### Contents

| Field | Source | Purpose |
|-------|--------|---------|
| `version` | `package.json` | App version (e.g., `1.2.62`) |
| `schemaVersion` | Highest `NNN-` prefix in `scripts/migrations/` | Migration version (e.g., `097`) |
| `gitSha` | `git rev-parse --short HEAD` | Build commit |
| `buildDate` | ISO timestamp | When built |
| `schemaSha256` | `prisma/schema-hash.txt` | SHA-256 of generated schema SQL |
| `components` | Hardcoded structure | All deployable artifact versions (pos, dashboard, installer, syncAgent, monitoring, ansibleBaseline) |
| `dashboardVersion` | `public/gwi-nuc-dashboard.deb` or `public/dashboard-version.txt` | Dashboard .deb version |
| `ansibleBaselineVersion` | `installer/version.txt` | Ansible baseline version |
| `schemaContractHash` | SHA-256 of introspected schema (tables, columns, indexes, enums, FKs) | Drift detection |
| `riskClassification` | Diff against previous contract | `low`, `medium`, `high`, `critical` |
| `compatibilityClass` | Based on risk | `forward_compatible`, `requires_code_first`, `requires_schema_first`, `manual_migration_required` |
| `migrationHints` | Detailed diff | Added/dropped tables, columns, type changes, etc. |
| `contractSignature` | HMAC-SHA256 with `SCHEMA_CONTRACT_SECRET` | Optional integrity verification |

### Schema Introspection (Phase 1A)

If `DIRECT_URL` or `DATABASE_URL` is available at build time, the script:
1. Connects to the DB using `pg`
2. Queries `information_schema` for tables, columns, indexes, enums, foreign keys
3. Normalizes types (e.g., `int4` -> `INTEGER`, `timestamptz` -> `TIMESTAMPTZ`)
4. Builds a canonical, deterministically sorted schema object
5. Computes `schemaContractHash` via SHA-256
6. Diffs against previous contract to classify risk

This enables MC to detect schema drift without comparing SQL text.

---

## Artifact System

### Versioned Artifacts (`scripts/generate-artifacts.mjs`)

**Output:** `public/artifacts/`

Version key format: `{appVersion}-{schemaVersion}` (e.g., `1.2.62-097`)

Files produced:
- `schema-{version}.sql` -- immutable copy of generated schema SQL
- `version-contract-{version}.json` -- immutable copy of version contract
- `manifest.json` -- current version pointer with SHA-256 hashes

### NUC Release Artifact (`scripts/build-nuc-artifact.sh`)

**Output:** `public/artifacts/pos-release-{releaseId}.tar.zst`

The release artifact is a self-contained, pre-built package containing everything a NUC needs to run the app. No `npm ci` or `npm run build` on the NUC.

Release ID format: `{version}-{gitSha}` (e.g., `1.2.62-abc1234`)

**Contents:**
- `.next/standalone/` (Next.js runtime with traced node_modules)
- `.next/static/` (browser assets)
- `server.js` + `preload.js` (custom server)
- `launcher.sh` (process launcher)
- `prisma/schema.prisma` + `prisma/schema.sql`
- `public/` (static assets, installer, sync-agent, watchdog)
- `src/generated/prisma/` (generated Prisma client)
- `package.json` (version detection)
- `version-contract.json` (deploy compat gates)
- `required-env.json` (env key validation)
- `artifact-metadata.json` (version, SHA, node version, compat info)
- `checksums.txt` (SHA-256 of every file)

**Does NOT contain:**
- Prisma CLI, tsx, or migration scripts (those are in deploy-tools)
- `.git`, docs, tests, configs, IDE files

**Validation (fail-closed, all mandatory on CI):**
1. All required build outputs exist
2. Every `require()` in `server.js` resolves in staged `node_modules`
3. Smoke test: actually `require()` critical packages (Prisma, pg, Socket.IO, Next)
4. Smoke-BOOT test: start the server, verify it binds a port within 30s
5. minisign signature (mandatory when `VERCEL` or `CI` env vars are set)

### Deploy-Tools Artifact (`deploy-tools/build.sh`)

**Output:** `public/artifacts/deploy-tools-{releaseId}.tar.gz`

Lightweight (~192KB) artifact containing:
- `src/migrate.js` -- migration runner using raw `pg` (no Prisma)
- `src/apply-schema.js` -- schema push via raw SQL
- `src/pg-compat.js` -- pg compatibility helpers
- `migration-helpers.js` -- shared helpers
- All migration files from `scripts/migrations/`
- `prisma/schema.sql`
- `pg` as sole runtime dependency

This replaced the previous approach of bundling Prisma CLI + tsx in the app artifact (50-150MB -> 192KB).

---

## Installer Bundle (`scripts/build-installer-bundle.sh`)

**Input:** `public/installer.run` (orchestrator) + `public/installer-modules/*.sh` (11 stage modules)
**Output:** `public/installer.run` (self-contained, with embedded modules)

Build process:
1. Read version from `package.json`, SHA from git, build date
2. Restore version/SHA placeholders in `installer.run` (idempotent for re-runs)
3. Stamp actual `INSTALLER_VERSION`, `INSTALLER_BUILD_DATE`, `INSTALLER_GIT_SHA`
4. Strip any existing payload (from previous builds)
5. Append `exit 0` + `__MODULES_PAYLOAD__` marker
6. Base64-encode a tar.gz of `public/installer-modules/` and append

The result is a single self-extracting file served from Vercel. MC proxies it to NUCs -- there is no separate copy in the MC repo.

---

## Schema Rollout (Automatic via MC)

Triggered by: Vercel deploy webhook or MC cron.

1. MC fetches `version-contract.json` from POS Vercel URL
2. Compares `schemaContractHash` against stored value
3. If changed: acquires advisory lock, initiates rollout
4. State machine: `contract_detected` -> `policy_evaluated` -> `canary_pending` -> `canary_running` -> `canary_verified` -> `fanout_running` -> `rollout_completed`
5. Pushes schema to all venue Neon DBs
6. Records result in `_venue_schema_state`

**Authority model:** NUC NEVER mutates Neon schema in production. MC is the sole schema authority. NUCs observe and report only.

---

## Release Management (Manual via MC)

Releases are separate from schema rollouts:
- Created manually via MC admin UI or API (`POST /api/admin/releases`)
- Specify: version, channel (STABLE/BETA), imageTag, release notes, min schema version
- Deploy to specific locations or all locations
- NUC pulls via FleetCommand (`FORCE_UPDATE`)

### Fleet Command Payload (FORCE_UPDATE)

```json
{
  "version": "1.2.62",
  "imageTag": "sha-abc1234",
  "artifactManifestUrl": "https://ordercontrolcenter.com/api/fleet/artifact-manifest",
  "useArtifactDeploy": true,
  "postDeployAction": "RELOAD_TERMINALS"
}
```

### NUC Update Flow

1. Sync-agent polls `/api/fleet/commands/stream` (or receives push via cloud relay)
2. Receives `FORCE_UPDATE` command
3. Downloads artifact from MC proxy (MC adds HMAC auth, proxies to POS Vercel)
4. Verifies minisign signature (fail-closed)
5. Extracts `pos-release-<releaseId>.tar.zst`
6. Runs deploy-tools: `migrate.js` (pending migrations) + `apply-schema.js` (prisma db push equivalent)
7. Restarts POS services
8. ACKs back to MC with deploy path and result

---

## Schema SQL Generation (`scripts/generate-schema-sql.mjs`)

Runs `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` to produce clean SQL.

- Strips non-SQL lines (dotenv logs, Prisma warnings)
- Writes to `prisma/schema.sql`
- Computes SHA-256 hash, writes to `prisma/schema-hash.txt` (consumed by version contract)
- Copied to `public/schema.sql` for static serving

In `vercel-build.js`, this runs TWICE:
1. Pre-pass (before migrations + db push) -- needed by migration scripts
2. Post-pass (after db push) -- this is the final truth, reflects any schema changes Prisma applied

---

## Developer Checklist (Every Deploy)

### 1. Check current version
```bash
cat package.json | grep '"version"'
# or from remote:
git show origin/main:package.json | grep '"version"'
```

### 2. Bump version
Since the repo is at `1.2.X`, auto-bump does NOT apply. You must manually edit `package.json`:
```
"version": "1.2.63"   // was 1.2.62
```

### 3. If installer.run changed
Stamp the version and use placeholder SHA:
```bash
# Set version to match package.json
perl -pi -e 's/^INSTALLER_VERSION="[^"]*"/INSTALLER_VERSION="1.2.63"/' public/installer.run
# Always use placeholder SHA in commits
perl -pi -e 's/^INSTALLER_GIT_SHA="[^"]*"/INSTALLER_GIT_SHA="__INSTALLER_GIT_SHA__"/' public/installer.run
```
`build-installer-bundle.sh` will stamp the real SHA during the Vercel build.

### 4. Commit and push
```bash
git add -A && git commit -m "..."
# Wait for user approval, then:
git push origin main
```

### 5. Verify on Vercel
```bash
curl -sL https://app-domain.vercel.app/version-contract.json | jq '.version, .schemaVersion, .gitSha'
```

### 6. MC auto-triggers
MC will auto-trigger schema rollout if `schemaContractHash` changed.

### 7. Create Release in MC
If deploying to NUCs, create a Release in MC admin and deploy to target locations.

---

## Troubleshooting

### MC didn't pick up the new version
- Check `version-contract.json` on live Vercel -- does it show the new version?
- If not: Vercel may still be building. Wait 2-3 minutes.
- If yes but MC didn't rollout: check MC webhook logs at `/api/webhooks/vercel-deploy`

### CI keeps failing on version stamps
- Use placeholder SHA:
  ```bash
  perl -pi -e 's/^INSTALLER_GIT_SHA="[^"]*"/INSTALLER_GIT_SHA="__INSTALLER_GIT_SHA__"/' public/installer.run
  ```
- Make sure `package.json` version > main's version
- Check `enforce-version-bump.sh` output to see which protected paths changed

### NUC didn't update
- Check if a Release was created in MC
- Check if FleetCommand was sent (MC admin -> server detail -> commands)
- Check sync-agent logs on NUC: `journalctl -u gwi-sync-agent -f`
- Verify artifact exists: `curl -sL https://app-domain.vercel.app/artifacts/manifest.json | jq .`

### Build fails on artifact smoke test
- `build-nuc-artifact.sh` validates that every `require()` in `server.js` resolves
- It also boots the staged server and checks that it binds a port within 30s
- If a new dependency was added to `server.ts`, add it to `_SERVER_PKGS` in `build-nuc-artifact.sh`
- If a new Prisma runtime dep was added, add it to `_PRISMA_RUNTIME_PKGS`

### Artifact signing fails
- `MINISIGN_SECRET_KEY` must be set in Vercel environment variables
- On CI, signing is mandatory (fail-closed)
- Local builds skip signing with a warning

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `vercel.json` | Vercel config: `buildCommand: "node scripts/vercel-build.js"` |
| `scripts/vercel-build.js` | Production build orchestrator (Vercel) |
| `package.json` (`build` script) | Local/NUC build chain |
| `scripts/bump-version.sh` | Auto-bump for 1.1.X; preserves MC-managed versions |
| `scripts/generate-schema-sql.mjs` | Prisma schema -> SQL + SHA-256 hash |
| `scripts/generate-version-contract.mjs` | Version contract with schema introspection |
| `scripts/generate-artifacts.mjs` | Immutable versioned artifacts |
| `scripts/build-installer-bundle.sh` | Self-contained installer.run with embedded modules |
| `scripts/build-nuc-artifact.sh` | NUC release artifact (.tar.zst) + smoke tests + signing |
| `scripts/build-server.mjs` | server.ts -> server.js (esbuild CJS) |
| `deploy-tools/build.sh` | Lightweight migration runner artifact |
| `scripts/ci/enforce-version-bump.sh` | CI gate: protected paths require version bump |
| `scripts/ci/check-version-stamps.sh` | CI gate: installer stamps match package.json |
| `scripts/nuc-pre-migrate.js` | Migration runner (shared: NUC local PG + Vercel master Neon) |
| `scripts/migrations/NNN-*.js` | Individual migration files |

---

*Last updated: 2026-03-31*
