# GWI POS — Unified Performance & Deployment Execution Plan

**Date:** February 14, 2026
**Sources:** 10-agent forensic codebase audit + independent 3rd-party analysis
**Goal:** Button taps <=100-200ms, push-driven KDS/Expo, safe multi-tenant isolation for shared/cloud servers

---

## Non-Negotiable Principles

1. **Instant feel.** Every button tap must produce visual feedback in <=100-200ms.
2. **PostgreSQL only.** Database-per-venue on Neon. SQLite must be fully removed from code, Docker, and scripts.
3. **One socket per tab.** Authenticated, location-scoped, no polling for core screens, no HTTP broadcast hop.
4. **Atomic state updates.** Zustand uses atomic selectors. One interaction = one `set()`. No blast-radius re-renders.

---

## Phase 1: Frontend — Instant Feel

### 1.1 Zustand Atomic Selectors

**Problem:** Components destructure the entire store (`const { currentOrder } = useOrderStore()`), so every store change re-renders everything subscribed to it. This is the single biggest source of lag (200-500ms per tap).

**Files:** All files that call `useOrderStore()`, starting with `FloorPlanHome.tsx` and `OrderPanel.tsx`.

**Required pattern:**

```typescript
// WRONG — subscribes to ALL store changes
const { currentOrder } = useOrderStore()

// CORRECT — subscribes only to what this component reads
const itemCount = useOrderStore(s => s.currentOrder?.items?.length ?? 0)
const subtotal  = useOrderStore(s => s.currentOrder?.subtotal ?? 0)
const total     = useOrderStore(s => s.currentOrder?.total ?? 0)
const status    = useOrderStore(s => s.currentOrder?.status)
```

**Rules:**
- One selector call per field (or small group of primitives) actually needed.
- Never grab an entire object when you only read 1-2 fields from it.
- Apply to every `useOrderStore()` call across the codebase.

**Effort:** 2 hours | **Impact:** -200-500ms per tap

---

### 1.2 One Interaction = One `set()`

**Problem:** `order-store.ts` mutations call `set()` for the data change, then call `get().calculateTotals()` which does a second `set()`. Two store updates = two re-render passes per action.

**File:** `src/stores/order-store.ts`

**Required pattern:**

```typescript
// WRONG — two set() calls = two re-render passes
updateItem: (itemId, updates) => {
  set({ currentOrder: updatedOrder })   // render #1
  get().calculateTotals()               // render #2
}

// CORRECT — compute totals in JS, single set()
updateItem: (itemId, updates) => {
  const prevOrder = get().currentOrder
  const updatedItems = /* apply updates */
  const newOrder = { ...prevOrder, items: updatedItems }
  const totals = calculateTotalsFromOrder(newOrder)
  set({ currentOrder: { ...newOrder, ...totals } })  // single render
}
```

**Apply to:** `addItem`, `removeItem`, `updateItem`, `changeQuantity`, `applyDiscount`, and every other mutation that currently calls `calculateTotals()` separately.

**Effort:** 3 hours | **Impact:** -100-200ms per mutation

---

### 1.3 Component Splitting + React.memo

**Problem:** `FloorPlanHome.tsx` is ~3,400 lines with 41+ `useState` calls. Any state change re-renders the entire POS screen: menu grid, category bar, order panel, and floor plan canvas. `OrderPanelItem` is not wrapped in `React.memo`, so adding 1 item re-renders all 10+ existing items.

**Files:**
- `src/components/floor-plan/FloorPlanHome.tsx` — split into sub-components
- `src/components/orders/OrderPanelItem.tsx` — wrap in `React.memo`
- `src/components/orders/OrderPanel.tsx` — memoize callbacks passed to items

**Required steps:**

1. Extract `FloorPlanHome` into at minimum:
   - `CategoryGrid` — menu category/item selection
   - `OrderSidebar` — order panel with items and totals
   - `FloorCanvas` — table/floor plan rendering

2. Wrap each extracted component in `React.memo`:
   ```typescript
   const CategoryGrid = React.memo(function CategoryGrid(props: Props) {
     // ...
   })
   ```

3. Pass only primitive/immutable props. Use `useCallback` for callbacks so memoization works.

