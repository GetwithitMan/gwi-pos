# Skill 348: Per-Seat Color System

## Status: DONE
## Domain: Floor Plan, Orders
## Dependencies: 206 (Seat Management), 328 (Seat Fixes)
## Commits: `c2d6597`, `b20bc8d`

## Summary

Each seat number gets a unique color from an 8-color palette. Colors are consistent everywhere: floor plan seats, order panel item badges, group headers, and seat picker buttons. Seats without items show grey; seats with items show their assigned color.

## Color Palette

| Seat | Color | Hex |
|------|-------|-----|
| 1 | Indigo | `#6366f1` |
| 2 | Amber | `#f59e0b` |
| 3 | Emerald | `#10b981` |
| 4 | Red | `#ef4444` |
| 5 | Cyan | `#06b6d4` |
| 6 | Orange | `#f97316` |
| 7 | Violet | `#8b5cf6` |
| 8 | Pink | `#ec4899` |

Seats 9+ wrap around via `(seatNumber - 1) % 8`.

## Key File

**`src/lib/seat-utils.ts`** — Central color utilities:
- `SEAT_COLORS` — 8-color array
- `getSeatColor(seatNumber, hasItems)` — Returns hex color (grey if no items)
- `getSeatBgColor(seatNumber)` — RGBA 15% opacity background
- `getSeatTextColor(seatNumber)` — Lightened RGB for text
- `getSeatBorderColor(seatNumber)` — RGBA 30% opacity border

## Where Colors Apply

| Component | What Uses Color |
|-----------|----------------|
| `TableNode.tsx` (DraggableSeat) | Seat circle background, border, text, glow — for ALL seats (including temporary/extra) |
| `OrderPanelItem.tsx` | Seat badge (clickable & read-only), seat picker buttons |
| `OrderPanel.tsx` | Seat group headers (text + background) |
| `FloorPlanHome.tsx` | "New items → Seat X" text, seat picker buttons (1, 2, 3, 4) |

## Temporary Seat Styling

Temporary/extra seats (added beyond table's default capacity) no longer show orange dashed borders. They use the same per-seat color system as regular seats — colored when they have items, grey when empty.

## Data Flow

`FloorPlanHome.tsx` computes `seatsWithItems` memo from order items:
```typescript
const seatsWithItems = useMemo(() => {
  const set = new Set<number>()
  for (const item of inlineOrderItems) {
    if (item.seatNumber && item.status !== 'voided') set.add(item.seatNumber)
  }
  return set
}, [inlineOrderItems])
```

This is passed to `TableNode` via `seatsWithItems` prop, which passes `hasItems` to `getSeatColor()`.
