# Floor Plan Domain - Change Log

## Session: February 5, 2026 (Final Session)

### 🏁 FLOOR PLAN DOMAIN COMPLETE

The Floor Plan domain has been completed and is now ready for production. All core functionality is working:
- Tables, seats, fixtures, sections
- Virtual groups with colored borders
- Entertainment elements integration (now moving to dedicated Entertainment domain)

### Workers Completed Today

| Worker | Task | Status | Files Changed |
|--------|------|--------|---------------|
| **74** | Virtual Group Glow/Ring Visibility Fix | ✅ Complete | `TableNode.tsx` - moved glow elements outside overflow:hidden container |
| **75** | Virtual Group Styling Refinement | ✅ Complete | `TableNode.tsx` - softened border, removed pulsing animation |
| **76** | Debug Console.log Cleanup | ✅ Complete | `TableNode.tsx` - removed all debug logging |
| **77** | Integrate Entertainment Palette into Editor | ✅ Complete | `FloorPlanEditor.tsx` - AddEntertainmentPalette integration |
| **78** | Render Entertainment in EditorCanvas | ✅ Complete | `EditorCanvas.tsx` - renderEntertainmentElements() with SVG visuals |
| **79** | Add Entertainment to /api/floor-plan | ✅ Complete | `route.ts` - entertainment in aggregate response |
| **80** | Create EntertainmentProperties Panel | ✅ Complete | NEW: `EntertainmentProperties.tsx` |
| **82** | Route Entertainment to Builder | ✅ Complete | `menu/page.tsx` - routes to /timed-rentals |
| **83** | Enhance Timed Rentals Page | ✅ Complete | `timed-rentals/page.tsx` - full entertainment builder |

### Entertainment Integration (Moving to New Domain)

Entertainment features were integrated into Floor Plan but are now being spun off into a dedicated Entertainment domain for better organization:

**Completed in Floor Plan:**
- `AddEntertainmentPalette` component for placing items
- `FloorPlanEntertainment` rendering component
- 12 SVG visual types (pool_table, dartboard, arcade, etc.)
- Integration in EditorCanvas and FloorPlanEditor
- `/api/floor-plan` returns entertainment elements

**Moving to Entertainment Domain:**
- `/timed-rentals` page (entertainment builder)
- Entertainment session management
- Waitlist functionality
- Block time / per-minute pricing
- Entertainment status tracking

### Files Changed Today

| File | Changes |
|------|---------|
| `src/components/floor-plan/TableNode.tsx` | Virtual group styling, removed debug logs |
| `src/domains/floor-plan/admin/FloorPlanEditor.tsx` | Entertainment palette integration |
| `src/domains/floor-plan/admin/EditorCanvas.tsx` | Entertainment rendering |
| `src/domains/floor-plan/admin/EntertainmentProperties.tsx` | NEW - Properties panel |
| `src/app/api/floor-plan/route.ts` | Entertainment in aggregate |
| `src/app/(admin)/menu/page.tsx` | Entertainment routing to /timed-rentals |
| `src/app/(admin)/timed-rentals/page.tsx` | Full entertainment builder UI |

### Domain Handoff: Entertainment

The Entertainment domain is now being created as a separate domain. See:
- `/docs/changelogs/ENTERTAINMENT-CHANGELOG.md` (to be created)
- `/docs/domains/ENTERTAINMENT-DOMAIN.md` (to be created)

---

## Session: February 4, 2026

### Workers Completed

