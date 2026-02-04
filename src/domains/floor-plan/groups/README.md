# Layer 4: Table Groups

Handles table merging (physical drag-snap) and virtual grouping (cross-room linking).

## Architecture

```
tableGroupAPI.ts      ← Central service (all group operations)
├── colorPalette.ts   ← Color assignment and cycling
├── mergeLogic.ts     ← Snap calculations for physical merge
├── virtualGroup.ts   ← Long-hold selection for virtual groups
├── TableGroup.tsx    ← Renders group visuals (border, badges)
└── CrossRoomBadge.tsx ← Cross-room indicator
```

## Two Group Types

### 1. Physical Merge
Tables drag together in the same room. They snap, seats renumber, share one color.

```typescript
const group = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);
// - Tables snap to adjacent edges
// - Seats renumber sequentially (1, 2, 3...)
// - Both tables share group color
// - isVirtual: false
```

### 2. Virtual Group
Long-hold to select multiple tables (even across rooms). Linked for ordering, don't move.

```typescript
const group = tableGroupAPI.createVirtualGroup(['table-1', 'table-3']);
// - Tables stay in place
// - Share group color
// - Can span multiple rooms
// - isVirtual: true
```

## API Usage

### Creating Groups

```typescript
import { tableGroupAPI } from '@/domains/floor-plan/groups';

// Physical merge
const mergedGroup = tableGroupAPI.createPhysicalMerge(['t1', 't2']);

// Virtual group
const virtualGroup = tableGroupAPI.createVirtualGroup(['t1', 't3', 't5']);
```

### Querying Groups

```typescript
// Get group by ID
const group = tableGroupAPI.getGroup('group-1');

// Get group for a table
const group = tableGroupAPI.getGroupForTable('table-1');

// Get all active groups
const allGroups = tableGroupAPI.getAllActiveGroups();

// Get groups in a room
const roomGroups = tableGroupAPI.getGroupsInRoom('room-1');
```

### Managing Groups

```typescript
// Set identifier (e.g., "Smith-8PM")
tableGroupAPI.setGroupIdentifier('group-1', 'Smith-8PM');

// Add table to group
tableGroupAPI.addTableToGroup('group-1', 'table-5');

// Remove table from group
tableGroupAPI.removeTableFromGroup('group-1', 'table-5');

// Dissolve group
tableGroupAPI.dissolveGroup('group-1');
```

### Cross-Room Detection

```typescript
// Check if group spans multiple rooms
const isCrossRoom = tableGroupAPI.isCrossRoomGroup('group-1');

// Get all rooms in group
const rooms = tableGroupAPI.getGroupRooms('group-1');
```

## Physical Merge Logic

### Snap Detection

```typescript
import { detectMergeOpportunity } from '@/domains/floor-plan/groups';

const detection = detectMergeOpportunity(
  draggingTable,
  targetTable,
  currentDragPosition
);

if (detection.canMerge) {
  // Snap to detection.snapPosition
  // Update table position to align with detection.snapEdge
}
```

### Snap Constants

```typescript
MERGE_CONSTANTS = {
  SNAP_DISTANCE_FEET: 1.0,      // Tables within 1 foot can snap
  SNAP_ALIGN_TOLERANCE: 0.25,   // Alignment tolerance
  LONG_HOLD_DURATION_MS: 500,   // Long-hold duration
}
```

### Adjacent Check

```typescript
import { areTablesAdjacent } from '@/domains/floor-plan/groups';

if (areTablesAdjacent(table1, table2)) {
  // Tables are touching
}
```

## Virtual Group Selection

### Long-Hold Flow

```typescript
import {
  startLongHold,
  cancelLongHold,
  confirmVirtualGroup,
  onSelectionChange,
} from '@/domains/floor-plan/groups';

// Start long-hold on pointer down
function handlePointerDown(tableId: string) {
  startLongHold(tableId, () => {
    // Long-hold completed - enter selection mode
    console.log('Selection mode started');
  });
}

// Cancel on pointer up/move
function handlePointerUp() {
  cancelLongHold();
}

// Listen to selection changes
const unsubscribe = onSelectionChange((state) => {
  console.log('Selected tables:', state.selectedTableIds);
});
```

### Selection State

```typescript
import {
  isInSelectionMode,
  isTableSelected,
  getSelectedTableIds,
  toggleVirtualSelection,
  cancelVirtualSelection,
} from '@/domains/floor-plan/groups';

// Check if in selection mode
if (isInSelectionMode()) {
  // Show "Confirm Group" button
}

// Check if table is selected
if (isTableSelected('table-1')) {
  // Highlight table
}

// Toggle selection on tap
function handleTableTap(tableId: string) {
  if (isInSelectionMode()) {
    toggleVirtualSelection(tableId);
  }
}

// Confirm and create group
function handleConfirm() {
  const tableIds = confirmVirtualGroup();
  tableGroupAPI.createVirtualGroup(tableIds);
}

// Cancel selection
function handleCancel() {
  cancelVirtualSelection();
}
```

