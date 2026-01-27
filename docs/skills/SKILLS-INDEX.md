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
| 09 | Features & Config | DONE | - | Settings, feature flags |
| 36 | Tax Calculations | PARTIAL | 09 | Tax rules, multiple rates |
| 59 | Location Multi-tenancy | TODO | - | Multi-location support |

### Order Flow (Core)
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 02 | Quick Order Entry | DONE | 01 | Order creation, save to DB, update existing |
| 03 | Menu Display | DONE | - | Categories, items, dual pricing display |
| 04 | Modifiers | DONE | 03 | Nested modifiers, pre-modifiers |
| 05 | Order Review | PARTIAL | 02 | Order panel has items/totals, no separate review screen |
| 06 | Tipping | DONE | 09 | Tip suggestions, custom entry |
| 07 | Send to Kitchen | PARTIAL | 02 | **UI done, orders save, sent/new tracking - needs KDS** |
| 08 | Receipt Printing | TODO | 09 | Print formatting |
| 10 | Item Notes | DONE | 02 | Schema + UI: modifier modal + quick edit |

### Payment (Build Together)
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 30 | Payment Processing | DONE | 02, 31 | Cash, card, split, tips |
| 31 | Dual Pricing | DONE | 09 | Cash discount program |
| 32 | Gift Cards | TODO | 30 | Purchase, redeem |
| 33 | House Accounts | TODO | 30 | Charge to account |

### Advanced Order Features
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 11 | Seat Tracking | TODO | 02 | Per-seat orders |
| 12 | Course Firing | TODO | 07 | Multi-course meals |
| 13 | Hold & Fire | TODO | 07 | Kitchen timing |
| 14 | Order Splitting | TODO | 30 | Split checks |
| 15 | Order Merging | TODO | 02 | Combine orders |

### Table Management
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 16 | Table Layout | TODO | - | Floor plan |
| 17 | Table Status | TODO | 16 | Open/occupied/dirty |
| 18 | Table Transfer | TODO | 16, 02 | Move between servers |
| 19 | Reservations | TODO | 16 | Booking system |

### Bar Features
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 20 | Bar Tabs | DONE | 02 | Create, view, edit, pay tabs |
| 21 | Pre-auth | DONE | 30 | Card hold on tab open |
| 22 | Tab Transfer | TODO | 20 | Move tabs between employees |

### Kitchen Display
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 23 | KDS Display | TODO | 07 | Kitchen screens |
| 24 | Bump Bar | TODO | 23 | Order completion |
| 25 | Expo Station | TODO | 23 | Order coordination |
| 26 | Prep Tickets | TODO | 07 | Prep station routing |

### Pricing & Discounts
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 27 | Happy Hour | TODO | 09, 03 | Time-based pricing |
| 28 | Discounts | TODO | 02 | Manual discounts |
| 29 | Commissioned Items | DONE | 01 | Sales commissions |
| 34 | Comps & Voids | TODO | 02, 01 | Manager approval |
| 35 | Coupons | TODO | 28 | Promo codes |

### Inventory & Menu
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 37 | 86 Items | DONE | 03 | Item availability |
| 38 | Inventory Tracking | TODO | 37 | Stock levels |
| 39 | Low Stock Alerts | TODO | 38 | Notifications |
| 40 | Menu Scheduling | TODO | 03, 09 | Daypart menus |
| 41 | Combo Meals | TODO | 03 | Bundled items |

### Reporting
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 42 | Sales Reports | DONE | 30 | Summary, daily, hourly, category, item, employee |
| 43 | Labor Reports | TODO | 01 | Hours, costs |
| 44 | Product Mix | TODO | 42 | Item performance |
| 45 | Void Reports | TODO | 34 | Loss tracking |
| 46 | Commission Reports | DONE | 29 | Employee commissions |

### Employee Features
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 47 | Clock In/Out | TODO | 01 | Time tracking |
| 48 | Breaks | TODO | 47 | Break management |
| 49 | Cash Drawer | TODO | 01, 30 | Drawer assignment |
| 50 | Shift Close | TODO | 49 | End of day |

### Customer Features
| Skill | Name | Status | Dependencies | Notes |
|-------|------|--------|--------------|-------|
| 51 | Customer Profiles | TODO | - | Loyalty, history |
| 52 | Loyalty Program | TODO | 51 | Points, rewards |
| 53 | Online Ordering | TODO | 03, 30 | Web orders |
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

---

## Parallel Development Groups

Skills that can be developed simultaneously (no dependencies on each other):

### Group A: Payment & Pricing
- 30: Payment Processing
- 32: Gift Cards
- 33: House Accounts
- 35: Coupons

