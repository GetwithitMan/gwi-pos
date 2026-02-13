# Floor Plan Domain - Complete Audit Report
**Date:** 2026-02-11
**Database Backup:** `prisma/backups/pos-20260211-184610.db`
**Audited By:** 7-agent team (combine-auditor, zoom-auditor, seat-auditor, glitch-sweep, perimeter-auditor, seat-placement-auditor, insert-dissolve-auditor)

---

## Table of Contents
1. [Virtual Table Combining (3+ Tables)](#1-virtual-table-combining-3-tables)
2. [Perimeter Border Rendering](#2-perimeter-border-rendering)
3. [Seat Placement Around Perimeter](#3-seat-placement-around-perimeter)
4. [Seat Insertion (Adding Seats)](#4-seat-insertion-adding-seats)
5. [Dissolve Restore to Default Layout](#5-dissolve-restore-to-default-layout)
6. [Zoom & Pan System](#6-zoom--pan-system)
7. [Master Glitch List (30 Bugs)](#7-master-glitch-list-30-bugs)
8. [Implementation Priority](#8-implementation-priority)
9. [Key File Reference](#9-key-file-reference)

---

## 1. Virtual Table Combining (3+ Tables)

### Two Combine Paths

1. **Long-press path (static combine):** Long-press table -> enter combine mode -> tap additional tables -> confirm via VirtualCombineBar
2. **Drag-drop path (snapped combine):** Drag one table onto another -> calls `handleTableCombine` -> hits `POST /api/tables/virtual-combine`

### 3+ Table Support Matrix

| Path | 3+ Tables? | Issue |
|------|-----------|-------|
| Long-press CREATE (all upfront) | YES | Only working path -- must select ALL before group exists |
| Long-press ADD to existing group | BUG | For-loop bails on first `requiresAction` (line 1447-1453) |
| Drag-drop CREATE | BLOCKED | Hard block at `FloorPlanHome.tsx:2306-2309` |
| Drag-drop ADD to existing | NEVER ATTEMPTED | Code doesn't try `/add` endpoint |
| VirtualGroupManagerModal | NO ADD FEATURE | Only has remove/dissolve |

### The Deadlock

There is NO working path to add a table to an existing virtual group:

- **Long-press grouped table** -> Opens VirtualGroupManagerModal (no "Add Table" button)
- **Long-press free table -> tap grouped table** -> Blocked by selection guard (line 1551: "already in another group")
- **Drag table onto grouped table** -> Blocked at line 2306: "One or more tables is already in a virtual group"

### Combine Bugs

| Bug | File | Line | Severity |
|-----|------|------|----------|
| Drag-drop blocks adding to existing groups | FloorPlanHome.tsx | 2306-2309 | MAJOR |
| ADD mode early bailout on requiresAction | FloorPlanHome.tsx | 1447-1453 | MEDIUM |
| VirtualGroupManagerModal has no "Add Table" | VirtualGroupManagerModal.tsx | - | MAJOR |
| Long-press on grouped table opens manager, not combine mode | FloorPlanHome.tsx | 3602-3604 | MAJOR |
| `/[groupId]/add` doesn't re-run seat renumbering | virtual-combine/[groupId]/add/route.ts | - | MEDIUM |

### API Routes

| Route | Purpose | Notes |
|-------|---------|-------|
| `POST /api/tables/virtual-combine` | Create new group | Accepts any number of tableIds (min 2), rejects if any already grouped |
| `POST /api/tables/virtual-combine/[groupId]/add` | Add table to group | One table at a time, no seat renumbering |
| `POST /api/tables/virtual-combine/[groupId]/remove` | Remove from group | Dissolves if 2-table group |
| `POST /api/tables/virtual-combine/[groupId]/dissolve` | Dissolve entire group | Only restores labels, not positions |
| `POST /api/tables/virtual-combine/[groupId]/set-primary` | Change primary table | No socket dispatch |

### Missing Socket Dispatches

Three virtual-combine sub-routes do NOT dispatch floor plan updates to other terminals:
- `/[groupId]/remove/route.ts`
- `/[groupId]/add/route.ts`
- `/[groupId]/set-primary/route.ts`

Compare with `virtual-combine/route.ts` (create) and `dissolve/route.ts` which DO include `dispatchFloorPlanUpdate()`.

---

## 2. Perimeter Border Rendering

### Status: NOT IMPLEMENTED

There is **NO unified perimeter border** rendered around virtually combined tables. Each table gets its own individual colored rectangle border and glow.

### What Exists (Dead Code)

| Function | File | Lines | Status |
|----------|------|-------|--------|
| `buildGroupPerimeterPath()` | table-geometry.ts | 173-190 | DEAD CODE - never imported |
| `buildGroupPerimeterPolygon()` | table-geometry.ts | 199-259 | DEAD CODE - never imported |
| `TableGroup` component | groups/TableGroup.tsx | 27-96 | NOT USED in FloorPlanHome |

### What Currently Renders

- **Static groups (long-hold):** Per-table colored glow + border via TableNode.tsx (lines 265-291, 314-325)
- **Snapped groups (drag-drop):** Same per-table borders + connection lines (SVG `<line>` center-to-center, lines 3436-3462)
- **Neither renders a unified wrapping polygon/path**

### Recommended Fix

Use `getOuterEdges()` from `perimeterSeats.ts` (the same edges used for seat placement) to build a closed SVG `<path>` and render it in FloorPlanHome. This ensures the border exactly matches where seats are placed and correctly handles L/T/U shapes.

---

## 3. Seat Placement Around Perimeter

### Two Separate Systems

| System | File | Used By | Collision Detection |
|--------|------|---------|-------------------|
| `distributeSeatsOnPerimeter()` | table-geometry.ts:282-394 | Physical combine API, reflow API | NONE |
| `generateVirtualSeatPositions()` | perimeterSeats.ts:496-579 | FloorPlanHome (virtual groups) | YES - table + seat-to-seat |

### Active System: `perimeterSeats.ts` (Client-Side)

**Algorithm:**
1. Count total seats across all tables
2. Get outer edges via `getOuterEdges()` (50px touch threshold)
3. Build perimeter path with corner blending via `buildPerimeterPath()`
4. Cap seats to `floor(totalPerimeter / 27)` if needed
5. Space seats evenly: `effectiveSpacing = totalPerimeter / seatsToPlace`
6. Place each seat at `(seatIdx + 0.5) * effectiveSpacing` along path
7. Apply outward offset of 22px
8. Check table collision -> push outward up to 60px
9. Check seat-to-seat collision -> push outward up to 30px

**Constants:**
```
SEAT_RADIUS = 12 (half of 24px visual seat)
MIN_GAP = 3
SEAT_TO_TABLE_CLEARANCE = 15 (12 + 3)
SEAT_TO_SEAT_MIN_DIST = 27 (24 + 3)
TOUCH_THRESHOLD = 50 (edge detection)
seatDistance = 22 (outward offset)
```

### What Works
- Even spacing along perimeter path
- Table overlap detection + outward push
- Seat-to-seat overlap detection + outward push
- Corner diagonal 45-degree offsets
- Capacity capping when perimeter too small
- Edge-hugging for L/T/U shapes

### What's Broken
- Collision resolution only pushes OUTWARD (no lateral slide along edge)
- Rotation NOT accounted for in collision (uses AABB only)
- After max push attempts, seat placed wherever it landed (no error/warning)
- Two systems use different seat size constants (perimeterSeats: 12px vs constants.ts: 20px)
- Server-side system (table-geometry.ts) has ZERO collision detection
- All positioning is CLIENT-SIDE only -- never persisted to DB for virtual groups

---

## 4. Seat Insertion (Adding Seats)

### Design Spec
- Server determines position
- If inserted in middle, existing seats + order items shift up
- Items stay with their seat

### Current State

**6 different seat creation paths:**

| Path | Creates DB Seat? | Calculates Position? | Used By |
|------|-----------------|---------------------|---------|
| Auto-generate API | YES | YES (full algorithm) | Editor, table creation |
| Generate API | YES | YES (simple) | Simpler regeneration |
| Single seat POST | YES | NO (defaults 0,0) | UnifiedFloorPlan |
| handleAddSeat (with order) | NO (only Order.extraSeatCount) | NO | FloorPlanHome |
| handleAddSeat (no order) | NO (React state only) | NO | FloorPlanHome |
| Domain seat-service.ts | YES (different coord system) | YES | Legacy/unused |

### Gaps

| Gap | Severity |
|-----|----------|
| `handleAddSeat` with order only updates `Order.extraSeatCount`, no DB Seat created | HIGH |
| `handleAddSeat` without order creates phantom React-only seat (vanishes on reload) | HIGH |
| No server-side position calculation for virtual groups | HIGH |
| `insertSeatAt()` exists in seat-generation.ts but is NEVER CALLED | MEDIUM |
| Two disconnected systems: Order seat numbers vs physical Seat records | HIGH |
| No virtual group awareness in handleAddSeat | HIGH |

### Order Items DO Follow Seat Renumbering
- `/api/orders/[id]/seating` INSERT action (lines 224-277) shifts `OrderItem.seatNumber` for items at/above insertion position
- Uses descending order update to prevent conflicts
- This part WORKS -- but only at the order level, not physical seats

### `insertSeatAt()` (Orphaned Pure Function)
- File: `seat-generation.ts:472-516`
- Generates fresh positions for N+1 seats with proper edge placement
- EXISTS but is never wired into `handleAddSeat` or the seating API

---

## 5. Dissolve Restore to Default Layout

### Design Spec
- When dissolved, ALL tables and seats return to original positions from floor plan editor

### Current State

| What | Restored on Dissolve? | Mechanism |
|------|----------------------|-----------|
| Seat labels ("T1-3" -> "3") | YES | dissolve/route.ts lines 206-236 |
| Seat positions (relativeX/Y) | NO | `restore-original` exists but NOT called |
| Table positions | PARTIALLY | `virtualGroupOffsetX/Y` cleared (visual offsets) |
| `originalRelativeX/Y/Angle` | Properly saved at creation | Available for restore |

### The Fix Is Simple

The `restore-original` bulk operation at `/api/seats/bulk-operations/route.ts:233-294` is **fully functional**. It:
1. Fetches all seats for given tableIds
2. Restores `relativeX` from `originalRelativeX` for each seat
3. Clears original fields
4. Restores labels

**It IS called by:** `remove-from-group`, `split`, `reset-to-default`
**It is NOT called by:** `dissolve`, `remove` (virtual combine routes) -- **THIS IS THE BUG**

### When originalRelativeX/Y/Angle Are Populated

| Trigger | When |
|---------|------|
| Seat creation (POST) | At creation time |
| Auto-generate seats | At generation time |
| Generate seats | At generation time |
| Save as default | On explicit save |
| Reposition for combine | Before repositioning (preserves pre-combine state) |

---

## 6. Zoom & Pan System

### Three Separate, Unrelated Zoom Systems

| System | File | Used By | User Control |
|--------|------|---------|-------------|
| Auto-Scale (read-only) | useFloorPlanAutoScale.ts | FloorPlanHome (POS) | NONE |
| SVG ViewBox | use-floor-plan.ts + InteractiveFloorPlan.tsx | Legacy (possibly unused) | Scroll wheel + buttons |
| CSS Transform | EditorCanvas.tsx | FloorPlanEditor (Admin) | Ctrl+wheel + buttons |

### POS View (FloorPlanHome) -- What Staff Uses

- **ZERO manual zoom controls** -- no scroll wheel, no pinch-to-zoom, no +/- buttons
- Auto-scale only: shrinks to fit (min 0.3, max 1.0), recalculates on every render
- Zoom badge shows "67% zoom" but is read-only and non-interactive
- No zoom persistence -- resets on every page load
- No pinch-to-zoom (touch-action: none set, no custom gesture handler)

### Admin Editor (EditorCanvas)

- Ctrl/Cmd + scroll wheel zoom (min 0.5, max 2.0, step 0.1)
- Middle-click or Alt+drag to pan
- +/- buttons, Fit to Screen, 100% reset
- No zoom persistence
- **BUG:** `getCanvasPoint()` ignores panOffset (clicks land wrong when panned)

### Zoom Bugs

| Bug | Severity | File |
|-----|----------|------|
| No user zoom controls in POS mode | HIGH | FloorPlanHome |
| No pinch-to-zoom anywhere (critical for iPad) | HIGH | All |
| Zoom resets on every page load | MEDIUM | All systems |
| Duplicated auto-scale logic (drift risk) | MEDIUM | useFloorPlanAutoScale + UnifiedFloorPlan |
| Editor coordinate conversion ignores panOffset | MEDIUM | EditorCanvas:759-761 |
| Scroll wheel zoom not cursor-anchored (jumpy) | MEDIUM | InteractiveFloorPlan, EditorCanvas |
| No screen-size barriers for table placement | MEDIUM | All |

### Recommended Fix
- Add manual zoom (+/-, scroll wheel, pinch) to FloorPlanHome with auto-scale as initial state
- Persist zoom per employee in `posLayoutSettings` JSON
- Implement cursor-anchored zoom: `newPan = cursor - (cursor - oldPan) * (newScale / oldScale)`
- Unify into single `useFloorPlanZoom` hook
- Add screen-size barriers in editor (warn when tables placed beyond iPad viewport)

---

## 7. Master Glitch List (30 Bugs)

### Category 1: Combine

| ID | Severity | File | Issue |
|----|----------|------|-------|
| G-001 | HIGH | /api/tables/combine/route.ts | Legacy physical combine NOT returning 410 Gone (supposed to be deprecated) |
| G-002 | HIGH | /api/tables/combine/route.ts:557-563 | Stack trace leaked in error response (security) |
| G-003 | HIGH | virtual-combine sub-routes | Missing socket dispatch on add/remove/set-primary (other terminals stale) |
| G-004 | MEDIUM | virtual-combine/dissolve:113-138 | Tax not calculated on split orders during dissolve |
| G-005 | MEDIUM | virtual-combine/route.ts:276-283 | N+1 seat update queries in transaction (performance) |

### Category 2: Zoom & Pan

| ID | Severity | File | Issue |
|----|----------|------|-------|
| G-006 | MEDIUM | useFloorPlanAutoScale.ts | No user-controlled zoom or pan in POS view |
| G-007 | LOW | FloorPlanHome.tsx:3401-3418 | Zoom badge is read-only, offers no interaction |

### Category 3: Seats

| ID | Severity | File | Issue |
|----|----------|------|-------|
| G-008 | MEDIUM | useFloorPlanDrag.ts:157-165 | Seat/table hit test ignores table rotation |
| G-009 | LOW | use-floor-plan.ts:570 | removeSeatAt resets all seat coordinates (forces redistribution) |
| G-010 | MEDIUM | VirtualGroupManagerModal.tsx:50-51 | Order item check limited to 10 items (API truncation) |

### Category 4: Drag & Drop

| ID | Severity | File | Issue |
|----|----------|------|-------|
| G-011 | MEDIUM | useFloorPlanDrag.ts:171-179 | Stale `isColliding` state prevents valid combines |
| G-012 | MEDIUM | TableNode.tsx:198 | Long-press cancels on 1px movement (impossible on touchscreen) |

### Category 5: Rendering & State

| ID | Severity | File | Issue |
|----|----------|------|-------|
| G-013 | HIGH | FloorPlanHome.tsx | 4500+ lines -- massive monolith component |
| G-014 | MEDIUM | FloorPlanHome.tsx:391-398 | 4 TODO comments flagging redundant state variables |
| G-015 | MEDIUM | FloorPlanHome.tsx:280-281 | `getState()` bypasses React subscription (stale order items) |
| G-016 | MEDIUM | FloorPlanHome.tsx:269,321,1147 | 3 eslint-disable-next-line suppressions for exhaustive-deps |
| G-017 | MEDIUM | FloorPlanHome.tsx:1274 | `loadFloorPlanData` not wrapped in useCallback |
| G-018 | LOW | use-floor-plan.ts:156,244,370 | Comments say "30 seconds" but UNDO_WINDOW_MS = 300000 (5 minutes) |
| G-019 | LOW | use-floor-plan.ts | `flashingTables` uses Map (not JSON-serializable) |

### Category 6: Entertainment

| ID | Severity | File | Issue |
|----|----------|------|-------|
| G-020 | HIGH | FloorPlanEntertainment.tsx:55-92 | Resize uses stale `resizeStart` values (jumpy) |
| G-021 | MEDIUM | FloorPlanEntertainment.tsx:43-52 | Timer badge doesn't auto-update (no setInterval) |

### Category 7: API (Security)

| ID | Severity | File | Issue |
|----|----------|------|-------|
| G-022 | MEDIUM | /api/tables/[id]/route.ts:97-185 | Table PUT missing locationId validation (cross-tenant risk) |
| G-023 | MEDIUM | /api/tables/[id]/route.ts:188-225 | Table DELETE missing locationId validation (cross-tenant risk) |
| G-024 | MEDIUM | /api/tables/route.ts:75 | Order items limited to take:10 causes data truncation |

### Category 8: Performance

| ID | Severity | File | Issue |
|----|----------|------|-------|
| G-025 | MEDIUM | FloorPlanHome.tsx:1101-1124 | 30s heartbeat polls ALL tables/seats/orders (heavy payload) |
| G-026 | LOW | FloorPlanHome.tsx:1288-1291 | Full JSON.stringify comparison on every poll |
| G-027 | LOW | use-floor-plan.ts | Shared Zustand store between FOH and admin (could conflict) |
| G-028 | MEDIUM | /api/tables/combine/route.ts:437-464 | N+1 seat updates in physical combine |

### Category 9: Known Issues

| ID | Severity | File | Issue |
|----|----------|------|-------|
| G-029 | HIGH | Prisma schema | Table.capacity drifts from actual Seat count |
| G-030 | LOW | Multiple files | Console spam not verified in production build |

### Summary by Severity

| Severity | Count |
|----------|-------|
| HIGH | 6 |
| MEDIUM | 17 |
| LOW | 7 |
| **TOTAL** | **30** |

---

## 8. Implementation Priority

| # | Fix | Effort | Impact | Key Files |
|---|-----|--------|--------|-----------|
| 1 | Wire `restore-original` into dissolve/remove routes | Small | Dissolve works correctly | dissolve/route.ts, remove/route.ts |
| 2 | Render SVG perimeter border from `getOuterEdges()` | Medium | Visual unified border | FloorPlanHome.tsx, perimeterSeats.ts |
| 3 | Fix drag-drop to support adding to existing virtual groups | Medium | 3+ table combining works | FloorPlanHome.tsx:2306 |
| 4 | Add "Add Table" button to VirtualGroupManagerModal | Small | Intuitive group management | VirtualGroupManagerModal.tsx |
| 5 | Fix combine mode selection guard deadlock | Medium | Long-press combine works for existing groups | FloorPlanHome.tsx:1551 |
| 6 | Make "Add Seat" create real DB Seat with calculated position | Medium | Seats physically appear | FloorPlanHome.tsx:1773, seat-generation.ts |
| 7 | Add socket dispatches to 3 virtual-combine sub-routes | Small | Cross-terminal sync | add/remove/set-primary routes |
| 8 | Fix locationId validation on table PUT/DELETE | Small | Security fix | /api/tables/[id]/route.ts |
| 9 | Remove stack trace from combine error response | Small | Security fix | /api/tables/combine/route.ts:557 |
| 10 | Add manual zoom controls to POS view | Medium | User can zoom in/out | FloorPlanHome.tsx |
| 11 | Add pinch-to-zoom for iPad | Medium | Touch device support | FloorPlanHome.tsx |
| 12 | Add rotation-aware collision detection | Medium | Correct overlap prevention | perimeterSeats.ts |
| 13 | Fix long-press 1px cancel threshold | Small | Touchscreen usability | TableNode.tsx:198 |
| 14 | Fix entertainment resize stale state | Small | No jumpy resize | FloorPlanEntertainment.tsx |
| 15 | Fix entertainment timer auto-update | Small | Timer counts down live | FloorPlanEntertainment.tsx |

---

## 9. Key File Reference

### Core Components
| File | Lines | Purpose |
|------|-------|---------|
| `src/components/floor-plan/FloorPlanHome.tsx` | ~4500 | Main POS floor plan (monolith) |
| `src/components/floor-plan/TableNode.tsx` | ~700 | Individual table rendering (FOH) |
| `src/components/floor-plan/VirtualCombineBar.tsx` | ~100 | Bottom bar for combine mode |
| `src/components/floor-plan/VirtualGroupManagerModal.tsx` | ~200 | Group management (remove/dissolve only) |
| `src/components/floor-plan/FloorPlanEntertainment.tsx` | ~250 | Entertainment element rendering |
| `src/components/floor-plan/FloorPlanTable.tsx` | ~562 | Alternative FOH table + orbital seats |
| `src/components/floor-plan/UnifiedFloorPlan.tsx` | ~960 | Alternative floor plan (duplicate auto-scale) |
| `src/components/floor-plan/InteractiveFloorPlan.tsx` | ~423 | Legacy SVG zoom floor plan |

### Hooks & State
| File | Purpose |
|------|---------|
| `src/components/floor-plan/use-floor-plan.ts` | Zustand store (virtual combine state, undo, flash) |
| `src/components/floor-plan/hooks/useFloorPlanAutoScale.ts` | Auto-scale hook (POS view) |
| `src/components/floor-plan/hooks/useFloorPlanDrag.ts` | Drag-drop combine + table movement |

### Geometry & Seat Logic
| File | Purpose |
|------|---------|
| `src/lib/table-geometry.ts` | Exposed edges, perimeter path (dead code), seat distribution |
| `src/lib/seat-generation.ts` | Primary seat positioning engine (pixels, collision detection) |
| `src/lib/virtual-group-seats.ts` | Virtual seat numbering (labels only, no positioning) |
| `src/domains/floor-plan/groups/perimeterSeats.ts` | Active virtual group seat placement with collision avoidance |
| `src/lib/floorplan/constants.ts` | SEAT_RADIUS=20, SEAT_DEFAULT_OFFSET=8, canvas dimensions |
| `src/lib/seat-utils.ts` | Seat balance/status calculations |

### Admin Editor
| File | Purpose |
|------|---------|
| `src/domains/floor-plan/admin/EditorCanvas.tsx` | Admin editor canvas (CSS zoom) |
| `src/domains/floor-plan/admin/FloorPlanEditor.tsx` | Admin editor wrapper |
| `src/domains/floor-plan/admin/SeatRenderer.tsx` | Admin seat rendering |
| `src/domains/floor-plan/admin/TableRenderer.tsx` | Admin table + seat rendering |

### API Routes
| Route | Purpose |
|-------|---------|
| `POST /api/tables/virtual-combine` | Create virtual group |
| `POST /api/tables/virtual-combine/[groupId]/add` | Add table to group |
| `POST /api/tables/virtual-combine/[groupId]/remove` | Remove table from group |
| `POST /api/tables/virtual-combine/[groupId]/dissolve` | Dissolve group |
| `POST /api/tables/virtual-combine/[groupId]/set-primary` | Change primary table |
| `POST /api/tables/[id]/seats` | Create single seat |
| `POST /api/tables/[id]/seats/auto-generate` | Auto-generate seats with collision detection |
| `POST /api/tables/[id]/seats/generate` | Simple seat generation |
| `POST /api/tables/[id]/seats/reflow` | Reflow seats on resize |
| `POST /api/tables/[id]/seats/bulk` | Bulk update positions |
| `POST /api/tables/[id]/seats/save-as-default` | Save positions as builder defaults |
| `POST /api/seats/bulk-operations` | Bulk ops: reposition-for-combine, restore-original |
| `POST /api/orders/[id]/seating` | Order-level seat management (insert/remove with item shift) |
| `POST /api/tables/combine` | Physical combine (supposed to be deprecated?) |

### Legacy / Potentially Unused
| File | Purpose | Status |
|------|---------|--------|
| `src/domains/floor-plan/seats/seatLayout.ts` | Feet-based positioning | LEGACY |
| `src/domains/floor-plan/seats/seatAPI.ts` | In-memory seat API | LEGACY |
| `src/domains/floor-plan/services/seat-service.ts` | Normalized positioning | LEGACY |
| `src/domains/floor-plan/groups/TableGroup.tsx` | Bounding-box border component | NOT USED |
| `table-geometry.ts: buildGroupPerimeterPath/Polygon` | SVG perimeter path builders | DEAD CODE |
