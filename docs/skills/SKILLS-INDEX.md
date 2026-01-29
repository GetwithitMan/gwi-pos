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
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 01 | Employee Management | DONE | - | CRUD, roles, permissions, PIN login |
| 09 | Features & Config | DONE | - | Settings, feature flags, category types (food/drinks/liquor/entertainment/combos) |
| 36 | Tax Calculations | DONE | 09 | Tax rules, multiple rates, admin UI |
| 59 | Location Multi-tenancy | TODO | - | Multi-location support |

### Order Flow (Core)
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 02 | Quick Order Entry | DONE | 01 | Order creation, save to DB, update existing |
| 03 | Menu Display | DONE | - | Categories, items, dual pricing display |
| 04 | Modifiers | DONE | 03 | Nested modifiers, pre-modifiers |
| 05 | Order Review | PARTIAL | 02 | Order panel has items/totals, no separate review screen |
| 06 | Tipping | DONE | 09 | Tip suggestions, custom entry |
| 07 | Send to Kitchen | DONE | 02 | Orders save, sent/new tracking, KDS integration |
| 08 | Receipt Printing | DONE | 09 | Print formatting, view/print from POS |
| 10 | Item Notes | DONE | 02 | Schema + UI: modifier modal + quick edit |

### Payment (Build Together)
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 30 | Payment Processing | DONE | 02, 31 | Cash, card, split, tips |
| 31 | Dual Pricing | DONE | 09 | Cash discount program |
| 32 | Gift Cards | DONE | 30 | Purchase, redeem, reload, freeze |
| 33 | House Accounts | DONE | 30 | Charge to account, payment tracking |

### Advanced Order Features
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 11 | Seat Tracking | DONE | 02 | Per-seat orders, item assignment API |
| 12 | Course Firing | DONE | 07 | Multi-course meals, course API |
| 13 | Hold & Fire | DONE | 07 | Kitchen timing, hold/fire actions |
| 14 | Order Splitting | DONE | 30 | Split evenly, by item, custom amount |
| 15 | Order Merging | DONE | 02 | Merge orders, move items, recalc totals |

### Table Management
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 16 | Table Layout | DONE | - | Floor plan, sections, shapes |
| 17 | Table Status | DONE | 16 | Available/occupied/reserved/dirty, quick toggle |
| 18 | Table Transfer | DONE | 16, 02 | Transfer API, moves orders with audit log |
| 19 | Reservations | DONE | 16 | Full booking system, admin page, status tracking |

### Bar Features
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 20 | Bar Tabs | DONE | 02 | Create, view, edit, pay tabs |
| 21 | Pre-auth | DONE | 30 | Card hold on tab open |
| 22 | Tab Transfer | DONE | 20 | Move tabs between employees, audit log |

### Kitchen Display
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 67 | Prep Stations | DONE | - | KDS routing: station types, category/item assignment |
| 23 | KDS Display | DONE | 07, 67 | Full KDS screen: item bump, station filter, fullscreen |
| 24 | Bump Bar | TODO | 23 | Physical bump bar hardware |
| 25 | Expo Station | PARTIAL | 23 | Expo mode works via showAllItems toggle |
| 26 | Prep Tickets | TODO | 07 | Prep station routing |

### Pricing & Discounts
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 27 | Happy Hour | DONE | 09, 03 | Time-based pricing, schedules, settings |
| 28 | Discounts | DONE | 02 | Manual discounts, preset rules, % or $ |
| 29 | Commissioned Items | DONE | 01 | Sales commissions |
| 34 | Comps & Voids | DONE | 02, 01 | Comp/void items, reasons, reports |
| 35 | Coupons | DONE | 28 | Promo codes, admin page, redemption tracking |

### Inventory & Menu
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 37 | 86 Items | DONE | 03 | Item availability |
| 38 | Inventory Tracking | DONE | 37 | Stock levels, transactions, admin page |
| 39 | Low Stock Alerts | DONE | 38 | Alerts API, acknowledge, priority levels |
| 40 | Menu Scheduling | DONE | 03, 09 | Daypart menus, time windows |
| 41 | Combo Meals | DONE | 03 | Item-based combos, modifier price overrides, admin page, POS modal |

