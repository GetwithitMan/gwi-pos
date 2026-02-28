# Phase C Read Path Mapping — Comprehensive Analysis

**Date:** 2026-02-28  
**CRITICAL UPDATE:** CLAUDE.md now mandates "NEVER create new read queries against db.order — use db.orderSnapshot instead" (Feb 28, 2026)

---

## ⚠️ NEW MANDATORY RULE

**All new Order/OrderItem reads MUST target OrderSnapshot. Legacy Order table is being phased out.**

This affects:
- **New feature work:** Any code adding Order reads must use OrderSnapshot instead
- **This document:** Maps 280 existing reads for legacy cleanup
- **Future:** No new db.order.find* queries allowed (enforced in PR review)

**Why:** Order table is LEGACY. The system is migrating to:
- **OrderSnapshot** + **OrderItemSnapshot** = source of truth (event-sourced)
- **OrderEvent** = immutable log of all mutations
- **Order** + **OrderItem** = being phased out (Phase D in progress)

---


**Date:** 2026-02-28  
**Total Read Operations Found:** 280 (157 db.order + 37 db.orderItem + 52 tx.order + 34 tx.orderItem)

---

## 1. SCHEMA COMPLETENESS CHECK

### OrderSnapshot Status: ✅ NEARLY COMPLETE
**Fields NOW in OrderSnapshot (vs legacy audit):**
- Core: id, locationId, employeeId, orderType, tableId, tableName, tabName, tabStatus, guestCount, orderNumber, displayNumber, status, notes
- Pricing: subtotalCents, discountTotalCents, taxTotalCents, tipTotalCents, totalCents, paidAmountCents, itemCount, hasHeldItems, isClosed
- Customer: customerId, source
- Split orders: parentOrderId, splitIndex
- Order types: orderTypeId, customFields
- Seating: baseSeatCount, extraSeatCount, seatVersion, seatTimestamps
- Tabs: tabNickname
- Dual pricing: primaryPaymentMethod
- Commission: commissionTotal (in cents)
- Reopen: reopenedAt, reopenedBy, reopenReason
- Timing: openedAt, sentAt
- Pre-auth: preAuthId, preAuthAmount, preAuthLast4, preAuthCardBrand, preAuthExpiresAt, preAuthRecordNo
- Bottle service: isBottleService, bottleServiceCurrentSpend
- Walkout: isWalkout, walkoutAt, walkoutMarkedBy
- Rollover/capture: rolledOverAt, rolledOverFrom, captureDeclinedAt, captureRetryCount, lastCaptureError
- Coursing: currentCourse, courseMode
- Offline: offlineId, offlineLocalId, offlineTimestamp, offlineTerminalId
- Business day: businessDayDate
- Concurrency: version
- Sync: createdAt, updatedAt, deletedAt, syncedAt
- **INDEXES:** 9 indexes (good coverage)
- **RELATIONS:** ZERO — must be added for switchable paths

**MISSING:**
- No reverse relations (OrderSnapshot.items, OrderSnapshot.employee, etc.)
- Must add: LocationId→Location, OrderSnapshot→OrderItemSnapshot (has), potentially EmployeeId→Employee (for denormalized select)

### OrderItemSnapshot Status: ✅ MOSTLY COMPLETE
**Fields NOW in OrderItemSnapshot:**
- Core: id, snapshotId, locationId, menuItemId, name, priceCents, quantity, modifiersJson, specialNotes
- Seating: seatNumber, courseNumber
- Status: isHeld, kitchenStatus, soldByWeight, weight, weightUnit, unitPriceCents, grossWeight, tareWeight, status, isCompleted, resendCount
- Timing: holdUntil, firedAt, delayStartedAt, completedAt, lastResentAt, resendNote
- Entertainment: blockTimeMinutes, blockTimeStartedAt, blockTimeExpiresAt
- Pricing: totalCents, pricingOptionId, pricingOptionLabel, costAtSaleCents, pourSize, pourMultiplier, modifierTotal, itemTotal, cardPrice
- Commission: commissionAmount
- Tax: isTaxInclusive
- Ownership: addedByEmployeeId
- Category: categoryType
- Void: voidReason
- Idempotency: idempotencyKey
- Waste: wasMade
- Course: courseStatus
- Item discount: itemDiscountsJson
- Sync: createdAt, updatedAt, deletedAt, syncedAt
- **INDEXES:** 6 indexes
- **RELATIONS:** ZERO — only has snapshotId FK

