# Skill 416: Chaos Test Fixes

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Comprehensive chaos testing simulating worst-case employee behavior (rapid clicks, wrong payments, card declines, concurrent terminal operations) revealed 19 bugs across payment, order, and floor plan flows.

## Solution

### Bug 1 (CRITICAL): isProcessing Orphaned After Card Decline — `PaymentModal.tsx`

**Problem:** When a card payment was declined, the `isProcessing` flag was never cleared. The payment modal became permanently locked — no further payment attempts were possible without closing and reopening the modal.

**Fix:** Added `finally{}` cleanup on all payment paths so `isProcessing` resets to `false` regardless of success, decline, or error.

### Bug 2 (CRITICAL): Items Modifiable After Partial Payment — `items/`, `comp-void/`

**Problem:** After a partial payment was applied to an order, items could still be added, removed, or modified. This allowed the order total to change after money had already been collected, creating accounting discrepancies.

**Fix:** Payment existence check on all mutation routes — if any payment exists on the order, item mutations are rejected.

### Bug 3 (CRITICAL): Datacap Void + DB Void Decoupled — `void-payment/route.ts`

**Problem:** Voiding a payment required two separate operations (Datacap void + DB void) that were not atomic. If the Datacap void succeeded but the DB void failed, the payment was reversed at the processor but still showed as paid in the system.

**Fix:** Unified route handles both Datacap void and DB void atomically in a single transaction.

### Bug 4 (CRITICAL): Comp Restore + Re-Void Double Inventory — `comp-void/route.ts`, `inventory/`

**Problem:** When a comped item was restored and then re-voided, inventory was deducted twice — once for the original void (waste) and again for the re-void. The restore step did not reverse the original deduction.

**Fix:** `restoreInventoryForRestoredItem()` reverses the original waste deduction when an item is restored, so re-voiding only deducts once.

### Bug 5 (CRITICAL): Order Number Race (Duplicates) — `orders/route.ts`, `schema.prisma`

**Problem:** Under concurrent order creation, two orders could receive the same order number because the number generation was not atomic. This caused duplicate order numbers in the system.

**Fix:** `@@unique` constraint on order number + transactional number generation with retry on conflict.

### Bug 6 (CRITICAL): Failed Capture Leaves Hanging Auth — `close-tab/route.ts`

**Problem:** When a tab capture (converting pre-auth to charge) failed, the original authorization was left hanging. The customer's card had a hold that would only expire after the bank's timeout period (typically days).

**Fix:** Auto-void the authorization on capture failure, releasing the hold on the customer's card immediately.

### Bug 7 (HIGH): Items Duplicated During Send — `useActiveOrder.ts`

**Problem:** When sending items to the kitchen, items in `pendingSavesRef` were appended to the background chain again, causing duplicate items to appear on the order.

**Fix:** Filter `pendingSavesRef` items from `bgChain` append to prevent double-sending.

### Bug 8 (HIGH): No Socket Listener for Active Order — `useActiveOrder.ts`

**Problem:** The active order hook had no socket listener for `orders:list-changed`. When another terminal modified the same order, the current terminal showed stale data until manual refresh.

**Fix:** Added `orders:list-changed` listener with own-mutation skip (ignores events triggered by the same terminal).

### Bug 9 (HIGH): Discount Doesn't Recalculate — `order-calculations.ts`, `items/`, `comp-void/`

**Problem:** When items were added, removed, or voided on an order with a percentage discount, the discount amount was not recalculated. The discount stayed at the original dollar amount even though the subtotal changed.

**Fix:** `recalculatePercentDiscounts()` called on all subtotal-changing operations to keep percentage discounts proportional.

### Bug 10 (HIGH): Empty Drafts Accumulate — `useActiveOrder.ts`

**Problem:** Tapping a table created a draft order. If the user navigated away without adding items, the empty draft persisted in the database. Over time, hundreds of empty draft orders accumulated.

**Fix:** `clearOrder()` soft-deletes empty drafts (orders with zero items and no payments) when the user navigates away.

### Bug 11 (HIGH): Deleted Items Not Dispatched — `items/[itemId]/route.ts`

**Problem:** When an item was deleted from an order, no socket event was dispatched. Other terminals and the open orders panel did not reflect the deletion.

**Fix:** Added `dispatchOpenOrdersChanged` on item delete to notify all terminals.

### Bug 12 (HIGH): Reopen After Payment No Cooldown — `reopen/route.ts`

**Problem:** A paid order could be immediately reopened, which caused table status confusion and potential double-charging. No cooldown or safety checks existed.

**Fix:** 60-second cooldown after payment before reopen is allowed + table status revert + cache invalidation on reopen.

### Bug 13 (HIGH): Multiple Drafts Same Table — `orders/route.ts`

**Problem:** Rapid table taps from multiple terminals could create multiple draft orders for the same table, since no lock prevented concurrent creation.

**Fix:** Table lock (`FOR UPDATE`) inside the creation transaction prevents concurrent draft creation for the same table.

### Bug 14 (HIGH): autosaveInFlightRef Stuck — `useActiveOrder.ts`

**Problem:** The `autosaveInFlightRef` could theoretically get stuck in a `true` state if an autosave failed without clearing the flag.

**Fix:** Already had `.finally()` cleanup — verified the existing implementation handles all failure paths correctly.

### Bug 15 (MEDIUM): No Max Tip Validation on CFD — `CFDTipScreen.tsx`

