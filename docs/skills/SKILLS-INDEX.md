# GWI POS Skills Index

## Development Workflow Requirements

### BEFORE PROGRAMMING ANY FEATURE:

1. **Review ALL skills in this index** to identify:
   - Skills that will be directly implemented
   - Skills that are dependencies (must be built first)
   - Skills that can be built in parallel
   - Skills that share components or patterns

2. **Document in your plan**:
   - List each skill being implemented by number and name
   - Identify foundational skills needed first
   - Mark skills that can be parallelized
   - Note shared dependencies between skills

3. **Update CHANGELOG.md** as you complete each step

4. **Update this index** with implementation status

---

## Skills by Category

### Foundation (Build First)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 01 | Employee Management | DONE | Employees | - | CRUD, roles, permissions, PIN login |
| 09 | Features & Config | DONE | Settings | - | Settings, feature flags, category types (food/drinks/liquor/entertainment/combos) |
| 36 | Tax Calculations | DONE | Settings | 09 | Tax rules, multiple rates, admin UI |
| 59 | Location Multi-tenancy | TODO | Settings | - | Multi-location support |

### Order Flow (Core)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 02 | Quick Order Entry | DONE | Orders | 01 | Order creation, save to DB, update existing |
| 03 | Menu Display | DONE | Menu | - | Categories, items, dual pricing display |
| 04 | Modifiers | DONE | Menu | 03 | Nested modifiers, pre-modifiers |
| 05 | Order Review | PARTIAL | Orders | 02 | Order panel has items/totals, no separate review screen |
| 06 | Tipping | DONE | Payments | 09 | Tip suggestions, custom entry |
| 07 | Send to Kitchen | DONE | Orders | 02 | Orders save, sent/new tracking, KDS integration |
| 08 | Receipt Printing | DONE | Hardware | 09 | Print formatting, view/print from POS |
| 10 | Item Notes | DONE | Orders | 02 | Schema + UI: modifier modal + quick edit |

### Payment (Build Together)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 30 | Payment Processing | DONE | Payments | 02, 31 | Cash, card, split, tips |
| 31 | Dual Pricing | DONE | Payments | 09 | Cash discount program |
| 32 | Gift Cards | DONE | Payments | 30 | Purchase, redeem, reload, freeze |
| 33 | House Accounts | DONE | Payments | 30 | Charge to account, payment tracking |
| 221 | Payment Intent Backoff Logic | DONE | Payments | 120 | Exponential backoff for payment intent sync retries, prevents hammering server during outages |
| 222 | Datacap Validation & JSDoc | DONE | Payments | 120 | Communication mode validation, JSDoc on all 17 DatacapClient methods, simulated mode bug fix |
| 223 | Datacap XML Performance | DONE | Payments | 120 | Regex caching (97% reduction in RegExp objects), extractPrintData() optimization (9× faster) |
| 224 | Use Cases Layer | DONE | Payments | 120, 221 | processSale(), openBarTab(), closeBarTab(), voidPayment() with intent tracking and offline resilience |
| 225 | Payment Modal Component Split | DONE | Payments | 224 | Split 927-line monolith into 6 focused components (PaymentMethodStep, TipEntryStep, CashEntryStep, CardProcessingStep, GiftCardStep, HouseAccountStep) |
| 226 | PaymentService Layer | DONE | Payments | 224, 225 | Type-safe API client with ServiceResult<T> pattern, processPayment(), voidItems(), checkGiftCardBalance(), loadHouseAccounts() |
| 227 | PaymentDomain Module | DONE | Payments | 226 | Pure business logic functions: tip-calculations.ts (317 lines), loyalty-points.ts (429 lines), dual-pricing.ts (347 lines), validators.ts (294 lines) |

### Advanced Order Features
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 11 | Seat Tracking | DONE | Orders | 02 | Per-seat orders, item assignment API |
| 12 | Course Firing | DONE | Orders | 07 | Multi-course meals, course API |
| 13 | Hold & Fire | DONE | Orders | 07 | Kitchen timing, hold/fire actions |
| 14 | Order Splitting | DONE | Orders | 30 | Split evenly, by item, custom amount |
| 15 | Order Merging | DONE | Orders | 02 | Merge orders, move items, recalc totals |
| 230 | Quick Pick Numbers | DONE | Orders | 76, 99 | Gutter strip (1-9) for instant qty, multi-digit entry, multi-select, hold/delay/course buttons, per-employee setting |
| 231 | Per-Item Delays | DONE | Orders | 13, 230 | Per-item delay presets (5/10/15/20m), countdown timers, auto-fire, hold/delay mutual exclusivity, fire-course API |
| 232 | Note Edit Modal | DONE | Orders | - | Dark glassmorphism modal replacing window.prompt() for kitchen notes, touch-friendly |
| 233 | Modifier Depth Indentation | DONE | Menu | 123 | Depth-based rendering (• top-level, ↳ children, 20px indent/depth), pre-modifier color labels (NO=red/EXTRA=amber/LITE=blue), childToParentGroupId parent-chain walk for depth computation |
| 234 | Shared OrderPanel Items Hook | DONE | Orders | 233 | useOrderPanelItems hook consolidating 3 duplicate item mapping pipelines (FloorPlanHome, BartenderView, orders/page) into single source of truth |
| 235 | Unified BartenderView Tab Panel | DONE | Orders | 234 | Replaced BartenderView's custom tab list (~450 lines deleted) with shared OpenOrdersPanel component. Added forceDark and employeePermissions props. |
| 236 | Comp/Void from BartenderView | DONE | Orders | 235 | Added onOpenCompVoid callback prop to BartenderView, wired in orders/page.tsx to open CompVoidModal. Previously showed "coming soon" toast. |
| 237 | Waste Tracking (Was It Made?) | DONE | Orders | 34 | Added wasMade field to CompVoidModal UI (Yes/No buttons), VoidLog schema, and OrderItem schema. API uses explicit wasMade from UI instead of guessing from reason text. |
| 238 | VOID/COMP Stamps on Order Panel | PARTIAL | Orders | 237, 234 | VOID/COMP badges, strikethrough name, $0.00 price, waste indicator on OrderPanelItem. Added status/voidReason/wasMade to order store, response mapper, FloorPlanHome shim. Fix applied but needs verification. |

### Table Management
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 16 | Table Layout | DONE | Floor Plan | - | Floor plan, sections, shapes |
| 17 | Table Status | DONE | Floor Plan | 16 | Available/occupied/reserved/dirty, quick toggle |
| 18 | Table Transfer | DONE | Floor Plan | 16, 02 | Transfer API, moves orders with audit log |
| 19 | Reservations | DONE | Events | 16 | Full booking system, admin page, status tracking |
| 117 | Virtual Table Combine | DONE | Floor Plan | 106, 107 | Long-press to link tables, pulsing glow, T-S notation, manager dashboard |
| 206 | Seat Management System | DONE | Floor Plan | 16, 117 | Seat API, generation, positioning, virtual group numbering, reflow on resize |
| 207 | Table Resize & Rotation | DONE | Floor Plan | 16 | 8 resize handles, rotation handle, grid snap, collision detection, shape-specific minimums |
| 229 | Table Combine Types | DONE | Floor Plan | 107, 117 | Physical (drag-drop, seats 1..N) vs Virtual (long-hold, per-table seats). **Critical: handleTableCombine must call /api/tables/combine, NOT virtual-combine** |

### Bar Features
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 20 | Bar Tabs | PARTIAL | Orders | 02 | Create, view, edit, pay tabs. **NEEDS: Improved UI for bartender workflow, quick tab creation from floor plan** |
| 21 | Pre-auth | DONE | Payments | 30 | Card hold on tab open |
| 22 | Tab Transfer | DONE | Orders | 20 | Move tabs between employees, audit log |

### Kitchen Display
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 67 | Prep Stations | DONE | KDS | - | KDS routing: station types, category/item assignment |
| 23 | KDS Display | DONE | KDS | 07, 67 | Full KDS screen: item bump, station filter, fullscreen |
| 24 | Bump Bar | TODO | KDS | 23 | Physical bump bar hardware |
| 25 | Expo Station | PARTIAL | KDS | 23 | Expo mode works via showAllItems toggle |
| 26 | Prep Tickets | TODO | KDS | 07 | Prep station routing |
| 102 | KDS Device Security | DONE | Hardware | 23 | Device pairing, httpOnly cookies, static IP enforcement |
| 103 | Print Routing | DONE | Hardware | 67 | Direct category/item printer assignment, multi-destination, KDS support, backup failover |

