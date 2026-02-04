# WORKER-002: Dynamic Seats System

> **Status**: Ready for Implementation
> **Priority**: High
> **Estimated Complexity**: High
> **Domain**: Floor Plan
> **Depends On**: WORKER-001 (Collision Detection)

## Objective

Implement a dynamic seats system where seats are individual entities attached to tables. Seats must:
1. Be individually addressable for ticket-per-seat sales
2. Follow their parent table when moved
3. Support dynamic adding/removing with automatic renumbering
4. Maintain table-level identity for reporting even when tables are combined
5. Respect collision rules (no overlapping fixtures, tables, or other seats)

## Vision: The Server Experience

### Single Table Flow
1. Server sees Table T1 with 4 seats (positions 1-4)
2. Each seat can have its own orders/tickets
3. Server can add a 5th seat - system asks position, shifts existing seats

### Table Combine Flow
1. Server drags Table T1 (4 seats) toward Table T2 (4 seats)
2. Tables snap together (magnet pull or offset positioning)
3. Seats automatically renumber around the perimeter: 1-8
4. **Critical**: Each seat retains its `sourceTableId` for reporting
   - Seats 1-4 still belong to T1
   - Seats 5-8 still belong to T2
5. Orders placed at "Seat 5" are reported under T2

### Add Seat to Combined Group
1. Server wants to add a seat at position 4
2. Current seat 4 becomes seat 5, seat 5 becomes 6, etc.
3. Orders at old position 4 move to position 5 automatically

### Uncombine Flow (Future)
1. Tables separate back to individual tables
2. Seats renumber back to 1-4 on each table
3. Orders stay with their `sourceTableId`

## Data Model

### Seat Entity

```typescript
interface Seat {
  id: string;                    // Unique seat identifier
  tableId: string;               // Parent table (for single tables)
  sourceTableId: string;         // Original table (preserved when combined)
  locationId: string;            // Multi-tenancy
  sectionId: string;             // Room/section

  // Position relative to table center (in feet)
  offsetX: number;               // X offset from table center
  offsetY: number;               // Y offset from table center

  // Absolute position (calculated from table + offset)
  posX: number;                  // Absolute X position
  posY: number;                  // Absolute Y position

  // Seat properties
  position: number;              // Seat number (1, 2, 3... renumbers on combine)
  seatType: SeatType;            // chair, barstool, booth_seat, bench
  width: number;                 // Collision bounds (feet)
  height: number;                // Collision bounds (feet)
  rotation: number;              // Rotation in degrees (faces table center)

  // Visual properties
  color?: string;                // Optional custom color
  isOccupied: boolean;           // Visual indicator

  // Constraints
  maxDistanceFromTable: number;  // How far seat can be from table edge
  attachSide: AttachSide;        // top, bottom, left, right, corner_*

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;              // Soft delete for sync
}

type SeatType = 'chair' | 'barstool' | 'booth_seat' | 'bench' | 'stool';

type AttachSide =
  | 'top' | 'bottom' | 'left' | 'right'
  | 'corner_tl' | 'corner_tr' | 'corner_bl' | 'corner_br'
  | 'perimeter';  // Auto-distribute around table
```

### Table-Seat Relationship

```typescript
interface TableWithSeats {
  id: string;
  name: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  shape: 'rectangle' | 'circle' | 'square';

  // Seat configuration
  seatCount: number;             // Current number of seats
  defaultSeatType: SeatType;     // Default for new seats
  seatArrangement: SeatArrangement;

  // Relationships
  seats: Seat[];
  combinedWithId?: string;       // Primary table if combined
  combinedTableIds?: string[];   // Secondary tables if this is primary
}

type SeatArrangement =
  | 'perimeter'      // Evenly distributed around edges
  | 'two_sides'      // Only on long sides (typical restaurant)
  | 'one_side'       // Bar counter, booth
  | 'corners'        // Only at corners
  | 'custom';        // Manual positioning
```

## Seat Positioning Algorithm

### Single Table - Perimeter Distribution

```typescript
function calculateSeatPositions(
  table: TableWithSeats,
  seatCount: number,
  arrangement: SeatArrangement
): SeatPosition[] {
  const positions: SeatPosition[] = [];

  if (arrangement === 'perimeter') {
    // Distribute seats evenly around table perimeter
    const perimeter = calculateTablePerimeter(table);
    const spacing = perimeter / seatCount;

    for (let i = 0; i < seatCount; i++) {
      const distanceAlongPerimeter = i * spacing + spacing / 2;
      const { x, y, rotation, side } = getPointOnPerimeter(
        table,
        distanceAlongPerimeter,
        SEAT_OFFSET_FROM_TABLE // e.g., 1.5 feet from table edge
      );

      positions.push({
        position: i + 1,
        offsetX: x - table.posX - table.width / 2,
        offsetY: y - table.posY - table.height / 2,
        posX: x,
        posY: y,
        rotation,
        attachSide: side,
      });
    }
  }

  return positions;
}
```

