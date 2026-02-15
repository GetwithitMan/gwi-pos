# Skill 349: Per-Seat Check Cards & Seat Filtering

## Status: DONE
## Domain: Orders, Floor Plan
## Dependencies: 348 (Per-Seat Color System), 11 (Seat Tracking)
## Commits: `b20bc8d`

## Summary

OrderPanel auto-groups items by seat into card-style "checks" with per-seat subtotals when 2+ seats have items. Tapping a seat on the floor plan filters the order panel to show only that seat's items. This is the visual foundation for per-seat splitting (actual split payment is a future project).

## Features

### 1. Auto Seat-Grouped Check Cards

When items span 2+ seat numbers, OrderPanel renders each seat as a separate card:
- Colored border matching the seat's color
- Header with seat color dot, "Seat X" label, item count, and **per-seat subtotal**
- Both PENDING and SENT TO KITCHEN sections group by seat
- Sent items cards render at 70% opacity
- Single-seat orders (or no seat assignments) render flat as before

### 2. Seat Filter Bar

When a seat is tapped on the floor plan:
- OrderPanel filters to show only items for that seat
- Colored "Showing Seat X" indicator bar appears below the header
- "Show All" button clears the filter
- Tapping the table itself (not a seat) auto-clears the filter
- Tapping the same seat again deselects and clears the filter
- Order totals always show the full order amount (not filtered subset)

## Implementation Details

### Auto Seat Groups (OrderPanel.tsx)

```typescript
const autoSeatGroups = useMemo(() => {
  const seatSet = new Set<number>()
  for (const item of items) {
    if (item.seatNumber && (!item.status || item.status === 'active')) seatSet.add(item.seatNumber)
  }
  if (seatSet.size < 2) return null
  const seats = Array.from(seatSet).sort((a, b) => a - b)
  return seats.map(seatNum => {
    const seatItems = items.filter(i => i.seatNumber === seatNum)
    const subtotal = seatItems
      .filter(i => !i.status || i.status === 'active')
      .reduce((sum, i) => sum + calculateItemTotal(i), 0)
    return { seatNumber: seatNum, items: seatItems, subtotal }
  })
}, [items])
```

Replaces the old unused `seatGroups` prop with automatic detection.

### Seat Filtering (orders/page.tsx)

```typescript
const selectedSeat = useFloorPlanStore(s => s.selectedSeat)
const clearSelectedSeat = useFloorPlanStore(s => s.clearSelectedSeat)
const filterSeatNumber = selectedSeat?.seatNumber ?? null
const filteredOrderPanelItems = useMemo(() => {
  if (!filterSeatNumber) return orderPanelItems
  return orderPanelItems.filter(item => item.seatNumber === filterSeatNumber)
}, [orderPanelItems, filterSeatNumber])
```

### New OrderPanel Props

| Prop | Type | Purpose |
|------|------|---------|
| `filterSeatNumber` | `number \| null` | When set, shows "Showing Seat X" indicator |
| `onClearSeatFilter` | `() => void` | Called by "Show All" button |

## Files Modified

| File | Changes |
|------|---------|
| `src/components/orders/OrderPanel.tsx` | Auto seat groups, check card rendering, filter indicator bar, new props |
| `src/app/(pos)/orders/page.tsx` | Import `useFloorPlanStore`, filter items by selected seat, pass filter props |

## Rendering Priority

1. `coursingEnabled` → Course groups (unchanged)
2. `autoSeatGroups` → Per-seat check cards (NEW)
3. Flat rendering (no grouping)

## Future: Per-Seat Split Payment

This skill lays the visual foundation. The next project will build:
- Per-seat payment (pay one seat's check independently)
- Split ticket management (move items between seats, merge/split)
- Multiple checks under one table (view/manage all seat checks)
- The existing `/api/orders/[id]/split` route already supports `type: 'by_seat'`
