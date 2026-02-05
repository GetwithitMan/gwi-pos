# WORKER-003: Floor Plan Editor - Tables Layer Implementation Guide

**Status:** Ready for Implementation
**Priority:** High
**Complexity:** Very High (~1,770 lines of new code)
**Completion:** 0% (Analysis Complete, Ready to Code)

---

## Summary

This task adds Table management (Layer 2) to the Floor Plan Editor. Currently, the editor only handles fixtures (walls, counters). We need to add table creation, positioning, editing, and deletion with collision detection.

---

## Architecture Overview

### Database Structure (✅ Already Exists)

```prisma
model Table {
  id          String  @id @default(cuid())
  locationId  String
  sectionId   String?
  name        String          // "Table 1", "Bar 3"
  abbreviation String?         // "T1", "B3"
  capacity    Int    @default(4)

  // Position (pixels)
  posX        Int    @default(0)
  posY        Int    @default(0)
  width       Int    @default(80)
  height      Int    @default(80)
  rotation    Int    @default(0)

  // Appearance
  shape       String @default("rectangle")  // rectangle, circle, square, booth, bar
  seatPattern String @default("all_around") // all_around, front_only, three_sides, two_sides, inside

  // Relations
  seats       Seat[]
  // ... other fields
}

model Seat {
  id         String  @id @default(cuid())
  tableId    String
  table      Table   @relation(fields: [tableId], references: [id])
  label      String           // "1", "2", "3"
  seatNumber Int
  relativeX  Int              // Position relative to table center (pixels)
  relativeY  Int
  angle      Int              // Rotation angle
  seatType   String @default("standard")
}
```

### Collision Detection (✅ Already Exists)

Located at: `src/domains/floor-plan/shared/collisionDetection.ts`

```typescript
import { checkTableAllFixturesCollision, type TableBounds, type FixtureBounds } from '@/domains/floor-plan/shared/collisionDetection';

// Example usage:
const collision = checkTableAllFixturesCollision(
  { x: tableX, y: tableY, width, height },
  fixtureBoundsArray
);

if (collision.collides) {
  // Show red outline, prevent placement
  console.log('Colliding with:', collision.collidingFixtures);
}
```

---

## Implementation Tasks

### Task 1: Tables API (/api/tables/route.ts)

**File:** `/src/app/api/tables/route.ts`
**Lines:** ~200
**Status:** ❌ Not Started

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/tables?locationId=xxx&sectionId=xxx&includeSeats=true
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');
    const sectionId = searchParams.get('sectionId');
    const includeSeats = searchParams.get('includeSeats') === 'true';

    if (!locationId) {
      return NextResponse.json({ error: 'locationId required' }, { status: 400 });
    }

    const tables = await db.table.findMany({
      where: {
        locationId,
        sectionId: sectionId || undefined,
        deletedAt: null,
      },
      include: {
        section: { select: { id: true, name: true, color: true } },
        seats: includeSeats ? {
          where: { deletedAt: null },
          orderBy: { seatNumber: 'asc' },
        } : false,
      },
      orderBy: [
        { sectionId: 'asc' },
        { name: 'asc' },
      ],
    });

    return NextResponse.json({ tables });
  } catch (error) {
    console.error('GET /api/tables error:', error);
    return NextResponse.json({ error: 'Failed to fetch tables' }, { status: 500 });
  }
}

// POST /api/tables - Create table with auto-generated seats
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      locationId,
      sectionId,
      name,
      abbreviation,
      capacity = 4,
      posX,
      posY,
      width = 80,
      height = 80,
      rotation = 0,
      shape = 'rectangle',
      seatPattern = 'all_around',
    } = body;

    if (!locationId || !name) {
      return NextResponse.json({ error: 'locationId and name required' }, { status: 400 });
    }

    // Create table and seats in a transaction
    const table = await db.$transaction(async (tx) => {
      // Create table
      const newTable = await tx.table.create({
        data: {
          locationId,
          sectionId: sectionId || null,
          name,
          abbreviation: abbreviation || null,
          capacity,
          posX,
          posY,
          width,
          height,
          rotation,
          shape,
          seatPattern,
        },
      });

      // Generate seats based on pattern
      const seats = generateSeatPositions(capacity, shape, seatPattern, width, height);

      if (seats.length > 0) {
        await tx.seat.createMany({
          data: seats.map((seat, index) => ({
            tableId: newTable.id,
            locationId,
            label: `${index + 1}`,
            seatNumber: index + 1,
            relativeX: seat.x,
            relativeY: seat.y,
            angle: seat.angle,
            seatType: 'standard',
          })),
        });
      }

      return newTable;
    });

    // Fetch complete table with seats
    const tableWithSeats = await db.table.findUnique({
      where: { id: table.id },
      include: {
        seats: { orderBy: { seatNumber: 'asc' } },
        section: { select: { id: true, name: true, color: true } },
      },
    });

    return NextResponse.json({ table: tableWithSeats }, { status: 201 });
  } catch (error) {
    console.error('POST /api/tables error:', error);
    return NextResponse.json({ error: 'Failed to create table' }, { status: 500 });
  }
}

