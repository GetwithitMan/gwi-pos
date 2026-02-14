# Skill 341: Database Hot Paths (Performance Phase 3)

**Status:** DONE
**Date:** February 14, 2026
**Commits:** `c9ef599` (batch queries + indexes), `7db87e5` (Server-Timing + menu cache), `a37c65a` (bulk quick bar + PATCH), `2a8bafb` (bulk menu items + PATCH), `c1bf346` (floor plan snapshot)
**Domain:** Orders / Menu / Floor Plan
**Impact:** 30 queries per cocktail → 3; pay route -50-200ms; 80-90% less data transferred

---

## Problems Solved

### 3.1 Liquor N+1 Queries
`processLiquorInventory()` looped over items/modifiers/ingredients calling `findUnique` per row. A cocktail order triggered 30+ queries.

**Fix:** Collect all IDs upfront, batch with `findMany`, run math in memory:
```typescript
const bottles = await db.bottleProduct.findMany({ where: { id: { in: bottleIds } } })
const bottleMap = new Map(bottles.map(b => [b.id, b]))
```

### 3.2 Unblock Pay Route
`await processLiquorInventory()` blocked payment response for 50-200ms. Triple order query (zero-check, idempotency, full fetch) merged to 1. `resolveDrawerForPayment()` called once before split-pay loop (not per payment).

**Fix:** Fire-and-forget:
```typescript
void processLiquorInventory(orderId, employeeId).catch(err => {
  console.error('Background liquor inventory failed:', err)
})
```

### 3.3 Compound Indexes
Added 7 compound indexes for hot query patterns:

```prisma
model Order {
  @@index([locationId, status])
  @@index([locationId, status, createdAt])
}
model OrderItem {
  @@index([orderId, kitchenStatus])
  @@index([orderId, status])
}
model MenuItem {
  @@index([locationId, isActive, deletedAt])
}
model Category {
  @@index([locationId, isActive, deletedAt])
}
model TaxRule {
  @@index([locationId, isActive, isInclusive])
}
```

### 3.4 Menu Cache + Parallel Queries
- `src/lib/menu-cache.ts`: 60s TTL in-memory cache per locationId (cache hit ~0ms vs ~50-200ms)
- Menu API: 3 sequential DB queries → `Promise.all` (~30-50% faster on miss)
- `invalidateMenuCache(locationId)` exported for CRUD routes
- Server-Timing headers on `/api/menu` and `/api/floorplan/snapshot`

### 3.5 Floor Plan Snapshot API
`GET /api/floorplan/snapshot` replaces 3 separate fetches + item count query (4→1). Single query returns tables + open order summaries + item counts.

### 3.6 Bulk Menu Items Endpoint
`POST /api/menu/items/bulk` replaces N individual GETs with 1 query (max 50 IDs). Quick bar: 12 fetches → 1.

### 3.7 Lightweight PATCH
`PATCH /api/orders/[id]` uses `select` (not `include`) — no items/modifiers in response (~60-70% faster than PUT for metadata updates).

### 3.8 Open Orders Summary
`GET /api/orders/open?summary=true` returns lightweight response (~50KB vs 500KB+). Panel only needs counts/badges, not full item data.

## Key Files

| File | Changes |
|------|---------|
| `src/lib/liquor-inventory.ts` | Batched findMany (30→3 queries) |
| `src/app/api/orders/[id]/pay/route.ts` | Fire-and-forget liquor, merged triple query, single drawer resolve |
| `prisma/schema.prisma` | 7 compound indexes |
| `src/lib/menu-cache.ts` | **NEW** — 60s TTL menu cache |
| `src/lib/perf-timing.ts` | **NEW** — Server-Timing header utility |
| `src/app/api/floorplan/snapshot/route.ts` | **NEW** — Single-query floor plan snapshot |
| `src/app/api/menu/items/bulk/route.ts` | **NEW** — Bulk menu item fetch |
| `src/app/api/orders/[id]/route.ts` | PATCH handler (lightweight metadata) |
| `src/app/api/orders/open/route.ts` | `?summary=true` mode |

## Mandatory Pattern Going Forward

- **NEVER** write N+1 query loops. Batch with `findMany` + Map lookup.
- **NEVER** block API responses with non-critical background work. Use fire-and-forget.
- **ALWAYS** use menu cache (`src/lib/menu-cache.ts`) and location cache (`src/lib/location-cache.ts`) instead of fresh queries.
- **ALWAYS** add compound indexes for new hot query patterns.
- See `CLAUDE.md` Performance Rules section.
