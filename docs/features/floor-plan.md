# Feature: Floor Plan

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Floor Plan is the primary POS interface for service-floor operations. It renders an interactive SVG canvas showing tables, seats, fixtures, entertainment items, and sections. Staff tap tables to open/view orders, combine tables (physical drag-drop or virtual long-hold), and manage the service floor in real time. The admin Floor Plan Editor allows managers to design room layouts with drag, resize, and rotation. Entertainment items (pool tables, dart boards) are placed on the floor plan with live status colors.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, POS canvas (FloorPlanHome), admin editor | Full |
| `gwi-android-register` | Full floor plan editor + table management | Full |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | `/orders` (FloorPlanHome tab) | All staff |
| Admin | `/settings/floor-plan` (FloorPlanEditor) | Managers |
| Android | `FloorPlanScreen` | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/components/floor-plan/FloorPlanHome.tsx` | Primary POS floor plan with inline ordering |
| `src/components/floor-plan/FloorPlanEditor.tsx` | Admin drag-drop layout editor |
| `src/components/floor-plan/UnifiedFloorPlan.tsx` | Shared floor plan rendering |
| `src/components/floor-plan/entertainment-visuals.tsx` | 12 SVG visual types for entertainment |
| `src/components/floor-plan/AddEntertainmentPalette.tsx` | Place entertainment items on floor plan |
| `src/components/floor-plan/FloorPlanEntertainment.tsx` | Render entertainment on FOH floor plan |
| `src/domains/floor-plan/admin/EntertainmentProperties.tsx` | Editor properties panel |
| `src/lib/seat-generation.ts` | Seat position generation algorithms |
| `src/lib/virtual-group-seats.ts` | Virtual group seat numbering |
| `src/lib/floorplan/queries.ts` | Floor plan database queries |
| `src/lib/floorplan/serializers.ts` | Data serialization |
| `src/lib/events/table-events.ts` | Table event handling |
| `src/lib/socket-dispatch.ts` | `dispatchFloorPlanUpdate()`, `dispatchTableStatusChanged()` |
| `src/app/api/tables/route.ts` | Table CRUD (GET/POST) |
| `src/app/api/tables/[id]/route.ts` | Single table (GET/PUT/DELETE) |
| `src/app/api/tables/[id]/seats/route.ts` | Seat management per table |
| `src/app/api/tables/[id]/seats/generate/route.ts` | Generate seats |
| `src/app/api/tables/[id]/seats/auto-generate/route.ts` | Auto-generate seat positions |
| `src/app/api/tables/[id]/seats/reflow/route.ts` | Reflow seat positions |
| `src/app/api/tables/[id]/seats/bulk/route.ts` | Bulk seat operations |
| `src/app/api/tables/[id]/seats/save-as-default/route.ts` | Save seat layout as default |
| `src/app/api/tables/[id]/seats/[seatId]/route.ts` | Single seat |
| `src/app/api/tables/[id]/transfer/route.ts` | Transfer table ownership |
| `src/app/api/tables/bulk-update/route.ts` | Bulk table position update |
| `src/app/api/tables/save-default-layout/route.ts` | Save entire layout as default |
| `src/app/api/tables/seats/generate-all/route.ts` | Generate seats for all tables |
| `src/app/api/tables/seats/save-all-as-default/route.ts` | Save all seat layouts |
| `src/app/api/seats/route.ts` | Seat CRUD |
| `src/app/api/seats/[id]/route.ts` | Single seat |
| `src/app/api/seats/cleanup-duplicates/route.ts` | Remove duplicate seats |
| `src/app/api/sections/route.ts` | Section CRUD |
| `src/app/api/sections/[id]/route.ts` | Single section |
| `src/app/api/sections/reorder/route.ts` | Reorder sections |
| `src/app/api/floor-plan-elements/route.ts` | Floor plan elements (entertainment, fixtures) |
| `src/app/api/floor-plan-elements/[id]/route.ts` | Single element |

---

## API Endpoints

### Tables

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/tables` | Employee PIN | List tables. Query: `locationId` (required), `sectionId`, `status` (available/occupied/dirty/reserved), `includeSeats`, `includeOrders`, `includeOrderItems`. Includes `seatCount` and `currentOrder`. |
| `POST` | `/api/tables` | Employee PIN | Create a table. Duplicate name check across all sections. Auto-grid placement when `posX`/`posY` omitted (3-col grid, 180x150 spacing). Dispatches `floor-plan:updated`. |
| `GET` | `/api/tables/[id]` | Employee PIN | Get a single table with its active orders (status: open/sent/in_progress/split) and order items with modifiers. |
| `PUT` | `/api/tables/[id]` | Employee PIN | Update table (name, position, size, rotation, shape, seatPattern, status, sectionId). Supports optimistic locking via `version` field — returns 409 on conflict. Dispatches `table:status-changed` when status changes. |
| `DELETE` | `/api/tables/[id]` | Employee PIN | Soft-delete table. Blocked if table has open orders. |
| `POST` | `/api/tables/[id]/transfer` | Employee PIN | Transfer all open orders on a table to a different employee. Creates audit log entries per order and for the table. Emits `ORDER_METADATA_UPDATED` event for each order. |
| `PUT` | `/api/tables/bulk-update` | Employee PIN | Bulk update positions (posX, posY, width, height, rotation) in a single transaction. Server-side normalizes all coordinates to grid alignment. Also saves positions as `defaultPosX/Y`. |
| `POST` | `/api/tables/save-default-layout` | Employee PIN | Save specific table positions as the admin-defined default (used for reset-to-default). |
| `GET/POST` | `/api/tables/[id]/seats` | Employee PIN | List or create seats for a table. POST supports `insertAt` to renumber existing seats. |
| `POST` | `/api/tables/[id]/seats/generate` | Employee PIN | Regenerate seats using `pattern` and `count`. Hard-deletes existing seats before creating (avoids unique constraint conflicts). |
| `POST` | `/api/tables/[id]/seats/auto-generate` | Employee PIN | Advanced seat generation with collision detection (vs. other tables and fixtures). Supports `seatPattern`, `labelPattern` (numeric/alpha/alphanumeric), `checkCollisions`, `forceGenerate`. Also updates `table.seatPattern` if `updateTablePattern=true`. Audit-logged. |
| `POST` | `/api/tables/[id]/seats/reflow` | Employee PIN | Reflow seat positions after table resize. Supports dynamic clearance based on available space per side. Handles circular and rectangular tables separately. |
| `PUT` | `/api/tables/[id]/seats/bulk` | Employee PIN | Bulk-update multiple seats in one transaction (label, seatNumber, relativeX/Y, angle, seatType). |
| `POST` | `/api/tables/[id]/seats/save-as-default` | Employee PIN | Save current seat positions for this table as the builder default. Audit-logged. |
| `GET/PUT/DELETE` | `/api/tables/[id]/seats/[seatId]` | Employee PIN | Get, update, or soft-delete a single seat. DELETE blocked if seat has active tickets (sold/held/checked_in). PUT with `context=pos` only allows moving `isTemporary` seats. |
| `POST` | `/api/tables/seats/generate-all` | Employee PIN | Bulk-generate seats for all tables in a location. Skips tables that already have seats unless `forceRegenerate=true`. Shape/pattern-aware. Audit-logged. |
| `POST` | `/api/tables/seats/save-all-as-default` | Employee PIN | Save all current seat positions across all tables (or specific `tableIds`) as builder defaults. Audit-logged. |

