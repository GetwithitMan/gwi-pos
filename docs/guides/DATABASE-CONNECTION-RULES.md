# Database Connection Rules

**DO NOT CHANGE THESE RULES. They were found through painful trial and error.**

## The Rule: PrismaPg Everywhere

PrismaPg (`@prisma/adapter-pg`) is used for ALL environments:
- **Vercel:** `max: 1`, `connectionTimeoutMillis: 60000` (handles Neon cold starts)
- **NUC:** `max: 25`, `connectionTimeoutMillis: 10000` (local PostgreSQL)

PrismaNeon was attempted 4 times and fails with "No database host" on Vercel
because the DATABASE_URL uses Neon's pooler endpoint which NeonPool's WebSocket
can't connect to. Do not try PrismaNeon again without changing DATABASE_URL
to a direct (non-pooler) endpoint.

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
| `src/lib/db.ts` | `createPrismaClient()` and `createAdminClient()` — PrismaPg everywhere |
| `src/lib/db-tenant-scope.ts` | `resolveTenantLocationId()` — MUST use raw SQL, never `getLocationId()` |
| `src/lib/location-cache.ts` | `getLocationId()` — has inflight coalescing that causes the deadlock if called from tenant scope |
| `src/lib/neon-client.ts` | `createNeonClient()` for sync workers |
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

## Vercel Function Timeouts

| Route | maxDuration | Why |
|-------|------------|-----|
| `/api/menu` | 60 | Large menu with nested includes |
| `/api/internal/provision` | 60 | Schema push + seed |
| `/api/sync/bootstrap` | 120 | Full venue data bootstrap |
| Most routes | default (15) | Simple queries |
