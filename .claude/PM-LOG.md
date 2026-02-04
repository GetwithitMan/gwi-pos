# GWI POS - Project Manager Log

This file tracks session notes, ideas, decisions, and worker activity. Updated each PM session.

---

# Session: 2026-01-30

**PM Session Start**: Activated via "Open Project Manager"

## Project Status at Session Start
- Phase 1 (MVP): 75% complete
- Skills: 77 DONE, 3 PARTIAL, 7 TODO (87 total, 92%)
- Tasks Ready: 6 (T001-T006)
- Tasks Blocked: 4

## Critical Bug Fix: Race Condition in Order Items

### Problem Identified (User Code Review)
User reviewed FloorPlanHome code and identified a critical race condition:

**The Bug:**
```
Server A: GET order (items: 1, 2, 3)
Server B: GET order (items: 1, 2, 3)
Server A: Adds item 4 locally → PUT [1, 2, 3, 4]
Server B: Adds item 5 locally → PUT [1, 2, 3, 5]
Result: Items 1, 2, 3, 5 (item 4 LOST!)
```

**Root Cause:**
- PUT endpoint deleted ALL items and re-created from request body
- Client fetched order, merged items locally, sent back full list
- Last PUT wins, other terminal's items get overwritten

### Solution Implemented
Created new atomic append endpoint: `POST /api/orders/[id]/items`

**Key Design:**
1. Only accepts NEW items to add (not full list)
2. Uses Prisma transaction for atomicity
3. Appends items directly to database
4. Recalculates totals from database state (not client values)
5. Returns complete updated order

**Updated FloorPlanHome:**
- Changed from PUT (replace all) to POST (append only)
- Removed client-side merge logic
- Simplified code by 20 lines

**Files Changed:**
- Created: `src/app/api/orders/[id]/items/route.ts`
- Updated: `src/components/floor-plan/FloorPlanHome.tsx`

### Why This Matters
- Busy bar with 3+ terminals = guaranteed data loss with old approach
- Race condition hard to reproduce in single-user testing
- Critical fix for production multi-terminal environments

---

## Code Quality Improvements (User Review Feedback)

### FloorPlanHome Fixes

| Fix | Issue | Solution |
|-----|-------|----------|
| Race Condition | PUT replaced all items, concurrent adds lost | POST `/api/orders/[id]/items` appends atomically |
| Ghost IDs | Temp IDs not mapped to real DB IDs | Map IDs from API response after save |
| TableNode Performance | 50+ tables re-rendered on any state change | Wrapped in `React.memo` |
| Multiple Intervals | Two setIntervals caused frame drops | Consolidated into single heartbeat |

### Modifier System Fixes

| Fix | Issue | Solution |
|-----|-------|----------|
| Atomic Transaction | Delete/create not atomic | Wrapped in `db.$transaction()` |
| Child Loading | useEffect iterated all selections | Load children in `toggleModifier` directly |
| Circular Reference | A → B → A chains caused infinite loops | Check before save with toast warning |
| Stacking UX | At max, silently did nothing | Toast: "Maximum X selections reached" |

### 1. Toast Notification System (Implemented)
**Problem:** API errors logged to console only - users don't know when something fails.

**Solution:**
- Created `src/stores/toast-store.ts` using Zustand
- Created `src/components/ui/ToastContainer.tsx`
- Added to root layout for app-wide availability
- Types: success (green), error (red), warning (yellow), info (blue)
- Auto-dismiss: errors 5s, others 3s

**Integration in FloorPlanHome:**
- Order creation failures → error toast
- Item append failures → error toast
- Send to kitchen → success/warning toast
- Order loading failures → error toast
- Table combine failures → error toast (replaced alert())

### 2. Unique Temp IDs (Implemented)
**Problem:** `Date.now()` for temp IDs can collide if two items added in same millisecond.

**Solution:** Changed to `crypto.randomUUID()` for all temporary item IDs.

**Files Changed:** `src/components/floor-plan/FloorPlanHome.tsx` (4 occurrences)

### 3. Table Canvas Extraction (Deferred)
**Recommendation:** Extract canvas to separate `React.memo` component.
**Status:** Will implement when adding new canvas features (not standalone refactor).

### 4. CSS Refactor (Skipped)
**Recommendation:** Move inline styles to CSS/Tailwind.
**Status:** Low priority - inline styles work fine, not worth the effort without a redesign.

---

## Session End Summary (2026-01-30)

