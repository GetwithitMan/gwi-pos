# NUC Legacy Order Table — Full Migration Audit

**Date:** 2026-02-28
**Audited by:** 3-agent team (legacy-writes, legacy-reads, schema-gap)

---

## Executive Summary

| Metric | Count |
|--------|-------|
| **Total Order/OrderItem mutation sites** | ~185 across 50+ files |
| **Dual-write (legacy + event emission)** | ~15 routes (~35%) |
| **Legacy-only (no event emission)** | ~35 routes (~65%) |
| **Read paths (queries)** | 180+ across 99 files |
| **OrderSnapshot schema completeness** | ~40-50% |

**Bottom line:** The event-sourced pipeline works perfectly for the Android→NUC flow (Phase 4), but ~65% of NUC-side mutations still write directly to the legacy `Order`/`OrderItem` tables with no event emission. Before you can flip reads to snapshots or kill legacy writes, you need to close 3 gaps: schema, events, and reads.

---

## Gap 1: Schema — OrderSnapshot is ~40-50% Complete

### Missing from OrderSnapshot (16 fields)

| Field | Type | Why It's Needed |
|-------|------|-----------------|
| `customerId` | String? | Customer linkage for loyalty/CRM |
| `businessDayDate` | DateTime? | EOD reporting pivot |
| `isOfflineCreated` | Boolean | Offline origin tracking |
| `offlineDeviceId` | String? | Which device created offline |
| `reopenedAt` | DateTime? | Reopen audit trail |
| `reopenReason` | String? | Why order was reopened |
| `isWalkout` | Boolean | Walkout flag for loss tracking |
| `walkoutRetryCount` | Int | Walkout payment retry attempts |
| `isBottleService` | Boolean | Bottle service mode flag |
| `bottleServicePreAuthId` | String? | Pre-auth linkage |
| `courseMode` | String? | Multi-course dining mode |
| `currentCourse` | Int? | Active course number |
| `extraSeatCount` | Int | Additional seats beyond initial |
| `onlineOrderId` | String? | Online order linkage |
| `commissionTotal` | Decimal? | Commission total for order |
| `version` | Int | Optimistic concurrency version |

### Missing from OrderItemSnapshot (15 fields)

| Field | Type | Why It's Needed |
|-------|------|-----------------|
| `cardPrice` | Decimal? | Dual pricing (card vs cash) |
| `taxExempt` | Boolean | Tax exemption flag |
| `taxOverrideRate` | Decimal? | Per-item tax override |
| `voidReason` | String? | Why item was voided |
| `voidedBy` | String? | Employee who voided |
| `voidedAt` | DateTime? | When item was voided |
| `blockTimeMinutes` | Int? | Entertainment block time |
| `blockTimeExpiresAt` | DateTime? | Block time expiration |
| `blockTimeStartedAt` | DateTime? | Block time start |
| `commissionAmount` | Decimal? | Per-item commission |
| `commissionRate` | Decimal? | Commission rate |
| `addedByEmployeeId` | String? | Who added the item |
| `courseStatus` | String? | Course firing status |
| `delayStartedAt` | DateTime? | Delay tracking |
| `sentAt` | DateTime? | When item was sent to kitchen |

### Missing Relations

- Employee (employeeId → Employee)
- Table (tableId → Table)
- Customer (customerId → Customer)
- Payment (order → payments)
- OrderType (orderTypeId → OrderType)

### Missing Indexes (14+)

Compound indexes needed for report queries — daily totals by date+location, shift reports by employee+shift, PMIX by category+date, tip reports by employee+date, etc.

---

## Gap 2: Events — 65% of Write Paths Have No Event Emission

### HIGH Priority (Financial/Operational) — 11 Routes

| # | Route | File | Mutations | Impact |
|---|-------|------|-----------|--------|
| 1 | `POST /api/orders/[id]/split` | `split/route.ts` | 11 mutations (create splits, transfer items, update parent) | Split checks invisible to event stream |
| 2 | `POST /api/orders/[id]/split-tickets/create-check` | `create-check/route.ts` | `db.order.create()` for child split | Clients don't know about new split tickets |
| 3 | `POST /api/orders/[id]/comp-void` | `comp-void/route.ts` | item void + totals recalc in transaction | Voids not tracked in event log |
| 4 | `POST /api/orders/[id]/void-payment` | `void-payment/route.ts` | payment state changes | Payment voids missing from events |
| 5 | `POST /api/orders/[id]/refund-payment` | `refund-payment/route.ts` | tip/total adjustments | Refunds untracked |
| 6 | `POST /api/datacap/walkout-retry` | `walkout-retry/route.ts` | marks order paid after retry | Payment completions missing |
| 7 | `POST /api/kds` | `kds/route.ts` | 4 mutations: complete, uncomplete, bump, resend | KDS state silent to POS terminals |
| 8 | `POST /api/kds/expo` | `kds/expo/route.ts` | 3 mutations: deliver, update status, deliver-for-order | Expo status invisible to POS |
| 9 | `POST /api/orders/[id]/courses` | `courses/route.ts` | 10 mutations for fire/hold/release/ready/served | Multi-course dining untracked |
| 10 | `POST /api/orders/[id]/fire-course` | `fire-course/route.ts` | 3 mutations for course item firing | Course firing untracked |
| 11 | `POST /api/orders/[id]/advance-course` | `advance-course/route.ts` | 3 mutations for course advancement | Course advancement untracked |