### Seats (Global)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/seats` | Employee PIN | List all seats for a location. Filters: `tableId`, `status` (active). Includes table name and shape. |
| `POST` | `/api/seats` | Employee PIN | Create a seat directly. Auto-increments seatNumber if not provided. |
| `GET` | `/api/seats/[id]` | Employee PIN | Get a single seat with full table info. |
| `PUT` | `/api/seats/[id]` | Employee PIN | Update seat. `context=pos` restricts moves to temporary seats only. |
| `DELETE` | `/api/seats/[id]` | Employee PIN | Soft-delete seat. |
| `GET` | `/api/seats/cleanup-duplicates` | Employee PIN | Dry-run check for duplicate seats (same tableId + seatNumber). |
| `POST` | `/api/seats/cleanup-duplicates` | Employee PIN | Clean up duplicate seats. `dryRun=true` (default) reports without changes; `dryRun=false` soft-deletes duplicates (keeps oldest by createdAt). |

### Sections

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/sections` | Employee PIN | List all sections. Includes `tableCount`, `assignedEmployees` (active `SectionAssignment` records), and room dimensions (`widthFeet`, `heightFeet`, `gridSizeFeet`). |
| `POST` | `/api/sections` | Employee PIN | Create a section. Auto-assigns `sortOrder` at end of list. Defaults: color `#6366f1`, 40x30 ft, 0.25 ft grid. |
| `GET` | `/api/sections/[id]` | Employee PIN | Get a single section with all fields including `isVisible`. |
| `PUT` | `/api/sections/[id]` | Employee PIN | Update section (name, color, isVisible, posX/Y, width/height in pixels, widthFeet/heightFeet/gridSizeFeet). |
| `DELETE` | `/api/sections/[id]` | Employee PIN | Soft-delete section. Tables in the section are moved to `sectionId: null` (not deleted). |
| `PUT` | `/api/sections/reorder` | Employee PIN | Reorder sections by `sortOrder`. Body: `{ locationId, roomIds: [id1, id2, ...] }`. Uses `roomIds` naming (sections are rooms). |