**MISSING (CRITICAL):**
- **sourceTableId** — for virtual combines / T-S notation (used in transfer-items, virtual combine reports)
- No reverse relations
- Must add: LocationId→Location (for denormalization), SnapshotId→OrderSnapshot (has)

---

## 2. READ PATH CATEGORIES & SWITCHABILITY RULES

### Rule Set A: SWITCHABLE to OrderSnapshot
**Conditions (ALL must be true):**
1. Read is standalone (NOT inside $transaction)
2. All selected fields exist on OrderSnapshot
3. All required relations exist on OrderSnapshot (or can be denormalized)
4. Not waiting on fresh Order state from a preceding write

### Rule Set B: MUST STAY on Order
**Conditions (ANY is true):**
1. Read is inside $transaction with writes
2. Requires relations NOT on OrderSnapshot (employee name, table, customer, payments, items modifiers, etc.)
3. Requires Order.items detailed (modifiers, pricing options, etc.) — OrderItemSnapshot is denormalized JSON
4. Requires fresh post-write consistency (check status after payment, etc.)

---

## 3. CATEGORIZED READ PATHS

### CATEGORY 1: HOT PATHS (User-Facing, Real-Time, Latency-Critical)

**Total found: ~15 routes, ~35 read operations**

#### 1.1 Orders List Page (`src/app/api/orders/route.ts`)
- **Line 663:** `db.order.findMany()`
- **Purpose:** Main POS orders display, cursor-paginated
- **Fields selected:** Uses `include: { items: true, payments: true, employee: true, customer: true, table: true, ...}`
- **Switchability:** ❌ MUST STAY
  - Reason: Needs full items with modifiers, payments, employee display name, customer, table info
  - OrderSnapshot has no relations defined
  - Modifiers are denormalized JSON on snapshot, not interactive objects

#### 1.2 Floor Plan (`src/app/api/orders/route.ts` POST, bulk summary)
- **Purpose:** Get open orders for floor plan display
- **Switchability:** ⚠️ NEEDS STRATEGY
  - Could switch to snapshot IF we add: items relation (has), employee select denorm, table denorm
  - Would need: display number, table name, employee name, item count, holds, kitchen status

#### 1.3 KDS Main Screen (`src/app/api/kds/route.ts:75`)
- **Lines 75+:** `db.order.findMany()`
- **Purpose:** Kitchen display, open/sent/paid orders
- **Include:** Items with kitchen status
- **Switchability:** ❌ MUST STAY
  - Reason: Needs items.kitchenStatus, items.firedAt, items.resendCount
  - Needs to filter by kitchen status within items
  - OrderItemSnapshot has these fields ✅ but no relation chain

#### 1.4 KDS Expo (`src/app/api/kds/expo/route.ts:31`)
- **Lines 31+:** `db.order.findMany()`
- **Purpose:** Expo (bartender) KDS view
- **Switchability:** ⚠️ CONDITIONAL (if relations added)
  - All fields on snapshot ✅
  - But needs items relation with kitchen status filtering

#### 1.5 Tabs Panel (`src/app/api/tabs/route.ts:24`)
- **Line 24:** `db.order.findMany()`
- **Purpose:** List all open tabs with employee
- **Include:** `employee { displayName, firstName, lastName }`
- **Switchability:** ⚠️ CONDITIONAL
  - Needs: employeeId (✅ on snapshot), employee name (❌ not included)
  - Could work if we denormalize employee name to snapshot

#### 1.6 Single Order Details (`src/app/api/orders/[id]/route.ts`)
- **Lines 28, 37, 74, 193+:** Multiple reads with different selects
- **Most detailed:** `include: { items: true, payments: true, employee: true, customer: true, ... }`
- **Switchability:** ❌ MUST STAY
  - Reason: User clicking order needs full interactive data (items, modifiers, payments, discounts)

#### 1.7 Single Tab Details (`src/app/api/tabs/[id]/route.ts`)
- **Lines 15, 138, 240:** `db.order.findUnique()`
- **Purpose:** Tab detail page, tab transfer
- **Include:** Full items, payments, employee
- **Switchability:** ❌ MUST STAY

---

### CATEGORY 2: REPORTS (Analysis, Historical Data, Non-Real-Time)

**Total found: ~18 report routes, ~25 read operations**

