# GWI POS - Floor Plan Domain Architecture v3

## Domain Overview

The Floor Plan domain manages the physical layout of the venue, table positions, seating, staff assignments, table status, entertainment objects, and waitlist. It answers the questions: **WHERE is everything?** and **WHO is responsible?**

This domain does NOT handle orders, payments, or menu items - those belong to the Order Management domain and communicate through a Bridge Interface.

---

## Layer Summary

| Layer | Name | Purpose |
|-------|------|---------|
| L1 | Floor Canvas | Rooms, coordinates, grid, fixtures (walls, bar counters) |
| L2 | Tables & Smart Objects | Dining tables, pool tables, bar stools, all object types |
| L3 | Seats | Auto-positioning around tables, virtual seats |
| L4 | Table Groups | Physical merge (drag-snap) + Virtual groups (cross-room) |
| L5 | Admin Setup | Blueprint vs live state, persistence |
| L6 | Staff Roles | Hostess, servers, bussers, sections, rotation |
| L7 | Status Engine | 15-status state machine with timers and alerts |
| L8 | Entertainment | Pool/darts timers, pricing, entertainment waitlist |
| L9 | Waitlist | Dining waitlist with estimates and notifications |
| L10 | Per-Seat Ticketing | Future - individual seat orders |
| L11 | VIP & Events | Future - VIP sections, ticketed events |
| L12 | Bottle Service | Future - bottle tracking, minimums |

---

## Layer 1: Floor Canvas

### Your Job

Render the floor plan canvas with rooms, coordinate system, and fixtures. You own the "stage" — the physical space where everything else gets placed. You also own collision detection for fixtures.

### Data Model

```typescript
interface FloorPlan {
  id: string;
  locationId: string;
  name: string;            // "Main Dining", "Patio", "Bar Area"
  type: 'indoor' | 'outdoor' | 'bar' | 'private' | 'patio';
  widthFeet: number;
  heightFeet: number;
  gridSizeFeet: number;    // Snap grid (e.g., 0.5 = 6 inch grid)
  isActive: boolean;
  sortOrder: number;
  fixtures: Fixture[];
}

type FixtureType =
  | 'wall'
  | 'half_wall'
  | 'pillar'
  | 'bar_counter'
  | 'service_counter'
  | 'window'
  | 'door'
  | 'railing'
  | 'stairs'
  | 'stage_platform'
  | 'dance_floor'
  | 'kitchen_boundary'
  | 'restroom'
  | 'fire_exit'
  | 'ada_path'
  | 'planter_builtin'
  | 'custom_fixture';

type FixtureCategory =
  | 'barrier'      // Blocks placement AND movement (walls, pillars)
  | 'surface'      // Objects can snap to it (bar counter)
  | 'zone'         // Defines area, doesn't block (dance floor)
  | 'passage'      // Allows movement (doors, stairs)
  | 'clearance'    // Must stay clear (fire exit, ADA path)
  | 'decorative';  // Visual only

interface Fixture {
  id: string;
  floorPlanId: string;
  roomId: string;
  type: FixtureType;
  category: FixtureCategory;
  label: string;
  geometry: FixtureGeometry;
  color: string;
  opacity: number;
  thickness: number;
  height: string | null;    // "full", "half", "counter"
  blocksPlacement: boolean;
  blocksMovement: boolean;
  snapTarget: boolean;      // Can objects snap TO this?
  isActive: boolean;
}

type FixtureGeometry =
  | { type: 'line'; start: Point; end: Point }
  | { type: 'rectangle'; position: Point; width: number; height: number; rotation: number }
  | { type: 'circle'; center: Point; radius: number }
  | { type: 'polygon'; points: Point[] }
  | { type: 'arc'; center: Point; radius: number; startAngle: number; endAngle: number };

interface Point {
  x: number;  // feet from top-left
  y: number;
}
```

### What You Expose (Your Interface)

