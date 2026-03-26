# Architecture Data Flow Audit — 2026-03-26

**Scope:** Complete audit of all data flows: Neon DB, NUC server, POS terminals, KDS, PAX, CFD
**Method:** 8 parallel deep-dive agents covering DB layer, socket/realtime, order lifecycle, sync engine, API routes, client state, terminal comms, server middleware
**Finding:** 832 API routes analyzed, 416 mutations identified, 78+ socket events, 170+ sync models

---

## Executive Summary: Why Terminals Can't See Each Other's Data

The system has strong architectural bones (event-sourced orders, bidirectional sync, socket rooms, tenant scoping) but suffers from **systematic notification and sync gaps**:

1. **48% of mutation routes (201/416) don't notify other terminals** via socket events
2. **57% of mutation routes (236/416) don't push changes to Neon** via `pushUpstream()`
3. **42% of mutation routes (176/416) do NEITHER** — completely invisible changes
4. **Missing socket event handlers on the client** — entertainment, menu changes, modifier changes never refresh
5. **No auto-refresh when socket reconnects** — terminal shows stale order data until manual reload
6. **Race conditions in item dedup** — rapid tap after "Send" creates duplicate kitchen orders

These gaps directly explain every reported symptom: orders not visible on other terminals, stale data after modifications, KDS not updating, payment status not propagating.

---

## PRIORITY 1: CRITICAL FIXES (Data Loss / Incorrect Behavior)

### C1. Order Item Routes Missing pushUpstream + Socket Events
**Impact:** Items added/modified/deleted on one terminal may not sync to cloud or notify other terminals properly
**Routes affected:**
- `PUT /api/orders/[id]` — status/table/employee changes: has socket notify, NO pushUpstream
- `POST/PUT/DELETE /api/orders/[id]/items` — item mutations: has emitOrderEvent, NO pushUpstream
- `PUT/DELETE /api/orders/[id]/items/[itemId]` — single item changes: NO pushUpstream
- `POST/PUT/DELETE /api/orders/[id]/items/[itemId]/modifiers` — modifier changes: NO pushUpstream
- `POST/DELETE /api/orders/[id]/discount` — discount changes: NO pushUpstream
- `POST/PATCH/DELETE /api/orders/[id]/split-tickets` — split operations: NO pushUpstream
- `POST /api/orders/[id]/reopen` — reopen: NO pushUpstream
- `POST /api/orders/[id]/transfer` — transfer: NO pushUpstream
- `POST /api/orders/[id]/transfer-items` — cross-order transfers: NO pushUpstream
- `POST /api/orders/[id]/advance-course` — course advancement: NO pushUpstream
**Fix:** Add `void pushUpstream().catch(console.error)` after every DB write in these routes

### C2. Terminal Reconnect Does NOT Refetch Open Order
**Impact:** Staff sees stale "unpaid" state after brief network glitch, may attempt double-payment
**Root cause:** Socket `catch-up` replays missed events, but if terminal has an order open in the Zustand store, it doesn't call `loadOrder()` to get fresh state
**Fix:** On socket reconnect, if `useOrderStore.currentOrder.id` exists, refetch from `/api/orders/{id}` (debounced 200ms)

### C3. Item Add Dedup Race Condition Creates Duplicate Kitchen Orders
**Impact:** Rapid tap right after "Send" creates a new item instead of incrementing quantity
**Root cause:** Dedup check uses `isTempId(existing.id)` — after send, item has real ID so dedup is skipped
**Location:** `order-store.ts:~545`
**Fix:** Also check `sentToKitchen` flag timing — if item was sent in last 2 seconds, still treat as dedup candidate

### C4. Missing Socket Events for Critical State Changes
**Impact:** Other terminals/KDS never learn about these changes until page reload
**Missing events that NEED to be added:**

