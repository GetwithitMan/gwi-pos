# Skill 407 — NUC Remote Git Credential Repair

**Domain:** Infrastructure / Fleet Management
**Date:** 2026-02-21
**Addresses:** NUC stations failing FORCE_UPDATE with "git pull failed" due to missing or invalid `/opt/gwi-pos/.git-credentials`; no remote repair path existed because old sync agents silently ACK unknown commands

---

## Overview

NUC stations that lost or never had a valid `.git-credentials` file would fail every `FORCE_UPDATE` fleet command silently — git could not authenticate to GitHub, so `git pull` threw and the deploy aborted. Because old sync agents would ACK any unknown command and do nothing, there was no way to push a fix remotely.

This skill adds three complementary repair paths: a native fleet command for new sync agents (`REPAIR_GIT_CREDENTIALS`), a shell-injection bootstrap path for old agents that only speak `SCHEDULE_REBOOT`, and a full re-deploy pipeline for stations that are in a broken build state beyond just credentials.

---

## Problem Statement

A NUC running an old sync agent (`< v1.0.28`) with a missing `.git-credentials` file is in a permanently broken deploy loop:

1. Mission Control sends `FORCE_UPDATE`.
2. Sync agent runs `git pull`.
3. Git returns auth failure — no credentials on disk.
4. Sync agent reports failure; next deploy attempt repeats from step 2.
5. There is no `REPAIR_GIT_CREDENTIALS` command in the old agent, so sending it produces `"Unknown command: REPAIR_GIT_CREDENTIALS, ACK OK"` and nothing happens.

SSH access was the only prior fix. This skill closes that gap entirely.

---

## Architecture

### Three repair modes

```
Mission Control UI ("Repair Git" button)
    │
    ├─ Normal mode ──────► REPAIR_GIT_CREDENTIALS fleet command
    │                       (requires sync agent v1.0.28+)
    │                       Writes .git-credentials, runs git fetch to verify
    │
    ├─ Bootstrap mode ───► SCHEDULE_REBOOT fleet command
    │                       (works on old sync agents — they support SCHEDULE_REBOOT)
    │                       Payload embeds a shell injection that:
    │                         1. Cancels any pending reboot (shutdown -c)
    │                         2. Clears git lock files
    │                         3. Writes .git-credentials
    │                         4. Downloads new sync-agent.js from GitHub via curl
    │                         5. Restarts pulse-sync
    │                       Also sends CANCEL_REBOOT as a safety net
    │
    └─ Full Deploy mode ──► SCHEDULE_REBOOT fleet command (same injection vector)
                            Runs complete deploy pipeline in background:
                              git fetch + git reset --hard
                              npm install
                              prisma generate + migrate
                              npm run build
                              restart pulse-pos
                              update sync-agent.js
                            Takes 5-10 minutes. Sends CANCEL_REBOOT as safety net.
```

### Command flow (normal mode)

```
MC API POST /api/admin/servers/[id]/repair-credentials
    │
    ▼ Creates FleetCommand { type: REPAIR_GIT_CREDENTIALS, payload: { deployToken } }
    │   expiresAt: now() + 1 hour
    │
    ▼ NUC sync agent picks up command via SSE stream
    │
    ▼ Writes deployToken to /opt/gwi-pos/.git-credentials (mode 0o600)
    │
    ▼ Runs: git fetch origin
    │
    ▼ Returns { ok: true } or { ok: false, error: 'git-fetch-failed-after-update' }
```

---

## What Was Built

### 1. Fleet command: `REPAIR_GIT_CREDENTIALS` (gwi-pos)

Added to the command dispatch switch in `public/sync-agent.js`.

**Payload:**
```json
{ "deployToken": "<github-pat>" }
```

**Behavior:**
- Writes the token to `/opt/gwi-pos/.git-credentials` with file mode `0o600`
- Runs `git fetch origin` as a verification step
- Returns `{ ok: true }` on success
- Returns `{ ok: false, error: 'git-fetch-failed-after-update' }` if `git fetch` fails after writing

**Requirement:** Sync agent v1.0.28 or newer. Old agents will ACK and do nothing.

---

### 2. Mission Control API: `POST /api/admin/servers/[id]/repair-credentials` (gwi-mission-control)

**Auth:** Requires `super_admin` role. Regular admins do not see this endpoint.

**Request body:**
```json
{
  "deployToken": "<github-pat>",
  "bootstrap": false,
  "fullDeploy": false
}
```

**Modes:**

| Mode | `bootstrap` | `fullDeploy` | Behavior |
|------|------------|-------------|---------|
| Normal | `false` | `false` | Sends `REPAIR_GIT_CREDENTIALS` fleet command. Requires new sync agent. |
| Bootstrap | `true` | `false` | Embeds shell injection in `SCHEDULE_REBOOT` payload. Works on old sync agents. Also sends `CANCEL_REBOOT` as safety net. |
| Full Deploy | `false` or `true` | `true` | Runs entire deploy pipeline (git, npm, prisma, build, restarts) in background. 5-10 min. Sends `CANCEL_REBOOT` as safety net. |

**Command expiry:** 1 hour for all modes.

**Responses:**

```json
// Success
{ "ok": true, "mode": "normal" }
{ "ok": true, "mode": "bootstrap" }
{ "ok": true, "mode": "full-deploy" }

// Failure (git fetch failed after credential write)
{ "ok": false, "error": "git-fetch-failed-after-update" }
```