### Floor Plan Elements

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/floor-plan-elements` | Employee PIN | List elements for location. Filters: `sectionId`. Includes `linkedMenuItem`, `section`, and `waitlistEntries` (active waitlist). |
| `POST` | `/api/floor-plan-elements` | Employee PIN | Create element. Required: `locationId`, `name`, `visualType`. Auto-grid placement (3-col, starting X=400 to avoid table overlap). Validates `linkedMenuItemId` and `sectionId` if provided. |
| `GET` | `/api/floor-plan-elements/[id]` | Employee PIN | Get single element with linked menu item, section, and waitlist entries (includes table info). |
| `PUT` | `/api/floor-plan-elements/[id]` | Employee PIN | Update element (name, position, size, rotation, geometry, visual props, status, session timestamps, isLocked, isVisible). Used by entertainment session start/stop. |
| `DELETE` | `/api/floor-plan-elements/[id]` | Employee PIN | Soft-delete element. |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `floor-plan:updated` | `{ locationId }` | Table/element/section created, updated, or deleted |
| `table:status-changed` | `{ tableId, status? }` | Table occupied/available/reserved status change |
| `entertainment:session-update` | `{ itemId, status, expiresAt, ... }` | Entertainment session start/extend/stop |
| `entertainment:status-changed` | `{ itemId, entertainmentStatus, currentOrderId, expiresAt }` | Entertainment item status change |

### Received (Clients → POS)
| Event | Source | Purpose |
|-------|--------|---------|
| None — floor plan is display-only on client side | | |

---

## Data Model

```
Table {
  id              String   @id
  locationId      String
  sectionId       String?
  name            String
  abbreviation    String?               // Short display: "T1", "B3" (auto-generated if not set)
  capacity        Int      @default(4)  // DEPRECATED — use seatCount from API
  posX            Int
  posY            Int
  width           Int      @default(80)
  height          Int      @default(80)
  rotation        Int      @default(0)  // Degrees 0-359
  shape           String               // rectangle | circle | square | booth | bar
  seatPattern     String               // all_around | front_only | three_sides | two_sides | inside
  status          TableStatus          // available | occupied | reserved | dirty
  isActive        Boolean  @default(true)
  defaultPosX     Int?                 // Admin-defined reset position
  defaultPosY     Int?
  defaultSectionId String?
  isLocked        Boolean  @default(false)  // Bolted-down furniture — cannot move
  version         Int      @default(0)      // Optimistic locking
  isTimedRental   Boolean  @default(false)
  timedItemId     String?  // Links to MenuItem for timed rental pricing
  deletedAt       DateTime?
  syncedAt        DateTime?
}

Seat {
  id              String   @id
  locationId      String
  tableId         String
  label           String               // "1", "A", "A1" — displayed on floor plan
  seatNumber      Int                  // Sequential within table
  relativeX       Int                  // Offset from table center (pixels)
  relativeY       Int
  angle           Int                  // Facing direction 0-359
  originalRelativeX Int?               // Saved before virtual combine
  originalRelativeY Int?
  originalAngle   Int?
  seatType        SeatType @default(standard)  // standard | booth | bar_stool | high_top
  isTemporary     Boolean  @default(false)     // Created by POS server, not editor
  sourceOrderId   String?
  status          SeatStatus @default(available)
  currentOrderItemId String?
  lastOccupiedAt  DateTime?
  lastOccupiedBy  String?
  isActive        Boolean  @default(true)
  version         Int      @default(0)
  deletedAt       DateTime?
  syncedAt        DateTime?
  // @@unique([tableId, seatNumber])
}

