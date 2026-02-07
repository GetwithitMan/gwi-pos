# Floor Plan Domain - Architecture Guide

**Export Date:** February 7, 2026
**Domain Status:** ✅ COMPLETE
**Total Code:** 45,003 lines (1.4MB)
**Files:** 124 TypeScript/React files + 1 documentation file

---

## 📁 Export Files on Desktop

1. **FLOOR_PLAN_CODE_EXPORT.txt** - Complete source code (1.4MB, 45K lines)
2. **FLOOR_PLAN_FILE_LIST.txt** - File inventory with all paths
3. **FLOOR_PLAN_ARCHITECTURE_GUIDE.md** - This document

---

## 🏗️ Architecture Overview

The Floor Plan domain follows a **Domain-Driven Design (DDD)** pattern with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                           │
│  • Components (FOH display, admin editor)                        │
│  • Hooks (useFloorPlan, useSeating, useTableGroups)            │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SERVICE LAYER                                │
│  • table-service.ts  • seat-service.ts  • group-service.ts      │
│  • status-engine.ts (business logic for table states)           │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API LAYER                                    │
│  • REST endpoints for CRUD operations                            │
│  • Virtual group management                                      │
│  • Seat generation & reflow                                      │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATABASE (Prisma)                            │
│  • Table, Seat, FloorPlanElement, Section models                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📂 Directory Structure

### **src/domains/floor-plan/** (51 files)
Core domain logic following Clean Architecture principles.

#### **admin/** (13 files)
Admin floor plan editor components:
- `FloorPlanEditor.tsx` - Main editor container (1,200+ lines)
- `EditorCanvas.tsx` - Canvas with drag/resize/rotate (800+ lines)
- `TableRenderer.tsx` - Table rendering with handles
- `SeatRenderer.tsx` - Seat positioning & dragging
- `TableProperties.tsx` / `FixtureProperties.tsx` - Property panels
- `FixtureToolbar.tsx` - Palette for adding tables/fixtures
- `EntertainmentProperties.tsx` - Entertainment element properties

#### **canvas/** (3 files)
FOH (front-of-house) display for servers:
- `FloorCanvas.tsx` - Read-only table display for ordering
- `floorCanvasAPI.ts` - API client for canvas

#### **groups/** (10 files + 3 tests)
Virtual table grouping (combine tables for large parties):
- `virtualGroup.ts` - Core virtual group logic
- `tableGroupAPI.ts` - API client for groups
- `mergeLogic.ts` - Table combination algorithms
- `dragCombine.ts` - Drag-to-combine interaction
- `snapEngine.ts` - Snap-to-align for combining
- `perimeterSeats.ts` - Seat numbering for combined tables
- `colorPalette.ts` - Color generation for groups
- `TableGroup.tsx` / `CrossRoomBadge.tsx` - UI components

#### **hooks/** (4 files)
React hooks for floor plan state management:
- `useFloorPlan.ts` - Main floor plan state
- `useSeating.ts` - Seat management
- `useTableGroups.ts` - Virtual group state

#### **seats/** (5 files)
Seat positioning and management:
- `seatAPI.ts` - API client for seats
- `seatLayout.ts` - Seat generation algorithms
- `Seat.tsx` - Seat component
- `test-seats.ts` - Test data

#### **services/** (5 files)
Business logic layer:
- `table-service.ts` - Table CRUD & business rules
- `seat-service.ts` - Seat CRUD & validation
- `group-service.ts` - Virtual group orchestration
- `status-engine.ts` - Table status calculation (available, occupied, etc.)

#### **shared/** (2 files)
Shared utilities:
- `collisionDetection.ts` - Table/fixture collision prevention
- `types.ts` - Shared TypeScript types

#### **tables/** (5 files)
Table components and API:
- `Table.tsx` - FOH table component
- `SmartObject.tsx` - Interactive table with gestures
- `tableAPI.ts` - API client for tables
- `types.ts` - Table-specific types

---

### **src/components/floor-plan/** (30 files)
UI components for floor plan features.