```typescript
interface FloorCanvasAPI {
  // Room management
  getFloorPlan(roomId?: string): FloorPlan;
  getAllRooms(): FloorPlan[];
  getActiveRoom(): string;
  setActiveRoom(roomId: string): void;
  getRoomsByType(type: string): FloorPlan[];

  // Coordinate system
  getCanvasDimensions(roomId?: string): { widthPx: number; heightPx: number };
  feetToPixels(feet: number): number;
  pixelsToFeet(pixels: number): number;
  snapToGrid(position: Point): Point;

  // Fixtures
  getFixtures(roomId: string): Fixture[];
  getFixturesByType(roomId: string, type: FixtureType): Fixture[];
  getFixturesByCategory(roomId: string, category: FixtureCategory): Fixture[];
  getBarCounters(roomId: string): Fixture[];

  // Collision detection (Layer 2 calls these)
  isPositionBlocked(roomId: string, position: Point, width: number, height: number): boolean;
  getSnapTargets(roomId: string, position: Point, snapDistance: number): Fixture[];
  getNearestFixtureEdge(roomId: string, position: Point, fixtureId: string): Point;
  getPlaceableArea(roomId: string): Point[];

  // Admin (fixture management)
  addFixture(fixture: Omit<Fixture, 'id'>): Fixture;
  updateFixture(fixtureId: string, updates: Partial<Fixture>): void;
  removeFixture(fixtureId: string): void;
}
```

### Acceptance Criteria

- [ ] Renders rooms with correct dimensions
- [ ] Grid snapping works at configured interval
- [ ] Fixtures render correctly by geometry type
- [ ] Collision detection blocks invalid placements
- [ ] Bar stools can snap to bar counter fixtures
- [ ] Fire exits and ADA paths reject object placement
- [ ] Room switching works smoothly
- [ ] Coordinate conversion (feet ↔ pixels) is accurate

---

## Layer 2: Tables & Smart Objects

### Your Job

Manage all objects placed on the floor plan — dining tables, bar stools, pool tables, decorations. You handle object creation, positioning, dragging, and properties. You call Layer 1 for collision detection.

### Data Model

```typescript
type ObjectType =
  // Seatable (dining)
  | 'dining_table'
  | 'booth'
  | 'bar_stool'
  | 'bar_rail'
  | 'high_top'
  | 'communal_table'
  // Entertainment
  | 'pool_table'
  | 'dart_board'
  | 'karaoke'
  | 'shuffleboard'
  | 'arcade'
  | 'bowling_lane'
  | 'cornhole'
  // Non-interactive
  | 'portable_planter'
  | 'portable_divider'
  | 'host_stand'
  | 'wait_station'
  | 'pos_terminal'
  | 'dj_booth'
  | 'coat_check'
  | 'high_chair_storage';

type ObjectCategory = 'seatable' | 'entertainment' | 'decorative' | 'service';

type TableShape = 'square' | 'rectangle' | 'round' | 'oval' | 'hexagon' | 'custom';

interface Table {
  id: string;
  locationId: string;
  floorPlanId: string;
  sectionId: string | null;

  // Identity
  label: string;           // "T1", "Bar 3", "Pool 1"
  objectType: ObjectType;
  category: ObjectCategory;
  shape: TableShape;

  // Position & size (in feet)
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  rotation: number;        // degrees

  // Capacity
  minCapacity: number;
  maxCapacity: number;
  defaultCapacity: number;

  // State
  isActive: boolean;
  isReservable: boolean;
  sortOrder: number;

  // Group membership
  groupId: string | null;
  combinedTableIds: string[];  // JSON array if merged

  // Visual
  color: string | null;    // Override color (from groups/status)

  // Entertainment-specific
  entertainmentConfig: EntertainmentConfig | null;
}

interface EntertainmentConfig {
  hourlyRate: number;
  minimumMinutes: number;
  overtimeMultiplier: number;
  requiresDeposit: boolean;
  depositAmount: number;
}
```

### What You Expose (Your Interface)