**Problem:** The customer-facing display accepted any tip amount, including unreasonably large tips. An accidental tap or intentional abuse could result in a tip larger than the order total.

**Fix:** Tips exceeding 50% of the order total trigger a confirmation screen asking the customer to verify the amount.

### Bug 17 (MEDIUM): Course Firing No Ordering — `fire-course/route.ts`

**Problem:** Courses could be fired to the kitchen in any order. A server could accidentally fire Course 3 before Course 1, causing kitchen confusion.

**Fix:** Prior-course check ensures earlier courses are fired first, with a `force` override parameter for intentional out-of-order firing.

### Bug 18 (MEDIUM): Quantity 0 Accepted by API — `items/[itemId]/route.ts`

**Problem:** The item update API accepted `quantity: 0`, which created ghost items with zero quantity that still appeared on orders and affected totals.

**Fix:** Validation rejects `quantity < 1` on item updates.

### Bug 19 (MEDIUM): Orphaned Seats No Warning — `seating/route.ts`

**Problem:** When removing a seat that had items assigned to it, the items were silently moved to the shared/no-seat bucket. The server had no indication that items were reassigned.

**Fix:** Response includes `movedItemsToShared` count + socket dispatch so the server sees how many items were moved.

### Bug 20 (MEDIUM): Cancelled Order Accepts Payment — `pay/route.ts`

**Problem:** Orders in `cancelled` or `voided` status could still accept payments because the pay route only checked for `paid` status.

**Fix:** Added `cancelled` and `voided` to the blocked status list in the pay route.

## Files Modified

| File | Bugs | Changes |
|------|------|---------|
| `src/components/payment/PaymentModal.tsx` | 1 | finally{} cleanup on all payment paths |
| `src/app/api/orders/[id]/items/route.ts` | 2 | Payment existence check before item mutations |
| `src/app/api/orders/[id]/comp-void/route.ts` | 2, 4, 9 | Payment existence check; restoreInventoryForRestoredItem(); recalculatePercentDiscounts() |
| `src/app/api/orders/[id]/void-payment/route.ts` | 3 | Unified Datacap + DB void in single atomic operation |
| `src/lib/inventory/void-waste.ts` | 4 | restoreInventoryForRestoredItem() function |
| `src/lib/inventory/index.ts` | 4 | Export restoreInventoryForRestoredItem |
| `src/app/api/orders/route.ts` | 5, 13 | Transactional order number generation; table FOR UPDATE lock |
| `prisma/schema.prisma` | 5 | @@unique constraint on order number |
| `src/app/api/orders/[id]/close-tab/route.ts` | 6 | Auto-void auth on capture failure |
| `src/hooks/useActiveOrder.ts` | 7, 8, 10, 14 | Filter pendingSaves from bgChain; orders:list-changed listener; clearOrder() soft-deletes empty drafts; verified autosaveInFlightRef cleanup |
| `src/lib/order-calculations.ts` | 9 | recalculatePercentDiscounts() |
| `src/app/api/orders/[id]/items/[itemId]/route.ts` | 11, 18 | dispatchOpenOrdersChanged on delete; quantity >= 1 validation |
| `src/app/api/orders/[id]/reopen/route.ts` | 12 | 60s cooldown + table revert + cache invalidation |
| `src/components/cfd/CFDTipScreen.tsx` | 15 | >50% tip confirmation screen |
| `src/app/api/orders/[id]/fire-course/route.ts` | 17 | Prior-course check with force override |
| `src/app/api/orders/[id]/seating/route.ts` | 19 | movedItemsToShared count + socket dispatch |
| `src/app/api/orders/[id]/pay/route.ts` | 20 | cancelled/voided added to blocked statuses |

## Testing

1. **Card decline recovery** — Attempt card payment, let it decline. Verify payment modal is unlocked and another attempt can be made.
2. **Partial payment lock** — Pay part of an order with cash. Attempt to add/remove items. Should be rejected.
3. **Void atomicity** — Void a card payment. Verify both Datacap and DB are reversed atomically.
4. **Comp restore inventory** — Comp an item, restore it, then void it. Verify inventory deducted only once.
5. **Concurrent order numbers** — Create 10 orders rapidly from multiple terminals. All should have unique sequential numbers.
6. **Failed capture void** — Simulate capture failure on tab close. Verify auth is auto-voided.
7. **Send deduplication** — Add items and send quickly. Verify no duplicate items appear.
8. **Cross-terminal updates** — Modify an order from Terminal A. Terminal B should update via socket without refresh.
9. **Discount recalculation** — Apply 10% discount, then add items. Discount amount should increase proportionally.
10. **Empty draft cleanup** — Tap a table, navigate away without adding items. Draft should be soft-deleted.
11. **Item delete dispatch** — Delete an item. Other terminals should see the change immediately.
12. **Reopen cooldown** — Pay an order, immediately try to reopen. Should be blocked for 60 seconds.
13. **Table lock** — Two terminals tap the same empty table simultaneously. Only one draft should be created.
14. **CFD tip guard** — On CFD, enter a tip >50% of order total. Confirmation screen should appear.
15. **Course ordering** — Try to fire Course 2 before Course 1. Should be blocked unless force override.
16. **Zero quantity rejection** — Try to set item quantity to 0 via API. Should return validation error.
17. **Seat removal warning** — Remove a seat with items. Response should include moved items count.
18. **Cancelled order payment** — Try to pay a cancelled/voided order. Should be rejected.
