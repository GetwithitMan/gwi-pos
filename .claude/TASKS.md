# GWI POS Task Queue

## How This Works

1. **PM (this terminal)** reviews project state and creates tasks
2. **Workers (other terminals)** receive task prompts and execute
3. **Results** are copied back to PM for review
4. **PM** validates, tests, and updates this queue

---

## Task Status Key

| Status | Meaning |
|--------|---------|
| 🔴 BLOCKED | Waiting on dependency |
| 🟡 READY | Can be picked up now |
| 🔵 IN PROGRESS | Worker assigned |
| ⏸️ PAUSED | On hold, will resume later |
| ✅ COMPLETE | Done, reviewed, merged |
| ❌ FAILED | Needs rework |

---

## Current Sprint: Documentation & Foundation

### Critical Path (Do First)

| ID | Task | Status | Worker | Dependencies |
|----|------|--------|--------|--------------|
| T001 | Create OFFLINE-SYNC-ALGORITHM.md | ✅ COMPLETE | Worker 1 | None |
| T002 | Create PAYMENT-PROCESSING.md | ✅ COMPLETE | Worker 2 | None |
| T003 | Consolidate REQUIREMENTS.md files | ✅ COMPLETE | Worker 1 | None |
| T004 | Create API-REFERENCE.md | ✅ COMPLETE | Worker 1 | None |
| T005 | Create ERROR-HANDLING-STANDARDS.md | ✅ COMPLETE | Worker 1 | None |
| T006 | Create TESTING-STRATEGY.md | ✅ COMPLETE | Worker 2 | None |

### High Priority (After Critical)

| ID | Task | Status | Worker | Dependencies |
|----|------|--------|--------|--------------|
| T007 | Update BUILD-PLAN.md for SQLite reality | ✅ COMPLETE | Worker 1 | None |
| T008 | Add headers to all skill files | ✅ COMPLETE | Worker 2 | None |
| T009 | Create DATABASE-REFERENCE.md | ✅ COMPLETE | Worker 1 | T004 ✓ |
| T010 | Implement Socket.io for real-time | ✅ COMPLETE | Worker 2 | T001 ✓ |

### Feature Work (Phase 1 Completion)

| ID | Task | Status | Worker | Dependencies |
|----|------|--------|--------|--------------|
| T011 | Implement payment processing | 🔴 BLOCKED | - | MagTek agreement pending |
| T012 | Implement check splitting | ✅ COMPLETE | Worker 2 | None |
| T013 | Implement coursing system | ✅ COMPLETE | Worker 1 | None |
| T014 | Build local server Docker config | ✅ COMPLETE | Worker 2 | T001 ✓ |
| T015 | Interactive Floor Plan + Table Combine | ✅ COMPLETE | Worker 3 | None |
| T017 | Floor Plan Premium UI Overhaul | ✅ COMPLETE | Worker 3 | T015 |
| T019 | Floor Plan Overhaul: Seats, Sync & Multi-Room | 🔵 IN PROGRESS | Worker 3 | T017 |
| T020 | Event Ticketing APIs (Skill 108) | ✅ COMPLETE | Worker 1 | None |
| T021 | Visual Pizza Builder (Skill 109) | ✅ COMPLETE | Worker 2 | None |
| T022 | Pizza Seed Data (Full Menu) | ✅ COMPLETE | Worker 2 | T021 |
| T024 | Pizza Builder Integration (Click to Open) | ⏸️ PAUSED | - | T021, T022 |
| T027 | Floor Plan Support: Admin Builder + Schema | ⏸️ PAUSED | - | None |
| T023 | Floor Plan as Home + Inline Ordering | ⏸️ PAUSED | - | T019 |
| T034 | Seat Assignment for Table Orders | ✅ COMPLETE | Worker 1 | T019 |
| T035 | Server Personalization (Quick Bar + Colors) | 🔵 IN PROGRESS | Worker 1 | None |
| T025 | Bar Tabs Page (Search/Filter) | 🟡 READY | - | T023 |
| T026 | Code Cleanup: Split Large Files | 🔴 BLOCKED | - | T019, T023, T024 |
| T036 | Closed Order Management | 🟡 READY | - | None |
| T037 | FloorPlanHome Fixes | ✅ COMPLETE | - | T023 |
| T038 | Modifier System Fixes | ✅ COMPLETE | - | None |
| T018 | Super Admin Role + Dev Access | ✅ COMPLETE | Worker 2 | T016 |
| T016 | Simulated Card Reader (Tap/Chip) | ✅ COMPLETE | Worker 2 | None |
| T039 | Inventory & Recipe Costing System (Skill 115) | 🔵 IN PROGRESS | - | Skill 126 (Input/Output) complete |