**Also:** `lib/soft-delete.ts` — `softDeleteOrder()` and `softDeleteOrderItem()` cascade deletes with no event emission. All callers must emit events.

### MEDIUM Priority (Metadata/Operational) — 10 Routes

| # | Route | File | What's Missing |
|---|-------|------|---------------|
| 1 | `POST /api/orders/[id]/discount` | `discount/route.ts` | Order-level discount apply/remove |
| 2 | `POST /api/orders/[id]/adjust-tip` | `adjust-tip/route.ts` | Tip adjustments |
| 3 | `POST /api/orders/[id]/open-tab` | `open-tab/route.ts` | Tab opening |
| 4 | `POST /api/tabs/[id]/transfer` | `tabs/[id]/transfer/route.ts` | Tab ownership transfer |
| 5 | `PUT /api/employees/[id]/open-tabs` | `employees/[id]/open-tabs/route.ts` | Bulk tab transfer on clock-out |
| 6 | `PUT /api/tables/[id]/transfer` | `tables/[id]/transfer/route.ts` | Table order transfer |
| 7 | `POST /api/orders/[id]/bottle-service` | `bottle-service/route.ts` | Bottle service mode toggle |
| 8 | `POST /api/orders/[id]/pre-auth` | `pre-auth/route.ts` | Pre-authorization |
| 9 | `POST /api/entertainment/block-time` | `block-time/route.ts` | Block time updates |
| 10 | `POST /api/print/kitchen` | `print/kitchen/route.ts` | Kitchen status after print |

### LOW Priority (Admin/System) — 5 Routes

| # | Route | File | What It Does |
|---|-------|------|-------------|
| 1 | `POST /api/admin/fix-commissions` | `fix-commissions/route.ts` | Retroactive commission fix |
| 2 | `POST /api/system/cleanup-stale-orders` | `cleanup-stale-orders/route.ts` | Marks abandoned orders cancelled |
| 3 | `POST /api/system/recovery/pending-auth` | `pending-auth/route.ts` | Resets stuck payment state |
| 4 | `POST /api/orders/eod-cleanup` | `eod-cleanup/route.ts` | End-of-day cleanup |
| 5 | `POST /api/orders/bulk-action` | `bulk-action/route.ts` | Bulk order operations |

### Additional Legacy-Only Routes

| Route | What's Missing |
|-------|---------------|
| `POST /api/orders/[id]/reopen` | Has event emission (fixed in audit round 1) |
| `POST /api/orders/[id]/void-tab` | Has socket dispatch but NOT event log |
| `POST /api/orders/[id]/customer` | Has socket dispatch but NOT event log |
| `PUT /api/tabs/[id]` | Tab metadata update + soft delete |
| `POST /api/orders/[id]/mark-walkout` | Walkout marking |
| `POST /api/orders/[id]/pat-complete` | PAT workflow completion |
| `POST /api/orders/[id]/auto-increment` | Pre-auth auto-increment |
| `POST /api/orders/[id]/bottle-service/re-auth` | Bottle service re-auth |
| `POST /api/orders/[id]/seating` | Seat count management |
| `POST /api/orders/[id]/seating/remove` | Seat removal + item deletion |
| `POST /api/orders/[id]/retry-capture` | Pre-auth capture retry |
| `POST /api/internal/dispatch-online-order` | Online order dispatch |
| `PUT /api/orders/[id]` | Generic order metadata update |
| `POST /api/orders/bulk-action` | Bulk order operations |

### Routes WITH Proper Dual-Write (Working Correctly)

| Route | Events Emitted |
|-------|---------------|
| `POST /api/orders` (create) | ORDER_CREATED, ITEM_ADDED |
| `POST /api/orders/[id]/items` (add items) | ITEM_ADDED |
| `PUT /api/orders/[id]/items/[itemId]` (update item) | ITEM_UPDATED |
| `POST /api/orders/[id]/send` | ORDER_SENT |
| `POST /api/orders/[id]/pay` | PAYMENT_APPLIED, ORDER_CLOSED |
| `POST /api/orders/[id]/reopen` | ORDER_REOPENED |
| `POST /api/orders/[id]/close-tab` | TAB_CLOSED |
| `POST /api/order-events/batch` | Accepts Android events, assigns serverSequence |

---

## Gap 3: Reads — 180+ Query Paths

### By Category