### Combined Tables - Unified Perimeter

```typescript
function calculateCombinedSeatPositions(
  tables: TableWithSeats[],
  primaryTableId: string
): SeatPosition[] {
  // 1. Calculate combined bounding box / hull
  const combinedShape = calculateCombinedShape(tables);

  // 2. Calculate unified perimeter
  const perimeter = calculateShapePerimeter(combinedShape);

  // 3. Count total seats
  const totalSeats = tables.reduce((sum, t) => sum + t.seatCount, 0);

  // 4. Distribute around combined perimeter
  const spacing = perimeter / totalSeats;
  const positions: SeatPosition[] = [];

  let seatNumber = 1;
  for (const table of tables) {
    for (let i = 0; i < table.seatCount; i++) {
      const distanceAlongPerimeter = (seatNumber - 1) * spacing + spacing / 2;
      const { x, y, rotation } = getPointOnPerimeter(
        combinedShape,
        distanceAlongPerimeter,
        SEAT_OFFSET_FROM_TABLE
      );

      positions.push({
        position: seatNumber,
        sourceTableId: table.id,  // Preserve original table
        offsetX: x - table.posX - table.width / 2,
        offsetY: y - table.posY - table.height / 2,
        posX: x,
        posY: y,
        rotation,
      });

      seatNumber++;
    }
  }

  return positions;
}
```

## Collision Detection for Seats

Seats must check collisions against:
1. **Fixtures** - Walls, bar counters, pillars, etc.
2. **Tables** - Cannot overlap any table (including parent)
3. **Other Seats** - Cannot overlap other seats

```typescript
interface SeatCollisionResult {
  collides: boolean;
  collidingWith: {
    type: 'fixture' | 'table' | 'seat';
    id: string;
    name?: string;
  }[];
  suggestedPosition?: { x: number; y: number };
}

function checkSeatCollision(
  seat: SeatBounds,
  fixtures: FixtureBounds[],
  tables: TableBounds[],
  otherSeats: SeatBounds[]
): SeatCollisionResult {
  const collisions: SeatCollisionResult['collidingWith'] = [];

  // Check fixtures (use existing collision detection)
  for (const fixture of fixtures) {
    if (checkSeatFixtureCollision(seat, fixture)) {
      collisions.push({ type: 'fixture', id: fixture.id, name: fixture.visualType });
    }
  }

  // Check tables
  for (const table of tables) {
    if (checkSeatTableCollision(seat, table)) {
      collisions.push({ type: 'table', id: table.id, name: table.name });
    }
  }

  // Check other seats
  for (const other of otherSeats) {
    if (seat.id !== other.id && checkSeatSeatCollision(seat, other)) {
      collisions.push({ type: 'seat', id: other.id });
    }
  }

  return {
    collides: collisions.length > 0,
    collidingWith: collisions,
  };
}
```

## Seat Renumbering on Insert

When a seat is inserted at a position, all seats at that position and higher must shift:

```typescript
interface SeatInsertResult {
  newSeat: Seat;
  updatedSeats: Seat[];  // Seats with updated positions
  orderUpdates: OrderSeatUpdate[];  // Orders that need position updates
}

async function insertSeatAtPosition(
  tableId: string,
  insertPosition: number,
  seatType: SeatType
): Promise<SeatInsertResult> {
  // 1. Get all seats for table (or combined group)
  const seats = await getSeatsForTableOrGroup(tableId);

  // 2. Shift positions for seats >= insertPosition
  const updatedSeats: Seat[] = [];
  for (const seat of seats) {
    if (seat.position >= insertPosition) {
      seat.position += 1;
      updatedSeats.push(seat);
    }
  }

  // 3. Create new seat at insertPosition
  const newSeat = await createSeat({
    tableId,
    position: insertPosition,
    seatType,
    // Calculate position based on new arrangement
    ...calculateSeatPositionForInsert(seats, insertPosition),
  });

  // 4. Update orders that reference shifted seats
  const orderUpdates = await updateOrderSeatPositions(tableId, insertPosition);

  // 5. Recalculate all seat positions for even distribution
  await redistributeSeats(tableId);

  return { newSeat, updatedSeats, orderUpdates };
}
```

