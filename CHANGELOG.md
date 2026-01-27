# GWI POS Changelog

All notable changes to this project will be documented in this file.

---

## [Unreleased]

### Added

#### Item Notes UI (Skill 10 Complete) - 2026-01-27
- Special instructions text area in modifier modal:
  - 200 character limit with counter
  - Pre-populated when editing existing item
  - Sent to kitchen with order
- Quick notes button on order items:
  - Chat bubble icon next to each item (orange when has note)
  - Opens simple notes editor modal
  - Works for all items, including those without modifiers
- Notes display in order panel:
  - Shows "Note: {text}" below item in orange
  - Kitchen receives notes with order

### Fixed

#### Layout Scrolling Issue - 2026-01-27
- `src/app/(pos)/orders/page.tsx` - Fixed whole-screen scrolling when adding items:
  - Changed main container from `min-h-screen` to `h-screen overflow-hidden`
  - Added `h-full overflow-hidden` to left and right panels
  - Order items section scrolls independently within fixed viewport
  - Payment and "Send to Kitchen" buttons stay locked at bottom

#### Roles API Permissions Error - 2026-01-27
- `src/app/api/roles/route.ts` - Fixed `permissions.includes is not a function` error:
  - Added `getPermissionsArray()` helper to safely handle JSON permissions field
  - Handles arrays (return directly), JSON strings (parse), and null/undefined (empty array)
- `src/app/api/roles/[id]/route.ts` - Same fix applied:
  - Added `getPermissionsArray()` helper
  - All endpoints now safely coerce permissions to array

### Added

#### Employee Management (Skill 01) - 2026-01-27
- `src/app/api/employees/route.ts` - Employee list and create API:
  - GET - List employees by location with optional inactive filter
  - POST - Create new employee with hashed PIN
- `src/app/api/employees/[id]/route.ts` - Individual employee management:
  - GET - Employee details with sales stats (order count, total sales, commission)
  - PUT - Update employee info, change PIN, reassign role
  - DELETE - Soft delete (deactivate) with open order check
- `src/app/api/roles/route.ts` - Role list and create API:
  - GET - List roles with employee counts and available permissions
  - POST - Create new role with permissions array
- `src/app/api/roles/[id]/route.ts` - Individual role management:
  - GET - Role details with assigned employees
  - PUT - Update role name and permissions
  - DELETE - Delete role (blocked if employees assigned)
- `src/app/(admin)/employees/page.tsx` - Employee management UI:
  - Employee cards with avatar, role, contact info
  - Add/edit employee modal with PIN validation
  - Role assignment dropdown
  - Hourly rate and hire date tracking
  - Display color picker
  - Deactivate/reactivate employees
  - Search and filter (including inactive)
- `src/app/(admin)/roles/page.tsx` - Role management UI:
  - Role list with permission badges
  - Add/edit role modal
  - Permission checkboxes grouped by category
  - Quick presets (Admin, Manager, Server, Bartender)
  - Delete protection for roles with employees

#### Settings Foundation (Skill 09) - 2026-01-27
- `src/lib/settings.ts` - Settings types and defaults for location configuration
- `src/app/api/settings/route.ts` - GET/PUT endpoints for location settings stored in Location.settings JSON
- `src/app/(admin)/settings/page.tsx` - Admin settings page with:
  - Dual pricing toggle (enabled by default)
  - Card surcharge percentage input (super admin only)
  - Tax rate configuration
  - Tip settings (suggested percentages)

#### Dual Pricing System (Skill 31) - 2026-01-27
- `src/lib/pricing.ts` - Pricing calculation utilities:
  - `calculateCardPrice(cashPrice, surchargePercent)` - Calculate card price with surcharge
  - `calculateCommission(salePrice, type, value)` - Calculate commission amount
  - `formatDualPrice(cashPrice, settings)` - Format price display with both prices
- Orders page dual pricing display:
  - Menu items show both cash and card prices
  - Modifier modal shows dual prices
  - Payment method toggle (Cash/Card) in order panel
  - Order totals adjust based on selected payment method
  - Savings message when paying with cash

