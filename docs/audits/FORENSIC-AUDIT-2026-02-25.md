# GWI POS — Full-System Forensic Audit Report
**Date:** 2026-02-25
**Scope:** 434 API routes, 6736-line Prisma schema, Socket.io, React/UI, infrastructure, business logic, code quality
**Auditors:** 7 parallel deep-dive agents (6/7 reported)

---

## Executive Summary

| Domain | Critical | High | Medium | Low | Total |
|--------|----------|------|--------|-----|-------|
| API Routes & Security | 4 | 9 | 7 | 4 | 24 |
| Prisma Schema | 5 | 4 | 7 | 4 | 20 |
| Socket.io & Real-Time | 2 | 3 | 4 | 6 | 15 |
| React & UI | 7 | 11 | 12 | 8 | 38 |
| Infrastructure | 2 | 7 | 7 | 6 | 22 |
| Business Logic & Financial | 2 | 7 | 6 | 7 | 22 |
| **TOTAL** | **22** | **41** | **43** | **35** | **141** |

---

## CRITICAL Issues (22 — Fix Before Go-Live)

### FINANCIAL — Money Loss / Data Corruption

**C-FIN-1. House Account Balance Race — Concurrent Payments Lose Money**
`src/app/api/orders/[id]/pay/route.ts:850-898`
`newBalance` computed BEFORE transaction from stale read, then committed as direct SET. Two concurrent requests both read `$40`, both compute `$55`, one overwrites the other. Net: one payment "forgotten." Also, credit limit check is outside the transaction.
**Fix:** Use `currentBalance: { increment: paymentAmount }` inside transaction. Move credit limit check inside with lock.

**C-FIN-2. Double-Refund on Partial Item Void with Split Payments**
`src/app/api/orders/[id]/comp-void/route.ts:398-448`
When voiding an item on an order with multiple card payments, the code loops through ALL reversible payments and refunds `itemTotal` from EACH one. Two card swipes = item refunded twice = direct financial loss.
**Fix:** Refund proportionally across payments, or to single designated payment. Cap at original payment amount.

### API SECURITY — Auth Bypasses

**C-API-1. `cache-invalidate/route.ts` — ZERO AUTH, NO `withVenue()`**
Anyone can invalidate all caches and trigger socket broadcasts to every POS terminal.

**C-API-2. `settings/route.ts` PUT — Auth bypass by omitting `employeeId`**
`if (employeeId) { requirePermission(...) }` — omit param, skip all auth. Tax rates, payment settings, security config all modifiable.

**C-API-3. `employees/[id]/route.ts` DELETE — Auth bypass by omitting `locationId`**
Same conditional pattern. Anyone can deactivate any employee.

**C-API-4. `inventory/stock-adjust/route.ts` POST — Auth bypass by omitting `employeeId`**
Same pattern. Anyone can falsify inventory levels.

### SOCKET — Features Completely Broken

**C-SOCK-1. Scale Feature Broken — Wrong Socket Event Name**
`src/hooks/useScale.ts:65` — calls `socket.emit('join', ...)` but server only handles `'subscribe'`. Scale room is NEVER joined. Weight events never received. Entire scale feature (real-time weight, tare, stable detection) is non-functional.
**Fix:** Change `'join'` → `'subscribe'` and `'leave'` → `'unsubscribe'`.

**C-SOCK-2. Customer-Facing Display (CFD) Broken — Never Joins Location Room**
`src/app/(cfd)/cfd/page.tsx:50-54` — calls `socket.emit('join', 'cfd:${terminalId}')` which is a no-op (server has no 'join' handler, 'cfd:' not in ALLOWED_ROOM_PREFIXES). CFD never joins location room. ALL CFD events (show order, payment started, tip prompt) dispatched via `emitToLocation()` are never received. CFD display is non-functional on standalone devices.
**Fix:** Emit `socket.emit('subscribe', 'location:${locationId}')` on connect.