## Seat Types and Dimensions

| Type | Width (ft) | Height (ft) | Use Case |
|------|------------|-------------|----------|
| `chair` | 1.5 | 1.5 | Standard dining |
| `barstool` | 1.25 | 1.25 | Bar counter |
| `booth_seat` | 2.0 | 1.5 | Booth seating |
| `bench` | 3.0 | 1.5 | Communal tables |
| `stool` | 1.0 | 1.0 | Small bar seating |

## API Endpoints

### Seat CRUD

```typescript
// List seats for a table
GET /api/tables/{tableId}/seats
Response: { seats: Seat[] }

// Add seat to table
POST /api/tables/{tableId}/seats
Body: { position?: number, seatType?: SeatType }
Response: { seat: Seat, updatedSeats?: Seat[] }

// Update seat
PUT /api/seats/{seatId}
Body: { position?, offsetX?, offsetY?, seatType?, color? }
Response: { seat: Seat }

// Remove seat
DELETE /api/seats/{seatId}
Response: { success: true, updatedSeats: Seat[] }

// Redistribute seats evenly
POST /api/tables/{tableId}/seats/redistribute
Response: { seats: Seat[] }
```

### Combined Table Seats

```typescript
// Get seats for combined group
GET /api/tables/{tableId}/combined-seats
Response: {
  seats: Seat[],
  tables: { id: string, name: string, seatRange: [number, number] }[]
}

// Renumber seats after combine
POST /api/tables/{tableId}/seats/renumber
Body: { combinedTableIds: string[] }
Response: { seats: Seat[] }
```

## Visual Feedback Requirements

### Seat States

| State | Visual |
|-------|--------|
| Empty | Outlined shape, light fill |
| Occupied | Solid fill, person icon |
| Selected | Blue highlight border |
| Dragging | Ghost preview, semi-transparent |
| Invalid Position | Red outline, blocked icon |
| Hover | Subtle scale up (1.05x) |

### Seat-Table Connection

- Draw subtle line or attachment indicator from seat to table
- When table moves, seats animate smoothly to follow
- When dragging seat, show valid placement zone around table

## Implementation Steps

### Step 1: Database Schema
Add Seat model to Prisma schema:
```prisma
model Seat {
  id              String    @id @default(cuid())
  tableId         String
  sourceTableId   String    // Preserved original table
  locationId      String
  sectionId       String

  position        Int       // 1, 2, 3... renumbers on combine
  seatType        String    @default("chair")

  offsetX         Float     @default(0)
  offsetY         Float     @default(0)
  posX            Float     @default(0)
  posY            Float     @default(0)

  width           Float     @default(1.5)
  height          Float     @default(1.5)
  rotation        Float     @default(0)

  color           String?
  isOccupied      Boolean   @default(false)
  maxDistance     Float     @default(3.0)
  attachSide      String    @default("perimeter")

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?
  syncedAt        DateTime?

  table           Table     @relation(fields: [tableId], references: [id])
  sourceTable     Table     @relation("SourceTable", fields: [sourceTableId], references: [id])
  location        Location  @relation(fields: [locationId], references: [id])

  @@index([tableId])
  @@index([sourceTableId])
  @@index([locationId])
  @@index([sectionId])
}
```

### Step 2: Seat Positioning Module
Create `src/domains/floor-plan/seats/seatPositioning.ts`:
- `calculateSeatPositions()` - Single table perimeter distribution
- `calculateCombinedSeatPositions()` - Combined tables unified perimeter
- `getPointOnPerimeter()` - Get x,y,rotation for point on shape perimeter
- `calculateTablePerimeter()` - Get perimeter length for rectangle/circle

### Step 3: Seat Collision Module
Extend `src/domains/floor-plan/shared/collisionDetection.ts`:
- `checkSeatFixtureCollision()` - Seat vs fixture
- `checkSeatTableCollision()` - Seat vs table
- `checkSeatSeatCollision()` - Seat vs seat
- `checkSeatAllCollisions()` - Check all three

### Step 4: Seat Renumbering Module
Create `src/domains/floor-plan/seats/seatRenumbering.ts`:
- `insertSeatAtPosition()` - Insert and shift
- `removeSeatAtPosition()` - Remove and shift down
- `renumberSeatsForCombine()` - Unified numbering for combined tables
- `renumberSeatsForSplit()` - Restore original numbering

### Step 5: API Routes
Create seat API routes:
- `src/app/api/tables/[id]/seats/route.ts` - CRUD
- `src/app/api/seats/[id]/route.ts` - Individual seat ops
- `src/app/api/tables/[id]/seats/redistribute/route.ts` - Redistribution

