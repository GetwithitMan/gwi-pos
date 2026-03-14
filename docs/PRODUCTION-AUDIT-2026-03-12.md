# GWI POS Production Audit Report
**Date:** 2026-03-12
**Scope:** Full-stack audit across 9 domains — 125 issues found
**Goal:** Production-ready for high-volume bar/nightclub deployment

---

## EXECUTIVE SUMMARY

9 parallel audit agents traced every code path across the entire POS system. **125 issues** found across database performance, order lifecycle, inventory tracking, payment processing, reporting accuracy, real-time sync, frontend performance, API routes, and security.

### The Big 5 — Issues That Will Sink You in Production

1. **Reports lie.** 12+ reports use different order status filters. The daily report, sales report, and product-mix report show different totals for the same day. Split orders are double-counted in 10+ reports. Revenue could be inflated 5-15%.

2. **Payments leak money.** Surcharge is hard-coded to $0 (venues using surcharge model lose on every card payment). Split-payment balance calculation includes tips, causing under-collection. Refund Datacap call inside DB transaction = money loss on timeout.

3. **The UI is slow.** Every item tap re-renders the entire POS page (30+ hooks, header, floor plan, order panel, all modals). Framer Motion wraps every menu item button. PIN login takes 1-3 seconds (O(N) bcrypt scan).

4. **Inventory is ghost.** Void/waste path skips pizza toppings and pricing-option deductions. `pay-all-splits` bypasses the deduction outbox. Two disconnected inventory systems (`MenuItem.currentStock` vs `InventoryItem.currentStock`).

5. **Security holes.** SQL injection in marketing campaigns. Unauthenticated shell execution on kiosk endpoint. Auto-provisioned PINs stored unhashed. 6+ financial endpoints missing auth.

---

## P0 — FIX BEFORE LAUNCH (22 issues)

### Money-Losing Bugs

| # | Domain | Issue | File | Impact |
|---|--------|-------|------|--------|
| 1 | Payment | Surcharge hard-coded to $0 | `PaymentModal.tsx:430` | Revenue loss on every card payment for surcharge venues |
| 2 | Payment | `alreadyPaid` includes tips in split balance calc | `pay/route.ts:799`, `payment.ts:112` | Under-collection on split tenders with tips |
| 3 | Payment | Refund Datacap call inside DB transaction | `refund-payment/route.ts:70-134` | Customer refunded at processor, DB never records it on timeout |
| 4 | Reporting | 12+ reports use different order status filters | See list below | Daily/sales/product-mix totals disagree |
| 5 | Reporting | Split-parent double-counted in 10+ reports | See list below | Revenue inflated 5-15% on split-heavy venues |
| 6 | Reporting | Soft-deleted orders not filtered in sales report | `reports/sales/route.ts` | Deleted orders counted in revenue |
| 7 | Inventory | `pay-all-splits` bypasses deduction outbox | `pay-all-splits/route.ts:276` | No retry on failed inventory deduction |
| 8 | Inventory | Void path missing pizza topping deductions | `void-waste.ts` | Ghost inventory for all pizza waste |
| 9 | Inventory | Void path missing pricingOption inventory links | `void-waste.ts` | Ghost inventory for sized items |

### Security Critical

| # | Domain | Issue | File | Impact |
|---|--------|-------|------|--------|
| 10 | Security | SQL injection in marketing campaign send | `marketing/campaigns/[id]/send/route.ts:115` | Arbitrary SQL execution via crafted customer email |
| 11 | Security | Auto-provisioned PINs stored unhashed | `api-auth.ts:99-117`, `venue-login/route.ts:137` | Raw PIN visible in DB + will never match bcrypt login |
| 12 | Security | Unauthenticated shell execution (exit-kiosk) | `system/exit-kiosk/route.ts:15` | Anyone on network can stop kiosk service |

### Performance Killers