### Completed Today
- Fixed race condition in order item updates (critical)
- Fixed ghost ID mapping after order save
- Added toast notification system (app-wide)
- Wrapped TableNode in React.memo (performance)
- Consolidated intervals into single heartbeat
- Fixed modifier API transaction safety
- Fixed modifier child loading performance
- Added circular reference detection for modifiers
- Improved stacking UX with toast feedback
- Documented Hardware Status Dashboard (Skill 115)
- Documented Drag Item to Seat (Skill 116)

### Files Created
- `src/stores/toast-store.ts`
- `src/components/ui/ToastContainer.tsx`
- `src/app/api/orders/[id]/items/route.ts`
- `docs/skills/115-HARDWARE-STATUS-DASHBOARD.md`
- `docs/skills/116-DRAG-ITEM-TO-SEAT.md`
- `FloorPlan-CODE.txt` (code export)
- `Modifiers-CODE.txt` (code export)

### Next Session Priorities
1. Bar Tabs UI improvements (Skill 20)
2. Closed Order Management (Skill 114)
3. Kitchen Print Integration

---

## Ideas Captured

### Real-Time Architecture (Sockets Discussion)
- Developer friend mentioned "LTA Sockets" for speed
- Clarified as WebSockets/Socket.io
- Current system uses 5-second polling
- At 20K users: polling = 4,000 req/sec = disaster
- **Decision**: Plan for Pusher/Ably now, implement later
- Added Skill 110: Real-time Events (Pusher/Ably)

### Interactive Floor Plan (Konva/SVG)
- Friend suggested Konva.js or Fabric.js for canvas-based floor plan
- Layered approach: Background → Tables → Seats
- For restaurant scale (< 100 tables): SVG is simpler
- For 20K event ticketing: Konva handles better
- **Decision**: SVG first for bar/restaurant, upgrade to Konva for ticketing
- Added Skill 106: Interactive Floor Plan (Konva)

### Table Combine/Split Feature
- Core bar/restaurant need: drag two tables together to merge orders
- Touch-slide gesture to combine
- Combined tables show "T1+T2" name
- Seats accessible from both tables
- Split option to reverse
- **Decision**: Build as part of floor plan (Skill 107)
- Added Skill 107: Table Combine/Split

### Event Ticketing Platform
- Schema already built: Event, EventPricingTier, EventTableConfig, Ticket
- Supports: per_seat, per_table, general_admission, hybrid modes
- Hold system: heldAt, heldUntil, heldBySessionId (10min TTL)
- Missing: APIs, UI, real-time seat status
- **Decision**: Build after floor plan foundation
- Added Skill 108: Event Ticketing APIs

### Visual Pizza Builder
- Same Konva/SVG tech could enhance pizza ordering
- Section selection (whole, half, quarter, sixth)
- Drag toppings to sections
- Live preview on KDS
- Reuses 60% of floor plan code
- **Decision**: Build after ticketing floor plan
- Added Skill 109: Visual Pizza Builder

### Training Mode (New - from T002 review)
- Sandbox mode for training servers
- Nothing recorded to production database
- Uses temp local storage or separate DB
- Accessible via developer options or manager toggle
- **Decision**: Add as future skill
- Added Skill 111: Training Mode

### Simulated Card Reader (New - from T002 review)
- Developer option at top of screen: "Tap Card" vs "Chip Card" buttons
- Tap: Quick payment simulation, no customer name pulled
- Chip: Full simulation, pulls customer name, more functionality
- Useful for development and training mode
- **Decision**: Add as future skill
- Added Skill 112: Simulated Card Reader

---

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| SVG before Konva | Simpler for restaurant scale, can upgrade later |
| Pusher/Ably over self-hosted | Battle-tested, works with Vercel, ~$50/mo |
| Table combine is priority | Daily bread-and-butter for bars/restaurants |
| 20K event ticketing is Phase 2+ | Focus on core POS first |
| Add events abstraction now | Prep for WebSockets without full implementation |
| No Stripe | User decision - use Square/MagTek instead |
| MagTek agreement pending | T011 blocked until business agreement finalized |
| Training mode as separate skill | Valuable for onboarding, not urgent for MVP |

---

## Skills Added This Session

| Skill | Name | Status | Notes |
|-------|------|--------|-------|
| 106 | Interactive Floor Plan (Konva) | TODO | SVG first, Konva for scale |
| 107 | Table Combine/Split | TODO | Drag gesture to merge orders |
| 108 | Event Ticketing APIs | TODO | CRUD, hold/release, check-in |
| 109 | Visual Pizza Builder | TODO | Reuses floor plan components |
| 110 | Real-time Events (Pusher/Ably) | TODO | WebSocket abstraction layer |
| 111 | Training Mode | TODO | Sandbox with temp DB for server training |
| 112 | Simulated Card Reader | TODO | Dev/training tap vs chip simulation |

