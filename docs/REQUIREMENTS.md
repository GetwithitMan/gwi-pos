# GWI POS - System Requirements

**Version:** 1.1
**Last Updated:** January 30, 2026
**Status:** Planning Phase

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Core Philosophy](#2-core-philosophy)
3. [System Modules Overview](#3-system-modules-overview)
4. [Order Types & Flow](#4-order-types--flow)
5. [Employee Management](#5-employee-management)
6. [Menu & Items](#6-menu--items)
7. [Table & Floor Management](#7-table--floor-management)
8. [Tipping System](#8-tipping-system)
9. [Payment Processing](#9-payment-processing)
10. [Kitchen & Production](#10-kitchen--production)
11. [Inventory & Tracking](#11-inventory--tracking)
12. [Reporting & Analytics](#12-reporting--analytics)
13. [Customer Experience](#13-customer-experience)
14. [Hardware & Devices](#14-hardware--devices)
15. [Security & Compliance](#15-security--compliance)
16. [Performance & Reliability](#16-performance--reliability)

---

## 1. Executive Summary

GWI POS is a comprehensive, web-based point of sale system designed for bars, restaurants, and hospitality venues. Built with a "fewest clicks philosophy," every workflow is optimized for speed and efficiency in high-volume environments.

### Key Differentiators

- **Speed First:** Sub-100ms response times for all interactions
- **Offline Capable:** Full functionality without internet connection
- **Deeply Modular:** 60+ skills (feature domains) that work independently and together
- **Complete Audit Trail:** Every button press tracked and logged
- **Beautiful Interfaces:** Customer-facing displays and intuitive operator screens

### Target Venues

- Full-service restaurants
- Bars and nightclubs
- Quick-service restaurants
- Coffee shops
- Food trucks
- Catering operations
- Event venues

### Competitive Differentiation

Learn from existing systems (Toast, Square, SkyTab, SmartTab, Focus POS) but improve upon:
- Overly complex modifier systems
- Clunky table management interfaces
- Confusing tip pooling configurations
- Slow, multi-step workflows

---

## 2. Core Philosophy

### Fewest Clicks Philosophy

Every workflow must be optimized for minimum interactions:

| Action | Target Clicks |
|--------|--------------|
| Ring simple item | 1-2 |
| Ring item with modifier | 2-3 |
| Start new tab | 1 |
| Split check | 2-3 |
| Close cash transaction | 1-2 |

**Related Skills:**
- [02-Operator-Experience](skills/02-OPERATOR-EXPERIENCE.md) - Main POS interface design
- [43-Custom-Menus](skills/43-CUSTOM-MENUS.md) - Personal layouts for speed
- [44-Performance](skills/44-PERFORMANCE.md) - Speed optimization targets
- [47-Repeat-Orders](skills/47-REPEAT-ORDERS.md) - One-tap reordering

### Design Principles

1. **Consistency:** Same patterns across all screens
2. **Visibility:** Key information always visible
3. **Feedback:** Immediate response to all actions
4. **Forgiveness:** Easy to undo/correct mistakes
5. **Efficiency:** Expert users can fly, new users can learn

### Visual Clarity

- Color-coded status indicators (tables, orders, tickets)
- Large touch targets for touchscreen use
- Clear typography hierarchy
- Consistent iconography
- Dark mode support for bar environments

### Error Prevention

- Confirmation only for destructive actions
- Undo capability where possible
- Clear validation messages
- Prevent impossible states

---

## 3. System Modules Overview

```
+------------------------------------------------------------------+
|                        GWI POS SYSTEM                            |
+------------------------------------------------------------------+
|                                                                  |
|  +------------------+  +------------------+  +------------------+ |
|  | ORDER MANAGEMENT |  | MENU MANAGEMENT  |  | EMPLOYEE MGMT    | |
|  | - Quick Service  |  | - Categories     |  | - Profiles       | |
|  | - Table Service  |  | - Items          |  | - Roles/Perms    | |
|  | - Bar Tabs       |  | - Modifiers      |  | - Time Tracking  | |
|  | - Online Orders  |  | - Pricing        |  | - Scheduling     | |
|  +------------------+  +------------------+  +------------------+ |
|                                                                  |
|  +------------------+  +------------------+  +------------------+ |
|  | TABLE/FLOOR MGMT |  | PAYMENT/TIPPING  |  | REPORTING        | |
|  | - Floor Plans    |  | - Credit Cards   |  | - Sales          | |
|  | - Table Status   |  | - Cash           |  | - Labor          | |
|  | - Reservations   |  | - Tip Pooling    |  | - Inventory      | |
|  | - Sections       |  | - Split Checks   |  | - Custom         | |
|  +------------------+  +------------------+  +------------------+ |
|                                                                  |
|  +------------------+  +------------------+  +------------------+ |
|  | ADMIN BACKEND    |  | CUSTOMER DISPLAY |  | INTEGRATIONS     | |
|  | - Settings       |  | - Order View     |  | - Payment Proc.  | |
|  | - Configuration  |  | - Branding       |  | - Accounting     | |
|  | - User Mgmt      |  | - Promotions     |  | - Delivery       | |
|  | - Audit Logs     |  | - Tip Selection  |  | - Loyalty        | |
|  +------------------+  +------------------+  +------------------+ |
|                                                                  |
+------------------------------------------------------------------+
```

---

## 4. Order Types & Flow

### Supported Order Types

| Type | Description | Skills |
|------|-------------|--------|
| **Walk-Up** | Counter service, pay first | [02](skills/02-OPERATOR-EXPERIENCE.md), [04](skills/04-ORDER-MANAGEMENT.md) |
| **Table Service** | Full-service dining | [04](skills/04-ORDER-MANAGEMENT.md), [24](skills/24-SEAT-ORDERING.md) |
| **Bar Tab** | Open tab by card/name | [10](skills/10-BAR-MANAGEMENT.md) |
| **Quick Tab** | Simplified bar ordering | [10](skills/10-BAR-MANAGEMENT.md) |
| **Online** | Web/app ordering | [23](skills/23-ONLINE-ORDERING.md) |
| **Delivery** | In-house delivery | [35](skills/35-DELIVERY-TRACKING.md) |
| **Catering** | Large advance orders | [04](skills/04-ORDER-MANAGEMENT.md) |
| **Timed Items** | Pool tables, dart boards | [13](skills/13-TIMED-ITEMS.md) |
| **Drive-Thru** | Vehicle-based ordering | [04](skills/04-ORDER-MANAGEMENT.md) |

### Order Lifecycle

```
New Order → Items Added → Sent to Kitchen → Prepared → Served → Payment → Closed
     ↓           ↓              ↓             ↓          ↓         ↓
  [Skill 04] [Skills 03,32] [Skill 38]   [Skill 14]  [Skill 06] [Skill 30]
```

### Order Operations

- Add items to order
- Remove/void items (with permission)
- Modify items (add/remove modifiers)
- Apply discounts
- Add notes/special instructions
- Split check (by item, by seat, by amount, custom)
- Merge checks
- Transfer check (to another server/table)
- Hold/fire orders
- Reprint tickets
- Reopen closed checks (with permission)

**Related Skills:**
- [04-Order-Management](skills/04-ORDER-MANAGEMENT.md) - Core order operations
- [11-Splitting](skills/11-SPLITTING.md) - Check splitting
- [12-Transfers](skills/12-TRANSFERS.md) - Item transfers
- [14-Coursing](skills/14-COURSING.md) - Course management
- [15-Hold-Fire](skills/15-HOLD-FIRE.md) - Kitchen timing

---

## 5. Employee Management

### Staff Structure

Every employee has a profile with:
- Basic information (name, contact, photo)
- Role assignment(s)
- Permission set
- Pay rate(s)
- Tip eligibility
- Training status

**Primary Skill:** [05-Employees-Roles](skills/05-EMPLOYEES-ROLES.md)

### Role-Based Access Control

Standard roles with customizable permissions:

| Role | Access Level | Key Permissions |
|------|--------------|-----------------|
| Owner | Full | All system access |
| Manager | High | Voids, comps, reports, scheduling |
| Shift Lead | Medium | Limited voids, end of day |
| Server | Standard | Orders, payments, own tables |
| Bartender | Standard | Bar tabs, pour tracking |
| Host | Limited | Reservations, waitlist, seating |
| Kitchen | Limited | KDS, tickets, 86 items |
| Cashier | Limited | Register, payments only |

### Permission Categories

**Order Operations:**
- Create orders
- Modify orders
- Void items (own orders only / all orders)
- Apply discounts (with limits)
- Comp items/orders
- Reopen closed checks
- Transfer checks

**Payment Operations:**
- Process payments
- Process refunds
- No-sale drawer open
- Cash drop
- Close out drawer

**Management Operations:**
- View all orders (not just own)
- Override prices
- Adjust tips
- Clock in/out for others
- View reports (by level)
- Manage employees
- Configure system settings

**Admin Operations:**
- Full system access
- View audit logs
- Export data
- Manage integrations

### Time & Attendance

- Clock in/out with PIN or biometric
- Break tracking (paid/unpaid)
- Overtime alerts
- Schedule integration
- Drawer assignment at clock-in

**Related Skills:**
- [45-Time-Clock](skills/45-TIME-CLOCK.md) - Time clock operations
- [37-Drawer-Management](skills/37-DRAWER-MANAGEMENT.md) - Drawer assignment
- [05-Employees-Roles](skills/05-EMPLOYEES-ROLES.md) - Staff and permissions
- [21-Staff-Training](skills/21-STAFF-TRAINING.md) - Training mode

### Audit Trail (Action Tracking)

**EVERY button press tracked:**
- Timestamp
- Employee ID
- Action type
- Affected record (order ID, item ID, etc.)
- Before/after values
- Device/terminal ID
- IP address (for web access)

**Searchable/Filterable by:**
- Employee
- Date range
- Action type
- Specific order/item

---

## 6. Menu & Items

### Menu Structure

```
Categories
  └── Subcategories
        └── Items
              └── Modifier Groups
                    └── Modifiers
                          └── Nested Modifier Groups (3+ levels)
                                └── Nested Modifiers
```

**Primary Skill:** [03-Menu-Programming](skills/03-MENU-PROGRAMMING.md)

### Category Structure

- Unlimited nesting depth (recommend max 3-4 levels)
- Drag-and-drop reordering
- Category images/colors
- Category availability by time (Happy Hour, Lunch, Dinner)
- Category availability by order type (Dine-in only, Online only)

### Menu Items

**Basic Properties:**
- Name (display name)
- Short name (for tickets/KDS)
- Description
- Price(s) - multiple price levels possible
- SKU/PLU number
- Image
- Availability status
- Prep time estimate
- Printer routing (kitchen, bar, expo)

**Advanced Properties:**
- Tax configuration
- Cost (for margin reporting)
- Inventory tracking (optional)
- Allergen tags
- Dietary tags (vegan, GF, etc.)
- Calorie/nutrition info
- Age-restricted flag (alcohol)

### Modifier System (Nested)

Support for complex modifications:

```
Burger
  └── Protein (Required)
        ├── Beef [default]
        ├── Turkey
        └── Veggie
              └── Veggie Type (Required for Veggie)
                    ├── Beyond
                    ├── Impossible
                    └── Black Bean
  └── Cheese
        ├── American
        ├── Cheddar
        └── Swiss
              └── Swiss Style
                    ├── Baby Swiss
                    └── Aged Swiss
```

**Modifier Group Properties:**
- Name
- Required vs Optional
- Minimum selections
- Maximum selections (0 = unlimited)
- Free selections before upcharge
- Display style (buttons, list, grid)

**Modifier Properties:**
- Name
- Price adjustment (+$0.00, +$1.50, etc.)
- Default selected (yes/no)
- Availability

**Modifier Templates / Reusable Groups:**
- Create modifier groups once, apply to multiple items
- "Cooking Temperature" group applied to all steaks
- Changes to template propagate to all linked items
- Option to break link for item-specific customization

**Related Skills:**
- [03-Menu-Programming](skills/03-MENU-PROGRAMMING.md) - Menu structure
- [32-Pre-Modifiers](skills/32-PRE-MODIFIERS.md) - Lite, Extra, No
- [48-Custom-Notes](skills/48-CUSTOM-NOTES.md) - Special requests

### Pricing Features

- Base pricing
- Size variants
- Time-based pricing (happy hour)
- Day-of-week pricing
- Dual pricing (cash/card)
- Modifier pricing (add-ons)
- Combo/bundle pricing

**Related Skills:**
- [16-Happy-Hour](skills/16-HAPPY-HOUR.md) - Time-based pricing
- [31-Dual-Pricing](skills/31-DUAL-PRICING.md) - Cash discount programs
- [18-Discounts](skills/18-DISCOUNTS.md) - Discounts and BOGO

---

## 7. Table & Floor Management

### Floor Plan Designer

**Admin Interface:**
- Visual drag-and-drop floor editor
- Multiple floors/sections
- Table shapes (round, square, rectangular, custom)
- Table sizes (# of seats)
- Table numbering
- Obstacles/decorations (bar, host stand, etc.)
- Section assignments (for server sections)
- Save multiple layouts (normal, private event, etc.)

### Table Status

**Visual Indicators (Color-Coded):**
- Available (green)
- Seated - no order yet (yellow)
- Has active order (blue)
- Order ready/food on table (serving indicator)
- Check presented (purple)
- Needs attention (red/alert)
- Reserved (upcoming reservation)

**Table Timer:**
- Time since seated
- Time since last activity
- Turn time alerts

### Table Operations

- Seat party (with guest count)
- Assign server
- Start order from table
- View table order
- Move table (to different table)
- Merge tables
- Split table
- Clear table

### Server Sections

- Define sections
- Assign servers to sections
- Auto-assign based on schedule
- Rotation options
- Section summary view

**Related Skills:**
- [24-Seat-Ordering](skills/24-SEAT-ORDERING.md) - Seat-level ordering
- [25-Reservations](skills/25-RESERVATIONS.md) - Booking system
- [26-Host-Management](skills/26-HOST-MANAGEMENT.md) - Host operations

---

## 8. Tipping System

### Tip Types

| Type | Description | Skill |
|------|-------------|-------|
| **Standard Tips** | Regular credit card/cash tips | [06](skills/06-TIPPING.md) |
| **Tip Pooling** | Shared tips by role/time | [06](skills/06-TIPPING.md) |
| **Tip-Outs** | Percentage to support staff | [06](skills/06-TIPPING.md) |
| **One-Off Tips** | Tips to specific non-tipped staff | [06](skills/06-TIPPING.md) |
| **Service Charges** | Auto-grat, large party fees | [06](skills/06-TIPPING.md) |

**Primary Skill:** [06-Tipping](skills/06-TIPPING.md)

### Tip Entry Methods

- Customer enters on card reader
- Server enters from signed receipt
- Suggested tip amounts (%, $)
- Custom tip entry
- No tip option

### Tip Pool Types

**Percentage-Based Pool:**
- Define pool (e.g., "Support Staff Pool")
- Source: % of tips or % of sales
- Recipients: by role or by individual
- Distribution: even split or weighted

**Tip-Out System:**
- Servers tip out support staff
- Configurable % by role
- Example: 3% to busser, 2% to bar, 1% to host

**Points-Based System:**
- Assign points to each role
- Server = 10 points, Busser = 5 points
- Pool divided by total points

### Tip Distribution Flow

```
Total Tips Collected
        ↓
   Pool Contribution (if applicable)
        ↓
   Tip-Out Calculation
        ↓
   Individual Distribution
        ↓
   Tip Reporting
```

### Tip Payout

- End of shift cash-out
- Payroll integration
- Tip declaration
- IRS reporting support

**Related Skills:**
- [06-Tipping](skills/06-TIPPING.md) - Complete tipping system
- [46-Paid-In-Out](skills/46-PAID-IN-OUT.md) - Tip cash-out from drawer

---

## 9. Payment Processing

### Tender Types

| Tender | Description | Skill |
|--------|-------------|-------|
| Cash | Physical currency | [30](skills/30-TENDER-TYPES.md) |
| Credit Card | Visa, MC, Amex, Discover | [30](skills/30-TENDER-TYPES.md) |
| Debit Card | PIN debit | [30](skills/30-TENDER-TYPES.md) |
| Gift Card | House gift cards | [33](skills/33-GIFT-CARDS.md) |
| Comp | Manager comps | [18](skills/18-DISCOUNTS.md) |
| House Account | Charge accounts | [30](skills/30-TENDER-TYPES.md) |
| Split Tender | Multiple payment types | [30](skills/30-TENDER-TYPES.md) |
| Mobile Pay | Apple Pay, Google Pay | [30](skills/30-TENDER-TYPES.md) |

**Primary Skill:** [30-Tender-Types](skills/30-TENDER-TYPES.md)

### Card Processing

- EMV chip
- Contactless/NFC
- Swipe (fallback)
- Manual entry
- Pre-authorization (tabs)
- Offline mode (store and forward)

### Check Splitting Options

- Split evenly by X people
- Split by seat
- Split by item
- Custom split (drag items)
- Split payment only (one check, multiple payments)

### Cash Management

- Opening bank/drawer count
- Cash transactions
- Paid in/out tracking
- Over/short calculation
- End of day blind count
- Safe drops

**Related Skills:**
- [37-Drawer-Management](skills/37-DRAWER-MANAGEMENT.md) - Drawer operations
- [46-Paid-In-Out](skills/46-PAID-IN-OUT.md) - Non-sale cash movement
- [11-Splitting](skills/11-SPLITTING.md) - Check splitting

### Pricing Programs

- Standard pricing
- Cash discount (dual pricing)
- Surcharge programs
- Tax-inclusive pricing

**Related Skills:**
- [31-Dual-Pricing](skills/31-DUAL-PRICING.md) - Cash discount programs
- [36-Tax-Management](skills/36-TAX-MANAGEMENT.md) - Tax rates and rules

---

## 10. Kitchen & Production

### Kitchen Display System (KDS)

Multiple screen types:
- **Line Screens:** Station-specific orders
- **Expo Screen:** Order completion coordination
- **Customer Status:** Order ready display

**Primary Skill:** [38-Kitchen-Display](skills/38-KITCHEN-DISPLAY.md)

### Ticket Routing

```
Order Sent
     ↓
Route by Item Category
     ↓
Display on Station Screen(s)
     ↓
Cook/Prepare → Bump
     ↓
Expo Screen (if enabled)
     ↓
Server Pickup / Buzzer Alert
```

**Related Skills:**
- [38-Kitchen-Display](skills/38-KITCHEN-DISPLAY.md) - KDS operations
- [14-Coursing](skills/14-COURSING.md) - Course management
- [15-Hold-Fire](skills/15-HOLD-FIRE.md) - Kitchen timing
- [39-Buzzer-System](skills/39-BUZZER-SYSTEM.md) - Customer notification

### Order Notification

- Pager/buzzer systems
- SMS text alerts
- Customer display boards
- Server notification

**Related Skills:**
- [39-Buzzer-System](skills/39-BUZZER-SYSTEM.md) - Pager integration
- [27-Texting-SMS](skills/27-TEXTING-SMS.md) - SMS notifications

---

## 11. Inventory & Tracking

### Inventory Management

- Ingredient-level tracking
- Recipe costing
- Par levels and alerts
- 86 management
- Waste tracking

**Primary Skill:** [07-Inventory](skills/07-INVENTORY.md)

### Loss Prevention

| Loss Type | Tracking Method | Skill |
|-----------|-----------------|-------|
| Voids | Approval workflow | [19](skills/19-VOIDS.md) |
| Comps | Manager authorization | [18](skills/18-DISCOUNTS.md) |
| Waste | Kitchen recording | [20](skills/20-LOSS-TRACKING.md) |
| Over-pour | Recipe variance | [10](skills/10-BAR-MANAGEMENT.md) |
| Theft | Audit trail | [20](skills/20-LOSS-TRACKING.md) |

**Related Skills:**
- [07-Inventory](skills/07-INVENTORY.md) - Stock tracking
- [19-Voids](skills/19-VOIDS.md) - Void management
- [20-Loss-Tracking](skills/20-LOSS-TRACKING.md) - Loss prevention

---

## 12. Reporting & Analytics

### Report Categories

| Category | Examples | Skill |
|----------|----------|-------|
| Sales | Daily, hourly, by category | [08](skills/08-REPORTING.md) |
| Labor | Hours, costs, overtime | [08](skills/08-REPORTING.md) |
| Product Mix | Top sellers, slow movers | [08](skills/08-REPORTING.md) |
| Tips | By server, pool distribution | [06](skills/06-TIPPING.md) |
| Inventory | Usage, waste, variance | [07](skills/07-INVENTORY.md) |
| Cash | Drawer, paid in/out | [37](skills/37-DRAWER-MANAGEMENT.md) |

**Primary Skill:** [08-Reporting](skills/08-REPORTING.md)

### Sales Reports

- Daily sales summary
- Sales by hour/daypart
- Sales by category
- Sales by item
- Sales by employee
- Sales by order type
- Discount/comp report
- Void report
- Refund report

### Labor Reports

- Labor summary
- Hours by employee
- Labor % of sales
- Overtime report
- Clock in/out detail
- Timecard exceptions

### Real-Time Dashboard

Live metrics visible at a glance:
- Current sales vs. goal
- Labor percentage
- Covers/tickets
- Average check
- Table turns
- 86'd items

**Related Skill:** [22-Live-Dashboard](skills/22-LIVE-DASHBOARD.md)

### Report Delivery

- On-screen viewing
- PDF export
- CSV/Excel export
- Email scheduling (daily, weekly)
- Dashboard widgets

---

## 13. Customer Experience

### Customer-Facing Display

- Order confirmation screen
- Itemized display
- Total with tip suggestions
- Loyalty points display
- Promotional content

**Primary Skill:** [01-Customer-Experience](skills/01-CUSTOMER-EXPERIENCE.md)

### Display Modes

**Order Confirmation:**
- Show items as added
- Running total
- Clear, large text

**Payment Screen:**
- Total amount
- Tip selection (buttons + custom)
- Payment method selection
- Signature capture
- Receipt option (print/email/none)

**Idle/Marketing:**
- Promotional slides
- Menu highlights
- Brand messaging

### Customer Engagement

| Feature | Description | Skill |
|---------|-------------|-------|
| Loyalty | Points, rewards | [17](skills/17-LOYALTY.md) |
| Gift Cards | Purchase, reload, redeem | [33](skills/33-GIFT-CARDS.md) |
| Reservations | Booking, waitlist | [25](skills/25-RESERVATIONS.md) |
| SMS Updates | Order status, promos | [27](skills/27-TEXTING-SMS.md) |
| Online Ordering | Web, app integration | [23](skills/23-ONLINE-ORDERING.md) |

### Front of House

- Host stand management
- Waitlist with SMS
- Table management
- Reservation calendar

**Related Skills:**
- [01-Customer-Experience](skills/01-CUSTOMER-EXPERIENCE.md) - Customer display
- [17-Loyalty](skills/17-LOYALTY.md) - Rewards program
- [25-Reservations](skills/25-RESERVATIONS.md) - Bookings
- [26-Host-Management](skills/26-HOST-MANAGEMENT.md) - Host stand

---

## 14. Hardware & Devices

### Supported Devices

| Device Type | Examples | Skill |
|-------------|----------|-------|
| Terminals | Fixed POS stations | [34](skills/34-DEVICE-MANAGEMENT.md) |
| Tablets | Server handhelds | [34](skills/34-DEVICE-MANAGEMENT.md) |
| KDS | Kitchen screens | [38](skills/38-KITCHEN-DISPLAY.md) |
| Printers | Receipt, kitchen, bar | [34](skills/34-DEVICE-MANAGEMENT.md) |
| Card Readers | EMV, NFC, swipe | [34](skills/34-DEVICE-MANAGEMENT.md) |
| Cash Drawers | Standard, under-counter | [37](skills/37-DRAWER-MANAGEMENT.md) |
| Customer Display | Pole, screen | [01](skills/01-CUSTOMER-EXPERIENCE.md) |
| Buzzers/Pagers | Guest notification | [39](skills/39-BUZZER-SYSTEM.md) |
| ID Scanners | Age verification | [40](skills/40-BOUNCER-DOOR.md) |

**Primary Skill:** [34-Device-Management](skills/34-DEVICE-MANAGEMENT.md)

### Network Infrastructure

For reliable device communication:
- Unifi-based network topology
- VLAN segmentation (POS, Kitchen, Printers, Guest)
- Static IP assignments for all POS devices
- Firewall rules for security

**Primary Skill:** [49-Unifi-Network](skills/49-UNIFI-NETWORK.md)

### Printing System

| Component | Description | Skill |
|-----------|-------------|-------|
| Print Engine | Epson ePOS SDK implementation | [50](skills/50-EPSON-PRINTING.md) |
| Connection Pool | Persistent printer connections | [50](skills/50-EPSON-PRINTING.md) |
| Job Queue | Queuing with retry logic | [50](skills/50-EPSON-PRINTING.md) |
| Formatting | Fonts, indentation, layouts | [51](skills/51-PRINTER-SETTINGS.md) |

**Related Skills:**
- [50-Epson-Printing](skills/50-EPSON-PRINTING.md) - Print system implementation
- [51-Printer-Settings](skills/51-PRINTER-SETTINGS.md) - Format configuration

### Local Server

For reliability and offline operation:
- Local data storage
- Automatic failover
- Cloud sync when connected
- Multi-device coordination

**Primary Skill:** [42-Local-Server](skills/42-LOCAL-SERVER.md)

---

## 15. Security & Compliance

### Security Requirements

| Requirement | Implementation | Related Skills |
|-------------|----------------|----------------|
| Authentication | PIN, password, biometric | [05](skills/05-EMPLOYEES-ROLES.md) |
| Authorization | Role-based access | [05](skills/05-EMPLOYEES-ROLES.md) |
| Audit Trail | Complete action logging | [05](skills/05-EMPLOYEES-ROLES.md) |
| Data Encryption | At rest and in transit | [42](skills/42-LOCAL-SERVER.md) |
| PCI Compliance | Payment data security | [30](skills/30-TENDER-TYPES.md) |

### Compliance

| Standard | Area | Related Skills |
|----------|------|----------------|
| PCI DSS | Payment processing | [30](skills/30-TENDER-TYPES.md) |
| TCPA | SMS/texting | [27](skills/27-TEXTING-SMS.md) |
| Labor Laws | Time tracking, breaks | [45](skills/45-TIME-CLOCK.md) |
| Tax Rules | Collection, reporting | [36](skills/36-TAX-MANAGEMENT.md) |
| Age Verification | Alcohol sales | [40](skills/40-BOUNCER-DOOR.md) |

### Audit Trail

Every action logged:
- Who performed action
- What was done
- When it occurred
- Previous value
- New value
- Approval (if required)

**Related Skill:** [05-Employees-Roles](skills/05-EMPLOYEES-ROLES.md)

---

## 16. Performance & Reliability

### Performance Targets

| Metric | Target | Skill |
|--------|--------|-------|
| UI Response | <100ms | [44](skills/44-PERFORMANCE.md) |
| Order Send | <200ms | [44](skills/44-PERFORMANCE.md) |
| Payment Processing | <2s | [44](skills/44-PERFORMANCE.md) |
| Report Generation | <3s | [44](skills/44-PERFORMANCE.md) |
| System Boot | <10s | [44](skills/44-PERFORMANCE.md) |

**Primary Skill:** [44-Performance](skills/44-PERFORMANCE.md)

### Reliability Requirements

- 99.9% uptime target
- Automatic failover to local server
- Data sync with conflict resolution
- Graceful degradation
- Zero data loss

**Related Skills:**
- [42-Local-Server](skills/42-LOCAL-SERVER.md) - Offline capability
- [44-Performance](skills/44-PERFORMANCE.md) - Speed optimization

### Scalability

Support for:
- Single location to multi-unit
- 1 to 50+ terminals per location
- 1 to 500+ employees per location
- Thousands of menu items
- Years of historical data

---

## Skill Reference Matrix

### By Development Phase

#### Phase 1: MVP Foundation
| ID | Skill | Priority |
|----|-------|----------|
| 02 | [Operator-Experience](skills/02-OPERATOR-EXPERIENCE.md) | Critical |
| 03 | [Menu-Programming](skills/03-MENU-PROGRAMMING.md) | Critical |
| 04 | [Order-Management](skills/04-ORDER-MANAGEMENT.md) | Critical |
| 05 | [Employees-Roles](skills/05-EMPLOYEES-ROLES.md) | Critical |
| 09 | [Features-Config](skills/09-FEATURES-CONFIG.md) | Critical |
| 30 | [Tender-Types](skills/30-TENDER-TYPES.md) | Critical |
| 34 | [Device-Management](skills/34-DEVICE-MANAGEMENT.md) | Critical |
| 42 | [Local-Server](skills/42-LOCAL-SERVER.md) | Critical |
| 44 | [Performance](skills/44-PERFORMANCE.md) | Critical |
| 49 | [Unifi-Network](skills/49-UNIFI-NETWORK.md) | Critical |
| 50 | [Epson-Printing](skills/50-EPSON-PRINTING.md) | Critical |
| 51 | [Printer-Settings](skills/51-PRINTER-SETTINGS.md) | High |

#### Phase 2: Full Service
| ID | Skill | Priority |
|----|-------|----------|
| 01 | [Customer-Experience](skills/01-CUSTOMER-EXPERIENCE.md) | High |
| 06 | [Tipping](skills/06-TIPPING.md) | High |
| 08 | [Reporting](skills/08-REPORTING.md) | High |
| 10 | [Bar-Management](skills/10-BAR-MANAGEMENT.md) | High |
| 11 | [Splitting](skills/11-SPLITTING.md) | High |
| 12 | [Transfers](skills/12-TRANSFERS.md) | High |
| 18 | [Discounts](skills/18-DISCOUNTS.md) | High |
| 19 | [Voids](skills/19-VOIDS.md) | High |
| 36 | [Tax-Management](skills/36-TAX-MANAGEMENT.md) | High |
| 37 | [Drawer-Management](skills/37-DRAWER-MANAGEMENT.md) | High |
| 38 | [Kitchen-Display](skills/38-KITCHEN-DISPLAY.md) | High |
| 45 | [Time-Clock](skills/45-TIME-CLOCK.md) | High |
| 48 | [Custom-Notes](skills/48-CUSTOM-NOTES.md) | High |

#### Phase 3: Advanced Operations
| ID | Skill | Priority |
|----|-------|----------|
| 07 | [Inventory](skills/07-INVENTORY.md) | Medium |
| 14 | [Coursing](skills/14-COURSING.md) | Medium |
| 15 | [Hold-Fire](skills/15-HOLD-FIRE.md) | Medium |
| 16 | [Happy-Hour](skills/16-HAPPY-HOUR.md) | Medium |
| 20 | [Loss-Tracking](skills/20-LOSS-TRACKING.md) | Medium |
| 22 | [Live-Dashboard](skills/22-LIVE-DASHBOARD.md) | Medium |
| 24 | [Seat-Ordering](skills/24-SEAT-ORDERING.md) | Medium |
| 32 | [Pre-Modifiers](skills/32-PRE-MODIFIERS.md) | Medium |
| 43 | [Custom-Menus](skills/43-CUSTOM-MENUS.md) | Medium |
| 46 | [Paid-In-Out](skills/46-PAID-IN-OUT.md) | Medium |
| 47 | [Repeat-Orders](skills/47-REPEAT-ORDERS.md) | Medium |

#### Phase 4: Extended Features
| ID | Skill | Priority |
|----|-------|----------|
| 17 | [Loyalty](skills/17-LOYALTY.md) | Low |
| 21 | [Staff-Training](skills/21-STAFF-TRAINING.md) | Low |
| 23 | [Online-Ordering](skills/23-ONLINE-ORDERING.md) | Low |
| 25 | [Reservations](skills/25-RESERVATIONS.md) | Low |
| 26 | [Host-Management](skills/26-HOST-MANAGEMENT.md) | Low |
| 27 | [Texting-SMS](skills/27-TEXTING-SMS.md) | Low |
| 31 | [Dual-Pricing](skills/31-DUAL-PRICING.md) | Low |
| 33 | [Gift-Cards](skills/33-GIFT-CARDS.md) | Low |
| 35 | [Delivery-Tracking](skills/35-DELIVERY-TRACKING.md) | Low |
| 39 | [Buzzer-System](skills/39-BUZZER-SYSTEM.md) | Low |

#### Phase 5: Specialty
| ID | Skill | Priority |
|----|-------|----------|
| 13 | [Timed-Items](skills/13-TIMED-ITEMS.md) | Optional |
| 28 | [Bottle-Service](skills/28-BOTTLE-SERVICE.md) | Optional |
| 29 | [Commissioned-Items](skills/29-COMMISSIONED-ITEMS.md) | Optional |
| 40 | [Bouncer-Door](skills/40-BOUNCER-DOOR.md) | Optional |
| 41 | [Ticketing-Events](skills/41-TICKETING-EVENTS.md) | Optional |

---

## Implementation Notes

### Technology Stack (Decided)

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 16.x with React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS 4.x |
| State Management | Zustand 5.x |
| Validation | Zod 4.x |
| Database | SQLite (dev) / PostgreSQL (prod) |
| ORM | Prisma 6.x |
| Real-time | Socket.io |

### Architecture Principles

1. **Local-First:** Core operations work offline
2. **Event-Driven:** Real-time updates via WebSocket
3. **Modular:** Skills are independent but interconnected
4. **API-First:** RESTful APIs for all operations
5. **Performance-Obsessed:** Sub-100ms interactions

### Development Approach

Follow the skill-based modular approach:
1. Build infrastructure skills first (09, 34, 42, 44)
2. Add core operations (03, 04, 05, 30)
3. Implement UI layer (01, 02)
4. Layer in features by phase

See [SKILLS-INDEX.md](SKILLS-INDEX.md) for complete build order and dependencies.

---

## Research Sources

- [Toast POS](https://pos.toasttab.com/)
- [Toast POS Reviews & Pricing 2026](https://www.softwareadvice.com/retail/toast-pos-profile/)
- [Square for Restaurants](https://squareup.com/us/en/point-of-sale/restaurants)
- [Square for Restaurants Features](https://squareup.com/us/en/point-of-sale/restaurants/features)
- [SmartTab Support](https://smarttabsupport.com/)
- [SkyTab/Shift4](https://shift4.zendesk.com/hc/en-us)
- Focus POS Manual (local reference)

---

*This document serves as the master requirements reference for GWI POS development.*
*Last Updated: January 30, 2026*
