# WORKER-003: Floor Plan Editor - Tables Layer (L2)

> **Status**: Ready for Implementation
> **Priority**: High
> **Estimated Complexity**: Medium
> **Domain**: Floor Plan
> **Layer**: L2 (Tables) + L5 (Admin Editor)
> **Type**: Bridge Worker (connecting existing APIs to Editor UI)

## Objective

Add the Tables layer (L2) to the Floor Plan Editor admin UI. The Editor currently only handles fixtures (walls, counters, pillars). We need to add table creation, selection, movement, and deletion using the **existing Tables API**.

This is a **Bridge Worker** task - you're connecting two existing systems:
1. **Floor Plan Editor UI** (`/src/domains/floor-plan/admin/`)
2. **Tables API** (`/api/tables/`)

## Current State

### What Exists - Editor (L1 Canvas + L5 Admin)
- `FloorPlanEditor.tsx` - Main editor with tool modes: SELECT, WALL, RECTANGLE, CIRCLE, DELETE
- `EditorCanvas.tsx` - Canvas with mouse interaction, fixture rendering
- `FixtureToolbar.tsx` - Tool selection UI
- `FixtureProperties.tsx` - Properties panel for selected fixture
- Database mode with `FloorPlanElement` storage

### What Exists - Tables API (L2)
- `GET /api/tables?locationId=&sectionId=` - List tables
- `POST /api/tables` - Create table with auto-generated seats
- `PUT /api/tables/[id]` - Update table position, size, properties
- `DELETE /api/tables/[id]` - Soft delete table
- Table shapes: rectangle, circle, square, bar, booth, hexagon
- Seat patterns: all_around, front_only, three_sides, two_sides, inside

### What's Missing
- Table tool in Editor toolbar
- Table rendering on Editor canvas
- Table selection, dragging, resizing in Editor
- Table properties panel
- Collision detection with fixtures when placing tables

## Requirements

### 1. Add Table Tool Mode
Add a new tool mode `TABLE` to the Editor:
```typescript
type EditorToolMode = 'SELECT' | 'WALL' | 'RECTANGLE' | 'CIRCLE' | 'DELETE' | 'TABLE';
```