**Updated totals**: 77 DONE, 3 PARTIAL, 14 TODO (94 total, 85%)

---

## Workers Deployed

### Worker 1: T001 - OFFLINE-SYNC-ALGORITHM.md
- **Type**: Documentation
- **Priority**: Critical
- **Status**: ✅ COMPLETE
- **Deployed At**: 2026-01-30
- **Output**: Full algorithm with ASCII diagrams, pseudocode, edge cases
- **User Clarifications Applied**:
  - Alerts → both admin UI + email
  - Customer data bidirectional via cloud (additive merge for loyalty)
  - Dispute workflow = processor-dependent best-case design
  - Manual sync = super admin only (cloud level)
- **Unblocked**: T010 (Socket.io), T014 (Docker config) now READY

### Worker 2: T002 - PAYMENT-PROCESSING.md
- **Type**: Documentation
- **Priority**: Critical
- **Status**: ✅ COMPLETE
- **Deployed At**: 2026-01-30
- **Output**: 1,156 lines, all criteria met
- **Modifications**: Removed Stripe per user request, now processor-agnostic (Square/MagTek)
- **Note**: T011 (Implement payment processing) remains BLOCKED - MagTek agreement pending

### Worker 3: Skills 106/107 - Floor Plan + Table Combine
- **Type**: Code
- **Priority**: High (User's fun project)
- **Status**: ✅ COMPLETE
- **Deployed At**: 2026-01-30
- **Output**:
  - 9 files created (components, APIs, store, events abstraction)
  - 3 files modified (schema, tables API, tables page)
  - Schema: Added combinedWithId, combinedTableIds, originalName to Table
  - Features: SVG floor plan, drag-combine, long-press split, 30s undo, pan/zoom
- **Known Limitations**: No position persistence, basic touch (no pinch-zoom)

---

## Pending Review
- [x] Worker 1 output (OFFLINE-SYNC-ALGORITHM.md) ✅ APPROVED
- [x] Worker 2 output (PAYMENT-PROCESSING.md) ✅ APPROVED
- [x] Worker 3 output (Floor Plan + Table Combine code) ✅ APPROVED
- [x] Worker 1 output (T003: Consolidate REQUIREMENTS.md) ✅ APPROVED
- [x] Worker 2 output (T016: Simulated Card Reader) ✅ APPROVED
- [x] Worker 1 output (T004: API-REFERENCE.md) ✅ APPROVED
- [x] Worker 2 output (T018: Super Admin Role + Dev Access) ✅ APPROVED
- [x] Worker 1 output (T005: ERROR-HANDLING-STANDARDS.md) ✅ APPROVED
- [x] Worker 2 output (T006: TESTING-STRATEGY.md) ✅ APPROVED
- [x] Worker 1 output (T007: Update BUILD-PLAN.md) ✅ APPROVED
- [x] Worker 2 output (T008: Add skill file headers) ✅ APPROVED (Note: Only 3 skill files exist, not 60)
- [x] Worker 2 output (T010: Real-time Events System) ✅ APPROVED
- [x] Worker 1 output (T009: DATABASE-REFERENCE.md) ✅ APPROVED
- [x] Worker 2 output (T012: Check Splitting) ✅ APPROVED
- [x] Worker 1 output (T013: Coursing System) ✅ APPROVED
- [x] Worker 2 output (T014: Docker Config) ✅ APPROVED
- [x] Worker 1 output (T020: Event Ticketing APIs) ✅ APPROVED
- [x] Worker 2 output (T021: Visual Pizza Builder) ✅ APPROVED
- [x] Worker 2 output (T022: Pizza Seed Data) ✅ APPROVED
- [x] Worker 1 output (T023: Floor Plan Home - Initial) ✅ NEEDS REWORK (major UX changes requested)
- [ ] Worker 1 output (T023: Floor Plan Home - Round 2) - Feedback sent
  - Issue: Extra "Whiskey" header, "0 items" message, "Back to Tables" button not needed
  - Fix: Category chips ARE the toggle - click to select, click again to deselect and show tables
  - No extra UI elements needed - category bar is the only navigation
- [ ] Worker 3 output (T019: Floor Plan Overhaul) - In Progress
  - **Scope expanded** to include: seat persistence fix, multi-room support, admin seat placement, sync
  - Previous work: Seats generated via `/api/tables/seats/generate-all` (8 tables, 27 seats)
  - Issues: Seats disappearing, admin/POS out of sync, no multi-room support
  - Priority: 1) Fix seat persistence, 2) Multi-room schema, 3) Admin seat tools, 4) Sync