#### **Key Components:**
- `UnifiedFloorPlan.tsx` - Main FOH floor plan view (800+ lines)
- `FloorPlanHome.tsx` - Floor plan home screen
- `InteractiveFloorPlan.tsx` - Interactive editor wrapper
- `TableNode.tsx` - Draggable table node (400+ lines)
- `SeatNode.tsx` / `SeatDot.tsx` / `SeatOrbiter.tsx` - Seat visuals
- `VirtualCombineBar.tsx` - UI for combining tables
- `VirtualGroupManagerModal.tsx` - Manage virtual groups
- `TableInfoPanel.tsx` / `TableEditPanel.tsx` - Table details
- `SectionSettings.tsx` / `SectionBackground.tsx` - Section management
- `RoomTabs.tsx` / `AddRoomModal.tsx` / `RoomReorderModal.tsx` - Multi-room support

#### **Entertainment Integration:**
- `AddEntertainmentPalette.tsx` - Add pool tables, darts, etc.
- `FloorPlanEntertainment.tsx` - Render entertainment elements
- `entertainment-visuals.tsx` - SVG visuals for 12 entertainment types

#### **Hooks:**
- `useFloorPlanDrag.ts` - Drag and drop logic
- `useFloorPlanAutoScale.ts` - Auto-scaling canvas
- `use-floor-plan.ts` - Legacy hook (being deprecated)

#### **Utilities:**
- `table-positioning.ts` - Table positioning algorithms

---

### **src/app/api/** (38 route files)
REST API endpoints for all floor plan operations.

#### **Tables API** (`/api/tables/`)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tables` | GET | List all tables |
| `/api/tables` | POST | Create table |
| `/api/tables/[id]` | GET/PUT/DELETE | CRUD single table |
| `/api/tables/combine` | POST | Combine tables (legacy) |
| `/api/tables/[id]/split` | POST | Split combined table |
| `/api/tables/[id]/transfer` | POST | Transfer order to another table |
| `/api/tables/bulk-update` | POST | Bulk update tables |
| `/api/tables/save-default-layout` | POST | Save current layout as default |
| `/api/tables/reset-to-default` | POST | Reset to default layout |

#### **Virtual Groups API** (`/api/tables/virtual-combine/`)
Virtual grouping is the modern approach (replaces legacy combine):
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tables/virtual-combine` | POST | Create virtual group |
| `/api/tables/virtual-combine/active` | GET | List active groups |
| `/api/tables/virtual-combine/[groupId]` | GET/DELETE | Get or dissolve group |
| `/api/tables/virtual-combine/[groupId]/add` | POST | Add table to group |
| `/api/tables/virtual-combine/[groupId]/remove` | POST | Remove table from group |
| `/api/tables/virtual-combine/[groupId]/set-primary` | POST | Set primary table |
| `/api/tables/virtual-combine/[groupId]/transfer` | POST | Transfer order within group |

#### **Seats API** (`/api/seats/`)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/seats` | GET/POST | List/create seats |
| `/api/seats/[id]` | GET/PUT/DELETE | CRUD single seat |
| `/api/seats/bulk-operations` | POST | Bulk seat operations |
| `/api/seats/cleanup-duplicates` | POST | Remove duplicate seats |
| `/api/seats/cleanup-orphaned-labels` | POST | Fix orphaned seat labels |

#### **Table Seats API** (`/api/tables/[id]/seats/`)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tables/[id]/seats` | GET/POST | List/add seats to table |
| `/api/tables/[id]/seats/generate` | POST | Generate seat layout (basic) |
| `/api/tables/[id]/seats/auto-generate` | POST | Auto-generate with smart defaults |
| `/api/tables/[id]/seats/reflow` | POST | Reposition seats after table resize |
| `/api/tables/[id]/seats/save-as-default` | POST | Save positions as default |
| `/api/tables/[id]/seats/bulk` | POST | Bulk seat updates |
| `/api/tables/[id]/seats/[seatId]` | GET/PUT/DELETE | CRUD seat on table |

#### **Bulk Seats API** (`/api/tables/seats/`)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tables/seats/generate-all` | POST | Generate seats for all tables |
| `/api/tables/seats/reflow` | POST | Reflow seats for multiple tables |
| `/api/tables/seats/save-all-as-default` | POST | Save all as default |

#### **Floor Plan API** (`/api/floor-plan/`)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/floor-plan` | GET | Get complete floor plan (tables + fixtures + entertainment) |

#### **Floor Plan Elements API** (`/api/floor-plan-elements/`)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/floor-plan-elements` | GET/POST | CRUD fixtures (walls, plants, etc.) |
| `/api/floor-plan-elements/[id]` | GET/PUT/DELETE | Single fixture |