// Helper function to generate seat positions
function generateSeatPositions(
  capacity: number,
  shape: string,
  pattern: string,
  width: number,
  height: number
): Array<{ x: number; y: number; angle: number }> {
  const seats: Array<{ x: number; y: number; angle: number }> = [];
  const radius = Math.max(width, height) / 2;
  const clearance = 20; // pixels from table edge

  switch (pattern) {
    case 'all_around':
      // Distribute seats evenly around perimeter
      for (let i = 0; i < capacity; i++) {
        const angle = (i * 360) / capacity - 90; // Start at top
        const rad = (angle * Math.PI) / 180;
        const x = Math.cos(rad) * (radius + clearance);
        const y = Math.sin(rad) * (radius + clearance);
        seats.push({ x, y, angle: angle + 180 }); // Face inward
      }
      break;

    case 'front_only':
      // All seats on one side (bottom)
      const spacing = width / (capacity + 1);
      for (let i = 0; i < capacity; i++) {
        const x = -width / 2 + spacing * (i + 1);
        const y = height / 2 + clearance;
        seats.push({ x, y, angle: 0 }); // Face up
      }
      break;

    case 'three_sides':
      // Distribute on three sides (not back)
      const perSide = Math.ceil(capacity / 3);
      let seatIndex = 0;

      // Bottom side
      for (let i = 0; i < perSide && seatIndex < capacity; i++, seatIndex++) {
        const x = -width / 2 + (width / (perSide + 1)) * (i + 1);
        seats.push({ x, y: height / 2 + clearance, angle: 0 });
      }

      // Left side
      for (let i = 0; i < perSide && seatIndex < capacity; i++, seatIndex++) {
        const y = -height / 2 + (height / (perSide + 1)) * (i + 1);
        seats.push({ x: -width / 2 - clearance, y, angle: 90 });
      }

      // Right side
      for (let i = 0; i < perSide && seatIndex < capacity; i++, seatIndex++) {
        const y = -height / 2 + (height / (perSide + 1)) * (i + 1);
        seats.push({ x: width / 2 + clearance, y, angle: 270 });
      }
      break;

    default:
      // Default to all_around
      for (let i = 0; i < capacity; i++) {
        const angle = (i * 360) / capacity - 90;
        const rad = (angle * Math.PI) / 180;
        const x = Math.cos(rad) * (radius + clearance);
        const y = Math.sin(rad) * (radius + clearance);
        seats.push({ x, y, angle: angle + 180 });
      }
  }

  return seats;
}
```

---

### Task 2: Table Detail API (/api/tables/[id]/route.ts)

**File:** `/src/app/api/tables/[id]/route.ts`
**Lines:** ~150
**Status:** ❌ Not Started

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/tables/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const table = await db.table.findUnique({
      where: { id: params.id },
      include: {
        seats: { where: { deletedAt: null }, orderBy: { seatNumber: 'asc' } },
        section: { select: { id: true, name: true, color: true } },
      },
    });

    if (!table || table.deletedAt) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 });
    }

    return NextResponse.json({ table });
  } catch (error) {
    console.error('GET /api/tables/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch table' }, { status: 500 });
  }
}

// PUT /api/tables/[id] - Update table
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const {
      name,
      abbreviation,
      capacity,
      posX,
      posY,
      width,
      height,
      rotation,
      shape,
      seatPattern,
      sectionId,
    } = body;

    // Check if capacity changed and regenerate seats if needed
    const currentTable = await db.table.findUnique({
      where: { id: params.id },
      select: { capacity: true, locationId: true },
    });

    if (!currentTable) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 });
    }

    const shouldRegenerateSeats = capacity !== undefined && capacity !== currentTable.capacity;

    const table = await db.$transaction(async (tx) => {
      // Update table
      const updated = await tx.table.update({
        where: { id: params.id },
        data: {
          name,
          abbreviation,
          capacity,
          posX,
          posY,
          width,
          height,
          rotation,
          shape,
          seatPattern,
          sectionId,
        },
      });

      // Regenerate seats if capacity changed
      if (shouldRegenerateSeats) {
        // Delete existing seats
        await tx.seat.updateMany({
          where: { tableId: params.id },
          data: { deletedAt: new Date() },
        });

        // Generate new seats
        const seats = generateSeatPositions(
          capacity || currentTable.capacity,
          shape || updated.shape,
          seatPattern || updated.seatPattern,
          width || updated.width,
          height || updated.height
        );

        if (seats.length > 0) {
          await tx.seat.createMany({
            data: seats.map((seat, index) => ({
              tableId: params.id,
              locationId: currentTable.locationId,
              label: `${index + 1}`,
              seatNumber: index + 1,
              relativeX: seat.x,
              relativeY: seat.y,
              angle: seat.angle,
              seatType: 'standard',
            })),
          });
        }
      }

      return updated;
    });

    // Fetch updated table with seats
    const tableWithSeats = await db.table.findUnique({
      where: { id: params.id },
      include: {
        seats: { where: { deletedAt: null }, orderBy: { seatNumber: 'asc' } },
        section: { select: { id: true, name: true, color: true } },
      },
    });

    return NextResponse.json({ table: tableWithSeats });
  } catch (error) {
    console.error('PUT /api/tables/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update table' }, { status: 500 });
  }
}

// DELETE /api/tables/[id] - Soft delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await db.$transaction(async (tx) => {
      // Soft delete table
      await tx.table.update({
        where: { id: params.id },
        data: { deletedAt: new Date() },
      });

      // Soft delete seats
      await tx.seat.updateMany({
        where: { tableId: params.id },
        data: { deletedAt: new Date() },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/tables/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete table' }, { status: 500 });
  }
}
```