### SCHEMA — Data Integrity

**C-SCHEMA-1. 25+ FK Fields Stored as Bare String — No PostgreSQL Enforcement**
Models: TimedSession, AuditLog, InventoryTransaction, StockAlert, Break, SpiritUpsellEvent, DigitalReceipt, WalkoutRetry, ChargebackCase, TipDebt, TipGroup, Order (reopenedBy/walkoutMarkedBy), OrderItem (addedByEmployeeId), VoidLog, Event, CouponRedemption, HouseAccountTransaction, GiftCardTransaction, GiftCard, RefundLog, PerformanceLog, InventoryCount (3 fields), WasteLogEntry, Invoice.

**C-SCHEMA-2. 14 Models Missing `updatedAt @updatedAt`**
TipGroupSegment, TipTransaction, TipLedgerEntry, TipAdjustment, CashTipDeclaration, OrderOwnershipEntry, PaymentReaderLog, InventoryItemTransaction, DailyPrepCountTransaction, SyncAuditEntry, CloudEventQueue, HealthCheck, PerformanceLog, MobileSession.

**C-SCHEMA-3. `Order.orderNumber` @@unique Constraint REMOVED**
TODO comment says "Re-add after cleaning duplicates." Duplicates break receipts, KDS, find-by-number.

**C-SCHEMA-4. `OrderOwnershipEntry.sharePercent` Uses `Float` for Tip Math**
IEEE 754 binary float — 50.0 might store as 49.999999. Drives tip distribution. Must be Decimal.

**C-SCHEMA-5. `CloudEventQueue` Missing Critical Fields**
No status, maxAttempts, lastError, updatedAt, deletedAt, syncedAt. Uses uuid() not cuid().

### INFRASTRUCTURE

**C-INFRA-1. `vercel-build.js:123` — `prisma db push --accept-data-loss` Every Production Deploy**
One renamed column silently wipes data across all venues. Single highest-risk line in codebase.

**C-INFRA-2. `server.ts` — Zero Signal Handlers**
No SIGTERM/SIGINT. No unhandledRejection. Process kill = abandoned transactions, dangling connections, lost events.

### REACT

**C-REACT-1. KDS `loadOrders` Missing from Polling Effect Deps** (`kds/page.tsx:345`)
**C-REACT-2. KDS Debounce Ref Created Inside Effect** (`kds/page.tsx:290`)
**C-REACT-3. Entertainment KDS Stale Closures in Socket Handlers** (`entertainment/page.tsx:118`)
**C-REACT-4. IngredientLibrary Infinite Re-Render Loop Risk** (`IngredientLibrary.tsx:252`)

---

## HIGH Issues (41 — Fix Next Sprint)

### Financial / Business Logic (7)

| # | File | Issue |
|---|------|-------|
| H-FIN-1 | `order-deduction.ts:16` | Inventory deducted for voided items — `status: 'active'` filter missing. Double-deduction for prepared-then-voided items |
| H-FIN-2 | `pay/route.ts:758` | Gift card balance can go negative — no `>= 0` check, SET not decrement, TOCTOU |
| H-FIN-3 | `pay/route.ts:668` | Loyalty points TOCTOU — concurrent redemptions bypass balance check |
| H-FIN-4 | `pay/route.ts:305` | Entertainment per-minute billing: tax NOT recalculated after price settlement. Customer undercharged on tax |
| H-FIN-5 | `pay/route.ts:305` | Entertainment settlement happens OUTSIDE payment transaction — race condition |
| H-FIN-6 | `comp-void/route.ts:418` | Partial refund not bounded by original payment amount |
| H-FIN-7 | `comp-void/route.ts:330` | Comp/void recalculation doesn't handle tax-inclusive pricing |

### API — Missing Auth (8 routes fully open)