---

## Task Details

### T001: Create OFFLINE-SYNC-ALGORITHM.md
**Priority:** 🔴 Critical
**Estimated Effort:** Medium
**Location:** `/docs/OFFLINE-SYNC-ALGORITHM.md`

**Requirements:**
- Document step-by-step sync algorithm
- Define conflict resolution rules (last-write-wins)
- Handle: concurrent edits, deletions, ordering
- Include pseudocode examples
- Define sync queue data structure
- Document retry logic for failed syncs

**Acceptance Criteria:**
- [ ] Algorithm clearly documented
- [ ] Conflict scenarios covered
- [ ] Pseudocode provided
- [ ] Edge cases addressed

---

### T002: Create PAYMENT-PROCESSING.md ✅
**Priority:** 🔴 Critical
**Status:** COMPLETE
**Location:** `/docs/PAYMENT-PROCESSING.md`

**Delivered:**
- Payment flow diagrams (ASCII lifecycle + integration)
- Processor-agnostic code (Square/MagTek options, NO Stripe)
- Offline store-and-forward with $50 limit
- PCI compliance (tokenization, encryption, audit)
- All payment types: cash, card, split, gift, house account, loyalty

**Acceptance Criteria:**
- [x] Payment flow diagram
- [x] Processor integration documented (Square/MagTek)
- [x] Offline handling specified
- [x] Security requirements listed

---

### T003: Consolidate REQUIREMENTS.md
**Priority:** 🔴 Critical
**Estimated Effort:** Small
**Action:** Merge root `/REQUIREMENTS.md` into `/docs/REQUIREMENTS.md`

**Requirements:**
- Review both files
- Merge unique content from root into docs version
- Delete or archive root version
- Update any cross-references

**Acceptance Criteria:**
- [ ] Single REQUIREMENTS.md in /docs
- [ ] No duplicate content
- [ ] All links updated

---

### T004: Create API-REFERENCE.md
**Priority:** 🟡 High
**Estimated Effort:** Large
**Location:** `/docs/API-REFERENCE.md`

**Requirements:**
- Document ALL API endpoints
- Include: method, path, params, response
- Group by domain (menu, orders, employees, etc.)
- Include example requests/responses
- Document authentication requirements

**Acceptance Criteria:**
- [ ] All 40+ API routes documented
- [ ] Examples for each endpoint
- [ ] Auth requirements clear

---

### T005: Create ERROR-HANDLING-STANDARDS.md
**Priority:** 🟡 High
**Estimated Effort:** Small
**Location:** `/docs/ERROR-HANDLING-STANDARDS.md`

**Requirements:**
- Define error code numbering scheme
- Document retry logic patterns
- Define user-facing error messages
- Create error response format standard

**Acceptance Criteria:**
- [ ] Error codes defined
- [ ] Retry patterns documented
- [ ] Message templates created

---

### T006: Create TESTING-STRATEGY.md
**Priority:** 🟡 High
**Estimated Effort:** Medium
**Location:** `/docs/TESTING-STRATEGY.md`

**Requirements:**
- Define unit test patterns
- Define integration test approach
- Define E2E test critical paths
- Define performance test methodology
- Include file naming conventions

**Acceptance Criteria:**
- [ ] Test types defined
- [ ] File structure documented
- [ ] Critical paths listed

---

