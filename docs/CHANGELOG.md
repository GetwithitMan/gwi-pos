# GWI POS Changelog

All notable changes to the GWI POS system.

## [2026-01-28] - Entertainment Management System

### Added

#### Entertainment Status Tracking (Skills 94-97)
- Auto-mark entertainment items as "IN USE" when added to order
- Real-time status displayed on menu items (IN USE badge in red)
- Status resets to "available" when order is paid or session stopped
- Menu auto-refreshes after starting/stopping sessions

#### Entertainment Waitlist System
- Click in-use entertainment item to open waitlist modal
- View current waitlist with position numbers and wait times
- Add customers with:
  - Name, phone, party size, notes
  - Link to existing tab
  - Start new tab with card (last 4 digits + pre-auth amount)
  - Take deposit to hold position (cash or card)
- Waitlist API: `/api/entertainment/waitlist`

#### Database Schema Updates
- `EntertainmentWaitlist` model with:
  - `tabId`, `tabName` - link to existing tab
  - `depositAmount`, `depositMethod`, `depositCardLast4` - deposit tracking
  - `depositRefunded` - refund status
- `MenuItem` enhancements:
  - `entertainmentStatus` - 'available', 'in_use', 'maintenance'
  - `currentOrderId`, `currentOrderItemId` - track current usage

#### Timed Sessions Integration
- `/api/timed-sessions` now updates entertainment status on start
- `/api/timed-sessions/[id]` resets status on stop
- Entertainment KDS at `/entertainment` shows real-time availability

#### Entertainment KDS Page
- Dedicated KDS view at `/entertainment` for managing entertainment items
- Grid display of all entertainment items with status indicators
- Real-time waitlist panel at bottom
- Add to waitlist functionality
- Auto-refresh every 5 seconds
- Login redirect fix: returns to `/entertainment` after authentication

### Modified
- Menu API returns `entertainmentStatus` for timed_rental items
- Orders page shows IN USE badge and opens waitlist for in-use items
- Entertainment KDS modal updated with full waitlist features

---

## [2026-01-27] - Major Feature Release

### Added

#### Comps & Voids (Skill 34)
- Comp items (give for free) from POS
- Void items (remove from order) from POS
- Common reason presets for quick selection
- Custom reason entry
- Restore comped/voided items
- Void/Comp reports at `/reports/voids`:
  - Filter by date range, employee
  - Summary cards (totals, amounts)
  - View by logs, employee, or reason
- API: `/api/orders/[id]/comp-void`, `/api/reports/voids`

#### Discounts (Skill 28)
- Discounts admin page at `/discounts`
- Create preset discount rules:
  - Percentage or fixed amount
  - Maximum discount cap for percentages
  - Stackable/non-stackable rules
  - Manager approval requirement
  - Max uses per order
- Apply discounts from POS:
  - Quick preset selection
  - Custom discount entry (% or $)
  - Optional reason tracking
- Manage applied discounts (view/remove)
- API: `/api/discounts`, `/api/orders/[id]/discount`

#### Order Splitting (Skills 14 & 69)
- Split check modal with four methods:
  - **Split Evenly**: Divide check equally among N guests (2-10)
  - **Split by Item**: Select items to move to a new check
  - **Split Single Item**: Divide one item's cost among N guests
  - **Custom Amount**: Pay a specific dollar amount
- Split button added to orders page
- Sequential payment flow for splits
- API: `/api/orders/[id]/split`

#### Item Transfer (Skill 68)
- Move items between open orders
- Two-step flow: select items, then select destination order
- Automatic totals recalculation for both orders
- Audit log tracking
- API: `/api/orders/[id]/transfer-items`

#### Tab Transfer (Skill 22)
- Transfer bar tabs between employees
- Optional reason tracking
- Audit log for accountability
- API: `/api/tabs/[id]/transfer`

#### Customer Profiles (Skill 51 - Partial)
- Customer model with:
  - Basic info (name, email, phone)
  - Loyalty tracking (points, total spent, orders)
  - Marketing preferences (opt-in, birthday)
  - Tags for segmentation
- Customer CRUD API: `/api/customers`, `/api/customers/[id]`
- Customer details include:
  - Recent order history (last 20)
  - Favorite items (most ordered)
- Link customers to orders via `customerId`

#### Table Management (Skills 16 & 17)
- Tables admin page at `/tables`
- Create/edit tables with:
  - Name, capacity, section assignment
  - Shape (rectangle, circle, square)
  - Status (available, occupied, reserved, dirty)
