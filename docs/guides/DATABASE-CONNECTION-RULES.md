# Database Connection Rules

> **Authority model:** MC/Neon is the sole schema authority. NUC owns local runtime only. See [`docs/architecture/AUTHORITY-MODEL.md`](../architecture/AUTHORITY-MODEL.md) for full rules. All infrastructure tables (SyncWatermark, SocketEventLog, etc.) MUST be in `prisma/schema.prisma` to prevent `prisma db push` from dropping them.

**DO NOT CHANGE THESE RULES. They were found through painful trial and error.**

## The Rule: PrismaPg Everywhere

PrismaPg (`@prisma/adapter-pg`) is used for ALL environments:
- **Vercel:** `max: 1`, `connectionTimeoutMillis: 60000` (handles Neon cold starts)
- **NUC:** `max: 25` total across all pools, `connectionTimeoutMillis: 10000` (local PostgreSQL)

PrismaNeon was attempted 4 times and fails with "No database host" on Vercel
because the DATABASE_URL uses Neon's pooler endpoint which NeonPool's WebSocket
can't connect to. Do not try PrismaNeon again without changing DATABASE_URL
to a direct (non-pooler) endpoint.

## Connection Pool Budget (NUC)

All pool sizes are defined in `src/lib/db-connection-budget.ts` (single source of truth).
Total budget: **25 connections** out of local PG default `max_connections=100` (25%).

| Pool | Constant | Size | Purpose |
|------|----------|------|---------|
| Master (app routes) | `LOCAL_APP_POOL` | 15 | API handlers, route queries |
| Admin | `LOCAL_ADMIN_POOL` | 3 | Cross-tenant ops, MC sync, cron |
| Neon sync | `LOCAL_NEON_SYNC` | 5 | Upstream + downstream sync workers |
| Reserved | `LOCAL_RESERVED` | 2 | Health checks, emergency headroom |
| **Total** | `LOCAL_TOTAL` | **25** | |

Vercel uses `VERCEL_PER_FUNCTION = 1` per serverless function invocation.
Venue client LRU cache max: `VENUE_CACHE_MAX = 50`.

The `/api/health` endpoint reports live pool utilization via `pg_stat_activity`.

## Critical: Tenant Scope Deadlock (THE BIG ONE)

`resolveTenantLocationId()` in `db-tenant-scope.ts` MUST use `$queryRawUnsafe`
to look up the location ID. It MUST NOT call `getLocationId()`.

**Why:** `getLocationId()` uses inflight promise coalescing. When the tenant
scope extension calls `getLocationId()` recursively, it gets back the SAME
promise that's currently executing. That promise waits for the extension.
The extension waits for the promise. **Deadlock.** Every venue-scoped route
hangs forever until 504 timeout.

This was the root cause of ALL Vercel menu/terminal/settings failures.
Routes without tenant scoping (health, cron) worked fine.

## Files That Must Follow These Rules

| File | What it does |
|------|-------------|
| `src/lib/db-connection-budget.ts` | `CONNECTION_BUDGET` — single source of truth for all pool sizes |
| `src/lib/db.ts` | `createPrismaClient()` and `createAdminClient()` — PrismaPg everywhere, references CONNECTION_BUDGET |
| `src/lib/db-venue-cache.ts` | Venue client LRU cache — references `CONNECTION_BUDGET.VENUE_CACHE_MAX` |
| `src/lib/db-tenant-scope.ts` | `resolveTenantLocationId()` — MUST use raw SQL, never `getLocationId()` |
| `src/lib/location-cache.ts` | `getLocationId()` — has inflight coalescing that causes the deadlock if called from tenant scope |
| `src/lib/neon-client.ts` | `createNeonClient()` for sync workers — references `CONNECTION_BUDGET.LOCAL_NEON_SYNC` |
| `src/lib/venue-bootstrap.ts` | Bootstrap Neon check |
| `src/app/api/internal/provision/route.ts` | Venue provisioning seed client |

## What Went Wrong (History)

1. **Original:** PrismaPg everywhere. Simple routes worked (hardware 200). Menu timed out (504).
2. **Misdiagnosis:** Thought it was Neon cold starts / query complexity. Spent hours switching adapters.
3. **PrismaNeon attempts (4x):** All failed with "No database host" — DATABASE_URL uses Neon pooler endpoint.
4. **Simplified query:** Still 504. Even a trivial query on the venue DB hung forever.
5. **Debug logging:** `getLocationId()` never returned. Found the deadlock.
6. **Real fix:** `resolveTenantLocationId()` uses `$queryRawUnsafe` instead of `getLocationId()`.

The adapter was never the problem. The deadlock was.

## Dual-Ingress Write Model

Neon receives writes from two independent ingress paths:

1. **NUC upstream sync (LAN ingress):** LAN devices write to NUC local PG. The upstream sync worker replicates to Neon every 5 seconds.
2. **Cellular terminals (cloud ingress):** Roaming Android devices write directly to Neon through Vercel API routes, bypassing the NUC entirely (they cannot reach it over the public internet).

Both paths converge in Neon, which is the canonical SOR. The NUC's downstream sync worker (also 5s) pulls cellular-originated writes from Neon into local PG for fulfillment (kitchen prints, KDS, receipts).

This means Neon's write traffic is the **union** of upstream sync batches and cellular terminal writes. Connection pool sizing on the Neon side must account for both sources.

See `docs/architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md` Phase 2 (Cellular Edge) and Phase 6 (Cloud-Primary Architecture) for full details.

## Vercel Function Timeouts

| Route | maxDuration | Why |
|-------|------------|-----|
| `/api/menu` | 60 | Large menu with nested includes |
| `/api/internal/provision` | 60 | Schema push + seed |
| `/api/sync/bootstrap` | 120 | Full venue data bootstrap |
| Most routes | default (15) | Simple queries |
