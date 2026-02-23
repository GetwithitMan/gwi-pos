# Skill 417: Deep Dive Round 2 Fixes

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Deep dive forensic testing round 2 — 4 parallel agents stress-tested floor plan, payments, splits/discounts/comps, and items/modifiers/kitchen flows. Found 23 bugs (5 CRITICAL, 8 HIGH, 8 MEDIUM, 2 LOW) across tip lifecycle, split sync, course firing, and floor plan.

## Solution

### Bug 1 (CRITICAL): Close-Tab Missing Inventory Deduction + Tip Allocation — `close-tab/route.ts`

**Problem:** When closing a bar tab via capture, inventory was never deducted for the order's items, and tips were never allocated to the tip-sharing system. Tab closes bypassed both the inventory and tip pipelines.

**Fix:** Added `deductInventoryForOrder()` + `allocateTipsForPayment()` after successful capture in the close-tab flow.

### Bug 2 (CRITICAL): Tip Adjustment Never Triggers Tip Allocation — `adjust-tip/route.ts`

**Problem:** When a customer adjusted their tip on a deferred receipt (post-payment tip entry), the tip amount was updated in the database but never flowed into the tip allocation system. Tip-outs were calculated without the adjusted tip.

**Fix:** Added `allocateTipsForPayment()` call for deferred receipt tips so adjusted tips are properly allocated.

### Bug 3 (CRITICAL): Unassigned Items Excluded from Course 1 Firing — `fire-course/route.ts`

**Problem:** Items without a course assignment (`courseNumber: null`) were excluded when firing Course 1. These unassigned items should fire with Course 1 by default, but the filter only matched `courseNumber === 1`.

**Fix:** Changed courseNumber filter to `{in: [1, null]}` so unassigned items fire with Course 1.

### Bug 4 (CRITICAL): Parent Discount Not Recalculated After Child Void — `comp-void/route.ts`

**Problem:** When a child split ticket item was voided, the parent order's discount totals were not recalculated. The parent kept the original discount amount even though the subtotal decreased.

**Fix:** Sum sibling `discountTotals` and update parent order's discount after child void.

### Bug 5 (CRITICAL): Comp-Void Payment Check Outside Transaction — `comp-void/route.ts`

**Problem:** The payment existence check in the comp-void route ran outside the database transaction. A concurrent payment could be created between the check and the void, leading to a void on an order with an active payment.

**Fix:** Moved payment check inside the transaction after `FOR UPDATE` lock on the order.

### Bug 6 (HIGH): Pay-All-Splits Missing Tip Allocation — `pay-all-splits/route.ts`

**Problem:** When paying all split tickets at once, tips were collected but never allocated to the tip-sharing system. The tip allocation step was missing from the batch payment loop.

**Fix:** Added tip allocation loop for each split child after payment.

### Bug 7 (HIGH): Void-Payment No Tip Reversal on DB Failure — `void-payment/route.ts`

**Problem:** When voiding a payment, if the database void failed after the processor void succeeded, the tip chargeback was never triggered. Tips remained allocated for a payment that was reversed at the processor.

**Fix:** Added `handleTipChargeback()` in the catch block to reverse tip allocation on DB failure.

### Bug 8 (HIGH): Partial Refund Doesn't Adjust Tip — `refund-payment/route.ts`

**Problem:** When issuing a partial refund, the tip amount stayed at the original value. A $100 order with a $20 tip refunded to $50 still showed a $20 tip.

**Fix:** Proportional tip reduction — tip is reduced by the same percentage as the refund amount.

### Bug 9 (HIGH): Reopen Doesn't Clear paidAt/closedAt — `reopen/route.ts`

**Problem:** When reopening a paid order, the `paidAt` and `closedAt` timestamps were not cleared. The order showed as open in status but retained payment timestamps, causing reporting discrepancies.

**Fix:** Added `paidAt: null, closedAt: null` to the reopen update.

### Bug 10 (HIGH): Parent itemCount Stale After Split Children Voided — `comp-void/route.ts`

**Problem:** When split child items were voided, the parent order's `itemCount` was not updated. The parent showed the original item count even though active items decreased.

**Fix:** Sum sibling active item quantities and update parent `itemCount`.

