# Skill 355: Optimistic Floor Plan Updates (Seat Add + Send-to-Kitchen)

**Date:** February 16, 2026
**Commit:** `0625843`
**Domain:** Floor Plan, Orders
**Status:** Complete

## Problem

Two operations had 1-5 second delays because they blocked on a full floor plan snapshot fetch (`loadFloorPlanData`):

1. **Adding a seat** to a table — `handleAddSeat` called `void loadFloorPlanData(false)` after the API POST, waiting for a full snapshot refresh before the seat appeared
2. **Send to kitchen** — table status didn't update to "occupied" until the next snapshot poll (up to 30 seconds)

## Solution

Replaced blocking snapshot fetches with optimistic Zustand store patches. The background snapshot still reconciles eventually, but the UI updates instantly.

### Files Modified

| File | Change |
|------|--------|
| `src/components/floor-plan/FloorPlanHome.tsx` | `handleAddSeat`: optimistic `addSeatToTable()` with computed orbit position instead of `loadFloorPlanData()` |
| `src/components/floor-plan/FloorPlanHome.tsx` | `handleSendToKitchen`: optimistic `addTableOrder()` to mark table occupied before clearing UI |
| `src/app/(pos)/orders/page.tsx` | `handleSendToKitchen`: same optimistic `addTableOrder()` pattern |

### How It Works

**Seat Addition (handleAddSeat):**
```
1. POST /api/orders/{id}/seating → success
2. Compute new seat position: orbit radius + angle from existing seat count
3. addSeatToTable(tableId, { id: 'temp-seat-...', seatNumber, relativeX, relativeY })
4. UI shows seat instantly
5. Background snapshot reconciles with real seat data
```

**Send to Kitchen (handleSendToKitchen):**
```
1. POST /api/orders/{id}/send → success
2. addTableOrder(tableId, { id, orderNumber, status: 'sent', ... })
3. Table badge shows "occupied" instantly
4. Clear UI (activeOrderId, order store, panel)
5. Background snapshot reconciles
```

### Store Methods Used (already existed in `use-floor-plan.ts`)

- `addSeatToTable(tableId, seat)` — adds seat to table's seats array, increments capacity
- `addTableOrder(tableId, order)` — sets table's currentOrder and status to 'occupied'

## Verification

- Seat appears instantly after add (no 1-5s delay)
- Table turns occupied immediately after send-to-kitchen
- `npx tsc --noEmit` — clean