| # | Domain | Issue | File | Impact |
|---|--------|-------|------|--------|
| 13 | API | `requirePermission()` hits DB on every request (527 call sites) | `api-auth.ts:187` | 5-15ms wasted per API call |
| 14 | API | PIN login O(N) sequential bcrypt (30 employees = 3s) | `auth/login/route.ts:42-61` | Login takes 1-3 seconds |
| 15 | API | PIN verify fallback also O(N) bcrypt | `auth/verify-pin/route.ts:215` | Manager override takes 1-3 seconds |
| 16 | Frontend | `currentOrder` selector returns entire object | `orders/page.tsx:68` + 4 more files | Every item tap re-renders entire POS |
| 17 | Frontend | Framer Motion `motion.button` on every menu item | `FloorPlanMenuItem.tsx:66-81` | 30-50 animation controllers on most-tapped surface |
| 18 | DB | N+1: host tables fires raw SQL per occupied table | `host/tables/route.ts:50-68` | 30 queries where 1 suffices |
| 19 | DB | N+1: batch tip adjustment sequential order fetch | `batch-adjust-tips/route.ts:70-78` | 80 queries where 1 suffices |
| 20 | DB | Open orders full mode unbounded + no pagination | `orders/open/route.ts:320-386` | 100KB+ payload, 200-500ms |
| 21 | DB | Sync bootstrap 4-level nested include, no cache | `sync/bootstrap/route.ts:23-92` | 500-2000ms per Android device startup |
| 22 | API | Tax rules + categories uncached, queried every mutation | `orders/route.ts:419-428` | 2 extra DB queries per order create/item add |

#### Reports Status Filter Reference (Issue #4)
All must use `['completed', 'closed', 'paid']`:
- `reports/sales/route.ts:83` — missing `closed`
- `reports/employees/route.ts:61` — missing `closed`
- `reports/product-mix/route.ts:60` — missing `completed`
- `reports/hourly/route.ts:92` — missing `completed`
- `reports/daypart/route.ts:88` — only `paid`
- `reports/server-performance/route.ts:47` — only `paid`
- `reports/food-cost/route.ts:52` — missing `completed`
- `reports/labor/route.ts:292` — missing `closed`
- `reports/labor-cost/route.ts:57,120` — missing `closed`
- `reports/commission/route.ts:75` — missing `closed`
- `reports/payroll/route.ts:253` — missing `closed`

#### Reports Split Exclusion Reference (Issue #5)
All need `NOT: { splitOrders: { some: {} } }`:
- `reports/product-mix/route.ts`
- `reports/employees/route.ts`
- `reports/server-performance/route.ts`
- `reports/hourly/route.ts`
- `reports/daypart/route.ts`
- `reports/food-cost/route.ts`
- `reports/commission/route.ts`
- `reports/labor-cost/route.ts`
- `reports/tips/route.ts`
- `reports/discounts/route.ts`
- `dashboard/live/route.ts`
- `lib/accounting/daily-journal.ts`

---

## P1 — FIX FIRST WEEK (33 issues)

### Data Integrity

| # | Domain | Issue | File |
|---|--------|-------|------|
| 23 | Order | `itemCount` includes deleted/voided items | `orders/[id]/items/route.ts:750-799` |
| 24 | Order | Item quantity change uses stale `modifierTotal` | `orders/[id]/items/[itemId]/route.ts:217` |
| 25 | Order | Discount DELETE missing `FOR UPDATE` lock | `orders/[id]/discount/route.ts:617-704` |
| 26 | Order | Item-level discount no concurrency protection | `orders/[id]/items/[itemId]/discount/route.ts` |
| 27 | Inventory | Spirit substitution reads wrong model on void | `void-waste.ts:656` |
| 28 | Inventory | `restoreInventoryForRestoredItem` TOCTOU race | `void-waste.ts:22-82` |
| 29 | Inventory | Dual inventory systems disconnected | `api/inventory/route.ts` vs `order-deduction.ts` |
| 30 | Payment | Tip adjust cap at 100% (should be 500%) | `adjust-tip/route.ts:94-101` |
| 31 | Payment | 10+ sequential queries in pay transaction | `pay/route.ts:370-1729` |