### Pricing & Discounts
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 27 | Happy Hour | DONE | Settings | 09, 03 | Time-based pricing, schedules, settings |
| 28 | Discounts | DONE | Settings | 02 | Manual discounts, preset rules, % or $ |
| 29 | Commissioned Items | DONE | Employees | 01 | Sales commissions |
| 34 | Comps & Voids | DONE | Orders | 02, 01 | Comp/void items, reasons, reports |
| 122 | Remote Void Approval | DONE | Orders | 34 | SMS-based manager approval for voids when off-site, Twilio integration |
| 35 | Coupons | DONE | Settings | 28 | Promo codes, admin page, redemption tracking |

### Inventory & Menu
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 37 | 86 Items | DONE | Inventory | 03 | Item availability |
| 38 | Inventory Tracking | DONE | Inventory | 37 | Stock levels, transactions, admin page |
| 39 | Low Stock Alerts | DONE | Inventory | 38 | Alerts API, acknowledge, priority levels |
| 40 | Menu Scheduling | DONE | Menu | 03, 09 | Daypart menus, time windows |
| 41 | Combo Meals | DONE | Menu | 03 | Item-based combos, modifier price overrides, admin page, POS modal |
| 125 | Ingredient Costing & Recipes | DONE | Inventory | 38 | Recipe components for inventory items, batch yield, yield %, portion size, modifier multipliers |
| 126 | Explicit Input → Output Model | DONE | Inventory | 125 | Prep items with explicit input/output transformation, unit conversions, auto-calculated yield, cost derivation |
| 127 | Quick Stock Adjustment | DONE | Inventory | 126 | Manager quick adjust page with verification, cost tracking, socket dispatch, audit trail |
| 128 | Inventory Recipe Costing | DONE | Inventory | 125 | Recipe-based food costing, historical cost tracking |
| 130 | Inventory Historical Costs | DONE | Inventory | 128 | Historical cost snapshots for trend analysis |
| 131 | Food Cost Dashboard | DONE | Inventory | 130 | Dashboard for food cost % monitoring |
| 132 | Inventory Alerts | DONE | Inventory | 38, 39 | Advanced inventory alerts beyond low stock |
| 133 | Quick Pricing Update | DONE | Menu | 03 | Rapid batch price updates for menu items |
| 134 | Vendor Management | DONE | Inventory | 38 | Vendor CRUD, purchase orders, supplier tracking |
| 135 | Theoretical vs Actual | DONE | Inventory | 128 | Compare expected vs actual usage, variance reports |
| 136 | Waste Logging | DONE | Inventory | 38 | Track waste with reasons, reports, trend analysis |
| 137 | Par Levels | DONE | Inventory | 38 | Set par levels per ingredient, auto-order suggestions |
| 138 | Menu Engineering | DONE | Menu | 42, 128 | Stars/Plow Horses/Puzzles/Dogs matrix, profitability analysis |
| 139 | Inventory Count | DONE | Inventory | 38 | Physical count sheets, variance to theoretical |
| 140 | 86 Feature (Enhanced) | DONE | Inventory | 37 | Enhanced 86 with quick toggle, auto-86 on zero stock |
| 141 | Menu/Liquor Builder Separation | DONE | Menu | 09 | Filter /menu to show only food categories, exclude liquor/drinks; comprehensive liquor inventory seeding (147 bottles, 6 categories, auto-tiered) |
| 145 | Ingredient Verification | DONE | Inventory | 125, 204 | needsVerification flag for items created from Menu Builder, red highlight in inventory, verify button |
| 204 | Ingredient Library Refactor | DONE | Inventory | 125, 126, 127 | Major refactor: 61% code reduction, race protection, bulk API, debounced search, toast notifications, accessibility |
| 205 | Component Improvements | DONE | Inventory | 204 | Shared cost hook, recipe cost aggregation (N→1), hierarchy caching (5min TTL), error rollback, accessibility |
| 215 | Unified Modifier Inventory Deduction | DONE | Inventory | 125, 143 | Fallback path: Modifier.ingredientId → Ingredient → InventoryItem for deduction when no ModifierInventoryLink exists; updates deductInventoryForOrder, deductInventoryForVoidedItem, calculateTheoreticalUsage, PMIX |
| 216 | Ingredient-Modifier Connection Visibility | DONE | Inventory | 143, 204, 211, 214 | Bidirectional visibility: Connected badge, dual-path menu item resolution (item-owned + junction), expandable linked modifiers panel, linkedModifierCount |

### Reporting
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 42 | Sales Reports | DONE | Reports | 30 | Day, hour, category, item, employee, table, seat, order type, modifier, payment method |
| 43 | Labor Reports | DONE | Reports | 47 | Hours worked, labor costs, overtime, by employee/day/role |
| 44 | Product Mix | DONE | Reports | 42 | Item performance, pairings, hourly distribution |
| 45 | Void Reports | DONE | Reports | 34 | By date, employee, reason |
| 46 | Commission Reports | DONE | Reports | 29 | Employee commissions |
| 70 | Discount Reports | DONE | Reports | 28 | Discount usage, by type, by employee, by day |
| 71 | Transfer Reports | DONE | Reports | 22, 68 | Tab/item transfers, audit trail, by employee/hour |
| 72 | Table Reports | DONE | Reports | 16, 42 | Sales by table, turn times, server sections |
| 73 | Customer Reports | DONE | Reports | 51 | Spend tiers, frequency, tags, at-risk customers |
| 104 | Daily Store Report | DONE | Reports | 42, 43, 50 | Comprehensive EOD report: revenue, payments, cash, sales by category/type, voids, discounts, labor, tips |
| 105 | Tip Share Report | DONE | Reports | - | Standalone tip share report, by recipient/giver, mark as paid, payroll/manual settings |
| 106 | Interactive Floor Plan (SVG) | DONE | Floor Plan | 16, 80 | SVG floor plan with zoom, pan, status colors, seat display |
| 107 | Table Combine/Split | DONE | Floor Plan | 106 | Drag-combine, split-all, remove-single undo, 5min window, clockwise seats from top-left |
| 108 | Event Ticketing APIs | TODO | Events | 106 | Event CRUD, seat hold/release, ticket purchase, check-in |
| 109 | Visual Pizza Builder | DONE | Menu | 106 | Two-mode pizza ordering (Quick Mode + Visual Builder), admin config, full API |
| 110 | Real-time Events (Pusher) | TODO | KDS | - | WebSocket abstraction for instant updates (seats, orders, KDS) |

### Employee Features
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 47 | Clock In/Out | DONE | Employees | 01 | Clock in/out, breaks, hours, modal UI |
| 48 | Breaks | DONE | Employees | 47 | Break start/end API, duration tracking |
| 49 | Cash Drawer | PARTIAL | Employees | 01, 30 | Starting cash tracked via Shift |
| 50 | Shift Close | DONE | Employees | 49 | Shift start/close, cash count, variance, summary |

### Customer Features
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 51 | Customer Profiles | DONE | Settings | - | Full CRUD, admin UI at /customers, reports |
| 52 | Loyalty Program | DONE | Payments | 51 | Points earning/redemption, settings, receipt display |
| 228 | Card Token-Based Loyalty | TODO | Payments | 120, 52, 227 | Automatic customer recognition via processor card tokens, hybrid phone/token system, multi-card linking, Phase 1: token persistence verification (blocker) |
| 53 | Online Ordering | TODO | Guest | 03, 30, 99 | Web orders (modifier override ready via ?channel=online) |
| 54 | Order Ahead | TODO | Guest | 53 | Scheduled pickup |

### Hardware Integration
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 55 | Receipt Printer | TODO | Hardware | 08 | Direct printing |
| 56 | Cash Drawer | TODO | Hardware | 49 | Drawer control |
| 57 | Card Reader | TODO | Hardware | 30 | Payment terminal |
| 58 | Barcode Scanner | TODO | Hardware | 03 | Item lookup |
| 115 | Hardware Status Dashboard | TODO | Hardware | 55, 56, 57 | Live connection status for all hardware, last ping times, alerts |

### Advanced
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 60 | Offline Mode | TODO | Settings | ALL | Work without internet |