```typescript
interface TableAPI {
  // CRUD
  createTable(table: Omit<Table, 'id'>): Table;
  getTable(tableId: string): Table;
  updateTable(tableId: string, updates: Partial<Table>): void;
  deleteTable(tableId: string): void;

  // Queries
  getTablesForRoom(roomId: string): Table[];
  getTablesForSection(sectionId: string): Table[];
  getTablesByCategory(category: ObjectCategory): Table[];
  getEntertainmentObjects(): Table[];
  getSeatableTables(): Table[];

  // Position & movement
  moveTable(tableId: string, newPosition: Point): boolean;  // Returns false if blocked
  rotateTable(tableId: string, degrees: number): void;
  snapTableToFixture(tableId: string, fixtureId: string): void;

  // Capacity
  setTableCapacity(tableId: string, capacity: number): void;
  getAvailableCapacity(tableId: string): number;

  // Visual
  setTableColor(tableId: string, color: string): void;
  setTableStatus(tableId: string, status: string): void;

  // Bulk operations
  bulkUpdateTables(updates: { tableId: string; changes: Partial<Table> }[]): void;
}
```

### Acceptance Criteria

- [ ] Tables render correctly by shape
- [ ] Dragging respects collision detection
- [ ] Tables snap to grid when released
- [ ] Bar stools snap to bar counter edge
- [ ] Rotation works correctly
- [ ] Capacity is enforced
- [ ] Entertainment objects have config
- [ ] Bulk operations work efficiently

---

## Layer 3: Seats

### Your Job

Manage seats around tables. Auto-position seats based on table shape. Handle virtual seats (added during service). Manage seat displacement when tables merge.

### Data Model

```typescript
interface Seat {
  id: string;
  tableId: string;
  locationId: string;

  seatNumber: number;        // Display number (1, 2, 3...)
  positionIndex: number;     // Position around table (0-N)

  // Position relative to table center
  offsetX: number;           // feet from table center
  offsetY: number;
  angle: number;             // degrees from table center

  // State
  isOccupied: boolean;
  isVirtual: boolean;        // Added during service, removed on close
  orderId: string | null;    // Future: per-seat ticketing
  guestName: string | null;

  isActive: boolean;
}
```

### What You Expose (Your Interface)

```typescript
interface SeatAPI {
  // CRUD
  createSeat(seat: Omit<Seat, 'id'>): Seat;
  getSeat(seatId: string): Seat;
  updateSeat(seatId: string, updates: Partial<Seat>): void;
  deleteSeat(seatId: string): void;

  // Queries
  getSeatsForTable(tableId: string): Seat[];
  getOccupiedSeats(tableId: string): Seat[];
  getAvailableSeats(tableId: string): Seat[];

  // Auto-layout
  generateSeatsForTable(tableId: string, count: number, shape: TableShape): Seat[];
  repositionSeats(tableId: string): void;  // Recalculate positions

  // Virtual seats
  addVirtualSeat(tableId: string): Seat;
  removeVirtualSeat(seatId: string): void;
  clearVirtualSeats(tableId: string): void;

  // Occupancy
  setSeatOccupied(seatId: string, occupied: boolean, guestName?: string): void;

  // Merge handling
  renumberSeatsForMerge(tableIds: string[]): Map<string, number>;  // seatId → new number
  handleSeamEdgeDisplacement(table1Id: string, table2Id: string): void;
}
```

### Seat Auto-Positioning Logic

```
ROUND TABLE (8 seats):
     1
  8     2
 7   ●   3
  6     4
     5

RECTANGLE TABLE (6 seats):
    1   2
  6  ████  3
    5   4

BOOTH (4 seats, 2 per side):
  ████████
  1  2  (back wall)
  ████████
  3  4  (open side)
```

### Acceptance Criteria

- [ ] Seats auto-position by table shape
- [ ] Seat numbers display correctly
- [ ] Virtual seats can be added/removed
- [ ] Occupancy tracking works
- [ ] Merge renumbering is sequential
- [ ] Seam edge seats are displaced correctly

---

## Layer 4: Table Groups

### Your Job

Handle table merging (physical drag-snap) and virtual grouping (cross-room linking). Manage group colors, identifiers, and combined seating.

