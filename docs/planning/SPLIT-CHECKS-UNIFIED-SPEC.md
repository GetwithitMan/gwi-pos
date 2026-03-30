# Unified Split Checks — Engineering Spec

> Status: DRAFT — Awaiting team review before implementation
> Date: 2026-03-30
> Scope: gwi-pos (server), gwi-android-register (client)

---

## 1. Design Principles

1. **One split family, one source of truth.** Every split operation creates or operates within a split family. The family root's `splitFamilyTotal` is the immutable financial ceiling.
2. **Explicit split class.** Every child check declares whether it is structural (owns items), allocation (owns money), or item-share (owns a fraction of one item). Do not infer split type from `parentOrderId` or `itemCount`.
3. **Parent = pay remaining.** The parent order in `status='split'` is always selectable. Selecting it shows the remaining unpaid family balance and allows direct payment. No separate "merge back" step needed.
4. **No fake items.** Allocation children never create phantom item rows. Item-share children create share entries, not duplicated items.
5. **Composable with guardrails.** Any valid child can become a split source for further splitting, subject to explicit rules. Sub-families roll up financially to the original family root.
6. **Family balance calculator is the single source of truth.** Every split/pay/merge/rebalance mutation must recompute family balance before commit.
7. **Conservative concurrency.** Only one mutating split-family operation may commit at a time. All mutations lock the family root and active descendants.

---

## 2. Split Taxonomy

### 2.1 Order-Level Structural Splits

Items physically move from source to child. Child is a self-contained order.

| Mode | Behavior |
|------|----------|
| `by_item` | Selected items move to new check |
| `by_seat` | Items grouped by seat number → one check per seat |
| `by_table` | Items grouped by table → one check per table |

**Child owns:** items, subtotal, tax, discounts, total (all computed from owned items).
**Source retains:** remaining items not moved.

### 2.2 Order-Level Allocation Splits

Money is distributed across payment buckets. Items stay on parent/source.

| Mode | Behavior |
|------|----------|
| `even` | Total divided equally across N checks |
| `custom_amount` | Arbitrary dollar amounts per check |

**Child owns:** allocated subtotal, tax, discount, total.
**Child does NOT own:** items. Parent retains full item graph.
**Display:** UI shows parent items as read-only context when viewing an allocation child.
**Note:** Custom amount split does NOT require the caller to consume the entire source balance. Any unallocated remainder stays on the source.

### 2.3 Item-Level Share Splits

One line item's cost is divided across multiple checks.

| Mode | Behavior |
|------|----------|
| `item_n_ways` | Single item split across N checks as fractional shares |

**Source item:** stays on its owning check (parent or structural child).
**Shares:** `ItemShare` entries created, each assigned to a target check.
**Display:** "1/3 Ribeye — $18.33" on receipt and order panel.

---

## 3. Schema Changes

### 3.1 New Fields on Order

```prisma
model Order {
  // ... existing fields ...

  // Split semantics
  splitClass         String?   // 'structural' | 'allocation' | null (not a split child)
  splitMode          String?   // 'by_item' | 'by_seat' | 'by_table' | 'even' | 'custom_amount' | null

  // Family / root tracking
  splitFamilyRootId  String?   // Authoritative family root for balance/closure (traces lineage through nesting)
  splitFamilyTotal   Decimal?  // Immutable family ceiling; authoritative on family root ONLY

  // Resolution (for recomposition flows)
  splitResolution    String?   // null | 'superseded' | 'merged_back' | 'merged_into_other'
  supersededBy       String?   // Order ID that absorbed this child's remaining balance
  supersededAt       DateTime?

  // Relations
  splitFamilyRoot    Order?    @relation("SplitFamilyRoot", fields: [splitFamilyRootId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  splitFamilyMembers Order[]   @relation("SplitFamilyRoot")

  @@index([splitFamilyRootId])
  @@index([splitResolution])
}
```

**Important rules:**
- `splitFamilyTotal` is authoritative ONLY on the family root. Child rows may not redefine it.
- `parentOrderId` is immediate parentage (existing field). `splitFamilyRootId` is family-balance lineage.
- When a structural child is re-split, grandchildren get `splitFamilyRootId = original root`, NOT the intermediate child.

### 3.2 New Model: ItemShare