- [ ] Worker 2 output (T024: Pizza Builder Integration) - ⏸️ PAUSED
  - Pizza has issues but floor plan is higher priority
  - Will resume after floor plan/seating is stable
- [ ] Worker 2 output (T027: Floor Plan Support) - Assigned
  - Pivoted from pizza to help with floor plan fixes
  - Options: Fix admin builder OR help with multi-room schema
  - Coordinates with Worker 3 to avoid duplicate effort

---

## UX Direction Change (Evening Session)

**Major Decision:** The floor plan IS the main order screen. No navigation away.

**Requirements clarified:**
1. Category click = tables disappear, menu items appear (same screen)
2. Employee menu in top-left (from old order screen)
3. Per-employee settings (colors, reset to default)
4. Order panel = table info panel style
5. Takeout/Delivery/Bar Tab buttons on floor plan
6. Open Orders button with count
7. NEW: `/tabs` page for bartenders - scrollable, searchable
8. Deprecate old order screen entirely

**Category Selection UX (Clarified):**
- Category chips are TOGGLES - click to select, click same one again to deselect
- When deselected → tables reappear (no "Back to Tables" button needed)
- NO extra headers like "Whiskey" or "0 items" - category bar IS the navigation
- Selected category = highlighted chip + menu items in canvas area
- Clicking different category = instant switch (no intermediate state)

**New Task Created:** T025 - Bar Tabs Page

---

## Data Loss Incident & Safeguards (Late Evening)

**Incident:** User discovered missing data:
- 5 modifier groups gone (salad choice, salad or potato, cheese, potato, gravy)
- Hardware (printers) gone
- Data existed in Jan 29 16:22 backup but not in current database

**Root Cause:** Database reset during today's session (likely during schema changes for sync fields or socket.io work) wiped all data and re-seeded. Custom data added via UI was not in seed.ts.

**Impact:** User must manually rebuild modifiers and hardware config.

**Actions Taken:**
1. Created T028: Production Database Safeguards (CRITICAL for go-live)
2. Updated CLAUDE.md with prominent warnings about destructive commands
3. Added production database rules (no reset, migrations only, PostgreSQL required)
4. Documented backup/restore procedures

**Lesson Learned:**
- Custom data MUST be added to seed.ts or it will be lost on reset
- Need environment checks to block destructive commands in production
- PostgreSQL with point-in-time recovery required for production

---

## T019 Scope Expansion (Late Evening)

**Decision:** Expand T019 from "Integrate Floor Plan into Orders Page" to full "Floor Plan Overhaul"

**Problems Identified:**
1. Seats disappearing randomly
2. Seat counts changing unexpectedly
3. Admin floor plan builder can't place default seats
4. Admin and POS floor plans out of sync
5. No multi-room support

**New Scope - 4 Parts:**
1. **Seat Persistence Fix** (Critical) - Stop data loss
2. **Multi-Room Support** - Schema + UI for rooms (Main Dining, Patio, Bar, etc.)
3. **Admin Seat Placement** - Generate defaults, drag to position, manual editing
4. **Sync Admin/POS** - Consistent data fetching and rendering

**Schema Addition:** `FloorPlanRoom` model with room tabs in both admin and POS

---

## Cleanup Plan

**Decision:** Finish current worker tasks FIRST, then cleanup.

**Cleanup blocked until:**
- T019 (Worker 3) - Seats + Multi-Stack
- T023 (Worker 1) - Floor Plan Home UX
- T024 (Worker 2) - Pizza Builder Integration

**Cleanup targets:**
- `orders/page.tsx` - 4,373 lines → split to ~200
- `FloorPlanHome.tsx` - 1,115 lines → split to ~300
- `PizzaVisualBuilder.tsx` - 1,133 lines → split
- Remove duplicate/dead code

---

## Notes for Next Session
- Review worker outputs when complete
- Update TASKS.md with completion status
- Consider starting T003 (Consolidate REQUIREMENTS.md) - quick win
- Discuss Pusher account setup if ready for real-time

---

## Architecture Discussions

### Current vs Target Architecture

**Current (Polling)**:
```
[Clients] → poll every 5 sec → [Vercel API] → [SQLite]
```

**Target (Real-time)**:
```
[Clients] ←WebSocket→ [Pusher/Ably]
     ↓
[Vercel Edge/Serverless]
     ↓
[Redis Cache] → [PostgreSQL]
```

