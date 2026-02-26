# Skill 449: NUC Sync Hardening — Timezone, PgBouncer, OnlineOrderWorker

**Date:** 2026-02-26
**Commits:** `626beaa`, `78dbc7c`
**Status:** DONE

## Overview

Three critical NUC sync bugs discovered during Fruita Grill live deployment. All three caused silent data corruption or noisy log spam that masked real issues. Fixed in two commits with belt-and-suspenders approach.

## Bug 1: Timestamp Timezone Conversion (CRITICAL)

### Root Cause

NUC PostgreSQL `timezone` was set to `America/Denver` (UTC-7). The downstream sync worker's `buildCast()` function used `::timestamptz` for **all** timestamp columns, including `timestamp without time zone` columns.

When inserting a `timestamptz` value into a `timestamp without time zone` column, PostgreSQL converts from UTC to the session timezone before storing. This silently shifted ALL synced timestamps by -7 hours.

### Impact

- **Terminal pairing codes** generated in the cloud expired 7 hours early on the NUC
- **All cloud-authoritative timestamps** (updatedAt, createdAt, expiresAt) were wrong on the NUC
- Any time-based logic (expiration checks, scheduling, business day boundaries) was broken

### Fix (Belt + Suspenders)

1. **Code fix** (`78dbc7c`): `buildCast()` now distinguishes between column types:
   - `timestamp with time zone` → `::timestamptz` (correct, PG stores as UTC)
   - `timestamp without time zone` → `::timestamp` (no conversion, stored as-is)
2. **Infrastructure fix**: `ALTER DATABASE pulse_pos SET timezone = 'UTC'` on the NUC
3. **Installer fix**: All future NUCs get UTC timezone at provisioning time

### Affected Files
- `src/lib/sync/downstream-sync-worker.ts` — `buildCast()` function
- `src/lib/online-order-worker.ts` — duplicate `buildCast()` function

### Detection Pattern

If timestamps from Neon arrive wrong on a NUC:
```sql
-- Check NUC PG timezone
SHOW timezone;  -- Should be 'UTC'

-- If not UTC, fix it:
ALTER DATABASE pulse_pos SET timezone = 'UTC';
-- Then restart the POS service
```

## Bug 2: PgBouncer Cached Plan Errors (HIGH)

### Root Cause

Both `downstream-sync-worker.ts` and `online-order-worker.ts` used `SELECT *` queries against Neon (via PgBouncer connection pooler). When table schemas change on Neon (e.g., adding a column), PgBouncer's prepared statement cache holds the old column list, causing:

```
error: cached plan must not change result type (code 0A000)
```

### Fix (`626beaa`)

Replaced all `SELECT *` with explicit column lists:
- **Downstream sync**: Uses `columnCache` (already populated by `loadColumnMetadata()`) to build `SELECT col1, col2, ...`
- **Online order worker**: Added `getColumnNames()` helper that queries `information_schema.columns` and caches results per table

### Key Insight

This error persists even after service restarts because PgBouncer (on Neon's side) caches the prepared statements, not the NUC. The only fix is to avoid `SELECT *` entirely.

## Bug 3: OnlineOrderWorker 401 Spam (MEDIUM)

### Root Cause

`startOnlineOrderDispatchWorker()` didn't check for `PROVISION_API_KEY` before starting. Without this env var, the worker sent an empty `x-api-key` header to `/api/internal/dispatch-online-order` every 15 seconds, generating 401 errors in the logs.

### Fix (`626beaa`)

Added early return guard:
```typescript
if (!process.env.PROVISION_API_KEY) {
  console.log('[OnlineOrderWorker] PROVISION_API_KEY not set — worker disabled')
  return
}
```

## Architecture Context

```
Neon (cloud, UTC)
  │
  │  SELECT explicit_cols FROM "Table" WHERE updatedAt > hwm
  │  (PgBouncer connection pooler)
  │
  ▼
downstream-sync-worker.ts
  │
  │  INSERT ... VALUES ($1::timestamp, $2::timestamptz, ...)
  │  (cast matches actual column type, no timezone conversion)
  │
  ▼
NUC Local PostgreSQL (timezone=UTC)
  │
  │  Prisma reads timestamps as UTC (correct)
  │
  ▼
POS API routes (pair-native, etc.)
  │
  │  pairingCodeExpiresAt < new Date()  ← correct comparison
  │
  ▼
Android app pairs successfully ✅
```

## Testing Verification

1. Generated pairing code from cloud admin (fruita-grill.ordercontrolcenter.com)
2. Code synced to NUC via downstream sync (~15s)
3. Android app entered code on NUC (172.16.1.254:3005)
4. Pairing succeeded — code expiration validated correctly

## Installer Update

Added to `public/installer.run` after database creation:
```bash
# Set UTC timezone for database (CRITICAL for offline-first sync integrity)
sudo -u "$POSUSER" PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" \
  -c "ALTER DATABASE $DB_NAME SET timezone = 'UTC';"
```

## Lessons Learned

1. **Never use `SELECT *` with PgBouncer** — always explicit column lists
2. **PostgreSQL timezone matters for `timestamp without time zone`** — always set to UTC on NUCs
3. **Guard worker startup** — check required env vars before starting background polling
4. **Belt + suspenders for infrastructure** — fix the code AND the config, never rely on just one