---

### **src/lib/** (4 files)
Shared library functions used across domains.

| File | Purpose |
|------|---------|
| `seat-generation.ts` | Seat positioning algorithms for all table shapes |
| `seat-utils.ts` | Seat utilities and helpers |
| `virtual-group-seats.ts` | Seat logic for virtual groups |
| `virtual-group-colors.ts` | Color generation for groups |

---

## 🔑 Key Features

### 1. **Table Management**
- **Shapes:** Rectangle, Square, Round, Oval, Booth, Bar
- **Drag & Drop:** Position tables with collision detection
- **Resize Handles:** 8-point resize with shape-specific minimums
- **Rotation:** Smooth rotation handle (0-360°)
- **Sections:** Organize tables into sections (e.g., Patio, Bar, Dining)
- **Rooms:** Multi-room support with tabs

### 2. **Seat Management**
- **Auto-Generation:** Smart algorithms for all table shapes
  - Rectangle/Square: Perimeter seating
  - Round/Oval: Circular seating
  - Booth: U-shaped seating
  - Bar: Linear seating
- **Manual Positioning:** Drag seats with boundary enforcement
- **Seat Reflow:** Auto-reposition after table resize
- **Seat Numbering:** Sequential numbering (1, 2, 3...)
- **Seat States:** Available, occupied, reserved

### 3. **Virtual Groups** (Modern Table Combining)
- **Combine Tables:** Drag tables together to create large party seating
- **Colored Borders:** Visual grouping with unique colors
- **Unified Numbering:** Seats numbered across all tables (T1-1, T1-2, T2-1...)
- **Primary Table:** One table owns the order
- **Cross-Room Groups:** Combine tables across different rooms
- **Dissolve:** Split group back into individual tables
- **Transfer:** Move orders between tables in group

### 4. **Fixtures & Decorations**
- **Fixture Types:** Walls, plants, dividers, bars
- **Drag & Drop:** Position fixtures on canvas
- **Collision Detection:** Prevent fixture overlap with tables

### 5. **Entertainment Integration**
- **12 Entertainment Types:** Pool tables, dartboards, arcade, karaoke, etc.
- **SVG Visuals:** Custom SVG for each entertainment type
- **Timed Sessions:** Link to entertainment booking system
- **Status Tracking:** Available, in_use, maintenance

### 6. **FOH (Front of House) Display**
- **Interactive Canvas:** Click table to start order
- **Real-time Status:** Green (available), Red (occupied), Yellow (dirty)
- **Order Assignment:** Auto-assign orders to tables/seats
- **Existing Orders Modal:** See all open orders for a table

### 7. **Admin Editor**
- **Dual Mode:** Database mode (persist changes) vs Canvas mode (preview only)
- **Properties Panel:** Edit table details, capacity, section
- **Fixture Toolbar:** Add tables, fixtures, entertainment
- **Save/Reset:** Save layouts as defaults, reset to defaults

---

## 🧩 Core Algorithms

### **Seat Generation Algorithm** (`seat-generation.ts`)

Generates seat positions based on table shape and capacity:

**For Round/Oval:**
```typescript
// Distribute seats in circle
const angleStep = (2 * Math.PI) / capacity
for (let i = 0; i < capacity; i++) {
  const angle = i * angleStep
  const x = Math.cos(angle) * radius
  const y = Math.sin(angle) * radius
  seats.push({ relativeX: x, relativeY: y, seatNumber: i + 1 })
}
```

**For Rectangle/Square:**
```typescript
// Distribute along perimeter (top, right, bottom, left)
const perimeter = 2 * (width + height)
const spacing = perimeter / capacity
// Position seats along edges...
```

**For Booth:**
```typescript
// U-shaped seating (left, bottom, right)
// No seats on top edge (booth back)
```

**For Bar:**
```typescript
// Linear seating along one edge
// Seats face same direction
```

### **Seat Reflow Algorithm** (`/api/tables/[id]/seats/reflow/route.ts`)

Repositions seats when table is resized:

1. Check if seat is **inside** table bounds (both X AND Y)
2. If inside, push seat to nearest edge
3. If on edge, adjust position proportionally
4. Maintain spacing between seats