| Route | Exposes |
|-------|---------|
| `orders/route.ts` GET | Full order history with items, modifiers, payments |
| `orders/route.ts` POST | Order creation attributed to any employee |
| `orders/[id]/route.ts` GET/PUT/PATCH | Order details; PUT allows setting status to "paid" directly |
| `orders/closed/route.ts` GET | Closed order history with payments and tips |
| `employees/route.ts` GET | Employee list with hourlyRate, email, phone, permissions |
| `employees/[id]/route.ts` GET | Individual employee with role permissions |
| `session/bootstrap/route.ts` GET | Entire POS payload (menu, floor plan, shifts) |
| `menu/categories/route.ts` POST | Category creation without auth |

### API — Data Integrity

| # | File | Issue |
|---|------|-------|
| H-API-1 | `refund-payment/route.ts:76` | Manager lookup missing `locationId` — cross-venue manager could authorize |
| H-API-2 | `orders/[id]/route.ts` PUT | Status field accepted with no transition validation — can set "paid" directly |

### Socket (3)

| # | File | Issue |
|---|------|-------|
| H-SOCK-1 | `DatacapPaymentProcessor.tsx:116` | `getSharedSocket()` without `releaseSharedSocket()` — ref count leak. Every payment leaks one reference |
| H-SOCK-2 | `socket-server.ts:289` | `order:editing` relay uses client-provided `locationId` — cross-venue injection |
| H-SOCK-3 | `socket-server.ts:353` | `terminal_message` no locationId check, no event whitelist — can target any terminal |

### Schema (4)

| # | Issue |
|---|-------|
| H-SCHEMA-1 | 10+ FK fields missing indexes (SyncAuditEntry.paymentId, DigitalReceipt.paymentId, WalkoutRetry.orderId, ChargebackCase, TipDebt, TimedSession, OrderItemDiscount, OrderItemIngredient) |
| H-SCHEMA-2 | 24 String status fields need Prisma enums (Order.status, Payment.status, OrderItem.kitchenStatus, etc.) |
| H-SCHEMA-3 | Tip system uses `Int` cents while rest uses `Decimal` — off-by-100x at integration boundaries |
| H-SCHEMA-4 | `TipAdjustment.contextJson` is `String` not `Json` type |

### Infrastructure (7)

| # | File | Issue |
|---|------|-------|
| H-INFRA-1 | `socket-server.ts:353` | `terminal_message` no authorization |
| H-INFRA-2 | `socket-server.ts:289` | `order:editing` trusts client locationId |
| H-INFRA-3 | `db.ts` | Venue client Map no eviction — unbounded memory |
| H-INFRA-4 | `next.config.ts` | Zero security headers (no CSP, HSTS, X-Frame-Options) |
| H-INFRA-5 | `socket-server.ts:75` | ALLOWED_ORIGINS undefined = CORS unrestricted in prod |
| H-INFRA-6 | `db.ts:272` | DATABASE_URL! no startup validation |
| H-INFRA-7 | `next.config.ts:22` | BACKOFFICE_API_URL rewrite proxy no URL validation |

### React (11)

| # | File | Issue |
|---|------|-------|
| H-REACT-1 | `pay-at-table/page.tsx:53` | Socket effect reconnects on every state change (too many deps) |
| H-REACT-2 | `orders/page.tsx` | 3 ESLint exhaustive-deps rules disabled without comments |
| H-REACT-3 | `menu/page.tsx:343` | Socket stale callbacks on location change |
| H-REACT-4 | `menu/page.tsx:637` | Inline onClick in .map() with no React.memo |
| H-REACT-5 | 3 files | Monolithic components: orders (3,824 lines), IngredientLibrary (1,452), menu (1,166) |
| H-REACT-6 | `IngredientLibrary.tsx` | No AbortSignal on async fetches — state after unmount |
| H-REACT-7 | `LiquorModifiers.tsx:66` | 3-fetch cascade for single add |
| H-REACT-8 | Multiple | No React error boundaries on any major page |
| H-REACT-9 | `IngredientLibrary.tsx:450` | No loading state during restore op — double-click risk |
| H-REACT-10 | `LiquorModifiers.tsx:36` | loadGroups not in useEffect dep array |
| H-REACT-11 | `PropertiesSidebar.tsx:108` | Delete timeout not cleaned on unmount |