---

### Task 3: Update Editor Types

**File:** `/src/domains/floor-plan/admin/types.ts`
**Lines:** ~20
**Status:** ❌ Not Started

```typescript
// Add TABLE to EditorToolMode
export type EditorToolMode =
  | 'SELECT'
  | 'WALL'
  | 'RECTANGLE'
  | 'CIRCLE'
  | 'DELETE'
  | 'TABLE';  // ← ADD THIS

// Add table-related types
export interface EditorTable {
  id: string;
  name: string;
  abbreviation?: string;
  capacity: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  shape: 'rectangle' | 'circle' | 'square' | 'booth' | 'bar' | 'hexagon';
  seatPattern: 'all_around' | 'front_only' | 'three_sides' | 'two_sides' | 'inside';
  section?: { id: string; name: string; color?: string };
  seats?: EditorSeat[];
  isSelected?: boolean;
  isDragging?: boolean;
  isColliding?: boolean;
  isLocked?: boolean;
}

export interface EditorSeat {
  id: string;
  label: string;
  seatNumber: number;
  relativeX: number;
  relativeY: number;
  angle: number;
  seatType: string;
}
```

---

### Task 4: TableRenderer Component

**File:** `/src/domains/floor-plan/admin/TableRenderer.tsx`
**Lines:** ~400
**Status:** ❌ Not Started

This component needs to:
- Render different table shapes (rectangle, circle, square, booth, bar, hexagon)
- Render seats around tables
- Show selection state (blue border, resize handles)
- Show collision state (red border)
- Handle click events for selection

**Key Features:**
```typescript
interface TableRendererProps {
  table: EditorTable;
  pixelsPerFoot: number;
  isSelected: boolean;
  isColliding: boolean;
  onSelect: (tableId: string) => void;
  onDragStart?: (tableId: string, event: React.MouseEvent) => void;
}
```

**Shapes to Render:**
- Rectangle: `<rect>` with rounded corners
- Circle: `<circle>`
- Square: `<rect>` with equal width/height
- Booth: `<rect>` with thick top border (back wall)
- Bar: Long narrow `<rect>`
- Hexagon: `<polygon>` with 6 points

