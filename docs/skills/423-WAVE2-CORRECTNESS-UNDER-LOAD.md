# Skill 423: Wave 2 — Correctness Under Load

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Post-Wave-1 forensic audit identified 14 correctness issues that surface under real-world load: loyalty double-credits on payment retries, split-payment rounding errors, KDS clutter from paid/voided orders, non-reactive tax rates, unbounded print failures, and reports hiding voided items. These bugs are invisible in low-traffic testing but cause financial discrepancies, stale UI, and silent data loss at venue scale.

## Solution

### 14 Items Fixed Across 5 Focus Areas

| # | ID | Bug # | Area | Fix Summary |
|---|-----|-------|------|-------------|
| 1 | W2-P1 | 30 | Splits/Loyalty | Loyalty update moved inside `db.$transaction` + server-side idempotency key (`crypto.randomUUID()`) |
| 2 | W2-P2 | 31 | Splits | `Math.round(x * 100) / 100` on combinedTotal and each splitTotal |
| 3 | W2-P3/O1 | 32 | Splits/Inventory | `db.auditLog.create` on inventory deduction failure for manager visibility |
| 4 | W2-P4 | 33 | Splits | Split ticket subtotal double-discount investigated and fixed |
| 5 | W2-K1 | 18 | KDS | Paid orders limited to 2-hour window via `OR` clause (KDS + expo routes) |
| 6 | W2-K2 | 19 | KDS | Expo KDS filters voided items: `status: { not: 'voided' }` + `deletedAt: null` |
| 7 | W2-K3 | 17 | KDS/Entertainment | Lazy expiry check at start of KDS GET handler for entertainment sessions |
| 8 | W2-S1 | 36 | Store | Tax rate moved from module-level `let` to Zustand store state; `computeTotals` takes `taxRate` param |
| 9 | W2-S2 | 37 | Store | Toast queue already fixed in Wave 1 (ST1, cap at 25) — no additional change |
| 10 | W2-S3 | 39 | Store | `updateQuantity` logic inlined into single `set()` call |
| 11 | W2-O2 | 48 | Offline/Print | `dispatchPrintWithRetry` utility (retry once after 3s, audit log on failure), wired into KDS resend |
| 12 | W2-O3 | 38 | Offline | `toast.warning()` in `persistPendingItems` for localStorage size overflow and catch block |
| 13 | W2-R1 | — | Reports | Product Mix waste tracking section: separate query for voided/comped items, aggregated waste data |
| 14 | W2-R2 | — | Reopen | `calculateSimpleOrderTotals` recalculation from active items after payment voiding |

---

### W2-P1 (Bug #30): Loyalty Double-Credit on Pay-All Retry — `pay-all-splits/route.ts`

**Problem:** When a pay-all-splits request was retried (e.g., network timeout + client retry), the loyalty point update ran outside the database transaction. A retry could credit the customer's loyalty balance twice for the same payment.

**Fix:** Moved the loyalty update inside `db.$transaction` so it is atomic with the payment write. Added server-side idempotency key generation using `crypto.randomUUID()` to prevent duplicate processing on retries.

### W2-P2 (Bug #31): Pay-All-Splits Rounding Error — `pay-all-splits/route.ts`

**Problem:** Decimal-to-Number conversions in split payment calculations accumulated floating-point errors. A $33.33 three-way split could produce totals that don't sum to the original amount.

**Fix:** Applied `Math.round(x * 100) / 100` on `combinedTotal` and each `splitTotal` after Decimal-to-Number conversion, ensuring cent-level precision throughout the rounding pipeline.

### W2-P3/O1 (Bug #32): Inventory Deduction Silent Failure on Splits — `pay-all-splits/route.ts`

**Problem:** When inventory deduction failed during split payment processing, the failure was silently swallowed. Managers had no visibility into missed deductions, causing inventory counts to drift from reality.

**Fix:** Added `db.auditLog.create` call on deduction failure, creating a permanent audit trail entry that managers can review in the admin audit viewer.

### W2-P4 (Bug #33): Split Ticket Subtotal Double-Discount — `split-tickets/route.ts`

**Problem:** When splitting a ticket that had a discount applied, the discount was being applied twice to the subtotal calculation — once in the original order and again during split ticket generation.

**Fix:** Investigated the split-tickets route and corrected the discount application logic to prevent double-counting.

### W2-K1 (Bug #18): Paid Orders Clutter KDS — `kds/route.ts`, `kds/expo/route.ts`

**Problem:** Paid orders remained visible on the KDS indefinitely, cluttering the kitchen display with completed work. During busy service, kitchen staff had to scroll past dozens of old paid orders to find active ones.

**Fix:** Changed the status filter to use an `OR` clause with a 2-hour cutoff for paid orders. Paid orders older than 2 hours are automatically excluded from both the main KDS and expo KDS routes.

### W2-K2 (Bug #19): Expo KDS Shows Voided Items — `kds/expo/route.ts`

**Problem:** Voided and soft-deleted items appeared on the expo KDS display. Kitchen staff could see and attempt to prepare items that had already been voided by the server.

**Fix:** Added `status: { not: 'voided' }` and `deletedAt: null` to the items filter in the expo KDS query, excluding both voided and soft-deleted items.

### W2-K3 (Bug #17): Entertainment Sessions Never Auto-Expire — `kds/route.ts`

**Problem:** Entertainment sessions (timed rentals like bowling lanes or pool tables) that exceeded their block time were never automatically expired. They remained in "active" status indefinitely, requiring manual intervention.