---

### 3. Mission Control UI: "Repair Git" button (gwi-mission-control)

Located in the server list row inside `ServerActions.tsx`.

**Visibility:** Only rendered when `isSuperAdmin === true`. Not visible to regular admins or venue admins.

**Appearance:** Yellow button, per server row.

**Flow:**
1. Click "Repair Git" → modal opens
2. Modal contains a GitHub PAT input (password field, value never logged)
3. Two action buttons:
   - **"Repair Git"** — calls bootstrap mode (`bootstrap: true`)
   - **"Full Deploy"** — calls full deploy mode (`fullDeploy: true`)
4. Success message shown after each mode completes, explaining what happened and what to expect

**Success messages:**

- Bootstrap: "Credentials written and sync agent updated. The NUC will reconnect in ~30 seconds. Run FORCE_UPDATE to deploy the latest app version."
- Full Deploy: "Full deploy queued. This takes 5-10 minutes. The NUC will restart pulse-pos when complete."

---

## Usage Guide

### When to use each mode

| Situation | Recommended mode |
|-----------|-----------------|
| NUC has new sync agent (v1.0.28+), just needs credentials fixed | Normal |
| NUC has old sync agent AND missing credentials | Bootstrap |
| NUC is stuck in merge conflict or broken build state | Full Deploy |
| NUC passed credential repair but still fails FORCE_UPDATE | Full Deploy |
| NUC has never had credentials written (fresh install edge case) | Bootstrap, then FORCE_UPDATE |

### Decision flow

```
Is the NUC's sync agent v1.0.28+?
    YES → Use Normal mode
    NO  →
        Is the problem just credentials?
            YES → Use Bootstrap mode (fixes credentials + upgrades sync agent)
            NO  → Use Full Deploy (handles git conflicts, broken builds, credentials)
```

### After bootstrap mode

Bootstrap mode upgrades the sync agent to the current version as part of its shell injection. After the NUC reconnects (~30 seconds), you can send a standard `FORCE_UPDATE` to deploy the latest app.

### After full deploy mode

Full deploy runs the complete pipeline. No further action needed unless the deploy itself fails (watch heartbeat logs in MC for errors).

---

## Key Notes / Gotchas

**Old sync agents ACK unknown commands silently.** Sending `REPAIR_GIT_CREDENTIALS` to an old agent produces `"Unknown command: REPAIR_GIT_CREDENTIALS, ACK OK"` in the logs and does nothing. Always check the sync agent version before using Normal mode.

**Bootstrap injection only works if the old agent supports `SCHEDULE_REBOOT`.** Agents that predate `SCHEDULE_REBOOT` support cannot receive the injection at all. In that case, SSH access is still required to manually upgrade the agent.

**The `.git-credentials` file must be mode `0o600`.** If it is world-readable, git may refuse to use it. The `REPAIR_GIT_CREDENTIALS` handler explicitly sets this mode.

**Common NUC failure causes beyond missing credentials:**
- Git merge conflict state — fix with `git reset --hard HEAD` (Full Deploy does this automatically via `git reset --hard origin/main`)
- Missing `INTERNAL_API_SECRET` env var — causes `npm run build` to throw at the module level during Next.js static page collection, even for dynamic API routes. The build error will look like a random import failure, not an env var error.
- Module-level code throws during Next.js build — Next.js collects static pages at build time and imports every route module, so any module-level code (outside of request handlers) that throws will abort the build.

**CANCEL_REBOOT is sent as a safety net in bootstrap and full deploy modes.** The shell injection in `SCHEDULE_REBOOT` immediately cancels the reboot via `shutdown -c`, so the machine never actually reboots. `CANCEL_REBOOT` is also sent as a belt-and-suspenders measure.

**Full Deploy takes 5-10 minutes.** The pipeline runs in the background. The API returns immediately after queuing the command. Monitor heartbeat logs in MC to confirm the deploy completed.

**GitHub PAT is write-once.** The token is written to `/opt/gwi-pos/.git-credentials` (mode 0o600) and never stored in the database or logged.

---

## Files Changed

| File | Repo | Change |
|------|------|--------|
| `public/sync-agent.js` | gwi-pos | Added `REPAIR_GIT_CREDENTIALS` command handler |
| `prisma/schema.prisma` | gwi-mission-control | Added `REPAIR_GIT_CREDENTIALS` to `CommandType` enum |
| `src/app/api/admin/servers/[id]/repair-credentials/route.ts` | gwi-mission-control | New API route — three repair modes, super_admin only |
| `src/components/admin/ServerActions.tsx` | gwi-mission-control | Added "Repair Git" yellow button, modal, PAT input, isSuperAdmin prop |
| `src/app/dashboard/locations/[id]/page.tsx` | gwi-mission-control | Passes `isSuperAdmin` prop down to `ServerActions` |

---

## Related Skills

- **Skill 375** — NUC Cloud Event Pipeline (SSE command stream transport layer)
- **Skill 376** — Device Fleet Management (server inventory that repair targets)
- **Skill 377** — Remote Device Actions (pattern for fleet command + MC API + UI button)
- **Skill 399** — Self-Updating Sync Agent (how sync agent versioning and self-copy works)
- **Skill 401** — Auto-Reboot After Batch (SCHEDULE_REBOOT / CANCEL_REBOOT command handlers)
