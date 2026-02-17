# Skill 356: Split Ticket Payment Bug Fix — Orphaned Items & Stale Parent

**Date:** February 16, 2026
**Commit:** `3219f2a`
**Domain:** Orders, Payments
**Status:** Complete

## Problem

Three bugs in the split ticket payment model caused guests to be undercharged and left orphaned/unpaid items on tables:

1. **Parent retained items after split**: Split creation copied items to children but left originals on the parent with stale totals. Parent had full item list + full total even though children owned copies.

2. **Pay route accepted split parents**: The pay route only blocked `status='paid'` and `status='closed'`. A `status='split'` parent could be paid directly with its stale totals.

3. **"Pay All" paid the parent**: The button called `onPaySplit(parentOrderId)` — sending the parent order (with stale totals) to the PaymentModal instead of paying individual split children.

### Real-World Impact

User splits a table → adds items → clicks "Pay All" → payment uses parent's pre-split snapshot → post-split items are orphaned as a new open order on the table → guest undercharged.

## Solution

### Fix 1: Zero out parent after split creation

**File:** `src/app/api/orders/[id]/split-tickets/route.ts` (POST handler)

- Changed: soft-delete ALL parent items (not just fractionally-split ones)
- Changed: zero out parent totals (`subtotal: 0, taxTotal: 0, total: 0`)
- Parent becomes an empty shell with `status='split'` — children own all items

### Fix 2: Block direct payment of split parents

**File:** `src/app/api/orders/[id]/pay/route.ts`

- Added guard after `paid`/`closed` check: `status === 'split'` → 400 error
- Message: "Cannot pay a split parent order directly. Pay individual split checks instead."

### Fix 3: "Pay All" pays children via payment loop

**File:** `src/components/orders/SplitCheckScreen.tsx`

- New `handlePayAll` callback: finds first unpaid split, calls `onPaySplit(unpaidSplits[0].id)`
- The existing `splitParentToReturnTo` pattern in `orders/page.tsx` returns to the split board after each payment, cycling through all unpaid splits automatically
- Button condition changed: `!splits.some(s => s.isPaid)` → `splits.some(s => !s.isPaid)` (shows even after partial payments)
- Button now displays aggregate unpaid total: `Pay All ($XX.XX)`

## Key Insight

The items POST route (`/api/orders/[id]/items`) already correctly blocks `status='split'` (requires `open` or `draft`). So items can't be added to a split parent via API. But the client may create a new draft order on the same table, which is invisible to the split system — that's a separate UX issue for the live split board project.

## Verification

1. Split creation → parent has 0 items, $0 total
2. `POST /api/orders/{parentId}/pay` → 400 "Cannot pay split parent"
3. "Pay All" → opens PaymentModal for first unpaid child split
4. Payment loop cycles through all unpaid splits
5. All splits paid → parent auto-marked paid (existing sibling check)
6. `npx tsc --noEmit` — clean
