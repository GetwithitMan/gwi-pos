# GWI POS Changelog

All notable changes to the GWI POS system.

## [2026-01-29] - End-of-Day Reports & Tip Share System (Skills 104-105)

### Added

#### Daily Store Report (Skill 104) - `/api/reports/daily`
Comprehensive end-of-day report for store managers.

**Revenue Section:**
- Adjusted gross sales, discounts, net sales
- Tax, surcharges, tips, gratuity
- Refunds, gift card loads, total collected
- Commission tracking

**Payments Section:**
- Cash (count, amount, tips)
- Credit (count, amount, tips, card type breakdown: Visa, MC, Amex, Discover)
- Gift cards, house accounts, other methods

**Cash Reconciliation:**
- Cash received from sales
- Paid in/out tracking
- Tips out (credit card tips paid in cash)
- **Tip shares in** - ALL tip-outs from servers (increases cash due)
- Cash due to house

**Sales Analytics:**
- By Category: units, gross, discounts, net, voids, % of total
- By Order Type: count, gross, net

**Voids & Discounts:**
- Ticket voids vs item voids
- By reason breakdown
- Void percentage of sales
- Discount usage by type

**Labor Summary:**
- FOH/BOH hours and cost split
- Labor percentage of sales

**Gift Cards:**
- Loads, redemptions, net liability

**Tip Shares Section:**
- Total tip shares distributed
- Grouped by employee who GAVE tips
- Shows recipient, amount, rule used, percentage, status

**Stats:**
- Check count, avg check, avg check time
- Covers, avg cover
- Food/beverage/retail averages

#### Employee Shift Report - `/api/reports/employee-shift`
Individual employee shift summary.

- Hours worked (regular, overtime, breaks)
- Sales summary (order count, item count, net sales)
- Tips breakdown:
  - **Tips Earned** - From orders (subject to tip-out)
  - **Tips Received** - From tip shares (NOT subject to tip-out)
  - Net tips after tip-outs

#### Tip Share Report (Skill 105) - `/api/reports/tip-shares`
Standalone tip share report runnable anytime.

**Query Parameters:**
- `startDate`, `endDate` - Date range filter
- `employeeId` - Filter by giver or receiver
- `status` - pending, accepted, paid_out, all

**Response:**
- **Summary**: total shares, pending, accepted, paid out, awaiting payout
- **By Recipient**: Grouped for payout with pending/accepted/paid amounts
- **By Giver**: Grouped for tracking who gave tips
- **All Shares**: Full detail list

**Actions:**
- `POST mark_paid` - Mark specific tip share IDs as paid out
- `POST mark_paid_all` - Mark all for an employee as paid out

#### Tip Share Settings
New settings section in location settings (`/api/settings`):

```json
{
  "tipShares": {
    "payoutMethod": "payroll",          // "payroll" or "manual"
    "autoTipOutEnabled": true,
    "requireTipOutAcknowledgment": true,
    "showTipSharesOnReceipt": true
  }
}
```

**Payout Methods:**
- `payroll` - All tip shares added to payroll automatically
- `manual` - Use tip share report to track and pay out manually

### Changed

#### Simplified Tip Share Cash Flow
All tip shares now go to payroll - no same-day cash handoffs between employees.

**Flow:**
1. Server closes shift → tips out to busser, bartender, etc.
2. Server gives ALL tip-out cash to house
3. House holds the cash
4. ALL recipients receive via payroll
5. No timing issues - doesn't matter who clocks out first

**Cash Impact:**
- `tipSharesIn` = total tip-outs collected by house
- `cashDue` includes `tipSharesIn` (house keeps for payroll)

#### TimeClockModal Updates
- Changed from "Collect" action to informational notification
- Shows "You have tip shares for payroll!" message
- Dismiss button only (no accept action needed)
- "Will be added to your next payroll" note

### Fixed
- Fixed `payment.method` → `payment.paymentMethod`
- Fixed `payment.tip` → `payment.tipAmount`
- Fixed `payment.cardType` → `payment.cardBrand`
- Fixed `log.orderItemId` → `log.itemId`
- Fixed `entry.totalBreakMinutes` → `entry.breakMinutes`
- Fixed `shift.clockIn/clockOut` → `shift.startedAt/endedAt`
- Fixed timezone handling with UTC date parsing in report APIs
- Added Suspense boundary for useSearchParams in shift report page