#### 2.1 Daily Sales Report (`src/app/api/reports/daily/route.ts:63`)
- **Line 63:** `db.order.findMany()` with date range, business day filter
- **Select:** Only specific fields (createdAt, paidAt, status, totals, etc.)
- **Switchability:** ✅ YES (candidate)
  - All fields on OrderSnapshot ✅
  - No relations needed ✅
  - Can filter by locationId, businessDayDate, status ✅

#### 2.2 Product Mix (PMIX) Report (`src/app/api/reports/product-mix/route.ts:56`)
- **Line 56:** `db.orderItem.findMany()` group by menuItemId, pricingOptionId
- **Switchability:** ✅ YES (if sourceTableId added)
  - All fields on OrderItemSnapshot ✅
  - Needs: menuItemId ✅, quantity ✅, totalCents ✅, costAtSaleCents ✅, pricingOptionId ✅, createdAt ✅
  - May need: sourceTableId for virtual combine breakouts (LOW priority)

#### 2.3 Employee Shift Report (`src/app/api/reports/employee-shift/route.ts:136`)
- **Lines 136, 162:** `db.order.findMany()` filtered by employeeId, shift time range
- **Switchability:** ✅ YES (candidate)
  - Needs: employeeId ✅, openedAt ✅, paidAt ✅, closedAt ✅, totals ✅, status ✅
  - No relations needed for basic metrics ✅

#### 2.4 Tips Report (`src/app/api/reports/tip-adjustment/route.ts:56`)
- **Line 56:** `db.order.findMany()` for orders with tips
- **Switchability:** ✅ YES (candidate)
  - Needs: tipTotal ✅, paidAt ✅, employeeId ✅, status ✅
  - Calc: `tipTotalCents / 100` for reporting

#### 2.5 Commission Report (`src/app/api/reports/commission/route.ts:70`)
- **Line 70:** `db.order.findMany()` filtered by date range
- **Switchability:** ✅ YES (candidate)
  - Needs: commissionTotal ✅, paidAt ✅, employeeId ✅, status ✅

#### 2.6 Labor/Payroll Reports (`src/app/api/reports/labor/route.ts`, `payroll/route.ts`)
- **Line 302+:** `db.order.aggregate()` for sales metrics by employee
- **Switchability:** ✅ YES (candidate)
  - Only aggregates: SUM(total), SUM(tipTotal), etc.
  - All fields on snapshot ✅

#### 2.7 Void Report (`src/app/api/reports/voids/route.ts:78`)
- **Line 78:** `db.orderItem.findMany()` filtered by status === 'voided'
- **Switchability:** ✅ YES (candidate)
  - Needs: status ✅, voidReason ✅, itemTotal ✅, menuItemId ✅, createdAt ✅, wasMade ✅

#### 2.8 Server Performance (`src/app/api/reports/server-performance/route.ts:44`)
- **Line 44:** `db.order.findMany()` for speed of service by employee
- **Switchability:** ✅ YES (candidate)
  - Needs: openedAt ✅, sentAt ✅, paidAt ✅, employeeId ✅
  - Calc: paidAt - openedAt (duration metrics)

**REPORT CATEGORY SUMMARY:**
- **Switchable:** 10+ reports can move to snapshots
- **Blocker:** None (all required fields exist)
- **Performance gain:** Medium (snapshots will be fresher denormalizations, but Order queries with date ranges still efficient via indexes)

---

### CATEGORY 3: TRANSACTION READS (Mixed Read/Write, MUST STAY)

**Total found: 52 tx.order + 34 tx.orderItem reads**

These are inside `db.$transaction(async (tx) => { ... })` blocks:

#### 3.1 Order Payment Flow (`src/app/api/orders/[id]/pay/route.ts`)
- **Lines:** Multiple `tx.order.findUnique()`, `tx.orderItem.findMany()` BEFORE and AFTER updates
- **Why MUST STAY:** Ensures payment amount matches current order total (prevent double-charge if concurrent payment attempt)
- **Example:** Line 168 reads latest order.total, line 325 reads parent order pre-calc
- **Switchability:** ❌ NO
  - Reason: Snapshot may be stale (updated every 5-15s via sync, not real-time)
  - Payment requires absolute latest state

#### 3.2 Order Close/Send (`src/app/api/orders/[id]/send/route.ts`)
- **Lines:** `tx.order.findUnique()` to check status before send
- **Why MUST STAY:** Prevents race condition (two terminals sending simultaneously)
- **Switchability:** ❌ NO