### T015: Interactive Floor Plan + Table Combine
**Priority:** 🟡 High
**Estimated Effort:** Large
**Skills:** 106, 107
**Location:** `/src/components/floor-plan/`

**Requirements:**
- SVG-based interactive floor plan component
- Tables colored by status (available/occupied/dirty)
- Seats visible around tables
- Drag table onto another to combine orders
- Split combined tables back apart
- Real-time events abstraction (prep for WebSockets)

**Acceptance Criteria:**
- [ ] SVG floor plan renders tables from database
- [ ] Tables show correct status colors
- [ ] Drag-to-combine triggers order merge
- [ ] Combined tables show merged name (T1+T2)
- [ ] Split option for combined tables
- [ ] APIs include locationId filtering
- [ ] Touch gestures work on iPad

---

### T016: Simulated Card Reader (Tap/Chip)
**Priority:** 🟡 High
**Estimated Effort:** Medium
**Skill:** 112
**Location:** `/src/components/payment/`, `/src/lib/mock-cards.ts`

**Requirements:**
- Two buttons at top of payment screen: "Tap Card" and "Chip Card"
- Mock database of 50+ fake card holders (names, last 4 digits, card types)
- Tap Card: Quick approval, NO customer name returned
- Chip Card: Approval with customer name, card type, last 4 digits
- Random delay (500-2000ms) to simulate real processing
- Occasional random decline (5% chance) for realism
- Only visible in dev mode or when `testMode: true` in settings

**Mock Card Data:**
- First/Last names (realistic mix)
- Card types: Visa, Mastercard, Amex, Discover
- Last 4 digits (random)
- Some cards flagged as "decline" for testing error flows

**Acceptance Criteria:**
- [ ] Tap Card button works (fast approval, no name)
- [ ] Chip Card button works (approval with customer name)
- [ ] Mock card database with 50+ entries
- [ ] Random processing delay feels realistic
- [ ] Occasional declines for testing
- [ ] Only shows in dev/test mode
- [ ] Integrates with existing payment flow

---

### T019: Floor Plan Overhaul - Seats, Sync & Multi-Room
**Priority:** 🔴 Critical
**Estimated Effort:** Large
**Status:** IN PROGRESS (Worker 3)
**Location:** `/src/components/floor-plan/`, `/src/app/(admin)/floor-plan/`, `/prisma/schema.prisma`

**Problems Identified:**
1. Seats disappearing randomly from tables
2. Table seat counts changing unexpectedly
3. Admin floor plan builder can't place seats in default locations
4. Admin (`/floor-plan`) and POS (`FloorPlanHome`) out of sync
5. No support for multiple rooms/floors (Main Dining, Patio, Bar, etc.)

**Scope - 4 Major Components:**

#### Part 1: Fix Seat Persistence & Stability (Critical)
- Investigate why seats disappear
- Check `isActive` flag and soft delete handling
- Ensure seat generation doesn't overwrite existing seats
- Add protection against accidental deletion
- Seats should NEVER disappear unless admin explicitly deletes

#### Part 2: Admin Floor Plan Builder - Default Seat Placement
- "Generate Default Seats" button per table (based on shape/capacity/pattern)
- Manual drag-and-drop seat positioning
- Quick-add seat at clicked position
- Click to select, drag to move, delete individual seats
- Visual preview of seat positions

#### Part 3: Multi-Room / Multi-Floor Support
- New `FloorPlanRoom` model in schema
- Room tabs in both admin and POS floor plans
- Tables assigned to rooms
- Room management: create, rename, reorder, delete
- Per-room canvas settings (width/height)

#### Part 4: Sync Admin & POS Floor Plans
- Both views use `includeSeats=true` (no N+1 queries)
- Consistent seat rendering logic
- Share common components where possible

**Schema Changes:**
```prisma
model FloorPlanRoom {
  id           String   @id @default(cuid())
  locationId   String
  name         String   // "Main Dining", "Patio", "Bar Area"
  sortOrder    Int      @default(0)
  isDefault    Boolean  @default(false)
  isActive     Boolean  @default(true)
  canvasWidth  Int      @default(800)
  canvasHeight Int      @default(600)
  tables       Table[]
  sections     Section[]
  location     Location @relation(...)
  // sync fields...
}
```