#### Commission System (Skill 29) - 2026-01-27
- Database schema updates (Prisma):
  - `MenuItem.commissionType` - 'fixed' | 'percent' | null
  - `MenuItem.commissionValue` - Decimal amount
  - `Modifier.commissionType` - 'fixed' | 'percent' | null
  - `Modifier.commissionValue` - Decimal amount
  - `OrderItem.commissionAmount` - Snapshot of commission earned
  - `OrderItemModifier.commissionAmount` - Snapshot of commission earned
  - `Order.commissionTotal` - Total commission for order
  - `Order.primaryPaymentMethod` - 'cash' | 'card'
- Menu admin page:
  - Commission type dropdown (None, Fixed $, Percentage %)
  - Commission value input
  - Commission badge displayed on item cards
- Modifiers admin page:
  - Commission type and value inputs per modifier
  - Commission badge displayed in modifier list
- Order store updates:
  - Track commission amounts on items and modifiers
  - Calculate commission totals
  - `setPaymentMethod()` action
- `src/app/api/reports/commission/route.ts` - Commission report API:
  - Date range filtering
  - Employee filtering
  - Aggregation by employee with order details
- `src/app/(admin)/reports/commission/page.tsx` - Commission report UI:
  - Date range picker
  - Summary cards (total commission, employees, orders)
  - Expandable employee list with order drill-down

#### Permissions (Skill 09) - 2026-01-27
- Added to `src/lib/auth.ts`:
  - `SUPER_ADMIN: 'super_admin'` - System-wide settings access
  - `VIEW_COMMISSION: 'reports.commission'` - Commission reports access
  - `TOGGLE_DUAL_PRICING: 'settings.dual_pricing'` - Toggle dual pricing
  - `isSuperAdmin(permissions)` - Helper function

#### Payment Processing Foundation (Skill 30) - 2026-01-27
- Database schema updates (Prisma):
  - `Order.preAuthId` - Pre-authorization transaction reference
  - `Order.preAuthAmount` - Amount held on pre-auth
  - `Order.preAuthLast4` - Last 4 digits of pre-auth card
  - `Order.preAuthCardBrand` - Card brand (visa, mastercard, etc.)
  - `Order.preAuthExpiresAt` - Pre-auth expiration date
  - `Payment.amountTendered` - Cash amount given
  - `Payment.changeGiven` - Change returned
  - `Payment.roundingAdjustment` - Rounding difference for cash
  - `Payment.refundedAmount` - Amount refunded
  - `Payment.refundedAt` - Refund timestamp
  - `Payment.refundReason` - Reason for refund
- `src/lib/payment.ts` - Payment utility functions:
  - `roundAmount(amount, rounding, direction)` - Apply cash rounding
  - `calculateRoundingAdjustment(original, rounded)` - Get rounding difference
  - `calculateChange(amountDue, tendered)` - Calculate change
  - `getQuickCashAmounts(total)` - Quick cash button amounts
  - `generateFakeAuthCode()` / `generateFakeTransactionId()` - Simulated card payments
  - `calculateTip(subtotal, percent, calculateOn, total)` - Tip calculation
  - `calculateTipPercent(tipAmount, base)` - Reverse tip calculation
  - `calculatePreAuthExpiration(days)` - Pre-auth expiry date
  - `isPreAuthExpired(expiresAt)` - Check if pre-auth expired
  - `formatCardDisplay(brand, last4)` - Format card display
- `src/lib/settings.ts` - Extended with PaymentSettings:
  - `acceptCash`, `acceptCredit`, `acceptDebit`, etc.
  - `cashRounding` - 'none' | 'nickel' | 'dime' | 'quarter' | 'dollar'
  - `roundingDirection` - 'nearest' | 'up' | 'down'
  - `enablePreAuth`, `defaultPreAuthAmount`, `preAuthExpirationDays`
  - `processor` - 'none' | 'stripe' | 'square'
  - `testMode` - Flag for simulated payments
- `src/app/api/orders/[id]/pay/route.ts` - Payment processing endpoint:
  - Accept cash/credit/debit payments
  - Tip handling
  - Cash rounding support
  - Simulated card processing (test mode)
  - Split payment support
  - Auto-close order when fully paid
- `src/app/api/orders/[id]/payments/route.ts` - List payments for order

