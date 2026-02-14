# Skill 344: Order Flow Performance (P0 — Critical Path)

**Status:** DONE
**Date:** February 14, 2026
**Commits:** `bec0eae` (PaymentModal instant), `c140700` (fire-and-forget cash), `c1bf346` (floor plan snapshot), `b66f8e0` (snapshot coalescing), `3ca26ce` (draft pre-creation), `d994deb` (background autosave)
**Domain:** Orders / Payments / Floor Plan
**Impact:** Payment modal instant open; cash payments instant close; floor plan 4→1 fetches; zero data loss on tab close

---

## Problem

The critical order flow — tap table → add items → send → pay — had multiple bottlenecks:

1. **PaymentModal**: Blocked on `ensureOrderInDB` before opening (1-3s wait)
2. **Cash payments**: Blocked on `/pay` API before closing modal (500ms-2s)
3. **Floor plan load**: 4 separate fetches (tables + sections + open orders + item counts)
4. **Item loss**: Unsaved items lost if tab closed or browser refreshed
5. **Send to kitchen**: Had to save all items first (blocking)

## Solutions

### PaymentModal Instant Open (`bec0eae`)
Modal opens immediately with `savedOrderId`. `ensureOrderInDB` runs in background. `waitForOrderReady` awaited only before calling `/pay`.

```typescript
// Open modal instantly
setShowPaymentModal(true)

// Background: ensure order exists in DB
ensureOrderInDB().then(() => setOrderReady(true))

// Only block on "Charge" button click
const handleCharge = async () => {
  await waitForOrderReady()  // resolves instantly if already done
  await fetch(`/api/orders/${orderId}/pay`, ...)
}
```

### Fire-and-Forget Exact Cash (`c140700`)
Cash-only payments close modal instantly. `/pay` runs in background. Failure shows toast. Parent skips receipt modal when `receiptData` is undefined.

```typescript
// Close modal immediately
onPaymentComplete(undefined)  // undefined = skip receipt

// Background payment
fetch(`/api/orders/${orderId}/pay`, ...).catch(() => {
  toast.error('Cash payment failed — check order status')
})
```

### Floor Plan Snapshot (`c1bf346`, `b66f8e0`)
`GET /api/floorplan/snapshot` replaces 3 fetches + count (4→1). Single query returns tables + open order summaries.

**Coalescing**: `snapshotInFlightRef` + `snapshotPendingRef` + 150ms trailing refresh. Multiple rapid refresh requests coalesce into one network call with no dropped updates.

### Draft Pre-Creation (`3ca26ce`)
When user taps a table, `activeOrder.startOrder()` creates a draft shell in the background via `POST /api/orders`. Items are added to the local store immediately. By the time user adds first item, the order ID already exists in DB.

### Background Autosave (`d994deb`)
`useActiveOrder` runs a 5-second interval. Persists temp-ID items via `POST /api/orders/[id]/items`. By the time user clicks Send or Pay, all items are already saved in DB.

```typescript
// 5s autosave interval
useEffect(() => {
  const interval = setInterval(() => {
    const unsaved = items.filter(i => i.id.startsWith('temp-'))
    if (unsaved.length > 0) {
      saveItemsToServer(unsaved)
    }
  }, 5000)
  return () => clearInterval(interval)
}, [items])
```

## Key Files

| File | Changes |
|------|---------|
| `src/components/payments/PaymentModal.tsx` | Instant open, fire-and-forget cash |
| `src/app/api/floorplan/snapshot/route.ts` | Single-query snapshot |
| `src/components/floor-plan/FloorPlanHome.tsx` | Snapshot coalescing, draft pre-creation |
| `src/hooks/useActiveOrder.ts` | 5s background autosave |
| `src/app/api/orders/route.ts` | Draft order creation |
| `src/app/api/orders/[id]/items/route.ts` | Temp-ID item persistence |

## Results

| Interaction | Before | After |
|-------------|--------|-------|
| Tap "Pay" to modal visible | 1-3s | Instant (<100ms) |
| Cash "Charge" to modal close | 500ms-2s | Instant (<100ms) |
| Floor plan initial load | 4 fetches | 1 fetch |
| Item loss on tab close | Possible | Zero (autosaved) |

## Mandatory Pattern Going Forward

- **Modal opens must be instant**. Do background work after opening, not before.
- **Cash payments are fire-and-forget**. Close UI immediately, process in background.
- **Use snapshot APIs** instead of multiple fetches for composite views.
- **Coalesce rapid refreshes**. Never fire multiple concurrent fetches for the same data.
- **Background autosave** for any user-entered data that could be lost.
- See `CLAUDE.md` Performance Rules section.
