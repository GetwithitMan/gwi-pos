# Skill 415: Split Payment, Void & Merge Fixes

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Split payment, void, and merge flows had critical race conditions, missing socket events, stale cache, inventory not deducting, and fractional modifier pricing bugs. Ten distinct bugs were identified across five API routes — from split creation through payment, voiding, and merge-back.

## Solution

### Bug 1 (CRITICAL): Pay-All-Splits Inventory on Empty Parent — `pay-all-splits/route.ts`

**Problem:** `deductInventoryForOrder()` was called on the parent order after all items had been moved to split children. The parent had zero items, so no inventory was deducted for any split payment.

**Fix:** Iterate over each split child and call `deductInventoryForOrder()` on each child individually, so inventory deduction covers all items across all splits.

### Bug 2 (CRITICAL): Parent Auto-Close Outside Transaction — `pay/route.ts`

**Problem:** After paying the last split child, the parent order was updated to `paid` status outside the database transaction. If two split children were paid simultaneously, both could read the parent as `split` status, both would mark it `paid`, and one payment's state could be lost.

**Fix:** Moved parent auto-close logic inside the transaction with a `FOR UPDATE` lock on the parent row. Only one concurrent payment can read and update the parent status at a time.

### Bug 3 (CRITICAL): Missing Socket When Parent → Paid — `pay/route.ts`

**Problem:** When the last split child payment auto-closed the parent, no socket events were dispatched. Other terminals still showed the parent order as open on the floor plan, and the open orders list was stale.

**Fix:** Added `dispatchOpenOrdersChanged()`, floor plan table status update, and `invalidateSnapshotCache()` when parent transitions to `paid`.

### Bug 4 (CRITICAL): Fractional Split Modifiers Price=0 — `split-tickets/route.ts`

**Problem:** When splitting an order with fractional quantities (e.g., 1 item split across 2 checks), modifiers on the split items had their price set to `0` instead of being proportionally divided.

**Fix:** Proportional modifier pricing — each modifier's price is multiplied by `(splitQty / originalQty)` to maintain correct pricing ratios on fractional splits.

### Bug 5 (HIGH): Parent Totals Stale After Child Void — `comp-void/route.ts`

**Problem:** After voiding an item on a split child, the parent order's totals (subtotal, tax, total) were not recalculated. The parent displayed stale totals that included the voided item's amounts.

**Fix:** After voiding, sum all sibling split children's totals and update the parent order's subtotal, tax, and total inside the same transaction.

### Bug 6 (HIGH): Missing Socket + Cache on Unsplit Merge — `split-tickets/route.ts`

**Problem:** When merging split children back into the parent (unsplit), no socket events or cache invalidation were dispatched. Other terminals didn't see the merge until manual refresh.

**Fix:** Added socket dispatch (`dispatchOpenOrdersChanged`), `invalidateSnapshotCache()`, and floor plan table status update after successful merge.

### Bug 7 (HIGH): Split Merge Race (Payment Between Check/Delete) — `split-tickets/route.ts`

**Problem:** During unsplit/merge, a payment could be processed on a split child between the time the merge checked for unpaid children and the time it deleted them. This caused data loss — a paid child could be deleted.

**Fix:** `FOR UPDATE` locks on all split children inside the transaction, plus a re-check that no children have been paid since the lock was acquired. If a payment snuck in, the merge aborts with an error.

### Bug 8 (HIGH): Loyalty Points Uses Total Not Subtotal — `pay-all-splits/route.ts`

**Problem:** Loyalty points calculation used `s.total` (which includes tax) instead of `s.subtotal`. Customers earned points on tax amounts, inflating loyalty rewards.

**Fix:** Changed loyalty points calculation from `s.total` to `s.subtotal`.

### Bug 9 (MEDIUM): No Parent Validation on Child Payment — `pay/route.ts`

**Problem:** A payment could be processed on a split child even if the parent order had already been closed, voided, or was in an invalid state. No validation checked the parent's status before accepting payment.

**Fix:** Before processing payment on a split child, verify the parent order exists and has `status='split'`. Reject payment if parent is in any other state.

### Bug 10 (MEDIUM): Missing Cache Invalidation on Split Delete — `split-tickets/[splitId]/route.ts`

**Problem:** When deleting a single split child, the snapshot cache and floor plan were not updated. Other terminals still showed the deleted split until the next full refresh.

**Fix:** Added `invalidateSnapshotCache()` and floor plan table status update after split child deletion.

## Files Modified

| File | Bugs | Changes |
|------|------|---------|
| `src/app/api/orders/[id]/pay/route.ts` | 2, 3, 9 | Parent auto-close inside tx with FOR UPDATE lock; socket + cache invalidation on parent→paid; parent status validation before child payment |
| `src/app/api/orders/[id]/pay-all-splits/route.ts` | 1, 8 | Inventory deduction per split child instead of empty parent; loyalty points uses subtotal |
| `src/app/api/orders/[id]/split-tickets/route.ts` | 4, 6, 7 | Proportional modifier pricing on fractional splits; socket + cache on merge; FOR UPDATE locks + payment re-check on merge |
| `src/app/api/orders/[id]/comp-void/route.ts` | 5 | Parent totals recalculated from sibling sums after child void |
| `src/app/api/orders/[id]/split-tickets/[splitId]/route.ts` | 10 | Cache invalidation + floor plan update on split delete |

## Testing

1. **Pay-all-splits inventory** — Split an order into 2 checks, pay all. Verify inventory deducted for all items (check inventory transactions).
2. **Concurrent last-split payment** — Two terminals pay the last two splits simultaneously. Parent should close exactly once, no duplicate updates.
3. **Parent socket on close** — Pay the last split child. Floor plan on other terminals should immediately show table as available.
4. **Fractional modifier pricing** — Split a 1-qty item with $2.00 modifier into 2 checks. Each check should show modifier at $1.00.
5. **Void on split child** — Void an item on a split child. Parent totals should update to reflect the void.
6. **Unsplit/merge** — Merge splits back. Other terminals should see the merge immediately via socket.
7. **Merge race** — Start a merge while another terminal is paying a split. Merge should abort if payment completed.
8. **Loyalty on split** — Pay splits and verify loyalty points earned on subtotal only (not tax).
9. **Child payment with closed parent** — Attempt to pay a split child after parent is already closed. Should reject.
10. **Split delete cache** — Delete a split child. Other terminals should see the update immediately.