**Fix:** Added a lazy expiry check at the start of the KDS GET handler. On each poll, any entertainment session past its block time is automatically transitioned to expired status before the response is returned.

### W2-S1 (Bug #36): Global Tax Rate Not Reactive — `order-store.ts`

**Problem:** The tax rate was stored in a module-level `let` variable, initialized once at import time. If the admin changed the tax rate in settings, the POS continued using the stale rate until the page was refreshed.

**Fix:** Moved the tax rate from a module-level `let` to Zustand store state, making it reactive. Updated `computeTotals` to accept `taxRate` as a parameter, sourced from the store. Changes to the tax rate now propagate immediately to all open terminals.

### W2-S2 (Bug #37): Toast Queue Unbounded — Already Fixed

**Problem:** Toast notifications could accumulate without limit, consuming memory and DOM nodes during long sessions.

**Fix:** Already addressed in Wave 1 (ST1) — toast queue is capped at 25 with timeout ID cleanup. No additional change required.

### W2-S3 (Bug #39): Multiple `set()` Per Interaction — `order-store.ts`

**Problem:** The `updateQuantity` action called `set()` to update the quantity, then called `calculateTotals()` which triggered a second `set()`. Two rapid state updates caused unnecessary re-renders and potential race conditions.

**Fix:** Inlined the `updateQuantity` logic into a single `set()` call that updates both the quantity and recalculated totals atomically.

### W2-O2 (Bug #48): Print Dispatch No Retry — `print-retry.ts` (new), `kds/route.ts`

**Problem:** When a print job failed (printer offline, network timeout), it was silently dropped with no retry and no record of the failure. Kitchen tickets could be permanently lost.

**Fix:** Created `dispatchPrintWithRetry` utility in `src/lib/print-retry.ts` that retries once after a 3-second delay and logs failures to the audit log. Wired the retry utility into the KDS resend flow.

### W2-O3 (Bug #38): localStorage Persistence Silent Fail — `order-store.ts`

**Problem:** When `persistPendingItems` exceeded the localStorage size quota or encountered any write error, the failure was silently caught and discarded. Pending items could be lost without the user knowing.

**Fix:** Added `toast.warning()` in the `persistPendingItems` function for both the size overflow condition and the general catch block, alerting the user when persistence fails.

### W2-R1: Product Mix Hides Voided Items — `reports/product-mix/route.ts`

**Problem:** The Product Mix report only showed sold items. Voided and comped items were completely excluded, giving managers no visibility into waste and loss patterns.

**Fix:** Added a waste tracking section with a separate query for voided and comped items. The response now includes aggregated waste data (count, total value, breakdown by void reason) alongside the standard sales mix.

### W2-R2: Reopen Doesn't Recalc Totals — `orders/[id]/reopen/route.ts`

**Problem:** When reopening a closed order (after voiding its payment), the order totals remained frozen at the original values. If items were voided before reopening, the totals included amounts for items that no longer existed.

**Fix:** Added `calculateSimpleOrderTotals` recalculation that recomputes subtotal, tax, and total from only the active (non-voided, non-deleted) items after payment voiding.

## Files Modified

| File | IDs | Changes |
|------|-----|---------|
| `src/app/api/orders/[id]/pay-all-splits/route.ts` | P1, P2, P3/O1 | Loyalty inside transaction + idempotency key; Math.round rounding; audit log on deduction failure |
| `src/app/api/orders/[id]/split-tickets/route.ts` | P4 | Double-discount fix in split ticket subtotal |
| `src/app/api/kds/route.ts` | K1, K3, O2 | 2-hour paid order cutoff; entertainment lazy expiry; print retry wired in |
| `src/app/api/kds/expo/route.ts` | K1, K2 | 2-hour paid order cutoff; voided + deleted item filter |
| `src/stores/order-store.ts` | S1, S3, O3 | Tax rate in Zustand state; single set() for updateQuantity; localStorage toast warning |
| `src/app/api/orders/[id]/reopen/route.ts` | R2 | Recalculate totals from active items after payment void |
| `src/app/api/reports/product-mix/route.ts` | R1 | Waste tracking section for voided/comped items |
| `src/lib/print-retry.ts` | O2 | New file: dispatchPrintWithRetry (1 retry after 3s + audit log) |

## Testing

1. **P1 — Loyalty idempotency** — Pay all splits, simulate retry. Verify loyalty credited exactly once.
2. **P2 — Rounding precision** — Split $100.00 three ways. Verify splits sum to exactly $100.00.
3. **P3/O1 — Deduction audit trail** — Trigger inventory deduction failure. Verify audit log entry created.
4. **P4 — Split ticket discount** — Apply discount to order, split into tickets. Verify discount applied once.
5. **K1 — Paid order cleanup** — Pay orders, wait 2+ hours. Verify they disappear from KDS.
6. **K2 — Voided items hidden** — Void an item. Verify expo KDS no longer shows it.
7. **K3 — Entertainment auto-expiry** — Start entertainment session, exceed block time. Verify auto-expired on next KDS poll.
8. **S1 — Tax rate reactivity** — Change tax rate in admin settings. Verify POS recalculates without page refresh.
9. **S3 — Single set()** — Update item quantity. Verify single render cycle (React DevTools profiler).
10. **O2 — Print retry** — Send print to offline printer. Verify retry after 3s and audit log on final failure.
11. **O3 — localStorage warning** — Fill localStorage near quota, trigger persistence. Verify warning toast.
12. **R1 — Waste tracking** — Void/comp several items. Check Product Mix report includes waste section.
13. **R2 — Reopen recalc** — Pay order, void a payment, reopen. Verify totals recalculated from active items.