### Migration Path
1. SQLite → PostgreSQL (Neon/Supabase) - 2-4 hrs
2. Add Redis cache - 4-6 hrs
3. Add events abstraction - 1-2 hrs
4. Add Pusher/Ably - 4-8 hrs
5. Connection pooling - Built into Prisma

---

## T019 Progress: Floor Plan Overhaul (Late Night Session)

### Features Implemented by Worker 3

| Feature | Implementation | Keyboard Shortcut |
|---------|---------------|-------------------|
| **Table Selection** | Click to select, blue border highlight | Click |
| **Table Movement** | Arrow keys for precise positioning | Arrows (5px), Shift+Arrows (20px) |
| **Table Rotation** | Rotate tables with visual feedback | R (90°), Shift+R (15°), Alt+R (CCW) |
| **Table Duplication** | Copy selected table with unique name | Ctrl/Cmd+D |
| **Seat Movement** | Arrow keys when seat selected | Arrows (5px), Shift+Arrows (20px) |
| **Seat Constraints** | Seats constrained within 150px of table center | Automatic |

### Bug Fixes by PM

**1. Rotation Not Saving (API Fix)**
- **Problem**: Table rotation slider changed but table didn't rotate
- **Root Cause**: `/api/tables/[id]/route.ts` PUT handler didn't accept `rotation` field
- **Fix**: Added `rotation` to body extraction, update data, and response
- **File**: `src/app/api/tables/[id]/route.ts`

**2. Rotation Visual Not Updating (Framer Motion Fix)**
- **Problem**: Even after API fix, visual rotation didn't apply
- **Root Cause**: Framer Motion's `animate` prop overrides CSS `transform` in `style`
- **Fix**: Moved `rotate: table.rotation || 0` from `style` to `animate` prop
- **File**: `src/components/floor-plan/TableNode.tsx`

### Outstanding Issues (Prompt Created for Worker 3)

1. **Table Labels Missing** - Name/number not displaying on table
2. **Seat Count Missing** - "4 seats" indicator not showing
3. **Duplicate Naming** - Need unique names when copying (Table 1 → Table 1 (Copy))
4. **Counter-rotating Text** - Text should stay readable when table rotates

---

## Ticketing Schema Confirmation (Phase 2)

**User Question**: Is each seat trackable for selling tickets?

**Answer**: YES - Schema already supports full per-seat ticketing.

**Existing Schema Support**:

| Model | Field | Purpose |
|-------|-------|---------|
| `Event` | `ticketingMode` | per_seat, per_table, general_admission, hybrid |
| `Ticket` | `seatId` | Links ticket to specific seat |
| `Ticket` | `tableId` | Links ticket to table (for per_table mode) |
| `EventPricingTier` | `priceAmount` | Premium/standard/accessible pricing |
| `Seat` | `id`, `seatNumber` | Individual seat tracking |

**Ticketing Modes**:
- `per_seat` - Each seat sold separately (concerts, galas)
- `per_table` - Entire table sold as unit (fundraiser tables)
- `general_admission` - No seat assignment
- `hybrid` - Mix of reserved + GA

**Tasks Added for Phase 2**:
- T029: Event Ticketing UI - Floor plan seat picker
- T030: Real-time Seat Availability - Pusher/Ably integration
- T031: Reservation System - Table reservations with time slots
- T032: Ticketing Modes - Full mode implementation
- T033: Tiered Pricing UI - Premium/standard/accessible pricing

---

## Worker Status (Current)

| Worker | Task | Status | Notes |
|--------|------|--------|-------|
| Worker 1 | T035: Server Personalization | 🔵 IN PROGRESS | Quick bar + button colors |
| Worker 2 | - | ⏸️ ON HOLD | Pizza paused, waiting for floor plan + personalization to complete |
| Worker 3 | T019: Floor Plan Overhaul | 🔵 IN PROGRESS | Combined table click, seat labels, reset to builder |

### T034 Completed (Worker 1)
- ✅ Seat buttons in order panel (Shared + numbered)
- ✅ Active seat state with visual feedback
- ✅ Combined tables: sequential numbering (1-8 for 4+4)
- ✅ Combined table header: "Combined X Tables"
- ✅ Items grouped by seat in order panel
- ✅ KDS shows "S1:", "S2:" prefix on items
- ✅ Kitchen tickets print seat assignments

### Worker 3 Completed (This Round)
- ✅ Unique names on duplicate ("Table 1 Copy", "Table 1 Copy 2")
- ✅ Counter-rotating text for readability
- ✅ Table labels (name + seat count)
- ✅ Status color bar at top
- ✅ Combined table dashed border + animations