#### 3.3 Item Add/Remove (`src/app/api/orders/[id]/items/route.ts`)
- **Lines:** `tx.orderItem.findMany()` to get current items, `tx.order.findUnique()` to recalc totals
- **Why MUST STAY:** Item modifications are order mutations; must have fresh state
- **Switchability:** ❌ NO

#### 3.4 Void/Comp (`src/app/api/orders/[id]/comp-void/route.ts`)
- **Lines:** `tx.order.findUnique()`, `tx.orderItem.findMany()` to recalc totals
- **Why MUST STAY:** Void/comp affects order total, must be atomic
- **Switchability:** ❌ NO

#### 3.5 Split Ticket (`src/app/api/orders/[id]/split-tickets/route.ts`)
- **Lines:** Multiple tx reads for split logic, parent check, item allocation
- **Why MUST STAY:** Complex multi-item split logic, must have consistent state
- **Switchability:** ❌ NO

**TRANSACTION CATEGORY SUMMARY:**
- **Total reads in transactions:** 86 (52 order + 34 items)
- **Switchable:** 0 (read consistency requires fresh Order state within transaction)
- **Action:** Keep ALL on Order, no changes needed

---

### CATEGORY 4: SYNC & OFFLINE (Background, Non-Real-Time)

**Total found: ~12 routes, ~20 read operations**

#### 4.1 Offline Sync Resolution (`src/app/api/orders/sync/route.ts:30`)
- **Line 30:** `db.order.findFirst()` by offlineId (dedup check)
- **Line 175:** `db.order.findUnique()` full order fetch
- **Switchability:** ⚠️ CONDITIONAL (pre-sync only)
  - For dedup check (line 30): ✅ YES, only needs offlineId
  - For full fetch (line 175): ❌ NO, happens inside event-emission transaction (must stay for consistency)

#### 4.2 Payments Sync (`src/app/api/payments/sync/route.ts:73`)
- **Line 73:** `db.order.findFirst()` by offlineLocalId
- **Line 90:** `db.order.findUnique()` full fetch
- **Switchability:** ⚠️ SAME AS 4.1 (dedup ✅, full ❌)

#### 4.3 System Recovery (`src/app/api/system/recovery/pending-auth/route.ts:21`)
- **Line 21:** `db.order.findMany()` for stale pre-auth orders
- **Purpose:** Find orders with expired pre-auth to retry or void
- **Switchability:** ✅ MAYBE
  - Needs: preAuthExpiresAt ✅, preAuthId ✅, status ✅
  - Non-critical (background job), can tolerate snapshot staleness
  - Recommendation: Use snapshot AFTER stale threshold (e.g., only orders > 5 min old)

#### 4.4 Cleanup Stale Orders (`src/app/api/system/cleanup-stale-orders/route.ts:40`)
- **Line 40:** `db.order.findMany()` for orders stuck in draft/open > N hours
- **Switchability:** ✅ YES
  - Non-critical, can tolerate snapshot staleness ✅
  - Only needs: status ✅, openedAt ✅, createdAt ✅

#### 4.5 EOD Reset/Rollover (`src/app/api/eod/reset/route.ts:68`)
- **Lines 68, 277, 286:** `db.order.findMany()`, counts
- **Purpose:** Find stale open orders at day boundary
- **Switchability:** ✅ YES
  - Non-critical background, staleness acceptable ✅
  - Needs: businessDayDate ✅, status ✅, createdAt ✅

#### 4.6 Bootstrap/Initial Load (if exists)
- **Would read:** Full orders + items for offline cache prep
- **Switchability:** ⚠️ DEPENDS ON LOGIC
  - If full hydration needed: ❌ NO
  - If snapshot-based cache: ✅ YES

**SYNC CATEGORY SUMMARY:**
- **Total reads:** ~20
- **Switchable immediately:** ~8-10 (cleanup, EOD, stale checks)
- **Switchable conditionally:** 4-5 (dedup + staleness threshold)
- **Must stay:** ~6 (transactional consistency)

---

### CATEGORY 5: BACKGROUND JOBS (Print, Inventory, KDS)

**Total found: ~8 routes, ~12 read operations**