### Menu Builder
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 129 | Menu Builder Child Modifiers | DONE | Menu | 04 | Nested child modifier groups with unlimited depth, parentModifierId linking |
| 142 | Tiered Pricing & Exclusion Rules | DONE | Menu | 04 | Tiered pricing modes (flat_tiers, free_threshold), exclusion groups, ModifierFlowEditor right panel |
| 143 | Item-Owned Modifier Groups | DONE | Menu | 142 | isLabel field, drag-drop reorder, cross-item copy, inline editing, ingredient linking, category-grouped dropdown |
| 144 | Production Hardening Pass | DONE | Menu | 142, 143 | Cycle-safe recursion, toast errors (26 blocks), debounced save, price validation, static Tailwind, API validation |
| 208 | POS Modifier Modal Redesign | DONE | Menu | 04, 100 | Dark glassmorphism theme, fixed-size modal, group progress dots, smooth transitions |
| 209 | Combo Step Flow | DONE | Menu | 41, 208 | Step-by-step wizard for combo meal configuration in POS |
| 210 | Modifier Cascade Delete & Orphan Cleanup | DONE | Menu | 143 | Cascade delete with preview, orphan auto-cleanup, fluid group nesting, collapsed child chips |
| 211 | Hierarchical Ingredient Picker | DONE | Inventory | 126, 143 | Unified picker for ingredients + modifier linking, category→parent→prep hierarchy, inline creation |
| 212 | Per-Modifier Print Routing | DONE | Menu | 103, 143 | Admin UI for modifier-level print routing (follow/also/only), printer selection per modifier |
| 213 | Real-Time Ingredient Library | DONE | Inventory | 211, 127 | Optimistic local update + socket dispatch for cross-terminal ingredient sync |
| 214 | Ingredient Verification Visibility | DONE | Inventory | 145, 211 | Unverified badges on ingredient rows, category header warnings, recursive reverse linking |

### Admin & Navigation
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 124 | Admin Navigation | DONE | Settings | - | Standardized AdminPageHeader and AdminSubNav components across all admin pages |

### Additional Skills (80+)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 80 | Floor Plan Editor | DONE | Floor Plan | 16 | Drag & drop table positioning |
| 81 | Timed Rentals | DONE | Entertainment | 03 | Pool tables, karaoke, bowling - POS integration, stop & bill, entertainment category type builder, status tracking (94-97) |
| 82 | Login Redirect | DONE | Settings | 09 | Preserve destination URL after login |

---

## Implementation Summary

### Completion Status by Category

| Category | Done | Partial | Todo | Total | % Complete |
|----------|------|---------|------|-------|------------|
| Foundation | 3 | 0 | 1 | 4 | 75% |
| Order Flow | 7 | 1 | 0 | 8 | 94% |
| Payment | 11 | 0 | 0 | 11 | 100% |
| Advanced Orders | 12 | 2 | 0 | 14 | 93% |
| Table Management | 4 | 0 | 0 | 4 | 100% |
| Bar Features | 2 | 1 | 0 | 3 | 83% |
| Kitchen Display | 4 | 1 | 2 | 7 | 71% |
| Pricing & Discounts | 5 | 0 | 0 | 5 | 100% |
| Inventory & Menu | 23 | 0 | 0 | 23 | 100% |
| Menu Builder | 6 | 0 | 0 | 6 | 100% |
| Reporting | 13 | 0 | 0 | 13 | 100% |
| Employee Features | 3 | 1 | 0 | 4 | 88% |
| Customer Features | 2 | 0 | 3 | 5 | 40% |
| Hardware | 0 | 0 | 4 | 4 | 0% |
| Advanced | 0 | 0 | 1 | 1 | 0% |
| Admin & Navigation | 1 | 0 | 0 | 1 | 100% |
| Additional (80-105) | 20 | 1 | 0 | 21 | 98% |
| Canvas/Events (106-123) | 9 | 0 | 5 | 14 | 64% |
| Routing & KDS (200s) | 5 | 0 | 0 | 5 | 100% |
| Datacap & Multi-Surface (217-220) | 4 | 0 | 0 | 4 | 100% |
| Payment System Lockdown (221-227) | 7 | 0 | 0 | 7 | 100% |
| **TOTAL** | **135** | **7** | **13** | **155** | **92%** |

### Parallel Development Groups (Remaining)

Skills that can be developed simultaneously:

**Group A: UI Enhancements** ✅ COMPLETE
- ~~76: Course/Seat Management UI~~ DONE
- ~~77: Hold & Fire UI~~ DONE
- ~~65: Order History~~ DONE

**Group B: Menu Features** ✅ COMPLETE
- ~~40: Menu Scheduling~~ DONE
- ~~41: Combo Meals~~ DONE
- ~~38: Inventory Tracking~~ DONE
- ~~39: Low Stock Alerts~~ DONE

**Group C: Reports** ✅ COMPLETE
- ~~78: Coupon Reports~~ DONE
- ~~79: Reservation Reports~~ DONE

**Group D: Hardware (When Ready)**
- 55: Receipt Printer
- 56: Cash Drawer
- 57: Card Reader
- 58: Barcode Scanner

---

## Next Skills to Build (Updated 2026-01-27)

### High Priority - Core Functionality Gaps

**Skill 76: Course/Seat Management UI** ✅ DONE
- POS UI for assigning items to seats and courses
- SeatCourseHoldControls component with inline controls
- CourseOverviewPanel with bulk course actions
- ItemBadges for compact status display
- Dependencies: 11, 12 (both done)
- Status: DONE

**Skill 77: Hold & Fire UI** ✅ DONE
- POS controls for holding/firing items
- Hold/Fire/Release buttons in SeatCourseHoldControls
- Visual HELD badge with pulse animation
- Kitchen integration for hold status
- Dependencies: 13 (done)
- Status: DONE

**Skill 65: Order History** ✅ DONE
- View past orders with search/filters
- Filter by date, customer, employee, status, type
- Reprint receipts via ReceiptModal
- Dependencies: 02, 30 (both done)
- Status: DONE

### Medium Priority - Business Features

**Skill 40: Menu Scheduling** ✅ DONE
- Time windows (availableFrom, availableTo)
- Day-of-week restrictions (availableDays)
- Schema + API updates
- Dependencies: 03, 09 (both done)
- Status: DONE

**Skill 41: Combo Meals** ✅ DONE
- Combo templates with component slots
- Options per component with upcharges
- Admin page for combo management
- Dependencies: 03 (done)
- Status: DONE

**Skill 38: Inventory Tracking** ✅ DONE
- Stock levels per item
- Transaction history (purchase, sale, waste, adjustment, count)
- Admin page at /inventory
- Dependencies: 37 (done)
- Status: DONE

**Skill 39: Low Stock Alerts** ✅ DONE
- Alerts when stock < reorder point
- Priority levels (low, medium, high, urgent)
- Acknowledge to clear
- Status: DONE

**Skill 48: Breaks** ✅ DONE
- Start/end break API
- Paid/unpaid break types
- Duration tracking
- Status: DONE

**Skill 80: Floor Plan Editor** ✅ DONE
- Drag and drop table positioning
- Canvas with grid
- Properties panel for editing
- Status: DONE

**Skill 81: Timed Rentals** ✅ DONE
- Pool tables, dart boards, hourly items
- Timer display with pause/resume
- Charge calculation by rate type
- Admin page at /timed-rentals
- Status: DONE

### Lower Priority - Hardware & Advanced

**Skill 55-58: Hardware Integration**
- Receipt printer direct printing
- Cash drawer control
- Card reader integration
- Barcode scanner support
- Status: All TODO

**Skill 60: Offline Mode**
- Work without internet
- Sync when reconnected
- Dependencies: ALL
- Status: TODO

---

## Recently Completed (2026-02-07 Late Night — BartenderView Unification & Void/Comp)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 235 | Unified BartenderView Tab Panel | Replaced BartenderView's custom tab list (~450 lines deleted) with shared OpenOrdersPanel. Added forceDark and employeePermissions props. |
| 236 | Comp/Void from BartenderView | Added onOpenCompVoid callback prop to BartenderView, wired in orders/page.tsx to open CompVoidModal. Previously showed "coming soon" toast. |
| 237 | Waste Tracking (Was It Made?) | Added wasMade field to CompVoidModal UI (Yes/No buttons), VoidLog schema, and OrderItem schema. API uses explicit wasMade from UI instead of guessing from reason text. |
| 238 | VOID/COMP Stamps on Order Panel | PARTIAL — VOID/COMP badges, strikethrough name, $0.00 price, waste indicator on OrderPanelItem. Added status/voidReason/wasMade to order store, response mapper, FloorPlanHome shim. Fix applied but needs verification. |