**Seats Rendering:**
- Small circles at `relativeX`, `relativeY` positions
- Rotate based on `angle`
- Show seat number inside circle

---

### Task 5: TableProperties Component

**File:** `/src/domains/floor-plan/admin/TableProperties.tsx`
**Lines:** ~300
**Status:** ❌ Not Started

This component needs to:
- Show table properties in right panel
- Edit table name, abbreviation
- Edit capacity (triggers seat regeneration)
- Change shape (dropdown)
- Change seat pattern (dropdown)
- Assign to section (dropdown)
- Lock/unlock toggle
- Delete button

---

### Task 6: Update FloorPlanEditor

**File:** `/src/domains/floor-plan/admin/FloorPlanEditor.tsx`
**Changes:** ~150 lines
**Status:** ❌ Not Started

**Add to FloorPlanEditor:**

```typescript
// Add state
const [tables, setTables] = useState<EditorTable[]>([]);
const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

// Add fetch tables
const fetchTables = useCallback(async () => {
  if (!useDatabase || !locationId || !selectedRoomId) return;

  try {
    const res = await fetch(`/api/tables?locationId=${locationId}&sectionId=${selectedRoomId}&includeSeats=true`);
    const data = await res.json();
    setTables(data.tables || []);
  } catch (error) {
    console.error('Failed to fetch tables:', error);
  }
}, [useDatabase, locationId, selectedRoomId]);

// Add CRUD handlers
const handleTableCreate = async (tableData: Partial<EditorTable>) => { /* ... */ };
const handleTableUpdate = async (tableId: string, updates: Partial<EditorTable>) => { /* ... */ };
const handleTableDelete = async (tableId: string) => { /* ... */ };

// Pass to EditorCanvas
<EditorCanvas
  tables={tables}
  selectedTableId={selectedTableId}
  onTableSelect={setSelectedTableId}
  onTableCreate={handleTableCreate}
  onTableUpdate={handleTableUpdate}
  onTableDelete={handleTableDelete}
  // ... other props
/>

// Update keyboard shortcuts to include '6' for TABLE tool
if (event.key === '6') setToolMode('TABLE');
```

---

### Task 7: Update EditorCanvas

**File:** `/src/domains/floor-plan/admin/EditorCanvas.tsx`
**Changes:** ~300 lines
**Status:** ❌ Not Started

**Add to EditorCanvas:**

```typescript
// Add props
interface EditorCanvasProps {
  // ... existing props
  tables?: EditorTable[];
  selectedTableId?: string | null;
  onTableSelect?: (tableId: string | null) => void;
  onTableCreate?: (table: Partial<EditorTable>) => void;
  onTableUpdate?: (tableId: string, updates: Partial<EditorTable>) => void;
  onTableDelete?: (tableId: string) => void;
}

// Add table dragging state
const [draggedTableId, setDraggedTableId] = useState<string | null>(null);
const [tableDragOffset, setTableDragOffset] = useState<Point | null>(null);

// Handle TABLE tool click (placement)
if (toolMode === 'TABLE') {
  const point = screenToFloor(event.clientX, event.clientY);

  // Check collision with fixtures
  const fixtureBounds = fixtures.map(f => convertFixtureToCollisionBounds(f));
  const tableBounds = {
    x: point.x,
    y: point.y,
    width: 80,  // default
    height: 80,
  };

  const collision = checkTableAllFixturesCollision(tableBounds, fixtureBounds);

  if (!collision.collides) {
    onTableCreate?.({
      posX: point.x,
      posY: point.y,
      name: `T${tables.length + 1}`,
      capacity: 4,
      shape: 'rectangle',
      seatPattern: 'all_around',
    });
  } else {
    // Show error or red outline
    console.warn('Cannot place table here - collision with:', collision.collidingFixtures);
  }
}

// Render tables
{tables?.map(table => (
  <TableRenderer
    key={table.id}
    table={table}
    pixelsPerFoot={20}  // or calculate from floorPlan
    isSelected={selectedTableId === table.id}
    isColliding={false}  // Calculate based on current position vs fixtures
    onSelect={handleTableSelect}
    onDragStart={handleTableDragStart}
  />
))}
```