#### Bar Tabs System (Skill 20) - 2026-01-27
- `src/app/api/tabs/route.ts` - Tab list and creation:
  - GET - List open tabs with pre-auth info
  - POST - Create new tab with optional pre-auth
- `src/app/api/tabs/[id]/route.ts` - Tab management:
  - GET - Get tab details with items and payments
  - PUT - Update tab name or pre-auth
  - DELETE - Delete empty tab
- `src/components/tabs/TabsPanel.tsx` - Open tabs list:
  - Filter by all/mine
  - Pre-auth card indicator
  - Item count and total display
- `src/components/tabs/NewTabModal.tsx` - Create new tab:
  - Optional tab name
  - Optional pre-auth with card type and last 4 digits
  - Pre-auth amount selection
- `src/components/tabs/TabDetailModal.tsx` - View/edit tab:
  - Edit tab name inline
  - View items and modifiers
  - View pre-auth status
  - Release pre-auth option
  - Add items / Pay / Transfer actions
- `src/components/payment/PaymentModal.tsx` - Full payment flow:
  - Payment method selection (cash/credit/debit)
  - Dual pricing display with savings
  - Tip selection with suggested percentages
  - Custom tip amount
  - Cash payment with quick amounts
  - Change calculation
  - Simulated card payment (enter last 4 digits)

#### UI Components - 2026-01-27
- `src/components/ui/modal.tsx` - Reusable modal component
- `src/components/ui/input.tsx` - Reusable input component
- `src/components/ui/label.tsx` - Reusable label component

### Changed
- `src/app/(pos)/orders/page.tsx`:
  - Added dual pricing settings fetch on load
  - Menu item buttons now show both prices (28px height increase)
  - Modifier modal shows dual prices with cash/card labels
  - Payment method toggle in order panel
  - Order totals recalculate based on payment method
  - Settings and Commission Report links in menu dropdown
  - **Payment Integration (Skill 30)**:
    - Tabs button in header to toggle tabs panel
    - Pay button opens PaymentModal
    - Tab management integration (create, view, pay tabs)
    - Payment settings loaded on mount
- `src/app/(admin)/menu/page.tsx`:
  - MenuItem interface extended with commission fields
  - ItemModal includes commission type/value inputs
- `src/app/(admin)/modifiers/page.tsx`:
  - Modifier interface extended with commission fields
  - ModifierGroupModal includes commission inputs per modifier
  - Modifier list displays commission badge
- `src/stores/order-store.ts`:
  - OrderItemModifier interface extended with commissionAmount
  - OrderItem interface extended with commissionAmount
  - Order interface extended with primaryPaymentMethod, commissionTotal
  - calculateTotals() now includes commission calculation
- Menu/Modifier APIs updated to accept/return commission fields:
  - `/api/menu/items/route.ts`
  - `/api/menu/items/[id]/route.ts`
  - `/api/menu/route.ts`
  - `/api/menu/modifiers/route.ts`
  - `/api/menu/modifiers/[id]/route.ts`

#### Order Creation API (Skill 02 Complete) - 2026-01-27
- `src/app/api/orders/route.ts` - Order creation and listing:
  - POST - Create new order with items and modifiers, auto-calculate totals
  - GET - List orders by location with filtering options
- `src/app/(pos)/orders/page.tsx` - Order flow integration:
  - `saveOrderToDatabase()` - Save order before kitchen send or payment
  - `handleSendToKitchen()` - Save and send order to kitchen
  - `handleOpenPayment()` - Save order and open payment modal
  - State management for saved order tracking

#### Open Orders System (Skills 02, 05, 07 Foundation) - 2026-01-27
- `src/app/api/orders/open/route.ts` - Open orders API:
  - GET - List all open orders (any type) with full details
  - Filter by location, employee, order type
  - Returns items, modifiers, pre-auth info, payment status
- `src/app/api/orders/[id]/route.ts` - Order management:
  - GET - Get single order details
  - PUT - Update order (add items, modify quantities, update metadata)
  - Handles item replacement with recalculated totals
- `src/components/orders/OpenOrdersPanel.tsx` - Open orders UI:
  - Show all open orders (dine_in, takeout, delivery, bar_tab)
  - Filter by type with pill buttons and icons
  - Filter by all/mine
  - Click to load order and continue working
  - Badge count on header button