### Current Worker Prompts

**Worker 3 - Table Label Refinements:**
- Dynamic font sizing based on table dimensions
- Rotate text 90° for narrow tables
- REMOVE small seat dots inside table (redundant)
- Combined tables: sequential seat numbering (1-8, 1-14, etc.)

**Worker 1 - Seat Assignment for Orders:**
- Seat buttons on left side of order panel
- Tap seat → items assigned to that guest
- Combined tables = sequential numbering
- Header shows "Combined (2 Tables)" or similar
- Seat assignments to KDS and printers

---

---

## Session: 2026-01-30 (Late Night - Seat Numbering & Undo)

### Summary
Fixed seat numbering to start from top-left corner, combined table seat ordering, table positioning, and undo functionality for removing single tables from combined groups.

### Issues Addressed

| Issue | Problem | Solution |
|-------|---------|----------|
| Seat 1 position | Seat 1 started at center of top edge | Changed `currentDist = 0` to start from top-left corner |
| Circle seats | Seat 1 at 12 o'clock | Changed start angle from `-π/2` to `-3π/4` (top-left) |
| Combined seat order | Seats showed random numbers with 3+ tables | Sort seats by clockwise angle from top-left, use `seat.label` from DB |
| Table positioning | Tables centered/offset when combining | Changed to flush edge alignment in `calculateAttachPosition` |
| Top/bottom attach | Tables only attached left/right | Fixed `calculateAttachSide` to normalize by table dimensions |
| Ghost preview | Preview didn't match final position | Calculate combined bounding box for preview |
| Seats after split | Seats went to random positions | Fixed to restore `originalRelativeX/Y` without changing `seatNumber` |
| Undo splits all | Undo split entire group instead of last table | Created new `remove-from-group` endpoint |
| Undo window | 30 seconds too short | Extended to 5 minutes |

### Files Modified

**Seat Generation (top-left start):**
- `/src/app/api/tables/route.ts` - `currentDist = 0`, circle angle `-3π/4`
- `/src/app/api/tables/[id]/route.ts` - Same changes
- `/src/app/api/tables/[id]/seats/auto-generate/route.ts` - Same changes
- `/src/app/api/tables/seats/generate-all/route.ts` - Same changes

**Table Positioning:**
- `/src/components/floor-plan/table-positioning.ts`
  - `calculateAttachSide`: Normalize by table dimensions for easier top/bottom
  - `calculateAttachPosition`: Flush edge alignment instead of centering

**Combined Table Seats:**
- `/src/app/api/tables/combine/route.ts`
  - Perimeter seats start from `currentDist = 0`
  - Sort seats by clockwise angle before assigning labels

**Frontend Display:**
- `/src/components/floor-plan/TableNode.tsx`
  - Use `seat.label` from database instead of calculated offset
- `/src/components/floor-plan/FloorPlanHome.tsx`
  - Ghost preview uses combined bounding box
  - `handleUndo` calls `remove-from-group` endpoint

**Split/Undo:**
- `/src/app/api/tables/[id]/split/route.ts`
  - `generateSeatsAllAround` starts at `currentDist = 0`
  - Restore seats without changing `seatNumber` (unique constraint)
- `/src/app/api/tables/[id]/remove-from-group/route.ts` - **NEW**
  - Removes single table from combined group
  - Restores original position, name, and seat positions
  - Recalculates remaining group's seat labels

**Store:**
- `/src/components/floor-plan/use-floor-plan.ts`
  - `UNDO_WINDOW_MS = 300000` (5 minutes)

### Key Algorithm: Clockwise Seat Numbering

```typescript
// Calculate combined bounding box center
const combinedCenterX = (minX + maxX) / 2
const combinedCenterY = (minY + maxY) / 2

// For each seat, calculate clockwise angle from top-left
const dx = absoluteX - combinedCenterX
const dy = absoluteY - combinedCenterY
let angle = Math.atan2(dy, dx) * 180 / Math.PI
angle = (angle + 135 + 360) % 360  // +135° shifts 0° to top-left

// Sort by angle, assign labels 1, 2, 3...
seatsWithAngles.sort((a, b) => a.clockwiseAngle - b.clockwiseAngle)
```

### Testing Performed
- ✅ Single table seat 1 at top-left (rectangle)
- ✅ Single table seat 1 at top-left (circle)
- ✅ 2-table combine: seats 1-8 clockwise from top-left
- ✅ 3-table combine: seats 1-12 clockwise from top-left
- ✅ Tables attach flush (left/right/top/bottom)
- ✅ Undo removes only last table added
- ✅ Split restores all tables to original positions
- ✅ Seats restore to original positions after split