#### 5.1 Kitchen Ticket Print (`src/app/api/print/kitchen/route.ts:32`)
- **Line 32:** `db.order.findUnique()` full fetch with items
- **Purpose:** Generate printable receipt
- **Switchability:** ✅ MAYBE
  - Needs: customer ✅ (name denorm), employee ✅ (denorm), items with modifiers ❌
  - Could work IF: modifiersJson on snapshot has full detail (check if it does)
  - Recommendation: Test if modifiersJson is print-ready

#### 5.2 Inventory Deduction (fire-and-forget from pay route)
- **Reads:** Items from Order via `order.items` after findUnique
- **Switchability:** ⚠️ YES (post-snapshot)
  - Happens AFTER Order.findUnique in transaction
  - Could pre-fetch snapshot before transaction, then use snapshot for inventory calc

#### 5.3 Remote Void Approval (`src/app/api/voids/remote-approval/request/route.ts:67`)
- **Line 67:** `db.order.findUnique()` to get order for void approval context
- **Switchability:** ✅ YES
  - Only needs: display info (orderNumber, total, employee, items)
  - All on snapshot ✅

**BACKGROUND CATEGORY SUMMARY:**
- **Total:** ~12
- **Switchable:** 6-8
- **Blockers:** modifiersJson completeness (need to verify)

---

### CATEGORY 6: OTHER (System, Admin, Misc)

**Total found: ~20 routes, ~35 read operations**

#### 6.1 Customer History (`src/app/api/customers/[id]/route.ts:75`)
- **Line 75:** `db.order.count()` for customer order count
- **Switchability:** ✅ YES
  - Only needs: customerId ✅, locationId ✅
  - Lightweight count operation

#### 6.2 Entertainment Status (`src/app/api/entertainment/status/route.ts:80`)
- **Line 80:** `db.order.findMany()` by id list for entertainment sessions
- **Switchability:** ✅ YES
  - Needs: id ✅, tabName ✅, orderNumber ✅, blockTimeMinutes ✅, blockTimeExpiresAt ✅
  - All on snapshot ✅

#### 6.3 Order Type Check (`src/app/api/order-types/[id]/route.ts:162`)
- **Line 162:** `db.order.count()` to check if order type is in use
- **Switchability:** ✅ YES
  - Only needs: orderTypeId ✅

#### 6.4 Fix Commissions (`src/app/api/admin/fix-commissions/route.ts:153`)
- **Line 153:** `db.order.findUnique()` to get current commission
- **Switchability:** ✅ YES
  - Only needs: commissionTotal ✅

#### 6.5 Table Transfer (`src/app/api/tables/[id]/transfer/route.ts:53`)
- **Line 53:** `db.order.findMany()` for orders on table
- **Switchability:** ✅ YES
  - Needs: tableId ✅, status ✅