### Security HIGH

| # | Domain | Issue | File |
|---|--------|-------|------|
| 32 | Security | 3 cron routes missing CRON_SECRET auth | `cron/process-scheduled-orders`, `expire-shared-reports`, `invoice-overdue` |
| 33 | Security | Saved card endpoints missing auth | `customers/[id]/saved-cards/route.ts` |
| 34 | Security | House account payment no auth | `orders/[id]/add-ha-payment/route.ts` |
| 35 | Security | Venue login no rate limiting | `auth/venue-login/route.ts` |
| 36 | Security | Forgot/reset password no rate limiting | `auth/forgot-password`, `auth/reset-password` |
| 37 | Security | Hardcoded HMAC fallback secret | `marketing/campaigns/[id]/send/route.ts:259` |

### Reporting Accuracy

| # | Domain | Issue | File |
|---|--------|-------|------|
| 38 | Reporting | Void report timezone bug (server-local, not business day) | `reports/voids/route.ts:32-34` |
| 39 | Reporting | Order history uses UTC dates | `reports/order-history/route.ts:41-46` |
| 40 | Reporting | 8+ reports group by UTC date, not business day | See list below |
| 41 | Reporting | Employee/sales hourly uses `getHours()` not timezone-aware | `reports/employees/route.ts:223` |
| 42 | Reporting | Accounting journal comps vs voids conflated | `lib/accounting/daily-journal.ts:275-284` |
| 43 | Reporting | Accounting journal payment/revenue date mismatch | `lib/accounting/daily-journal.ts:137-155` |
| 44 | Reporting | Dashboard discount aggregate missing status filter | `dashboard/live/route.ts:140-150` |
| 45 | Reporting | Discount report missing order status filter | `reports/discounts/route.ts:43-50` |

### Real-time/Sync

| # | Domain | Issue | File |
|---|--------|-------|------|
| 46 | Sync | ws-server.ts no auth middleware | `ws-server.ts:101-260` |
| 47 | Sync | ws-server.ts tags not location-scoped | `ws-server.ts:127-129` |
| 48 | Sync | No client-side event deduplication | `socket-provider.ts:144-170` |
| 49 | Sync | Catch-up replay floods client (no throttle) | `socket-server.ts:425-452` |

### Performance

| # | Domain | Issue | File |
|---|--------|-------|------|
| 50 | DB | Closed orders over-fetches Payment (40+ fields) | `orders/closed/route.ts:101-120` |
| 51 | DB | Order PUT fetches full Location + items for metadata | `orders/[id]/route.ts:363-369` |
| 52 | DB | Payment sync 3 redundant queries | `payments/sync/route.ts:92-199` |
| 53 | API | Sync bootstrap BFS loop sequential queries | `sync/bootstrap/route.ts:137-156` |
| 54 | API | Order GET double-fetch (auth then full) | `orders/[id]/route.ts:27-33` |
| 55 | API | Audit log `await`-ed on order creation critical path | `orders/route.ts:618` |

#### UTC Grouping Reference (Issue #40)
All use `.toISOString().split('T')[0]` instead of business-day-aware grouping:
- `reports/discounts/route.ts:284`
- `reports/employees/route.ts:243`
- `reports/speed-of-service/route.ts:150`
- `reports/labor/route.ts:181,191,227`
- `reports/forecasting/route.ts:101`
- `reports/payroll/route.ts:279`
- `reports/reservation-deposits/route.ts:110`

---

## P2 — FIX FIRST MONTH (38 issues)

### Frontend Performance