---

## MEDIUM Issues (43 — Scheduled Cleanup)

### Business Logic (6)
- Cash rounding wrong with mixed loyalty/gift card + cash (pay/route.ts:574)
- Tips silently dropped if order has no assigned employee (pay/route.ts:1185)
- Tip-out total can exceed gross tips — negative net tips (shifts/[id]/route.ts:233)
- Inventory transaction logs have stale quantity snapshots (order-deduction.ts:639)
- Sales-by-category reports don't include modifier prices (reports/daily:337)
- Item restore (un-void) has no transaction or row lock (comp-void/route.ts:654)

### Socket (4)
- `dashboard/page.tsx:335` — `socket.off('connect')` removes ALL consumers' connect handlers
- CORS undefined in prod if ALLOWED_ORIGINS unset (socket-server.ts:75)
- `emitToTags` without locationId uses unscoped room names (socket-server.ts:471)
- IPC tags path doesn't include scoped room names (socket-server.ts:476)

### API (7)
- Missing `deletedAt: null` on orders GET, categories in daily report
- 9 unbounded findMany queries in daily report
- EOD reset GET no auth
- Void approval request POST no permission check
- Stock adjust PATCH missing locationId on ingredient
- Employee stats lack locationId filter
- Order PUT no status transition validation

### Schema (7)
- 7 redundant single-column indexes (extra write overhead)
- 11 missing compound indexes
- TipLedger employeeId @unique should be @@unique([locationId, employeeId])
- Float for floor plan measurements
- JSON arrays for printerIds (no FK enforcement)
- PrepItem duplicates daily count fields
- SyncAuditEntry missing updatedAt

### Infrastructure (7)
- Installer default VNC password `123`
- NUC trust path trusts any source IP
- `__default__` cache key cross-tenant risk
- Menu cache no max size
- No production source maps
- No rate limiting on auth endpoints
- Installer .env unquoted values

### React (12)
- FloorPlanTable seatInfoList without useMemo
- OrbitalSeats not memoized
- KDS inline handlers in orders map
- Pay-at-table no error display
- Clock timer state-after-unmount
- Modal manual focus trap fragility
- Ingredients page returns null not skeleton
- CategoryModal no save error state
- useCallback with unstable Set dep
- KDS/crew large components
- PropertiesSidebar setTimeout leak
- Toast store stale timeout

---

## LOW Issues (35 — Nice-to-Have)

### Business Logic (7)
- $0 order with prior partial payment may not auto-close
- Labor cost doesn't include overtime multipliers
- TOCTOU between open order check and shift close
- Float precision in void approval threshold
- Tip-out penny remainder always to first recipient (non-deterministic)
- Commission includes voided items
- Module-level totals cache not venue-scoped

### Socket (6)
- useScale connected state reflects socket not scale device
- Dead `socket.emit('join')` code in CFD
- `socket-provider.ts` emit() hangs indefinitely
- TerminalId not persisted in sessionStorage
- `sync_completed` snake_case naming inconsistency
- Entertainment KDS fallback terminalId collision

### API (4)
- N+1 writes in stock adjustment loop
- Report error leaks Prisma internals
- Health endpoint leaks server info
- `$executeRawUnsafe` for CREATE DATABASE

### Schema (4)
- currentStock Decimal vs Int inconsistency
- Missing PMIX compound index on OrderItem
- IngredientRecipe allows self-referential cycles
- Redundant Coupon index

### Infrastructure (6)
- EOD setTimeout no .unref()
- Stale "Node 20" comment
- Master client not cached in globalThis in prod
- GitHub repo URL publicly disclosed in installer
- Standalone output unused on NUC
- db:backup/db:restore scripts referenced but don't exist