Section {
  id              String   @id
  locationId      String
  name            String               // "Bar", "Patio", "Main Floor"
  color           String?
  posX            Int      @default(0)
  posY            Int      @default(0)
  width           Int      @default(400)
  height          Int      @default(300)
  shape           String   @default("rectangle")  // rectangle | polygon
  coordinates     Json?                // Polygon: [{x, y}, ...]
  widthFeet       Float    @default(40)   // Room width in feet
  heightFeet      Float    @default(30)   // Room height in feet
  gridSizeFeet    Float    @default(0.25) // Grid snap size (0.25 = 3 inch)
  sortOrder       Int      @default(0)
  isVisible       Boolean  @default(true)
  deletedAt       DateTime?
  syncedAt        DateTime?
}

SectionAssignment {
  id              String   @id
  locationId      String
  sectionId       String
  employeeId      String
  assignedAt      DateTime @default(now())
  unassignedAt    DateTime?            // null = currently assigned
  deletedAt       DateTime?
  syncedAt        DateTime?
}

FloorPlanElement {
  id              String   @id
  locationId      String
  sectionId       String?
  name            String               // "Pool Table 1", "Dartboard A"
  abbreviation    String?              // "PT1", "DB-A"
  elementType     FloorPlanElementType // entertainment | fixture
  visualType      String               // pool_table | dartboard | arcade | foosball | shuffleboard | ...
  linkedMenuItemId String?             // For entertainment with pricing/sessions
  posX            Int      @default(100)
  posY            Int      @default(100)
  width           Int      @default(120)
  height          Int      @default(80)
  rotation        Int      @default(0)
  geometry        Json?                // For walls/lines: { type, start, end } or { type, x, y, width, height }
  thickness       Float    @default(0.5)  // Wall thickness in feet
  fillColor       String?
  strokeColor     String?
  opacity         Float    @default(1.0)
  status          FloorPlanElementStatus  // available | in_use | reserved | maintenance
  currentOrderId  String?
  sessionStartedAt DateTime?
  sessionExpiresAt DateTime?
  sortOrder       Int      @default(0)
  isVisible       Boolean  @default(true)
  isLocked        Boolean  @default(false)
  deletedAt       DateTime?
  syncedAt        DateTime?
}