| # | Domain | Issue | File |
|---|--------|-------|------|
| 56 | Frontend | `motion.button` on every category tab | `CategoriesBar.tsx:38-69` |
| 57 | Frontend | SharedOrderPanel inline callbacks defeat memo | `SharedOrderPanel.tsx:246-265` |
| 58 | Frontend | OrderPanelItem 58 inline style objects per render | `OrderPanelItem.tsx:208-300` |
| 59 | Frontend | `useOrderSettings` + `usePOSDisplay` duplicate fetch | `useOrderSettings.ts:236`, `usePOSDisplay.ts:43` |
| 60 | Frontend | `useOrderPanelItems` O(n*m) `.find()` loop | `useOrderPanelItems.ts:18` |
| 61 | Frontend | TabsPanel no debounce on socket events | `TabsPanel.tsx:89-98` |
| 62 | Frontend | Tabs page `filteredTabs` not memoized | `tabs/page.tsx:118-157` |
| 63 | Frontend | `AnimatePresence` on tabs list (50+ items) | `tabs/page.tsx:317-375` |
| 64 | Frontend | `persistPendingItems` localStorage write on every mutation | `order-store.ts:536-593` |
| 65 | Frontend | FloorPlanMenuItem inline mouse handlers | `FloorPlanMenuItem.tsx:101-116` |
| 66 | Frontend | `useMenuCategories` double filter not memoized | `useMenuCategories.ts:95-100` |

### Database/API

| # | Domain | Issue | File |
|---|--------|-------|------|
| 67 | DB | Sync delta unbounded order fetch | `sync/delta/route.ts:47` |
| 68 | DB | Order PUT response returns all items after metadata update | `orders/[id]/route.ts:486-500` |
| 69 | DB | Missing index on `OrderItemModifier [orderItemId, deletedAt]` | Prisma schema |
| 70 | API | Order creation items POST 6 sequential pre-checks | `orders/[id]/items/route.ts:211-267` |
| 71 | API | Discount POST re-fetches settings after transaction | `orders/[id]/discount/route.ts:515-518` |
| 72 | API | KDS entertainment expiry inline with GET poll | `kds/route.ts:34-67` |
| 73 | API | 63+ `console.error/warn` on hot paths | 30+ API route files |
| 74 | API | No response compression configured | `server.ts` / `next.config.ts` |
| 75 | API | Stock status uncached on menu load | `stock-status.ts:127-163` |
| 76 | API | No HTTP cache headers for static-ish endpoints | `next.config.ts` |

### Reporting

| # | Domain | Issue | File |
|---|--------|-------|------|
| 77 | Reporting | Cash liabilities all-time paid in/out (no date filter) | `reports/cash-liabilities/route.ts:23-26` |
| 78 | Reporting | Server performance uses `total` not `subtotal` for sales | `reports/server-performance/route.ts:100` |
| 79 | Reporting | Daypart uses only `paid` + `subtotal` as revenue | `reports/daypart/route.ts:88,120` |
| 80 | Reporting | Tips report `dayStartTime` access without default | `reports/tips/route.ts:42` |

### Sync/Real-time

| # | Domain | Issue | File |
|---|--------|-------|------|
| 81 | Sync | Pay route emits 7-8 socket events per payment | `pay/route.ts:1922-2218` |
| 82 | Sync | Event buffer `Array.shift()` is O(n) | `socket-event-buffer.ts:52` |
| 83 | Sync | Upstream sync row-by-row `syncedAt` stamping | `upstream-sync-worker.ts:212-226` |

### Payment

| # | Domain | Issue | File |
|---|--------|-------|------|
| 84 | Payment | 3 duplicate order fetches on modal open | `PaymentModal.tsx:251-344` |
| 85 | Payment | Dual pricing mismatch only warns, never rejects | `pay/route.ts:1081-1084` |
| 86 | Payment | Missing `terminalId` in buildPayBody | `PaymentModal.tsx:821-852` |

### Inventory

| # | Domain | Issue | File |
|---|--------|-------|------|
| 87 | Inventory | `trackInventory` flag never checked during deduction | `order-deduction.ts` |
| 88 | Inventory | Inventory count "reviewed" not in transaction | `inventory/counts/[id]/route.ts:192-226` |
| 89 | Inventory | Comp items deducted as "waste" in audit trail | `orders/[id]/comp-void/route.ts:762` |