### React (8)
- TipPromptSelector input no label
- WaitlistPanel div onClick no keyboard
- Entertainment buttons missing aria-label
- Delete confirm not communicated
- Missing aria-busy during async
- Decorative SVGs not aria-hidden
- Inconsistent error messages
- No disabled state on buttons during async

---

## Recommended Fix Phases

### Phase 1: MONEY + SECURITY (Week 1)
*Prevents financial loss and unauthorized access*
1. Fix house account SET→INCREMENT race (C-FIN-1)
2. Fix double-refund on split payment voids (C-FIN-2)
3. Fix 3 conditional auth bypasses (C-API-2, C-API-3, C-API-4)
4. Add auth to cache-invalidate (C-API-1)
5. Add requirePermission to 8 open routes
6. Fix socket order:editing locationId spoofing (H-SOCK-2)
7. Fix terminal_message authorization (H-SOCK-3)
8. Switch vercel-build from db push to migrate deploy (C-INFRA-1)
9. Add SIGTERM/SIGINT handlers (C-INFRA-2)
10. Fix inventory voided item double-deduction (H-FIN-1)

### Phase 2: DATA INTEGRITY (Week 2)
*Prevents data corruption and feature breakage*
11. Fix scale socket event name (C-SOCK-1)
12. Fix CFD location room join (C-SOCK-2)
13. Fix gift card negative balance + TOCTOU (H-FIN-2)
14. Fix loyalty points TOCTOU (H-FIN-3)
15. Fix entertainment tax recalculation (H-FIN-4)
16. Fix entertainment settlement race (H-FIN-5)
17. Add @relation to 25+ bare string FKs (C-SCHEMA-1)
18. Add updatedAt to 14 models (C-SCHEMA-2)
19. Restore orderNumber unique constraint (C-SCHEMA-3)
20. Fix sharePercent Float→Decimal (C-SCHEMA-4)

### Phase 3: PERFORMANCE + HARDENING (Week 3)
*Prevents degradation under load*
21. Add 11 missing compound indexes
22. Add PrismaClient LRU cache with eviction
23. Fix KDS loadOrders deps and debounce ref
24. Add React.memo to list items
25. Fix IngredientLibrary infinite re-render
26. Add security headers
27. Fix socket CORS
28. Add rate limiting to auth
29. Fix DatacapPaymentProcessor ref count leak
30. Add error boundaries

### Phase 4: POLISH (Week 4)
31. Create Prisma enums for 24 status fields
32. Unify tip Int cents → Decimal
33. Add AbortController to async fetches
34. Fix order status transition validation
35. Standardize API response format
36. Add Zod validation to unvalidated routes

### Phase 5: PRE-LAUNCH
37. Remove simulated-defaults.ts
38. Set real Datacap credentials
39. Fix VNC default password
40. Add deep health checks
41. Production source maps
42. Full E2E payment testing

---

## Audit Coverage

| Metric | Count |
|--------|-------|
| Total API route files | 434 |
| Routes without withVenue | 12 (intentional) |
| Routes without requirePermission | ~30 (8 open + 3 conditional bypass) |
| `as any` casts | 149 across 30+ files |
| TODO/FIXME/HACK comments | 6 active |
| setInterval/setTimeout occurrences | 58 across 30 files |
| Files using $executeRaw | 13 |
| Prisma schema lines | 6,736 |
| Components over 1000 lines | 3 |
| Bare string FK fields | 25+ across 25 models |
| Models missing updatedAt | 14 |
| Broken socket features | 2 (Scale, CFD) |
| Financial race conditions | 5 (house account, gift card, loyalty, entertainment x2) |

---

*Report generated 2026-02-25 by 7 parallel forensic audit agents across the full GWI POS codebase. Each agent read hundreds of source files and traced data flows through the complete stack.*