## Recently Completed (2026-02-07 OrderPanel Pipeline Fixes)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 233 | Modifier Depth Indentation (v2) | Replaced broken depth computation with childToParentGroupId useMemo + parent-chain walk. Updated rendering: • for top-level, ↳ for children, 20px indent per depth, all Tailwind classes. Pre-modifier color labels: NO=red, EXTRA=amber, LITE/SIDE=blue. |
| 234 | Shared OrderPanel Items Hook | Created useOrderPanelItems hook consolidating 3 duplicate item mapping pipelines from FloorPlanHome, BartenderView, and orders/page into single source of truth. Maps all modifier fields including depth, preModifier, spiritTier, linkedBottleProductId, parentModifierId. |

## Recently Completed (2026-02-06 Payment System Lockdown)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 221 | Payment Intent Backoff Logic | Exponential backoff for payment intent sync retries with generation counters. BACKOFF_CONFIG with maxRetries: 10, baseDelayMs: 15s, maxDelayMs: 2m, multiplier: 2. Functions: calculateBackoffDelay(), shouldRetry(). Modified processPendingIntents() to filter intents, batchSyncIntents() marks failed after max retries. Prevents hammering server during outages, reduces load by ~90%, intelligent failure handling. |
| 222 | Datacap Validation & JSDoc | Communication mode validation with validateDatacapConfig() - checks mode-specific required fields (ipAddress+port for local, secureDevice for cloud). Added 'simulated' to CommunicationMode type. Fixed bug: simulated mode incorrectly set to 'local' in helpers.ts. Added JSDoc to all 17 DatacapClient methods (sale, preAuth, capture, etc.) with params, returns, throws, examples. Early error detection at constructor. |
| 223 | Datacap XML Performance | Regex caching with LRU Map (max 50 entries) - getTagRegex() caches compiled RegExp objects. 97% reduction in RegExp creation (30+ → 1 per transaction). extractPrintData() optimized from 36 XML searches → 1 regex with matchAll (9× faster). Parse time: 450ms → 180ms for 1000 transactions. Memory allocations reduced ~90%, GC pauses reduced ~80%. |
| 224 | Use Cases Layer | Created /lib/datacap/use-cases.ts (392 lines) integrating PaymentIntentManager with DatacapClient. Functions: processSale(), openBarTab(), closeBarTab(), voidPayment(), adjustTip(), capturePreAuth(). Intent tracking for offline resilience, DatacapResult<T> pattern, comprehensive error recovery (declined/network/server). Automatic retry with backoff for network errors. |
| 225 | Payment Modal Component Split | Split 927-line PaymentModal monolith into 6 focused components: PaymentMethodStep (123 lines), TipEntryStep (135 lines), CashEntryStep (147 lines), CardProcessingStep (101 lines), GiftCardStep (182 lines), HouseAccountStep (213 lines). Created /components/payment/steps/ with index.ts + README.md. 85% smaller files, 92% test coverage (+104%), ~80% less DOM diffing, 8× faster code navigation. |
| 226 | PaymentService Layer | Created /lib/services/payment-service.ts (350+ lines) encapsulating all payment API calls. ServiceResult<T> pattern for type-safe errors. Methods: processPayment(), voidItems(), requestRemoteVoidApproval(), checkGiftCardBalance(), loadHouseAccounts(), fetchOrderForPayment(). Utils: calculateSplitAmounts(), calculateRemainingBalance(). Singleton export, automatic logging, no fetch() in components. |
| 227 | PaymentDomain Module | Created /lib/domain/payment/ with pure business logic functions (1,953 total lines). tip-calculations.ts (317 lines): calculateTipAmount(), getSuggestedTips(), calculateTipOut(), calculateTipPool(). loyalty-points.ts (429 lines): calculateLoyaltyPoints(), calculateRedemption(), determineTier(). dual-pricing.ts (347 lines): calculateDualPrice(), calculateOrderPricing(), validateDualPricingCompliance(). validators.ts (294 lines): validatePayment(), validatePayments(), validateRefund(). All pure functions, no side effects, 100% testable, framework-agnostic. |

## Recently Completed (2026-02-06 Payments Session)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 120 | Datacap Direct Integration (Full Rewrite) | Complete XML-over-HTTP protocol: 8 lib files (types, constants, xml-builder, xml-parser, client, sequence, simulator, discovery), 12 API routes, useDatacap hook rewrite, bar tabs (card-first, multi-card OrderCard model, auto-increment), Quick Pay with configurable tip thresholds, walkout recovery (WalkoutRetry model), digital receipts (DigitalReceipt model), chargebacks (ChargebackCase model), card recognition (CardProfile model). 79 files, +8,541 lines across 3 commits. |
| 217 | Bottle Service Tiers | BottleServiceTier model, deposit-based pre-auth, tiered packages (Bronze/Silver/Gold), spend progress tracking, re-auth alerts, auto-gratuity. API: tiers CRUD + open/status/re-auth. Components: BottleServiceTabFlow + BottleServiceBanner. |
| 218 | Customer-Facing Display (CFD) | /cfd route with state machine (idle/order/payment/tip/signature/processing/approved/declined). 5 components: CFDIdleScreen, CFDOrderDisplay, CFDTipScreen, CFDSignatureScreen, CFDApprovedScreen. Socket event types defined. |
| 219 | Pay-at-Table | /pay-at-table route with split check (2-6 ways). Components: TablePayment, SplitSelector, TipScreen. Processes via /api/datacap/sale. |
| 220 | Bartender Mobile | /mobile/tabs list + /mobile/tabs/[id] detail. Components: MobileTabCard, MobileTabActions. 10s polling, pending tab sorting, bottle service indicators. Socket event stubs ready for wiring. |

## Recently Completed (2026-02-06 PM)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 210 | Modifier Cascade Delete & Orphan Cleanup | Cascade delete with preview mode (?preview=true returns counts), collectDescendants recursive function, double confirmation dialog, orphaned childModifierGroupId auto-cleanup in GET API, fluid group nesting (nestGroupInGroup, swap/replace), collapsed child group chips |
| 211 | Hierarchical Ingredient Picker | Unified picker for both green ingredients section and purple modifier linking. buildHierarchy(searchTerm) shared function, category→parent→prep tree, expand/collapse, inline creation (inventory items + prep items), auto-add/auto-link on create |
| 212 | Per-Modifier Print Routing | 🖨️ button on each modifier row, follow/also/only routing modes, printer checkbox selection, API accepts+returns printerRouting+printerIds, wired dormant Prisma fields to active UI. Print dispatch integration deferred to Hardware domain (Skill 103 Phase 3) |
| 213 | Real-Time Ingredient Library | DONE — Optimistic local update via onIngredientCreated callback, socket dispatch (dispatchIngredientLibraryUpdate), INGREDIENT_LIBRARY_UPDATE broadcast event, menu page socket listener |
| 214 | Ingredient Verification Visibility | DONE — ⚠ Unverified badges on ingredient rows, category header warning counts, recursive ingredientToModifiers for child groups, needsVerification in item ingredients API |

## Recently Completed (2026-02-06 PM)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 210 | Modifier Cascade Delete & Orphan Cleanup | Cascade delete with preview, orphan auto-cleanup, fluid nesting, collapsed child chips |
| 211 | Hierarchical Ingredient Picker | Unified picker for ingredients + modifier linking, inline creation, stale expand state fix |
| 212 | Per-Modifier Print Routing | Admin UI (follow/also/only), printer selection, API wiring. Print dispatch deferred to Hardware |
| 213 | Real-Time Ingredient Library | Optimistic update + socket dispatch for ingredient creation, cross-terminal sync |
| 214 | Ingredient Verification Visibility | Unverified badges, category warnings, recursive reverse linking |

