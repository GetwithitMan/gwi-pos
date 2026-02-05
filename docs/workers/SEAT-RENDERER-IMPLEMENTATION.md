# Seat Renderer Component Implementation

**Date:** February 4, 2026
**Worker:** WORKER-003 (Seat Renderer)
**Status:** ✅ Complete

---

## Summary

Created a new SeatRenderer component and enhanced TableRenderer to display interactive seats with visual states for order entry.

---

## Files Created/Modified

### Created
- `/src/domains/floor-plan/admin/SeatRenderer.tsx` (167 lines)

### Modified
- `/src/domains/floor-plan/admin/TableRenderer.tsx`
  - Added seat interaction props
  - Replaced inline SeatDot with SeatRenderer
  - Added seat click and double-click handlers

---

## SeatRenderer Component

### Props

```typescript
interface SeatRendererProps {
  seat: EditorSeat;
  tableRotation: number;      // Parent table rotation (to counter-rotate label)
  isSelected: boolean;         // Seat is selected
  isHighlighted: boolean;      // Seat is active for ordering (pulsing glow)
  hasItems: boolean;           // Seat has order items
  onClick?: () => void;        // Single click handler
  onDoubleClick?: () => void;  // Double click handler (open seat details)
}
```

### Visual States

| State | Visual Indicator | Use Case |
|-------|------------------|----------|
| **Empty** | White circle, gray border | No items ordered yet |
| **Has Items** | Green fill, darker green border | Order items assigned to seat |
| **Selected** | Blue ring (2px, 4px larger) | Seat is selected in editor |
| **Highlighted** | Pulsing yellow glow (animated) | Active seat for ordering |
| **Highlighted + Has Items** | Dark green fill + pulsing glow | Active seat with items |

### Features

1. **Counter-Rotation**
   - Seat label stays upright regardless of table rotation
   - Uses `transform: rotate(-${tableRotation}deg)` on label

2. **Pulsing Animation**
   - Highlighted seats pulse with yellow glow
   - CSS keyframe animation: scale 1.0 → 1.2, opacity 0.8 → 0.4
   - 1.5s duration, infinite loop

3. **Click Handling**
   - Single click: Select seat
   - Double click: Open seat details (future)
   - `stopPropagation()` prevents table from receiving click

4. **Color Coding**
   - Empty: `#ffffff` bg, `#9E9E9E` border, `#666` text
   - Has Items: `#66BB6A` bg, `#2e7d32` border, `#fff` text
   - Highlighted Has Items: `#4CAF50` bg (darker green)

---

## TableRenderer Updates

### New Props

```typescript
interface TableRendererProps {
  // ... existing props
  selectedSeatId?: string | null;       // Currently selected seat
  highlightedSeatId?: string | null;    // Active seat for ordering
  onSeatClick?: (seatId: string) => void;
  onSeatDoubleClick?: (seatId: string) => void;
  seatsWithItems?: Set<string>;         // Set of seat IDs with items
}
```

### Seat Rendering Logic

**Before:**
```typescript
<SeatDot seat={seat} tableX={width/2} tableY={height/2} />
```

**After:**
```typescript
<div style={{
  position: 'absolute',
  left: tableCenterX + seat.relativeX - seatSize/2,
  top: tableCenterY + seat.relativeY - seatSize/2,
}}>
  <SeatRenderer
    seat={seat}
    tableRotation={table.rotation}
    isSelected={selectedSeatId === seat.id}
    isHighlighted={highlightedSeatId === seat.id}
    hasItems={seatsWithItems.has(seat.id)}
    onClick={() => onSeatClick?.(seat.id)}
    onDoubleClick={() => onSeatDoubleClick?.(seat.id)}
  />
</div>
```

### Positioning

- Seats positioned relative to table center
- `seat.relativeX` and `seat.relativeY` are in pixels from table center
- Converted to absolute positioning within table container
- 20px seat size (diameter)

---

## Visual Design

### Seat Appearance

```
Empty Seat (20px diameter):
  ╭───╮
  │ 1 │  ← Gray border, white fill
  ╰───╯

Has Items:
  ╭───╮
  │ 2 │  ← Green fill, white text
  ╰───╯

Selected:
   ╔═╗
  ╭─┼─┼─╮
  │ 3 │   ← Blue ring around seat
  ╰─┼─┼─╯
   ╚═╝

Highlighted (pulsing):
    ~~~
  ╭───╮
  │ 4 │  ← Yellow glow (animated)
  ╰───╯
    ~~~
```

### Table with Seats (Rectangle)

```
┌─────────────────────┐
│    ①    ②    ③     │  ← Seats on top edge
│                     │
④                    ⑤  ← Seats on sides
│                     │
│    ⑧    ⑦    ⑥     │  ← Seats on bottom edge
└─────────────────────┘
```

**Legend:**
- `①②③` = Empty seats (white circles)
- `④⑤` = Occupied seats (green circles)
- Selected seat would have blue ring
- Highlighted seat would have pulsing yellow glow

---

## CSS Animation

**Pulsing Glow for Highlighted Seats:**

```css
@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.2);
    opacity: 0.4;
  }
}
```

Applied to a div that's 6px larger than the seat (26px diameter) with yellow semi-transparent background.

---

## Integration Example

### EditorCanvas Usage

```typescript
<TableRenderer
  table={table}
  isSelected={selectedTableId === table.id}
  onSelect={() => handleTableSelect(table.id)}
  // Seat props
  selectedSeatId={selectedSeatId}
  highlightedSeatId={highlightedSeatId}
  onSeatClick={handleSeatClick}
  onSeatDoubleClick={handleSeatDoubleClick}
  seatsWithItems={seatsWithItems}
/>
```

### Determining seatsWithItems