- `src/stores/order-store.ts` - Order store enhancements:
  - `loadOrder()` - Load existing order from database
  - `sentToKitchen` flag on OrderItem - Track which items have been sent
  - `orderNumber` on Order - Display order identifier
- `src/app/(pos)/orders/page.tsx` - Order panel improvements:
  - **Order identifier header** - Shows tab name or order number for existing orders
  - **"Open" badge** - Blue badge when working on existing order
  - **Sent item indicators**:
    - Green left border and checkmark for sent items
    - "Sent" label next to item name
    - Grayed out (can't edit/remove sent items)
    - Printer icon to resend to kitchen (placeholder)
  - **New item indicators**:
    - Normal styling with +/- quantity controls
    - Editable modifiers
  - **Smart send button**:
    - New order: "Send to Kitchen"
    - Existing order with new items: "Send X New Items to Kitchen"
    - Existing order, no changes: "No New Items" (disabled)
  - **Open Orders button** with red badge count in header

### Fixed
- **Critical:** Orders now save to database before payment (fixes "order not found" error)
- **Critical:** "Send to Kitchen" button now saves order to database and shows confirmation
- **Critical:** Adding items to existing tab now loads the tab first (fixes duplicate tab creation)
- **Critical:** Can now add items to existing orders and send updates to kitchen
- Commission report API: Fixed relation name from `orderItems` to `items`
- Commission report API: Fixed orderNumber type (Int to String conversion)

---

## Skills Implementation Status

| Skill | Name | Status | Notes |
|-------|------|--------|-------|
| 01 | Employee Management | Done | CRUD, roles, permissions, PIN login |
| 02 | Quick Order Entry | Done | Order creation, save to DB, send to kitchen |
| 03 | Menu Display | Done | Categories, items, dual pricing display |
| 04 | Modifiers | Done | Nested modifiers, pre-modifiers |
| 05 | Order Review | Partial | Order panel shows items/totals, no separate review screen |
| 06 | Tipping | Done | Tip settings and payment flow |
| 07 | Send to Kitchen | Partial | UI complete, orders save, no KDS integration yet |
| 09 | Features & Config | Done | Settings foundation |
| 10 | Item Notes | Done | Schema + UI: modifier modal, quick edit, display |
| 20 | Bar Tabs | Done | Create/view/edit/pay tabs |
| 21 | Pre-auth | Done | Card hold on tab open |
| 29 | Commissioned Items | Done | Item/modifier commissions |
| 30 | Payment Processing | Done | Cash/card, tips, rounding |
| 31 | Dual Pricing | Done | Cash discount program |
| 36 | Tax Calculations | Partial | Settings UI only, tax rules not implemented |
| 46 | Commission Reports | Done | By employee, date range, drill-down |

---

## Structure Built (Not Yet Tied to Skills)

These components have been built but aren't fully connected to their skills:

| Component | Built For | Missing |
|-----------|-----------|---------|
| Open Orders Panel | Skill 05/07 | Separate review screen, KDS notification |
| Order Update API | Skill 02 | Could support more update operations |
| Sent Item Tracking | Skill 07 | KDS integration, resend functionality |
| Printer Icon (Resend) | Skill 07/08 | Actual print/KDS send |

---

## New Skills Identified

Based on building, these skills should be added to the index:

| Proposed Skill | Description | Dependencies |
|----------------|-------------|--------------|
| Open Orders View | View/filter/search all open orders | 02 |
| Order Updates | Add items to existing orders | 02, 07 |
| Resend to Kitchen | Resend specific items to KDS | 07, 23 |
| Order History | View past orders, search, reorder | 02, 30 |

---

## Deployment History

| Date | Version | URL | Notes |
|------|---------|-----|-------|
| 2026-01-27 | - | https://gwi-pos.vercel.app | Fixed layout scrolling, roles permissions array fix |
| 2026-01-27 | - | https://gwi-pos.vercel.app | Open orders panel, sent item tracking, order updates |
| 2026-01-27 | - | https://gwi-pos.vercel.app | Fix order creation, send to kitchen, payments |
| 2026-01-27 | - | https://gwi-pos.vercel.app | Initial dual pricing, commission, settings |
