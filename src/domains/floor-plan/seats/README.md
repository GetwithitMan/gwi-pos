# Layer 3: Seats

> **Status:** ✅ Complete and Ready for Integration
>
> **Developer:** Worker 3 (Seats Layer)
>
> **Completion Date:** February 4, 2026

---

## Quick Start

```typescript
import { SeatAPI, Seat } from '@/domains/floor-plan/seats';

// Generate seats for a table
const seats = SeatAPI.generateSeatsForTable('table_1', 8, 'round');

// Query seats
const occupied = SeatAPI.getOccupiedSeats('table_1');
const available = SeatAPI.getAvailableSeats('table_1');

// Mark seat occupied
SeatAPI.setSeatOccupied(seats[0].id, true, 'Alice');

// Add virtual seat during service
const virtualSeat = SeatAPI.addVirtualSeat('table_1');

// Renumber seats after merge
const renumberMap = SeatAPI.renumberSeatsForMerge(['table_1', 'table_2']);
```

## Rendering Seats

```tsx
import { Seat } from '@/domains/floor-plan/seats';

function FloorPlan() {
  return (
    <svg>
      {seats.map(seat => (
        <Seat
          key={seat.id}
          seat={seat}
          tableX={table.positionX}
          tableY={table.positionY}
          pixelsPerFoot={20}
          isSelected={selectedSeatId === seat.id}
          onSelect={handleSeatSelect}
        />
      ))}
    </svg>
  );
}
```

---

## Documentation

- **[IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)** - Complete implementation details, API reference, and acceptance criteria status
- **[SEAT_POSITIONING_GUIDE.md](./SEAT_POSITIONING_GUIDE.md)** - Visual guide to seat positioning math for all table shapes
- **[test-seats.ts](./test-seats.ts)** - Verification tests demonstrating all functionality

---

## Files

| File | Lines | Purpose |
|------|-------|---------|
| `seatAPI.ts` | 256 | CRUD operations, queries, auto-layout, virtual seats, merge handling |
| `seatLayout.ts` | 177 | Auto-positioning math for different table shapes |
| `Seat.tsx` | 120 | React component to render seats as circles |
| `index.ts` | 36 | Public exports |

**Total:** 589 lines of production code

---

## Acceptance Criteria

All requirements from the spec are met:

✅ Seats can be created with all required properties
✅ `generateSeatsForTable()` creates correct number of seats with proper positions
✅ Round tables have seats in a circle
✅ Rectangle tables have seats distributed along edges
✅ Seat positions are in feet relative to table center
✅ Seat angles face toward table center
✅ Virtual seats can be added/removed
✅ Occupancy tracking works (occupied/available)
✅ `renumberSeatsForMerge()` returns sequential numbers across merged tables
✅ `Seat.tsx` renders seats as circles with correct positioning
✅ Seats show occupied state visually

---

## Integration Points

### Dependencies (Import From)
- **Layer 2 (Tables):** `TableAPI` for table dimensions
- **Shared Types:** `Seat`, `TableShape`, `Point`

### Used By (Export To)
- **Layer 4 (Table Groups):** Seat renumbering on merge
- **Layer 7 (Status Engine):** Occupancy tracking
- **UI Components:** Floor plan rendering

---

## Key Features

### Auto-Positioning
Seats automatically position around tables based on shape:
- **Round/Oval:** Circular distribution with even angular spacing
- **Square/Rectangle:** Edge distribution proportional to perimeter
- **Hexagon:** Circular distribution with hex orientation
- **Booth:** All seats on open (front) side

### Visual States
- **Empty:** White circle, gray border, seat number
- **Occupied:** Blue circle, white text, guest initial
- **Selected:** Blue glow effect (4px radius)
- **Virtual:** Dashed border, yellow "V" badge

### Smart Features
- 1.5ft clearance from table edge (standard restaurant spacing)
- Angles calculated to face table center
- Floating-point precision (2 decimal places for position, 1 for angle)
- Sequential renumbering across merged tables

---

## Example Outputs

### Round Table (8 seats, 4ft diameter)
```
Seat 1: offset=(0.00, -3.50), angle=180° (top)
Seat 2: offset=(2.47, -2.47), angle=225° (top-right)
Seat 3: offset=(3.50, 0.00), angle=270° (right)
Seat 4: offset=(2.47, 2.47), angle=315° (bottom-right)
Seat 5: offset=(0.00, 3.50), angle=0° (bottom)
Seat 6: offset=(-2.47, 2.47), angle=45° (bottom-left)
Seat 7: offset=(-3.50, 0.00), angle=90° (left)
Seat 8: offset=(-2.47, -2.47), angle=135° (top-left)
```

### Rectangle Table (6 seats, 6ft x 4ft)
```
Seat 1: offset=(-2.00, -3.50), angle=180° (top-left)
Seat 2: offset=(2.00, -3.50), angle=180° (top-right)
Seat 3: offset=(4.50, 0.00), angle=270° (right-center)
Seat 4: offset=(2.00, 3.50), angle=0° (bottom-right)
Seat 5: offset=(-2.00, 3.50), angle=0° (bottom-left)
Seat 6: offset=(-4.50, 0.00), angle=90° (left-center)
```

---

## Known Limitations

1. **Seam Edge Displacement**
   - Currently just repositions seats on both tables
   - Full implementation would intelligently remove/merge seats at seam
   - Requires geometric collision detection (complex)

2. **Virtual Seat Placement**
   - Simple offset from last seat
   - Could be smarter about gap detection

3. **In-Memory State**
   - Uses `Map<string, Seat>` in memory
   - Production needs database persistence

---

## Future Enhancements

### Recommended (Beyond Spec)
1. **Smart Virtual Seat Placement** - Use gap detection
2. **Booth Sides Configuration** - Support L-shape and U-shape
3. **Accessibility Seats** - Mark wheelchair-accessible positions
4. **Seat Swap/Reorder** - Manual seat number reordering
5. **Per-Seat Orders** - Layer 10 feature (schema ready)

---

## Testing

Run verification tests:
```bash
npx ts-node src/domains/floor-plan/seats/test-seats.ts
```

Manual testing checklist in `IMPLEMENTATION_SUMMARY.md` section "Testing".

---

## Questions or Issues?

Contact Worker 3 (Seats Layer) or refer to:
- Layer 3 spec: `/docs/domains/floorplan/spec.md`
- Shared types: `/src/domains/floor-plan/shared/types.ts`
- Layer 2 patterns: `/src/domains/floor-plan/tables/`

---

**Ready for integration!** 🎉