### Security MEDIUM

| # | Domain | Issue | File |
|---|--------|-------|------|
| 90 | Security | Deprovision SQL uses string interpolation (mitigated by regex) | `internal/deprovision/route.ts:59` |
| 91 | Security | Trigger-sync localhost bypass spoofable via X-Forwarded-For | `internal/trigger-sync/route.ts:8-13` |
| 92 | Security | Socket.io CORS wildcard in non-production | `socket-server.ts:159-170` |
| 93 | Security | Waitlist/delivery routes missing auth | `waitlist/[id]`, `delivery/`, `delivery/[id]` |

### Order Lifecycle

| # | Domain | Issue | File |
|---|--------|-------|------|
| 94 | Order | Even split penny loss (Math.floor rounding) | `orders/[id]/split/route.ts:213` |
| 95 | Order | Dual pricing panel ignores tax-inclusive items | `orders/[id]/route.ts:146-165` |

---

## P3 — POLISH / HARDENING (32 issues)

| # | Domain | Issue | File |
|---|--------|-------|------|
| 96 | Order | Order creation subtotal floating point accumulation | `orders/route.ts:289-310` |
| 97 | Sync | Downstream sync no batching (row-by-row) | `downstream-sync-worker.ts:225-351` |
| 98 | Sync | No server-side socket event rate limiting | `socket-server.ts` |
| 99 | Sync | `connectedTerminals` Map unbounded | `socket-server.ts:64` |
| 100 | Sync | Tab close via internal loopback HTTP | `socket-server.ts:510-539` |
| 101 | DB | Multi-tenant venue client pool (25 * 50 = 1250 connections) | `db.ts:148,166-188` |
| 102 | DB | KDS expiry query no limit | `kds/route.ts:34` |
| 103 | DB | Soft-delete middleware overhead on every query | `db.ts:55-131` |
| 104 | DB | Menu cache only on session bootstrap, not sync | `session/bootstrap` vs `sync/bootstrap` |
| 105 | API | `withTiming` creates objects on every request | `with-timing.ts` |
| 106 | API | Webhook endpoints load all locations uncached | `webhooks/7shifts/route.ts` |
| 107 | API | `orders/open` computes `ageMinutes` server-side | `orders/open/route.ts:235,468` |
| 108 | API | 2 public endpoints missing rate limiting | `public/resolve-order-code`, `public/unsubscribe` |
| 109 | API | Order PUT up to 4 cascading auth queries | `orders/[id]/route.ts:377-393` |
| 110 | Inventory | Prep stock TOCTOU on before/after values | `prep-stock.ts:229-250` |
| 111 | Inventory | No idempotency guard inside `deductInventoryForOrder` | `order-deduction.ts` |
| 112 | Inventory | Legacy `/api/inventory` POST not transactional | `inventory/route.ts:128-154` |
| 113 | Frontend | `computeTotals` runs sync on every mutation (acceptable) | `order-store.ts:329-361` |
| 114 | Reporting | Sales report floating point accumulation in-memory | `reports/sales/route.ts:143-210` |
| 115 | Reporting | Sales report loads all orders into memory (no limit) | `reports/sales/route.ts:78` |
| 116 | Security | Session secret auto-gen without production warning | `auth-session.ts:38-48` |
| 117 | Security | Math.random() for PIN generation | `api-auth.ts:103` |
| 118 | Security | Deprovision error leaks internal details | `internal/deprovision/route.ts:66` |
| 119 | Security | Missing Content-Security-Policy header | `next.config.ts` |
| 120 | Security | Multiple report/tip routes missing auth | `reports/delivery`, `upsell-analytics`, `vendor-comparison`, `tips/my-shift-summary`, `tips/groups` |
| 121 | Security | Item price not validated as non-negative | `orders/[id]/items/route.ts:269-282` |
| 122 | Reporting | Daily report businessDayDate vs timestamp comparison fragile | `reports/daily/route.ts:122-125` |
| 123 | Payment | Cash change uses Math.round (not banker's rounding) | `payment.ts:19` |
| 124 | DB | Order creation tax rules uncached | `orders/route.ts:419-428` |
| 125 | Sync | Event buffer location-level isolate only (no per-room) | `socket-event-buffer.ts` |

---

## RECOMMENDED FIX ORDER

### Sprint 1: Money & Security (Issues 1-12)
**Goal:** Stop losing money and close security holes.

1. Extract `REVENUE_ORDER_STATUSES = ['completed', 'closed', 'paid']` constant, apply to all 12+ reports
2. Add split-parent exclusion (`NOT: { splitOrders: { some: {} } }`) to all 12 reports
3. Fix `alreadyPaid` to use `p.amount` not `p.totalAmount` in pay route + `payment.ts`
4. Implement surcharge calculation in PaymentModal (replace hard-coded $0)
5. Restructure refund-payment to 3-phase pattern (read-lock, Datacap, write-lock)
6. Fix SQL injection in marketing campaign send (use parameterized queries)
7. Hash auto-provisioned PINs with bcrypt
8. Add auth to exit-kiosk, cron routes, saved-cards, house-account
9. Add rate limiting to venue-login and password reset

### Sprint 2: Performance (Issues 13-22)
**Goal:** Make the POS instant.

1. Add in-memory cache to `requirePermission()` (TTL 60s) — affects 527 call sites
2. Add PIN fingerprint for fast PIN lookup (eliminate O(N) bcrypt scan)
3. Replace `useOrderStore(s => s.currentOrder)` with granular field selectors
4. Replace Framer Motion `motion.button` with CSS transitions on menu grid
5. Add menu cache to sync/bootstrap (match session/bootstrap pattern)
6. Fix N+1 in host/tables (batch SQL) and batch-adjust-tips (findMany)
7. Add pagination/limit to open orders full mode and sync/delta
8. Cache tax rules and categories (TTL 5min)
9. Fire-and-forget audit log on order creation

### Sprint 3: Data Integrity (Issues 23-55)
**Goal:** Every number is correct.

1. Fix void/waste path: add pizza toppings, pricingOption links, correct spirit model
2. Route `pay-all-splits` through `PendingDeduction` outbox
3. Fix all UTC date grouping in reports (use `getBusinessDateForTimestamp`)
4. Add `FOR UPDATE` to discount DELETE and item-level discount routes
5. Fix accounting journal comps/voids distinction and payment date alignment
6. Add client-side socket event deduplication
7. Throttle catch-up replay on reconnection

### Sprint 4: Polish (Issues 56-125)
**Goal:** Production-grade polish.

1. Frontend memoization sweep (inline callbacks, styles, filters)
2. Debounce localStorage persistence
3. Remove `AnimatePresence` from tabs list
4. Add response compression
5. Batch upstream sync `syncedAt` stamping
6. Add missing auth to remaining endpoints
7. Add Content-Security-Policy header

---

## WHAT'S ALREADY SOLID

The audit confirmed many things are well-built:

- **Payment idempotency**: Multi-layered (client key, RecordNo dedup, FOR UPDATE lock)
- **Auto-void safety net**: Card charged but DB fails = automatic void
- **Tab close 3-phase locking**: `tabStatus: 'closing'` sentinel + zombie recovery
- **Order state machine**: Explicit valid transitions, terminal states enforced
- **Server-side price validation**: Menu item prices verified, not trusted from client
- **QoS 1 for financial events**: Acknowledged delivery with retry for payments/closes
- **Outage queue with FIFO replay**: No data loss during Neon outages
- **Fulfillment bridge lease-based failover**: No split-brain hardware dispatch
- **Zustand atomic selectors** (in most places): Granular store subscriptions
- **Shared socket singleton**: One WebSocket per tab with ref counting
- **Offline payment recovery**: IndexedDB persistence + exponential backoff + SAF
- **Bidirectional sync conflict resolution**: `lastMutatedBy` with NTP drift tolerance