### 2. Table Placement Flow
1. User clicks "Table" tool
2. User clicks on canvas to place table
3. System checks collision with fixtures (use WORKER-001's collision detection)
4. If valid, call `POST /api/tables` with position and defaults
5. Table appears on canvas with auto-generated seats

### 3. Table Selection & Properties
When table is selected:
- Show selection handles (resize corners, rotation handle)
- Show properties panel with:
  - Name (editable)
  - Abbreviation (editable)
  - Capacity (editable, triggers seat regeneration)
  - Shape (dropdown: rectangle, circle, square, bar, booth)
  - Seat Pattern (dropdown: all_around, front_only, etc.)
  - Section assignment (dropdown of available sections)
  - Lock/unlock toggle

### 4. Table Dragging
- Drag to move table
- Check collision with fixtures during drag
- Show red outline if invalid position
- On drop, call `PUT /api/tables/[id]` with new position

### 5. Table Resizing
- Corner handles for resizing
- Maintain aspect ratio option (shift key)
- Update capacity proportionally or prompt user
- Regenerate seats after resize

### 6. Table Deletion
- When DELETE tool active, click table to delete
- Or select table and press Delete key
- Confirm dialog: "Delete Table T1 and its seats?"
- Call `DELETE /api/tables/[id]`

## Data Structures

### Table from API
```typescript
interface TableFromAPI {
  id: string;
  name: string;
  abbreviation?: string;
  capacity: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  shape: 'rectangle' | 'circle' | 'square' | 'bar' | 'booth' | 'hexagon';
  seatPattern: 'all_around' | 'front_only' | 'three_sides' | 'two_sides' | 'inside';
  status: string;
  section?: { id: string; name: string; color?: string };
  seats?: SeatFromAPI[];
  isLocked?: boolean;
}

interface SeatFromAPI {
  id: string;
  label: string;
  seatNumber: number;
  relativeX: number;  // Position relative to table center
  relativeY: number;
  angle: number;
  seatType: string;
}
```

### Editor Table State
```typescript
interface EditorTable extends TableFromAPI {
  // Editor-specific state
  isSelected: boolean;
  isDragging: boolean;
  isResizing: boolean;
  isColliding: boolean;  // True if overlapping fixture
}
```

## Implementation Steps

### Step 1: Update Types
In `src/domains/floor-plan/admin/types.ts`:
- Add `'TABLE'` to `EditorToolMode`
- Add table-related types

### Step 2: Update FloorPlanEditor
In `src/domains/floor-plan/admin/FloorPlanEditor.tsx`:
- Add `tables` state array
- Add `selectedTableId` state
- Add `fetchTables()` to load tables from API
- Add Table tool button to toolbar
- Add table CRUD handlers

### Step 3: Update EditorCanvas
In `src/domains/floor-plan/admin/EditorCanvas.tsx`:
- Accept `tables` and `onTableCreate/Update/Delete` props
- Render tables on canvas
- Handle table clicks (selection)
- Handle table drag (with collision detection)
- Handle table resize

### Step 4: Create TableRenderer Component
Create `src/domains/floor-plan/admin/TableRenderer.tsx`:
- Render table shape based on `shape` property
- Render seats around table
- Show selection handles when selected
- Show collision state (red outline)

### Step 5: Create TableProperties Component
Create `src/domains/floor-plan/admin/TableProperties.tsx`:
- Edit table name, abbreviation
- Edit capacity (triggers seat regeneration)
- Change shape, seat pattern
- Assign to section
- Lock/unlock toggle
- Delete button

### Step 6: Integrate Collision Detection
Use WORKER-001's collision detection:
```typescript
import { checkTableAllFixturesCollision } from '@/domains/floor-plan/shared/collisionDetection';

// When placing or moving table
const collision = checkTableAllFixturesCollision(tableBounds, fixtureBounds);
if (collision.collides) {
  // Show red outline, prevent placement
}
```

## API Integration

### Fetch Tables
```typescript
const fetchTables = async () => {
  const res = await fetch(`/api/tables?locationId=${locationId}&sectionId=${selectedRoomId}&includeSeats=true`);
  const data = await res.json();
  setTables(data.tables);
};
```

### Create Table
```typescript
const createTable = async (posX: number, posY: number) => {
  const res = await fetch('/api/tables', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locationId,
      sectionId: selectedRoomId,
      name: `T${tables.length + 1}`,
      capacity: 4,
      posX,
      posY,
      width: 100,
      height: 100,
      shape: 'rectangle',
      seatPattern: 'all_around',
    }),
  });
  const data = await res.json();
  setTables([...tables, data.table]);
};
```

### Update Table
```typescript
const updateTable = async (tableId: string, updates: Partial<TableFromAPI>) => {
  const res = await fetch(`/api/tables/${tableId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  setTables(tables.map(t => t.id === tableId ? data.table : t));
};
```

### Delete Table
```typescript
const deleteTable = async (tableId: string) => {
  await fetch(`/api/tables/${tableId}`, { method: 'DELETE' });
  setTables(tables.filter(t => t.id !== tableId));
};
```

## Visual Design

### Table Shapes
| Shape | Rendering |
|-------|-----------|
| rectangle | Rounded rect with aspect ratio |
| circle | Perfect circle |
| square | Square with rounded corners |
| bar | Long narrow rectangle |
| booth | Rectangle with thick "back" side |
| hexagon | 6-sided polygon |

### Seat Rendering
- Small circles positioned around table edge
- Show seat numbers inside circles
- Use `relativeX`, `relativeY` from API (relative to table center)

### Selection State
- Blue border when selected
- Resize handles at corners
- Rotation handle at top
- Properties panel shows on right

### Collision State
- Red border when colliding with fixture
- Semi-transparent red overlay
- Tooltip: "Cannot place here - overlaps with [fixture name]"

## Testing Checklist

### Table Creation
- [ ] Click Table tool, click canvas → table created
- [ ] Table appears with correct position
- [ ] Seats auto-generated around table
- [ ] Cannot place table on fixture (collision blocked)

### Table Selection
- [ ] Click table → selected (blue border)
- [ ] Click elsewhere → deselected
- [ ] Properties panel shows table details
- [ ] Can edit name, capacity, shape

### Table Movement
- [ ] Drag table → follows mouse
- [ ] Red outline when over fixture
- [ ] Cannot drop on fixture
- [ ] Position saved to API on drop

### Table Resize
- [ ] Drag corner handle → resizes
- [ ] Shift+drag → maintains aspect ratio
- [ ] Seats regenerate after resize

### Table Deletion
- [ ] DELETE tool + click table → deleted
- [ ] Select table + Delete key → deleted
- [ ] Confirmation dialog shown
- [ ] Table removed from canvas and API

### Different Shapes
- [ ] Rectangle tables render correctly
- [ ] Circle tables render correctly
- [ ] Bar tables render correctly
- [ ] Booth tables render correctly

## Reference Files

### Editor Files (Modify)
- `src/domains/floor-plan/admin/FloorPlanEditor.tsx`
- `src/domains/floor-plan/admin/EditorCanvas.tsx`
- `src/domains/floor-plan/admin/types.ts`

### Create New Files
- `src/domains/floor-plan/admin/TableRenderer.tsx`
- `src/domains/floor-plan/admin/TableProperties.tsx`

### Reference (Read Only)
- `src/app/api/tables/route.ts` - Tables API
- `src/app/api/tables/[id]/route.ts` - Single table operations
- `src/components/floor-plan/TableNode.tsx` - FOH table rendering (reference for shapes)
- `src/domains/floor-plan/shared/collisionDetection.ts` - Collision detection

## Success Criteria

1. Can create tables via Editor UI
2. Tables persist to database via API
3. Tables render with correct shapes and seats
4. Can select, move, resize tables
5. Collision detection prevents overlap with fixtures
6. Properties panel allows editing all table properties
7. Changes sync via socket dispatch (real-time to FOH)
8. All table shapes render correctly

## 🚨 BOUNDARY RULES (MANDATORY)

**You are ONLY allowed to modify these files/directories:**

| Directory/File | Permission |
|----------------|------------|
| `src/domains/floor-plan/admin/FloorPlanEditor.tsx` | MODIFY |
| `src/domains/floor-plan/admin/EditorCanvas.tsx` | MODIFY |
| `src/domains/floor-plan/admin/types.ts` | MODIFY |
| `src/domains/floor-plan/admin/TableRenderer.tsx` | CREATE |
| `src/domains/floor-plan/admin/TableProperties.tsx` | CREATE |
| `src/app/test-floorplan/editor/page.tsx` | MODIFY (if needed) |

**You MUST NOT touch:**
- `src/domains/floor-plan/shared/collisionDetection.ts` - Import from WORKER-001, do NOT modify
- `src/components/floor-plan/FloorPlanHome.tsx` - FOH component (different system)
- `src/components/floor-plan/TableNode.tsx` - FOH table rendering (READ ONLY for reference)
- `src/components/floor-plan/hooks/*` - FOH hooks (different system)
- `src/domains/floor-plan/seats/*` - Seats layer (WORKER-002)
- `src/app/api/tables/*` - Tables API routes (use as-is, do NOT modify)

**Import, Don't Duplicate:**
- IMPORT collision detection from `src/domains/floor-plan/shared/collisionDetection.ts`
- REFERENCE `TableNode.tsx` for shape rendering logic, but implement your own `TableRenderer.tsx` for the Editor
- USE the Tables API as-is - do NOT modify API routes

**If you discover you need to modify something outside your boundary:**
1. STOP
2. Report the boundary conflict to your PM
3. Wait for instructions before proceeding

## Notes for WORKER

- The Tables API already handles seat generation - just pass capacity and pattern
- Table positions are in PIXELS in the API (not feet like fixtures)
- Use `dispatchFloorPlanUpdate()` after changes for real-time sync
- The FOH already renders tables - look at `TableNode.tsx` for shape rendering reference
- Collision detection module from WORKER-001 should be available at `src/domains/floor-plan/shared/collisionDetection.ts`
- Coordinate with WORKER-001 if collision module isn't ready yet