**Files to Create:**
- `/api/rooms/route.ts` - Room CRUD
- `/api/rooms/[id]/route.ts` - Single room operations
- `/src/components/floor-plan/RoomTabs.tsx` - Room selector
- `/src/components/floor-plan/SeatEditor.tsx` - Admin seat editing

**Files to Modify:**
- `prisma/schema.prisma` - Add FloorPlanRoom, update Table
- `/api/tables/route.ts` - Add roomId filter
- `/src/components/floor-plan/TableNode.tsx` - Fix seat rendering
- `/src/components/floor-plan/FloorPlanHome.tsx` - Add room support
- `/src/app/(admin)/floor-plan/page.tsx` - Add room management + seat editing

**Acceptance Criteria:**
- [ ] Seats persist reliably - no random disappearing
- [ ] Admin can generate default seats for any table
- [ ] Admin can manually place/move/delete individual seats
- [ ] FloorPlanRoom model added to schema
- [ ] Room tabs visible in admin floor plan builder
- [ ] Room tabs visible in POS floor plan
- [ ] Tables can be assigned to rooms
- [ ] Admin and POS show consistent seat data
- [ ] No N+1 queries for seats

**Priority Order:**
1. Fix seat persistence (critical - data loss issue)
2. Multi-room schema + basic UI
3. Admin seat placement tools
4. Sync improvements

---

### T027: Floor Plan Support - Admin Builder + Schema
**Priority:** 🔴 Critical
**Estimated Effort:** Medium
**Status:** IN PROGRESS (Worker 2)
**Location:** `/src/app/(admin)/floor-plan/`, `/prisma/schema.prisma`, `/api/rooms/`

**Context:** Worker 2 pivoted from T024 (Pizza Builder) to support floor plan fixes. Coordinates with Worker 3 (T019) - pick areas they're NOT working on.

**Option A: Fix Admin Floor Plan Builder**
- Fix N+1 seat queries (use `includeSeats=true` instead of per-table fetches)
- Verify seat generation works (`/api/tables/[id]/seats/auto-generate`)
- Ensure admin changes sync with POS FloorPlanHome
- Debug seat display issues in admin builder

**Option B: Multi-Room Schema + API**
- Add `FloorPlanRoom` model to schema
- Add `roomId` to Table and Section models
- Run migration
- Create `/api/rooms` CRUD endpoints
- Create `/api/rooms/[id]` single room operations

**Acceptance Criteria:**
- [ ] Admin floor plan shows seats correctly (no N+1 queries)
- [ ] OR: FloorPlanRoom schema added with migration
- [ ] OR: Room API endpoints created and working
- [ ] Coordinates with Worker 3, no duplicate effort

---

### T028: Production Database Safeguards
**Priority:** 🔴 Critical (Before Go-Live)
**Status:** BACKLOG
**Location:** Infrastructure, deployment scripts, CLAUDE.md

**Context:** Data loss occurred during dev session - modifier groups and hardware manually added by user were wiped when database was reset. This CANNOT happen in production.

**Root Cause:**
- `npm run reset` deletes all data and re-seeds
- Custom data (user-added modifiers, hardware) not in seed file
- Schema changes via `db:push` can be destructive

**Required Safeguards:**

#### Development Phase
- [ ] Add all custom modifiers to `seed.ts` so they survive resets
- [ ] Add sample hardware (printers, KDS) to `seed.ts`
- [ ] Update CLAUDE.md with stronger warnings about destructive commands
- [ ] Create `npm run db:safe-push` that backs up first

#### Production Deployment
- [ ] Block `npm run reset` in production (environment check)
- [ ] Migrations only - never `db:push` in production
- [ ] Pre-migration automatic backup
- [ ] Migration testing on staging before production
- [ ] Rollback scripts for every migration

