# AGENT_BRAIN.md - Team Reference Document

> Generated: 2026-02-08 | Source: Repository scan of GWI POS (ThePulsePOS)

## Tech Stack & Patterns

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 16.1.5 (App Router) | `src/app/` with route groups |
| React | 19.2.3 | Latest with server components |
| Language | TypeScript 5.9.3 | Strict mode |
| Styling | Tailwind CSS 4.x | Glassmorphism theme (blue=bar, orange=food) |
| ORM | Prisma 6.19.2 | SQLite dev, PostgreSQL planned for prod |
| State | Zustand 5.x | 4 stores: auth, order, toast, dev |
| Validation | Zod 4.x | API input validation |
| Realtime | Socket.io 4.8.3 | Server + client for KDS, menu sync |
| Canvas | Konva / React-Konva | Floor plan rendering |
| DnD | @dnd-kit | Sortable lists (menu, categories) |
| Payments | Datacap (Tran Cloud) | EMV + simulated mode |
| SMS | Twilio | Remote void approvals |
| PDF | PDFKit | Reports |
| Testing | Playwright | E2E tests |
| Animation | Framer Motion | UI transitions |

### Key Patterns
- **API**: Next.js Route Handlers (`src/app/api/`), returns `{ data }` or `{ error }`.
- **Multi-tenancy**: Every query filters by `locationId`. Every model (except Organization/Location) has `locationId`.
- **Soft deletes**: `deletedAt` field, never hard delete. All queries add `deletedAt: null`.
- **Sync fields**: `deletedAt` + `syncedAt` on every model for future cloud sync.
- **Toast notifications**: `toast.success/error/warning/info` from `@/stores/toast-store`.
- **Socket dispatch**: Fire-and-forget pattern via internal API (`/api/internal/socket/broadcast`).
- **Order API separation**: PUT = metadata only, POST `/items` = add items (prevents race conditions).

## Folder Map

```
src/
├── app/                    # Next.js App Router
│   ├── (admin)/            # Admin pages (menu, employees, reports, settings, inventory...)
│   ├── (auth)/             # Login (PIN-based)
│   ├── (cfd)/              # Customer-facing display
│   ├── (kds)/              # Kitchen display system
│   ├── (mobile)/           # Mobile bartender views
│   ├── (pos)/              # POS screens (orders, tabs, tips, pay-at-table)
│   ├── (public)/           # Public-facing (approve-void)
│   └── api/                # ~60 API route groups (orders, menu, payments, hardware...)
├── bridges/                # Cross-domain integration (13 bridge files)
├── components/             # UI components (~26 feature directories)
├── contexts/               # React contexts
├── domains/                # Domain modules (employee, events, financial, floor-plan, guest, hardware, inventory, menu, order-management, reporting)
├── hooks/                  # 18 custom hooks (useActiveOrder, useDatacap, usePOSLayout...)
├── lib/                    # Utilities (~60 files: DB, calculations, ESC/POS, payments, socket...)
├── shared/                 # Shared utilities
├── stores/                 # Zustand stores (auth, order, toast, dev)
└── types/                  # TypeScript types (13 type files)
```

## Key Entry Points

| What | Path |
|------|------|
| App root/layout | `src/app/layout.tsx` |
| POS orders page | `src/app/(pos)/orders/page.tsx` |
| Floor plan (primary UI) | `src/components/floor-plan/FloorPlanHome.tsx` |
| DB client | `src/lib/db.ts` |
| Schema | `prisma/schema.prisma` (126 models) |
| Seed data | `prisma/seed.ts` |
| Order store | `src/stores/order-store.ts` |
| Auth store | `src/stores/auth-store.ts` |
| Order calculations | `src/lib/order-calculations.ts` |
| Inventory deductions | `src/lib/inventory-calculations.ts` |
| Socket server | `src/lib/socket-server.ts` |
| Socket dispatch | `src/lib/socket-dispatch.ts` |
| Payment processing | `src/lib/payment.ts`, `src/hooks/useDatacap.ts` |

## Domain Map

### Core Models & Relationships

```
Organization → Location (multi-tenant root)
  ├── Employee (PIN auth, roles, permissions)
  ├── Category → MenuItem (food, drinks, liquor, entertainment, combos, retail)
  │     ├── ModifierGroup → Modifier (item-owned, nested via childModifierGroupId)
  │     ├── Pour sizes (shot, double, tall, short with price multipliers)
  │     └── Recipes → Ingredients → InventoryItem (for deductions)
  ├── Order → OrderItem → OrderItemModifier
  │     ├── Payment (cash, card via Datacap)
  │     ├── OrderDiscount
  │     ├── VoidLog / CompVoidModal
  │     └── OrderCard (pre-auth for tabs)
  ├── Table → Seat (floor plan, virtual combine groups)
  ├── Shift → Drawer → PaidInOut
  ├── TipOutRule → TipShare
  ├── KDSScreen → Station (tag-based routing)
  └── Printer → PrintRoute (ESC/POS thermal + impact)
```

### Order Lifecycle
1. Create order (POST `/api/orders`) with orderType
2. Add items (POST `/api/orders/[id]/items`)
3. Send to kitchen (POST `/api/orders/[id]/send`)
4. Pay (POST `/api/orders/[id]/pay`) -- triggers inventory deduction
5. Void/Comp (POST `/api/orders/[id]/comp-void`) -- triggers waste tracking

### Payment Flow
- **Quick Pay**: Ring up -> card tap -> tip -> done
- **Bar Tab**: Pre-auth card -> add items -> close tab (capture)
- **Dine-in**: Order -> send -> pay (cash/card/split)
- **Datacap**: EMVSale, PreAuth, PreAuthCapture, AdjustByRecordNo, VoidSaleByRecordNo

## UI Playbook

### Design System
- **Glassmorphism**: Frosted glass panels with `backdrop-blur`, soft gradients
- **Themes**: Blue gradient (bar mode), orange gradient (food mode)
- **Touch-first**: Large tap targets for iPad/tablet POS
- **Animations**: Framer Motion transitions, pulse/shimmer/rainbow/neon effects on items

### Key UI Components
| Component | Location | Purpose |
|-----------|----------|---------|
| FloorPlanHome | `components/floor-plan/` | Primary POS view (tables + inline ordering) |
| OrderPanel | `components/orders/` | Order items list with controls |
| ModifierModal | `components/orders/` | Modifier selection flow |
| PaymentModal | `components/payment/` | Cash/card/split payment |
| CompVoidModal | `components/orders/` | Void/comp with manager approval |
| ItemEditor | `components/menu/` | Menu builder item editing |
| BartenderView | `components/bartender/` | Bar-focused ordering UI |
| KDS pages | `app/(kds)/` | Kitchen display screens |

### Personalization (per-employee, localStorage)
- Category button colors (selected/unselected bg + text)
- Menu item styling (bg, text, glow, border, effects)
- Quick Pick number strip toggle

## Tool & Skill Inventory

Located at `.claude/commands/` -- 55 skill/command files covering:
- Domain operations (floor-plan, inventory, menu-builder, etc.)
- Workflows (backup-restore, employees, shifts, etc.)
- Features (cocktail-recipe, combo-meals, entertainment-sessions, etc.)
- Admin (hardware-printers, print-routing, tax-rules, etc.)

Full index at `docs/skills/SKILLS-INDEX.md`.

## Safety-Critical Paths

| Area | Key Files | Risk |
|------|-----------|------|
| Payment processing | `src/lib/payment.ts`, `src/hooks/useDatacap.ts`, `src/lib/datacap/` | Money movement |
| Void/Comp | `src/app/api/orders/[id]/comp-void/route.ts`, `CompVoidModal` | Revenue loss, requires manager PIN |
| Remote void SMS | `src/lib/twilio.ts`, `src/app/api/voids/remote-approval/` | SMS-based approval codes |
| Inventory deductions | `src/lib/inventory-calculations.ts` | Stock accuracy, cost tracking |
| Order totals | `src/lib/order-calculations.ts` | Tax, subtotal, tip accuracy |
| Tip distribution | `TipOutRule`, `TipShare`, `/api/reports/tip-shares` | Employee compensation |
| Auth/PIN | `src/lib/auth.ts`, `src/stores/auth-store.ts` | Access control |
| Pre-auth/capture | Datacap PreAuth flow, `OrderCard` model | Card hold management |
| DB operations | `src/lib/db.ts`, all API routes | Data integrity, multi-tenancy |

## Known Issues & TODOs (from CLAUDE.md)

### Priority Items
1. **POS UI Lift** - ModifierModal redesign, item selection UX, glassmorphism consistency
2. **Bar Tabs** - Pre-auth capture, tab transfer/merge, improved tab list UI
3. **Closed Orders** - View/search closed orders, void payments, reopen
4. **Kitchen/Print** - Actually send tickets to printers (currently stubbed)
5. **Tip Guide Basis** - Tips calculated on net total instead of pre-discount
6. **Inventory Unification** - Liquor + food deduction engines run separately
7. **Tag-Based Routing** - PrintTemplateFactory, PitBossDashboard incomplete
8. **Table Capacity Sync** - `Table.capacity` can drift from actual seat count

### Database: 126 Prisma Models
SQLite for development. Migration to PostgreSQL required for production (ACID, recovery, concurrency).

### Branch State
Current branch: `fix-001-modifier-normalization`
Recent commits focus on: void/comp stamps, BartenderView integration, OrderPanel unification, reopened order tracking.

---

## Roles & Permissions System (Task #6)

### Schema
- **Role** model: `id`, `locationId`, `name`, `permissions` (JSON array of permission strings), `isTipped`
  - Unique constraint: `[locationId, name]`
  - Relations: `employees[]`, `tipOutRulesFrom[]`, `tipOutRulesTo[]`, `scheduledShifts[]`
- **Employee** model: `roleId` -> `Role` (single role per employee). Employee has PIN (hashed), optional password.
- No separate Permission model -- permissions are string arrays stored as JSON on Role.

### Permission Architecture
- **93 defined permission keys** in `src/lib/auth-utils.ts` (`PERMISSIONS` constant)
- Organized into 10 groups: POS Access (13), Manager (20), Reports (14), Menu (6), Staff (7), Tables (4), Settings (6), Tips (6), Inventory (7), Customers (5), Events (2), Scheduling (2), Payroll (2), Admin Levels (3)
- Wildcard support: `pos.*` matches all `pos.xxx` permissions; `admin` and `super_admin` grant all permissions
- 5 default role templates: Server, Bartender, Manager, Admin (`admin`), Owner (`super_admin`)

### How Permissions Are Checked
- **`hasPermission(permissions[], requiredPermission)`** in `src/lib/auth-utils.ts` -- client-safe utility
- Supports: exact match, wildcard (`pos.*`), and admin/super_admin bypass
- Helper functions: `isSuperAdmin()`, `isAdmin()`

### Auth Flow
1. Employee enters PIN at `/login`
2. `authenticateEmployee()` in `src/lib/auth.ts` iterates all active employees for location, compares PIN with bcrypt
3. Returns employee with role and permissions array
4. Stored in Zustand `auth-store` (persisted to localStorage, but only `locationId` is persisted -- auth data is session-only)

### Where Permissions Are Enforced
**Client-side only** (12 files). `hasPermission()` is used in:
- `AdminNav.tsx` -- menu visibility
- `ClosedOrderActionsModal.tsx` -- void payment button
- `ShiftCloseoutModal.tsx` -- cash drawer access level
- `TimeClockModal.tsx` -- clock others
- `src/app/(admin)/reports/page.tsx` -- report access
- `src/app/(admin)/roles/page.tsx` -- role management
- `src/app/(admin)/settings/page.tsx` -- settings access

**No server-side middleware**: API routes do NOT check permissions. Any authenticated client can call any API endpoint.

### API Routes
- `GET /api/roles?locationId=` -- list roles with employee count + available permissions
- `POST /api/roles` -- create role with name + permissions array
- `GET/PUT/DELETE /api/roles/[id]` -- CRUD single role

### Gaps
- **No server-side auth middleware** -- all permission checks are client-side only
- **No API authentication** -- routes don't verify who is calling them
- **Single role per employee** -- no multi-role support
- **No audit trail for permission changes**

---

## Shifts, Clock-In, Breaks (Task #7)

### Models

**TimeClockEntry**: Basic clock in/out with break tracking
- Fields: `clockIn`, `clockOut`, `breakStart`, `breakEnd`, `breakMinutes`, `regularHours`, `overtimeHours`
- `drawerCountIn`/`drawerCountOut` (JSON) for cash drawer counts
- Indexes on `locationId`, `employeeId`, `clockIn`

**Shift**: Higher-level shift record with financial summary
- Fields: `startedAt`, `endedAt`, `startingCash`, `expectedCash`, `actualCash`, `variance`
- Sales: `totalSales`, `cashSales`, `cardSales`, `tipsDeclared`
- Tips: `grossTips`, `tipOutTotal`, `netTips`
- Status: `open` | `closed`
- Relations: `tipShares[]`

**Break**: Separate model linked to TimeClockEntry
- Fields: `breakType` (paid/unpaid/meal), `startedAt`, `endedAt`, `duration` (minutes), `status` (active/completed)

**Drawer**: Named cash drawers linked to terminals
- Fields: `name`, `deviceId`, `isActive`
- Relations: `paidInOuts[]`