### Reporting
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 42 | Sales Reports | DONE | 30 | Day, hour, category, item, employee, table, seat, order type, modifier, payment method |
| 43 | Labor Reports | DONE | 47 | Hours worked, labor costs, overtime, by employee/day/role |
| 44 | Product Mix | DONE | 42 | Item performance, pairings, hourly distribution |
| 45 | Void Reports | DONE | 34 | By date, employee, reason |
| 46 | Commission Reports | DONE | 29 | Employee commissions |
| 70 | Discount Reports | DONE | 28 | Discount usage, by type, by employee, by day |
| 71 | Transfer Reports | DONE | 22, 68 | Tab/item transfers, audit trail, by employee/hour |
| 72 | Table Reports | DONE | 16, 42 | Sales by table, turn times, server sections |
| 73 | Customer Reports | DONE | 51 | Spend tiers, frequency, tags, at-risk customers |

### Employee Features
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 47 | Clock In/Out | DONE | 01 | Clock in/out, breaks, hours, modal UI |
| 48 | Breaks | DONE | 47 | Break start/end API, duration tracking |
| 49 | Cash Drawer | PARTIAL | 01, 30 | Starting cash tracked via Shift |
| 50 | Shift Close | DONE | 49 | Shift start/close, cash count, variance, summary |

### Customer Features
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 51 | Customer Profiles | DONE | - | Full CRUD, admin UI at /customers, reports |
| 52 | Loyalty Program | DONE | 51 | Points earning/redemption, settings, receipt display |
| 53 | Online Ordering | TODO | 03, 30, 99 | Web orders (modifier override ready via ?channel=online) |
| 54 | Order Ahead | TODO | 53 | Scheduled pickup |

### Hardware Integration
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 55 | Receipt Printer | TODO | 08 | Direct printing |
| 56 | Cash Drawer | TODO | 49 | Drawer control |
| 57 | Card Reader | TODO | 30 | Payment terminal |
| 58 | Barcode Scanner | TODO | 03 | Item lookup |

### Advanced
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 60 | Offline Mode | TODO | ALL | Work without internet |

### Additional Skills (80+)
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 80 | Floor Plan Editor | DONE | 16 | Drag & drop table positioning |
| 81 | Timed Rentals | DONE | 03 | Pool tables, karaoke, bowling - POS integration, stop & bill, entertainment category type builder, status tracking (94-97) |
| 82 | Login Redirect | DONE | 09 | Preserve destination URL after login |

---

## Implementation Summary

### Completion Status by Category

| Category | Done | Partial | Todo | Total | % Complete |
|----------|------|---------|------|-------|------------|
| Foundation | 3 | 0 | 1 | 4 | 75% |
| Order Flow | 7 | 1 | 0 | 8 | 94% |
| Payment | 4 | 0 | 0 | 4 | 100% |
| Advanced Orders | 5 | 0 | 0 | 5 | 100% |
| Table Management | 4 | 0 | 0 | 4 | 100% |
| Bar Features | 3 | 0 | 0 | 3 | 100% |
| Kitchen Display | 2 | 1 | 2 | 5 | 50% |
| Pricing & Discounts | 5 | 0 | 0 | 5 | 100% |
| Inventory & Menu | 5 | 0 | 0 | 5 | 100% |
| Reporting | 11 | 0 | 0 | 11 | 100% |
| Employee Features | 3 | 1 | 0 | 4 | 88% |
| Customer Features | 2 | 0 | 2 | 4 | 50% |
| Hardware | 0 | 0 | 4 | 4 | 0% |
| Advanced | 0 | 0 | 1 | 1 | 0% |
| Additional (80-101) | 17 | 0 | 0 | 17 | 100% |
| **TOTAL** | **74** | **3** | **7** | **84** | **92%** |

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

## Recently Completed (2026-01-29)

| Skill | Name | What Was Built |
|-------|------|----------------|
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