| Missing Event | When It Should Fire | Who Needs It |
|---|---|---|
| `order:item-voided` | Item voided/comped AFTER sent to kitchen | KDS (stop preparing), other terminals |
| `order:item-held` / `order:item-unheld` | Hold toggled | KDS (don't bump), other terminals |
| `order:reopened` | Closed order reopened | All terminals (order back in open list) |
| `order:split-created` | Split tickets created | All terminals (prevent double-split) |
| `entertainment:session-started/ended` | Timed rental state change | Floor plan (show occupied/available) |
| `menu:item-updated/deleted` | Menu item price/availability changed | All terminals (prevent stale orders) |
| `menu:modifier-updated` | Modifier changed/removed | All terminals (prevent 400 on send) |
| `menu:structure-changed` | Category/menu reorganized | All terminals (refresh menu grid) |
| `settings:changed` | Tax rate/pricing rule changed | All terminals (correct tax calc) |

### C5. Modifier Group Routes Missing ALL Notifications
**Impact:** Modifier changes are completely invisible to all other terminals AND cloud
**Routes:**
- `POST/PUT/PATCH /api/menu/items/[id]/modifier-groups` — NO socket event, NO pushUpstream
- `PUT/DELETE /api/menu/items/[id]/modifier-groups/[groupId]` — NO socket event, NO pushUpstream
- `POST/PUT/DELETE /api/menu/items/[id]/modifier-groups/[groupId]/modifiers` — NO socket event, NO pushUpstream
**Fix:** Add `dispatchMenuStructureChanged()` + `pushUpstream()` to all modifier routes

---

## PRIORITY 2: HIGH (Cross-Terminal Sync Gaps)

### H1. All Inventory Routes Dark (35 routes, zero notifications)
**Impact:** Stock adjustments, PO receiving, waste logs, prep counts — all invisible to other terminals and cloud
**Routes:** inventory/*, inventory/daily-counts/*, inventory/orders/*, inventory/prep/*, inventory/stock-adjust, inventory/waste/*
**Fix:** Add `notifyDataChanged()` + `pushUpstream()` to all inventory mutation routes

### H2. Tab Routes Missing pushUpstream
**Impact:** Tab creation and transfers don't sync to Neon — data loss risk during outage recovery
**Routes:** `POST /api/tabs`, `POST /api/tabs/[id]/transfer`
**Fix:** Add `void pushUpstream().catch(console.error)` after tab mutations

### H3. KDS Bump Routes Missing pushUpstream
**Impact:** Kitchen item completion status doesn't sync to cloud — fulfillment bridge can't track prep progress
**Routes:** `PUT /api/kds` (bump, complete, uncomplete), `PUT /api/kds/expo` (bulk complete)
**Fix:** Add `void pushUpstream().catch(console.error)` after KDS mutations

### H4. Session Lock Expires in 30 Seconds
**Impact:** Both terminals can edit same order after timeout, last write wins, items lost
**Root cause:** `order:editing` lock has 30s TTL with no heartbeat extension
**Fix:** Extend lock TTL on every user interaction; broadcast heartbeat every 10s while editing

### H5. CFD Terminal Mapping Not Pre-Warmed on Server Restart
**Impact:** After NUC restart, CFD screens show nothing until a register reconnects
**Root cause:** `cfdToRegisterMap` is in-memory only, populated on connect events
**Fix:** Rehydrate from `Terminal.cfdTerminalId` on server startup (code exists but may not be executing)

### H6. PaymentIntent Not in Outage Queue
**Impact:** During internet outage, payment intent metadata may be lost
**Fix:** Add PaymentIntent to outage queue for critical payment reconciliation

### H7. Quarantine Mode Still Log-Only (Not Blocking)
**Impact:** Money-impact sync conflicts (Order, Payment) detected but neon-wins applied regardless
**Status:** 7-day observational period started 2026-03-22 — due for review now
**Fix:** Evaluate SyncConflict logs; promote to blocking mode if no false positives

---

## PRIORITY 3: MEDIUM (Reliability & Edge Cases)

### M1. Floor Plan Only Gets Delta Updates (Totals, Not Items)
**Impact:** Floor plan shows correct total but stale item details after cross-terminal modification
**Fix:** Distinguish total-only updates from item-change updates; trigger full order reload on item changes

### M2. No Polling During Socket Drop Window (0-60s)
**Impact:** 1-minute blind spot where terminal sees nothing — socket disconnected but polling not yet active
**Fix:** Start fallback polling immediately on disconnect (not after 60s timeout)

### M3. Employee Tip Adjustments Missing Sync
**Impact:** Tip changes made on one terminal don't sync to cloud or notify others
**Routes:** `POST /api/employees/[id]/tips`
**Fix:** Add `notifyDataChanged()` + `pushUpstream()`

### M4. Shift Transfer Orders Missing pushUpstream
**Impact:** Order transfers between shifts don't sync to cloud
**Route:** `POST /api/shifts/[id]/transfer-orders`
**Fix:** Add `void pushUpstream().catch(console.error)`

### M5. Delivery Status Changes Missing pushUpstream
**Impact:** Delivery order status progression doesn't reach cloud for tracking
**Route:** Various delivery/* routes
**Fix:** Add sync calls to delivery status mutation routes

### M6. OutageQueueEntry Dead Letter Has No Auto-Reconciliation
**Impact:** Failed sync entries after 10 retries sit in DEAD_LETTER with no alert
**Fix:** Add alerting when entries hit DEAD_LETTER status; provide admin review UI

### M7. Terminal Status Dual Source of Truth
**Impact:** Both heartbeat (30s HTTP) and socket disconnect emit `terminal:status_changed`; can race
**Fix:** Unify into single status tracker; heartbeat should check socket state first

### M8. Browser Crash Can Lose Orders >100KB
**Impact:** Large orders ($500+) exceed localStorage limit and items silently dropped
**Fix:** Move pending items persistence to server-side session store

---

## PRIORITY 4: LOW (Good to Have)

### L1. Customer Mutations Missing Socket Events
**Routes:** `POST/PATCH /api/customers`, `POST /api/customers/[id]/house-account`
**Impact:** Customer data changes not real-time; low impact since rarely cross-terminal

### L2. Deduplication Window May Be Too Small
**Issue:** 200-key dedup set; >200 unique events in <500ms could cause duplicates
**Fix:** Increase MAX_DEDUP_SIZE to 500

### L3. Prep Station Changes Missing Socket Events
**Routes:** `POST/PATCH /api/prep-stations`
**Impact:** New stations won't appear on KDS until page reload

### L4. Time Clock Toggle May Miss employee:clock-changed Event
**Route:** `POST /api/time-clock/toggle`
**Impact:** Other terminals don't know employee clocked in/out

### L5. No Menu Version Locking on Orders
**Impact:** Price changes between order creation and send not detected
**Fix:** Store menuVersion with order; validate on send

---

## Architecture Overview: Data Flow Map

```
                        ┌──────────────────────┐
                        │    NEON (Cloud DB)    │
                        │  Source of Truth      │
                        │  199 models           │
                        │  51 bidirectional     │
                        └──────┬───────┬────────┘
                               │       │
                    Pull (5s)  │       │  Push (5s + instant)
                    downstream │       │  upstream
                               │       │
                        ┌──────▼───────▼────────┐
                        │   NUC LOCAL SERVER     │
                        │  PostgreSQL + Next.js  │
                        │  Socket.IO Server      │
                        │  Sync Workers          │
                        │  Event Buffer (L1+L2)  │
                        └──┬──┬──┬──┬──┬──┬─────┘
                           │  │  │  │  │  │
              Socket.IO    │  │  │  │  │  │  Socket.IO
              Events       │  │  │  │  │  │  Events
                           │  │  │  │  │  │
          ┌────────────────┘  │  │  │  │  └────────────────┐
          │           ┌───────┘  │  │  └───────┐           │
          │           │     ┌────┘  └────┐     │           │
          ▼           ▼     ▼            ▼     ▼           ▼
    ┌──────────┐ ┌────────┐ ┌──────┐ ┌──────┐ ┌────────┐ ┌─────┐
    │ POS      │ │ POS    │ │ KDS  │ │ KDS  │ │ CFD    │ │ PAX │
    │ Register │ │ Reg B  │ │ Expo │ │ Line │ │ Display│ │ Pay │
    │ (Web)    │ │ (Web)  │ │(Andr)│ │(Andr)│ │ (Web)  │ │(And)│
    └──────────┘ └────────┘ └──────┘ └──────┘ └────────┘ └─────┘

    ◄──── ALL COMMUNICATION MEDIATED BY NUC SERVER ────►
          (No direct terminal-to-terminal P2P)
```

### Data Flow: Order Creation (Happy Path)
```
Terminal A: Create order → POST /api/orders
  → DB Write (local PG) ✅
  → emitOrderEvent('ORDER_CREATED') → Socket broadcast ✅
  → pushUpstream() → Neon gets it in <5s ✅
  → dispatchNewOrder() → KDS gets kds:order-received ✅
  → Terminal B gets orders:list-changed via socket ✅
```

### Data Flow: Order Item Add (BROKEN PATH)
```
Terminal A: Add item → POST /api/orders/[id]/items
  → DB Write (local PG) ✅
  → emitOrderEvent('ITEM_ADDED') → Socket broadcast ✅
  → pushUpstream() ❌ MISSING — Neon doesn't get item changes
  → Terminal B gets event BUT doesn't auto-reload full order ❌
  → KDS gets item IF part of send, not on standalone add ⚠️
```

### Data Flow: Modifier Change (COMPLETELY BROKEN)
```
Admin: Change modifier → PUT /api/menu/items/[id]/modifier-groups/[gid]/modifiers
  → DB Write (local PG) ✅
  → Socket event ❌ MISSING — no terminal knows
  → pushUpstream() ❌ MISSING — Neon doesn't get change
  → Terminals still show old modifiers until page reload ❌
  → Orders with stale modifiers get 400 on send ❌
```

---

## Sync Engine Summary

| Direction | Models | Interval | Trigger | Status |
|---|---|---|---|---|
| NUC → Neon (upstream) | 60+ upstream, 40 bidirectional | 5s poll + instant push | `pushUpstream()` after mutation | **57% of routes missing the call** |
| Neon → NUC (downstream) | 70+ downstream, 40 bidirectional | 5s poll + cloud relay instant | `notifyDataChanged()` from cloud | Working correctly |
| Terminal → NUC | All | Real-time (HTTP + Socket) | API call + socket event | Working, but **48% of routes miss socket notify** |
| NUC → Terminal | All | Real-time (Socket) | `emitToLocation/Tags()` | Working, but **missing handlers on client** |

### lastMutatedBy Contract: VERIFIED CORRECT
All 40 bidirectional models properly set `lastMutatedBy` in their routes. No sync loop risk detected.

### Conflict Resolution: LOG-ONLY MODE
Money-impact models (Order, OrderItem, Payment) have quarantine detection but currently in `log-only` mode. Neon always wins. Should be promoted to blocking mode after review.

---

## Socket Event Coverage Summary

| Category | Events Defined | Dispatch Functions | Routes Emitting | Routes Missing |
|---|---|---|---|---|
| Order lifecycle | 10 | 12 | 27+ | ~20 item/status routes |
| KDS/Kitchen | 3 | 4 | 3 | 0 (good) |
| Payment | 3 | 3 | 4 | 0 (good) |
| Menu/Inventory | 7 | 5 | 14 | 35 (all inventory) |
| Entertainment | 4 | 4 | 4 | Client handlers missing |
| Terminal/Device | 4 | 3 | 4 | 0 |
| Delivery | 8 | 6 | 6 | 2 status routes |
| CFD | 11 | 11 | 3 | 0 |
| **Total** | **78+** | **95+** | **42+** | **201** |

---

## Client State Management Summary

| Store | Population | Refresh Mechanism | Gap |
|---|---|---|---|
| `useOrderStore` | API fetch + manual | Socket `orders:list-changed` → NO auto-reload | Stale items, modifiers, totals |
| `useFloorPlanStore` | API fetch | Socket patches total/status only | Stale item details |
| `useStockStatusStore` | Socket events | `inventory:stock-change` | Working (real-time) |
| `useAuthStore` | Login API + localStorage | None (manual logout/login) | Stale permissions if changed |
| `useSiteCartStore` | Local only | N/A | N/A (public web) |

---

## Server & Security Summary

**Authentication:** 4-source (POS cookie, cloud cookie, bearer token, internal API key) — solid
**Tenant Isolation:** Database-per-venue + tenant JWT + Prisma extension + post-query validation — excellent
**Concurrency:** Event-sourced orders prevent lost updates; FOR UPDATE on critical paths — good
**Caching:** 5-min TTL in-memory with inflight dedup (no stampede) — good
**Rate Limiting:** Per-IP + per-account login, per-socket event — adequate

**Risks:**
- Admin client can bypass tenant scoping (code review dependency)
- No PostgreSQL RLS (application-layer only)
- Multi-location invariant has no schema constraint enforcement

---

## Fix Priority Matrix

| Priority | Count | Effort | Impact |
|---|---|---|---|
| **P0 Critical** | 5 issues (C1-C5) | 2-3 days | Fixes 80% of reported terminal visibility issues |
| **P1 High** | 7 issues (H1-H7) | 2-3 days | Fixes inventory/tab/KDS sync + outage resilience |
| **P2 Medium** | 8 issues (M1-M8) | 3-4 days | Edge cases, reliability, monitoring |
| **P3 Low** | 5 issues (L1-L5) | 1-2 days | Nice-to-have improvements |

**Recommended order:** C1 → C2 → C4 → C5 → C3 → H1 → H2 → H3 → H4 → remaining

---

## Appendix: Full Agent Reports

Detailed reports from each audit agent are available at:
- DB Layer: `/private/tmp/claude-501/.../a646860b86ad39d5c.output`
- Socket/Realtime: `/private/tmp/claude-501/.../a55322ecb674633ae.output`
- Order Lifecycle: `/private/tmp/claude-501/.../af32ddef2a8fcab6d.output`
- Sync Engine: `/private/tmp/claude-501/.../a0ea4b2db6d08c3d3.output`
- API Routes: `/private/tmp/claude-501/.../a7be3d3be5749487e.output`
- Client State: `/private/tmp/claude-501/.../a095cd51973b42a17.output`
- Terminal Comms: `/private/tmp/claude-501/.../a71ce4b8f73fbeee6.output`
- Server Middleware: `/private/tmp/claude-501/.../a88d3910290a1eff4.output`
