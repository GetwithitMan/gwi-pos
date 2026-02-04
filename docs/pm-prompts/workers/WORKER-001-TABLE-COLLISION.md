# WORKER-001: Table Placement Collision Detection

> **Status**: Ready for Implementation
> **Priority**: High
> **Estimated Complexity**: Medium
> **Domain**: Floor Plan

## Objective

Implement collision detection that prevents tables from being placed on top of fixtures (walls, bar counters, kitchen areas, pillars, etc.) in the Floor Plan system. Users should be able to freely place tables anywhere on the canvas EXCEPT where fixtures already exist.

## Context

The Floor Plan system has two layers:
1. **Fixtures Layer** - Walls, bar counters, kitchens, pillars, etc. (managed by FloorPlanEditor)
2. **Tables Layer** - Dining tables with seats (managed by FloorPlanHome)

Currently, tables can be placed anywhere including on top of fixtures. This creates unrealistic floor plans where tables overlap with walls or kitchen equipment.

## Requirements

### Core Behavior
1. When a user drags/places a table, check if the table's bounding box overlaps with ANY fixture
2. If collision detected:
   - Prevent the table from being placed at that position
   - Show visual feedback (red outline, shake animation, or ghost preview)
   - Optionally snap to nearest valid position
3. If no collision:
   - Allow placement normally
   - Show green/valid visual feedback during drag

### Collision Types to Handle

| Fixture Type | Collision Shape | Notes |
|--------------|-----------------|-------|
| `wall` | Line segment with thickness | Use line-rectangle intersection |
| `rectangle` | Axis-aligned bounding box | Simple AABB collision |
| `circle` | Circle | Circle-rectangle intersection |
| `bar_counter` | Rectangle | AABB collision |
| `kitchen` | Rectangle | AABB collision |
| `stage` | Rectangle | AABB collision |
| `pillar` | Circle | Circle-rectangle intersection |
| `planter` | Circle | Circle-rectangle intersection |

### Visual Feedback
- **Valid Position**: Green outline or normal appearance during drag
- **Invalid Position**: Red outline, reduced opacity, or "blocked" indicator
- **Optional**: Show which fixture is blocking placement

## Technical Specifications

### Key Files to Modify

1. **`src/components/floor-plan/FloorPlanHome.tsx`**
   - Add collision detection to table drag handlers
   - Fetch fixtures from database for collision checking
   - Integrate visual feedback during drag operations

2. **`src/domains/floor-plan/tables/tableAPI.ts`** (or create new)
   - Add `checkTableCollision(table, fixtures)` function
   - Add `findNearestValidPosition(table, fixtures)` function (optional)

3. **Create: `src/domains/floor-plan/shared/collisionDetection.ts`**
   - Pure collision detection functions
   - Reusable across editor and FOH views

### Data Structures

```typescript
// Table bounding box (from existing Table model)
interface TableBounds {
  x: number;      // Center X in feet
  y: number;      // Center Y in feet
  width: number;  // Width in feet
  height: number; // Height in feet
  rotation?: number; // Degrees (optional, for rotated tables)
}

// Fixture from FloorPlanElement
interface FixtureBounds {
  id: string;
  type: 'wall' | 'rectangle' | 'circle';
  visualType: string;
  // For rectangles
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // For circles
  centerX?: number;
  centerY?: number;
  radius?: number;
  // For walls
  geometry?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  thickness?: number;
}

// Collision result
interface CollisionResult {
  collides: boolean;
  collidingFixtures: string[]; // IDs of fixtures that collide
  suggestedPosition?: { x: number; y: number }; // Optional snap position
}
```

### Collision Detection Algorithms

#### 1. Rectangle-Rectangle (AABB)
```typescript
function rectRectCollision(
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number }
): boolean {
  // Convert center-based coords to corner-based for easier math
  const r1Left = rect1.x - rect1.width / 2;
  const r1Right = rect1.x + rect1.width / 2;
  const r1Top = rect1.y - rect1.height / 2;
  const r1Bottom = rect1.y + rect1.height / 2;

  const r2Left = rect2.x - rect2.width / 2;
  const r2Right = rect2.x + rect2.width / 2;
  const r2Top = rect2.y - rect2.height / 2;
  const r2Bottom = rect2.y + rect2.height / 2;

  return !(r1Right < r2Left || r1Left > r2Right ||
           r1Bottom < r2Top || r1Top > r2Bottom);
}
```