**Bug Fix (Worker 12):**
```typescript
// ❌ OLD: Edge seats (outside on one axis) treated as "inside"
if (isInsideX || isInsideY) { /* push out */ }

// ✅ NEW: Only push out if BOTH x AND y are inside
if (isInsideX && isInsideY) { /* push out */ }
```

### **Virtual Group Seat Logic** (`virtual-group-seats.ts`)

When tables combine:
1. Renumber all seats with table prefix: "T1-1", "T1-2", "T2-1"...
2. Update `virtualGroupId` and `virtualSeatNumber` on all seats
3. Maintain original `relativeX`, `relativeY` for each table
4. Primary table owns the unified order

### **Collision Detection** (`collisionDetection.ts`)

Prevents overlapping tables and fixtures:
```typescript
function checkCollision(obj1, obj2) {
  const rect1 = { x: obj1.x, y: obj1.y, width: obj1.width, height: obj1.height }
  const rect2 = { x: obj2.x, y: obj2.y, width: obj2.width, height: obj2.height }

  return !(
    rect1.x + rect1.width < rect2.x ||
    rect1.x > rect2.x + rect2.width ||
    rect1.y + rect1.height < rect2.y ||
    rect1.y > rect2.y + rect2.height
  )
}
```

---

## 📊 Database Schema

### **Table Model**
```prisma
model Table {
  id            String   @id @default(cuid())
  locationId    String
  label         String   // "1", "2", "A1"
  shape         String   // rectangle, square, round, oval, booth, bar
  capacity      Int
  x             Float    // Canvas X position
  y             Float    // Canvas Y position
  width         Float
  height        Float
  rotation      Float    @default(0)
  sectionId     String?
  roomId        String?
  virtualGroupId String? // If part of virtual group
  status        String   @default("available")

  seats         Seat[]
  orders        Order[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?
  syncedAt      DateTime?
}
```

### **Seat Model**
```prisma
model Seat {
  id                    String   @id @default(cuid())
  locationId            String
  tableId               String
  label                 String   // "1", "2", "3"
  relativeX             Float    // Position relative to table center
  relativeY             Float
  virtualGroupId        String?  // Matches Table.virtualGroupId
  virtualSeatNumber     Int?     // Seat number within combined group
  virtualGroupCreatedAt DateTime?
  status                String   @default("available")
  currentOrderItemId    String?
  lastOccupiedAt        DateTime?
  lastOccupiedBy        String?

  table                 Table    @relation(...)

  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  deletedAt             DateTime?
  syncedAt              DateTime?

  @@index([virtualGroupId])
}
```

### **FloorPlanElement Model**
```prisma
model FloorPlanElement {
  id          String   @id @default(cuid())
  locationId  String
  type        String   // wall, plant, divider, bar
  x           Float
  y           Float
  width       Float
  height      Float
  rotation    Float    @default(0)
  properties  Json?    // Color, style, etc.
  roomId      String?

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?
  syncedAt    DateTime?
}
```

---

## 🧪 Testing

The domain includes 3 test files:
- `groups/__tests__/mergeLogic.test.ts` - Virtual group merge algorithms
- `groups/__tests__/tableGroupAPI.test.ts` - API client tests
- `groups/__tests__/virtualGroup.test.ts` - Virtual group business logic

**Test Coverage:**
- Virtual group creation
- Table addition/removal from groups
- Seat renumbering in groups
- Primary table assignment
- Group dissolution

---

## 🔄 Recent Changes (Feb 5, 2026)

### Workers 74-83 Completed:

1. **Virtual Group Styling** - Softened borders, removed pulsing animation
2. **Debug Cleanup** - Removed all console.log statements
3. **Entertainment Integration** - Full integration into floor plan editor
4. **Seat Reflow Fix** - Fixed edge seat stacking issue
5. **Table Resize Minimums** - Shape-specific minimums (bar: 80x30, booth: 60x80, etc.)

### Bug Fixes:
- ✅ Seats don't reflow on resize → Fixed with `/api/tables/[id]/seats/reflow`
- ✅ Bar table minimum too restrictive → Shape-specific minimums
- ✅ Seat dragging not working → Added `handleSeatUpdate` callback
- ✅ Regenerate seats 500 error → Fixed `generateSeatPositions()` signature
- ✅ Seats stacking on resize → Fixed reflow algorithm (BOTH x AND y check)