#### Database Infrastructure
- [ ] PostgreSQL (not SQLite) for production - ACID compliance, point-in-time recovery
- [ ] Automated nightly backups with 30-day retention
- [ ] Read replica for real-time backup
- [ ] Monitoring alerts for failed backups
- [ ] Disaster recovery runbook

#### Operational
- [ ] Soft deletes only - never hard delete (`deletedAt` field)
- [ ] Audit log for all data modifications
- [ ] Data export capability for compliance

**Acceptance Criteria:**
- [ ] Cannot run `reset` in production environment
- [ ] Every migration auto-backs up first
- [ ] Seed file includes all standard data (modifiers, sample hardware)
- [ ] PostgreSQL configured with point-in-time recovery
- [ ] Documented disaster recovery procedure

---

### T034: Seat Assignment for Table Orders
**Priority:** 🔴 Critical
**Estimated Effort:** Medium
**Status:** IN PROGRESS (Worker 1)
**Location:** `/src/components/orders/`, `/src/app/api/`, KDS components

**Overview:**
When a table is selected for ordering, automatically show seat buttons on the left side of the order panel. Servers tap a seat to assign menu items to that guest.

**Requirements:**

#### 1. Seat Buttons (Left Side of Order Panel)
- When table selected, show seat buttons based on table's seat count
- Small, easy-to-click buttons: "1", "2", "3", etc.
- Tapping a seat makes it "active" - subsequent items added go to that seat
- Visual indicator for active seat (highlighted/selected state)
- Default to "No Seat" or "Shared" for items not assigned to specific guest

#### 2. Combined Tables - Sequential Numbering
- Table 1 (4 seats) + Table 2 (4 seats) = Seats 1-8
- Table 1 (4) + Table 2 (4) + Table 3 (6) = Seats 1-14
- Numbering flows sequentially across all combined tables

#### 3. Combined Table Header
- Show "Combined (2 Tables)" or "2 Tables Combined" instead of "Table 1 + Table 2"
- Keep it short and clear

#### 4. Order Items Display
- Show seat number next to each item: "Seat 3: Burger"
- Group by seat in order panel for easy review
- Items with no seat show as "Shared" or at the end

#### 5. KDS & Printer Integration
- Seat assignments print on kitchen tickets: "Seat 1: Steak Med-Rare"
- KDS displays seat numbers with each item
- Combined table info shows on ticket header

**Schema Reference:**
- `OrderItem.seatId` - links item to specific seat
- `Seat.seatNumber` - the seat number
- `Table.combinedWithId` / `combinedTableIds` - combined table tracking

**Files to Modify:**
- Order panel component (where items are displayed)
- Add items flow (assign seatId when adding)
- KDS ticket rendering
- Print ticket generation

**Acceptance Criteria:**
- [ ] Seat buttons appear when table with seats is selected
- [ ] Tapping seat makes it active for item assignment
- [ ] Combined tables show sequential seat numbering
- [ ] Combined tables labeled clearly (e.g., "Combined 2")
- [ ] Order items grouped/labeled by seat
- [ ] KDS shows seat assignments
- [ ] Printed tickets show seat assignments

---

### T035: Server Personalization (Quick Bar + Button Colors)
**Priority:** 🟡 High
**Estimated Effort:** Medium
**Status:** IN PROGRESS (Worker 1)
**Location:** `/src/components/floor-plan/`, `/src/components/orders/`

**Overview:**
Each server can personalize their POS interface with a quick-access favorites row and custom button colors. Settings save per employee.

**1. Quick Access Bar (Personal Favorites Row)**
- New row above the main category bar (Food/Bar)
- Server populates with most-used items
- Right-click (or long-press on touch) menu item → "Add to Quick Bar"
- Items appear as small buttons in personal quick bar
- Can reorder and remove items
- Limit: 10-15 items max
- Saves to `Employee.posLayoutSettings.quickBar: string[]`