### Key Concepts

**Physical Merge**: Drag Table A to Table B in the same room. They snap together, seats renumber sequentially, share one color.

**Virtual Group**: Long-hold to select multiple tables (even across rooms). They're linked for ordering but don't physically move.

### Data Model

```typescript
interface TableGroup {
  id: string;
  locationId: string;

  tableIds: string[];        // All tables in group
  primaryTableId: string;    // The "anchor" table

  isVirtual: boolean;        // Virtual = cross-room, no movement

  // Visual
  color: string;             // Group color (from palette)
  identifier: string;        // "Smith-8PM", "Party of 12"

  // Capacity
  combinedCapacity: number;

  // State
  isActive: boolean;
  createdAt: Date;
  createdBy: string;         // Staff ID
}

const GROUP_COLOR_PALETTE = [
  '#E74C3C',  // Red
  '#3498DB',  // Blue
  '#2ECC71',  // Green
  '#9B59B6',  // Purple
  '#F39C12',  // Orange
  '#1ABC9C',  // Teal
  '#E91E63',  // Pink
  '#00BCD4',  // Cyan
];
```

### What You Expose (Your Interface)

```typescript
interface TableGroupAPI {
  // Create/dissolve
  createPhysicalMerge(tableIds: string[]): TableGroup;
  createVirtualGroup(tableIds: string[]): TableGroup;
  dissolveGroup(groupId: string): void;

  // Queries
  getGroup(groupId: string): TableGroup;
  getGroupForTable(tableId: string): TableGroup | null;
  getAllActiveGroups(): TableGroup[];
  getGroupsInRoom(roomId: string): TableGroup[];

  // Membership
  addTableToGroup(groupId: string, tableId: string): void;
  removeTableFromGroup(groupId: string, tableId: string): void;

  // Properties
  setGroupColor(groupId: string, color: string): void;
  setGroupIdentifier(groupId: string, identifier: string): void;

  // Seats
  getGroupSeats(groupId: string): Seat[];
  getGroupSeatCount(groupId: string): number;

  // Cross-room
  getGroupRooms(groupId: string): string[];  // Room IDs
  isCrossRoomGroup(groupId: string): boolean;
}
```

### Acceptance Criteria

- [ ] Physical merge snaps tables together
- [ ] Seats renumber sequentially after merge
- [ ] Virtual groups link without moving
- [ ] Group colors apply to all member tables
- [ ] Cross-room badge shows on virtual groups
- [ ] Dissolve restores original positions
- [ ] Colors cycle through palette

---

## Layer 5: Admin Setup & Persistence

### Your Job

Manage blueprint (saved default layout) vs live state (current service). Handle save/load, layout templates, and shift reset.

### Key Concepts

**Blueprint**: The saved "default" floor plan. Never modified during service.

**Live State**: Current positions during a shift. Can diverge from blueprint. Resets to blueprint at end of shift.

### What You Expose (Your Interface)

```typescript
interface AdminAPI {
  // Blueprint
  saveBlueprint(roomId: string): void;
  loadBlueprint(roomId: string): void;
  resetToBlueprint(roomId: string): void;

  // Live state
  getLiveState(roomId: string): FloorPlanState;
  saveLiveState(roomId: string): void;

  // Templates
  saveAsTemplate(roomId: string, templateName: string): void;
  loadTemplate(roomId: string, templateName: string): void;
  getTemplates(): string[];
  deleteTemplate(templateName: string): void;

  // Shift management
  startShift(): void;
  endShift(): void;
  isShiftActive(): boolean;
}
```

### Acceptance Criteria

- [ ] Blueprint saves/loads correctly
- [ ] Live state tracks changes during service
- [ ] Reset to blueprint restores default
- [ ] Templates can be saved/loaded
- [ ] Shift start/end works

---

## Layer 6: Staff Roles & Assignments

### Your Job

Manage staff assignments to sections, server rotation, hostess seating logic, and busser alerts.

### Data Model