```prisma
model ItemShare {
  id                  String    @id @default(cuid())
  locationId          String
  sourceItemId        String    // The canonical OrderItem being shared
  sourceOrderId       String    // Order that owns the canonical item
  targetOrderId       String    // Check that owes this share
  shareIndex          Int       // 1-based (1 of 3, 2 of 3, etc.)
  totalShares         Int       // N in "split N ways"
  allocatedAmount     Decimal   // This share's dollar amount (after penny distribution)
  allocatedTax        Decimal   @default(0)
  allocatedDiscount   Decimal   @default(0)
  resolvedAt          DateTime? // When this share was paid/superseded
  resolvedByPaymentId String?   // Payment that resolved this share
  splitResolution     String?   // null | 'paid' | 'superseded' | 'merged_back'
  createdAt           DateTime  @default(now())
  deletedAt           DateTime?

  sourceItem  OrderItem @relation("ItemShareSource", fields: [sourceItemId], references: [id])
  sourceOrder Order     @relation("ItemShareSourceOrder", fields: [sourceOrderId], references: [id])
  targetOrder Order     @relation("ItemShareTarget", fields: [targetOrderId], references: [id])
  location    Location  @relation(fields: [locationId], references: [id])

  @@index([sourceItemId])
  @@index([targetOrderId])
  @@index([sourceOrderId])
  @@index([locationId])
}
```

### 3.3 OrderStatus Enum

No new enum values needed. Existing statuses cover the lifecycle:

| Status | Meaning in Split Context |
|--------|--------------------------|
| `open` | Child is payable |
| `split` | Parent has active children — ALSO means "pay remaining available" |
| `paid` | Child or parent fully paid |
| `voided` | Child voided |
| `cancelled` | Child cancelled |

The `splitResolution` field handles non-payment terminal states:
- `superseded` — another check absorbed this one's balance (e.g., parent pay-remaining)
- `merged_back` — balance returned to parent explicitly
- `merged_into_other` — balance absorbed by a sibling

---

## 4. Split Invariants (Hard Rules)

These must hold after every mutation:

