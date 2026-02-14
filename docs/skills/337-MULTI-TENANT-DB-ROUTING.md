# Skill 337: Multi-Tenant DB Routing (withVenue + AsyncLocalStorage)

**Domain:** Mission Control / Settings
**Status:** DONE
**Date:** 2026-02-13
**Commits:** `1f0a18f`, `bf9d2a5`

## Problem

Cloud POS at `{slug}.ordercontrolcenter.com` was writing all data to the master `gwi_pos` database instead of each venue's individual Neon database (`gwi_pos_{slug}`). The existing `db.ts` Proxy tried to read `x-venue-slug` from `headers()`, but Next.js 16 changed `headers()` to return a Promise. The synchronous Proxy getter couldn't `await` it, causing silent fallback to the master DB.

## Solution

### 1. AsyncLocalStorage per-request context (`src/lib/request-context.ts`)

```
requestStore = new AsyncLocalStorage<{ slug: string; prisma: PrismaClient }>()
```

Each request runs inside `requestStore.run()` so all code within that request can access the venue-specific PrismaClient via `getRequestPrisma()`.

### 2. `withVenue()` wrapper (`src/lib/with-venue.ts`)

Every API route handler is wrapped with `withVenue()`:
1. Properly `await`s `headers()` (Next.js 16 fix)
2. Reads `x-venue-slug` header (set by middleware)
3. Calls `getDbForVenue(slug)` to get/create venue PrismaClient
4. Runs handler inside `requestStore.run({ slug, prisma })`
5. Safety rail: if slug present but DB resolution fails → 500 (not silent master fallback)

### 3. `db.ts` Proxy 3-tier resolution

```
db.model.method() → resolveClient():
  Priority 1: getRequestPrisma() → AsyncLocalStorage (withVenue/server.ts)
  Priority 2: headers().get('x-venue-slug') → getDbForVenue() (legacy fallback)
  Priority 3: masterClient (no slug = main domain / local dev)
```

### 4. Codemod: 348 routes wrapped

All 348 API route files (617 handlers) wrapped with `withVenue()` via automated codemod script (`scripts/codemod-with-venue.mjs`).

## Files

| File | Action |
|------|--------|
| `src/lib/request-context.ts` | CREATED — AsyncLocalStorage for per-request tenant context |
| `src/lib/with-venue.ts` | CREATED — Route handler wrapper |
| `src/lib/db.ts` | MODIFIED — Exported `masterClient`, 3-tier resolution |
| `scripts/codemod-with-venue.mjs` | CREATED — Automated codemod for 348 routes |
| 348 API route files | MODIFIED — Wrapped with `withVenue()` |

## Request Flow

```
1. middleware.ts
   └─ extractVenueSlug(hostname) → headers.set('x-venue-slug', slug)

2. withVenue() wrapper
   └─ await headers() → reads x-venue-slug
   └─ getDbForVenue(slug) → PrismaClient
   └─ requestStore.run({ slug, prisma }, handler)

3. db.ts Proxy (on every db.* access)
   └─ resolveClient() → AsyncLocalStorage → venue PrismaClient

4. getDbForVenue(slug)
   └─ venueDbName() → 'gwi_pos_fruita_bar_and_grill'
   └─ new PrismaClient({ datasources: { db: { url: venueUrl } } })
   └─ Cached in globalThis.venueClients Map
```

## Key Design Decisions

1. **AsyncLocalStorage over middleware injection**: Per-request context survives across async boundaries without passing Prisma client through every function
2. **Proxy pattern preserved**: Existing `import { db } from '@/lib/db'` works everywhere — zero changes to business logic
3. **Safety rail**: `withVenue()` returns 500 if slug is present but DB resolution fails, preventing silent cross-tenant data access
4. **NUC compatibility**: `server.ts` (custom server for NUC) also uses `requestStore.run()`, so both Vercel and NUC use the same context mechanism
5. **PrismaClient caching**: `globalThis.venueClients` Map survives HMR in dev, one client per venue

## Verification

- TypeScript: zero errors
- All 348 route files correctly wrapped
- Deployed to Vercel, venue subdomain queries hit correct Neon database
- Floor plan tables load and are interactive on venue subdomain