4. Wrap `OrderPanelItem` in `React.memo`. Memoize all callbacks passed to it from `OrderPanel`.

**Goal:** Menu taps do not re-render the floor layout. Table actions do not re-render the order panel. Adding an item does not re-render all existing items.

**Effort:** 4 hours (split) + 2 hours (memo) | **Impact:** -150-300ms for large orders

---

### 1.4 Estimated Results After Phase 1

| Interaction | Before | After | Improvement |
|-------------|--------|-------|-------------|
| Button tap to visual feedback | 500-800ms | 100-200ms | **60-75%** |
| Item add to panel update | 300-600ms | 50-100ms | **80%** |
| Quantity +1 to display update | 200-400ms | 30-50ms | **85%** |

---

## Phase 2: Socket.io — Security + Performance

### 2.1 Socket Authentication & Room Isolation

**Problem:** Socket server allows any client to join any location or tag room by name. No JWT or locationId validation. This is a cross-tenant data leak on shared/cloud servers.

**File:** `src/lib/socket-server.ts`

**Why it's mitigated today:** Each NUC runs its own socket server, so network isolation prevents cross-venue access. Must be fixed before any cloud or shared-server deployment.

**Required changes:**

1. Authenticate on connection:
   ```typescript
   // socket-server.ts — io.use middleware
   io.use((socket, next) => {
     const token = socket.handshake.auth?.token || parseCookie(socket.handshake.headers.cookie)
     const payload = verifyJWT(token)
     if (!payload) return next(new Error('Unauthorized'))
     socket.data.locationId = payload.locationId
     socket.data.employeeId = payload.employeeId
     next()
   })
   ```

2. Enforce room joins — only allow rooms matching the authenticated locationId:
   ```typescript
   socket.on('join_location', (requestedLocationId) => {
     if (requestedLocationId !== socket.data.locationId) return
     socket.join(`location:${socket.data.locationId}`)
   })
   ```

3. Namespace tag rooms with locationId:
   ```
   WRONG:   tag:pizza
   CORRECT: location:${locationId}:tag:pizza
   ```
   Update both server and client join logic.

4. Internal broadcast APIs must validate a shared secret, even in dev.

**Effort:** 4 hours | **Impact:** Prevents cross-venue eavesdropping

---

### 2.2 Single Socket Connection Per Tab (GlobalSocketProvider)

**Problem:** POS tabs open 2-3 socket connections (`useOrderSockets` + `useEvents` + `OpenOrdersPanel`), tripling heartbeats and event handling. Menu and liquor-builder pages have broken connections.

**Current state:**

| Page | Connections | Should Be |
|------|-------------|-----------|
| `/orders` (POS) | **3** | **1** |
| `/menu` (admin) | **2** (wrong path, never joins room) | **1** |
| `/liquor-builder` | **1** (wrong event name) | **1** |
| `/kds` | **0** (polling instead) | **1** |
| `/kds/entertainment` | **0** (polling instead) | **1** |

**Required architecture:**

1. Create `GlobalSocketProvider` in `src/lib/events/socket-provider.ts`:
   - Single `io()` client instance per tab.
   - Provide via React context or `useGlobalSocket()` hook.

2. Update all consumers to use the shared instance:
   - `useOrderSockets` — use shared socket
   - `useEvents` — use shared socket
   - `OpenOrdersPanel` — use shared socket
   - `menu/page.tsx` — fix path, use shared socket, join correct room
   - `liquor-builder/page.tsx` — fix event name (`join_station` not `join_location`)

3. Remove `onAny` console.log from `socket-provider.ts:143` (logs every event including heartbeats in production).

**Effort:** 4 hours | **Impact:** 60% fewer connections, eliminates log spam

---

### 2.3 Remove HTTP Broadcast Hop

**Problem:** All 17 socket dispatch functions in `socket-dispatch.ts` call `fetch('localhost:3000/api/internal/socket/broadcast')`. The socket server runs in the same Node.js process. This adds 2-5ms and extra JSON serialization per broadcast for zero benefit.

**Files:**
- `src/lib/socket-dispatch.ts` — replace HTTP calls with direct function calls
- `src/lib/socket-server.ts` — export shared emitter
- `src/app/api/internal/socket/broadcast/route.ts` — decommission after migration

**Required changes:**