### API Routes
- `GET /api/shifts?locationId=&employeeId=&status=&startDate=&endDate=` -- list shifts with filters
- `POST /api/shifts` -- open shift (exists but not fully read)
- `GET/PUT /api/shifts/[id]` -- shift details/close
- `GET/POST /api/time-clock/` -- clock in/out
- `GET/POST /api/breaks/` -- break management

### Status: Functional but basic. Clock in/out, break tracking, and shift closeout with cash counting all exist.

---

## Split Payment System

### API: `POST /api/orders/[id]/split`

**Split types supported:**
- `even` -- split by number of ways
- `by_item` -- assign specific items to a sub-order
- `by_seat` -- split by seat assignment
- `by_table` -- split by table (for combined tables)
- `custom_amount` -- arbitrary dollar amount split
- `get_splits` -- retrieve existing splits

**Architecture:** Creates child `Order` records via `parentOrderId` relationship. Each split becomes a separate payable order.

### Status: Implemented. Supports all major split types.

---

## Transfer & Merge

### Transfer Items: `POST /api/orders/[id]/transfer-items`
- Moves specific `itemIds` from source order to `toOrderId`
- Recalculates totals on both orders
- Requires `employeeId` for audit

### Merge Orders: `POST /api/orders/[id]/merge`
- Merges `sourceOrderId` into target order
- All items move to target, source order closed
- Requires `employeeId`

### Status: Both implemented and functional.

---

## Printing & Station System

### Two Parallel Systems

**Legacy: Printer model**
- Fields: `name`, `printerType` (thermal/impact), `model`, `ipAddress`, `port`, `printerRole` (receipt/kitchen/bar), `isDefault`, `paperWidth`, `printSettings` (JSON)
- Relations: `printJobs[]`, `printRules[]`, `terminals[]`
- Unique: `[locationId, name]`

**New: Station model (Unified Routing Engine)**
- Tag-based pub/sub routing -- items with matching tags route to stations
- `type`: PRINTER or KDS
- `tags` (JSON array): e.g., `["pizza", "made-to-order"]`, `["grill"]`
- `isExpo`: receives ALL items regardless of tags
- `templateType`: STANDARD_KITCHEN, PIZZA_STATION, EXPO_SUMMARY, ENTERTAINMENT_TICKET, BAR_TICKET
- Printer-specific: `printerType`, `printerModel`, `paperWidth`, `printSettings`, `atomicPrintConfig`
- KDS-specific: `columns`, `fontSize`, `colorScheme`, `agingWarning`, `lateWarning`, `playSound`, `flashOnNew`
- `showReferenceItems`: shows other items in order going to different stations
- Backup/failover: `backupStationId`, `failoverTimeout`

**KDSScreen model**: Display configuration with device pairing
- Device auth: `deviceToken`, `pairingCode`, `pairingCodeExpiresAt`, `isPaired`
- Static IP binding: `staticIp`, `enforceStaticIp`
- Relations: `stations[]` via `KDSScreenStation` junction, `printRules[]`

**KDSScreenStation**: Junction linking KDSScreen to PrepStation (not Station model -- note: references `PrepStation`, not the unified `Station`)

### Status
- **Printer model**: Exists, configured via `/settings/hardware`
- **Station model**: Schema complete, routing logic in `src/lib/order-router.ts`
- **Actual printing**: STUBBED -- kitchen ticket dispatch not wired to real printers yet
- **KDS display**: Working via Socket.io
- **PrintTemplateFactory**: Not yet implemented (listed in TODOs)
- **Tag-based routing**: Schema + router exist, but print dispatch not connected

### Key Gap
The Station model and OrderRouter exist but the final step -- actually generating ESC/POS bytes and sending them to printers via TCP -- is not connected. The `src/lib/escpos/` directory has command definitions and document builders, and `src/lib/printer-connection.ts` has TCP socket code, but the send-to-kitchen route doesn't invoke them.

---

## Skill Doc Audit (Task #8)

### Overview
- **131 skill doc files** in `docs/skills/`
- **155 skills** tracked in SKILLS-INDEX.md (135 DONE, 7 PARTIAL, 13 TODO)
- **Two numbering systems** that conflict (see below)

### Critical Finding: Dual Numbering Systems

The early docs (01-60) use a **feature-spec numbering** that does NOT match SKILLS-INDEX.md:

| Doc File | Doc Title | Index Skill # | Index Title |
|----------|-----------|---------------|-------------|
| `01-CUSTOMER-EXPERIENCE.md` | Customer Experience (Planning) | 01 | Employee Management (DONE) |
| `02-OPERATOR-EXPERIENCE.md` | Operator Experience (Planning) | 02 | Quick Order Entry (DONE) |
| `03-MENU-PROGRAMMING.md` | Menu Programming (Planning) | 03 | Menu Display (DONE) |
| `39-BUZZER-SYSTEM.md` | Buzzer/Alert System (Planning) | 39 | Low Stock Alerts (DONE) |
| `40-BOUNCER-DOOR.md` | Bouncer/Door Management (Planning) | 40 | Menu Scheduling (DONE) |

The early docs (01-60) are **aspirational feature specs** (status: "Planning") written before development. They describe future vision, not current implementation. The SKILLS-INDEX.md tracks actual implementation with completely different numbering.

### Index vs Reality Discrepancies

| Skill | Index Status | Actual Status | Notes |
|-------|-------------|---------------|-------|
| 109 | TODO | **DONE** | Pizza builder code exists: `src/components/pizza/`, `src/app/api/pizza/`, admin page |
| 109 doc | Says DONE | Code exists | Doc is accurate, index is wrong |
| 238 | PARTIAL | PARTIAL | Correct -- needs verification |

### Skills Missing Doc Files (DONE in index, no dedicated doc)

| Skill # | Name | Status in Index |
|---------|------|----------------|
| 230 | Quick Pick Numbers | DONE |
| 231 | Per-Item Delays | DONE |
| 232 | Note Edit Modal | DONE |
| 233 | Modifier Depth Indentation | DONE |
| 234 | Shared OrderPanel Items Hook | DONE |
| 108 | Event Ticketing APIs | TODO (no doc needed yet) |
| 112 | Simulated Card Reader | DONE |
| 113 | FloorPlanHome Integration | DONE |
| 114 | Closed Order Management | TODO |
| 115 | Hardware Status Dashboard | TODO |

### Skill Docs That Are Obsolete or Aspirational-Only

These docs (01-60 range) are **planning-only feature specs** with no matching implementation. They describe future/aspirational features:

| Doc | Title | Status |
|-----|-------|--------|
| `01-CUSTOMER-EXPERIENCE.md` | Customer-facing display vision | Planning (partially done as Skill 218 CFD) |
| `02-OPERATOR-EXPERIENCE.md` | POS operator workflow vision | Planning (largely implemented organically) |
| `21-STAFF-TRAINING.md` | Staff training mode | Planning (Skill 111 covers this) |
| `22-LIVE-DASHBOARD.md` | Live monitoring dashboard | Planning |
| `23-ONLINE-ORDERING.md` | Online ordering | Planning |
| `26-HOST-MANAGEMENT.md` | Host stand management | Planning |
| `34-DEVICE-MANAGEMENT.md` | Device provisioning | Planning |
| `35-DELIVERY-TRACKING.md` | Delivery driver tracking | Planning |
| `39-BUZZER-SYSTEM.md` | Customer pager/buzzer | Planning |
| `40-BOUNCER-DOOR.md` | Bouncer/door management | Planning |
| `42-LOCAL-SERVER.md` | Local server deployment | Planning |
| `43-CUSTOM-MENUS.md` | Custom menu layouts | Planning |
| `49-UNIFI-NETWORK.md` | UniFi network integration | Planning |
| `54-QR-SELF-ORDERING.md` | QR code self-ordering | Planning |
| `56-INVOICING.md` | Invoice generation | Planning |
| `57-HOTEL-PMS.md` | Hotel PMS integration | Planning |

### Skill Docs That Need Updating

| Doc | Issue |
|-----|-------|
| `110-REALTIME-EVENTS.md` | Says PARTIAL, but Socket.io is fully implemented (Skills 201-202). Pusher/Ably abstraction abandoned. |
| `111-DOCKER-DEPLOYMENT.md` | Planning doc, but Docker deployment architecture is described in CLAUDE.md already |
| `109-VISUAL-PIZZA-BUILDER.md` | Says DONE in doc, but index says TODO. Code exists. Index needs update. |
| `116-DRAG-ITEM-TO-SEAT.md` | TODO in both doc and index. Correct, but could note that seat ordering exists via Skill 121. |

### Implemented Features Without Any Skill Doc

| Feature | Code Location | Notes |
|---------|--------------|-------|
| Error Reporting/Monitoring | `src/app/(admin)/monitoring/`, `src/lib/error-capture.ts` | Domain 16 documented in CLAUDE.md but no skill doc |
| Multi-location monitoring | `docs/TODO-MULTI-LOCATION-MONITORING.md` | TODO doc exists but no skill number |
| Order types config | `src/app/(admin)/settings/order-types/` | Documented in CLAUDE.md, no skill doc |
| Payroll system | `src/app/(admin)/payroll/`, `src/lib/payroll/` | Full payroll with tax calculations, no skill doc |
| Scheduling | `src/app/(admin)/scheduling/` | Employee scheduling, no skill doc |
| Glassmorphism UI theme | Throughout components | Documented in CLAUDE.md, no skill doc |
| POS Personalization (colors/effects) | `Employee.posLayoutSettings` | Documented in CLAUDE.md, no skill doc |

### Summary Recommendations