```typescript
type StaffRole = 'hostess' | 'server' | 'bartender' | 'busser' | 'manager' | 'food_runner';

interface StaffAssignment {
  id: string;
  staffId: string;
  staffName: string;
  role: StaffRole;
  sectionId: string | null;
  tableIds: string[];        // Direct table assignments
  shiftStart: Date;
  shiftEnd: Date | null;
  isActive: boolean;
}

interface Section {
  id: string;
  name: string;              // "Section A", "Bar", "Patio"
  roomId: string;
  tableIds: string[];
  assignedStaffId: string | null;
  color: string;
  sortOrder: number;
  isActive: boolean;
}
```

### What You Expose (Your Interface)

```typescript
interface StaffAPI {
  // Assignments
  assignStaffToSection(staffId: string, sectionId: string): void;
  assignStaffToTable(staffId: string, tableId: string): void;
  unassignStaff(staffId: string): void;

  // Queries
  getAssignmentsForShift(): StaffAssignment[];
  getStaffForTable(tableId: string): StaffAssignment | null;
  getStaffForSection(sectionId: string): StaffAssignment | null;

  // Sections
  createSection(section: Omit<Section, 'id'>): Section;
  getSections(roomId?: string): Section[];
  updateSection(sectionId: string, updates: Partial<Section>): void;

  // Rotation (hostess seating)
  getNextSectionInRotation(): Section;
  recordSeating(sectionId: string): void;  // Mark that this section got a table
  getRotationOrder(): Section[];

  // Alerts
  notifyBusser(tableId: string): void;
  notifyServer(tableId: string, message: string): void;
}
```

### Acceptance Criteria

- [ ] Staff can be assigned to sections
- [ ] Rotation tracks which section is next
- [ ] Busser alerts fire correctly
- [ ] Section colors display on floor plan
- [ ] Multiple servers can share a section

---

## Layer 7: Table Status Engine

### Your Job

Manage the 15-state lifecycle of a dining table. Handle status transitions, timers, alerts, and color updates.

### The 15 Statuses

```typescript
type TableStatus =
  | 'available'       // Empty, clean, ready
  | 'reserved'        // Held for reservation
  | 'seating'         // Hostess walking guests over
  | 'seated'          // Guests sat, no order yet
  | 'occupied'        // Has guests (legacy, use seated)
  | 'ordering'        // Actively ordering
  | 'food_pending'    // Order sent to kitchen
  | 'food_served'     // Food delivered
  | 'check_requested' // Guest wants bill
  | 'check_dropped'   // Bill presented
  | 'paid'            // Payment received
  | 'dirty'           // Needs bussing
  | 'bussing'         // Busser clearing
  | 'blocked'         // Out of service
  | 'closed';         // End of shift

const STATUS_COLORS: Record<TableStatus, string> = {
  available:       '#FFFFFF',  // White
  reserved:        '#F0E6FF',  // Light purple
  seating:         '#FFF9C4',  // Light yellow
  seated:          '#E3F2FD',  // Light blue
  occupied:        '#E3F2FD',  // Light blue
  ordering:        '#BBDEFB',  // Blue
  food_pending:    '#FFE0B2',  // Light orange
  food_served:     '#C8E6C9',  // Light green
  check_requested: '#FFCDD2',  // Light red
  check_dropped:   '#EF9A9A',  // Red
  paid:            '#A5D6A7',  // Green
  dirty:           '#D7CCC8',  // Brown
  bussing:         '#FFCC80',  // Orange
  blocked:         '#9E9E9E',  // Gray
  closed:          '#616161',  // Dark gray
};
```

### Valid Transitions

```
available → reserved, seating
reserved → seating, available
seating → seated, available
seated → ordering
ordering → food_pending
food_pending → food_served
food_served → check_requested
check_requested → check_dropped
check_dropped → paid
paid → dirty
dirty → bussing
bussing → available
blocked → available
```

### What You Expose (Your Interface)