1. Export emitter from socket server:
   ```typescript
   // socket-server.ts
   export function emitToLocation(locationId: string, event: string, payload: any) {
     globalThis.socketServer?.to(`location:${locationId}`).emit(event, payload)
   }
   ```

2. In all 17 dispatch functions, replace:
   ```typescript
   // WRONG
   fetch('http://localhost:3000/api/internal/socket/broadcast', { body: JSON.stringify(...) })

   // CORRECT
   import { emitToLocation } from '@/lib/socket-server'
   emitToLocation(locationId, 'order:updated', data)
   ```

3. Decommission the broadcast route once all callers are migrated.

**Effort:** 3 hours | **Impact:** -2-5ms per broadcast

---

### 2.4 Kill KDS & Expo Polling

**Problem:** KDS polls every 5 seconds, ExpoScreen polls every 3 seconds. With 10 terminals, that's 120+ DB hits/min from KDS alone plus 1,200 requests/hour from Expo. The `useKDSSockets` hook already exists and handles all KDS events — it's just not wired in.

**Files:**
- `src/app/(kds)/kds/page.tsx` — line 248: `setInterval(loadOrders, 5000)`
- `src/components/kds/ExpoScreen.tsx` — line 117: `setInterval(loadOrders, 3000)`
- `src/hooks/useKDSSockets.ts` — already handles KDS events

**Required changes:**

1. KDS page on mount:
   - One initial HTTP fetch (`loadOrders`).
   - Subscribe to socket events via `useKDSSockets`.
   - Remove the 5-second `setInterval`.

2. Expo screen on mount:
   - One initial HTTP fetch.
   - Subscribe to socket events.
   - Remove the 3-second `setInterval`.

3. Add fallback polling only when socket is disconnected:
   ```typescript
   useEffect(() => {
     if (!socket.connected) {
       const fallback = setInterval(loadOrders, 30000) // 30s, not 3-5s
       return () => clearInterval(fallback)
     }
   }, [socket.connected])
   ```

**Effort:** 3 hours | **Impact:** Eliminates 120+ DB hits/min (KDS) + 1,200 req/hr (Expo)

---

## Phase 3: Database Hot Paths

### 3.1 Liquor Inventory: N+1 to Batched findMany

**Problem:** `processLiquorInventory()` loops over items/modifiers/ingredients calling `findUnique` per row. A cocktail order can trigger 30+ queries.

**File:** `src/lib/liquor-inventory.ts:62-148`

**Required changes:**

1. Collect all needed IDs upfront (bottleProductIds, recipe/ingredient IDs).
2. Batch with `findMany`:
   ```typescript
   const bottles = await db.bottleProduct.findMany({
     where: { id: { in: bottleIds } },
   })
   const bottleMap = new Map(bottles.map(b => [b.id, b]))
   ```
3. Run all inventory math in memory using the prefetched maps.

**Effort:** 3 hours | **Impact:** 30 queries per cocktail reduced to 2-3

---

### 3.2 Unblock the Pay Route

**Problem:** `await processLiquorInventory(orderId, employeeId)` blocks the payment response for 50-200ms. The food inventory deduction already correctly uses fire-and-forget.

**File:** `src/app/api/orders/[id]/pay/route.ts:887`

**Required change:**

```typescript
// WRONG — blocks payment response
await processLiquorInventory(orderId, employeeId)

// CORRECT — fire-and-forget
void processLiquorInventory(orderId, employeeId).catch(err => {
  console.error('Background liquor inventory failed:', err)
})
```

**Also in pay route:**
- `resolveDrawerForPayment()` is called per payment in a split-pay loop. Call it once before the loop.
- Triple order query (zero-check line 148, idempotency line 197, full fetch line 219) should be merged into a single query.

**Effort:** 1 hour | **Impact:** -50-200ms per payment

---

### 3.3 Compound Indexes

**Problem:** Hot queries lack compound indexes and scan by single columns.

**File:** `prisma/schema.prisma`

**Required additions:**

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

Run migration and redeploy.

**Effort:** 1 hour | **Impact:** -5-30ms on hot queries

---

### 3.4 Menu & Open Orders Over-Fetching

**Menu (`GET /api/menu`):**