*Log updated: 2026-01-30 (late night)*

---

## Session: 2026-01-30 (End of Day - FloorPlanHome Fixes)

### Summary
Fixed critical bugs in FloorPlanHome and PaymentModal to complete the inline ordering flow.

### Issues Fixed

| Issue | Problem | Solution |
|-------|---------|----------|
| CSS Warning | borderColor/border conflict in CategoriesBar | Changed to individual border properties (borderWidth, borderStyle, borderColor) |
| React Hooks Error | PaymentModal had useState after early returns | Moved all hooks to top of component before any returns |
| Missing Receipt | No receipt modal after payment in floor-plan view | Added ReceiptModal to floor-plan return block |
| Order Not Clearing | Order stayed on screen after receipt close | Added paidOrderId/onPaidOrderCleared flow to clear FloorPlanHome state |
| 500 Error on Send | Send to kitchen returned 500 | Added better error logging (may need `npx prisma generate`) |

### Files Modified

| File | Changes |
|------|---------|
| `src/components/floor-plan/CategoriesBar.tsx` | Fixed border/borderColor CSS conflict, removed debug log |
| `src/components/payment/PaymentModal.tsx` | Moved all useState hooks before early returns |
| `src/app/(pos)/orders/page.tsx` | Added paidOrderId state, ReceiptModal to floor-plan, onPaidOrderCleared |
| `src/components/floor-plan/FloorPlanHome.tsx` | Added paidOrderId/onPaidOrderCleared props, useEffect to clear order |
| `src/app/api/orders/[id]/send/route.ts` | Added detailed error message in response |
| `CLAUDE.md` | Added FloorPlanHome Integration section, Upcoming Work TODO |
| `docs/skills/SKILLS-INDEX.md` | Added Skill 113/114, updated 20/75 to PARTIAL, added Next Session Priority |

### Upcoming Work Documented

**Priority 1: Bar Tabs UI (Skill 20)**
- Improve OpenOrdersPanel for bartenders
- Quick tab creation from floor plan
- Pre-auth flow, tab transfer/merge

**Priority 2: Closed Order Management (Skill 114)**
- View closed orders with search/filter
- Void payments (manager PIN)
- Adjust tips, reprint receipts, reopen orders

**Priority 3: Kitchen Print Integration**
- Connect send route to actual print API

*Log updated: 2026-01-30 (end of day)*

---

# Session: 2026-02-02

**PM Session Start**: End of Day Summary

## Work Completed Today

### Skill 126: Explicit Input → Output Model (COMPLETE)

Major enhancement to the ingredient/prep item system enabling explicit transformation tracking.

**The Problem Solved:**
- Old system used simple `portionSize` implying 1:1 relationship
- No way to capture bulk-to-bulk transformations (6 oz raw → 2 oz cooked)
- Manual yield calculations, limited cost derivation

**The Solution Implemented:**
```
INPUT: 6 oz of Raw Chicken
           ↓
OUTPUT: 2 oz of Shredded Chicken (33% yield, $0.75/oz)
```

**New Schema Fields:**
| Field | Purpose |
|-------|---------|
| `inputQuantity` | How much parent is consumed (e.g., 6) |
| `inputUnit` | Unit for input (e.g., "oz") |
| `outputQuantity` | How much is produced (e.g., 2) |
| `outputUnit` | Unit for output (e.g., "oz" or "each") |
| `recipeYieldQuantity` | For inventory items: batch yield |
| `recipeYieldUnit` | Unit for recipe yield |