### Group B: Table & Floor
- 16: Table Layout
- 19: Reservations

### Group C: Kitchen
- 23: KDS Display
- 26: Prep Tickets

### Group D: Reports
- 42: Sales Reports
- 43: Labor Reports
- 44: Product Mix

### Group E: Employee
- 47: Clock In/Out
- 49: Cash Drawer

---

## Next Foundational Skills to Build

Based on current implementation, these are the next foundational skills needed:

### Priority 1: Kitchen Display System (KDS)
**Skill 23: KDS Display** - Complete the kitchen integration
- Dependencies: 07 (partial - UI done)
- Unlocks: 24, 25, 26
- Why: Send to Kitchen UI is done, need the actual kitchen screen
- **We have:** Order save, sent item tracking, resend icon placeholder

### Priority 2: Table Management
**Skill 16: Table Layout** - Foundation for dine-in service
- Dependencies: None
- Unlocks: 17, 18, 19
- Why: Dine-in orders need table assignment and tracking
- **We have:** Order types include dine_in, Open Orders panel shows table orders

### Priority 3: Item Notes ✓ COMPLETED
**Skill 10: Item Notes** - Special instructions for kitchen
- Dependencies: 02 (done)
- Unlocks: Better kitchen communication
- **Completed:** Notes input in modifier modal + quick edit button on items

### Priority 4: Sales Reports ✓ COMPLETED
**Skill 42: Sales Reports** - Business intelligence
- Dependencies: 30 (done)
- Unlocks: 44, dashboard insights
- **Completed:** Summary, daily, hourly, category, item, employee reports with tabs

### Priority 5: Employee Time Tracking
**Skill 47: Clock In/Out** - Employee time management
- Dependencies: 01 (done)
- Unlocks: 43, 48, 50
- Why: Required for labor reports and shift management
- **We have:** Employee system, login tracking

### Priority 6: Order Splitting
**Skill 14: Order Splitting** - Split checks between guests
- Dependencies: 30 (done)
- Unlocks: Better table service
- Why: Common restaurant need, payments support split already

---

## Recently Completed (2026-01-27)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 01 | Employee Management | CRUD API, role assignment, PIN auth, admin UI |
| 02 | Quick Order Entry | Order creation, save to DB, update existing orders |
| 06 | Tipping | Suggested %, custom amount, per-method |
| 07 | Send to Kitchen | **PARTIAL:** UI, order save, sent/new item tracking (no KDS yet) |
| 09 | Features & Config | Settings admin, dual pricing toggle, tax rate |
| 10 | Item Notes | Special instructions: modifier modal input, quick edit button |
| 20 | Bar Tabs | Tab create/view/edit, items, close |
| 42 | Sales Reports | Summary, daily, hourly, category, item, employee views |
| 21 | Pre-auth | Card hold on tab, release, expiration |
| 29 | Commissioned Items | Item/modifier commissions, reports |
| 30 | Payment Processing | Cash/card payments, tips, rounding, simulated card |
| 31 | Dual Pricing | Cash discount program, both prices displayed |
| 46 | Commission Reports | By employee, date range, order drill-down |

### Structure Built (Not Yet Full Skills)

| Component | Location | Could Become Skill |
|-----------|----------|-------------------|
| Open Orders Panel | `src/components/orders/OpenOrdersPanel.tsx` | Open Orders View |
| Order Update API | `src/app/api/orders/[id]/route.ts` | Order Updates |
| Sent Item Tracking | `order-store.ts` sentToKitchen flag | Part of Skill 07 |
| Resend to Kitchen Icon | orders page printer icon | Resend to Kitchen |

---

## Status Legend

- **TODO** - Not started
- **PARTIAL** - Foundation built, full feature incomplete
- **DONE** - Fully implemented
- **BLOCKED** - Waiting on dependency

---

## Proposed New Skills

Based on what we've built, these skills should be added:

| # | Name | Description | Dependencies | Priority |
|---|------|-------------|--------------|----------|
| 61 | Open Orders View | View/filter/search all open orders by type | 02 | Built |
| 62 | Order Updates | Add items to existing orders, track sent vs new | 02, 07 | Built |
| 63 | Resend to Kitchen | Resend specific items to KDS (marked as RESEND) | 07, 23 | Placeholder |
| 64 | Order History | View past orders, search, analytics | 02, 30 | Medium |
| 65 | Quick Reorder | Reorder from history for regulars | 64, 51 | Low |

---

## How to Add a New Skill

1. Add to appropriate category table above
2. Document dependencies
3. Create detailed spec at `docs/skills/XX-SKILL-NAME.md`
4. Update parallel development groups if applicable
5. Update CHANGELOG.md when implementing