### Bug 11 (HIGH): Merge/Unsplit Doesn't Restore Discounts — `split-tickets/route.ts`

**Problem:** When merging split tickets back together, discounts that existed on the child splits were lost. The merge operation did not recalculate discounts from the children.

**Fix:** Recalculate discounts from child splits on merge.

### Bug 12 (HIGH): Temp Seat Cleanup Fire-and-Forget Fails Silently — `FloorPlanHome.tsx`

**Problem:** Temporary seat cleanup was fire-and-forget with no error handling. If the cleanup API call failed, stale temp seats accumulated without any indication.

**Fix:** Single retry with 1s delay on cleanup failure.

### Bug 13 (HIGH): No Quantity Validation on POST Items — `items/route.ts`

**Problem:** The POST endpoint for adding items to an order accepted any quantity value, including zero and negative numbers. This allowed creating items with invalid quantities.

**Fix:** Added `quantity >= 1` validation check.

### Bug 14 (MEDIUM): Void-Payment Allows Voiding Closed Orders — `void-payment/route.ts`

**Problem:** Payments on closed or cancelled orders could be voided. Voiding a payment on a closed order put the system in an inconsistent state where the order was closed but had no valid payment.

**Fix:** Added status check blocking void on `closed` and `cancelled` orders.

### Bug 15 (MEDIUM): Tip Adjustment Doesn't Update Order.total — `adjust-tip/route.ts`

**Problem:** When adjusting a tip, the individual payment's tip was updated but the parent `Order.total` was not recalculated. The order total was out of sync with the actual tip amount.

**Fix:** Recalculate `Order.total` with the new `tipTotal` after tip adjustment.

### Bug 16 (MEDIUM): Order Panel Doesn't Clear on Payment Race — `FloorPlanHome.tsx`

**Problem:** When a payment completed on another terminal, the order panel on the current terminal could still show the paid order due to a race condition between the socket event and the panel state.

**Fix:** Check Zustand store directly for order status before rendering panel.

### Bug 17 (MEDIUM): Socket 500ms Skip Window Too Fragile — `useActiveOrder.ts`

**Problem:** The 500ms skip window for ignoring own-mutation socket events was too short. Under network latency, the socket event could arrive after the skip window expired, causing a redundant refetch.

**Fix:** Increased skip window to 2000ms.

### Bug 18 (MEDIUM): Fire-Course No Order Status Validation — `fire-course/route.ts`

**Problem:** Courses could be fired on orders in any status, including paid, closed, voided, and cancelled. Firing a course on a completed order was nonsensical and could cause kitchen confusion.

**Fix:** Block course firing on `paid`, `closed`, `voided`, and `cancelled` orders.

### Bug 19 (MEDIUM): delayStartedAt Stamped on Non-Sent Items — `send/route.ts`

**Problem:** When sending items with a delay timer, the `delayStartedAt` timestamp was applied to all items on the order, not just the items being sent. Previously sent items got their delay timer reset.

**Fix:** Scoped `delayStartedAt` to only the `filterItemIds` being sent.

### Bug 20 (MEDIUM): Discount Exceeds Item Price Silently — `split-pricing.ts`

**Problem:** When splitting an order with percentage discounts, the proportional discount calculation could produce a discount amount exceeding the item price. This resulted in negative line items.

**Fix:** Cap proportional discount to item price.

### Bug 21 (MEDIUM): Rapid Split/Unsplit Orphans Items — `split-tickets/route.ts`

**Problem:** Rapidly splitting and unsplitting an order could leave orphaned items on child splits that no longer existed. The merge operation didn't clean up items on deleted children.

**Fix:** Clean child items on merge to prevent orphans.

### Bug 22 (LOW): Snapshot Coalescing Too Slow — `FloorPlanHome.tsx`

**Problem:** Floor plan snapshot refresh used time-based debouncing that was too slow under rapid changes. Multiple socket events within the debounce window were coalesced, delaying the UI update.

**Fix:** Counter-based coalescing with immediate refresh on first event.

### Bug 23 (LOW): Empty Coursing Fires Unnecessary API Calls — `useActiveOrder.ts`

**Problem:** Firing courses on an order with no items assigned to courses still triggered the API call. The server processed the request and returned success with zero items fired.