---

## 📝 Next Steps / TODO

From changelog:

1. **Test seat generation** with different table shapes
2. **Test virtual combine/uncombine** with seats
3. **Integrate seats into FOH view** for ordering (partially done)
4. **Seat-to-order integration** - Assign specific items to specific seats
5. **Section management** - UI for creating/editing sections
6. **Table templates** - Save/load common table layouts
7. **Multi-location sync** - Sync floor plans to cloud for backup

---

## 🎯 Key Architectural Decisions

1. **Seats managed by Seat API, NOT Table API** - Clean layer separation
2. **Admin-saved positions are the "default"** - `relativeX`, `relativeY` in database IS source of truth
3. **Virtual groups use label prefixes** - "T1-3" format for combined tables
4. **Soft deletes only** - All deletes set `deletedAt`, never hard delete
5. **Socket dispatch on all mutations** - Real-time updates via `dispatchFloorPlanUpdate()`
6. **Database mode vs Canvas mode** - Editor supports both persisted and preview-only changes
7. **Entertainment spun off** - Entertainment is now a separate domain

---

## 📚 Related Documentation

- `/docs/changelogs/FLOOR-PLAN-CHANGELOG.md` - Complete change history
- `/docs/PM-TASK-BOARD.md` - Cross-domain task tracking
- `/docs/skills/SKILLS-INDEX.md` - Skill documentation index

---

## 🚀 How to Navigate the Code Export

**Recommended Review Order:**

1. **Start with Documentation** (Section 7)
   - Read `FLOOR-PLAN-CHANGELOG.md` for context

2. **Understand the API Layer** (Sections 3-5)
   - Review `/api/tables/route.ts` (CRUD basics)
   - Review `/api/tables/virtual-combine/route.ts` (grouping)
   - Review `/api/seats/route.ts` (seat CRUD)
   - Review `/api/tables/[id]/seats/generate/route.ts` (seat generation)
   - Review `/api/tables/[id]/seats/reflow/route.ts` (seat reflow)

3. **Review Core Algorithms** (Section 6)
   - `seat-generation.ts` - How seats are positioned
   - `virtual-group-seats.ts` - How groups handle seats

4. **Study Services Layer** (Section 1 - services/)
   - `table-service.ts` - Business logic for tables
   - `seat-service.ts` - Business logic for seats
   - `status-engine.ts` - Table status calculations

5. **Explore Components** (Sections 1 & 2)
   - `FloorPlanEditor.tsx` - Admin editor (1,200+ lines)
   - `EditorCanvas.tsx` - Canvas logic (800+ lines)
   - `UnifiedFloorPlan.tsx` - FOH display (800+ lines)
   - `TableRenderer.tsx` - Table rendering with handles
   - `SeatRenderer.tsx` - Seat rendering

6. **Deep Dive Features**
   - Virtual Groups: `groups/` directory
   - Seat Management: `seats/` directory
   - Entertainment: `AddEntertainmentPalette.tsx`, `entertainment-visuals.tsx`

---

## 💡 Code Quality Notes

**Strengths:**
- ✅ Clean separation of concerns (service layer, API layer, presentation)
- ✅ Comprehensive API coverage (38 endpoints)
- ✅ Type-safe with TypeScript throughout
- ✅ Real-time updates via Socket.io
- ✅ Collision detection prevents overlaps
- ✅ Soft deletes for data integrity
- ✅ Well-tested virtual group logic

**Areas for Improvement:**
- ⚠️ Some large component files (1,200+ lines in FloorPlanEditor)
- ⚠️ Dual mode (DB vs Canvas) adds complexity
- ⚠️ Some legacy code (old combine vs new virtual-combine)
- ⚠️ Could benefit from more unit tests
- ⚠️ Some prop drilling (could use context)

**Technical Debt:**
- Legacy `combine` endpoint (superseded by `virtual-combine`)
- Some duplicate logic between admin and FOH components
- `use-floor-plan.ts` hook being deprecated

---

## 📞 Contact & Support

For questions about this export or the Floor Plan domain:
- Review the changelog: `FLOOR-PLAN-CHANGELOG.md`
- Check the skills index: `/docs/skills/SKILLS-INDEX.md`
- Use PM Mode: "pm mode floor plan"

---

**END OF ARCHITECTURE GUIDE**
