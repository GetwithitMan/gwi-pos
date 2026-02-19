# Skill 378: Deploy Failure Alerts & Version Mismatch Detection

**Date:** February 19, 2026
**Domain:** Infrastructure / Release Management
**Status:** DONE

## Dependencies

- Skill 334: Release Management
- Skill 308: Sync Agent

## Overview

Proactive alerting on the Mission Control location detail page (Infrastructure tab) for deploy failures and version mismatches. A red alert banner appears when the latest deploy has a FAILED status, and an amber warning appears when the server's running version differs from the latest release version. Also includes a critical fix to the FORCE_UPDATE handler that previously caused NUCs to build with out-of-sync Prisma schemas.

## Key Files

### Mission Control (gwi-mission-control)

| File | Purpose |
|------|---------|
| `src/app/dashboard/locations/[id]/page.tsx` | Location detail page — Infrastructure tab section with deploy failure and version mismatch alerts. Added `latestRelease` query. |

### Sync Agent (gwi-mission-control)

| File | Purpose |
|------|---------|
| `command-handlers.ts` (FORCE_UPDATE handler) | Fixed schema sync: changed from `prisma migrate` to `prisma generate` + `prisma db push --skip-generate --accept-data-loss`. Now aborts on schema sync failure. |

## Implementation Details

### Deploy Failure Alert (Red Banner)

- Queries the most recent deploy record for the location
- If `deploy.status === 'FAILED'`, renders a red alert banner at the top of the Infrastructure tab
- Banner shows:
  - Error message from the deploy record
  - Timestamp of when the failure occurred
  - Link to deploy details/logs

### Version Mismatch Warning (Amber Banner)

- Added `latestRelease` query to the location detail page — fetches the most recent release from the releases table
- Compares `serverNode.currentVersion` against `latestRelease.version`
- If they differ, renders an amber warning banner indicating the server is running an outdated version
- Shows both the current version and the expected version

### FORCE_UPDATE Handler Fix

**Previous behavior (buggy):**
- Handler ran `prisma migrate` to sync the schema
- If schema sync failed, the handler continued with the build anyway
- NUCs would compile and start with an out-of-sync Prisma schema, causing runtime errors (missing columns, wrong types, etc.)

**New behavior (fixed):**
- Changed schema sync from `prisma migrate` to:
  1. `prisma generate` — regenerates the Prisma client from the schema file
  2. `prisma db push --skip-generate --accept-data-loss` — pushes schema changes directly to the database
- If schema sync fails, the handler now **aborts immediately** and returns `{ success: false }` with the error message
- This prevents NUCs from running with broken schemas after a failed deploy

### Why `db push` Instead of `migrate`

- `prisma migrate` requires a migrations directory and can fail if migrations are out of order or missing
- `prisma db push` is idempotent — it compares the schema file to the database and applies the diff
- `--skip-generate` avoids redundant generation (already done in the previous step)
- `--accept-data-loss` is necessary because schema changes may drop columns (acceptable during force updates)

## Testing / Verification

1. Deploy failure alert — trigger a failed deploy, verify red banner appears on Infrastructure tab with error message and timestamp
2. Version mismatch — deploy a new release to one location but not another, verify amber warning on the outdated location
3. No alerts — verify no banners appear when deploy is successful and version matches latest release
4. FORCE_UPDATE schema sync — trigger a force update with schema changes, verify `prisma generate` + `prisma db push` both succeed
5. FORCE_UPDATE schema failure — simulate a schema sync error, verify handler aborts and returns `success: false`
6. Previous bug regression — confirm NUCs no longer continue building after schema sync failure

## Related Skills

- **Skill 334**: Release Management — release creation and deployment pipeline
- **Skill 308**: Sync Agent — executes FORCE_UPDATE commands on NUCs
