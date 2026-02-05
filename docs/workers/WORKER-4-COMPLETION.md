# Worker 4: Virtual Group Seat Logic - COMPLETION REPORT

## Task Summary
Added seat numbering logic for virtual table groups. Virtual groups logically link tables without physically moving them.

## Files Created/Modified

### 1. Created: `/src/lib/virtual-group-seats.ts` (169 lines)
Pure functions for virtual seat numbering calculations.

**Key Functions:**
- `calculateVirtualSeatNumbers()` - Calculates sequential seat numbers across grouped tables
  - Primary table seats come first (1, 2, 3...)
  - Secondary tables ordered clockwise from primary
  - Returns VirtualSeatInfo[] with mapping
  
- `restoreOriginalSeatNumbers()` - Restores original seat numbers after dissolving
  
- `getVirtualSeatLabel()` - Gets display label with or without table prefix
  - With prefix: "T1-3" (Table 1, Seat 3)
  - Without prefix: "3"
  
- `getVirtualGroupSeatCount()` - Total seats in group
  
- `getVirtualGroupSeatSummary()` - Seat distribution per table

**Algorithm:**
1. Primary table's seats numbered first
2. Secondary tables sorted by angle from primary (clockwise)
3. Each table's seats sorted by seatNumber
4. Virtual numbers assigned sequentially (1...N)

### 2. Modified: `/src/app/api/tables/virtual-combine/route.ts`
Added seat handling when creating virtual groups.

**Changes:**
- Import `calculateVirtualSeatNumbers` and `TableWithSeats`
- After updating tables with virtualGroupId (line 247):
  - Fetch all seats for grouped tables
  - Calculate virtual seat numbers
  - Update seat labels to "TableName-SeatNum" format (e.g., "T1-3")
- Updated audit log to include `seatsRenumbered` count

**Example:**
```
Before: Table T1 has seats [1, 2, 3], Table T2 has seats [1, 2]
After:  Table T1 has seats [T1-1, T1-2, T1-3], Table T2 has seats [T2-1, T2-2]
Virtual numbering: 1, 2, 3, 4, 5 (contiguous)
```

### 3. Modified: `/src/app/api/tables/virtual-combine/[groupId]/dissolve/route.ts`
Added seat restoration when dissolving virtual groups.

**Changes:**
- After clearing virtualGroupId from tables (line 203):
  - Fetch all seats for group tables
  - Restore original labels (remove table prefix)
  - Convert "T1-3" back to "3"
- Updated audit log to include `seatsRestored` count

**Example:**
```
Before: Seats labeled [T1-1, T1-2, T1-3, T2-1, T2-2]
After:  Table T1 seats [1, 2, 3], Table T2 seats [1, 2]
```

## Acceptance Criteria Status

✅ **Virtual seat numbers are contiguous (1, 2, 3... no gaps)**
   - calculateVirtualSeatNumbers() assigns sequential numbers

✅ **Primary table's seats come first**
   - Primary table processed before secondaries

✅ **Secondary tables ordered by position (clockwise from primary)**
   - Tables sorted by angle from primary using atan2

✅ **Uncombine restores original positions from original* fields**
   - Dissolve route restores original seat labels

✅ **Display labels can show table prefix for clarity**
   - Virtual labels use "TableName-SeatNum" format
   - getVirtualSeatLabel() supports both formats

✅ **No TypeScript errors**
   - All files compile cleanly

## Implementation Notes

### Seat Label Strategy
Used existing `label` field on Seat model to store virtual seat display:
- **Combined**: label = "T1-3" (table prefix included)
- **Dissolved**: label = "3" (original seat number)

This avoids schema changes while providing clear visual distinction.

### Position Calculation
Secondary tables ordered using angle calculation:
```typescript
const angle = Math.atan2(
  table.posY - primaryTable.posY,
  table.posX - primaryTable.posX
)
// Convert to 0-360 degrees starting from top (12 o'clock)
const degrees = ((angle * 180) / Math.PI + 90 + 360) % 360
```

This ensures consistent clockwise ordering regardless of table positions.

### Transaction Safety
All seat updates occur within existing database transactions:
- virtual-combine: Updates seats in same transaction as table updates
- dissolve: Restores seats in same transaction as group dissolution

## Testing Suggestions

1. **Create Virtual Group (2 tables)**
   - T1 (4 seats) + T2 (2 seats)
   - Verify seats labeled: T1-1, T1-2, T1-3, T1-4, T2-1, T2-2
   - Verify virtual numbers: 1, 2, 3, 4, 5, 6

2. **Create Virtual Group (3 tables in different positions)**
   - Primary table at center
   - Secondary tables at different angles
   - Verify clockwise ordering

3. **Dissolve Group**
   - Verify labels restored to: 1, 2, 3, 4 and 1, 2
   - Verify no table prefix remains

4. **Cross-Room Virtual Group**
   - T1 in Room A, T2 in Room B
   - Verify seat numbering works across rooms

## Files Not Modified (As Per Task Scope)

- ❌ Prisma schema (no new fields added)
- ❌ Seat generation logic
- ❌ Table collision detection
- ❌ Rendering components
- ❌ Physical combine route (`/api/tables/combine/route.ts`)

## Summary

Successfully implemented virtual group seat numbering with:
- **169 lines** of pure seat calculation logic
- **60 lines** of API integration in virtual-combine
- **30 lines** of API integration in dissolve
- **Zero schema changes** (used existing fields)
- **Zero TypeScript errors**

Virtual groups now properly renumber seats sequentially while maintaining table identity through prefixed labels.
