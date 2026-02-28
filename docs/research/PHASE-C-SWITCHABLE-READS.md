# PHASE C: FINAL SWITCHABLE READS LIST

**Scope:** Scalar-only reads that can switch NOW (no transactions, no relations, no include:)
**Date:** 2026-02-28

---

## SECTION 1: IMMEDIATELY SWITCHABLE READS (Can migrate now)

### COUNT Operations (Scalar-only, no relations)

#### 1.1 Customer Order Count
- **File:** `src/app/api/customers/[id]/route.ts`
- **Line:** 75
- **Current:** `db.order.count({ where: ordersWhere })`
- **Target:** `db.orderSnapshot.count({ where: ordersWhere })`
- **Fields needed:** locationId, customerId (both ✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES — scalar where clause only

#### 1.2 Table Open Orders Check
- **File:** `src/app/api/tables/[id]/route.ts`
- **Line:** 277
- **Current:** `db.order.count({ where: { tableId: id, locationId, status: 'open' } })`
- **Target:** `db.orderSnapshot.count({ where: { tableId: id, locationId, status: 'open' } })`
- **Fields needed:** tableId, status, locationId (all ✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES — scalar where only

#### 1.3 Order Type Usage Count
- **File:** `src/app/api/order-types/[id]/route.ts`
- **Line:** 162
- **Current:** `db.order.count({ where: { orderTypeId: id } })`
- **Target:** `db.orderSnapshot.count({ where: { orderTypeId: id } })`
- **Fields needed:** orderTypeId (✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES — scalar where only

#### 1.4 Orders with Commission Count
- **File:** `src/app/api/admin/fix-commissions/route.ts`
- **Line:** 222
- **Current:** `db.order.count({ where: { commissionTotal: { gt: 0 }, ...(locationId ? { locationId } : {}) } })`
- **Target:** `db.orderSnapshot.count({ where: { commissionTotal: { gt: 0 }, ...(locationId ? { locationId } : {}) } })`
- **Fields needed:** commissionTotal, locationId (both ✅ on snapshot as cents)
- **Field mapping:** commissionTotal is in CENTS on snapshot (Int), same as Order (Decimal → Int)
- **Switchability:** ✅ YES — scalar comparison

#### 1.5 EOD: Stale Open Orders Count
- **File:** `src/app/api/eod/reset/route.ts`
- **Line:** 277
- **Current:** `db.order.count({ where: { locationId, status: 'open', OR: [{ businessDayDate: { lt: getBusinessDayStart } }, { businessDayDate: null, createdAt: { lt: getBusinessDayStart } }], deletedAt: null } })`
- **Target:** `db.orderSnapshot.count({ where: { locationId, status: 'open', OR: [{ businessDayDate: { lt: getBusinessDayStart } }, { businessDayDate: null, createdAt: { lt: getBusinessDayStart } }], deletedAt: null } })`
- **Fields needed:** locationId, status, businessDayDate, createdAt, deletedAt (all ✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES — scalar date comparisons

#### 1.6 EOD: Current Open Orders Count
- **File:** `src/app/api/eod/reset/route.ts`
- **Line:** 286
- **Current:** `db.order.count({ where: { locationId, status: 'open', deletedAt: null } })`
- **Target:** `db.orderSnapshot.count({ where: { locationId, status: 'open', deletedAt: null } })`
- **Fields needed:** locationId, status, deletedAt (all ✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES

#### 1.7 System Batch Status: Open Orders Count
- **File:** `src/app/api/system/batch-status/route.ts`
- **Line:** 30
- **Current:** `db.order.count({ where: { deletedAt: null, status: { notIn: ['paid', 'closed', 'voided', 'merged'] } } })`
- **Target:** `db.orderSnapshot.count({ where: { deletedAt: null, status: { notIn: ['paid', 'closed', 'voided', 'merged'] } } })`
- **Fields needed:** deletedAt, status (both ✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES

#### 1.8 Reports Email: Void Count
- **File:** `src/app/api/reports/email/route.ts`
- **Line:** 63
- **Current:** `db.order.count({ where: { locationId, status: 'voided', updatedAt: { gte: startOfDay, lte: endOfDay } } })`
- **Target:** `db.orderSnapshot.count({ where: { locationId, status: 'voided', updatedAt: { gte: startOfDay, lte: endOfDay } } })`
- **Fields needed:** locationId, status, updatedAt (all ✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES

#### 1.9 Employee Open Orders Count
- **File:** `src/app/api/employees/[id]/route.ts`
- **Line:** ~270
- **Current:** `db.order.count({ where: { employeeId: id, status: { in: ['open', 'pending'] } } })`
- **Target:** `db.orderSnapshot.count({ where: { employeeId: id, status: { in: ['open', 'pending'] } } })`
- **Fields needed:** employeeId, status (both ✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES

---

### AGGREGATE Operations (Scalar-only, no relations)

#### 2.1 Labor Report: Sales Aggregate
- **File:** `src/app/api/reports/labor/route.ts`
- **Line:** 302
- **Current:** `db.order.aggregate({ where: salesFilter, _sum: { subtotal: true } })`
- **Target:** `db.orderSnapshot.aggregate({ where: salesFilter, _sum: { subtotalCents: true } })`
- **Fields needed:** subtotal (Order) → subtotalCents (OrderSnapshot as Int)
- **Field mapping:** `subtotal: Decimal` → `subtotalCents: Int` (multiply/divide by 100 in JavaScript)
- **Conversion:** `Number(result._sum.subtotalCents) / 100` for final value
- **Switchability:** ✅ YES — field mapping: subtotal → subtotalCents (requires /100 conversion)

#### 2.2 Employee Stats: Total Sales
- **File:** `src/app/api/employees/[id]/route.ts`
- **Line:** ~52
- **Current:** `db.order.aggregate({ where: { employeeId: id, status: { in: ['paid', 'closed'] } }, _sum: { total: true } })`
- **Target:** `db.orderSnapshot.aggregate({ where: { employeeId: id, status: { in: ['paid', 'closed'] } }, _sum: { totalCents: true } })`
- **Fields needed:** employeeId, status, total (Order) → totalCents (OrderSnapshot)
- **Field mapping:** `total: Decimal` → `totalCents: Int` (requires /100 conversion)
- **Switchability:** ✅ YES — field mapping: total → totalCents (requires /100 conversion)

#### 2.3 Employee Stats: Total Commission
- **File:** `src/app/api/employees/[id]/route.ts`
- **Line:** ~57
- **Current:** `db.order.aggregate({ where: { employeeId: id, status: { in: ['paid', 'closed'] } }, _sum: { commissionTotal: true } })`
- **Target:** `db.orderSnapshot.aggregate({ where: { employeeId: id, status: { in: ['paid', 'closed'] } }, _sum: { commissionTotal: true } })`
- **Fields needed:** employeeId, status, commissionTotal (both exist on both models in cents)
- **No field mapping needed** (already Int in both)
- **Switchability:** ✅ YES

#### 2.4 Split Ticket: Max Split Index
- **File:** `src/app/api/orders/[id]/split/route.ts`
- **Line:** 323
- **Current:** `db.order.aggregate({ where: { parentOrderId: order.parentOrderId || order.id }, _max: { splitIndex: true } })`
- **Target:** `db.orderSnapshot.aggregate({ where: { parentOrderId: order.parentOrderId || order.id }, _max: { splitIndex: true } })`
- **Fields needed:** parentOrderId, splitIndex (both ✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES

#### 2.5 Split Ticket: Existing Splits Count (3x)
- **File:** `src/app/api/orders/[id]/split/route.ts`
- **Lines:** 165, 516, 769
- **Current:** `db.order.count({ where: { parentOrderId: order.id } })`
- **Target:** `db.orderSnapshot.count({ where: { parentOrderId: order.id } })`
- **Fields needed:** parentOrderId (✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES (3 occurrences)

#### 2.6 Employee Order Count
- **File:** `src/app/api/employees/[id]/route.ts`
- **Line:** ~47
- **Current:** `db.order.count({ where: { employeeId: id, status: { in: ['paid', 'closed'] } } })`
- **Target:** `db.orderSnapshot.count({ where: { employeeId: id, status: { in: ['paid', 'closed'] } } })`
- **Fields needed:** employeeId, status (both ✅ on snapshot)
- **No field mapping needed**
- **Switchability:** ✅ YES

---

## SECTION 2: READS NEEDING RELATIONS BEFORE SWITCH (Flag for Phase C-2)

### Relation Blockers Found

#### A. findMany/findUnique with `include: { items }`
**Routes affected:**
- `src/app/api/kds/route.ts:75` — KDS main screen
- `src/app/api/kds/expo/route.ts:31` — KDS expo view
- `src/app/api/orders/route.ts:663` — Orders page list
- `src/app/api/tabs/[id]/route.ts:240` — Tab details
- `src/app/api/orders/[id]/route.ts:37,74,193+` — Order details
- `src/app/api/entertainment/status/route.ts:80` — Entertainment status

**Blocker:** Missing `items OrderItemSnapshot[]` relation on OrderSnapshot
**Action required:** Add relation before switching these

#### B. findMany/findUnique with `include: { employee }`
**Routes affected:**
- `src/app/api/tabs/route.ts:24` — Tabs list
- `src/app/api/tabs/[id]/transfer/route.ts:32` — Tab transfer
- (Most tab and order routes with employee.displayName selects)

**Blocker:** Missing employee relation OR need `employeeDisplayName` denormalization
**Action required:** Denormalize employee name to snapshot OR add employee relation

#### C. findMany/findUnique with `include: { payments }`
**Routes affected:**
- `src/app/api/tabs/[id]/route.ts:240` — Tab details with payments
- `src/app/api/orders/[id]/route.ts:full details` — Order details
- Multiple order detail routes

**Blocker:** No payments relation on OrderSnapshot (by design — snapshot is denormalized)
**Action required:** If needed, create separate payments fetch OR keep on Order

#### D. findMany/findUnique with `include: { customer }`
**Routes affected:**
- `src/app/api/receipts/email/route.ts:71` — Email receipt
- Order detail routes needing customer name

**Blocker:** Missing customer relation OR need `customerName` denormalization
**Action required:** Denormalize customer name to snapshot OR add customer relation

#### E. findMany/findUnique with `include: { modifiers }`
**Routes affected:**
- Kitchen ticket print (`src/app/api/print/kitchen/route.ts:32`)
- Order detail routes
- KDS with modifier details

**Blocker:** OrderItemSnapshot has modifiersJson (denormalized), but structure/completeness unverified
**Action required:** Audit modifiersJson completeness before print path switch

---

## SECTION 3: SUMMARY STATISTICS

### Immediately Switchable: 19 reads
- **count operations:** 9
- **aggregate operations:** 6
- **combined occurrences (split operations):** 3

**Total line count to refactor:** ~19 lines of code
**Effort:** Low (simple db.order → db.orderSnapshot substitution + field mappings)

**Field mappings needed:**
1. `subtotal: Decimal` → `subtotalCents: Int` (divide by 100 in JavaScript)
2. `total: Decimal` → `totalCents: Int` (divide by 100 in JavaScript)
3. All other fields: 1:1 direct mapping

**No schema changes needed for Phase C-3 (switchable reads)**

---

### Needs Relations: 15+ reads
**Blocking issue:** Missing relations on OrderSnapshot
**Routes affected:** 15+ reads across KDS, orders, tabs, entertainment

**Required schema changes (Phase C-1 blocker):**
1. Add `items OrderItemSnapshot[]` relation to OrderSnapshot — unblocks 8+ reads
2. Denormalize `employeeDisplayName` to OrderSnapshot — unblocks 4+ reads  
3. Denormalize `customerName` to OrderSnapshot — unblocks 2+ reads
4. Verify `modifiersJson` completeness — blocks kitchen print decision

**Effort:** Medium (schema + projector updates + backfill)

---

## SECTION 4: RECOMMENDATIONS

### Phase C-3 (Can start immediately, parallel to C-1):
**Refactor these 19 scalar-only reads to use OrderSnapshot:**
1. All 9 count() operations (lines tracked above)
2. All 6 aggregate() operations (lines tracked above)
3. All 3 split() operations (lines tracked above)

**Why safe:**
- No schema changes needed
- No relation dependencies
- Simple field mappings (divide by 100 for Decimal→Int conversion)
- Non-latency-critical (admin pages, system jobs)
- Can be reverted easily if needed

**Expected performance impact:** Minimal (counts and aggregates are fast on both Order and OrderSnapshot). Main gain is consistency for Phase C-2 when snapshot becomes the primary read path.

### Phase C-1 (Must complete before Phase C-2):
Add missing OrderSnapshot relations:
1. `items: OrderItemSnapshot[]` — critical blocker for 8+ reads
2. Denormalized fields: `employeeDisplayName`, `customerName` — unblocks 6+ reads

---

## SECTION 5: DETAILED REFACTOR CHECKLIST

### COUNT Operations (9 total)
```
[ ] src/app/api/customers/[id]/route.ts:75 — ordersWhere count
[ ] src/app/api/tables/[id]/route.ts:277 — tableId open check
[ ] src/app/api/order-types/[id]/route.ts:162 — orderTypeId usage
[ ] src/app/api/admin/fix-commissions/route.ts:222 — commission count
[ ] src/app/api/eod/reset/route.ts:277 — stale orders
[ ] src/app/api/eod/reset/route.ts:286 — current open
[ ] src/app/api/system/batch-status/route.ts:30 — open orders
[ ] src/app/api/reports/email/route.ts:63 — void count
[ ] src/app/api/employees/[id]/route.ts:~270 — employee open orders
```

### AGGREGATE Operations (6 total)
```
[ ] src/app/api/reports/labor/route.ts:302 — _sum: { subtotal } → _sum: { subtotalCents } (/100)
[ ] src/app/api/employees/[id]/route.ts:~52 — _sum: { total } → _sum: { totalCents } (/100)
[ ] src/app/api/employees/[id]/route.ts:~57 — _sum: { commissionTotal } (no mapping)
[ ] src/app/api/orders/[id]/split/route.ts:323 — _max: { splitIndex } (no mapping)
[ ] src/app/api/orders/[id]/split/route.ts:165 — count split (no mapping)
[ ] src/app/api/orders/[id]/split/route.ts:516,769 — count split (2x, no mapping)
```