**Fix:** Early return with info toast when no items match the course.

## Files Modified

| File | Bugs | Changes |
|------|------|---------|
| `src/app/api/orders/[id]/close-tab/route.ts` | 1 | deductInventoryForOrder + allocateTipsForPayment after capture |
| `src/app/api/orders/[id]/adjust-tip/route.ts` | 2, 15 | allocateTipsForPayment for deferred tips; recalculate Order.total |
| `src/app/api/orders/[id]/fire-course/route.ts` | 3, 18 | courseNumber filter includes null; block paid/closed/voided/cancelled |
| `src/app/api/orders/[id]/comp-void/route.ts` | 4, 5, 10 | Parent discount recalc; payment check inside tx; parent itemCount update |
| `src/app/api/orders/[id]/pay-all-splits/route.ts` | 6 | Tip allocation loop for each split child |
| `src/app/api/orders/[id]/void-payment/route.ts` | 7, 14 | handleTipChargeback in catch; block void on closed/cancelled |
| `src/app/api/orders/[id]/refund-payment/route.ts` | 8 | Proportional tip reduction on partial refund |
| `src/app/api/orders/[id]/reopen/route.ts` | 9 | Clear paidAt + closedAt on reopen |
| `src/app/api/orders/[id]/split-tickets/route.ts` | 11, 21 | Restore discounts on merge; clean child items on merge |
| `src/components/floor-plan/FloorPlanHome.tsx` | 12, 16, 22 | Retry seat cleanup; check store on payment race; counter-based coalescing |
| `src/app/api/orders/[id]/items/route.ts` | 13 | quantity >= 1 validation on POST |
| `src/hooks/useActiveOrder.ts` | 17, 23 | 2000ms skip window; early return on empty course fire |
| `src/app/api/orders/[id]/send/route.ts` | 19 | delayStartedAt scoped to filterItemIds |
| `src/lib/split-pricing.ts` | 20 | Cap proportional discount to item price |

## Testing

1. **Close tab inventory + tips** — Open a bar tab, add items, close tab. Verify inventory deducted and tips allocated.
2. **Tip adjustment allocation** — Pay an order, adjust tip on deferred receipt. Verify new tip flows to tip allocation.
3. **Course 1 with unassigned items** — Add items without course assignment, fire Course 1. Unassigned items should fire.
4. **Parent discount after child void** — Split order with discount, void item on child. Parent discount should decrease.
5. **Concurrent payment + comp-void** — Attempt comp-void while payment is processing. Should be blocked by FOR UPDATE lock.
6. **Pay-all-splits tips** — Split order into 3, pay all at once with tips. All tips should be allocated.
7. **Void-payment DB failure tip reversal** — Simulate DB failure during void. Tips should be reversed via chargeback.
8. **Partial refund tip adjustment** — Refund 50% of order. Tip should reduce by 50%.
9. **Reopen timestamps** — Pay order, reopen it. paidAt and closedAt should be null.
10. **Parent itemCount after child void** — Split order, void items on child. Parent itemCount should update.
11. **Merge restores discounts** — Split with discounts, merge back. Discounts should be recalculated.
12. **Temp seat cleanup retry** — Simulate cleanup failure. Should retry once after 1s.
13. **POST items quantity validation** — POST item with quantity 0 or -1. Should return validation error.
14. **Void closed order payment** — Close an order, try to void payment. Should be rejected.
15. **Tip adjustment updates Order.total** — Adjust tip. Order.total should reflect new tip.
16. **Payment race panel clear** — Pay order from Terminal B. Terminal A panel should clear.
17. **Socket skip window** — Modify order, verify no redundant refetch within 2s.
18. **Fire course on paid order** — Try to fire course on paid order. Should be blocked.
19. **delayStartedAt scoping** — Send subset of items with delay. Previously sent items should not get new delayStartedAt.
20. **Discount cap on split** — Split order where discount would exceed item price. Should be capped.
21. **Rapid split/unsplit** — Split and unsplit rapidly. No orphaned items should remain.
22. **Snapshot coalescing** — Trigger rapid floor plan changes. UI should update immediately on first event.
23. **Empty course fire** — Fire course with no matching items. Should show info toast, no API call.