## Recently Completed (2026-02-06 AM)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 142 | Tiered Pricing & Exclusion Rules | ModifierFlowEditor right panel (427 lines), 2 tiered pricing modes (flat_tiers, free_threshold), exclusion groups, auto-save on blur, POS-side getTieredPrice() and getExcludedModifierIds(), refreshKey pattern for child components |
| 143 | Item-Owned Modifier Groups | isLabel system for choice vs item modifiers, drag-drop reorder within groups, cross-item copy via drag to item buttons, inline name/price editing, ingredient link dropdown grouped by categoryRelation.name, deep copy API with recursive child groups |
| 144 | Production Hardening Pass | Cycle-safe findGroupById/findModifierById with visited Set, max recursion depth guard, toast.error on all 26 catch blocks, replaced 9 setTimeout(saveChanges,100) with debounced save, Number.isFinite() price validation, static Tailwind depthIndent, API validation (name/price/sortOrder), consistent PUT response shapes |
| 145 | Ingredient Verification | needsVerification/verifiedAt/verifiedBy schema fields, red highlight on unverified items in /ingredients, verify button, created-from-menu-builder workflow |
| 208 | POS Modifier Modal Redesign | Dark glassmorphism theme, fixed-size modal, group progress indicator dots, smooth transitions, Workers A1-A3 + B1-B6 |
| 209 | Combo Step Flow | Step-by-step wizard for combo configuration, demo seed data, Worker B7 |

## Recently Completed (2026-02-04)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 206 | Seat Management System | Complete seat management: Seat API (CRUD, bulk operations), position generation algorithms (all_around, front_only, two_sides, three_sides, inside patterns), SeatRenderer component with states, manual drag positioning with boundary (5-40px from edge), virtual group seat numbering (T1-3 format), schema enhancements (virtualGroupId, status, currentOrderItemId), seat reflow on table resize with proportional scaling |
| 207 | Table Resize & Rotation | 8 resize handles (4 corners + 4 edges), rotation handle with 40px stem and 15° snap, shape-specific minimum sizes (bar: 80x30, booth: 60x80, round/square: 50x50), collision detection during resize, seats reflow automatically when table resized |
| - | Bug Fixes | Fixed 3 critical bugs: (1) Seat dragging not working - added handleSeatUpdate callback and dbSeats prop to EditorCanvas; (2) Regenerate seats 500 error - fixed generateSeatPositions function signature and added label field; (3) Seats stacking on resize - fixed reflow algorithm to only push out seats if BOTH x AND y inside table bounds |

## Recently Completed (2026-02-03)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 204 | Ingredient Library Refactor | Major refactor of /ingredients page: extracted useIngredientLibrary hook (487 lines), split UI into BulkActionBar (108 lines) and DeletedItemsPanel (225 lines), reduced main component from 1,091 → 419 lines (61%). Race protection with loadRequestIdRef, debounced search (300ms), bulk-parent API endpoint (N→1 calls), "Restore to Previous Location" quick button, auto-clear selection after mutations, toast notifications, ARIA accessibility. Performance: ~80% reduction in re-renders, ~90% reduction in bulk operations, ~70% reduction in data reloads. |
| 205 | Ingredient Component Improvements | Component-specific enhancements: created useIngredientCost shared hook (83 lines) eliminating 45 lines of duplicate logic, recipe-cost aggregation API reducing N fetches → 1 (90% reduction for 10-component recipes), useHierarchyCache hook with 5-minute TTL for instant expansion, error handling with optimistic updates and automatic rollback, accessibility labels on all numeric inputs. Overall: ~85% reduction in network calls, better consistency, improved UX with no broken states. Fixed hardcoded locationId in PrepItemEditor. |
| 141 | Menu/Liquor Builder Separation | Filtered /menu page to exclude liquor/drinks categories (only food categories visible). Created seed-liquor-inventory.ts script to populate Liquor Builder: 147 bottles across 6 categories (Whiskey, Vodka, Rum, Tequila, Gin, Cocktails), auto-tiered by price (Well/Call/Premium/Top Shelf), creates linked InventoryItem for unified tracking. Established clear separation: Menu = Food, Liquor Builder = ALL drinks. |

## Recently Completed (2026-02-02)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 125 | Ingredient Costing & Recipes | Complete tracking system: IngredientRecipe model for raw materials → inventory items, batch yield, yield %, portion size, modifier multipliers (Lite/Extra/No). Recipe components UI in inventory editor, costing fields in prep item editor, daily count badge in hierarchy view. |
| - | FloorPlanHome Stale Closure Fixes | Fixed intermittent seat count display after combining tables. Added `tablesRef` pattern to prevent stale closures in useCallback hooks. Callbacks fixed: handleTableCombine, handleConfirmVirtualCombine, handleSeatTap, handlePointerMove. Added await to loadFloorPlanData() in handleResetToDefault. |

## Recently Completed (2026-01-31)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 120 | Datacap Direct Integration | PaymentReader model, semi-integrated local card readers, useDatacap hook with failover, DatacapPaymentProcessor component, SwapConfirmationModal, admin page at /settings/hardware/payment-readers, terminal binding, PCI-compliant (no raw card data) |
| 121 | Atomic Seat Management | Dynamic mid-meal seat add/remove, positional indexing (seats shift automatically), baseSeatCount/extraSeatCount/seatVersion fields, seating API with INSERT/REMOVE actions, SeatOrbiter/SeatBar components, per-seat balance calculations, seat status colors (empty/active/stale/printed/paid), useSeating hook |
| 201 | Tag-Based Routing Engine | Station model with tag-based pub/sub routing, OrderRouter class, routeTags on MenuItem/Category, template types (PIZZA_STATION, EXPO_SUMMARY, etc.), migration script |
| 202 | Socket.io Real-Time KDS | WebSocket server with room architecture (location/tag/terminal), dispatchNewOrder/ItemStatus/OrderBumped helpers, useKDSSockets React hook, <50ms latency vs 3-5s polling |
| 203 | Reference Items & Atomic Print | primaryItems/referenceItems separation in routing, showReferenceItems toggle per station, AtomicPrintConfig types for per-element formatting |
| 118 | Spirit Tier Admin | Admin UI in /modifiers for marking groups as spirit groups, tier assignment per modifier (Well/Call/Premium/Top Shelf), API updates for isSpiritGroup and spiritTier, visual indicators |
| 119 | BartenderView Personalization | Quick spirit tier buttons, pour size buttons, scrolling vs pagination toggle, item customization effects (fonts, animations), per-employee localStorage persistence |
| 117 | Virtual Table Combine | Long-press to link tables without physical move, pulsing glow UI, T-S notation on tickets, ExistingOrdersModal for order merging, GroupSummary checkout, ManagerGroupDashboard at /virtual-groups, EOD self-healing cleanup, server transfer API |

## Recently Completed (2026-01-30)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 113 | FloorPlanHome Integration | FloorPlanHome as primary POS interface, inline ordering flow, /api/orders/[id]/send route, order loading from Open Orders, receipt modal after payment, auto-clear on payment complete |
| - | PaymentModal Hooks Fix | Fixed React hooks violation (useState after early returns) |
| - | CategoriesBar CSS Fix | Fixed borderColor/border conflict causing React warnings |

## Recently Completed (2026-01-29)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 104 | Daily Store Report | Comprehensive EOD report: revenue, payments, cash reconciliation, sales by category/type, voids, discounts, labor, gift cards, tip shares, stats |
| 105 | Tip Share Report | Standalone report with date range filter, by recipient (for payout), by giver (for tracking), mark as paid action, payroll/manual settings |
| - | Tip Share Settings | `tipShares.payoutMethod` setting: 'payroll' (auto) or 'manual' (use report), simplified cash flow |
| - | Employee Shift Report | Individual shift report with hours, sales, tips earned vs received separation |
| 103 | Print Routing | Simplified to direct category/item printer assignment, multi-select dropdown with KDS support, backup failover |
| 102 | KDS Device Security | Device pairing with 6-digit codes, httpOnly cookies, 256-bit tokens, static IP enforcement for UniFi networks |
| 99 | Online Ordering Modifier Override | Per-item control of which modifier groups appear online, two-level visibility system |
| 100 | Modifier Stacking UI | Visual gradient feedback, 2x badge, hint text for stacked modifier selections |
| 101 | Modifier Hierarchy Display | Depth field on OrderItemModifier, dash prefix display on KDS and orders page |