```typescript
interface StatusEngineAPI {
  // Status
  getTableStatus(tableId: string): TableStatus;
  setTableStatus(tableId: string, status: TableStatus): boolean;  // False if invalid transition

  // Bulk
  getAllStatuses(): Map<string, TableStatus>;
  getTablesByStatus(status: TableStatus): string[];

  // Timers
  getTimeInStatus(tableId: string): number;  // Seconds
  getSeatedDuration(tableId: string): number;

  // Alerts
  getActiveAlerts(): Alert[];
  acknowledgeAlert(alertId: string): void;

  // Analytics
  getAverageTurnTime(hours?: number): number;
  getStatusHistory(tableId: string): StatusChange[];
}
```

### Acceptance Criteria

- [ ] All 15 statuses work correctly
- [ ] Invalid transitions are rejected
- [ ] Colors update on status change
- [ ] Timers track time in each status
- [ ] Alerts fire at thresholds
- [ ] Turn time analytics are accurate

---

## Layer 8: Entertainment Management

### Your Job

Manage timed entertainment sessions (pool, darts, etc.). Handle pricing, timers, overtime, and entertainment-specific waitlist.

### Data Model

```typescript
interface EntertainmentSession {
  id: string;
  objectId: string;          // The pool table, dart board, etc.
  guestName: string;
  guestCount: number;

  // Timing
  startedAt: Date;
  endedAt: Date | null;
  bookedMinutes: number;
  pausedAt: Date | null;
  totalPausedSeconds: number;

  // Billing
  linkedTableId: string | null;
  linkedTicketId: string | null;
  depositCollected: number;

  // State
  status: 'active' | 'paused' | 'overtime' | 'ended';
}

interface EntertainmentPricing {
  objectId: string;
  baseRatePerHour: number;
  minimumMinutes: number;
  overtimeMultiplier: number;
  happyHourRate: number | null;
  happyHourStart: string | null;  // "16:00"
  happyHourEnd: string | null;    // "18:00"
}
```

### What You Expose (Your Interface)

```typescript
interface EntertainmentAPI {
  // Sessions
  startSession(objectId: string, guestName: string, guestCount: number, minutes: number): EntertainmentSession;
  endSession(objectId: string): EntertainmentSession;
  pauseSession(objectId: string): void;
  resumeSession(objectId: string): void;
  extendSession(objectId: string, additionalMinutes: number): void;

  // Queries
  getSession(objectId: string): EntertainmentSession | null;
  getAllActiveSessions(): EntertainmentSession[];

  // Billing
  getElapsedTime(objectId: string): number;
  getRemainingTime(objectId: string): number;
  getCurrentCharges(objectId: string): number;
  isOvertime(objectId: string): boolean;

  // Linking
  linkSessionToTable(objectId: string, tableId: string, ticketId: string): void;

  // Waitlist (entertainment-specific)
  addToEntertainmentWaitlist(entry: EntertainmentWaitlistEntry): void;
  getEntertainmentWaitlist(objectType?: ObjectType): EntertainmentWaitlistEntry[];
}
```

### Acceptance Criteria

- [ ] Sessions start/stop correctly
- [ ] Timers count down accurately
- [ ] Overtime detection works
- [ ] Charges calculate with overtime multiplier
- [ ] Happy hour pricing applies
- [ ] Linking to dining table works

---

## Layer 9: Waitlist (Dining)

### Your Job

Manage the guest waitlist for dining. Track queue position, estimated wait times, and notifications.

### Data Model

```typescript
interface WaitlistEntry {
  id: string;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  seatingPreference: SeatingPreference;

  addedAt: Date;
  estimatedWaitMinutes: number;
  quotedWaitMinutes: number;
  position: number;

  status: 'waiting' | 'notified' | 'seated' | 'no_show' | 'cancelled' | 'expired';

  notifiedAt: Date | null;
  seatedAt: Date | null;
  seatedTableId: string | null;

  notes: string;
  vipFlag: boolean;
  addedBy: string;
}

interface SeatingPreference {
  indoor: boolean;
  outdoor: boolean;
  bar: boolean;
  booth: boolean;
  highTop: boolean;
  accessible: boolean;
  quietArea: boolean;
  nearEntertainment: boolean;
  specificRoom: string | null;
  specificServer: string | null;
}
```