**New Library Files:**

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/units.ts` | 191 | 50+ units, categories, precision hints, helpers |
| `src/lib/unit-conversions.ts` | 218 | Weight/volume conversions, yield calculation, cost derivation |

**New Components:**

| Component | Lines | Purpose |
|-----------|-------|---------|
| `PrepItemEditor.tsx` | 697 | Explicit input→output fields, cost preview, validation |
| `InventoryItemEditor.tsx` | 610 | Delivery size, recipe management, batch yield |
| `IngredientEditorModal.tsx` | 155 | Thin wrapper with type selection |

**New API:**
- `GET /api/ingredients/[id]/cost` - Returns cost per unit with source tracking

**Documentation Updated:**
- Created `docs/skills/126-EXPLICIT-INPUT-OUTPUT-MODEL.md`
- Updated `docs/CHANGELOG.md` with full feature entry
- Updated `CLAUDE.md` Recent Changes section
- Updated `docs/skills/SKILLS-INDEX.md`

### Transformation Types Supported

| Type | Example |
|------|---------|
| Bulk → Bulk | 6 oz Raw Chicken → 2 oz Shredded (33% yield) |
| Bulk → Count | 1 lb Cheese → 16 slices |
| Count → Count | 1 Dough Ball → 1 Pizza Crust |

---

## Outstanding Tasks (Claude Task Queue)

The following prep stock tasks remain pending from previous sessions:

| ID | Task | Status | Notes |
|----|------|--------|-------|
| #1 | Deduct prep stock on Send to Kitchen | Pending | Core inventory deduction |
| #2 | Restore prep stock on void (if not made) | Pending | Requires #1 |
| #3 | Show stock badges on POS menu items | Pending | UI indicators |
| #4 | Quick stock adjustment UI for managers | ✅ Complete | `/inventory/quick-adjust` page built |

These tasks build on the Skill 126 foundation and should be prioritized next.

### Task #4 Completed: Quick Stock Adjustment Page (2026-02-03)

**Created:** `/src/app/(admin)/inventory/quick-adjust/page.tsx`

**Features:**
- Touch-friendly +/- buttons for quick adjustments
- Color-coded stock levels (critical=red, low=amber, ok=white, good=green)
- Items grouped by category with expand/collapse (collapsed by default)
- Quick add buttons (+5) for bulk adjustments
- Tap stock number to enter exact value
- Search filter to find items quickly
- Filter by stock level (All / Low Only / Critical Only)
- Stats bar showing critical/low/total counts

**Verification System (Double Verification):**
- Changes staged locally first (not saved immediately)
- Orange highlighting shows pending changes
- "Review & Save" button opens verification modal
- Must type "VERIFY" to confirm
- Must enter employee PIN for authorization
- PIN verified against server before saving
- All adjustments logged with employee attribution

**Navigation Updated:**
- Added to `InventoryNav.tsx` with ⚡ icon
- Added to `AdminSubNav.tsx` inventorySubNav array

---

### Cost Tracking & Audit Trail Enhancement (2026-02-03)

**New Schema Model: `IngredientStockAdjustment`**
```prisma
model IngredientStockAdjustment {
  id, locationId, ingredientId
  type           // "manual", "count", "waste", "transfer", "receiving"
  quantityBefore, quantityChange, quantityAfter, unit
  unitCost       // Cost per unit at adjustment time
  totalCostImpact // quantityChange * unitCost
  employeeId, reason, notes
  referenceType, referenceId  // Links to source workflows
  createdAt, updatedAt, deletedAt, syncedAt
}
```

**API Updates (`/api/inventory/stock-adjust`):**
- POST (single): Creates `IngredientStockAdjustment` + dispatches socket
- PATCH (bulk): Creates adjustment records + audit logs + socket dispatch
- Both now capture: `unitCost`, `totalCostImpact`, `employeeId`
- Cost calculated from `purchaseCost / unitsPerPurchase`

**New API: `/api/auth/verify-pin`**
- Verifies employee PIN without full login
- Returns employee ID for adjustment attribution
- Used by Quick Stock Adjust verification modal

**Socket Dispatch for Real-Time Updates:**
Added to `src/lib/socket-dispatch.ts`:
- `dispatchInventoryAdjustment()` - Bulk adjustment notification
- `dispatchStockLevelChange()` - Single item stock level change

**Data Flow for Cost Reporting:**
```
User adjusts stock → PIN verified → IngredientStockAdjustment created
                                  → AuditLog created
                                  → Socket dispatched
                                  → Reports can query:
                                     • Total cost impact
                                     • Who made adjustment
                                     • Before/after values
```

---

## Git Status

**Branch:** main (2 commits ahead of origin)

**Uncommitted Changes:** 120+ modified files, 100+ untracked files

Major categories:
- Schema changes (`prisma/schema.prisma`)
- New ingredient/inventory system files
- Admin navigation updates
- Floor plan improvements
- API route updates

**Recommendation:** Consider committing in logical chunks:
1. Skill 126 (Ingredient Input/Output) - ~15 files
2. Admin Navigation improvements
3. Floor Plan updates
4. Other API/component updates

---

## Next Session Priorities

1. **Commit Skill 126** - Group related files and commit
2. **Prep Stock Deduction (Task #1-2)** - Core inventory tracking
3. **Stock Badges on POS (Task #3)** - Visual indicators
4. **Bar Tabs UI (T025)** - Bartender workflow improvement
5. **Closed Order Management (T036)** - View/manage paid orders

---

*Log updated: 2026-02-02 (end of day)*