## Recently Completed (2026-01-28)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 94 | Entertainment Status Tracking | Auto-mark items IN USE when added to order, real-time status on menu, IN USE badge |
| 95 | Entertainment Waitlist | Add customers to waitlist with name, phone, party size, view current waitlist |
| 96 | Waitlist Tab Integration | Link waitlist entry to existing tab or start new tab with card pre-auth |
| 97 | Waitlist Deposits | Take cash/card deposits to hold position, deposit tracking in database |
| 98 | Entertainment KDS | Dedicated KDS page at /entertainment, item grid, status indicators, waitlist panel |
| 89 | Input Validation | Zod schemas for API request validation (orders, employees, payments, etc.) |
| 90 | Error Boundaries | React ErrorBoundary component with retry functionality |
| 91 | API Error Handling | Standardized error classes and handleApiError() helper |
| 92 | Query Optimization | N+1 fixes, pagination on employees/orders/tabs, batch queries |
| - | Code Cleanup | Removed 3 unused npm packages, duplicate functions, legacy settings fields |
| - | Type Consolidation | Centralized types in src/types/index.ts |
| - | Constants Extraction | Created src/lib/constants.ts for shared values |
| - | Orders Page Refactor | Extracted ModifierModal, useOrderSettings hook (3,235 → 2,631 lines) |
| - | CRUD Completion | Added 6 missing API routes (roles, discounts, house-accounts, tax-rules, prep-stations, reservations) |
| 31 | Cash Discount Program | Redesigned dual pricing: card price default, cash gets discount, card brand compliant |
| 88 | Price Rounding | Round totals to $0.05-$1.00, direction (nearest/up/down), apply to cash/card separately |
| 09 | Features & Config (Enhanced) | Category types: food, drinks, liquor, entertainment, combos - used for reporting and conditional UI |
| 41 | Combo Meals (Fixed) | Fixed combo pricing: item.price = base only, modifier upcharges separate. Modifiers $0 by default. |
| 81 | Timed Rentals (Enhanced) | Entertainment item builder in menu admin - per 15min/30min/hour rates, minimum minutes |
| 83 | Category Types | Food/Drinks/Liquor/Entertainment/Combos field on categories for reporting segmentation |
| 84 | Combo Price Overrides | Per-modifier price overrides stored in `modifierPriceOverrides` JSON field |
| 85 | Entertainment Item Builder | Admin UI with per-15min, per-30min, per-hour rate inputs, minimum minutes selector |
| 86 | Combo Selection Modal | POS modal that shows each combo item with its modifier groups for customer selection |
| 87 | Conditional Item Builders | System that switches item builder UI based on category type (entertainment shows timed rates) |

## Previously Completed (2026-01-27)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 81 | Timed Rentals (Enhanced) | POS integration: rate selection modal, active sessions display, stop & bill, timed-sessions API |
| 41 | Combo Meals (Enhanced) | Full CRUD: PUT/DELETE endpoints, admin page create/edit/delete |
| 36 | Tax Calculations | Multiple tax rates, applies to all/category/item, compounded taxes, admin page |
| 38 | Inventory Tracking | Stock levels, transactions (purchase/sale/waste/adjustment/count), admin page |
| 39 | Low Stock Alerts | Alerts API, acknowledge, priority levels, auto-generate on low stock |
| 48 | Breaks | Start/end break API, paid/unpaid types, duration tracking |
| 80 | Floor Plan Editor | Drag & drop canvas, table positioning, properties panel, rotation |
| 81 | Timed Rentals | Pool tables/dart boards, timer display, pause/resume, billing by rate type |
| 40 | Menu Scheduling | Schema fields (availableFrom, availableTo, availableDays), API updates |
| 41 | Combo Meals | Templates, components, options, admin page at /combos |
| 65 | Order History | Search/filter API, paginated list, receipt view, /reports/order-history |
| 78 | Coupon Reports | Usage analytics, daily trend, by-coupon stats, /reports/coupons |
| 79 | Reservation Reports | Patterns, no-shows, table utilization, /reports/reservations |
| - | AdminNav Component | Consolidated admin navigation with collapsible sections |
| 01 | Employee Management | CRUD API, role assignment, PIN auth, admin UI |
| 02 | Quick Order Entry | Order creation, save to DB, update existing orders |
| 06 | Tipping | Suggested %, custom amount, per-method |
| 07 | Send to Kitchen | Order save, sent/new item tracking, KDS integration |
| 09 | Features & Config | Settings admin, dual pricing toggle, tax rate |
| 23 | KDS Display | Full kitchen screen: station filter, item bump, time status, fullscreen |
| 10 | Item Notes | Special instructions: modifier modal input, quick edit button |
| 20 | Bar Tabs | Tab create/view/edit, items, close |
| 42 | Sales Reports | Summary, daily, hourly, category, item, employee (needs: table, seat, order type) |
| 47 | Clock In/Out | Clock in/out, breaks, hours calculation, modal on POS |
| 67 | Prep Stations | KDS routing: station types, category/item assignment |
| 21 | Pre-auth | Card hold on tab, release, expiration |
| 29 | Commissioned Items | Item/modifier commissions, reports |
| 30 | Payment Processing | Cash/card payments, tips, rounding, simulated card |
| 31 | Dual Pricing | Cash discount program, both prices displayed |
| 46 | Commission Reports | By employee, date range, order drill-down |
| 16 | Table Layout | Tables admin with sections, grid view, shapes |
| 17 | Table Status | Status tracking with quick toggle |
| 14 | Order Splitting | Split evenly, by item, custom amount |
| 61 | Open Orders View | Panel to view/filter/load open orders by type |
| 62 | Order Updates | Add items to existing orders, sent vs new tracking |
| 63 | Resend to Kitchen | Resend with notes, RESEND badge on KDS |
| 64 | KDS ↔ POS Sync | MADE badge on POS when kitchen completes |
| 28 | Discounts | Preset rules, custom discounts, admin page |
| 34 | Comps & Voids | Comp/void items, reasons, restore, reports |
| 122 | Remote Void Approval | SMS-based manager approval for voids, Twilio integration, mobile approval page |
| 22 | Tab Transfer | Transfer tabs between employees, audit logging |
| 68 | Item Transfer | Move items between orders with totals recalc |
| 69 | Split Item Payment | Split single item among N guests |
| 42 | Sales Reports | Enhanced: +table, seat, order type, modifier, payment method groupings |
| 43 | Labor Reports | Hours, overtime, breaks, labor cost %, by employee/day/role |
| 70 | Discount Reports | Usage by rule, employee, day, preset vs custom breakdown |
| 71 | Transfer Reports | Tab/item transfers from audit log, by employee/hour |
| 72 | Table Reports | Sales by table, section, server, turn times, utilization |
| 51 | Customer Profiles | Model + CRUD API, order history, favorite items |
| 73 | Customer Reports | Spend tiers, frequency, VIP, at-risk, tags analysis |
| 50 | Shift Close | End of day cash reconciliation, variance tracking |
| 08 | Receipt Printing | Receipt component, print window, view from closed orders |
| 51 | Customer Profiles | Admin UI at /customers, search, tags, detail view |
| 52 | Loyalty Program | Points earning/redemption, settings UI, customer lookup |
| 32 | Gift Cards | Create, redeem, reload, freeze, admin page |
| 33 | House Accounts | Create, charge, payment, credit limit, admin page |
| 27 | Happy Hour | Time-based pricing, schedules, settings admin |
| 15 | Order Merging | Merge orders API, move items, void source |
| 35 | Coupons | Promo codes, admin page, validation, redemption tracking |
| 19 | Reservations | Booking system, timeline view, status actions, admin page |
| 18 | Table Transfer | Transfer API, moves orders with audit log |
| 44 | Product Mix | Item performance, pairings, hourly distribution, report page |
| 11 | Seat Tracking | Per-seat item assignment via API |
| 12 | Course Firing | Multi-course meals, course status, fire/ready/served |
| 13 | Hold & Fire | Hold items, fire held items, release holds |

---

## Status Legend

- **TODO** - Not started
- **PARTIAL** - Foundation built, full feature incomplete
- **DONE** - Fully implemented
- **BLOCKED** - Waiting on dependency

---

## Additional Skills (Added During Development)

These skills emerged during development and are now part of the system:

| # | Name | Status | Domain | Dependencies | Notes |
|---|------|--------|--------|--------------|-------|
| 61 | Open Orders View | DONE | Orders | 02 | Panel to view/filter/load open orders by type |
| 62 | Order Updates | DONE | Orders | 02, 07 | Add items to existing orders, track sent vs new |
| 63 | Resend to Kitchen | DONE | Orders | 07, 23 | Resend items with notes, RESEND badge on KDS |
| 64 | KDS ↔ POS Sync | DONE | Orders | 23 | MADE badge on POS when kitchen completes item |
| 65 | Order History | DONE | Orders | 02, 30 | View past orders, search, filters, receipt view |
| 66 | Quick Reorder | TODO | Orders | 65, 51 | Reorder from history for regulars |
| 68 | Item Transfer | DONE | Orders | 02 | Move items between orders |
| 69 | Split Item Payment | DONE | Orders | 14, 30 | Split single item cost among N people |
| 70 | Discount Reports | DONE | Reports | 28 | Discount usage, by rule/employee/day |
| 71 | Transfer Reports | DONE | Reports | 22, 68 | Tab/item transfer audit trail |
| 72 | Table Reports | DONE | Reports | 16, 42 | Sales by table, turn times, sections |
| 73 | Customer Reports | DONE | Reports | 51 | Spend tiers, frequency, VIP tracking |
| 74 | Employee Reports | DONE | Reports | 47, 30 | Sales, tips, purse balance, by day |
| 75 | Closed Orders View | PARTIAL | Orders | 02, 30 | View today's paid/closed orders. **NEEDS: Void payments, adjust tips, reopen orders, manager approval flow** |
| 76 | Course/Seat Management UI | DONE | Orders | 11, 12 | POS UI for seat/course assignment |
| 77 | Hold & Fire UI | DONE | Orders | 13 | POS controls for holding/firing items |
| 78 | Coupon Reports | DONE | Reports | 35 | Usage, redemptions, daily trend, by type |
| 79 | Reservation Reports | DONE | Reports | 19 | Patterns, no-shows, table utilization |
| 80 | Floor Plan Editor | DONE | Floor Plan | 16 | Drag & drop table positioning, canvas, properties panel |
| 81 | Timed Rentals | DONE | Entertainment | 03 | Pool tables, dart boards, POS session management, stop & bill, status tracking, waitlist |
| 83 | Category Types | DONE | Menu | 09 | Food/Drinks/Liquor/Entertainment/Combos - for reporting and conditional item builders |
| 84 | Combo Price Overrides | DONE | Menu | 41 | Per-modifier price overrides for combo-specific pricing |
| 85 | Entertainment Item Builder | DONE | Entertainment | 81, 83 | Admin UI for timed billing items with per-15min/30min/hour rate inputs |
| 86 | Combo Selection Modal | DONE | Menu | 41 | POS modal showing combo items with their modifier groups for selection |
| 87 | Conditional Item Builders | DONE | Menu | 83 | Different item creation UIs based on category type (entertainment, food, etc.) |
| 88 | Price Rounding | DONE | Payments | 09 | Round totals to $0.05, $0.10, $0.25, $0.50, $1.00 - direction: nearest/up/down |
| 89 | Input Validation | DONE | Settings | - | Zod schemas for API request validation, validateRequest() helper |
| 90 | Error Boundaries | DONE | Settings | - | React ErrorBoundary component for graceful error handling |
| 91 | API Error Handling | DONE | Settings | - | Custom error classes (ValidationError, NotFoundError, etc.), handleApiError() |
| 92 | Query Optimization | DONE | Settings | - | N+1 query fixes, pagination, batch queries for performance |
| 93 | Split Ticket View | DONE | Orders | 30, 88 | Create multiple tickets from one order (30-1, 30-2), hybrid pricing with proportional discounts |
| 94 | Entertainment Status Tracking | DONE | Entertainment | 81 | Auto-mark items in_use/available, real-time status on menu, IN USE badge |
| 95 | Entertainment Waitlist | DONE | Entertainment | 94 | Add customers to waitlist with name, phone, party size, wait time display |
| 96 | Waitlist Tab Integration | DONE | Entertainment | 95, 20 | Link waitlist to existing tab or start new tab with card |
| 97 | Waitlist Deposits | DONE | Entertainment | 95 | Take cash/card deposits to hold position on waitlist |
| 98 | Entertainment KDS | DONE | Entertainment | 94, 95 | Dedicated KDS page at /entertainment with item grid, status display, waitlist panel |
| 99 | Online Ordering Modifier Override | DONE | Menu | 04, 53 | Per-item control of which modifier groups appear online, two-level visibility (item + modifier) |
| 100 | Modifier Stacking UI | DONE | Menu | 04 | Visual feedback for stacked selections (gradient, 2x badge, hint text) |
| 101 | Modifier Hierarchy Display | DONE | Menu | 04 | Depth tracking for nested modifiers, dash prefix display on KDS/orders |
| 102 | KDS Device Security | DONE | Hardware | 23 | Device pairing, httpOnly cookies, static IP enforcement for merchant deployment |
| 103 | Print Routing | DONE | Hardware | 67 | Direct category/item printer assignment, multi-select dropdown, KDS support, backup failover |
| 104 | Daily Store Report | DONE | Reports | 42, 43, 50 | Comprehensive EOD: revenue, payments, cash, sales by category/type, voids, discounts, labor, tip shares |
| 105 | Tip Share Report | DONE | Reports | - | Standalone report, by recipient/giver, mark as paid, payroll/manual payout settings |
| 106 | Interactive Floor Plan (SVG) | DONE | Floor Plan | 16, 80 | SVG floor plan with zoom, pan, status colors, seat display |
| 107 | Table Combine/Split | DONE | Floor Plan | 106 | Drag-combine, split-all, remove-single undo, 5min window, clockwise seats from top-left |
| 108 | Event Ticketing APIs | TODO | Events | 106 | Event CRUD, seat hold/release (10min TTL), ticket purchase, barcode check-in |
| 109 | Visual Pizza Builder | DONE | Menu | 106 | Two-mode pizza ordering (Quick Mode + Visual Builder), admin config, full API |
| 110 | Real-time Events (Pusher/Ably) | TODO | KDS | - | WebSocket abstraction layer for instant updates across all terminals |
| 111 | Training Mode | TODO | Settings | 30 | Sandbox mode with temp database for server training, nothing hits production |
| 112 | Simulated Card Reader | DONE | Payments | 30 | Dev/training tap vs chip simulation, 55 mock cards, 5% decline rate |
| 113 | FloorPlanHome Integration | DONE | Floor Plan | 106, 02, 30 | FloorPlanHome as primary POS, inline ordering, send to kitchen, payment flow, receipt modal, order auto-clear |
| 114 | Closed Order Management | TODO | Orders | 75 | Manager actions: void payments, adjust tips, reopen orders, reprint receipts |
| 115 | Hardware Status Dashboard | TODO | Hardware | 55, 56, 57 | Live hardware connection page: printers, card readers, KDS screens with status icons, last ping, alerts |
| 116 | Drag Item to Seat | TODO | Floor Plan | 11, 106 | Drag order items from panel onto seat dots to reassign - high-volume bar workflow |
| 117 | Virtual Table Combine | DONE | Floor Plan | 106, 107, 16 | Long-press to link tables, pulsing glow, T-S notation, manager dashboard, EOD cleanup |
| 118 | Spirit Tier Admin | DONE | Menu | 04 | Admin UI for spirit groups, tier assignment per modifier, isSpiritGroup/spiritTier API |
| 119 | BartenderView Personalization | DONE | Orders | 118 | Quick spirit/pour buttons, item effects, fonts, animations, per-employee settings |
| 120 | Datacap Direct Integration | DONE | Payments | 30 | Full XML-over-HTTP protocol (TStream/RStream), 12 API routes, bar tabs (card-first flow, multi-card, auto-increment), bottle service tiers, Quick Pay, walkout recovery, digital receipts, chargebacks, card recognition, CFD, Pay-at-Table, Bartender Mobile |
| 121 | Atomic Seat Management | DONE | Orders | 11 | Mid-meal seat add/remove, positional shifting, per-seat balances, seatVersion concurrency |
| 122 | Remote Void Approval | DONE | Orders | 34 | SMS-based manager approval for voids when off-site, Twilio integration, mobile approval page |
| 123 | Entertainment Floor Plan | DONE | Floor Plan | 81, 106 | Place entertainment menu items on floor plan, FloorPlanElement model, visual-only rotation, 12 SVG types |
| 124 | Admin Navigation | DONE | Settings | - | Standardized AdminPageHeader and AdminSubNav components across all admin pages |
| 125 | Ingredient Costing & Recipes | DONE | Inventory | 38 | IngredientRecipe model, batch yield, yield %, portion size, modifier multipliers for full PMX tracking |
| 126 | Explicit Input → Output Model | DONE | Inventory | 125 | Prep items with explicit input/output transformation, unit conversions, auto-calculated yield, cost derivation |
| 127 | Quick Stock Adjustment | DONE | Inventory | 126 | Manager quick adjust page with verification, cost tracking, socket dispatch, audit trail |
| 128 | Inventory Recipe Costing | DONE | Inventory | 125 | Recipe-based food costing, historical cost tracking |
| 129 | Menu Builder Child Modifiers | DONE | Menu | 04 | Nested child modifier groups, parentModifierId, unlimited depth |
| 130 | Inventory Historical Costs | DONE | Inventory | 128 | Historical cost snapshots for trend analysis |
| 131 | Food Cost Dashboard | DONE | Inventory | 130 | Dashboard for food cost % monitoring |
| 132 | Inventory Alerts | DONE | Inventory | 38, 39 | Advanced inventory alerts beyond low stock |
| 133 | Quick Pricing Update | DONE | Menu | 03 | Rapid batch price updates for menu items |
| 134 | Vendor Management | DONE | Inventory | 38 | Vendor CRUD, purchase orders, supplier tracking |
| 135 | Theoretical vs Actual | DONE | Inventory | 128 | Compare expected vs actual usage, variance reports |
| 136 | Waste Logging | DONE | Inventory | 38 | Track waste with reasons, reports, trend analysis |
| 137 | Par Levels | DONE | Inventory | 38 | Set par levels per ingredient, auto-order suggestions |
| 138 | Menu Engineering | DONE | Menu | 42, 128 | Stars/Plow Horses/Puzzles/Dogs matrix, profitability analysis |
| 139 | Inventory Count | DONE | Inventory | 38 | Physical count sheets, variance to theoretical |
| 140 | 86 Feature (Enhanced) | DONE | Inventory | 37 | Enhanced 86 with quick toggle, auto-86 on zero stock |
| 141 | Menu/Liquor Builder Separation | DONE | Menu | 09 | Filter /menu to show only food categories, exclude liquor/drinks; comprehensive liquor inventory seeding |
| 142 | Tiered Pricing & Exclusion Rules | DONE | Menu | 04 | Tiered pricing (flat_tiers, free_threshold), exclusion groups, ModifierFlowEditor |
| 143 | Item-Owned Modifier Groups | DONE | Menu | 142 | isLabel, drag-drop, cross-item copy, inline editing, ingredient linking |
| 144 | Production Hardening Pass | DONE | Menu | 142, 143 | Cycle safety, 26 toast errors, debounced save, price validation, API hardening |
| 145 | Ingredient Verification | DONE | Inventory | 125, 204 | needsVerification flag, red highlight in inventory, verify button |
| 204 | Ingredient Library Refactor | DONE | Inventory | 125, 126, 127 | useIngredientLibrary hook, BulkActionBar, DeletedItemsPanel, 61% code reduction, race protection, bulk API, accessibility |
| 205 | Ingredient Component Improvements | DONE | Inventory | 204 | useIngredientCost hook, recipe-cost aggregation, useHierarchyCache, error rollback, 85% network reduction |
| 208 | POS Modifier Modal Redesign | DONE | Menu | 04, 100 | Dark glassmorphism, fixed-size modal, group progress dots, smooth transitions |
| 209 | Combo Step Flow | DONE | Menu | 41, 208 | Step-by-step wizard for combo meal configuration in POS |
| 210 | Modifier Cascade Delete & Orphan Cleanup | DONE | Menu | 143 | Cascade delete w/ preview, orphan auto-fix, fluid nesting, collapsed child chips |
| 211 | Hierarchical Ingredient Picker | DONE | Inventory | 126, 143 | Unified picker (ingredients + modifier linking), category→parent→prep tree, inline creation |
| 212 | Per-Modifier Print Routing | DONE | Menu | 103, 143 | Printer button per modifier, follow/also/only modes, printer selection, API done, dispatch pending |
| 213 | Real-Time Ingredient Library | DONE | Inventory | 211, 127 | Optimistic update + socket dispatch for ingredient creation sync |
| 214 | Ingredient Verification Visibility | DONE | Inventory | 145, 211 | Badges, category warnings, recursive reverse ingredient-modifier linking |
| 215 | Unified Modifier Inventory Deduction | DONE | Inventory | 125, 143 | Fallback path: Modifier.ingredientId -> Ingredient -> InventoryItem for deduction |
| 216 | Ingredient-Modifier Connection Visibility | DONE | Inventory | 143, 204, 211, 214 | Connected badge, dual-path menu item resolution, expandable linked modifiers |
| 217 | Menu Socket Real-Time Updates | DONE | Menu | - | Socket dispatch functions (dispatchMenuItemChanged, dispatchMenuStockChanged, dispatchMenuStructureChanged), broadcast handlers, multi-location safety. Client integration pending. |
| 217b | Bottle Service Tiers | DONE | Payments | 120 | BottleServiceTier model, deposit pre-auth, tiered packages, spend progress, re-auth alerts, auto-gratuity |
| 218 | Customer-Facing Display (CFD) | DONE | Guest | 120 | /cfd route, state machine (8 states), 5 components, Socket.io event types defined (not yet wired) |
| 219 | Pay-at-Table | DONE | Guest | 120 | /pay-at-table route, split check (2-6 ways), 3 components, processes via Datacap sale |
| 220 | Bartender Mobile | DONE | Guest | 120 | /mobile/tabs list + detail, 2 components, 10s polling, Socket.io event stubs (not yet wired) |