### What You Expose (Your Interface)

```typescript
interface WaitlistAPI {
  // Queue
  addToWaitlist(entry: Omit<WaitlistEntry, 'id' | 'addedAt' | 'position' | 'status'>): WaitlistEntry;
  removeFromWaitlist(entryId: string): void;
  getWaitlist(): WaitlistEntry[];
  getPosition(entryId: string): number;

  // Estimation
  getEstimatedWait(partySize: number, preferences?: SeatingPreference): number;

  // Actions
  notifyGuest(entryId: string): void;
  seatGuest(entryId: string, tableId: string): void;
  markNoShow(entryId: string): void;

  // Reordering
  moveUp(entryId: string): void;
  moveDown(entryId: string): void;
  flagAsVip(entryId: string): void;
}
```

### Acceptance Criteria

- [ ] Guests can be added with preferences
- [ ] Position updates correctly
- [ ] Wait estimates are reasonable
- [ ] Notifications fire when ready
- [ ] VIP flag bumps priority
- [ ] No-show handling works

---

## File Structure

```
src/
  domains/
    floor-plan/
      shared/                 ← Shared types and interfaces
        types.ts
        interfaces.ts
        constants.ts

      canvas/                 ← Layer 1
        FloorCanvas.tsx
        floorCanvasAPI.ts
        FixtureRenderer.tsx
        types.ts
        __tests__/

      tables/                 ← Layer 2
        Table.tsx
        SmartObject.tsx
        tableAPI.ts
        types.ts
        __tests__/

      seats/                  ← Layer 3
        Seat.tsx
        seatAPI.ts
        seatLayout.ts
        types.ts
        __tests__/

      groups/                 ← Layer 4
        TableGroup.tsx
        tableGroupAPI.ts
        mergeLogic.ts
        virtualGroup.ts
        colorPalette.ts
        types.ts
        __tests__/

      admin/                  ← Layer 5
        AdminSetup.tsx
        adminAPI.ts
        blueprintManager.ts
        types.ts
        __tests__/

      staff/                  ← Layer 6
        StaffManager.tsx
        staffAPI.ts
        SectionManager.tsx
        rotationEngine.ts
        types.ts
        __tests__/

      status/                 ← Layer 7
        StatusEngine.ts
        statusEngineAPI.ts
        statusColors.ts
        stateMachine.ts
        alertManager.ts
        types.ts
        __tests__/

      entertainment/          ← Layer 8
        EntertainmentManager.tsx
        entertainmentAPI.ts
        sessionTimer.ts
        pricingEngine.ts
        types.ts
        __tests__/

      waitlist/               ← Layer 9
        WaitlistManager.tsx
        waitlistAPI.ts
        waitTimeEstimator.ts
        types.ts
        __tests__/
```

---

## Build Order

```
Phase 1 — Foundation (Layers 1-3):
  1. Layer 1: Floor Canvas + Fixtures
  2. Layer 2: Tables + Smart Objects
  3. Layer 3: Seats + Auto-layout
  4. Integration test: Canvas + Tables + Seats

Phase 2 — Core Service (Layers 4-7):
  5. Layer 7: Status Engine (can be built in parallel)
  6. Layer 6: Staff & Roles
  7. Layer 4: Table Groups
  8. Integration test: All core layers

Phase 3 — Advanced Features (Layers 5, 8-9):
  9.  Layer 5: Admin + Persistence
  10. Layer 8: Entertainment
  11. Layer 9: Waitlist
  12. Full integration test
```

---

## Rules for All Workers

1. **Read only YOUR layer's section.** Understand dependency interfaces but don't read their implementation.
2. **Never modify another layer's files.**
3. **Test your layer in isolation first.**
4. **Interface changes require PM approval.**
5. **Use exact property names from this spec.**
6. **Colors flow DOWN from Layer 4 (groups) and Layer 7 (status).**
7. **Virtual groups never move tables.**
8. **Entertainment and dining are separate systems.**