| Category | Count | Can Switch to Snapshot? | Notes |
|----------|-------|------------------------|-------|
| Hot path (open orders, floor plan) | 8 | Yes, after schema fill | Highest user impact |
| Reports (daily, shift, PMIX, tips) | 18 | Yes, but need indexes | 14+ compound indexes required |
| Sync (bootstrap, delta, outbox) | 5 | Partially | Some need legacy joins for relations |
| Background (inventory, print, KDS) | 10 | Yes, after schema fill | Non-blocking |
| Write workflows (pay, send, items) | 35 | **NO** | Transaction-bound, must stay on Order |
| Other ops (tabs, customers, seating) | 23 | Yes, after schema fill | Lower priority |

**~64 read-only paths** can switch to snapshots once the schema is filled.
**~35 write-workflow reads** must stay on the legacy `Order` table (they're inside `db.$transaction` with writes).

---

## New Event Types Needed

Beyond the existing 17 event types, the following are likely needed for full coverage:

| Event Type | For Routes | Description |
|------------|-----------|-------------|
| `COURSE_FIRED` | courses, fire-course, advance-course | Course firing/holding/serving |
| `ITEM_VOIDED` | comp-void, soft-delete | Item void with reason/employee |
| `ORDER_SPLIT` | split, split-tickets | Split check creation |
| `ITEMS_TRANSFERRED` | transfer-items | Move items between orders |
| `ORDERS_MERGED` | merge | Merge orders together |
| `TAB_TRANSFERRED` | tabs/transfer, employees/open-tabs, tables/transfer | Tab ownership change |
| `TIP_ADJUSTED` | adjust-tip | Post-payment tip adjustment |
| `PAYMENT_REFUNDED` | refund-payment | Payment refund |
| `PRE_AUTH_APPLIED` | pre-auth, auto-increment | Pre-authorization |
| `WALKOUT_MARKED` | mark-walkout | Walkout flag |

---

## Raw SQL Usage

All raw SQL found is `SELECT...FOR UPDATE` locking (not mutations):

| File | SQL | Purpose |
|------|-----|---------|
| `orders/route.ts` | `SELECT id FROM "Table" WHERE id = $1 FOR UPDATE` | Table conflict prevention |
| `orders/route.ts` | `SELECT "orderNumber" FROM "Order" WHERE ... FOR UPDATE` | Order number generation |
| `orders/[id]/pay/route.ts` | `SELECT id FROM "Order" WHERE id = ... FOR UPDATE` | Split payment serialization |
| `orders/[id]/split-tickets/route.ts` | `SELECT id FROM "Order" WHERE ... FOR UPDATE` | Split race prevention |
| `orders/[id]/seating/remove/route.ts` | `SELECT id FROM "Order" WHERE ... FOR UPDATE` | Seating cleanup atomicity |

No raw SQL mutations found — all writes go through Prisma ORM.

---

## Migration Plan

### Phase A — Fill the Schema (Prerequisite)

1. Add 16 missing fields to `OrderSnapshot`
2. Add 15 missing fields to `OrderItemSnapshot`
3. Add missing relations (Employee, Table, Customer, Payment, OrderType)
4. Add 14+ compound indexes for report queries
5. Update `projector.ts` to populate all new fields
6. Backfill existing snapshots from legacy Order data

### Phase B — Add Event Emission to All Write Paths

**B-HIGH:** 11 critical routes (splits, voids, KDS, courses) — may need ~5 new event types
**B-MED:** 10 medium routes (discounts, tips, tabs, transfers) — may need ~5 new event types
**B-LOW:** 5 admin/system routes

### Phase C — Flip Reads

1. Switch ~64 read-only paths from `db.order.findMany` to `db.orderSnapshot.findMany`
2. Add dual-read validation during transition (query both, compare, log mismatches)
3. Verify report queries produce identical results

### Phase D — Kill Legacy Writes

1. All 50+ mutation sites write ONLY via event → reduce → project
2. Legacy `Order`/`OrderItem` tables become read-only archives
3. Eventually drop the tables (or keep as audit archive)

### Dependency Chain

```
Phase A (schema) ─┬─→ Phase B-HIGH (critical events) ──┐
                  ├─→ Phase B-MED (medium events) ──────┤
                  └─→ Phase B-LOW (admin events) ───────┤
                                                        ▼
                                                  Phase C (flip reads)
                                                        │
                                                        ▼
                                                  Phase D (kill legacy writes)
```

---

## Appendix: Audit Agents

| Agent | Lens | Key Finding |
|-------|------|-------------|
| **legacy-writes-auditor** | Every `db.order.*`/`db.orderItem.*` mutation | 185 mutations, 65% have no event emission |
| **legacy-reads-auditor** | Every read from Order/OrderItem | 180+ queries across 99 files, ~64 switchable |
| **schema-gap-auditor** | Field-by-field OrderSnapshot vs Order comparison | 40-50% complete, 31 fields missing |

Previous audit (2026-02-28, 8-agent team) fixed 6 issues:
- P0: ITEM_ADDED payload missing 14 fields (commit `f40ea58`)
- P0: catchUpOrderEvents pagination gap (commit `fc28b92`)
- P1: ORDER_REOPENED missing reason field
- P1: handleOrderSent firing voided items
- P2: ingestRemoteEvent missing field validation
- P2: markBatchResults not atomic (@Transaction added)
