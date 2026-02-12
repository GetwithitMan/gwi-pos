# Skill 328: Seat Management Fixes (Add Seat + Persist Seat Number)

## Status: DONE
## Domain: Floor Plan, Orders
## Date: February 12, 2026
## Dependencies: Skill 121 (Atomic Seat Management)

## Summary

Fixed three bugs preventing seat management from working correctly after items are sent to kitchen:

1. **Cannot add seat after send** — Server rejected seat position because order tracked fewer seats than the table had physically
2. **Seat number not saved on items** — `POST /api/orders/[id]/items` didn't persist `seatNumber` or `courseNumber` to DB
3. **Extra seats lost on table reopen** — `extraSeats` client state was cleared when closing/reopening the order panel

## Problems Fixed

### 1. Cannot Add Seat After Send to Kitchen
**Symptom:** "Cannot insert at position 8. Current seats: 4 (table 7)"
**Root Cause:** Client sends `position: getTotalSeats(activeTable) + 1` using the table's physical seat count (7 → position 8). Server validates against `order.baseSeatCount + order.extraSeatCount` (4). Since `8 > 4 + 1`, the request was rejected.
**Fix:** Removed strict position validation. Server now computes `seatsToAdd = Math.max(1, position - currentTotalSeats)` and grows `extraSeatCount` to bridge the gap.

### 2. Seat Number Not Persisted on Item Append
**Symptom:** Items assigned to a seat showed no seat badge after reopening the table.
**Root Cause:** `POST /api/orders/[id]/items` (the item append route) was missing `seatNumber` and `courseNumber` in both the `NewItem` type and the `orderItem.create` data. The client sent these fields via `buildOrderItemPayload()`, but the server ignored them.
**Fix:** Added `seatNumber` and `courseNumber` to the `NewItem` type and to `tx.orderItem.create` data.

### 3. Extra Seats Lost on Table Reopen
**Symptom:** Seat strip showed only 4 seats after reopening a table that had 6 seats with items assigned.
**Root Cause:** `extraSeats` is a client-side `Map<string, number>` that gets cleared when the order panel closes. When reopening, `handleTableTap` loaded the order but didn't restore `extraSeats` from the order data.
**Fix:** Two changes:
- After API add-seat success, also update `extraSeats` so the new seat shows immediately
- In `handleTableTap`, after loading an existing order, scan items for the highest `seatNumber` and restore `extraSeats` if it exceeds the table's physical seat count

## Files Modified

### `src/app/api/orders/[id]/seating/route.ts`
- Removed strict `position > currentTotalSeats + 1` validation on INSERT
- Added `seatsToAdd = Math.max(1, position - currentTotalSeats)` to grow `extraSeatCount` to cover the gap

### `src/app/api/orders/[id]/items/route.ts`
- Added `seatNumber` and `courseNumber` to `NewItem` type
- Added `seatNumber` and `courseNumber` to `tx.orderItem.create` data

### `src/components/floor-plan/FloorPlanHome.tsx`
- `handleAddSeat` (active order branch): Added `setExtraSeats` update after successful API call
- `handleTableTap` (existing order branch): Added max seat number scan + `extraSeats` restoration after order load

## Key Patterns

### Server: Allow Position Beyond Tracked Seats
```typescript
// Don't reject — grow to accommodate
const seatsToAdd = Math.max(1, position - currentTotalSeats)
const newTotalSeats = currentTotalSeats + seatsToAdd
await tx.order.update({
  data: { extraSeatCount: order.extraSeatCount + seatsToAdd }
})
```

### Client: Restore Extra Seats from Order Items
```typescript
const maxSeatInItems = items.reduce(
  (max, item) => Math.max(max, item.seatNumber || 0), 0
)
if (maxSeatInItems > tablePhysicalSeats) {
  setExtraSeats(prev => {
    const next = new Map(prev)
    next.set(tableId, maxSeatInItems - tablePhysicalSeats)
    return next
  })
}
```