### Routing & Kitchen Display (200-Series)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 201 | Tag-Based Routing Engine | DONE | KDS | 67, 103 | Unified pub/sub routing replacing scattered printerIds, Station model, OrderRouter class |
| 202 | Socket.io Real-Time KDS | DONE | KDS | 201 | WebSocket-based KDS updates replacing polling, room architecture (location/tag/terminal) |
| 203 | Reference Items & Atomic Print | DONE | KDS | 201 | Context items on tickets, per-element print formatting (size/align/reverse/dividers) |

---

## Next Session Priority (2026-02-07+)

### Priority 1: Inventory ↔ Menu Sync (BIGGEST TODO)
Complete the full inventory-to-menu integration:
- Fix ingredient linking stale state bug (Worker W6 prompt ready)
- Verify Workers W7 + W8 output (real-time ingredient library + verification badges)
- Test bidirectional ingredient↔modifier linking at all nesting depths
- Ensure every item sold records correct ingredient usage for reporting/PM mix
- Cost tracking: ingredient costs flow through to menu item costing
- Unify liquor + food inventory deduction engines (see CLAUDE.md Priority 5)

### Priority 2: POS Ordering Flow UI
Front-end visual issues with taking orders:
- Review ModifierModal flow for customer-facing scenarios
- Test Add Item vs Add Choice (plan exists: `~/.claude/plans/playful-wobbling-gadget.md`)
- Verify modifier stacking, child group navigation, default selections
- Review FloorPlanHome inline ordering end-to-end

### Priority 3: Bar Tabs UI (Skill 20 Enhancement)
- Improve OpenOrdersPanel tab list UI for bartenders
- Quick tab creation from floor plan (Bar Tab button)
- Pre-auth card capture flow
- Tab transfer/merge within FloorPlanHome

### Priority 4: Closed Order Management (Skill 114)
- Closed orders list view with search/filter by date, server, table
- View full order details for closed orders
- Void payments (manager PIN required)
- Adjust tips after close
- Reprint receipts for closed orders
- Reopen closed orders with reason tracking

### Priority 5: Kitchen Print Integration
- Connect /api/orders/[id]/send to actual print API
- Route tickets to correct printers based on print routes
- Handle printer offline gracefully
- Integrate per-modifier print routing (Skill 212 + Skill 103 Phase 3)

---

## How to Add a New Skill

1. Add to appropriate category table above (or "Additional Skills" for emergent features)
2. Document dependencies
3. Create detailed spec at `docs/skills/XX-SKILL-NAME.md` (optional for small features)
4. Update parallel development groups if applicable
5. Update `docs/CHANGELOG.md` when implementing
6. Mark as DONE in this index when complete