| # | Name | Status | Dependencies | Notes |
|---|------|--------|--------------|-------|
| 61 | Open Orders View | DONE | 02 | Panel to view/filter/load open orders by type |
| 62 | Order Updates | DONE | 02, 07 | Add items to existing orders, track sent vs new |
| 63 | Resend to Kitchen | DONE | 07, 23 | Resend items with notes, RESEND badge on KDS |
| 64 | KDS ↔ POS Sync | DONE | 23 | MADE badge on POS when kitchen completes item |
| 65 | Order History | DONE | 02, 30 | View past orders, search, filters, receipt view |
| 66 | Quick Reorder | TODO | 65, 51 | Reorder from history for regulars |
| 68 | Item Transfer | DONE | 02 | Move items between orders |
| 69 | Split Item Payment | DONE | 14, 30 | Split single item cost among N people |
| 70 | Discount Reports | DONE | 28 | Discount usage, by rule/employee/day |
| 71 | Transfer Reports | DONE | 22, 68 | Tab/item transfer audit trail |
| 72 | Table Reports | DONE | 16, 42 | Sales by table, turn times, sections |
| 73 | Customer Reports | DONE | 51 | Spend tiers, frequency, VIP tracking |
| 74 | Employee Reports | DONE | 47, 30 | Sales, tips, purse balance, by day |
| 75 | Closed Orders View | DONE | 02, 30 | View today's paid/closed orders |
| 76 | Course/Seat Management UI | DONE | 11, 12 | POS UI for seat/course assignment |
| 77 | Hold & Fire UI | DONE | 13 | POS controls for holding/firing items |
| 78 | Coupon Reports | DONE | 35 | Usage, redemptions, daily trend, by type |
| 79 | Reservation Reports | DONE | 19 | Patterns, no-shows, table utilization |
| 80 | Floor Plan Editor | DONE | 16 | Drag & drop table positioning, canvas, properties panel |
| 81 | Timed Rentals | DONE | 03 | Pool tables, dart boards, POS session management, stop & bill, status tracking, waitlist |
| 83 | Category Types | DONE | 09 | Food/Drinks/Liquor/Entertainment/Combos - for reporting and conditional item builders |
| 84 | Combo Price Overrides | DONE | 41 | Per-modifier price overrides for combo-specific pricing |
| 85 | Entertainment Item Builder | DONE | 81, 83 | Admin UI for timed billing items with per-15min/30min/hour rate inputs |
| 86 | Combo Selection Modal | DONE | 41 | POS modal showing combo items with their modifier groups for selection |
| 87 | Conditional Item Builders | DONE | 83 | Different item creation UIs based on category type (entertainment, food, etc.) |
| 88 | Price Rounding | DONE | 09 | Round totals to $0.05, $0.10, $0.25, $0.50, $1.00 - direction: nearest/up/down |
| 89 | Input Validation | DONE | - | Zod schemas for API request validation, validateRequest() helper |
| 90 | Error Boundaries | DONE | - | React ErrorBoundary component for graceful error handling |
| 91 | API Error Handling | DONE | - | Custom error classes (ValidationError, NotFoundError, etc.), handleApiError() |
| 92 | Query Optimization | DONE | - | N+1 query fixes, pagination, batch queries for performance |
| 93 | Split Ticket View | DONE | 30, 88 | Create multiple tickets from one order (30-1, 30-2), hybrid pricing with proportional discounts |
| 94 | Entertainment Status Tracking | DONE | 81 | Auto-mark items in_use/available, real-time status on menu, IN USE badge |
| 95 | Entertainment Waitlist | DONE | 94 | Add customers to waitlist with name, phone, party size, wait time display |
| 96 | Waitlist Tab Integration | DONE | 95, 20 | Link waitlist to existing tab or start new tab with card |
| 97 | Waitlist Deposits | DONE | 95 | Take cash/card deposits to hold position on waitlist |
| 98 | Entertainment KDS | DONE | 94, 95 | Dedicated KDS page at /entertainment with item grid, status display, waitlist panel |
| 99 | Online Ordering Modifier Override | DONE | 04, 53 | Per-item control of which modifier groups appear online, two-level visibility (item + modifier) |
| 100 | Modifier Stacking UI | DONE | 04 | Visual feedback for stacked selections (gradient, 2x badge, hint text) |
| 101 | Modifier Hierarchy Display | DONE | 04 | Depth tracking for nested modifiers, dash prefix display on KDS/orders |

---

## How to Add a New Skill

1. Add to appropriate category table above (or "Additional Skills" for emergent features)
2. Document dependencies
3. Create detailed spec at `docs/skills/XX-SKILL-NAME.md` (optional for small features)
4. Update parallel development groups if applicable
5. Update `docs/CHANGELOG.md` when implementing
6. Mark as DONE in this index when complete
