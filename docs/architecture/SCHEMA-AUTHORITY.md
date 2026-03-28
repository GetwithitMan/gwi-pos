# Schema Authority Model

> One authority per environment. Migrations are the sole mutation mechanism.
> All other layers validate but do not mutate schema independently.

## Principles

1. **Schema changes are authored as numbered migrations** in `scripts/migrations/NNN-*.js`
2. **Migrations are applied by exactly one controlled path** per environment
3. **No environment mutates another environment's schema independently**
4. **`_gwi_migrations` is the canonical tracking table** — same migration set everywhere

## Environment Authority

### Master Neon (cloud canonical)

- **Authority:** Vercel build pipeline (`scripts/vercel-build.js`)
- **Mutation path:** `nuc-pre-migrate.js` (migrations) → `prisma db push` (declarative sync)
- **When:** On every Vercel deployment (git push to main)
- **Gate:** Explicit user deploy command → git push → Vercel build hook
- **Schema source of truth:** `prisma/schema.prisma` + `scripts/migrations/*.js`

### Venue Neon Databases

- **Authority:** Mission Control (MC) via internal API + controlled deploy paths
- **Mutation paths:**
  - `/api/internal/provision` — creates new venue DB, applies full `schema.sql`
  - `/api/internal/sync-schema` — incremental DDL diff-sync after release deploy
  - `deploy-release.sh` — runs numbered migrations on venue Neon after local PG succeeds (MC fleet command)
  - `installer/06-schema.sh` — runs numbered migrations on venue Neon after local PG succeeds (initial install)
- **When:** MC API calls during provisioning or post-deploy; NUC controlled deploys (fleet command / installer)
- **Gate:** `PROVISION_API_KEY` (MC API); MC fleet command (deploy-release.sh); installer (06-schema.sh)
- **Rule:** Only controlled deploy paths (MC API, fleet-commanded deploy, installer) may mutate venue Neon.
  NUC runtime code NEVER mutates venue Neon schema. Neon migration failure is non-fatal — local PG is the runtime DB.

### NUC Local PostgreSQL

- **Authority:** Deploy pipeline (`deploy-release.sh`, called by MC fleet command)
- **Mutation paths:**
  - `deploy-release.sh` → `deploy-tools/apply-schema.js` (empty DB bootstrap)
  - `deploy-release.sh` → `deploy-tools/migrate.js` (numbered migrations)
  - `pre-start.sh` → `deploy-tools/migrate.js` (safety net for incomplete deploys)
- **When:** During fleet-commanded deploy, or on boot if deploy was interrupted
- **Gate:** MC fleet command → sync-agent → deploy-release.sh
- **Rule:** Local PG is the only database the NUC may mutate schema on.

## Prohibited Paths

| Path | Status | Reason |
|------|--------|--------|
| NUC → Neon `prisma db push` | **REMOVED** (C2/C3) | NUC must not declaratively push schema to any Neon DB |
| NUC → Neon migrations (runtime) | **REMOVED** | NUC runtime code must not mutate Neon schema |
| NUC → Neon migrations (controlled deploy) | **ALLOWED** | deploy-release.sh + installer 06-schema.sh run numbered migrations (non-fatal on failure) |
| NUC → local `prisma db push` | **REMOVED** (C2/C3) | deploy-tools is sole local schema engine |
| sync-agent.js → `prisma migrate deploy` | **REMOVED** | Legacy path; deploy-tools handles migrations |
| sync-agent.js → `prisma db push` | **REMOVED** | Legacy path; deploy-tools handles schema |
| `--accept-data-loss` on any target | **REMOVED** (C7) | Destructive changes must be explicit migrations |

## Migration Lifecycle

```
Developer writes migration
  → scripts/migrations/NNN-description.js (exports async function up(prisma))
  → Commit + push to main
  → Vercel build applies to master Neon
  → MC fleet command triggers NUC deploy
  → deploy-release.sh applies to NUC local PG
  → deploy-release.sh applies to venue Neon (numbered migrations, non-fatal)
  → MC sync-schema applies to venue Neon (DDL diff-sync, post-deploy)
```

## Validation (Read-Only)

These paths CHECK schema state but never mutate it:

- **NUC pre-start.sh** validates Neon migration count matches local (warns on mismatch)
- **`_venue_schema_state`** table is MC-owned — NUC reads, never writes
- **`/api/health/ready`** checks DB connectivity + critical tables
- **Watchdog** checks service health, not schema state

## Transaction Safety

- Each migration runs in its own `BEGIN/COMMIT` transaction (C4 fix)
- Migration tracking (`_gwi_migrations` INSERT) is inside the same transaction
- On failure: `ROLLBACK` — DB unchanged, migration can be retried
- Advisory lock (ID 20250101) prevents concurrent migration runners
- Lock is released before process exit on timeout (C5 fix)

## Schema Version Tracking

| Table | Owner | Purpose |
|-------|-------|---------|
| `_gwi_migrations` | Shared (all environments) | Tracks which numbered migrations have been applied |
| `_venue_schema_state` | MC only | MC's record of venue schema version; NUC reads only |
| `_local_install_state` | NUC only | Informational; installer version + schema version at install time |
| `version-contract.json` | Build artifact | Stamped at build time; declares expected schema version |