- Sections management with color coding
- Grid view with status indicators
- Quick status toggle (mark clean/dirty)
- Tables link in orders menu
- API: `/api/tables`, `/api/sections`

#### KDS ↔ POS Sync (Skill 64)
- MADE badge on POS when kitchen completes item
- Shows completion timestamp
- Real-time sync via polling

#### Resend to Kitchen (Skill 63)
- Resend button on sent items in order panel
- Optional note prompt for kitchen instructions
- RESEND badge with count on KDS display
- Resend note shown in red on KDS
- API: `/api/kds` PUT action='resend'

#### Open Orders View (Skill 61)
- Open Orders panel slide-out
- Filter by order type (dine-in, bar tab, takeout)
- Shows elapsed time, server, items
- Click to load order for editing

#### Order Updates (Skill 62)
- Add items to existing open orders
- Track sent vs new items
- "Send N New Items" button
- Items marked as sent after kitchen send

### Kitchen Display System (KDS)
- Full KDS screen at `/kds`
- Station filtering by prep station
- Item bump (mark complete)
- Order bump (complete all items)
- Time status indicators (fresh/aging/late)
- Fullscreen mode
- Auto-refresh every 5 seconds
- Prep stations admin at `/prep-stations`

### Prep Stations
- Station types: kitchen, bar, expo, prep
- Category and item assignment
- Show all items mode (for expo)
- KDS routing based on assignments

### Bar Features
- Bar tabs with pre-auth card holds
- Tab detail modal with items list
- Close tab (release pre-auth)
- Pre-auth expiration tracking
- Tab transfer between employees with audit log

### Payments
- Cash and card payments
- Dual pricing (cash discount program)
- Tip suggestions (15%, 18%, 20%, 25%)
- Custom tip amount
- Quick cash buttons
- Change calculation
- Split payments

### Commission System
- Commission on menu items (fixed $ or %)
- Commission on modifiers
- Commission tracking per order
- Commission reports by employee/date

### Reports
- **Sales Reports** - Enhanced with comprehensive groupings:
  - Summary (today's totals)
  - Daily (by date)
  - Hourly (by hour)
  - By Category
  - By Item
  - By Employee
  - By Table (new)
  - By Seat (new)
  - By Order Type (new)
  - By Modifier (new)
  - By Payment Method (new)
- **Labor Reports** (Skill 43) - `/api/reports/labor`:
  - Hours worked, overtime, break time
  - Labor costs calculation
  - Labor as % of sales
  - Group by employee, day, role
- **Discount Reports** (Skill 70) - `/api/reports/discounts`:
  - Discount usage analytics
  - By rule, employee, day, order type
  - Preset vs custom breakdown
  - Average discount amount
- **Transfer Reports** (Skill 71) - `/api/reports/transfers`:
  - Tab and item transfer tracking
  - From audit log entries
  - Group by employee, day, hour
- **Table Reports** (Skill 72) - `/api/reports/tables`:
  - Sales by table, section, server
  - Turn time calculations
  - Utilization rates
  - Hourly breakdown
- **Customer Reports** (Skill 73) - `/api/reports/customers`:
  - Spend tier distribution
  - Frequency buckets (one-time to VIP)
  - Top customers by spend
  - At-risk customers (30+ days since visit)
  - Tag-based analysis
  - Day-of-week patterns
- Commission reports

### Time Clock
- Clock in/out from POS
- Break tracking
- Hours calculation
- Time clock modal on orders page
- API: `/api/time-clock`

### Settings
- Settings admin page at `/settings`
- Dual pricing toggle and surcharge %
- Tax rate configuration
- Tip settings
- Payment method settings

### Menu Management
- Categories with colors
- Menu items with modifiers
- Nested modifiers (child groups)
- Pre-modifiers (no, lite, extra, side)
- 86 items (mark unavailable)
- Item notes/special instructions

### Employees
- Employee CRUD with roles
- PIN authentication
- Role-based permissions
- Employee admin page

---

## Technical Notes

### Database
- PostgreSQL via Neon serverless
- Prisma ORM
- Key models: Order, OrderItem, Payment, Employee, MenuItem, PrepStation, Table, Customer

### Stack
- Next.js 16 (App Router)
- React 19
- Tailwind CSS
- Zustand for state management
- Vercel deployment

### Deployment
- Production: https://www.barpos.restaurant
- KDS links:
  - All stations: `/kds`
  - Kitchen: `/kds?stationId={id}`
  - Bar: `/kds?stationId={id}`
  - Expo: `/kds?stationId={id}`