#### 2. Circle-Rectangle
```typescript
function circleRectCollision(
  circle: { x: number; y: number; radius: number },
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  // Find closest point on rectangle to circle center
  const closestX = Math.max(rect.x - rect.width/2,
                    Math.min(circle.x, rect.x + rect.width/2));
  const closestY = Math.max(rect.y - rect.height/2,
                    Math.min(circle.y, rect.y + rect.height/2));

  // Calculate distance from circle center to closest point
  const distX = circle.x - closestX;
  const distY = circle.y - closestY;
  const distSquared = distX * distX + distY * distY;

  return distSquared < circle.radius * circle.radius;
}
```

#### 3. Line-Rectangle (for walls)
```typescript
function lineRectCollision(
  line: { start: Point; end: Point; thickness: number },
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  // Treat wall as a thick line (capsule shape)
  // Check if any corner of rect is within thickness of line
  // OR if line passes through rectangle

  // Implementation: Use line segment to rectangle intersection
  // Plus distance from line to rectangle corners
}
```

### API Integration

Fixtures are fetched from: `GET /api/floor-plan-elements?locationId={id}&sectionId={id}`

Response format:
```json
{
  "elements": [
    {
      "id": "elem-123",
      "visualType": "wall",
      "posX": 5,
      "posY": 3,
      "width": null,
      "height": null,
      "geometry": { "start": { "x": 0, "y": 5 }, "end": { "x": 10, "y": 5 } },
      "thickness": 0.5
    },
    {
      "id": "elem-456",
      "visualType": "bar_counter",
      "posX": 15,
      "posY": 10,
      "width": 8,
      "height": 3,
      "geometry": null
    }
  ]
}
```

## Implementation Steps

### Step 1: Create Collision Detection Module
Create `src/domains/floor-plan/shared/collisionDetection.ts`:
- `rectRectCollision()` - Rectangle vs rectangle
- `circleRectCollision()` - Circle vs rectangle
- `lineRectCollision()` - Line/wall vs rectangle
- `checkTableFixtureCollision()` - Main function that routes to correct algorithm
- `checkTableAllFixturesCollision()` - Check against array of fixtures

### Step 2: Integrate with FloorPlanHome
In `src/components/floor-plan/FloorPlanHome.tsx`:
1. Fetch fixtures when section loads (already done for FOH view)
2. In `handlePointerMove` (during drag), call collision check
3. Update visual state based on collision result
4. In `handlePointerUp` (drop), only save if no collision

### Step 3: Add Visual Feedback
- Add `isColliding` state to track collision during drag
- Apply CSS classes for valid/invalid visual states
- Optional: Show tooltip with blocking fixture name

### Step 4: Handle Edge Cases
- Tables being resized (not just moved)
- Rotated tables (if supported)
- Tables near canvas edges
- Multiple fixtures blocking same table

## Testing Checklist

- [ ] Cannot place table on top of wall
- [ ] Cannot place table on top of bar counter
- [ ] Cannot place table on top of circular pillar
- [ ] Cannot place table on top of kitchen area
- [ ] CAN place table in empty space
- [ ] CAN place table adjacent to (but not overlapping) fixtures
- [ ] Visual feedback shows red when invalid
- [ ] Visual feedback shows green/normal when valid
- [ ] Collision works during drag (live preview)
- [ ] Collision prevents final placement (on drop)
- [ ] Works with different table sizes (2-top, 4-top, 8-top)
- [ ] Works with circular tables
- [ ] Works with rectangular tables

## Reference Files

Read these files to understand existing patterns:

1. **FloorPlanHome.tsx** - Main FOH component with table rendering
   - `src/components/floor-plan/FloorPlanHome.tsx`
   - Contains table state, drag handling integration, fixture fetching

2. **useFloorPlanDrag.ts** - **CRITICAL** - Drag hook to modify
   - `src/components/floor-plan/hooks/useFloorPlanDrag.ts`
   - `handlePointerMove()` - Track drag position, detect drop targets
   - `handlePointerUp()` - Execute combine when dropped
   - Add collision detection in `handlePointerMove()` to block invalid positions

3. **TableNode.tsx** - Table rendering component
   - `src/components/floor-plan/TableNode.tsx`
   - Visual representation of tables

4. **Fixture types** - Understanding fixture shapes
   - `src/domains/floor-plan/admin/types.ts`
   - `src/domains/floor-plan/shared/types.ts`

5. **API response format** - How fixtures are returned
   - `src/app/api/floor-plan-elements/route.ts`

6. **Project documentation**
   - `docs/floor-plan/FLOOR-PLAN-PROJECT.md`

## Existing Drag Architecture

The drag system uses `useFloorPlanDrag` hook:

```typescript
// From useFloorPlanDrag.ts - This is the hook to modify

interface UseFloorPlanDragOptions {
  containerRef: RefObject<HTMLDivElement | null>
  tablesRef: RefObject<TableLike[]>
  autoScaleRef: RefObject<number>
  autoScaleOffsetRef: RefObject<{ x: number; y: number }>
  draggedTableId: string | null
  dropTargetTableId: string | null
  updateDragTarget: (tableId: string | null, position?: { x: number; y: number }) => void
  endDrag: () => void
  onCombine: (sourceId: string, targetId: string, dropPosition?: { x: number; y: number }) => Promise<boolean>
}

// handlePointerMove does coordinate transformation and hit testing
// This is where collision detection should be added
const handlePointerMove = useCallback((e: React.PointerEvent) => {
  // Transform screen coords to floor plan coords
  // Currently only checks for drop targets (other tables)
  // ADD: Check against fixtures array for collisions
}, [dependencies])
```

**Key Integration Points:**

1. **Add `fixturesRef` to hook options** - Pass fixtures for collision checking
2. **Add `isColliding` to return value** - Track collision state for visual feedback
3. **Modify `handlePointerMove`** - Check table position against all fixtures
4. **Modify `handlePointerUp`** - Prevent placement if colliding

## Success Criteria

1. Tables cannot overlap with any fixture type
2. Visual feedback clearly indicates valid/invalid positions
3. No performance degradation during drag operations
4. Code is clean, typed, and follows project patterns
5. All test checklist items pass

## 🚨 BOUNDARY RULES (MANDATORY)

**You are ONLY allowed to modify these files/directories:**

| Directory/File | Permission |
|----------------|------------|
| `src/domains/floor-plan/shared/collisionDetection.ts` | CREATE/MODIFY |
| `src/components/floor-plan/hooks/useFloorPlanDrag.ts` | MODIFY |
| `src/components/floor-plan/FloorPlanHome.tsx` | MODIFY (collision integration only) |
| `src/components/floor-plan/TableNode.tsx` | MODIFY (visual feedback only) |

**You MUST NOT touch:**
- `src/domains/floor-plan/admin/*` - Editor files owned by other workers
- `src/app/api/*` - API routes (unless explicitly told)
- `src/domains/floor-plan/seats/*` - Seats layer (WORKER-002)
- `src/domains/floor-plan/tables/*` - Tables layer (WORKER-003)
- Any files not listed above

**If you discover you need to modify something outside your boundary:**
1. STOP
2. Report the boundary conflict to your PM
3. Wait for instructions before proceeding

## Notes for WORKER

- Use the existing fixture data already being fetched in FloorPlanHome (check `dbFixtures` or similar)
- Keep collision detection pure (no side effects) for testability
- Consider adding unit tests for collision functions
- The coordinate system is in FEET, not pixels
- Tables use center-based positioning (x, y is center point)
- Walls use geometry with start/end points, other fixtures use posX/posY with width/height