| Worker | Task | Status | Files Changed |
|--------|------|--------|---------------|
| **1** | Seat API CRUD Endpoints | ✅ Complete | `/api/seats/route.ts`, `/api/seats/[id]/route.ts`, `/api/tables/[id]/seats/route.ts`, `/api/tables/[id]/seats/generate/route.ts` |
| **2** | Seat Position Generation Algorithm | ✅ Complete | `/src/lib/seat-generation.ts` |
| **3** | Seat Renderer Component | ✅ Complete | `/src/domains/floor-plan/admin/SeatRenderer.tsx`, `TableRenderer.tsx` modified |
| **4** | Virtual Group Seat Logic | ✅ Complete | `/src/lib/virtual-group-seats.ts`, `/api/tables/virtual-combine/route.ts`, `/api/tables/virtual-combine/[groupId]/dissolve/route.ts` |
| **5** | Schema Enhancement for Virtual Seats | ✅ Complete | `prisma/schema.prisma` - Added virtualGroupId, virtualSeatNumber, status, etc. to Seat model |
| **6** | Table Resize Handles | ✅ Complete | `TableRenderer.tsx`, `EditorCanvas.tsx` |
| **7** | Smooth Table Rotation Handle | ✅ Complete | `TableRenderer.tsx`, `EditorCanvas.tsx` |
| **8** | Fix Toolbar Icon (Table not Chair) | ✅ Complete | `FixtureToolbar.tsx` |
| **9** | Manual Seat Positioning with Boundary | ✅ Complete | `EditorCanvas.tsx`, `types.ts` |
| **10** | Generate Seats Button | ✅ Already Existed | `TableProperties.tsx`, `FloorPlanEditor.tsx`, `/api/tables/[id]/seats/auto-generate/route.ts` |

### Workers In Progress / Pending

| Worker | Task | Status | Notes |
|--------|------|--------|-------|
| **11** | Seats Reflow on Table Resize | ✅ Complete | API endpoint + EditorCanvas integration |
| **12** | Fix Table Resize Minimum for Bar | ✅ Complete | Shape-specific minimums, edge handle fixes |

### Issues Discovered During Testing (RESOLVED)

1. ~~**Seats don't reflow on table resize**~~ - ✅ FIXED: Created `/api/tables/[id]/seats/reflow` endpoint, integrated into EditorCanvas
2. ~~**Bar table minimum size too restrictive**~~ - ✅ FIXED: Bar tables now allow 80x30 minimum, edge handles only affect one dimension
3. ~~**Seat dragging not working**~~ - ✅ FIXED: Added `handleSeatUpdate` callback, `dbSeats` computed property, passed props to EditorCanvas
4. ~~**Regenerate seats 500 error**~~ - ✅ FIXED: `generateSeatPositions()` called with params object, added `label` field generation
5. ~~**Seats stacking/disappearing on resize**~~ - ✅ FIXED: Reflow algorithm now only pushes out seats if BOTH x AND y are inside table bounds

### Key Architectural Decisions

1. **Seats are managed by Seat API, NOT Table API** - Clean layer separation
2. **Admin-saved positions are the "default"** - `relativeX`, `relativeY` in database IS the source of truth for reset
3. **Virtual groups use label prefixes** - When combined, seats get "T1-3" format labels
4. **Soft deletes only** - All seat deletes set `deletedAt`, never hard delete
5. **Socket dispatch on all mutations** - Real-time updates via `dispatchFloorPlanUpdate()`

### Schema Changes Made

```prisma
// Added to Seat model:
virtualGroupId        String?   // Matches Table.virtualGroupId
virtualSeatNumber     Int?      // Seat number within combined group
virtualGroupCreatedAt DateTime? // When joined virtual group
status                String    @default("available")
currentOrderItemId    String?   // Active order item at seat
lastOccupiedAt        DateTime?
lastOccupiedBy        String?

@@index([virtualGroupId])
```