### Step 6: Frontend Components
Create/modify components:
- `src/domains/floor-plan/seats/Seat.tsx` - Seat visual component
- `src/domains/floor-plan/seats/SeatEditor.tsx` - Edit seat properties
- Integrate with `FloorPlanHome.tsx` for rendering
- Add seat drag handling

## Testing Checklist

### Single Table
- [ ] Create table with default 4 seats
- [ ] Seats distribute evenly around perimeter
- [ ] Add 5th seat - renumbers correctly
- [ ] Remove seat - renumbers down correctly
- [ ] Insert seat at position 2 - shifts 2,3,4 to 3,4,5
- [ ] Seat follows table when table moves

### Collision Detection
- [ ] Seat cannot overlap fixture (wall, counter)
- [ ] Seat cannot overlap table body
- [ ] Seat cannot overlap another seat
- [ ] Visual feedback shows red when invalid
- [ ] Can place seat adjacent to but not overlapping

### Combined Tables
- [ ] Combine 2 tables - seats renumber 1-8
- [ ] Each seat preserves sourceTableId
- [ ] Seats distribute around combined perimeter
- [ ] Add seat to combined group - works correctly
- [ ] Remove seat from combined group - renumbers

### Different Table Shapes
- [ ] Rectangular table - seats on all 4 sides
- [ ] Circular table - seats distributed around circle
- [ ] Square table - seats on all 4 sides
- [ ] Bar counter (one-sided) - seats only on one side

### Different Seat Types
- [ ] Chair renders correctly
- [ ] Barstool renders correctly (smaller)
- [ ] Booth seat renders correctly (wider)

## Reference Files

1. **Existing seat infrastructure**
   - `src/domains/floor-plan/seats/` - Existing seat files (review what exists)
   - `src/domains/floor-plan/seats/seatLayout.ts` - May have positioning logic

2. **Collision detection** (from WORKER-001)
   - `src/domains/floor-plan/shared/collisionDetection.ts`

3. **Table handling**
   - `src/components/floor-plan/FloorPlanHome.tsx`
   - `src/components/floor-plan/TableNode.tsx`

4. **API patterns**
   - `src/app/api/tables/[id]/route.ts`
   - `src/app/api/floor-plan-elements/route.ts`

## Success Criteria

1. Seats are individual entities with unique IDs
2. Seats maintain `sourceTableId` through combine/uncombine
3. Seat collision detection prevents invalid placements
4. Insert/remove properly renumbers all affected seats
5. Combined tables show unified seat numbering (1-N)
6. Seat positions follow parent table movement
7. Visual feedback clearly shows valid/invalid positions
8. Performance remains smooth with 20+ tables and 80+ seats

## 🚨 BOUNDARY RULES (MANDATORY)

**You are ONLY allowed to modify these files/directories:**

| Directory/File | Permission |
|----------------|------------|
| `src/domains/floor-plan/seats/*` | CREATE/MODIFY |
| `src/app/api/tables/[id]/seats/*` | CREATE (API routes for seats) |
| `src/app/api/seats/*` | CREATE (API routes for individual seats) |
| `prisma/schema.prisma` | MODIFY (Seat model only - ask PM first) |

**You MUST NOT touch:**
- `src/domains/floor-plan/shared/collisionDetection.ts` - Import from WORKER-001, do NOT modify
- `src/components/floor-plan/FloorPlanHome.tsx` - FOH component (separate worker)
- `src/components/floor-plan/TableNode.tsx` - Table rendering (separate worker)
- `src/domains/floor-plan/admin/*` - Editor files
- `src/domains/floor-plan/tables/*` - Tables layer (WORKER-003)
- `src/app/api/tables/route.ts` - Main tables API (only touch seats sub-routes)

**Import, Don't Duplicate:**
- IMPORT collision detection from `src/domains/floor-plan/shared/collisionDetection.ts`
- IMPORT table data via TableAPI or existing hooks
- Do NOT recreate collision logic or table fetching

**If you discover you need to modify something outside your boundary:**
1. STOP
2. Report the boundary conflict to your PM
3. Wait for instructions before proceeding

## Notes for WORKER

- Review existing `src/domains/floor-plan/seats/` directory - some infrastructure may exist
- Use WORKER-001's collision detection module as foundation
- Coordinate system is in FEET, not pixels
- Seats are center-positioned (x, y is center point)
- Always include `locationId` for multi-tenancy
- Use soft deletes (`deletedAt`) for sync support
- Consider performance - may need spatial indexing for large floor plans