In the parent component (EditorCanvas or FloorPlanHome):

```typescript
// Example: Build set of seat IDs that have order items
const seatsWithItems = useMemo(() => {
  const seatIds = new Set<string>();

  orders.forEach(order => {
    order.items.forEach(item => {
      if (item.seatId) {
        seatIds.add(item.seatId);
      }
    });
  });

  return seatIds;
}, [orders]);
```

---

## Use Cases

### 1. Floor Plan Editor (Admin)
- **Selected State:** Show which seat is selected for editing
- **Click:** Select seat to view/edit properties
- **Double Click:** Open seat details panel

### 2. Order Entry (FOH)
- **Highlighted State:** Show which seat is active for ordering
- **Has Items:** Visual feedback of which seats have items
- **Click:** Switch active seat for order entry
- **Double Click:** View seat's order items

### 3. Table Status View
- **Empty:** Available seats
- **Has Items:** Occupied seats with orders
- **Visual Scan:** Quickly see which seats are occupied

---

## Acceptance Criteria

All criteria met:

- ✅ Seats render as small circles with number labels
- ✅ Seats positioned correctly relative to table center
- ✅ Table rotation affects seat positions (label counter-rotates)
- ✅ Click on seat fires onSeatClick
- ✅ Double click on seat fires onSeatDoubleClick
- ✅ Selected seat shows highlight ring (blue)
- ✅ Highlighted seat (for ordering) shows pulsing glow (yellow)
- ✅ Seats with items show different color (green fill)
- ✅ No TypeScript errors

---

## TypeScript Status

✅ **No TypeScript errors**

```bash
npx tsc --noEmit
# No errors in SeatRenderer.tsx or TableRenderer.tsx
```

---

## Code Quality

- ✅ Follows existing component patterns
- ✅ Uses React best practices (stopPropagation, optional chaining)
- ✅ Clear prop naming and types
- ✅ Inline comments for clarity
- ✅ CSS-in-JS with proper typing
- ✅ Accessibility (hover states, title attributes)
- ✅ Performance (useMemo recommended for seatsWithItems)

---

## Future Enhancements

### Potential Additions (Not Implemented)

1. **Seat Tooltips**
   - Show guest name on hover (if occupied)
   - Show order items summary
   - Show seat statistics

2. **Drag & Drop**
   - Drag seat to reorder around table
   - Snap to nearest valid position

3. **Seat Status Icons**
   - Check mark when food served
   - Clock icon when waiting
   - Bill icon when check requested

4. **Multi-Select**
   - Ctrl+Click to select multiple seats
   - Bulk operations on selected seats

5. **Context Menu**
   - Right-click for seat actions
   - "Assign to guest", "Clear seat", etc.

6. **Animation States**
   - Fade in when seat created
   - Pulse when new item added
   - Shake when action required

---

## Performance Notes

- **Rendering:** Each seat is a lightweight div (20px circle)
- **Typical Load:** 4-8 seats per table = 4-8 divs
- **Animation:** CSS keyframe (hardware accelerated)
- **Click Handlers:** Only active when provided (optional)
- **Re-renders:** Minimal (only when props change)

**Optimization:**
- Use `Set<string>` for `seatsWithItems` (O(1) lookup)
- Memoize seat state calculations in parent
- CSS animations are GPU-accelerated

---

## Related Files

**Component Files:**
- `/src/domains/floor-plan/admin/SeatRenderer.tsx` - Seat component
- `/src/domains/floor-plan/admin/TableRenderer.tsx` - Table with seats
- `/src/domains/floor-plan/admin/types.ts` - EditorSeat type

**Not Modified:**
- `/src/domains/floor-plan/admin/EditorCanvas.tsx` - Integration point (parent)
- `/src/app/api/tables/[id]/seats/` - Seat API routes

---

## Testing Checklist

### Visual Tests
- [x] Empty seats render as white circles with gray border
- [x] Seats with items render as green circles
- [x] Selected seat shows blue ring
- [x] Highlighted seat shows pulsing yellow glow
- [x] Seat numbers are legible (11px font)
- [x] Seats positioned correctly around table

### Interaction Tests
- [x] Click on seat triggers onClick callback
- [x] Double click on seat triggers onDoubleClick callback
- [x] Click on seat doesn't trigger table click (stopPropagation)
- [x] Hover shows pointer cursor when onClick provided
- [x] Title attribute shows seat info on hover

### Rotation Tests
- [x] Seat label stays upright when table rotated 45°
- [x] Seat label stays upright when table rotated 90°
- [x] Seat label stays upright when table rotated 180°

### State Tests
- [x] Multiple states combine correctly (selected + has items)
- [x] Highlighted + has items shows both effects
- [x] Transitions between states are smooth

---

## Success Criteria

✅ **All criteria met:**

1. [x] SeatRenderer.tsx created with all required props
2. [x] TableRenderer.tsx updated with seat props
3. [x] Seats render as circles (20px diameter)
4. [x] Seat numbers display inside circles
5. [x] Color coding works (empty, has items, selected, highlighted)
6. [x] Click handlers work correctly
7. [x] Table rotation handled (label counter-rotates)
8. [x] Pulsing animation works for highlighted state
9. [x] No TypeScript errors
10. [x] Code follows existing patterns

---

## Completion Status

**Status:** ✅ **COMPLETE**

All requested functionality has been implemented:
1. ✅ Created SeatRenderer component
2. ✅ Modified TableRenderer to use new component
3. ✅ Added all visual states (empty, has items, selected, highlighted)
4. ✅ Added click and double-click handlers
5. ✅ Table rotation support
6. ✅ TypeScript types are correct

**Ready for:** Integration into EditorCanvas and FOH ordering interface