EntertainmentWaitlist {
  id              String   @id
  locationId      String
  elementId       String?             // Specific element, or null for any of visualType
  visualType      String?             // e.g., "any pool_table"
  tableId         String?             // Table waiting
  customerName    String?             // Walk-in
  partySize       Int      @default(1)
  phone           String?             // For SMS
  status          EntertainmentWaitlistStatus  // waiting | notified | seated | expired | cancelled
  position        Int      @default(0)
  requestedAt     DateTime @default(now())
  notifiedAt      DateTime?
  seatedAt        DateTime?
  expiresAt       DateTime?
  notes           String?
  deletedAt       DateTime?
  syncedAt        DateTime?
}
```

---

## Business Logic

### Primary Flow (POS)
1. Staff opens floor plan tab — SVG canvas renders all tables, seats, entertainment items
2. Table colors indicate status: green=available, red=occupied, yellow=reserved
3. Tap table → opens inline order panel for that table
4. Order sent → socket `table:status-changed` updates all terminals
5. 30s polling fallback if socket disconnects (visibility-change triggers instant refresh)

### Virtual Group Combining
1. Long-hold a table → combine mode activates
2. Select second table → virtual group created
3. Seats renumbered across combined tables (denormalized — seats track parent table)
4. Combined tables share a single order
5. Split apart → seats return to original numbering

### Admin Floor Plan Editor
1. Manager opens `/settings/floor-plan`
2. Drag tables, fixtures, entertainment items onto canvas
3. Resize and rotate elements
4. Assign tables to sections (rooms/areas)
5. Save layout — broadcasts `floor-plan:updated` to all terminals

### Table Status Management
- `available` — no open order; displayed green on floor plan
- `occupied` — open order assigned; displayed red
- `reserved` — held for a reservation; displayed yellow
- `dirty` — needs cleaning before next guest; displayed grey
- Status changes are immediate — `PUT /api/tables/[id]` with `status` dispatches `table:status-changed` socket event to all terminals
- 30s polling fallback for status refresh when socket disconnects

### Room / Section Assignment
- Sections (rooms) are named areas: "Bar", "Patio", "Main Floor"
- Tables belong to at most one section (`sectionId` nullable)
- `SectionAssignment` links an employee to a section for their shift (used for server ownership)
- Sections have room dimensions in feet for grid snapping in the editor
- Deleting a section moves its tables to `sectionId: null` (tables preserved)
- `sections/reorder` uses the body key `roomIds` (sections are also called rooms)

### Table Transfer
- `POST /api/tables/[id]/transfer` reassigns all open orders (status: open or sent) to a new employee
- Creates one `AuditLog` entry per order and one for the table itself
- Emits `ORDER_METADATA_UPDATED` event for each affected order
- Dispatches `floor-plan:updated` to refresh all terminals

### Seat Generation
- Three generation paths: `/generate` (simple, uses library defaults), `/auto-generate` (collision detection), `/generate-all` (bulk for all tables)
- Patterns: `all_around`, `front_only`, `two_sides`, `three_sides` (booth), `inside` (booth)
- Label patterns: `numeric` (1,2,3...), `alpha` (A,B,C...), `alphanumeric` (S1,S2,S3...)
- Auto-generate checks collisions with other tables' seats and floor plan fixtures
- Reflow recalculates seat positions after table resize — edge-relative for rectangles, radial for circles
- Hard-delete (not soft-delete) used during regeneration to avoid unique constraint conflicts on `(tableId, seatNumber)`

### Optimistic Locking
- Tables and Seats have a `version` field (increments on every write)
- Clients can pass `version` in PUT requests; server returns 409 if version has changed
- Prevents concurrent edit races between multiple terminals editing the same table

### Edge Cases & Business Rules
- Virtual group combining: seats track their parent table (denormalized)
- Entertainment items show status colors: green=available, yellow=occupied, red=reserved, grey=maintenance
- Collision detection prevents overlapping tables in editor
- Table abbreviation auto-generated if not set (e.g., "T1", "B3")
- `isLocked` tables cannot be moved (bolted-down furniture — enforced in editor UI, not API)
- Temporary seats (`isTemporary=true`) are created by POS servers mid-service (not from editor); POS can only move temporary seats
- Cannot delete a seat that has active tickets (sold/held/checked_in) — guards event seat assignment integrity
- `cleanup-duplicates` is a maintenance utility for resolving `(tableId, seatNumber)` conflicts introduced by historic race conditions

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Table assignment on order, inline ordering from floor plan |
| Entertainment | Entertainment items placed and displayed on floor plan |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Order status changes update table colors |
| Entertainment | Session start/stop changes element status colors |
| Employees | Section assignment determines floor ownership |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Orders** — table assignment and inline ordering flow still works
- [ ] **Entertainment** — entertainment item placement and status colors
- [ ] **Socket** — `floor-plan:updated` and `table:status-changed` payloads
- [ ] **Offline** — floor plan must render from local DB when offline

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View floor plan | Standard (all staff) | Standard |
| Edit floor plan layout | `FLOOR_PLAN_EDIT` (not in permission-registry — enforced via Manager role in UI) | High |
| Transfer table | `TABLE_TRANSFER` (not in permission-registry — enforced via Manager role in UI) | High |
| Combine tables | Standard | Standard |

> Note: `FLOOR_PLAN_EDIT` and `TABLE_TRANSFER` are referenced in this doc and in the UI but are not registered in `src/lib/permission-registry.ts`. The floor plan routes use `withVenue()` (authentication only) with no explicit `requirePermission()` guard — authorization is enforced at the UI layer only. If formal permission enforcement is needed, these keys must be added to the registry and applied to the relevant routes.

---

## Known Constraints & Limits
- 30s polling fallback when socket disconnects — primary updates via socket
- SVG canvas — no WebGL dependency
- Entertainment items limited to 12 visual types
- Virtual group combining is denormalized — splitting requires re-computation
- Seat generation algorithms handle round, square, and rectangular table shapes

---

## Android-Specific Notes
- Android has full floor plan editor with drag-drop, resize, rotation
- Android floor plan uses native Canvas rendering (not SVG)
- Touch gestures: tap=select, long-press=combine mode, pinch=zoom, drag=pan
- Table management fully implemented in Android

---

## Related Docs
- **Domain doc:** `docs/domains/FLOOR-PLAN-DOMAIN.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`
- **Skills:** Skill 16 (Table Layout), Skill 17 (Table Status), Skill 80 (Floor Plan Editor), Skill 106 (Interactive SVG), Skill 107 (Table Combine/Split), Skill 113 (FloorPlanHome Integration), Skill 117 (Virtual Table Combine), Skill 123 (Entertainment Floor Plan), Skill 206 (Seat Management), Skill 207 (Table Resize & Rotation), Skill 229 (Table Combine Types)
- **Changelog:** `docs/changelogs/FLOOR-PLAN-CHANGELOG.md`

---

*Last updated: 2026-03-03*