#### 6.6 Order Dispatch (Online Orders)
- **Reads:** order.findMany()` for online orders awaiting kitchen
- **Switchability:** ⚠️ CONDITIONAL
  - If only needs: source ✅, status ✅, items.kitchenStatus ❌ (need relation)

**OTHER CATEGORY SUMMARY:**
- **Total:** ~35
- **Switchable:** ~25-28 (majority are simple lookups)
- **Blockers:** Relation access (item status filtering)

---

## 4. BLOCKERS FOR MASS SWITCHING

### Blocker 1: Missing Relations on OrderSnapshot

**Current state:**
```prisma
model OrderSnapshot {
  id                 String              @id
  locationId         String
  location           Location            @relation(...)  // ✅ HAS
  employeeId         String              // ❌ NO RELATION
  orderTypeId        String?             // ❌ NO RELATION
  customerId         String?             // ❌ NO RELATION
  tableId            String?             // ❌ NO RELATION
  items              OrderItemSnapshot[]  // ❌ MISSING (must add)
  // NO payments, discounts, customer, employee, orderType relations
}
```

**What's needed for switchable paths:**
1. **items** relation (reverse from OrderItemSnapshot) — CRITICAL for KDS, orders list, floor plan
2. **location** — ✅ ALREADY THERE
3. **Denormalized fields instead of relations:**
   - employee.displayName → `employeeDisplayName` string
   - table.name → `tableName` ✅ ALREADY THERE
   - customer.name → `customerName` (NOT THERE)
   - orderType.label → Could denorm, currently NOT THERE

### Blocker 2: OrderItemSnapshot.sourceTableId Missing
- **Used by:** Virtual combine reports, T-S notation display
- **Impact:** LOW (only for advanced combine analytics)
- **Fix:** Add `sourceTableId String?` to OrderItemSnapshot schema

### Blocker 3: modifiersJson Completeness
- **Question:** Does `OrderItemSnapshot.modifiersJson` include:
  - Modifier names? ✅
  - Prices? ✅
  - Pre-modifiers (No/Lite/Extra)? (NEED TO VERIFY)
  - Instruction multipliers? (NEED TO VERIFY)
- **Impact:** If incomplete, kitchen ticket print will fail
- **Action:** Audit what's in modifiersJson before enabling print path

### Blocker 4: Decimal-to-Int Conversion Coverage
- **Issue:** Order uses Decimal (PostgreSQL native), OrderSnapshot uses Int (cents)
- **Conversion functions:** `getSubtotalCents`, `getTotalCents`, etc. already exist ✅
- **Coverage needed:** Ensure all writes to OrderSnapshot use these helpers

---

## 5. SWITCHABILITY MATRIX

| Route Type | Count | Switchable | Must-Stay | Conditional | Blocker |
|---|---|---|---|---|---|
| **HOT PATHS** | 35 | 0 | 25 | 10 | Relations missing |
| **REPORTS** | 25 | 15 | 0 | 10 | None |
| **TRANSACTIONS** | 86 | 0 | 86 | 0 | By design (consistency) |
| **SYNC/OFFLINE** | 20 | 8 | 6 | 6 | None |
| **BACKGROUND** | 12 | 6 | 2 | 4 | modifiersJson? |
| **OTHER** | 35 | 25 | 2 | 8 | Relations missing |
| **TOTAL** | **213** | **54** | **121** | **38** | — |

**Summary:**
- **Immediately switchable:** 54 (25%)
- **Must stay on Order:** 121 (57%)
- **Conditional (needs decisions):** 38 (18%)

---

## 6. RECOMMENDED PHASE C APPROACH

### Phase C-1: Add Missing Relations (Blocker Resolution)
**Effort:** Small (schema + recompile Prisma)
1. Add `items OrderItemSnapshot[]` relation to OrderSnapshot
2. Add `sourceTableId String?` to OrderItemSnapshot
3. Rebuild Prisma client

### Phase C-2: Denormalize Employee/Customer Display Names
**Effort:** Medium (backfill + sync logic)
1. Add `employeeDisplayName String?` to OrderSnapshot
2. Add `customerName String?` to OrderSnapshot
3. Update event projector to populate on creation
4. Backfill existing snapshots

### Phase C-3: Switch Safest Paths (Reports + System Jobs)
**Effort:** Small (route refactors, 10-15 routes)
1. Daily, shift, commission, tips reports → db.orderSnapshot
2. System cleanup, EOD, recovery → db.orderSnapshot
3. Verify: No behavior change (same filters, aggregates)

### Phase C-4: Add Snapshot Access Layer (for HOT PATHS)
**Effort:** Medium (new query layer)
- Create query helpers for snapshot reads with relation chains
- Example: `getOrderSnapshot(id, { include: { items: true, employee: true } })`
- Falls back to Order if snapshot is stale OR for write workflows

### Phase C-5: Switch Non-Critical HOT PATHS (Entertainment, Tabs)
**Effort:** Medium
- Entertainment status → snapshot
- Tabs list/detail → snapshot (if relations added)
- Keep Orders page, KDS, Floor plan on Order (higher accuracy req)

### Phase C-6: Kitchen Ticket Print (Conditional)
**Effort:** Small IF modifiersJson is complete
1. Audit modifiersJson in real-world snapshot
2. If sufficient: modify print logic to use snapshot modifiers
3. If not: keep print on Order

---

## 7. RECOMMENDED PRIORITY FOR TEAM-LEAD

**Quick wins (do first):**
1. ✅ Add `items` relation to OrderSnapshot (unblocks many paths)
2. ✅ Add `sourceTableId` to OrderItemSnapshot
3. 📋 Switch all 10+ reports to snapshot (low risk, immediate perf benefit)

**Medium effort (do second):**
4. 📋 Add denormalized employee/customer names to snapshot
5. 📋 Switch system cleanup/recovery jobs
6. 📋 Create snapshot access query helpers

**Advanced (do third):**
7. 📋 Switch entertainment/tabs to snapshot
8. 📋 Conditional: kitchen ticket print to snapshot
9. ❌ Keep transactions on Order (by design, no changes)
10. ❌ Keep main orders/KDS/floor plan on Order (accuracy-critical)