---

## [2026-01-29] - System Testing & Print Routing Foundation

### Fixed

#### Critical System Fixes
Comprehensive system testing revealed and fixed several issues blocking development.

**Missing Component Fix:**
- Created `src/components/hardware/PrintRouteEditor.tsx` - Modal editor for print routes
- This component was imported but didn't exist, causing 500 errors on ALL API requests

**Field Name Corrections (printerId → printerIds):**
Schema uses `printerIds` (JSON array) for multi-printer routing support. Fixed mismatches in:
- `src/app/api/menu/route.ts` - Categories and items response
- `src/app/api/menu/categories/route.ts` - Category creation
- `src/app/api/menu/modifiers/route.ts` - Modifier response and creation
- `src/app/api/menu/items/route.ts` - Item creation

### Added

#### Print Routing Foundation (Skill 103)
Scaffolding for advanced print routing with named routes and printer-specific settings.

**Types (`src/types/print-route-settings.ts`):**
- `RouteType` - 'pizza' | 'bar' | 'category' | 'item_type'
- `TextSizing` - Header/item/modifier/footer size options
- `BasePrintSettings` - Quantity display, indentation, separators
- `ImpactPrinterSettings` - Red ribbon support for TM-U220
- `ThermalPrinterSettings` - Logo, inverse headers
- `PizzaPrintSettings` - Section labels, grouping, size display
- `BarPrintSettings` - Garnish, ice, modifier highlighting
- `RouteSpecificSettings` - Combined settings object
- `getDefaultRouteSettings()` - Factory function for defaults

**Component (`src/components/hardware/PrintRouteEditor.tsx`):**
- Modal editor for creating/editing print routes
- Route type selection (Pizza, Bar, Category, Item Type)
- Primary and backup printer selection
- Print copies, priority, failover settings
- Text sizing configuration
- Impact printer red ribbon options

**API Stubs (`src/app/api/hardware/print-routes/`):**
- `GET /api/hardware/print-routes` - Returns empty array (stub)
- `POST /api/hardware/print-routes` - Returns 501 Not Implemented
- `PUT /api/hardware/print-routes/[id]` - Update route (stub)
- `DELETE /api/hardware/print-routes/[id]` - Delete route (stub)
- `POST /api/hardware/print-routes/[id]/test` - Test print (stub)

**Admin UI (`/settings/hardware/routing`):**
- Print Routes list with add/edit/delete/test actions
- Route type badges with color coding
- Printer info display with backup indicators
- Category & Item Routing section
- Expandable categories showing items
- Per-category and per-item printer override dropdowns

**Next Steps (for full implementation):**
1. Add `PrintRoute` model to Prisma schema
2. Implement actual CRUD operations in API
3. Integrate routing resolution into kitchen print flow
4. Add print job logging and retry logic

### Verified

#### Comprehensive System Test - All Passing
| API | Status | Count |
|-----|--------|-------|
| Menu | PASS | 15 categories, 222 items |
| Modifiers | PASS | 18 groups |
| Employees | PASS | 3 |
| Tables | PASS | 8 |
| Order Types | PASS | 3 |
| Orders | PASS | 5 |
| KDS | PASS | 29 tickets |
| Discounts | PASS | 0 |
| Customers | PASS | 0 |
| Printers | PASS | 2 |
| KDS Screens | PASS | 1 |
| Print Routes | PASS | 0 (stub) |
| Prep Stations | PASS | 0 |
| Settings | PASS | 0 |
| Time Clock | PASS | 28 |
| Sales Report | PASS | 2 |

**Build Status:**
- TypeScript: Clean (no errors)
- Production Build: Successful
- All 50+ routes compiling

---

## [2026-01-29] - KDS Device Pairing & Security

### Added

#### KDS Device Pairing System (Skill 102)
Production-ready device authentication for KDS screens deployed to merchants nationwide.

**Security Layers:**
- 256-bit device tokens (cryptographically secure)
- httpOnly cookies (XSS protection, auto-sent with requests)
- Secure + SameSite flags (HTTPS only, CSRF protection)
- 5-minute pairing code expiry
- Optional static IP enforcement (for UniFi networks)
- IP address tracking for audit trails