1. A split family has exactly one authoritative family root (`splitFamilyRootId`).
2. `splitFamilyTotal` is defined only on that root and is **immutable** after first split creation.
3. `Order.total` is NOT the authoritative remaining balance once an order enters split mode. Use `computeSplitFamilyBalance()`.
4. A child with non-null `splitResolution` is no longer independently payable.
5. Structural ownership, allocation ownership, and item-share ownership are distinct and may not be inferred from `parentOrderId` alone. Use `splitClass`.
6. Any split/pay/merge/rebalance mutation must recompute family balance before commit.
7. Any split/pay/merge/rebalance mutation must lock the family root and active descendants consistently (FOR UPDATE).
8. **ItemShare does NOT mutate target `Order.total`.** Target check payable totals are computed by the family balance calculator (summing the check's own total + any ItemShare allocations targeting it). `Order.total` on the target remains unchanged. This prevents drift from dual writes and makes void/rebalance/re-split safe — one source computes, nothing to reverse.
9. **Void/reopen only unsupersedes children matched by `supersededBy`.** When a payment is voided on an order, only children whose `supersededBy` matches that order's ID are unsuperseded. Children superseded by a different payment/order are left resolved. This prevents cross-contamination when multiple independent supersede operations have occurred.

---

## 5. The Parent-As-Pay-Remaining Pattern

### Current behavior (broken)
```
Parent status='split' → payment blocked → staff stuck
```

### New behavior
```
Parent status='split' → system computes remaining unpaid family balance
                       → parent becomes payable for that amount
                       → paying parent resolves all unpaid children
                       → family closes
```

### Computation

```
familyTotal         = familyRoot.splitFamilyTotal (immutable)
paidAcrossFamily    = SUM(payment.amount) WHERE payment.status='completed'
                      AND payment.order IN (root + all active descendants)
remainingBalance    = familyTotal - paidAcrossFamily
```

### Server-side change (pay route)

Replace the current block:
```typescript
// CURRENT: blocks payment
if (order.status === 'split') {
  return err('Cannot pay a split parent order directly')
}
```

With:
```typescript
// NEW: parent = pay remaining
if (order.status === 'split') {
  const family = await computeSplitFamilyBalance(tx, order.id, order.locationId)
  if (family.remainingBalance <= 0) {
    await closeSplitFamily(tx, order.id, order.locationId)
    return ok({ success: true, message: 'Split family already fully paid' })
  }
  effectiveOrderTotal = family.remainingBalance
  isSplitParentPayRemaining = true
}
```

### What happens when parent is paid

1. Payment recorded on the parent order for the remaining amount
2. All unpaid active children marked `splitResolution: 'superseded'`, `supersededBy: parent.id`
3. Parent status → `paid`
4. Family closed

### UI (Android register)

- Split chips row: `[1-1 $30 PAID] [1-2 $30] [1-3 $30] [Parent: Pay Remaining $60]`
- Tapping "Parent" chip shows parent items + remaining balance
- Cash/Card buttons enabled, amount = remaining balance
- After payment, all chips disappear, order closes

---

## 6. Split Family Balance Calculator

One authoritative function used by ALL split operations.

```typescript
interface SplitFamilyBalance {
  familyRootId: string          // The authoritative family root
  familyTotal: number           // Original total (immutable)
  paidTotal: number             // Sum of completed payments across family
  remainingBalance: number      // familyTotal - paidTotal
  childBalances: Array<{
    orderId: string
    splitClass: 'structural' | 'allocation'
    allocated: number           // This child's share
    paid: number                // Payments on this child
    remaining: number           // allocated - paid
    resolution: string | null   // null = active, 'superseded', 'merged_back', 'merged_into_other'
  }>
  isFullyPaid: boolean
}

async function computeSplitFamilyBalance(
  tx: TxClient,
  familyRootId: string,
  locationId: string
): Promise<SplitFamilyBalance>
```

**Source-of-truth rules:**
- Read ceiling from family root's `splitFamilyTotal`
- Include completed payments across root + active/resolved descendants
- Exclude superseded children from independent payability
- Drive ALL payment validation and close-family behavior from this calculator, never raw `order.total`

**Definition of `allocated` per split class:**
- **Allocation children:** `allocated` = the assigned split total (set at split creation time)
- **Structural children:** `allocated` = current `order.total` derived from owned items, minus any superseded/merged adjustments if applicable
- Without this distinction, two developers may implement different balance math. Be explicit.

**Resolved child guard:** The calculator must skip children where `isResolvedSplit(child)` returns true when computing independent payable balances. Resolved children's payments still count toward `paidTotal` but they are not independently payable.

**ItemShare contribution rule:** `ItemShare` allocations MUST contribute to the target check's payable total in both the read model and the family-balance calculator, but MUST NOT create duplicate canonical item ownership. Shares are accounting overlays on the target check, not new items.

**Called by:** pay route, split route, open orders, merge/rebalance, closure logic.

---

## 7. Helper Functions

Use these everywhere. Do NOT rely on `itemCount > 0` or `parentOrderId != null`.

```typescript
export function isAllocationSplit(order: Pick<Order, 'splitClass'>): boolean {
  return order.splitClass === 'allocation'
}

export function isStructuralSplit(order: Pick<Order, 'splitClass'>): boolean {
  return order.splitClass === 'structural'
}

export function isResolvedSplit(order: Pick<Order, 'splitResolution'>): boolean {
  return order.splitResolution != null
}

export function isSplitFamilyRoot(order: Pick<Order, 'splitFamilyTotal' | 'status'>): boolean {
  return order.splitFamilyTotal != null
}
```

---

## 8. Split Operations

### 8.1 Create Even Split

**Input:** orderId, numWays
**Behavior:**
1. Lock family root FOR UPDATE
2. Compute proportional amounts with penny correction on last child
3. Create N children with `splitClass: 'allocation'`, `splitMode: 'even'`, `splitFamilyRootId: rootId`
4. If first split: set `root.splitFamilyTotal = root.total` (immutable snapshot)
5. Set `root.status = 'split'`
6. Items stay on root
7. Emit events

### 8.2 Create Custom Amount Split

**Input:** orderId, amounts[]
**Behavior:** Same as even but amounts are caller-specified.
**Validation:** SUM(amounts) must be > 0 and <= source remaining balance. Unallocated remainder stays on source.

### 8.3 Create By-Item Split

**Input:** orderId, itemIds[]
**Behavior:**
1. Lock family root FOR UPDATE
2. Move selected items to new child order
3. Child: `splitClass: 'structural'`, `splitMode: 'by_item'`, `splitFamilyRootId: rootId`
4. Recalculate parent subtotal/tax/total from remaining items
5. If first split: set `root.splitFamilyTotal`
6. Set `root.status = 'split'`

### 8.4 Create By-Seat / By-Table Split

Same as by-item but grouping logic differs.

### 8.5 Split Item N-Ways

**Input:** orderId, itemId, numWays, targetOrderIds[] (optional)
**Behavior:**
1. Lock source order FOR UPDATE
2. Compute per-share amount with penny correction on final share
3. Compute per-share tax and item-level discount allocation (proportional)
4. Create `ItemShare` entries, each targeting a check
5. If target checks don't exist, create them as allocation children with `splitFamilyRootId: rootId`
6. Source item stays canonical on its order — shares are accounting entries only

**Receipt display:**
```
  1/3 Bacon Wrapped Ribeye    $18.33
```

**Payment:** When a check with item shares is paid, shares on that check are marked `resolvedAt`, `resolvedByPaymentId`. The family balance calculator includes item shares in its computation.

### 8.6 Merge / Supersede

**Input:** sourceChildId, targetOrderId (or 'parent')
**Behavior:**
1. Lock family FOR UPDATE
2. Compute source child's remaining balance
3. If target is parent: mark source `splitResolution: 'merged_back'`
4. If target is another child: mark source `splitResolution: 'merged_into_other'`, `supersededBy: target`
5. Recalculate family balance
6. Source child remains historically auditable — do NOT delete it

### 8.7 Rebalance Remaining

**Input:** parentOrderId, strategy ('even' | amounts[])
**Behavior:**
1. Lock family FOR UPDATE
2. Identify unpaid active children only
3. Compute total unpaid remaining
4. Redistribute across unpaid children (even or custom)
5. Paid children are NEVER mutated retroactively

---

## 9. Nested Composition Rules

### Allowed Compositions

| Source Class | Can Split Into | Notes |
|--------------|---------------|-------|
| Structural child | Structural (by_item) | Items move from child to grandchild |
| Structural child | Allocation (even, custom) | Child becomes a mini-parent |
| Allocation child | Allocation (even, custom) | Sub-allocate the allocation |
| Allocation child | Structural | **NOT ALLOWED** — allocation children have no items to move |
| Any check with items | Item N-ways | Always allowed if check owns canonical items |

### Guard Conditions

A source may only be re-split if:
- `splitResolution IS NULL` (not superseded/merged)
- Remaining payable balance > 0
- For structural: has canonical items to move or split
- For allocation: has unpaid allocated amount
- New split applies only to unresolved remaining value, never to already-resolved value

### Family vs Sub-Family Rule

- Re-splitting a child creates a local sub-family for that child's remaining balance
- The sub-family still rolls up financially to the **original** family root
- Grandchildren get `splitFamilyRootId = original root`, NOT the intermediate child
- Local operations can treat the child as local source for its own descendants
- Global payment ceiling always traces back to the original family root

---

## 10. Concurrency & Locking Rules

All of these operations must lock the family root and active descendants before recomputing and committing:

- Split creation
- Payment (child or parent pay-remaining)
- Merge / supersede
- Rebalance
- Void/reopen affecting split-family payments

### Hard Rules

1. Only one mutating split-family operation may commit at a time.
2. Stale client totals must fail safely and require refresh.
3. Parent pay-remaining must not race with child payment on another terminal.
4. A child being paid cannot be merged/rebalanced concurrently.
5. Rebalance applies only to unresolved remaining balances.
6. Use FOR UPDATE on family root + all active descendants (existing pattern from pay route lines 1600-1610).

---

## 11. Pre-Auth & Existing Payment Policy

Keep rollout conservative:

- Do NOT create new splits when completed payments already exist, unless re-split-of-remaining is explicitly implemented and tested.
- Do NOT create new splits while active pre-auth hold exists, unless a dedicated pre-auth tab split workflow is designed.
- These match existing guardrails in the split route and reduce rollout risk.

---

## 12. Payment Rules

### Parent Pay-Remaining

Replace current pay-route block on split parent with:
1. Compute authoritative family remaining balance
2. If remaining <= 0, close family
3. Otherwise allow parent payment up to remaining balance
4. After payment, supersede all unpaid active children
5. Close family

### Child Payment

When paying a child:
1. Child must not have non-null `splitResolution`
2. Validate against that child's remaining payable amount
3. Also validate against family remaining ceiling
4. After payment, recompute family balance
5. If family fully paid, close family

### Structural Child Absorption

If parent pay-remaining absorbs unresolved structural children:
- Do NOT delete them
- Do NOT implicitly move their items back
- Keep them historically auditable
- Mark `splitResolution: 'superseded'`

### Payment Validation (pay route)

```typescript
// 1. Parent pay-remaining
if (order.status === 'split') {
  const family = await computeSplitFamilyBalance(tx, order.id, order.locationId)
  if (family.remainingBalance <= 0) {
    await closeSplitFamily(tx, order.id, order.locationId)
    return earlyReturn(ok({ success: true, message: 'Family already paid' }))
  }
  effectiveTotal = family.remainingBalance
}

// 2. Child payment
if (order.parentOrderId) {
  const rootId = order.splitFamilyRootId || order.parentOrderId
  const family = await computeSplitFamilyBalance(tx, rootId, order.locationId)
  const thisChild = family.childBalances.find(c => c.orderId === order.id)
  if (!thisChild || thisChild.resolution) {
    return earlyReturn(err('This split check is no longer payable'))
  }
}

// 3. After payment — close family if done
if (orderIsPaid) {
  const rootId = order.splitFamilyRootId || order.parentOrderId || order.id
  const family = await computeSplitFamilyBalance(tx, rootId, order.locationId)
  if (family.isFullyPaid) {
    await closeSplitFamily(tx, rootId, order.locationId)
  }
}
```

### closeSplitFamily()

**Scope:** Resolves all active non-root descendants in the family, then marks the family root paid. The root itself is NOT included in the descendant updateMany — it is updated separately with explicit paid/closed fields.

```typescript
async function closeSplitFamily(tx, familyRootId, locationId) {
  // Mark all unpaid active DESCENDANTS as superseded (not the root itself)
  await tx.order.updateMany({
    where: {
      OR: [
        { parentOrderId: familyRootId },
        { splitFamilyRootId: familyRootId },
      ],
      id: { not: familyRootId }, // exclude root from descendant update
      status: { notIn: ['paid', 'voided', 'cancelled'] },
      splitResolution: null,
    },
    data: {
      splitResolution: 'superseded',
      supersededBy: familyRootId,
      supersededAt: new Date(),
    }
  })

  // Close family root (separate, explicit update)
  await OrderRepository.updateOrder(familyRootId, locationId, {
    status: 'paid',
    paidAt: new Date(),
    closedAt: new Date(),
  }, tx)

  // Emit closure event (once, on root only)
  void emitOrderEvent(locationId, familyRootId, 'ORDER_CLOSED', {
    closedStatus: 'paid',
    reason: 'Split family fully paid',
  })
}
```

---

## 13. Open Orders Display

### Rules

| Order State | Visible? | Display |
|-------------|----------|---------|
| Parent `status='split'`, remaining > 0 | YES | "Pay Remaining $XX.XX" badge |
| Parent `status='split'`, all paid | NO | Auto-closed by closeSplitFamily |
| Allocation child, active | YES | Allocated amount, displayNumber "1-1" |
| Allocation child, resolved | NO | Filtered by `splitResolution IS NOT NULL` |
| Structural child, active | YES | Own items + total |
| Structural child, resolved | NO | Filtered out |

### Filter change

```typescript
NOT: [
  // ... existing filters ...
  { splitResolution: { not: null } },
]
```

### Android register

- Split chips: active children + parent "Pay Remaining" chip
- Tapping allocation child: parent items (read-only) + child total
- Tapping structural child: child's own items + total
- Tapping parent chip: all items + remaining balance + Cash/Card enabled
- After family closes: all chips disappear, navigate to next order
- Payment enablement: use `splitClass` + `total > 0`, NOT `itemCount > 0`

---

## 14. Receipt Behavior

| Split Class | Receipt Shows |
|-------------|---------------|
| Structural child | Child's own items + modifiers + totals |
| Allocation child | "Split check — [displayNumber]" + allocated total + payment |
| Item-share | "1/3 [Item Name]" + share amount |
| Parent pay-remaining | "Remaining balance" + parent items + payment |

---

## 15. Acceptance Scenarios

### Scenario 1: Even split → pay one → pay remaining

```
Order: 3 items totaling $90
Action: Even split 3 ways → $30, $30, $30
Pay: Child 1-1 pays $30 cash
Action: Tap parent → shows "Pay Remaining $60"
Pay: Parent pays $60 cash
Result: Children 1-2 and 1-3 superseded, parent paid, tab closed
```

### Scenario 2: By-item split → sub-split one child evenly

```
Order: Items A($20), B($30), C($40) = $90
Action: By-item split → C moves to child
Parent: A+B = $50, Child: C = $40
Action: Child split evenly 2 ways → $20, $20
Pay: Grandchild 1 pays $20, Grandchild 2 pays $20
Pay: Parent pays $50
Result: All closed. splitFamilyRootId traces to original parent for all descendants.
```

### Scenario 3: Structural split → one pays → parent absorbs rest

```
Order: Seat 1 ($30), Seat 2 ($25), Seat 3 ($35) = $90
Action: Split by seat → 3 structural children
Pay: Seat 2 pays $25
Action: Tap parent → shows "Pay Remaining $65"
Pay: Parent pays $65
Result: Seat 1 and Seat 3 superseded (items stay, historically auditable), parent paid, family closed
```

### Scenario 4: Item split 3 ways

```
Order: Ribeye $55
Action: Split item 3 ways → ItemShare entries $18.33, $18.33, $18.34
Create: 3 allocation children (or shares on existing checks)
Pay: Each share paid individually
Result: All shares resolved, parent closes
```

### Scenario 5: Mixed composition

```
Order: Apps $25, Entree $40, Bottle $60 = $125
Action: By-item → Apps+Entree to Child A, Bottle stays on parent
Action: Bottle split 2 ways → $30 share to Child A, $30 share to Child B (new)
Child A: Apps($25) + Entree($40) + 1/2 Bottle($30) = $95
Child B: 1/2 Bottle($30) = $30
Parent: remaining = $0
Pay: Child A pays $95, Child B pays $30
Result: Family closed
```

### Scenario 6: Concurrency — child payment races parent pay-remaining

```
Terminal 1: Paying child 1-2 ($30)
Terminal 2: Paying parent remaining ($60) at the same time
FOR UPDATE lock on family root + descendants → one wins, one blocks
Winner commits → loser recalculates → either succeeds with adjusted remaining or fails safely with stale-balance error
No double collection, no invalid closure
```

### Scenario 7: Void/reopen after partial pay + supersede

```
Order: Even split 3 ways → $30, $30, $30
Pay: Child 1-1 pays $30
Action: Parent pays remaining $60 → children 1-2, 1-3 superseded (supersededBy = parent.id)
Action: Void the parent payment ($60)
Result: Parent reopens, children 1-2 and 1-3 un-supersede, family remaining = $60
```

**Exact void/reopen mutation sequence:**

1. Void the payment record on the parent (existing void flow — Payment.status → 'voided')
2. Parent `status` → `split` (reopen, since it still has an active split family with `splitFamilyTotal` set)
3. Clear `splitResolution`, `supersededBy`, `supersededAt` on children WHERE `supersededBy = parent.id` ONLY
4. Children whose `supersededBy` points to a DIFFERENT order are left resolved (no cross-contamination)
5. Recompute family balance via `computeSplitFamilyBalance()`
6. Emit events in order: `PAYMENT_VOIDED` on parent, then `ORDER_REOPENED` on each unsuperseded child
7. Android/client receives socket events and refreshes split chips + open orders

---

## 16. Migration Guidance

### Conservative approach

Do NOT aggressively backfill all historical child splits. Legacy splits may be structural or allocation and classification is ambiguous.

### Safe backfill rule

Only backfill a legacy child as `splitClass='allocation'`, `splitMode='even'` if it clearly matches:
- `parentOrderId IS NOT NULL`
- Zero non-deleted items
- Non-zero total
- Clearly looks like legacy even/custom allocation behavior

### Runtime fallback

During rollout, if `splitClass IS NULL`:
- Treat children with items as structural
- Treat children without items as allocation
- Log a warning for manual review

**Precedence rule:** Explicit stored `splitClass` ALWAYS wins over fallback inference. Runtime fallback is a migration bridge only, not permanent behavior. This prevents mixed-rollout bugs where some code paths read the stored value and others infer.

### Migration backfill SQL

Include this one-liner in migration 118 to immediately classify obvious legacy even splits:

```sql
UPDATE "Order"
SET "splitClass" = 'allocation',
    "splitMode" = 'even',
    "splitFamilyRootId" = "parentOrderId"
WHERE "parentOrderId" IS NOT NULL
  AND "splitClass" IS NULL
  AND (SELECT COUNT(*) FROM "OrderItem"
       WHERE "orderId" = "Order".id AND "deletedAt" IS NULL) = 0;
```

This classifies only children with zero items — safe for legacy even/custom allocation splits. Structural splits (which have items) are left NULL for runtime fallback or manual classification.

### Audit query

Provide a report/query for legacy ambiguous split families so ops can review and classify.

---

## 17. Implementation Phases

### Phase 1: Schema + Family Balance Calculator (server only)

- Add `splitClass`, `splitMode`, `splitFamilyRootId`, `splitFamilyTotal`, `splitResolution`, `supersededBy`, `supersededAt` to Order
- Create `ItemShare` model
- Migration script with conservative backfill
- Build `computeSplitFamilyBalance()` function
- Build `closeSplitFamily()` function
- Build helper functions (`isAllocationSplit`, `isStructuralSplit`, `isResolvedSplit`)
- Unit tests for balance calculator with all 7 scenarios
- Audit query for legacy splits

### Phase 2: Parent-As-Pay-Remaining (server + Android)

- Modify pay route: remove parent payment block, add pay-remaining logic
- Modify pay route: use family balance calculator for ALL split payment validation
- Fix `err` → `caughtErr` bug in parent closure catch block
- Modify pay route: use `closeSplitFamily()` instead of inline closure logic
- Concurrency hardening: ensure FOR UPDATE covers family root + descendants
- Android: add parent chip to split chips row with remaining balance
- Android: enable payment on parent when `status='split'`
- E2E test: Scenario 1, Scenario 6

### Phase 3: Allocation Split Hardening (server + Android)

- Set `splitClass` + `splitMode` + `splitFamilyRootId` on all split creation functions
- Skip `syncItemCountAndTotals` for `splitClass='allocation'` (not `parentOrderId` heuristic)
- Android: show parent items for allocation children, own items for structural children
- Android: enable Cash/Card based on `splitClass` + `total > 0`, not `itemCount > 0`
- Open orders: filter by `splitResolution`, show remaining badge on parent
- Remove all `itemCount > 0` and `parentOrderId != null` heuristics
- E2E test: Scenarios 2, 3

### Phase 4: Item Share Splits (server + Android)

- Implement `ItemShare` CRUD
- Modify `splitItemNWays` to create `ItemShare` entries
- Penny distribution + tax + item-discount allocation logic
- Receipt formatting for shares ("1/3 Ribeye")
- Family balance calculator includes item shares
- Android: render share entries in order panel
- E2E test: Scenario 4

### Phase 5: Nested Composition + Merge/Rebalance (server + Android)

- Allow structural/allocation children to become split sources
- Merge operation (child → parent or child → child)
- Rebalance operation (redistribute unpaid across active children)
- Composition guard rules enforcement
- Void/reopen with split family recomputation (Scenario 7)
- E2E test: Scenarios 5, 7

---

## 18. Files That Will Change

### Server (gwi-pos)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add split fields to Order, add ItemShare model |
| `scripts/migrations/118-split-family-fields.js` | Migration + conservative backfill |
| `src/lib/domain/split-order/family-balance.ts` | NEW — family balance calculator |
| `src/lib/domain/split-order/close-family.ts` | NEW — family closure logic |
| `src/lib/domain/split-order/split-helpers.ts` | NEW — isAllocationSplit, isStructuralSplit, isResolvedSplit |
| `src/lib/domain/split-order/even-split.ts` | Set splitClass, splitMode, splitFamilyRootId, splitFamilyTotal |
| `src/lib/domain/split-order/item-split.ts` | Set splitClass, splitMode, splitFamilyRootId |
| `src/lib/domain/split-order/seat-split.ts` | Set splitClass, splitMode, splitFamilyRootId |
| `src/lib/domain/split-order/table-split.ts` | Set splitClass, splitMode, splitFamilyRootId |
| `src/lib/domain/split-order/types.ts` | Add SplitClass, SplitFamilyBalance, SplitResolution types |
| `src/app/api/orders/[id]/pay/route.ts` | Parent pay-remaining, family balance validation, fix err→caughtErr, use closeSplitFamily |
| `src/app/api/orders/[id]/split/route.ts` | Pass splitClass/splitMode/splitFamilyRootId to creation functions |
| `src/app/api/orders/open/route.ts` | Filter superseded children, add remaining badge, use splitClass |
| `src/app/api/orders/[id]/route.ts` | Include splitClass, splitResolution, splitFamilyRootId in responses |

### Android (gwi-android-register)

| File | Change |
|------|--------|
| `data/remote/dto/OrderDtos.kt` | Add splitClass, splitResolution, splitFamilyRootId, splitFamilyTotal |
| `data/remote/dto/ServerOrderMapper.kt` | Map new fields |
| `data/local/entity/CachedOrderEntity.kt` | Add splitClass, splitResolution, splitFamilyRootId columns |
| `data/local/AppDatabase.kt` | Room migration for new columns |
| `data/repository/OrderSyncRepository.kt` | Skip syncItemCountAndTotals for splitClass='allocation' |
| `ui/pos/components/SplitChipsRow.kt` | Add parent "Pay Remaining" chip |
| `ui/pos/components/SendButtonRow.kt` | Enable payment based on splitClass + total, not itemCount |
| `ui/pos/components/OpenOrdersPanel.kt` | Use displayNumber, filter resolved, show remaining badge |
| `ui/pos/OrderViewModel.kt` | Handle parent pay-remaining, load parent items for allocation children |
| `ui/pos/components/SplitCheckSheet.kt` | Pass splitClass context to split creation |

---

## 19. Questions Resolved

| # | Question | Answer |
|---|----------|--------|
| 1 | Source of truth for remaining balance? | `computeSplitFamilyBalance()` — payments across family vs `splitFamilyTotal` on root |
| 2 | Allocation splits: Order rows or separate table? | Order rows with `splitClass='allocation'`. Simpler, works with existing payment/closure. |
| 3 | Item-share representation? | New `ItemShare` model with `resolvedAt` + `resolvedByPaymentId`. Not duplicated items. |
| 4 | Can partially-paid children be re-split? | Yes, their remaining balance can be sub-split. |
| 5 | Allowed nesting? | Structural→structural, structural→allocation, allocation→allocation. NOT allocation→structural. |
| 6 | Receipt for allocation checks? | "Split check [displayNumber]" + allocated total + payment details. |
| 7 | Where does "pay remaining" live? | The parent order itself. Tap parent chip → pay remaining balance. |
| 8 | Terminal states for superseded children? | `splitResolution` field. Historically auditable, not independently payable. |
| 9 | Family root for nested splits? | `splitFamilyRootId` always points to original root, even for grandchildren. |
| 10 | What about partially paid children absorbed by parent? | Structural children keep their items, just marked `splitResolution: 'superseded'`. |
| 11 | Void/reopen after supersede? | Un-supersede ONLY children whose `supersededBy` matches the voided order. Exact 7-step sequence in Scenario 7. |
| 12 | Does ItemShare update target Order.total? | **NO.** Target `Order.total` is never mutated by shares. Family balance calculator computes payable totals by summing `Order.total + SUM(ItemShare.allocatedAmount)` for each target check. This is a calculator overlay, not a stored mutation. |
| 13 | Stored splitClass vs runtime fallback? | Stored `splitClass` ALWAYS wins. Runtime inference (items → structural, no items → allocation) is a migration bridge only. |

---

## 20. What NOT To Do

- Do NOT create phantom/reference item rows for allocation children
- Do NOT duplicate items for even splits
- Do NOT add more `itemCount > 0` workarounds
- Do NOT infer split type from `parentOrderId` alone — use `splitClass`
- Do NOT use raw `Order.total` as family payment truth after split mode begins — use calculator
- Do NOT patch UI rendering without fixing the domain model first
- Do NOT add "merge" as a separate top-level operation — parent-as-pay-remaining covers 90% of the need
- Do NOT backfill historical splits aggressively without classification safeguards
- Do NOT create new splits when completed payments exist unless re-split-of-remaining is explicitly implemented
- Do NOT create new splits while active pre-auth hold exists unless a dedicated workflow is designed