Current behavior: loads ALL categories + ALL items + 3-level deep modifier includes + liquor recipes + ingredients, PLUS a second full query for stock status. Estimated payload: 500KB-2MB.

**File:** `src/app/api/menu/route.ts`

Required improvements:
- Category-first load: initial call returns categories only, subsequent calls fetch items per category with modifiers.
- Eliminate the second stock-status refetch by passing already-loaded item IDs into `getAllMenuItemsStockStatus`.
- Add `?includeStock=false` for views that don't need stock on first paint.

**Open Orders (`GET /api/orders/open`):**

Current behavior: returns full item and modifier details for a sidebar that only shows order counts and totals. 30 open orders x 5 items x 2 modifiers = 300 modifier records for a list view.

**File:** `src/app/api/orders/open/route.ts`

Required: Add `?summary=true` mode returning only order id, table, guest count, totals, and item count. Fetch full details only when viewing a specific order.

**Effort:** 4 hours (menu) + 2 hours (open orders) | **Impact:** 80-90% less data transferred

---

## Phase 4: PostgreSQL-Only DevOps

### 4.1 Remove All SQLite References

**Problem:** Application code is fully on PostgreSQL. Docker infrastructure, scripts, and docs still reference SQLite.

**Required actions:**

| File | What to Fix |
|------|-------------|
| `docker/Dockerfile` line 56 | Remove `sqlite3` install. Add PostgreSQL client libs (`libpq-dev`) if CLI tools needed. |
| `docker/Dockerfile` line 89 | Remove hardcoded `DATABASE_URL="file:/app/data/pos.db"`. Always read from environment. |
| `docker/docker-compose.yml` | Remove SQLite volume mounts. Ensure services use `DATABASE_URL` pointing at PostgreSQL. |
| `.env.production.local` | Template with PostgreSQL credentials only (host, db, user, password). No SQLite fallback. |

### 4.2 Fix Backup/Restore Scripts

**Files:**
- `docker/scripts/backup.sh` — currently uses `sqlite3` commands
- `docker/scripts/restore.sh` — currently uses `sqlite3` commands

**Required:**

```bash
# backup.sh
pg_dump "$DATABASE_URL" > /backups/pos_$(date +%F_%H%M%S).sql

# restore.sh
psql "$DATABASE_URL" < /backups/$BACKUP_FILE
```

### 4.3 Update Documentation

**Files:** `CLAUDE.md` and all AI-facing docs.

- Change "SQLite (NOT PostgreSQL)" to "Neon PostgreSQL with database-per-venue. SQLite is not supported."
- Remove all SQLite migration hints, `file:./pos.db` references, and SQLite-specific commands.
- Remove `JSON.parse` fallbacks from SQLite era (5 files: roles, settings, entertainment routes).
- Standardize `Prisma.DbNull` vs `Prisma.JsonNull` usage across ~15 API routes.

### 4.4 Verification

After all changes, these must return zero results:
```bash
grep -Ri "sqlite" .
grep -Ri "pos.db" .
```

**Effort:** 3 hours (Docker) + 2 hours (scripts) + 1 hour (docs) | **Impact:** Required for venue deployment

---

## Phase 5: Additional Hardening

These items are lower priority but should be completed before multi-venue rollout.

| # | Fix | File(s) | Effort | Impact |
|---|-----|---------|--------|--------|
| 1 | Add locationId to `findUnique` where clauses (defense-in-depth) | 304 API routes | 8 hrs | Safety net for DB-per-venue |
| 2 | Client-side socket event debouncing (150ms) | Socket provider | 2 hrs | Prevent fetch storms |
| 3 | Conditional polling (only when socket disconnected) | All polling hooks | 1 hr | Eliminate unnecessary fetches |
| 4 | Delta-based open orders updates (remove from list vs refetch all) | Open orders components | 3 hrs | Eliminate full refetches |
| 5 | Cache tax rules and categories | `location-cache.ts` | 2 hrs | -5-15ms per order |
| 6 | Add `connection_limit` for NUC PrismaClient | `src/lib/db.ts` | 30 min | Prevent connection exhaustion |
| 7 | Fix `connectedTerminals` Map memory leak (`pos-${Date.now()}` IDs never cleaned) | `socket-server.ts` | 1 hr | Prevent server OOM over time |

---

## Execution Sequence