1. **Fix index entry for Skill 109** -- change from TODO to DONE -- COMPLETED
2. **Create skill docs for 230-234** -- COMPLETED (Task #12)
3. **Rename early docs (01-60) to SPEC-XX prefix** -- COMPLETED (Task #13)
4. **Create skill docs for payroll (240), scheduling (241), error monitoring (242)** -- COMPLETED (Task #13)

---

## Domain-to-Skill Mapping (Task #13)

Complete mapping of all ~155 skills to the 16 domains defined in CLAUDE.md.

### Domain 1: Floor Plan
| Skill | Name | Status |
|-------|------|--------|
| 16 | Table Layout | DONE |
| 17 | Table Status | DONE |
| 18 | Table Transfer | DONE |
| 80 | Floor Plan Editor | DONE |
| 106 | Interactive Floor Plan (SVG) | DONE |
| 107 | Table Combine/Split | DONE |
| 113 | FloorPlanHome Integration | DONE |
| 117 | Virtual Table Combine | DONE |
| 123 | Entertainment Floor Plan | DONE |
| 206 | Seat Management System | DONE |
| 207 | Table Resize & Rotation | DONE |
| 229 | Table Combine Types | DONE |

### Domain 2: Inventory
| Skill | Name | Status |
|-------|------|--------|
| 37 | 86 Items | DONE |
| 38 | Inventory Tracking | DONE |
| 39 | Low Stock Alerts | DONE |
| 125 | Ingredient Costing & Recipes | DONE |
| 126 | Explicit Input/Output Model | DONE |
| 127 | Quick Stock Adjustment | DONE |
| 128 | Inventory Recipe Costing | DONE |
| 130 | Inventory Historical Costs | DONE |
| 131 | Food Cost Dashboard | DONE |
| 132 | Inventory Alerts | DONE |
| 134 | Vendor Management | DONE |
| 135 | Theoretical vs Actual | DONE |
| 136 | Waste Logging | DONE |
| 137 | Par Levels | DONE |
| 139 | Inventory Count | DONE |
| 140 | 86 Feature (Enhanced) | DONE |
| 145 | Ingredient Verification | DONE |
| 204 | Ingredient Library Refactor | DONE |
| 205 | Component Improvements | DONE |
| 211 | Hierarchical Ingredient Picker | DONE |
| 213 | Real-Time Ingredient Library | DONE |
| 214 | Ingredient Verification Visibility | DONE |
| 215 | Unified Modifier Inventory Deduction | DONE |
| 216 | Ingredient-Modifier Connection Visibility | DONE |

### Domain 3: Orders
| Skill | Name | Status |
|-------|------|--------|
| 02 | Quick Order Entry | DONE |
| 05 | Order Review | PARTIAL |
| 07 | Send to Kitchen | DONE |
| 10 | Item Notes | DONE |
| 11 | Seat Tracking | DONE |
| 12 | Course Firing | DONE |
| 13 | Hold & Fire | DONE |
| 14 | Order Splitting | DONE |
| 15 | Order Merging | DONE |
| 34 | Comps & Voids | DONE |
| 61 | Open Orders View | DONE |
| 62 | Order Updates | DONE |
| 63 | Resend to Kitchen | DONE |
| 64 | KDS ↔ POS Sync | DONE |
| 65 | Order History | DONE |
| 66 | Quick Reorder | TODO |
| 68 | Item Transfer | DONE |
| 69 | Split Item Payment | DONE |
| 75 | Closed Orders View | PARTIAL |
| 76 | Course/Seat Management UI | DONE |
| 77 | Hold & Fire UI | DONE |
| 93 | Split Ticket View | DONE |
| 114 | Closed Order Management | TODO |
| 121 | Atomic Seat Management | DONE |
| 122 | Remote Void Approval | DONE |
| 230 | Quick Pick Numbers | DONE |
| 231 | Per-Item Delays | DONE |
| 232 | Note Edit Modal | DONE |
| 234 | Shared OrderPanel Items Hook | DONE |
| 235 | Unified BartenderView Tab Panel | DONE |
| 236 | Comp/Void from BartenderView | DONE |
| 237 | Waste Tracking (Was It Made?) | DONE |
| 238 | VOID/COMP Stamps | PARTIAL |

### Domain 4: Menu
| Skill | Name | Status |
|-------|------|--------|
| 03 | Menu Display | DONE |
| 04 | Modifiers | DONE |
| 40 | Menu Scheduling | DONE |
| 41 | Combo Meals | DONE |
| 83 | Category Types | DONE |
| 84 | Combo Price Overrides | DONE |
| 86 | Combo Selection Modal | DONE |
| 87 | Conditional Item Builders | DONE |
| 99 | Online Ordering Modifier Override | DONE |
| 100 | Modifier Stacking UI | DONE |
| 101 | Modifier Hierarchy Display | DONE |
| 109 | Visual Pizza Builder | DONE |
| 129 | Menu Builder Child Modifiers | DONE |
| 133 | Quick Pricing Update | DONE |
| 138 | Menu Engineering | DONE |
| 141 | Menu/Liquor Builder Separation | DONE |
| 142 | Tiered Pricing & Exclusion Rules | DONE |
| 143 | Item-Owned Modifier Groups | DONE |
| 144 | Production Hardening Pass | DONE |
| 208 | POS Modifier Modal Redesign | DONE |
| 209 | Combo Step Flow | DONE |
| 210 | Modifier Cascade Delete & Orphan Cleanup | DONE |
| 212 | Per-Modifier Print Routing | DONE |
| 217 | Menu Socket Real-Time Updates | DONE |
| 233 | Modifier Depth Indentation | DONE |

### Domain 5: Employees
| Skill | Name | Status |
|-------|------|--------|
| 01 | Employee Management | DONE |
| 47 | Clock In/Out | DONE |
| 48 | Breaks | DONE |
| 49 | Cash Drawer | PARTIAL |
| 50 | Shift Close | DONE |
| 29 | Commissioned Items | DONE |
| 240 | Payroll System | DONE |
| 241 | Employee Scheduling | DONE |

### Domain 6: KDS
| Skill | Name | Status |
|-------|------|--------|
| 23 | KDS Display | DONE |
| 24 | Bump Bar | TODO |
| 25 | Expo Station | PARTIAL |
| 26 | Prep Tickets | TODO |
| 67 | Prep Stations | DONE |
| 201 | Tag-Based Routing Engine | DONE |
| 202 | Socket.io Real-Time KDS | DONE |
| 203 | Reference Items & Atomic Print | DONE |

### Domain 7: Payments
| Skill | Name | Status |
|-------|------|--------|
| 06 | Tipping | DONE |
| 30 | Payment Processing | DONE |
| 31 | Dual Pricing | DONE |
| 32 | Gift Cards | DONE |
| 33 | House Accounts | DONE |
| 88 | Price Rounding | DONE |
| 112 | Simulated Card Reader | DONE |
| 120 | Datacap Direct Integration | DONE |
| 217b | Bottle Service Tiers | DONE |
| 221 | Payment Intent Backoff Logic | DONE |
| 222 | Datacap Validation & JSDoc | DONE |
| 223 | Datacap XML Performance | DONE |
| 224 | Use Cases Layer | DONE |
| 225 | Payment Modal Component Split | DONE |
| 226 | PaymentService Layer | DONE |
| 227 | PaymentDomain Module | DONE |
| 228 | Card Token-Based Loyalty | TODO |

### Domain 8: Reports
| Skill | Name | Status |
|-------|------|--------|
| 42 | Sales Reports | DONE |
| 43 | Labor Reports | DONE |
| 44 | Product Mix | DONE |
| 45 | Void Reports | DONE |
| 46 | Commission Reports | DONE |
| 70 | Discount Reports | DONE |
| 71 | Transfer Reports | DONE |
| 72 | Table Reports | DONE |
| 73 | Customer Reports | DONE |
| 74 | Employee Reports | DONE |
| 78 | Coupon Reports | DONE |
| 79 | Reservation Reports | DONE |
| 104 | Daily Store Report | DONE |
| 105 | Tip Share Report | DONE |

### Domain 9: Hardware
| Skill | Name | Status |
|-------|------|--------|
| 08 | Receipt Printing | DONE |
| 55 | Receipt Printer | TODO |
| 56 | Cash Drawer (Hardware) | TODO |
| 57 | Card Reader | TODO |
| 58 | Barcode Scanner | TODO |
| 103 | Print Routing | DONE |
| 115 | Hardware Status Dashboard | TODO |

### Domain 10: Settings
| Skill | Name | Status |
|-------|------|--------|
| 09 | Features & Config | DONE |
| 27 | Happy Hour | DONE |
| 28 | Discounts | DONE |
| 35 | Coupons | DONE |
| 36 | Tax Calculations | DONE |
| 82 | Login Redirect | DONE |
| 89 | Input Validation | DONE |
| 90 | Error Boundaries | DONE |
| 91 | API Error Handling | DONE |
| 92 | Query Optimization | DONE |
| 124 | Admin Navigation | DONE |

### Domain 11: Entertainment
| Skill | Name | Status |
|-------|------|--------|
| 81 | Timed Rentals | DONE |
| 85 | Entertainment Item Builder | DONE |
| 94 | Entertainment Status Tracking | DONE |
| 95 | Entertainment Waitlist | DONE |
| 96 | Waitlist Tab Integration | DONE |
| 97 | Waitlist Deposits | DONE |
| 98 | Entertainment KDS | DONE |

### Domain 12: Guest (Customer-Facing)
| Skill | Name | Status |
|-------|------|--------|
| 218 | Customer-Facing Display (CFD) | DONE |
| 219 | Pay-at-Table | DONE |

### Domain 13: Events
| Skill | Name | Status |
|-------|------|--------|
| 19 | Reservations | DONE |
| 108 | Event Ticketing APIs | TODO |

### Domain 14: Financial
| Skill | Name | Status |
|-------|------|--------|
| (Covered by Payments + Reports domains) | | |

### Domain 15: Development-RnD
| Skill | Name | Status |
|-------|------|--------|
| (No skills -- R&D prototypes don't ship) | | |

### Domain 16: Error Reporting
| Skill | Name | Status |
|-------|------|--------|
| 242 | Error Monitoring & Reporting | DONE |

### Cross-Domain / Bar Features
| Skill | Name | Status | Primary Domain |
|-------|------|--------|---------------|
| 20 | Bar Tabs | PARTIAL | Orders |
| 21 | Pre-auth | DONE | Payments |
| 22 | Tab Transfer | DONE | Orders |
| 118 | Spirit Tier Admin | DONE | Menu |
| 119 | BartenderView Personalization | DONE | Orders |
| 220 | Bartender Mobile | DONE | Guest |
| 116 | Drag Item to Seat | TODO | Floor Plan |

### Cross-Domain / Infrastructure
| Skill | Name | Status | Primary Domain |
|-------|------|--------|---------------|
| 59 | Location Multi-tenancy | TODO | Settings |
| 60 | Offline Mode | TODO | Settings |
| 102 | KDS Device Security | DONE | Hardware |
| 110 | Real-time Events | TODO | KDS |
| 111 | Training Mode | TODO | Settings |

### Customer Features
| Skill | Name | Status | Primary Domain |
|-------|------|--------|---------------|
| 51 | Customer Profiles | DONE | Settings |
| 52 | Loyalty Program | DONE | Payments |
| 53 | Online Ordering | TODO | Guest |
| 54 | Order Ahead | TODO | Guest |

---

## Proposed New Domains

Based on features that don't fit cleanly into existing domains:

### 1. Payroll & Scheduling
**Justification:** Skills 240 (Payroll) and 241 (Scheduling) are employee-adjacent but complex enough to warrant separation. Payroll involves tax calculations, pay stubs, PDF generation -- very different from employee CRUD.
**Would contain:** Skills 240, 241
**Current home:** Domain 5 (Employees)

### 2. Customer-Facing / Online Ordering
**Justification:** Skills 218 (CFD), 219 (Pay-at-Table), 220 (Bartender Mobile), 53 (Online Ordering), 54 (Order Ahead) form a coherent group of non-POS interfaces. Currently split across Guest and Customer.
**Would contain:** Skills 218, 219, 220, 53, 54, 228
**Current home:** Domains 12 (Guest) + scattered

### 3. Printing (split from Hardware)
**Justification:** Print routing (103, 212), receipt generation (08), ESC/POS commands, and printer management are complex enough to be their own bounded context. Hardware also includes card readers, barcode scanners, and KDS screens.
**Would contain:** Skills 08, 55, 103, 212
**Current home:** Domain 9 (Hardware)

**Recommendation:** These are observations, not urgent. The current 16-domain structure works well. Consider splitting only when a domain becomes overloaded during active development.

---

## Phase 2 Audit Insertion Points

> Research completed 2026-02-08 by Researcher agent. Reference for Builder when implementing Task #16.

### Existing Pattern (follow this)

File: `src/app/api/orders/[id]/pay/route.ts` line 666-679
```typescript
await db.auditLog.create({
  data: {
    locationId,
    employeeId,
    action: 'virtual_group_dissolved',
    entityType: 'table',
    entityId: primaryTableId,
    details: { dissolvedTableIds, reason: 'order_paid' },
  },
})
```

### 1. `src/app/api/orders/route.ts` (POST - Create Order)

| Field | Value |
|-------|-------|
| **Insert at** | After line 218 (after `db.order.create`), before socket dispatch at line 229 |
| **Action** | `order_created` |
| **entityType** | `order` |
| **entityId** | `order.id` |
| **Details JSON** | `{ orderNumber, orderType, tableId, tabName, itemCount: items.length }` |
| **Transaction?** | NOT in a transaction. The `db.order.create` uses nested writes but no explicit `$transaction`. Audit entry is standalone. |
| **Auth check?** | NONE currently. No `requireAnyPermission` call. |

### 2. `src/app/api/orders/[id]/items/route.ts` (POST - Append Items)

| Field | Value |
|-------|-------|
| **Insert at** | Line ~280, INSIDE the `$transaction` (lines 94-282), after items created, before `return { updatedOrder, createdItems }` |
| **Action** | `item_added` |
| **entityType** | `order` |
| **entityId** | `orderId` |
| **Details JSON** | `{ itemCount: createdItems.length, items: createdItems.map(i => ({ name: i.name, quantity: i.quantity, price: i.unitPrice })) }` |
| **Transaction?** | YES - INSIDE `db.$transaction` (line 94). Use `tx.auditLog.create()` not `db.auditLog.create()`. |
| **Auth check?** | NONE currently. |

### 3. `src/app/api/orders/[id]/send/route.ts` (POST - Send to Kitchen)

| Field | Value |
|-------|-------|
| **Insert at** | After line 149 (after prep stock deduction dispatch), before the response at line 152 |
| **Action** | `sent_to_kitchen` |
| **entityType** | `order` |
| **entityId** | `orderId` |
| **Details JSON** | `{ regularItemCount: regularItems.length, entertainmentItemCount: entertainmentItems.length, itemNames: pendingItems.map(i => i.name) }` |
| **Transaction?** | NOT in a transaction. Regular items use `batchUpdateOrderItemStatus` (line 91), entertainment items updated individually (lines 96-110). Audit entry is standalone. |
| **Auth check?** | NONE currently. |

### 4. `src/app/api/orders/[id]/pay/route.ts` (POST - Payment)

| Field | Value |
|-------|-------|
| **Insert at (a)** | After each payment creation (lines ~564-569 for cash/card, ~361-369 for loyalty, ~447-468 for gift card, ~536-557 for house account). Action: `payment_processed`. |
| **Insert at (b)** | After line 602 (order status set to 'paid'). Action: `order_closed`. |
| **Action (a)** | `payment_processed` |
| **Action (b)** | `order_closed` |
| **entityType** | `payment` / `order` |
| **entityId** | `payment.id` / `orderId` |
| **Details JSON (a)** | `{ paymentMethod, amount, tipAmount, orderId, orderNumber }` |
| **Details JSON (b)** | `{ orderNumber, totalPaid, paymentCount: payments.length, paymentMethods }` |
| **Transaction?** | Loyalty/gift card/house account payments ARE in `$transaction` - use `tx.auditLog.create()`. Cash/card are NOT - use `db.auditLog.create()`. Order close is NOT in a transaction. |
| **Auth check?** | YES - `requireAnyPermission` at line 121 (POS_CASH_PAYMENTS or POS_CARD_PAYMENTS). |

### 5. `src/app/api/orders/[id]/route.ts` (PUT - Metadata Update)

| Field | Value |
|-------|-------|
| **Insert at** | After line 158 (after `db.order.update`), before response |
| **Action** | `order_metadata_updated` |
| **entityType** | `order` |
| **entityId** | `orderId` |
| **Details JSON** | `{ changedFields: Object.keys(updateData) }` |
| **Transaction?** | NOT in a transaction. |
| **Auth check?** | NONE currently. |

### 6. `src/app/api/shifts/[id]/route.ts` (PUT - Close Shift)

| Field | Value |
|-------|-------|
| **Insert at** | Line ~182, INSIDE the `$transaction` (lines 141-183), after `processTipDistribution` call, before `return closed` |
| **Action** | `shift_closed` |
| **entityType** | `shift` |
| **entityId** | `shift.id` |
| **Details JSON** | `{ employeeId: shift.employeeId, totalSales: summary.totalSales, cashSales: summary.cashSales, cardSales: summary.cardSales, expectedCash, actualCash, variance, tipsDeclared, hasTipDistribution: !!tipDistribution }` |
| **Transaction?** | YES - INSIDE `db.$transaction` (line 141). Use `tx.auditLog.create()`. |
| **Auth check?** | NONE currently. CRITICAL gap - anyone can close any shift. Needs `requireAnyPermission` added. |

### Summary: Auth Gaps Found

| Route | Has Auth? | Risk |
|-------|-----------|------|
| POST `/api/orders` | NO | Medium - order creation |
| POST `/api/orders/[id]/items` | NO | Medium - item append |
| POST `/api/orders/[id]/send` | NO | Low - send to kitchen |
| POST `/api/orders/[id]/pay` | YES | OK |
| PUT `/api/orders/[id]` | NO | Low - metadata only |
| PUT `/api/shifts/[id]` | NO | HIGH - shift close handles money |

### Transaction Gaps Found

| Route | Operation | In Transaction? | Risk |
|-------|-----------|----------------|------|
| POST `/api/orders` | Order create | Nested writes only | Low (atomic via Prisma) |
| POST `/api/orders/[id]/pay` | Cash/card payment + order close | NO | HIGH - payment created but order status could fail |
| POST `/api/orders/[id]/send` | Multi-item status update | NO (batch helper) | Medium - partial send possible |

---

## Phase 2D: Admin Audit Viewer API Design

> Designed 2026-02-08 by Researcher agent. Reference for Builder implementing Task #19.

### Data Sources for Timeline

The order activity timeline merges **4 data sources** into a single chronological list:

| Source | Model | Key Fields | Join Key |
|--------|-------|-----------|----------|
| **AuditLog** | `AuditLog` | `action`, `employeeId`, `details`, `createdAt` | `entityId` = orderId, `entityType` = 'order' |
| **VoidLog** | `VoidLog` | `voidType`, `reason`, `amount`, `wasMade`, `approvedById`, `employeeId`, `createdAt` | `orderId` |
| **Payment** | `Payment` | `paymentMethod`, `amount`, `tipAmount`, `status`, `cardLast4`, `processedAt`, `voidedAt`, `refundedAt` | `orderId` |
| **Order timestamps** | `Order` | `openedAt`, `sentAt`, `paidAt`, `closedAt`, `reopenedAt`, `reopenedBy`, `reopenReason` | `id` = orderId |

### Endpoint A: `GET /api/orders/[id]/timeline`

**Purpose:** Per-order activity timeline for the order detail view.

**Permission:** `REPORTS_VIEW` or `REPORTS_VOIDS` (either grants access)

**Query parameters:** None (all activity for this order)

**Response shape:**

```typescript
interface TimelineEntry {
  id: string                // Unique ID (source model ID or generated for system events)
  timestamp: string         // ISO 8601
  action: string            // Normalized action name (see table below)
  source: 'audit_log' | 'void_log' | 'payment' | 'system'
  employeeId: string | null
  employeeName: string | null  // displayName or "firstName lastName"
  details: Record<string, unknown>  // Action-specific payload
}

interface OrderTimelineResponse {
  orderId: string
  orderNumber: number
  timeline: TimelineEntry[]  // Sorted ascending by timestamp
}
```

**Normalized action strings:**

| Action | Source | Details shape |
|--------|--------|--------------|
| `order_created` | system (from `openedAt`) | `{ orderType, tableId, tabName }` |
| `items_added` | audit_log | `{ itemCount, items: [{ name, quantity }] }` |
| `sent_to_kitchen` | system (from `sentAt`) OR audit_log | `{ itemCount }` |
| `item_voided` | void_log (voidType='item') | `{ itemId, itemName, amount, reason, wasMade, approvedBy }` |
| `order_voided` | void_log (voidType='order') | `{ amount, reason, approvedBy }` |
| `item_comped` | void_log (voidType='comp') | `{ itemId, itemName, amount, reason, approvedBy }` |
| `payment_processed` | payment (status='completed') | `{ paymentMethod, amount, tipAmount, cardLast4 }` |
| `payment_voided` | payment (voidedAt != null) | `{ paymentMethod, amount, voidedBy, voidReason }` |
| `payment_refunded` | payment (refundedAt != null) | `{ paymentMethod, refundedAmount, refundReason }` |
| `order_closed` | system (from `paidAt` or `closedAt`) | `{ total }` |
| `order_reopened` | system (from `reopenedAt`) | `{ reopenedBy, reopenReason }` |
| `metadata_updated` | audit_log | `{ changedFields }` |
| `virtual_group_dissolved` | audit_log | `{ dissolvedTableIds }` |

**Query logic (pseudocode):**

```typescript
async function buildOrderTimeline(orderId: string, locationId: string) {
  // 1. Fetch all 4 sources in parallel
  const [order, auditLogs, voidLogs, payments] = await Promise.all([
    db.order.findUnique({
      where: { id: orderId, locationId },
      include: { employee: { select: { id: true, firstName: true, lastName: true, displayName: true } } }
    }),
    db.auditLog.findMany({
      where: { entityId: orderId, entityType: 'order', locationId, deletedAt: null },
      include: { employee: { select: { id: true, firstName: true, lastName: true, displayName: true } } },
      orderBy: { createdAt: 'asc' }
    }),
    db.voidLog.findMany({
      where: { orderId, locationId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
      orderBy: { createdAt: 'asc' }
    }),
    db.payment.findMany({
      where: { orderId, locationId, deletedAt: null },
      include: { employee: { select: { id: true, firstName: true, lastName: true, displayName: true } } },
      orderBy: { processedAt: 'asc' }
    }),
  ])

  // 2. Convert each source to TimelineEntry[]
  const entries: TimelineEntry[] = []

  // System events from Order timestamps
  if (order.openedAt) entries.push({ timestamp: order.openedAt, action: 'order_created', source: 'system', ... })
  if (order.sentAt) entries.push({ timestamp: order.sentAt, action: 'sent_to_kitchen', source: 'system', ... })
  if (order.paidAt) entries.push({ timestamp: order.paidAt, action: 'order_closed', source: 'system', ... })
  if (order.reopenedAt) entries.push({ timestamp: order.reopenedAt, action: 'order_reopened', source: 'system', ... })

  // AuditLog entries (skip duplicates of system events if both exist)
  auditLogs.forEach(log => entries.push({ timestamp: log.createdAt, action: log.action, source: 'audit_log', ... }))

  // VoidLog entries
  voidLogs.forEach(log => entries.push({ timestamp: log.createdAt, action: mapVoidAction(log), source: 'void_log', ... }))

  // Payment entries (completed + voided + refunded as separate events)
  payments.forEach(p => {
    entries.push({ timestamp: p.processedAt, action: 'payment_processed', source: 'payment', ... })
    if (p.voidedAt) entries.push({ timestamp: p.voidedAt, action: 'payment_voided', source: 'payment', ... })
    if (p.refundedAt) entries.push({ timestamp: p.refundedAt, action: 'payment_refunded', source: 'payment', ... })
  })

  // 3. Deduplicate: if audit_log has 'sent_to_kitchen' AND system has sentAt, keep audit_log (has employeeId), remove system
  // 4. Sort by timestamp ascending
  return entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}
```

**Deduplication rules:**
- If both `system` (from Order timestamp) and `audit_log` exist for same action, prefer `audit_log` (has employee attribution)
- Payment events are never duplicated (each payment record = one entry, plus optional void/refund sub-events)
- VoidLog entries are never duplicated with AuditLog (different action strings)

### Endpoint B: `GET /api/audit/activity`

**Purpose:** Global audit activity feed for admin "all transactions" view.

**Permission:** `ADMIN` or `REPORTS_VIEW`

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `locationId` | string | required | Multi-tenancy filter |
| `startDate` | ISO string | today 00:00 | Start of date range |
| `endDate` | ISO string | now | End of date range |
| `employeeId` | string | all | Filter by who performed action |
| `actionType` | string | all | Filter by action category (see below) |
| `orderId` | string | all | Filter to specific order |
| `source` | string | all | Filter by source: `audit_log`, `void_log`, `payment` |
| `page` | number | 1 | Page number |
| `limit` | number | 50 | Items per page (max 200) |

**Action type filter groups:**

| `actionType` value | Matches |
|-------------------|---------|
| `order` | `order_created`, `order_closed`, `order_reopened`, `metadata_updated` |
| `item` | `items_added`, `item_voided`, `item_comped`, `sent_to_kitchen` |
| `payment` | `payment_processed`, `payment_voided`, `payment_refunded` |
| `void` | `item_voided`, `order_voided`, `item_comped` (from VoidLog) |
| `all` | Everything |

**Response shape:**

```typescript
interface AuditActivityResponse {
  entries: ActivityEntry[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

interface ActivityEntry extends TimelineEntry {
  orderId: string | null
  orderNumber: number | null
  orderType: string | null
}
```

**Pagination strategy:** Cursor-based internally (for performance on large datasets), but exposed as page/limit to the client for simplicity.

```typescript
// Internal: use createdAt + id as cursor for stable pagination
const cursor = page > 1 ? { skip: (page - 1) * limit } : {}

// Query all 3 sources with date range + filters, UNION-style:
// 1. AuditLog where entityType='order' + date range + filters
// 2. VoidLog + date range + filters
// 3. Payment + date range + filters
// Merge, sort by timestamp desc, paginate

// For total count: run COUNT on each source with same filters, sum
```

**Performance notes:**
- Each source query is independent — run in parallel with `Promise.all`
- Add indexes: `AuditLog(locationId, entityType, createdAt)`, `VoidLog(locationId, createdAt)`, `Payment(locationId, processedAt)`
- For the global view, limit date range to max 31 days to prevent expensive full-table scans
- Consider materializing to a single `ActivityFeed` table if query performance degrades (future optimization)

### Required Database Indexes

```prisma
// Add to schema.prisma for timeline performance
@@index([entityType, entityId, locationId])  // on AuditLog — filter by order
@@index([locationId, createdAt])             // on AuditLog — date range queries
@@index([orderId, locationId])               // on VoidLog (likely exists)
@@index([locationId, createdAt])             // on VoidLog — date range queries
@@index([orderId, locationId])               // on Payment (likely exists)
@@index([locationId, processedAt])           // on Payment — date range queries
```

### Permission Gating

| Endpoint | Required Permission | Rationale |
|----------|-------------------|-----------|
| `GET /api/orders/[id]/timeline` | `REPORTS_VIEW` OR `REPORTS_VOIDS` | Managers reviewing specific orders |
| `GET /api/audit/activity` | `ADMIN` | Global view is admin-only (sensitive data) |

Use `requireAnyPermission` from `@/lib/api-auth` (already implemented in Phase 1).

---

## Phase 3A: Shift Lifecycle

> Research completed 2026-02-08 by Researcher agent. Reference for Builder.

### 1. Clock-In Flow

**Current flow:**
1. Employee enters PIN at `/login` (`src/app/(auth)/login/page.tsx`)
2. PIN verified via `POST /api/auth/login` (`src/app/api/auth/login/route.ts`)
   - Compares hashed PIN with bcrypt (line 35-39)
   - Creates `AuditLog` entry with action `login` (line 50-58)
   - Returns employee data + permissions
3. Client calls `login(employee)` on `useAuthStore` (line 39)
   - Sets `employee`, `locationId`, `isAuthenticated` in Zustand
   - **Does NOT set `clockedIn`** — `clockIn()` exists in the store (line 63-66) but is never called
4. Redirects to `/orders` based on `defaultScreen` (line 46-57)

**Gap: No clock-in prompt after login.**
- `auth-store.ts` has `clockedIn` and `clockInTime` state (lines 25-26) and `clockIn()`/`clockOut()` actions (lines 63-73), but they are **client-side only** and disconnected from the server.
- `TimeClockEntry` API (`POST /api/time-clock`) exists and works, but is never called during login flow.
- `Shift` API (`POST /api/shifts`) also exists separately — creates a shift with `startingCash`.
- The orders page HAS a `ShiftStartModal` import (line 52) and `showShiftStartModal` state (line 331), suggesting the UI was partially built.

**Target flow:**
1. PIN login succeeds
2. Check: Does employee have an open `TimeClockEntry`? (`GET /api/time-clock?employeeId=X&openOnly=true`)
3. If NO open entry → Show "Clock In?" prompt
   - On confirm → `POST /api/time-clock` (creates entry)
   - Then → Show `ShiftStartModal` to set starting cash → `POST /api/shifts`
4. If YES open entry → Check: Does employee have an open `Shift`?
   - If no shift → Show `ShiftStartModal`
   - If yes → Go to POS

**Where to add the check:** In `src/app/(auth)/login/page.tsx` after line 39 (`login(data.employee)`), before the redirect (line 42-57). Or in `/orders/page.tsx` on mount as a guard.

**Files to modify:**
- `src/app/(auth)/login/page.tsx` — Add clock-in check + prompt after login (lines 39-57)
- `src/stores/auth-store.ts` — Wire `clockedIn` to actual server state (lines 63-73)
- `src/app/(pos)/orders/page.tsx` — Already has `ShiftStartModal` import + state (lines 52, 331)

### 2. Break System

**Current state:** Fully implemented at API level, partially at UI level.

**Schema (`Break` model, schema.prisma line 3623):**
- `breakType`: 'paid' | 'unpaid' | 'meal'
- `status`: 'active' | 'completed'
- `startedAt`, `endedAt`, `duration` (minutes, calculated on end)
- Links to `TimeClockEntry` via `timeClockEntryId`

**API (`/api/breaks/route.ts`):**
- `GET` — List breaks by employeeId or timeClockEntryId
- `POST` — Start break (validates no active break exists, links to TimeClockEntry)
- `PUT` — End break (calculates duration, increments `TimeClockEntry.breakMinutes`)

**TimeClockEntry also has inline break fields (schema line 434-436):**
- `breakStart`, `breakEnd`, `breakMinutes` — These are SEPARATE from the Break model
- The `PUT /api/time-clock` route uses these inline fields for `startBreak`/`endBreak` actions (lines 215-242)
- So breaks can be tracked TWO ways: via Break model OR via inline fields on TimeClockEntry

**UI:**
- `src/components/time-clock/TimeClockModal.tsx` exists — likely contains break start/end buttons
- No dedicated break management page found

**Gap: Dual break tracking is confusing.** Break model and TimeClockEntry inline fields are not synced. The Break API increments `TimeClockEntry.breakMinutes` (line 141-146 of breaks/route.ts), but the TimeClockEntry API also manages its own `breakStart`/`breakEnd` independently.

**Target:** Pick ONE break tracking approach. Recommendation: Use Break model (richer — has types, notes, proper status) and deprecate inline TimeClockEntry break fields.

### 3. Shift Close Flow

**Current flow (fully implemented):**

`ShiftCloseoutModal` (`src/components/shifts/ShiftCloseoutModal.tsx`, 976 lines) implements a multi-step wizard:

| Step | Name | What happens |
|------|------|-------------|
| 1 | `count` | **Blind cash count** — Employee counts drawer by denomination or enters manual total. Expected amount is HIDDEN. Manager with `MGR_CASH_DRAWER_FULL` permission can click "Manager: View Summary First" to see expected first (non-blind mode). Also collects tips declared + notes. |
| 2 | `summary` | (Manager only) Shows shift summary before counting — total sales, cash/card breakdown, expected in drawer. Then proceeds to count step. |
| 3 | `reveal` | Shows variance (expected vs actual), color-coded: green (balanced), yellow (over), red (short). Shows shift summary with sales, tips, commission. Option to recount. |
| 4 | `tips` | Tip distribution — shows gross tips, automatic role-based tip-outs (from TipOutRule), custom tip shares to specific employees. Net tips calculated. |
| 5 | `complete` | Confirmation screen with final variance message. |

**API close (`PUT /api/shifts/[id]` with action='close', lines 112-211):**
1. Calculates shift summary via `calculateShiftSummary()` (lines 236-363) — queries Payment + Order + OrderItem for the shift period
2. Calculates expected cash = startingCash + netCashReceived (line 137)
3. Calculates variance = actualCash - expectedCash (line 138)
4. Inside `$transaction` (lines 141-183):
   - Updates shift: endedAt, status='closed', expectedCash, actualCash, variance, totalSales, cashSales, cardSales, tipsDeclared, grossTips, tipOutTotal, netTips
   - Calls `processTipDistribution()` if tipDistribution provided
5. Returns result with variance message

**Blind count is CORRECTLY implemented:**
- Line 101: `canSeeExpectedFirst = hasPermission(permissions, PERMISSIONS.MGR_CASH_DRAWER_FULL)`
- Line 104: Default step is 'count' (blind)
- Expected cash is only calculated/shown AFTER count submission (line 143: depends on `summary` being loaded)
- Manager override via "View Summary First" button (line 441-448)

### 4. Tip Sharing at Close

**Current state:** Fully implemented.

**TipOutRule model (configured at `/settings/tip-outs`):**
- `fromRoleId` → `toRoleId` with `percentage`
- Example: Server → Busser at 3%

**Flow in ShiftCloseoutModal (step='tips', lines 752-927):**
1. Fetches tip-out rules filtered by employee's role (line 204)
2. Fetches all employees at location (line 210)
3. Auto-calculates tip-outs: grossTips * (percentage/100) for each rule (lines 231-237)
4. Allows custom tip shares to specific employees (lines 254-285)
5. Shows net tips = gross - roleTipOuts - customShares (lines 248-251)
6. Prevents closing if netTips < 0 (line 921)

**`processTipDistribution()` (shifts/[id]/route.ts lines 366-497):**
- Gets active shifts to find on-shift employees (lines 379-393)
- For role-based tip-outs (lines 406-461):
  - Finds active employee with target role → status='pending'
  - If no active employee → finds any employee → status='banked' → creates TipBank entry
- For custom shares (lines 464-496):
  - Same active/banked logic
- Creates TipShare records for all distributions
- Creates TipBank entries for banked (off-shift) shares

**Related models:**
- `TipShare` — Records of tip distribution (fromEmployeeId, toEmployeeId, amount, shareType, status)
- `TipBank` — Uncollected tips for off-shift employees
- `TipOutRule` — Configured rules per role

**Gap: No summary screen.** After tips step, it goes straight to close. The employee doesn't see a "here's your final take-home" summary combining: net tips + commission + hourly hours. This would be useful.

### 5. Commission Tracking

**Current state:** Implemented at calculation level, not at reporting level.

**Schema:**
- `MenuItem.commissionType` ('fixed' | 'percent' | null) — schema line 776
- `MenuItem.commissionValue` (Decimal) — schema line 777
- `Modifier.commissionType` / `Modifier.commissionValue` — schema lines 937-938
- `Order.commissionTotal` (Decimal) — schema line 1494
- `OrderItem` does NOT have a commissionAmount field (calculated dynamically)

**Calculation (`src/lib/order-calculations.ts`):**
- `calculateItemCommission()` — per-item commission from commissionType + commissionValue
- `calculateOrderCommission()` — sums across all items
- `calculateOrderTotals()` — includes commissionTotal in output

**Where commission shows up:**
- `calculateShiftSummary()` (shifts/[id]/route.ts line 287): Sums `order.commissionTotal` across shift orders
- `ShiftCloseoutModal` reveal step (line 719-724): Shows "Commission Earned" if > 0
- Tips step (line 757-769): Shows commission in purple card

**Gap: No standalone commission report.** Commission is shown during shift close but there's no `/reports/commission` page despite `REPORTS_COMMISSION` permission existing (auth-utils.ts line 73).

### 6. Critical Architecture Gap: Shift vs TimeClockEntry

**These are two independent, unlinked models:**

| Model | Purpose | Linked? |
|-------|---------|---------|
| `Shift` | Cash drawer + sales tracking | Has `employeeId`, `locationId`, `startedAt`/`endedAt` |
| `TimeClockEntry` | Labor hours + breaks | Has `employeeId`, `locationId`, `clockIn`/`clockOut` |

**They share NO foreign key.** An employee could have:
- An open TimeClockEntry but no Shift (clocked in but no drawer assigned)
- An open Shift but no TimeClockEntry (drawer open but not clocked in — shouldn't happen)
- Both open (correct state)
- Neither (not working)

**Target:** Link them. Options:
1. Add `shiftId` to `TimeClockEntry` (or `timeClockEntryId` to `Shift`) — establishes 1:1 relationship
2. Create a `WorkSession` concept that owns both
3. Enforce at application level: clock-in always creates both, close shift always closes both

**Recommendation:** Option 1 — Add `timeClockEntryId` to `Shift`. Simple, backwards-compatible. The shift close flow already calculates hours (via summary), but linking allows proper labor cost reports.

### Files Summary

| File | Purpose | Key Lines |
|------|---------|-----------|
| `src/app/(auth)/login/page.tsx` | PIN login, no clock-in check | 18-64 |
| `src/stores/auth-store.ts` | Auth state, unused clockIn/clockOut | 63-73 |
| `src/app/api/auth/login/route.ts` | PIN verify, audit log, returns permissions | 50-58 (audit), 78-95 (response) |
| `src/app/api/time-clock/route.ts` | Clock in/out + inline breaks | POST:84-147, PUT:150-279 |
| `src/app/api/breaks/route.ts` | Break model CRUD | POST:42-97, PUT:99-162 |
| `src/app/api/shifts/route.ts` | Shift list + create | POST:77-158 |
| `src/app/api/shifts/[id]/route.ts` | Shift close + tip distribution | PUT:80-233, processTipDistribution:366-497 |
| `src/components/shifts/ShiftCloseoutModal.tsx` | Multi-step close wizard (976 lines) | count:430-550, reveal:647-749, tips:752-927 |
| `src/components/shifts/ShiftStartModal.tsx` | Shift start (imported but may be unused) | - |
| `src/components/time-clock/TimeClockModal.tsx` | Time clock UI with break buttons | - |
| `src/lib/order-calculations.ts` | Commission calculation | calculateItemCommission, calculateOrderCommission |

### Schema Changes Needed

```prisma
// 1. Link Shift to TimeClockEntry
model Shift {
  // ADD:
  timeClockEntryId String?  @unique
  timeClockEntry   TimeClockEntry? @relation(fields: [timeClockEntryId], references: [id])
}

// 2. No other schema changes needed — Break, TipShare, TipBank, TipOutRule are complete
```

### New Files Needed

| File | Purpose |
|------|---------|
| `src/components/shifts/ClockInPrompt.tsx` | "Clock in?" prompt shown after login if no open TimeClockEntry |
| `src/app/api/reports/commission/route.ts` | Commission report endpoint |
| `src/app/(admin)/reports/commission/page.tsx` | Commission report UI |

### Summary: Current vs Target

| Feature | Current | Target | Gap Size |
|---------|---------|--------|----------|
| Clock-in prompt on login | NOT implemented | Prompt + auto-create TimeClockEntry + Shift | Medium |
| Break tracking | Dual systems (Break model + inline) | Single system (Break model) | Small (deprecate inline) |
| Blind cash count | FULLY implemented | N/A | Done |
| Shift close wizard | FULLY implemented (5 steps) | N/A | Done |
| Tip distribution at close | FULLY implemented | Add final summary screen | Small |
| Commission at close | Shows in close modal | Add standalone report | Small |
| Shift ↔ TimeClockEntry link | NOT linked | FK relationship | Small (schema + migration) |
| Auth on shift close | NONE | Add `requireAnyPermission` | Small (Task #24 may cover this) |

---

## Phase 3A Implementation Plan: Break Unification + Shift-TimeClockEntry Link

> Research completed 2026-02-08 by Researcher agent. Deep dive for Builder.

### Issue 1: Break Tracking — Two Systems, One Winner

**Finding: TimeClockEntry inline fields are the source of truth.** The Break model is unused by production code.

**Evidence:**

| Consumer | Uses TimeClockEntry inline? | Uses Break model? |
|----------|---------------------------|-------------------|
| `TimeClockModal.tsx` (UI) | YES — `handleBreak()` calls `/api/time-clock` PUT with `startBreak`/`endBreak` (line 349-371) | NO |
| Labor Report (`/api/reports/labor`) | YES — reads `entry.breakMinutes` (line 135) | NO |
| Payroll Report (`/api/reports/payroll`) | YES — reads `entry.breakMinutes` (line 134) | NO |
| Daily Store Report (`/api/reports/daily`) | YES — reads `entry.breakMinutes` (line 501) | NO |
| `/api/breaks` route | Increments `TimeClockEntry.breakMinutes` on end (line 141-146) | YES — creates Break records |

**Key detail:** The `/api/breaks` route DOES increment `TimeClockEntry.breakMinutes` when a break ends (line 141-146), so it partially syncs. But the TimeClockEntry route manages its own `breakStart`/`breakEnd` independently (lines 215-242) and also increments `breakMinutes` — creating a potential double-count if both APIs are called.

**Recommendation: Keep TimeClockEntry inline as primary, ENHANCE Break model as audit log.**

Rationale:
- All reports, UI, and existing code use `TimeClockEntry.breakMinutes` — changing this would break 4+ consumers
- Break model adds value as a **history/audit trail** (typed breaks with timestamps, notes)
- Don't deprecate Break model — instead, make it a record created BY the TimeClockEntry break actions

**Implementation plan:**

**Step 1:** Modify `PUT /api/time-clock` `startBreak` action (line 215-226) to ALSO create a Break record:
```typescript
case 'startBreak': {
  // Existing: update TimeClockEntry inline fields
  updateData = { breakStart: now, breakEnd: null }
  // NEW: create Break record for audit trail
  await db.break.create({
    data: {
      locationId: entry.locationId,
      employeeId: entry.employeeId,
      timeClockEntryId: entry.id,
      breakType: body.breakType || 'unpaid', // allow type from UI
      status: 'active',
    }
  })
  break
}
```

**Step 2:** Modify `PUT /api/time-clock` `endBreak` action (line 229-242) to ALSO close the Break record:
```typescript
case 'endBreak': {
  // Existing: update TimeClockEntry inline fields + breakMinutes
  // NEW: close matching Break record
  const activeBreak = await db.break.findFirst({
    where: { timeClockEntryId: entry.id, status: 'active' }
  })
  if (activeBreak) {
    await db.break.update({
      where: { id: activeBreak.id },
      data: { endedAt: now, duration: breakMinutes, status: 'completed' }
    })
  }
  break
}
```

**Step 3:** Optionally add break type selector to `TimeClockModal.tsx` UI (line 610: "Start Break" button could show paid/unpaid/meal options).

**Files to modify:**
- `src/app/api/time-clock/route.ts` — lines 215-242 (startBreak + endBreak actions)
- `src/components/time-clock/TimeClockModal.tsx` — line 610 (optional: break type selector)

**No schema changes needed.** Break model already has all needed fields.

### Issue 2: Shift ↔ TimeClockEntry Link

**Finding: These models serve different purposes and SHOULD be linked.**

| Model | Purpose | Created when | Closed when |
|-------|---------|-------------|-------------|
| `TimeClockEntry` | Labor tracking (hours, breaks, pay) | Employee clocks in via TimeClockModal | Employee clocks out |
| `Shift` | Cash drawer + sales tracking | Employee starts shift via ShiftStartModal (with startingCash) | Employee closes shift via ShiftCloseoutModal (with cash count) |

**Current problem:** An employee can clock out (close TimeClockEntry) without closing their Shift, or close their Shift without clocking out. There's no enforcement linking them.

**Recommendation: Add `timeClockEntryId` to Shift (not the reverse).**

Rationale:
- Shift is the "richer" concept — it owns the cash drawer and sales period
- A Shift always implies a TimeClockEntry, but a TimeClockEntry might not need a Shift (e.g., back-of-house dishwasher clocks in but doesn't handle cash)
- Adding FK to Shift makes it optional: roles without cash responsibility can skip Shift creation

**Schema change:**
```prisma
model Shift {
  // ADD these two lines:
  timeClockEntryId String?         @unique
  timeClockEntry   TimeClockEntry? @relation(fields: [timeClockEntryId], references: [id])
  // ... existing fields unchanged
}
```

**Implementation plan:**

**Step 1:** Schema migration — add `timeClockEntryId` to Shift (nullable for backwards compatibility with existing data).

**Step 2:** Modify `POST /api/shifts` (lines 117-136) to accept and store `timeClockEntryId`:
```typescript
const shift = await db.shift.create({
  data: {
    locationId,
    employeeId,
    startingCash,
    timeClockEntryId: timeClockEntryId || null, // NEW
    notes,
    status: 'open',
  },
})
```

**Step 3:** Modify clock-out flow in `TimeClockModal.tsx`:
- Before clocking out (line 260-274: `handleClockOutClick`), check if employee has an open Shift
- If open Shift exists → Show "You must close your shift first" warning OR auto-trigger ShiftCloseoutModal
- After shift close completes → proceed with clock out

**Step 4:** Modify shift close flow:
- After shift close completes, optionally auto-clock-out the linked TimeClockEntry
- Or at minimum, warn if TimeClockEntry will remain open

**Step 5:** Backfill migration (optional): For existing data, attempt to match Shifts to TimeClockEntries by `employeeId` + overlapping time ranges.

**Files to modify:**
- `prisma/schema.prisma` — Add `timeClockEntryId` + relation to Shift model (line ~465)
- `src/app/api/shifts/route.ts` — POST handler, accept `timeClockEntryId` (line 117-136)
- `src/components/time-clock/TimeClockModal.tsx` — Clock-out guard for open shifts (line 260-274)
- `src/components/shifts/ShiftCloseoutModal.tsx` — Optional auto-clock-out after close (line 319-374)

### Implementation Priority

| Task | Effort | Risk | Priority |
|------|--------|------|----------|
| Break model sync (TimeClockEntry creates Break records) | Small (2 edits to time-clock route) | Low | P1 — Quick win |
| Schema: Add `timeClockEntryId` to Shift | Small (migration) | Low | P1 — Foundation |
| Shift create accepts `timeClockEntryId` | Small (1 line) | Low | P1 |
| Clock-out checks for open Shift | Medium (UI + API call) | Medium | P2 |
| Shift close auto-clock-out option | Medium (cross-modal flow) | Medium | P3 |
| Break type selector in UI | Small (UI only) | Low | P3 — Nice to have |
| Backfill migration for existing data | Small (script) | Low | P3 — Optional |

---

## Phase 3A: Commission Report — Current State

### Finding: Commission Report Already Exists (Fully Implemented)

Both the API and UI page are already built and functional.

### API: `/api/reports/commission/route.ts` (175 lines)

**Endpoint:** `GET /api/reports/commission?locationId=X&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&employeeId=X`

**What it does:**
1. Fetches all `completed`/`paid` orders in date range with items + menuItem commission settings
2. Filters to orders with `commissionTotal > 0` OR items with `commissionAmount > 0`
3. Fallback calculation: If `orderCommission === 0` but MenuItem has `commissionType`/`commissionValue`, recalculates from item data (lines 105-112)
4. Groups by employee with per-order, per-item breakdown
5. Returns `report[]` (per-employee), `summary` (totals), `filters`

**Response shape:**
```json
{
  "report": [{
    "employeeId": "...",
    "employeeName": "...",
    "orderCount": 5,
    "totalCommission": 42.50,
    "orders": [{
      "orderId": "...",
      "orderNumber": "123",
      "date": "2026-02-08T...",
      "commission": 8.50,
      "items": [{ "name": "Patron Margarita", "commission": 8.50 }]
    }]
  }],
  "summary": { "totalEmployees": 3, "totalOrders": 12, "grandTotalCommission": 127.50 },
  "filters": { "startDate": "...", "endDate": "...", "employeeId": null, "locationId": "..." }
}
```

### UI: `/reports/commission/page.tsx` (265 lines)

**Features:**
- Date range picker (defaults to last 7 days)
- 3 summary cards: Total Commission, Employees with Commission, Orders with Commission
- Expandable employee rows with per-order detail table (order #, date, items, commission)
- Uses `AdminPageHeader` + `AdminSubNav` (reportsSubNav) — consistent with other report pages

**What's missing from UI:**
- No employee filter dropdown (API supports it, UI doesn't expose it)
- No permission gating (any authenticated user can view — should require `REPORTS_COMMISSION`)
- No export/print functionality
- No "mark as paid" workflow (unlike tip-shares report)

### Commission Data Flow (End to End)

| Step | Where | What |
|------|-------|------|
| 1. Configure | MenuItem (`commissionType`, `commissionValue`) | percent or fixed per item |
| 2. Configure | Modifier (`commissionType`, `commissionValue`) | percent or fixed per modifier |
| 3. Calculate | `order-calculations.ts` `calculateItemCommission()` | At order time, per-item |
| 4. Store | `OrderItem.commissionAmount` | Per-item commission stored |
| 5. Aggregate | `Order.commissionTotal` | Sum across items on order |
| 6. Report | `/api/reports/commission` | Aggregated by employee |
| 7. Cross-report | `/api/reports/daily` (line 272) | Included in daily summary |
| 8. Cross-report | `/api/reports/employee-shift` (line 267) | Included in shift report |
| 9. Cross-report | `/api/reports/payroll` (lines 240-256) | `commissionTotal` per employee |
| 10. Cross-report | `/api/reports/employees` (lines 137-148) | Per-employee stats |
| 11. UI | ShiftCloseoutModal (lines 719-724, 757-769) | Shown during shift close |

### Template Pattern: Tip Shares Report

The tip-shares report (`/api/reports/tip-shares/route.ts`, 400 lines) is the closest template for commission enhancements:
- **Same structure**: Date range + employee filter + status filter
- **Grouping**: `byRecipient` and `byGiver` dual grouping
- **Actions**: POST handler with `mark_paid` / `mark_paid_all` (lines 317-396)
- **Location settings**: Reads `settings.tipShares.payoutMethod` for behavior toggle

### Gaps and Enhancement Opportunities

| Gap | Severity | Notes |
|-----|----------|-------|
| No permission check on commission report | Medium | Should require `REPORTS_COMMISSION` (exists in auth-utils.ts line 73) |
| No employee filter in UI | Low | API already supports `employeeId` param |
| No "mark as paid" workflow | Medium | Unlike tip-shares, no payout tracking for commissions |
| No modifier-level commission in report | Low | API only shows MenuItem commission, not Modifier commission |
| Fallback recalculation in report API | Low | Lines 105-112 recalculate if `commissionAmount === 0` — indicates commission may not always persist to OrderItem |
| No commission on Shift closeout summary | Low | ShiftCloseoutModal shows it, but shift API doesn't aggregate it separately |

### Recommendation

The commission report is **already functional**. Priority enhancements:
1. **P1**: Add `requireAnyPermission(REPORTS_COMMISSION)` auth check to API route
2. **P1**: Add employee filter dropdown to UI page
3. **P2**: Add "mark as paid" workflow (follow tip-shares pattern — add `commissionPaidAt` field or separate `CommissionPayout` model)
4. **P3**: Include modifier-level commission breakdown in report detail

---

## Phase 3A: Report Auth Audit

### Finding: ZERO report endpoints have auth gating

All 22 report API routes under `src/app/api/reports/` are completely unprotected. None call `requirePermission`, `requireAnyPermission`, `requireAuth`, or any auth middleware. Any unauthenticated request with a valid `locationId` can pull full financial data.

### All Report Endpoints (22 total, 0 protected)

| # | Route | Methods | Sensitive Data | Recommended Permission |
|---|-------|---------|----------------|----------------------|
| 1 | `/api/reports/commission` | GET | Employee commission earnings | `REPORTS_COMMISSION` |
| 2 | `/api/reports/daily` | GET | Full daily P&L, cash, tips, voids | `REPORTS_VIEW` or `ADMIN` |
| 3 | `/api/reports/sales` | GET | Revenue by category/item | `REPORTS_SALES` |
| 4 | `/api/reports/employee-shift` | GET | Individual shift sales, tips, hours | `REPORTS_SALES_BY_EMPLOYEE` |
| 5 | `/api/reports/employees` | GET | Per-employee sales + commission | `REPORTS_SALES_BY_EMPLOYEE` |
| 6 | `/api/reports/labor` | GET | Hours, wages, overtime | `REPORTS_LABOR` |
| 7 | `/api/reports/payroll` | GET | Wages, tips, commissions, tip shares | `REPORTS_LABOR` or `ADMIN` |
| 8 | `/api/reports/tips` | GET | Tip amounts by employee | `REPORTS_SALES_BY_EMPLOYEE` |
| 9 | `/api/reports/tip-shares` | GET, POST | Tip distribution, mark-as-paid | `REPORTS_SALES_BY_EMPLOYEE` |
| 10 | `/api/reports/voids` | GET | Void/comp history with reasons | `REPORTS_VOIDS` |
| 11 | `/api/reports/product-mix` | GET | Item sales mix | `REPORTS_PRODUCT_MIX` |
| 12 | `/api/reports/pmix` | GET | Product mix with food cost % | `REPORTS_PRODUCT_MIX` |
| 13 | `/api/reports/discounts` | GET | Discount usage | `REPORTS_SALES` |
| 14 | `/api/reports/coupons` | GET | Coupon usage | `REPORTS_SALES` |
| 15 | `/api/reports/customers` | GET | Customer data + spend history | `REPORTS_CUSTOMERS` |
| 16 | `/api/reports/liquor` | GET | Liquor sales + pour data | `REPORTS_INVENTORY` |
| 17 | `/api/reports/order-history` | GET | Full order history | `REPORTS_VIEW` |
| 18 | `/api/reports/tables` | GET | Table turn times, revenue | `REPORTS_VIEW` |
| 19 | `/api/reports/reservations` | GET | Reservation data | `REPORTS_VIEW` |
| 20 | `/api/reports/transfers` | GET | Tab/order transfers | `REPORTS_VIEW` |
| 21 | `/api/reports/theoretical-usage` | GET | Theoretical vs actual inventory | `REPORTS_INVENTORY` |
| 22 | `/api/reports/variance` | GET | Inventory variance | `REPORTS_INVENTORY` |

### Existing Permissions (from `src/lib/auth-utils.ts` lines 69-82)

```
REPORTS_VIEW, REPORTS_SALES, REPORTS_SALES_BY_EMPLOYEE, REPORTS_LABOR,
REPORTS_COMMISSION, REPORTS_PRODUCT_MIX, REPORTS_INVENTORY, REPORTS_TIMESHEET,
REPORTS_TABS, REPORTS_PAID_IN_OUT, REPORTS_CUSTOMERS, REPORTS_VOIDS,
REPORTS_GIFT_CARDS, REPORTS_EXPORT
```

14 report permissions already defined — none are enforced.

### Special Concern: POST on tip-shares

`/api/reports/tip-shares` has a POST handler (`mark_paid` / `mark_paid_all`) that **mutates data** (updates TipShare and TipBank status to `paid_out`). This is a write operation with no auth — any request can mark tip shares as paid.

### Implementation Pattern

Each route needs 2 lines added at the top of each handler:

```typescript
import { requireAnyPermission } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = await requireAnyPermission(request, ['REPORTS_VIEW', 'REPORTS_SALES'])
  if (authError) return authError
  // ... existing code
}
```

### Builder Task Recommendation

This is a mechanical task — add auth to all 22 routes. Can be done as a single worker prompt with a table mapping route → permission(s). Estimated effort: ~1 hour. High impact for security posture.

---

## Phase 3A: Full API Auth Audit (Non-Report Routes)

### Summary

Out of ~100+ API route files under `src/app/api/` (excluding reports), only **8 have auth gating**. The vast majority of endpoints — including those handling money, employee data, roles/permissions, inventory, and system settings — are completely unprotected.

### Routes WITH Auth (8 files — the good ones)

| Route | Auth Check | Permission |
|-------|-----------|------------|
| `/api/orders/[id]/pay` | `requireAnyPermission` | `POS_ACCESS`, `MGR_CLOSE_CHECKS` |
| `/api/orders/[id]/comp-void` | `requirePermission` | `POS_ACCESS` + `MGR_VOID_ITEMS` for approver |
| `/api/orders/[id]/transfer-ownership` | `requirePermission` | `MGR_TRANSFER_CHECKS` |
| `/api/orders/[id]/transfer-items` | `requirePermission` | `MGR_TRANSFER_CHECKS` |
| `/api/orders/[id]/merge` | `requirePermission` | `MGR_BULK_OPERATIONS` |
| `/api/orders/[id]/timeline` | `requirePermission` | `MGR_SHIFT_REVIEW` |
| `/api/shifts/[id]` | `requireAnyPermission` | `MGR_SHIFT_REVIEW`, `MGR_CASH_DRAWER_FULL` (close only) |
| `/api/settings` | `requirePermission` | `ADMIN` (PUT only) |
| `/api/audit/activity` | `requirePermission` | `MGR_SHIFT_REVIEW` |

### CRITICAL: Unprotected Money/Sensitive Endpoints

#### Tier 1 — Money Operations (HIGHEST RISK)

| Route | Methods | Risk | What's Exposed |
|-------|---------|------|----------------|
| `/api/orders/[id]/payments` | GET | High | Payment details, card last4, tip amounts |
| `/api/gift-cards` | GET, POST | High | Create gift cards, view balances |
| `/api/gift-cards/[id]` | GET, PUT | High | Modify gift card balances |
| `/api/chargebacks` | POST | High | Create chargeback records |
| `/api/discounts` | GET, POST | High | Create discount rules |
| `/api/discounts/[id]` | GET, PUT, DELETE | High | Modify/delete discounts |
| `/api/coupons` | GET, POST | High | Create coupons |
| `/api/coupons/[id]` | GET, PUT, DELETE | High | Modify/delete coupons |
| `/api/tax-rules` | GET, POST | High | Create tax rules |
| `/api/tax-rules/[id]` | PUT, DELETE | High | Modify/delete tax rules |
| `/api/tip-out-rules` | GET, POST | High | Create tip-out distribution rules |
| `/api/tip-out-rules/[id]` | GET, PUT, DELETE | High | Modify/delete tip-out rules |

#### Tier 2 — Employee/Access Control (HIGH RISK)

| Route | Methods | Risk | What's Exposed |
|-------|---------|------|----------------|
| `/api/employees` | GET, POST | High | List all employees, create new ones |
| `/api/employees/[id]` | GET, PUT, DELETE | High | Modify/delete employees |
| `/api/employees/[id]/payment` | GET, PUT | High | Employee payment/wage info |
| `/api/employees/[id]/tips` | GET, POST | Medium | Employee tip records |
| `/api/roles` | GET, POST | High | Create roles (permission sets) |
| `/api/roles/[id]` | GET, PUT, DELETE | High | Modify/delete roles + permissions |
| `/api/payroll/periods` | GET, POST | High | Payroll period data |
| `/api/payroll/periods/[id]` | GET, PUT | High | Modify payroll periods |
| `/api/payroll/pay-stubs/[id]/pdf` | GET | High | Employee pay stubs |
| `/api/schedules` | GET, POST | Medium | Employee schedules |

#### Tier 3 — Inventory/Operations (MEDIUM RISK)

| Route | Methods | Risk | What's Exposed |
|-------|---------|------|----------------|
| `/api/inventory` | GET | Medium | Inventory levels |
| `/api/inventory/stock-adjust` | POST | Medium | Adjust stock levels (writes) |
| `/api/ingredients` | GET, POST | Low | Ingredient library |
| `/api/ingredients/[id]` | GET, PUT, DELETE | Medium | Modify/delete ingredients |
| `/api/liquor/categories` | GET, POST | Low | Liquor categories |
| `/api/liquor/recipes` | GET, POST | Low | Liquor recipes |
| `/api/stock-alerts` | GET | Low | Stock alert thresholds |

#### Tier 4 — Order Operations (MEDIUM RISK)

| Route | Methods | Risk | What's Exposed |
|-------|---------|------|----------------|
| `/api/orders` | GET, POST | Medium | Create orders, list orders |
| `/api/orders/[id]` | GET, PUT | Medium | Modify order metadata |
| `/api/orders/[id]/items` | GET, POST | Medium | Add items to orders |
| `/api/orders/[id]/items/[itemId]` | PUT | Medium | Modify order items |
| `/api/orders/[id]/send` | POST | Medium | Send to kitchen |
| `/api/orders/[id]/receipt` | GET | Low | View receipts |
| `/api/orders/[id]/customer` | GET, PUT | Low | Order customer link |
| `/api/tabs/[id]` | GET, PUT | Medium | Tab operations |
| `/api/tabs/[id]/transfer` | POST | Medium | Transfer tabs (no auth!) |

#### Tier 5 — Configuration (MEDIUM RISK)

| Route | Methods | Risk | What's Exposed |
|-------|---------|------|----------------|
| `/api/order-types` | GET, POST | Medium | Create order types |
| `/api/order-types/[id]` | PUT, DELETE | Medium | Modify/delete order types |
| `/api/hardware/printers/[id]` | GET, PUT, DELETE | Medium | Printer config |
| `/api/hardware/printers/[id]/ping` | POST | Low | Ping printer |
| `/api/hardware/kds-screens` | GET, POST | Medium | KDS screen config |
| `/api/hardware/kds-screens/[id]` | GET, PUT, DELETE | Medium | Modify KDS screens |
| `/api/customers` | GET, POST | Medium | Customer PII |
| `/api/customers/[id]` | GET, PUT, DELETE | Medium | Modify customer PII |
| `/api/events` | GET, POST | Low | Event management |
| `/api/events/[id]/tickets/purchase` | POST | Medium | Ticket purchases |

#### Notable: `/api/admin/fix-commissions`

| Route | Methods | Risk |
|-------|---------|------|
| `/api/admin/fix-commissions` | POST(?) | High — Admin fix endpoint with no auth |

### Key Statistics

| Metric | Count |
|--------|-------|
| Total non-report API route files | ~100+ |
| Files WITH auth | 8 (plus 2 report files = 10 total) |
| Files WITHOUT auth | ~90+ |
| Tier 1 (money) unprotected | 12 routes |
| Tier 2 (employee/access) unprotected | 10 routes |
| Write endpoints (POST/PUT/DELETE) without auth | ~60+ |

### Implementation Priority

1. **Immediate (Tier 1)**: Gift cards, chargebacks, discounts, coupons, tax rules, tip-out rules — direct money manipulation
2. **Urgent (Tier 2)**: Employees, roles, payroll — access control and wage data
3. **Important (Tier 3-4)**: Inventory adjustments, order operations, tab transfers
4. **Standard (Tier 5)**: Configuration, hardware, events

### Pattern Note

The existing auth implementation uses a **body-based pattern** (not header/cookie):
```typescript
const { employeeId } = await request.json()  // or searchParams
const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SOME_PERM)
if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: 403 })
```

This is a trust-the-client pattern — the client sends its own employeeId. For local POS (trusted network) this is acceptable for Phase 1. For production with remote access, session-based auth with httpOnly cookies would be needed.

---

## Phase 3A: Permission-to-Route Mapping

Definitive mapping of every permission key in `auth-utils.ts` (lines 36-155) to the API routes it should protect. Builder should use this as the reference when auth-gating.

### Permission Inventory

The codebase defines **~70+ permissions** across 12 categories, not just the 14 report keys. Full list from `src/lib/auth-utils.ts`:

| Category | Count | Keys |
|----------|-------|------|
| POS | 9 | `POS_ACCESS`, `POS_TABLE_SERVICE`, `POS_QUICK_ORDER`, `POS_KDS`, `POS_CASH_PAYMENTS`, `POS_CARD_PAYMENTS`, `POS_CASH_DRAWER`, `POS_VIEW_OTHERS_ORDERS`, `POS_APPLY_DISCOUNTS` |
| Manager | 17 | `MGR_VOID_ITEMS`, `MGR_VOID_PAYMENTS`, `MGR_REFUNDS`, `MGR_EDIT_SENT_ITEMS`, `MGR_TRANSFER_CHECKS`, `MGR_BULK_OPERATIONS`, `MGR_SHIFT_REVIEW`, `MGR_CASH_DRAWER_BLIND/FULL`, `MGR_CASH_VARIANCE_OVERRIDE`, `MGR_PAY_IN_OUT`, `MGR_CLOSE_DAY`, `MGR_TAX_EXEMPT`, `MGR_OPEN_ITEMS`, `MGR_EDIT_TIME_ENTRIES`, `MGR_END_BREAKS_EARLY`, `MGR_FORCE_CLOCK_OUT`, `MGR_RECEIVE_TRANSFERS` |
| Reports | 14 | `REPORTS_VIEW`, `REPORTS_SALES`, `REPORTS_SALES_BY_EMPLOYEE`, `REPORTS_LABOR`, `REPORTS_COMMISSION`, `REPORTS_PRODUCT_MIX`, `REPORTS_INVENTORY`, `REPORTS_TIMESHEET`, `REPORTS_TABS`, `REPORTS_PAID_IN_OUT`, `REPORTS_CUSTOMERS`, `REPORTS_VOIDS`, `REPORTS_GIFT_CARDS`, `REPORTS_EXPORT` |
| Menu | 6 | `MENU_VIEW`, `MENU_EDIT_ITEMS`, `MENU_EDIT_PRICES`, `MENU_EDIT_MODIFIERS`, `MENU_INVENTORY_QTY`, `MENU_86_ITEMS` |
| Staff | 7 | `STAFF_VIEW`, `STAFF_EDIT_PROFILE`, `STAFF_EDIT_WAGES`, `STAFF_MANAGE_ROLES`, `STAFF_ASSIGN_ROLES`, `STAFF_SCHEDULING`, `STAFF_CLOCK_OTHERS` |
| Tables | 4 | `TABLES_VIEW`, `TABLES_EDIT`, `TABLES_FLOOR_PLAN`, `TABLES_RESERVATIONS` |
| Settings | 6 | `SETTINGS_VIEW`, `SETTINGS_EDIT`, `SETTINGS_TAX`, `SETTINGS_RECEIPTS`, `SETTINGS_PAYMENTS`, `SETTINGS_DUAL_PRICING` |
| Tips | 6 | `TIPS_VIEW_OWN`, `TIPS_VIEW_ALL`, `TIPS_SHARE`, `TIPS_COLLECT`, `TIPS_MANAGE_RULES`, `TIPS_MANAGE_BANK` |
| Inventory | 7 | `INVENTORY_VIEW`, `INVENTORY_MANAGE`, `INVENTORY_COUNTS`, `INVENTORY_ADJUST_PREP_STOCK`, `INVENTORY_WASTE`, `INVENTORY_TRANSACTIONS`, `INVENTORY_VENDORS` |
| Customers | 5 | `CUSTOMERS_VIEW`, `CUSTOMERS_EDIT`, `CUSTOMERS_GIFT_CARDS`, `CUSTOMERS_HOUSE_ACCOUNTS`, `CUSTOMERS_COUPONS` |
| Events | 2 | `EVENTS_VIEW`, `EVENTS_MANAGE` |
| Scheduling | 2 | `SCHEDULING_VIEW`, `SCHEDULING_MANAGE` |
| Payroll | 2 | `PAYROLL_VIEW`, `PAYROLL_MANAGE` |
| Admin | 3 | `ADMIN`, `MANAGER`, `SUPER_ADMIN` |

### Report Routes → Permissions (22 routes)

| Route | GET | POST | Permission(s) |
|-------|-----|------|---------------|
| `/api/reports/daily` | Y | - | `REPORTS_VIEW` |
| `/api/reports/sales` | Y | - | `REPORTS_SALES` |
| `/api/reports/employee-shift` | Y | - | `REPORTS_SALES_BY_EMPLOYEE` |
| `/api/reports/employees` | Y | - | `REPORTS_SALES_BY_EMPLOYEE` |
| `/api/reports/labor` | Y | - | `REPORTS_LABOR` |
| `/api/reports/payroll` | Y | - | `REPORTS_LABOR` or `PAYROLL_VIEW` |
| `/api/reports/commission` | Y | - | `REPORTS_COMMISSION` |
| `/api/reports/product-mix` | Y | - | `REPORTS_PRODUCT_MIX` |
| `/api/reports/pmix` | Y | - | `REPORTS_PRODUCT_MIX` |
| `/api/reports/tips` | Y | - | `TIPS_VIEW_ALL` |
| `/api/reports/tip-shares` | Y | Y | GET: `TIPS_VIEW_ALL`, POST: `TIPS_MANAGE_BANK` |
| `/api/reports/voids` | Y | - | `REPORTS_VOIDS` |
| `/api/reports/discounts` | Y | - | `REPORTS_SALES` |
| `/api/reports/coupons` | Y | - | `REPORTS_SALES` |
| `/api/reports/customers` | Y | - | `REPORTS_CUSTOMERS` |
| `/api/reports/liquor` | Y | - | `REPORTS_INVENTORY` |
| `/api/reports/order-history` | Y | - | `REPORTS_VIEW` |
| `/api/reports/tables` | Y | - | `REPORTS_VIEW` |
| `/api/reports/reservations` | Y | - | `REPORTS_VIEW` |
| `/api/reports/transfers` | Y | - | `REPORTS_VIEW` |
| `/api/reports/theoretical-usage` | Y | - | `REPORTS_INVENTORY` |
| `/api/reports/variance` | Y | - | `REPORTS_INVENTORY` |

### Tier 1 Money Routes → Permissions

| Route | Method | Permission (GET/read) | Permission (POST/PUT/DELETE/write) |
|-------|--------|----------------------|------------------------------------|
| `/api/gift-cards` | GET, POST | `CUSTOMERS_GIFT_CARDS` | `CUSTOMERS_GIFT_CARDS` |
| `/api/gift-cards/[id]` | GET, PUT | `CUSTOMERS_GIFT_CARDS` | `CUSTOMERS_GIFT_CARDS` |
| `/api/chargebacks` | POST | - | `MGR_REFUNDS` |
| `/api/discounts` | GET, POST | `POS_APPLY_DISCOUNTS` | `MENU_EDIT_PRICES` |
| `/api/discounts/[id]` | GET, PUT, DELETE | `POS_APPLY_DISCOUNTS` | `MENU_EDIT_PRICES` |
| `/api/coupons` | GET, POST | `CUSTOMERS_COUPONS` | `CUSTOMERS_COUPONS` |
| `/api/coupons/[id]` | GET, PUT, DELETE | `CUSTOMERS_COUPONS` | `CUSTOMERS_COUPONS` |
| `/api/tax-rules` | GET, POST | `SETTINGS_TAX` | `SETTINGS_TAX` |
| `/api/tax-rules/[id]` | PUT, DELETE | - | `SETTINGS_TAX` |
| `/api/tip-out-rules` | GET, POST | `TIPS_VIEW_ALL` | `TIPS_MANAGE_RULES` |
| `/api/tip-out-rules/[id]` | GET, PUT, DELETE | `TIPS_VIEW_ALL` | `TIPS_MANAGE_RULES` |

### Tier 2 Employee/Access Routes → Permissions

| Route | Method | Permission (read) | Permission (write) |
|-------|--------|-------------------|-------------------|
| `/api/employees` | GET, POST | `STAFF_VIEW` | `STAFF_EDIT_PROFILE` |
| `/api/employees/[id]` | GET, PUT, DELETE | `STAFF_VIEW` | PUT: `STAFF_EDIT_PROFILE`, DELETE: `ADMIN` |
| `/api/employees/[id]/payment` | GET, PUT | `STAFF_EDIT_WAGES` | `STAFF_EDIT_WAGES` |
| `/api/employees/[id]/tips` | GET, POST | `TIPS_VIEW_OWN` (own) / `TIPS_VIEW_ALL` (others) | `TIPS_SHARE` |
| `/api/employees/[id]/open-tabs` | GET, POST | `POS_VIEW_OTHERS_ORDERS` | `MGR_TRANSFER_CHECKS` |
| `/api/roles` | GET, POST | `STAFF_VIEW` | `STAFF_MANAGE_ROLES` |
| `/api/roles/[id]` | GET, PUT, DELETE | `STAFF_VIEW` | `STAFF_MANAGE_ROLES` |
| `/api/payroll/periods` | GET, POST | `PAYROLL_VIEW` | `PAYROLL_MANAGE` |
| `/api/payroll/periods/[id]` | GET, PUT | `PAYROLL_VIEW` | `PAYROLL_MANAGE` |
| `/api/payroll/pay-stubs/[id]/pdf` | GET | `PAYROLL_VIEW` | - |
| `/api/schedules` | GET, POST | `SCHEDULING_VIEW` | `SCHEDULING_MANAGE` |
| `/api/schedules/[id]` | GET, PUT, DELETE | `SCHEDULING_VIEW` | `SCHEDULING_MANAGE` |
| `/api/schedules/[id]/shifts` | GET, POST | `SCHEDULING_VIEW` | `SCHEDULING_MANAGE` |

### Tier 3 Inventory/Operations → Permissions

| Route | Method | Permission (read) | Permission (write) |
|-------|--------|-------------------|-------------------|
| `/api/inventory` | GET | `INVENTORY_VIEW` | - |
| `/api/inventory/stock-adjust` | POST | - | `INVENTORY_COUNTS` |
| `/api/inventory/settings` | GET, POST | `INVENTORY_VIEW` | `INVENTORY_MANAGE` |
| `/api/ingredients` | GET, POST | `INVENTORY_VIEW` | `INVENTORY_MANAGE` |
| `/api/ingredients/[id]` | GET, PUT, DELETE | `INVENTORY_VIEW` | `INVENTORY_MANAGE` |
| `/api/ingredients/bulk-parent` | PUT | - | `INVENTORY_MANAGE` |
| `/api/stock-alerts` | GET | `INVENTORY_VIEW` | - |
| `/api/liquor/categories` | GET, POST | `MENU_VIEW` | `MENU_EDIT_ITEMS` |
| `/api/liquor/recipes` | GET, POST | `MENU_VIEW` | `MENU_EDIT_ITEMS` |
| `/api/liquor/upsells` | GET, POST | `MENU_VIEW` | `MENU_EDIT_ITEMS` |

### Tier 4 Order Operations → Permissions

| Route | Method | Permission (read) | Permission (write) |
|-------|--------|-------------------|-------------------|
| `/api/orders` | GET, POST | `POS_ACCESS` | `POS_ACCESS` |
| `/api/orders/[id]` | GET, PUT | `POS_ACCESS` | `POS_ACCESS` |
| `/api/orders/[id]/items` | GET, POST | `POS_ACCESS` | `POS_ACCESS` |
| `/api/orders/[id]/items/[itemId]` | PUT | - | `POS_ACCESS` |
| `/api/orders/[id]/send` | POST | - | `POS_ACCESS` |
| `/api/orders/[id]/receipt` | GET | `POS_ACCESS` | - |
| `/api/orders/[id]/payments` | GET | `POS_ACCESS` | - |
| `/api/orders/[id]/customer` | GET, PUT | `POS_ACCESS` | `POS_ACCESS` |
| `/api/tabs/[id]` | GET, PUT | `POS_ACCESS` | `POS_ACCESS` |
| `/api/tabs/[id]/transfer` | POST | - | `MGR_TRANSFER_CHECKS` |
| `/api/time-clock` | GET, POST, PUT | `POS_ACCESS` | `POS_ACCESS` (own) / `STAFF_CLOCK_OTHERS` (others) |
| `/api/breaks` | GET, POST, PUT | `POS_ACCESS` | `POS_ACCESS` |
| `/api/shifts` | GET, POST | `POS_ACCESS` | `POS_ACCESS` |
| `/api/timed-sessions` | GET, POST | `POS_ACCESS` | `POS_ACCESS` |
| `/api/timed-sessions/[id]` | GET, PUT | `POS_ACCESS` | `POS_ACCESS` |

### Tier 5 Configuration → Permissions

| Route | Method | Permission (read) | Permission (write) |
|-------|--------|-------------------|-------------------|
| `/api/order-types` | GET, POST | `POS_ACCESS` | `SETTINGS_EDIT` |
| `/api/order-types/[id]` | PUT, DELETE | - | `SETTINGS_EDIT` |
| `/api/hardware/printers/[id]` | GET, PUT, DELETE | `SETTINGS_VIEW` | `SETTINGS_EDIT` |
| `/api/hardware/printers/[id]/ping` | POST | `SETTINGS_VIEW` | - |
| `/api/hardware/printers/[id]/test` | POST | `SETTINGS_VIEW` | - |
| `/api/hardware/kds-screens` | GET, POST | `SETTINGS_VIEW` | `SETTINGS_EDIT` |
| `/api/hardware/kds-screens/[id]` | GET, PUT, DELETE | `SETTINGS_VIEW` | `SETTINGS_EDIT` |
| `/api/hardware/kds-screens/[id]/generate-code` | POST | - | `SETTINGS_EDIT` |
| `/api/hardware/kds-screens/[id]/unpair` | POST | - | `SETTINGS_EDIT` |
| `/api/customers` | GET, POST | `CUSTOMERS_VIEW` | `CUSTOMERS_EDIT` |
| `/api/customers/[id]` | GET, PUT, DELETE | `CUSTOMERS_VIEW` | `CUSTOMERS_EDIT` |
| `/api/house-accounts/[id]` | GET, PUT | `CUSTOMERS_HOUSE_ACCOUNTS` | `CUSTOMERS_HOUSE_ACCOUNTS` |
| `/api/events` | GET, POST | `EVENTS_VIEW` | `EVENTS_MANAGE` |
| `/api/events/[id]` | GET, PUT, DELETE | `EVENTS_VIEW` | `EVENTS_MANAGE` |
| `/api/events/[id]/tickets/purchase` | POST | - | `EVENTS_MANAGE` |
| `/api/events/[id]/tickets/hold` | POST | - | `EVENTS_MANAGE` |
| `/api/events/[id]/tickets/release` | POST | - | `EVENTS_MANAGE` |
| `/api/events/[id]/publish` | POST | - | `EVENTS_MANAGE` |
| `/api/events/[id]/availability` | GET | `EVENTS_VIEW` | - |
| `/api/events/[id]/conflicts` | GET | `EVENTS_VIEW` | - |
| `/api/reservations` | GET, POST | `TABLES_RESERVATIONS` | `TABLES_RESERVATIONS` |
| `/api/reservations/[id]` | GET, PUT, DELETE | `TABLES_RESERVATIONS` | `TABLES_RESERVATIONS` |
| `/api/combos` | GET, POST | `MENU_VIEW` | `MENU_EDIT_ITEMS` |
| `/api/combos/[id]` | GET, PUT, DELETE | `MENU_VIEW` | `MENU_EDIT_ITEMS` |
| `/api/pizza/*` (8 routes) | GET, POST, PUT, DELETE | `MENU_VIEW` | `MENU_EDIT_ITEMS` |
| `/api/prep-stations` | GET, POST | `SETTINGS_VIEW` | `SETTINGS_EDIT` |
| `/api/prep-stations/[id]` | GET, PUT, DELETE | `SETTINGS_VIEW` | `SETTINGS_EDIT` |

### Admin/Fix Routes

| Route | Method | Permission |
|-------|--------|------------|
| `/api/admin/fix-commissions` | POST | `ADMIN` |

### Menu Routes (not listed above, also unprotected)

Menu CRUD routes under `/api/menu/` should use `MENU_VIEW` (read) and `MENU_EDIT_ITEMS`/`MENU_EDIT_PRICES`/`MENU_EDIT_MODIFIERS` (write). Not enumerated individually here since they follow the same pattern.

### Unused Permission Keys

These permission keys exist in `auth-utils.ts` but have no obvious route mapping:

| Permission | Notes |
|-----------|-------|
| `REPORTS_TABS` | No `/api/reports/tabs` route exists |
| `REPORTS_PAID_IN_OUT` | No `/api/reports/paid-in-out` route exists |
| `REPORTS_GIFT_CARDS` | No `/api/reports/gift-cards` route exists |
| `REPORTS_TIMESHEET` | No `/api/reports/timesheet` route (labor covers this) |
| `REPORTS_EXPORT` | Cross-cutting (export from any report) — UI-only gating |
| `INVENTORY_WASTE` | Waste logging (covered by comp-void route's waste tracking) |
| `INVENTORY_TRANSACTIONS` | No dedicated route (transactions are auto-created) |
| `INVENTORY_VENDORS` | No vendor routes exist yet |

### Implementation Notes for Builder

1. **Read vs Write split**: Most routes need different permissions for GET vs POST/PUT/DELETE. Use `requireAnyPermission` for read with fallback to broader key (e.g., `REPORTS_VIEW` covers all report reads).
2. **Self-access pattern**: For `/api/employees/[id]/tips`, employee should always see own tips (`TIPS_VIEW_OWN`), but need `TIPS_VIEW_ALL` for others. Check `employeeId === params.id`.
3. **GET on order-types, menu items**: These are needed by the POS to render the UI, so `POS_ACCESS` is sufficient — don't require admin permissions for reads.
4. **KDS auth routes**: `/api/hardware/kds-screens/pair` and `/api/hardware/kds-screens/auth` should remain unprotected — they ARE the auth mechanism for KDS devices.