## Color Palette

### Auto Color Assignment

```typescript
import { getNextAvailableColor } from '@/domains/floor-plan/groups';

const color = getNextAvailableColor();
// Returns next unused color from palette
// Cycles if all 8 colors in use
```

### Color Management

```typescript
import {
  markColorInUse,
  releaseColor,
  getAvailableColorCount,
} from '@/domains/floor-plan/groups';

// Mark color as used (when loading existing groups)
markColorInUse('#E74C3C');

// Release color (when dissolving group)
releaseColor('#E74C3C');

// Check available colors
const count = getAvailableColorCount();
```

## React Components

### TableGroup Component

Renders visual indicators around grouped tables.

```tsx
import { TableGroup } from '@/domains/floor-plan/groups';

<TableGroup
  group={group}
  tables={allTables}
  scale={20} // pixels per foot
/>
```

**Renders:**
- Colored border (solid for physical, dashed for virtual)
- Group identifier badge (e.g., "Smith-8PM")
- Seat count badge
- "Virtual Group" indicator

### CrossRoomBadge Component

Shows badge on tables in cross-room groups.

```tsx
import { CrossRoomBadge, CrossRoomBadgeCompact } from '@/domains/floor-plan/groups';

<CrossRoomBadge
  group={group}
  roomCount={3}
  onClick={() => highlightAllGroupTables(group.id)}
/>

// Or compact version
<CrossRoomBadgeCompact group={group} roomCount={3} />
```

## Integration Points

### Layer 2: Tables

```typescript
// TODO: Import when Layer 2 is available
import { TableAPI } from '../tables';

// Used for:
// - Getting table data (position, room, etc.)
// - Updating table positions after merge
// - Setting table colors
// - Setting table.groupId field
```

### Layer 3: Seats

```typescript
// TODO: Import when Layer 3 is available
import { SeatAPI } from '../seats';

// Used for:
// - Renumbering seats after merge
// - Getting seat counts for capacity
// - Handling seam edge displacement
```

## Database Integration

### Current State
In-memory storage using Map structures. Ready for database migration.

### Database Schema (Future)

```prisma
model TableGroup {
  id               String   @id @default(cuid())
  locationId       String
  tableIds         String[] // Array of table IDs
  primaryTableId   String
  isVirtual        Boolean  @default(false)
  color            String
  identifier       String   @default("")
  combinedCapacity Int      @default(0)
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  createdBy        String

  location         Location @relation(fields: [locationId], references: [id])

  @@index([locationId])
  @@index([isActive])
}
```

### Migration Steps
1. Create Prisma schema for TableGroup
2. Replace Map storage with Prisma calls
3. Add group endpoints to API routes
4. Update tableGroupAPI to use database

## Testing Checklist

- [ ] Physical merge creates group when tables snap together
- [ ] Tables snap to adjacent edges correctly
- [ ] Merged tables share the same color
- [ ] Virtual groups can link tables across rooms
- [ ] Virtual groups don't move tables
- [ ] Group colors cycle through palette
- [ ] Group identifier can be set
- [ ] dissolveGroup restores tables to ungrouped state
- [ ] getGroupSeats returns all seats across merged tables
- [ ] isCrossRoomGroup correctly identifies multi-room groups
- [ ] TableGroup.tsx renders colored border around grouped tables
- [ ] CrossRoomBadge.tsx shows on cross-room group tables
- [ ] Long-hold gesture starts virtual selection
- [ ] Tapping tables toggles selection in selection mode
- [ ] Color is released back to pool on dissolve

## Known Limitations

1. **No persistence**: Groups stored in memory only (until DB integration)
2. **No TableAPI integration**: TODOs marked where Layer 2 integration needed
3. **No SeatAPI integration**: TODOs marked where Layer 3 integration needed
4. **No position restoration**: Dissolve doesn't restore original positions (needs TableAPI)
5. **No capacity calculation**: combinedCapacity not calculated (needs SeatAPI)

## Future Enhancements

- [ ] Drag-to-reorder tables within group
- [ ] Group templates (save/load common groupings)
- [ ] Auto-suggest merge based on party size
- [ ] Split group (break into smaller groups)
- [ ] Group history tracking
- [ ] Undo/redo for group operations