**Database Schema:**
- `KDSScreen.deviceToken` - Unique token per paired device
- `KDSScreen.pairingCode` / `pairingCodeExpiresAt` - Temporary 6-digit codes
- `KDSScreen.isPaired` - Pairing status flag
- `KDSScreen.staticIp` / `enforceStaticIp` - Network-level security
- `KDSScreen.lastKnownIp` / `deviceInfo` - Troubleshooting data

**Pairing Flow:**
1. Admin generates 6-digit code (Settings → Hardware → KDS Screens)
2. Device enters code at `/kds/pair`
3. Server validates code, generates secure token
4. Token stored in httpOnly cookie (1-year expiry)
5. All KDS requests verified against token + optional IP

**API Endpoints:**
- `POST /api/hardware/kds-screens/[id]/generate-code` - Generate pairing code
- `POST /api/hardware/kds-screens/pair` - Complete pairing, set httpOnly cookie
- `GET /api/hardware/kds-screens/auth` - Verify device (cookie or header token)
- `POST /api/hardware/kds-screens/[id]/heartbeat` - Status update + IP check
- `POST /api/hardware/kds-screens/[id]/unpair` - Remove pairing

**Admin UI (`/settings/hardware/kds-screens`):**
- Generate Pairing Code button with modal display
- Large 6-digit code with setup instructions
- Copy KDS URL button
- Unpair button for paired devices
- Static IP configuration with "Use Current" helper
- "Enforce IP address" checkbox with warning
- "Paired" / "Not Paired" / "Enforced" badges

**KDS Pages:**
- `/kds/pair` - 6-digit code entry with auto-advance and paste support
- `/kds` - Auth check on mount, redirects to pairing if needed
- Employee fallback mode for manager troubleshooting
- Green dot indicator for paired devices

**Static IP Support (UniFi):**
- Configure expected IP address per KDS screen
- "Enforce IP address" option rejects requests from wrong IP
- Works with DHCP reservations or static IPs
- Adds network-level security for private restaurant networks

---

## [2026-01-29] - Online Ordering Modifier Overrides

### Added

#### Online Ordering Modifier Override (Skill 99)
Control which modifier groups appear for online orders vs POS, per menu item.

**Database Schema:**
- `MenuItemModifierGroup.showOnline` - Boolean (default true) controlling online visibility
- `ModifierGroup.hasOnlineOverride` - Boolean flag for modifier-level override management
- `Modifier.showOnPOS` / `Modifier.showOnline` - Per-modifier channel visibility

**API Changes:**
- `GET /api/menu/items/[id]/modifiers?channel=online|pos` - Filters by channel
- `POST /api/menu/items/[id]/modifiers` - Accepts `{ modifierGroups: [{ id, showOnline }] }` format
- `GET /api/menu/modifiers?channel=online|pos` - Filters modifier groups by channel
- `PUT /api/menu/modifiers/[id]` - Saves `hasOnlineOverride` and per-modifier visibility

**Admin UI (Edit Item Modal):**
- "Modifier Groups" section - Select groups for the item (all show on POS)
- "Online Modifier Groups" section - Toggle which groups appear for online orders
- Purple-themed checkboxes with "Hidden online" badges
- Counter showing "X of Y groups visible online"

**Admin UI (Modifiers Page):**
- "Enable Online Ordering Override" checkbox on modifier groups
- Visibility table with POS/Online columns for each modifier
- Quick action buttons: "All POS ✓", "All Online ✓", "Sync Both"
- 🌐 indicator in sidebar for groups with override enabled

**Two-Level Control:**
1. **Item Level:** Choose which modifier groups appear online for each menu item
2. **Modifier Level:** Fine-tune which individual modifiers within a group appear online

#### Modifier Stacking UI Enhancement
- Visual feedback for stacked selections (gradient + yellow glow)
- "2x" badge on stacked modifiers
- "Tap same item twice for 2x" hint text
- Improved stacking logic for max selection handling

#### Modifier Hierarchy Display
- `OrderItemModifier.depth` field tracks nesting level (0=top, 1=child, 2=grandchild)
- KDS and orders page show dashes for nested modifiers (e.g., `- House Salad`, `-- Ranch`)

---

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