Earlier phases block multi-venue rollout. Execute in order.

```
Phase 1: Frontend — Instant Feel (1-2 days)
├── 1.1 Zustand atomic selectors
├── 1.2 One set() per interaction (batch calculateTotals)
└── 1.3 Component splitting + React.memo on OrderPanelItem

Phase 2: Socket.io — Security + Performance (3-5 days)
├── 2.1 Socket auth + location-scoped room joins
├── 2.2 GlobalSocketProvider (single connection per tab)
├── 2.3 Remove HTTP broadcast hop (direct emitToLocation)
└── 2.4 Kill KDS/Expo polling (wire to existing socket hooks)

Phase 3: Database Hot Paths (2-3 days)
├── 3.1 Batch liquor inventory queries (findMany)
├── 3.2 Unblock pay route (fire-and-forget + merge triple query)
├── 3.3 Add compound indexes
└── 3.4 Fix menu + open orders over-fetching

Phase 4: PostgreSQL-Only DevOps (1 day)
├── 4.1 Remove SQLite from Docker + env
├── 4.2 Fix backup/restore scripts (pg_dump/psql)
├── 4.3 Update docs (CLAUDE.md)
└── 4.4 Verify: grep -Ri "sqlite" returns nothing

Phase 5: Additional Hardening (ongoing)
└── Defense-in-depth, debouncing, caching, memory leak fixes
```

---

## Critical Files Reference

### Frontend (Phase 1)
| File | Lines | Issue |
|------|-------|-------|
| `src/stores/order-store.ts` | ~500 | Double `set()` per mutation |
| `src/components/floor-plan/FloorPlanHome.tsx` | ~3,400 | 41 useState, monolithic |
| `src/components/orders/OrderPanel.tsx` | ~600 | Passes unstable callbacks |
| `src/components/orders/OrderPanelItem.tsx` | ~950 | Not wrapped in React.memo |
| `src/app/(pos)/orders/page.tsx` | ~3,500 | 78 useState, root wrapper |

### Socket.io (Phase 2)
| File | Issue |
|------|-------|
| `src/lib/socket-server.ts` | Zero auth on room joins, 12 console.logs, memory leak in connectedTerminals |
| `src/lib/socket-dispatch.ts` | 17 functions all use HTTP broadcast hop |
| `src/lib/events/socket-provider.ts` | `onAny` logs every event in production |
| `src/app/api/internal/socket/broadcast/route.ts` | Unnecessary HTTP bridge (decommission) |
| `src/hooks/useOrderSockets.ts` | Creates its own socket (should share) |
| `src/hooks/useKDSSockets.ts` | Ready but not wired into KDS page |
| `src/app/(admin)/menu/page.tsx:323,371` | `io()` with no path, never joins room |
| `src/app/(admin)/liquor-builder/page.tsx:127` | Wrong event name (`join_location` vs `join_station`) |

### Database (Phase 3)
| File | Issue |
|------|-------|
| `src/lib/liquor-inventory.ts:62-148` | N+1: up to 30 queries per cocktail |
| `src/app/api/orders/[id]/pay/route.ts:887` | `await processLiquorInventory` blocks response |
| `src/app/api/orders/[id]/pay/route.ts:148,197,219` | Triple order query (merge to 1) |
| `src/app/api/orders/[id]/pay/route.ts:373` | `resolveDrawerForPayment` called per split (call once) |
| `prisma/schema.prisma` | Missing compound indexes on hot queries |
| `src/app/api/menu/route.ts` | Loads entire menu graph (500KB-2MB) |
| `src/app/api/orders/open/route.ts` | Returns full items for sidebar list |

### DevOps (Phase 4)
| File | Issue |
|------|-------|
| `docker/Dockerfile:56` | Still installs sqlite3 |
| `docker/Dockerfile:89` | Hardcoded `DATABASE_URL="file:/app/data/pos.db"` |
| `docker/scripts/backup.sh` | Uses sqlite3 commands |
| `docker/scripts/restore.sh` | Uses sqlite3 commands |
| `docker/docker-compose.yml` | May still mount SQLite volumes |
| `.env.production.local` | Placeholder PostgreSQL credentials |
| `CLAUDE.md` | Says "SQLite (NOT PostgreSQL)" |