**2. Button Color Customization**
- Existing infrastructure: `Employee.posLayoutSettings.categoryColors` and `menuItemColors`
- Make color picker more accessible (gear menu → "Customize Colors")
- Category buttons: background, text, selected state colors
- Menu item buttons: background, text, glow/pop effects
- Simple color palette + custom picker
- Match glassmorphism design aesthetic

**Acceptance Criteria:**
- [ ] Quick access bar appears above category bar
- [ ] Right-click item → "Add to Quick Bar" works
- [ ] Quick bar items clickable to add to order
- [ ] Can remove items from quick bar
- [ ] Quick bar saves per employee
- [ ] Color customization accessible via gear menu
- [ ] Can change category/item button colors
- [ ] All settings persist per employee

---

### T024: Pizza Builder Integration (PAUSED)
**Priority:** 🟡 High
**Status:** PAUSED - Floor plan fixes take priority
**Will Resume:** After T019 and T027 complete

**Original Scope:**
- Click pizza menu item → opens pizza builder modal
- Integration between menu items and visual builder
- Quick mode vs Visual mode selection

**Reason for Pause:** Pizza builder has issues but floor plan/seating is more critical foundation work.

---

## Completed Tasks

| ID | Task | Completed | Notes |
|----|------|-----------|-------|
| - | Add sync fields to schema | 2026-01-30 | 80 tables updated |
| - | Update CLAUDE.md | 2026-01-30 | Architecture added |
| - | Update SKILLS-INDEX.md | 2026-01-30 | Status updated |
| - | Create GWI-ARCHITECTURE.md | 2026-01-30 | Full doc created |
| T002 | Create PAYMENT-PROCESSING.md | 2026-01-30 | 1,156 lines, processor-agnostic (no Stripe) |
| T001 | Create OFFLINE-SYNC-ALGORITHM.md | 2026-01-30 | Full algorithm, bidirectional customer sync, super admin manual trigger |
| T015 | Interactive Floor Plan + Table Combine | 2026-01-30 | Skills 106/107, SVG floor plan, drag-combine, split, 30s undo |
| T003 | Consolidate REQUIREMENTS.md | 2026-01-30 | Merged 831+687 lines → 1,021 lines, deleted root duplicate |
| T016 | Simulated Card Reader (Tap/Chip) | 2026-01-30 | Skill 112, 55 mock cards, tap/chip behavior, DEV mode only |
| T004 | Create API-REFERENCE.md | 2026-01-30 | 40+ endpoints, 25 domains, full request/response docs |
| T018 | Super Admin Role + Dev Access | 2026-01-30 | PIN 0000, dev.access permission, DEV badge, gates SimulatedCardReader |
| T005 | Create ERROR-HANDLING-STANDARDS.md | 2026-01-30 | 25 domains, 100+ error codes, retry patterns, PCI logging |
| T006 | Create TESTING-STRATEGY.md | 2026-01-30 | Unit/integration/E2E patterns, 5 critical paths, CI/CD workflow, 75% coverage goal |
| T007 | Update BUILD-PLAN.md for SQLite reality | 2026-01-30 | v2.0, hybrid architecture, Docker configs, 85% Phase 1 complete |
| T008 | Add headers to skill files | 2026-01-30 | Only 3 files exist (102-104), all updated with YAML frontmatter |
| T010 | Implement Socket.io for real-time | 2026-01-30 | Provider-agnostic events system, 15+ event types, React hooks, Skill 110 |
| T009 | Create DATABASE-REFERENCE.md | 2026-01-30 | 78 tables, 28 domains, full field docs, query patterns |
| T012 | Implement check splitting | 2026-01-30 | 5 split types, added Split by Seat, Skill 014 docs |
| T013 | Implement coursing system | 2026-01-30 | Full coursing: 5 components, KDS integration, auto/manual modes |
| T014 | Build local server Docker config | 2026-01-30 | SQLite + PostgreSQL options, Watchtower, systemd, backup/restore |
| T021 | Visual Pizza Builder (Skill 109) | 2026-01-30 | Quick + Visual modes, mode switching, SVG canvas |
| T020 | Event Ticketing APIs (Skill 108) | 2026-01-30 | Full API: tiers, tables, holds, purchase, check-in, refunds |
| T022 | Pizza Seed Data (Full Menu) | 2026-01-30 | 6 sizes, 6 crusts, 8 sauces, 8 cheeses, 50 toppings, 13 specialties |
| T017 | Floor Plan Premium UI Overhaul | 2026-01-30 | Dark theme, glows, glassmorphism, Framer Motion |
| T034 | Seat Assignment for Table Orders | 2026-01-30 | Seat buttons, combined table numbering, KDS/print integration |
| T037 | FloorPlanHome Fixes | 2026-01-30 | PaymentModal hooks fix, ReceiptModal after payment, order auto-clear, CSS fixes |
| T040 | Explicit Input→Output Model (Skill 126) | 2026-02-02 | Split editor (Prep/Inventory), unit system, conversions, cost API |