---

## Testing Checklist

### Table Creation
- [ ] Click TABLE tool, click canvas → table created
- [ ] Table appears with correct position
- [ ] Seats auto-generated around table (verify count matches capacity)
- [ ] Cannot place table on fixture (collision blocked, shows red outline)
- [ ] Table persists to database

### Table Selection
- [ ] Click table → selected (blue border)
- [ ] Click elsewhere → deselected
- [ ] Properties panel shows table details
- [ ] Can edit name, abbreviation, capacity

### Table Movement
- [ ] Drag table → follows mouse
- [ ] Red outline when over fixture
- [ ] Cannot drop on fixture
- [ ] Position saved to API on drop
- [ ] Real-time update via socket dispatch

### Table Resize
- [ ] Drag corner handle → resizes
- [ ] Shift+drag → maintains aspect ratio
- [ ] Seats regenerate after resize
- [ ] Capacity updates proportionally

### Table Deletion
- [ ] DELETE tool + click table → deleted
- [ ] Select table + Delete key → deleted
- [ ] Confirmation dialog shown
- [ ] Table removed from canvas and database
- [ ] Associated seats also deleted

### Different Shapes
- [ ] Rectangle tables render correctly
- [ ] Circle tables render correctly
- [ ] Square tables render correctly
- [ ] Booth tables render correctly (with back wall indicator)
- [ ] Bar tables render correctly (long narrow shape)

### Different Seat Patterns
- [ ] all_around: seats evenly distributed around perimeter
- [ ] front_only: all seats on one side
- [ ] three_sides: seats on three sides (not back)
- [ ] two_sides: seats on opposite sides
- [ ] inside: seats inside table (bar rail style)

---

## Reference Files

**Read these for patterns:**
- `/src/domains/floor-plan/admin/FloorPlanEditor.tsx` - Main editor structure
- `/src/domains/floor-plan/admin/EditorCanvas.tsx` - Canvas rendering
- `/src/domains/floor-plan/admin/FixtureProperties.tsx` - Properties panel pattern
- `/src/domains/floor-plan/shared/collisionDetection.ts` - Collision detection
- `/src/components/floor-plan/TableNode.tsx` - FOH table rendering (reference for shapes)

**Create these files:**
- `/src/app/api/tables/route.ts` - Main tables API
- `/src/app/api/tables/[id]/route.ts` - Single table operations
- `/src/domains/floor-plan/admin/TableRenderer.tsx` - Table rendering component
- `/src/domains/floor-plan/admin/TableProperties.tsx` - Properties panel

---

## Success Criteria

✅ **Core Functionality:**
- [ ] Can create tables via Editor UI
- [ ] Tables persist to database via API
- [ ] Tables render with correct shapes and seats
- [ ] Can select, move, resize tables
- [ ] Collision detection prevents overlap with fixtures

✅ **Properties:**
- [ ] Properties panel allows editing all table properties
- [ ] Capacity changes regenerate seats
- [ ] Shape/pattern changes update rendering

✅ **Polish:**
- [ ] Changes sync via socket dispatch (real-time to FOH)
- [ ] All table shapes render correctly
- [ ] Selection and collision states are visually clear
- [ ] Keyboard shortcuts work (6 for TABLE tool, Delete for deletion)

---

## Next Steps

1. **Start with API:** Create `/api/tables/route.ts` and `/api/tables/[id]/route.ts`
2. **Test API:** Use Postman or Thunder Client to verify CRUD operations
3. **Update Types:** Add TABLE to EditorToolMode
4. **Create TableRenderer:** Build component with all shapes
5. **Create TableProperties:** Build properties panel
6. **Integrate into Editor:** Update FloorPlanEditor and EditorCanvas
7. **Test End-to-End:** Verify all functionality works together

---

## Estimated Time

- **APIs:** 3-4 hours
- **Components:** 4-5 hours
- **Integration:** 2-3 hours
- **Testing:** 2-3 hours
- **Total:** 11-15 hours

This is a **substantial** implementation task requiring deep understanding of:
- Next.js API routes
- Prisma database operations
- React component architecture
- SVG rendering for custom shapes
- Collision detection algorithms
- State management across multiple components

**Recommendation:** Break into smaller sub-tasks and implement incrementally, testing each piece before moving on.