### API Endpoints Created/Modified

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/seats` | GET | List seats with filters |
| `/api/seats` | POST | Create single seat |
| `/api/seats/[id]` | GET | Get seat details |
| `/api/seats/[id]` | PUT | Update seat |
| `/api/seats/[id]` | DELETE | Soft delete seat |
| `/api/tables/[id]/seats` | GET | Get table's seats |
| `/api/tables/[id]/seats` | POST | Add seat to table |
| `/api/tables/[id]/seats/generate` | POST | Generate default layout |
| `/api/tables/[id]/seats/auto-generate` | POST | Comprehensive generation |
| `/api/tables/[id]/seats/save-as-default` | POST | Save positions |
| `/api/tables/[id]/seats/bulk` | POST | Bulk operations |
| `/api/tables/seats/reflow` | POST | Reflow after resize |

### Components Created/Modified

| Component | File | Changes |
|-----------|------|---------|
| SeatRenderer | `/src/domains/floor-plan/admin/SeatRenderer.tsx` | NEW - Renders individual seats with states |
| TableRenderer | `/src/domains/floor-plan/admin/TableRenderer.tsx` | Added seats, resize handles, rotation handle |
| EditorCanvas | `/src/domains/floor-plan/admin/EditorCanvas.tsx` | Seat dragging, boundary, collision, resize, rotation |
| FixtureToolbar | `/src/domains/floor-plan/admin/FixtureToolbar.tsx` | Table icon (was chair) |
| TableProperties | `/src/domains/floor-plan/admin/TableProperties.tsx` | Already had Generate Seats button |

### Previous Session Work (Earlier Feb 4)

- Table-to-fixture collision detection
- Table-to-table collision detection
- Table API cleanup (removed seat code from Table layer)
- FOH view rendering database tables
- PM Mode workflow added to CLAUDE.md

---

## How to Resume This Work

1. **Start with:** `PM Mode: Floor Plan`
2. **Review this changelog** for context
3. **All 12 workers COMPLETE** - no pending workers
4. **Test current implementation** in Floor Plan Editor

## Next Priority Tasks

1. ✅ ~~Send Worker 11 & 12 prompts to fix resize issues~~ DONE
2. Test seat generation with different table shapes
3. Test virtual combine/uncombine with seats
4. Integrate seats into FOH view for ordering
5. Seat-to-order integration (assign items to seats)

## Additional Files Created/Modified (Workers 11 & 12 + Bug Fixes)

| File | Purpose |
|------|---------|
| `/api/tables/[id]/seats/reflow/route.ts` | Reflow seats when table resized |
| `EditorCanvas.tsx` | Added `onSeatsReflow` prop, resize-complete detection, seat dragging integration |
| `FloorPlanEditor.tsx` | Added `handleSeatsReflow` callback, `handleSeatUpdate`, `dbSeats` computed property |

## Bug Fixes (End of Session)

### 1. Seat Dragging Not Working
**Root Cause:** `dbSeats` and `onSeatUpdate` props weren't being passed to EditorCanvas

**Fix in FloorPlanEditor.tsx:**
```typescript
// Added handleSeatUpdate callback
const handleSeatUpdate = useCallback(
  async (seatId: string, updates: { relativeX?: number; relativeY?: number }) => {
    if (!useDatabase) return;
    const response = await fetch(`/api/seats/${seatId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (response.ok) {
      await fetchTables();
      setRefreshKey((prev) => prev + 1);
    }
  },
  [useDatabase, fetchTables]
);

// Added dbSeats computed property
const dbSeats = React.useMemo(() => {
  if (!useDatabase) return undefined;
  return dbTables.flatMap(table =>
    (table.seats || []).map(seat => ({ ...seat, tableId: table.id }))
  );
}, [useDatabase, dbTables]);

// Passed to EditorCanvas
<EditorCanvas
  dbSeats={dbSeats}
  onSeatUpdate={handleSeatUpdate}
  // ...
/>
```

### 2. Regenerate Seats 500 Error
**Root Cause:** `generateSeatPositions()` was called with wrong function signature (5 individual args instead of params object), and `SeatPosition` type doesn't have `label` field

**Fix in `/api/tables/[id]/seats/generate/route.ts`:**
```typescript
// Changed from:
generateSeatPositions(table.shape, finalPattern, finalCount, table.width, table.height)

// To:
const seatPositions = generateSeatPositions({
  shape: (table.shape as 'rectangle' | 'square' | 'round' | 'oval' | 'booth') || 'rectangle',
  pattern: finalPattern,
  capacity: finalCount,
  width: table.width,
  height: table.height,
});

// Added label generation in seat creation:
label: String(pos.seatNumber),
```

### 3. Seats Stacking/Disappearing on Resize
**Root Cause:** Reflow algorithm was treating edge seats (outside on one axis, inside on other) as "inside" and pushing them all out

**Fix in `/api/tables/[id]/seats/reflow/route.ts`:**
```typescript
// Changed from checking each axis independently to:
const isInsideX = absRelX < halfWidth;
const isInsideY = absRelY < halfHeight;

// Only push out if BOTH x AND y are inside table bounds
if (isInsideX && isInsideY) {
  // Calculate nearest edge and push out
}
```

## Shape-Specific Minimum Sizes (Worker 12)

| Shape | Min Width | Min Height |
|-------|-----------|------------|
| bar | 80px | 30px |
| booth | 60px | 80px |
| round | 50px | 50px |
| square | 50px | 50px |
| oval | 60px | 40px |
| rectangle | 60px | 40px |