---

### T036: Closed Order Management (Skill 114)
**Priority:** 🟡 High
**Estimated Effort:** Large
**Status:** 🟡 READY
**Location:** `/src/components/orders/`, `/src/app/api/orders/`

**Requirements:**
- View closed/paid orders with search/filter (date, server, table, order number)
- Full order detail view for closed orders
- Void payments (manager PIN required)
- Adjust tips after order is closed
- Reprint receipts for closed orders
- Reopen closed orders with reason tracking

**Acceptance Criteria:**
- [ ] Closed orders list accessible from POS
- [ ] Search by date range, server, table, order number
- [ ] View full details of any closed order
- [ ] Void payment requires manager PIN
- [ ] Tip adjustment with audit log
- [ ] Reprint receipt for any closed order
- [ ] Reopen order with reason selection

---

### T039: Inventory & Recipe Costing System (Skill 115)
**Priority:** 🔴 Critical (Foundation)
**Estimated Effort:** X-Large
**Status:** 🟡 READY
**Location:** `/src/app/api/inventory/`, `/docs/skills/115-INVENTORY-RECIPE-COSTING.md`

**Overview:**
Comprehensive inventory management tracking food and liquor at the ingredient level. Calculates theoretical vs actual usage, provides variance reporting, and eliminates need for third-party tools like MarginEdge or Restaurant365 (while supporting API exports to them).

**Key Features:**
1. **InventoryItem** - Unified system for food, liquor, beer, wine, supplies
2. **PrepItem** - Derived items with yield tracking (chicken → shredded chicken)
3. **MenuItemRecipe** - Link menu items to ingredients with quantities/costs
4. **Modifier Inventory Links** - Track ingredient usage from modifiers
5. **Void Integration** - "Was it made?" question for waste tracking
6. **Waste Log** - Standalone waste logging for spoilage, spills, etc.
7. **Invoice Entry** - Auto-update costs and inventory from invoices
8. **Inventory Counts** - Configurable counting (daily/weekly/monthly, by area)
9. **Variance Reports** - Theoretical vs actual usage comparison
10. **P-Mix Reports** - Product mix with food cost % and margins
11. **API Exports** - Send data to MarginEdge, R365, etc.

**Implementation Phases:**
1. Schema + InventoryItem CRUD
2. PrepItem + yield tracking
3. MenuItemRecipe builder
4. Modifier → Inventory linking
5. Void integration + Waste log
6. Invoice entry + cost updates
7. Inventory counts
8. Reports (variance, P-mix, waste)
9. Third-party API exports

**Schema Changes:**
- New: `InventoryItem`, `PrepItem`, `PrepItemIngredient`, `MenuItemRecipe`, `MenuItemRecipeIngredient`
- New: `ModifierInventoryLink`, `InventoryCount`, `InventoryCountItem`, `InventoryItemTransaction`
- New: `Vendor`, `Invoice`, `InvoiceLineItem`, `WasteLogEntry`, `InventorySettings`
- Update: `Modifier` - add `isLabel` and relation to `ModifierInventoryLink`

