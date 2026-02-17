# Skill 359: Batch Pay All Splits API with Datacap Integration

**Date:** February 17, 2026
**Commit:** `a4c8894`
**Domain:** Orders / Payments / Splits
**Status:** Complete

---

## Problem

"Pay All" on split orders had two major UX issues:

1. **Individual cycling required**: Clicking "Pay All" only showed the first split's amount, then the user had to cycle through each split one by one via the PaymentModal. For a 4-way split, that meant 4 separate payment flows.
2. **No combined total**: Users wanted to see ONE combined total and make ONE payment for all remaining unpaid splits — common when a single guest picks up the whole tab.

Additionally:
3. **Split parent showed $0.00**: In OpenOrdersPanel, split parent orders displayed `$0.00` instead of the aggregate unpaid total of their children
4. **Bar mode savedOrderId desync**: Switching tabs in BartenderView did not update the savedOrderId, causing stale order references

## Solution

### New Batch Pay All Splits Endpoint

**`POST /api/orders/[id]/pay-all-splits`**

Atomically pays all unpaid split children of a parent order in a single transaction:

```typescript
// Request body
{
  paymentMethod: 'cash' | 'credit_card',
  amount: number,           // Combined total of all unpaid splits
  tipAmount?: number,
  // Card fields (when paymentMethod = 'credit_card')
  cardBrand?: string,
  cardLast4?: string,
  authCode?: string,
  datacapRecordNo?: string,
  // ... other Datacap fields
}

// Response
{
  data: {
    paidCount: number,
    paidOrderIds: string[],
    parentStatus: 'paid',
    totalPaid: number
  }
}
```

The endpoint:
1. Fetches all split children where `splitFromId = parentId` and `status != 'paid'`
2. Creates a Payment record for each child in a single Prisma transaction
3. Marks each child as `status: 'paid'`
4. Marks the parent as `status: 'paid'` (all children now paid)
5. Emits socket events for each paid order

### Pay All Splits Confirmation Modal

Two-step flow in SplitCheckScreen:

1. **Confirm step**: Shows combined unpaid total with Cash and Card buttons
2. **Datacap card step** (card only): DatacapPaymentProcessor shows the combined total on the card reader. On card approval, calls batch API with card details.

```
┌──────────────────────────────┐
│  Pay All Splits              │
│                              │
│  3 unpaid splits             │
│  Combined total: $87.50      │
│                              │
│  [Cash $87.50]  [Card $87.50]│
└──────────────────────────────┘
```

Cash flow: one tap → batch API → all splits paid → return to floor plan.

Card flow: tap Card → Datacap reader activates → card tapped/swiped → batch API with auth details → all splits paid → return to floor plan.

### Split Parent Display Fix (OpenOrdersPanel)

Added `getDisplayTotal()` helper that checks if an order has `status: 'split'`. If so, sums the totals of unpaid children instead of showing the parent's zeroed-out total:

```typescript
function getDisplayTotal(order: OpenOrder): number {
  if (order.status === 'split' && order.splitChildren?.length) {
    return order.splitChildren
      .filter(c => c.status !== 'paid')
      .reduce((sum, c) => sum + c.total, 0)
  }
  return order.total
}
```

### Bar Mode savedOrderId Sync

`BartenderView` now fires `onSelectedTabChange` callback when switching tabs, which updates `savedOrderId` in the parent `orders/page.tsx` state. Prevents stale order references when opening PaymentModal from bar mode.

## Key Files

| File | Changes |
|------|---------|
| `src/app/api/orders/[id]/pay-all-splits/route.ts` | **NEW** — batch payment endpoint |
| `src/app/(pos)/orders/page.tsx` | Wires Pay All flow, bar mode savedOrderId sync |
| `src/components/orders/SplitCheckScreen.tsx` | Pay All confirmation modal, two-step flow |
| `src/components/orders/OpenOrdersPanel.tsx` | getDisplayTotal helper for split parents |
| `src/components/bartender/BartenderView.tsx` | onSelectedTabChange callback |

## Verification

1. Split an order 3 ways → click "Pay All" → shows combined total of all 3 splits
2. Cash flow: tap Cash → all 3 splits marked paid in one request → floor plan updated
3. Card flow: tap Card → Datacap reader shows combined total → tap card → all 3 splits paid
4. OpenOrdersPanel: split parent shows aggregate unpaid total (not $0.00)
5. Pay 1 of 3 splits individually → "Pay All" shows remaining 2 splits' combined total
6. Bar mode: switch tabs → open PaymentModal → correct order ID used
7. `npx tsc --noEmit` — clean
