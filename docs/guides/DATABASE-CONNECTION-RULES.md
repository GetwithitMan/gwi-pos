# Database Connection Rules

**DO NOT CHANGE THESE RULES. They were found through painful trial and error.**

## The Rule: One Adapter Per Runtime

| Runtime | Adapter | Why |
|---------|---------|-----|
| **Vercel (serverless)** | `PrismaNeon` + `@neondatabase/serverless` + `ws` | HTTP/WebSocket. Instant connections. No cold start. |
| **NUC (long-running)** | `PrismaPg` + `@prisma/adapter-pg` | TCP to local PostgreSQL. Fast, reliable, persistent. |

**NEVER use PrismaPg on Vercel.** It uses TCP, and Neon auto-suspends compute after 5 min idle. TCP reconnection takes 5-10s to wake it. Combined with complex queries, this exceeds Vercel's function timeout every time.

**NEVER use PrismaNeon on NUC.** It adds WebSocket overhead for a local TCP connection that doesn't need it.

## Critical: serverExternalPackages

In `next.config.ts`:
```typescript
serverExternalPackages: ['serialport', 'ws', '@neondatabase/serverless', '@prisma/adapter-neon'],
```

**DO NOT REMOVE THESE.** Turbopack bundles modules by default. When it bundles `ws`, it breaks the WebSocket constructor that `@neondatabase/serverless` needs. Every route returns `prisma:error No database host`. Adding these to `serverExternalPackages` tells Next.js to load them from `node_modules` at runtime instead of bundling.

## Critical: ws Polyfill

`@neondatabase/serverless` uses WebSocket internally. In Node.js (which Vercel serverless functions run on), WebSocket is not globally available. The `ws` package provides it. You MUST set it before creating any Pool:

```typescript
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

if (isVercel) {
  neonConfig.webSocketConstructor = ws
}
```

This must run at module scope, before `createPrismaClient()` is called.

## Files That Must Follow These Rules

| File | What it does |
|------|-------------|
| `src/lib/db.ts` | `createPrismaClient()` and `createAdminClient()` |
| `src/lib/neon-client.ts` | `createNeonClient()` for sync workers |
| `src/lib/venue-bootstrap.ts` | Bootstrap Neon check |
| `src/app/api/internal/provision/route.ts` | Venue provisioning seed client |

All four files use the same pattern:
```typescript
if (isVercel) {
  const pool = new NeonPool({ connectionString })
  adapter = new PrismaNeon(pool)
} else {
  adapter = new PrismaPg({ connectionString, ... })
}
```

## What Went Wrong (History)

1. **Original:** PrismaPg everywhere. Worked on NUC. Timed out on Vercel (504 on /api/menu).
2. **Attempt 1:** Switched to PrismaNeon on Vercel. Passed `{ connectionString }` directly — wrong constructor. "No database host."
3. **Attempt 2:** Fixed constructor to use `Pool`. Forgot `ws` polyfill. Silent hang.
4. **Attempt 3:** Added `ws` polyfill. Turbopack bundled `ws` and broke it. "No database host."
5. **Fix:** Added `ws`, `@neondatabase/serverless`, `@prisma/adapter-neon` to `serverExternalPackages`. Works.

**Do not repeat this cycle.** The fix is steps 4+5 together.

## Dependencies

These must be direct dependencies in `package.json` (not just transitive):
- `ws` — WebSocket polyfill for Node.js
- `@neondatabase/serverless` — Neon's serverless driver (HTTP/WebSocket transport)
- `@prisma/adapter-neon` — Prisma adapter that uses the Neon driver
- `@prisma/adapter-pg` — Prisma adapter for standard TCP (NUC only)

## Vercel Function Timeouts

| Route | maxDuration | Why |
|-------|------------|-----|
| `/api/menu` | 60 | 314 items with 5-level nested includes |
| `/api/internal/provision` | 60 | Schema push + seed |
| `/api/sync/bootstrap` | 120 | Full venue data bootstrap |
| Most routes | default (15) | Simple queries, fast with PrismaNeon |