**Acceptance Criteria:**
- [ ] Schema migration successful
- [ ] Can create/manage inventory items with costs and units
- [ ] Can create prep items with yield tracking
- [ ] Can build recipes for menu items with auto-cost calculation
- [ ] Can link modifiers to inventory items
- [ ] Void flow asks "Was it made?" and logs waste
- [ ] Can enter invoices and auto-update costs
- [ ] Can perform inventory counts with variance calculation
- [ ] Theoretical usage report calculates from sales data
- [ ] Variance report shows actual vs theoretical with $ impact
- [ ] P-mix report shows product mix with margins
- [ ] Can export data via API to third-party systems

**Full Specification:** See `/docs/skills/115-INVENTORY-RECIPE-COSTING.md`

---

## Backlog (Future Sprints)

### Infrastructure
- [ ] Real-time events with Pusher/Ably (Skill 110)
- [ ] SQLite → PostgreSQL migration
- [ ] Redis cache layer
- [ ] Build local server Docker config
- [ ] T028: Production Database Safeguards (CRITICAL for go-live)

### Features
- [x] Event Ticketing APIs (Skill 108) → T020
- [x] Visual Pizza Builder (Skill 109) → T021
- [ ] Training Mode (Skill 111) — Sandbox with temp DB for server training
- [ ] Simulated Card Reader (Skill 112) — Dev tap/chip simulation
- [ ] Build online ordering module
- [ ] Create mobile PWA device pairing
- [ ] Implement buzzer/pager integration
- [ ] Create host management module
- [ ] Build live dashboard
- [ ] T029: Event Ticketing UI + Seat Selection (Phase 2)

### Ticketing & Reservations (Phase 2)
- [ ] T029: Event Ticketing UI — Floor plan seat picker for ticket buyers
- [ ] T030: Real-time Seat Availability — Pusher/Ably integration for live updates
- [ ] T031: Reservation System — Table reservations with time slots
- [ ] T032: Ticketing Modes — per_seat, per_table, general_admission, hybrid
- [ ] T033: Tiered Pricing UI — Premium/standard/accessible seat pricing

---
---

## Session Notes: 2026-01-30 Late Night (Seat Numbering & Undo)

### T019 Progress - Major Fixes Implemented

**Seat Numbering:**
- Seat 1 now starts at top-left corner (was center of top edge)
- Circle tables start seat 1 at top-left (10:30 position)
- Combined tables number seats 1-N clockwise around entire group
- Seats sorted by clockwise angle from top-left before assigning labels

**Table Positioning:**
- Tables now attach flush (edge-to-edge) instead of centering
- Top/bottom attachment now works (was only left/right)
- Ghost preview matches final position (uses combined bounding box)

**Undo Functionality:**
- New endpoint: `/api/tables/[id]/remove-from-group`
- Removes only the last table added to a combined group (not all tables)
- Restores original position, name, and seat positions
- Extended undo window from 30 seconds to 5 minutes

**Split Fixes:**
- Seats restore to original positions after split
- Fixed unique constraint error (don't change seatNumber, only restore positions)

**Files Modified (10+):**
- `/src/app/api/tables/route.ts`
- `/src/app/api/tables/[id]/route.ts`
- `/src/app/api/tables/[id]/seats/auto-generate/route.ts`
- `/src/app/api/tables/seats/generate-all/route.ts`
- `/src/app/api/tables/combine/route.ts`
- `/src/app/api/tables/[id]/split/route.ts`
- `/src/app/api/tables/[id]/remove-from-group/route.ts` (NEW)
- `/src/components/floor-plan/table-positioning.ts`
- `/src/components/floor-plan/TableNode.tsx`
- `/src/components/floor-plan/FloorPlanHome.tsx`
- `/src/components/floor-plan/use-floor-plan.ts`

---

*Last Updated: January 30, 2026 (End of Day)*
*Workers Active: 0*
*Tasks Completed Today: 21 (including T037)*
*Tasks In Progress: 2 (T019, T035)*
*Tasks Paused: 2 (T023 - Floor Plan Home, T024 - Pizza Builder)*
*Next Session Priority: T025 (Bar Tabs UI), T036 (Closed Order Management)*
