# GWI POS Database Reference

> **Version**: 1.0.0
> **Last Updated**: January 2026
> **Total Tables**: 78

This document provides a comprehensive reference for all database tables in the GWI POS system.

---

## Table of Contents

1. [Overview](#overview)
2. [Common Patterns](#common-patterns)
3. [Alphabetical Index](#alphabetical-index)
4. [Tables by Domain](#tables-by-domain)
   - [Organization & Locations](#organization--locations)
   - [Customers](#customers)
   - [Employees & Roles](#employees--roles)
   - [Time Clock & Breaks](#time-clock--breaks)
   - [Shifts & Drawers](#shifts--drawers)
   - [Menu Programming](#menu-programming)
   - [Combo Meals](#combo-meals)
   - [Floor Plan & Tables](#floor-plan--tables)
   - [Order Types](#order-types)
   - [Orders](#orders)
   - [Payments](#payments)
   - [Discounts & Coupons](#discounts--coupons)
   - [Upsells](#upsells)
   - [Gift Cards](#gift-cards)
   - [House Accounts](#house-accounts)
   - [Reservations](#reservations)
   - [Tips & Tip Sharing](#tips--tip-sharing)
   - [Timed Rentals & Entertainment](#timed-rentals--entertainment)
   - [Events & Ticketing](#events--ticketing)
   - [Tax Rules](#tax-rules)
   - [Inventory](#inventory)
   - [Ingredients](#ingredients)
   - [Liquor Builder](#liquor-builder)
   - [Pizza Builder](#pizza-builder)
   - [Hardware Management](#hardware-management)
   - [Payroll](#payroll)
   - [Scheduling](#scheduling)
   - [Audit & Logs](#audit--logs)
5. [Database Configuration](#database-configuration)
6. [Migration Notes](#migration-notes)

---

## Overview

The GWI POS database is designed for:
- **Multi-tenancy**: All data is scoped by `locationId`
- **Offline-first**: Sync fields (`syncedAt`, `deletedAt`) enable cloud synchronization
- **Soft deletes**: Records are never hard-deleted; use `deletedAt` timestamp
- **Neon PostgreSQL (database-per-venue)**: Each venue gets its own database (`gwi_pos_{slug}`)

### Database Statistics

| Category | Count |
|----------|-------|
| Core/Organization | 2 |
| Customers | 1 |
| Employees & Roles | 2 |
| Time & Breaks | 2 |
| Shifts & Drawers | 3 |
| Menu Programming | 5 |
| Combos | 3 |
| Floor Plan | 3 |
| Order Types | 1 |
| Orders | 3 |
| Payments | 1 |
| Discounts & Coupons | 4 |
| Upsells | 2 |
| Gift Cards | 2 |
| House Accounts | 2 |
| Reservations | 1 |
| Tips | 5 |
| Timed Rentals | 2 |
| Events & Ticketing | 5 |
| Tax | 1 |
| Inventory | 2 |
| Ingredients | 3 |
| Liquor Builder | 5 |
| Pizza Builder | 8 |
| Hardware | 5 |
| Payroll | 3 |
| Scheduling | 3 |
| Audit | 2 |
| **Total** | **78** |

---

## Common Patterns

### Multi-Tenancy (REQUIRED)

Every table except `Organization` and `Location` **MUST** have `locationId`:

```prisma
model AnyModel {
  id         String   @id @default(cuid())
  locationId String                          // REQUIRED
  location   Location @relation(...)         // REQUIRED

  // ... other fields

  @@index([locationId])                      // REQUIRED
}
```

**Why?**
- Simpler queries (no complex joins)
- Security (direct filtering prevents cross-tenant data leaks)
- Performance (indexed for fast queries)
- Consistency (all data access patterns work the same way)

### Sync Fields (REQUIRED)

Every table except `Organization` and `Location` **MUST** have sync fields:

```prisma
model AnyModel {
  // ... other fields

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?  // Soft delete timestamp
  syncedAt  DateTime?  // Cloud sync timestamp
}
```

**Never hard delete**:
```typescript
// BAD - causes sync conflicts
await db.menuItem.delete({ where: { id } })

// GOOD - soft delete
await db.menuItem.update({
  where: { id },
  data: { deletedAt: new Date() }
})
```

**Always filter deleted records**:
```typescript
const items = await db.menuItem.findMany({
  where: { locationId, deletedAt: null }  // Filter soft-deleted
})
```

### Common Field Patterns

| Pattern | Fields | Purpose |
|---------|--------|---------|
| Identity | `name`, `displayName`, `description` | Human-readable identifiers |
| Status | `status`, `isActive` | Record state tracking |
| Ordering | `sortOrder` | Custom display ordering |
| Timestamps | `createdAt`, `updatedAt` | Audit trail |
| Soft Delete | `deletedAt` | Never hard delete |
| Cloud Sync | `syncedAt` | Track sync status |

### JSON Fields

Complex data types are stored as JSON fields in Prisma:

| Field Example | Type | Content |
|---------------|------|---------|
| `permissions` | `Json?` | `["orders.create", "orders.void"]` |
| `modifierTypes` | `Json` | `["food", "liquor"]` |
| `pourSizes` | `Json?` | `{ "shot": 1.0, "double": 2.0 }` |
| `settings` | `Json?` | Configuration objects |

---

## Alphabetical Index

| Table | Domain | Description |
|-------|--------|-------------|
| [AuditLog](#auditlog) | Audit | System action logging |
| [AvailabilityEntry](#availabilityentry) | Scheduling | Employee availability preferences |
| [BottleProduct](#bottleproduct) | Liquor | Bottle inventory for spirits |
| [Break](#break) | Time Clock | Employee break tracking |
| [Category](#category) | Menu | Menu item categories |
| [ComboComponent](#combocomponent) | Combos | Combo meal slots |
| [ComboComponentOption](#combocomponentoption) | Combos | Options for combo slots |
| [ComboTemplate](#combotemplate) | Combos | Combo meal definitions |
| [Coupon](#coupon) | Discounts | Coupon/promo codes |
| [CouponRedemption](#couponredemption) | Discounts | Coupon usage tracking |
| [Customer](#customer) | Customers | Customer profiles |
| [DiscountRule](#discountrule) | Discounts | Automatic discount rules |
| [Drawer](#drawer) | Shifts | Cash drawer configuration |
| [Employee](#employee) | Employees | Staff records |
| [EntertainmentWaitlist](#entertainmentwaitlist) | Entertainment | Waitlist for timed rentals |
| [Event](#event) | Ticketing | Events/shows |
| [EventPricingTier](#eventpricingtier) | Ticketing | Ticket pricing tiers |
| [EventTableConfig](#eventtableconfig) | Ticketing | Per-event table configuration |
| [GiftCard](#giftcard) | Gift Cards | Gift card accounts |
| [GiftCardTransaction](#giftcardtransaction) | Gift Cards | Gift card activity |
| [HouseAccount](#houseaccount) | House Accounts | House/tab accounts |
| [HouseAccountTransaction](#houseaccounttransaction) | House Accounts | House account activity |
| [Ingredient](#ingredient) | Ingredients | Global ingredient library |
| [InventoryTransaction](#inventorytransaction) | Inventory | Stock movements |
| [KDSScreen](#kdsscreen) | Hardware | Kitchen display screens |
| [KDSScreenStation](#kdsscreenstation) | Hardware | KDS-to-station mapping |
| [Location](#location) | Organization | Physical locations |
| [MenuItem](#menuitem) | Menu | Menu items |
| [MenuItemIngredient](#menuitemingredient) | Ingredients | Item-to-ingredient links |
| [MenuItemModifierGroup](#menuitemmodifiergroup) | Menu | Item-to-modifier links |
| [Modifier](#modifier) | Menu | Individual modifiers |
| [ModifierGroup](#modifiergroup) | Menu | Modifier group containers |
| [Order](#order) | Orders | Customer orders |
| [OrderDiscount](#orderdiscount) | Discounts | Applied discounts |
| [OrderItem](#orderitem) | Orders | Line items on orders |
| [OrderItemIngredient](#orderitemingredient) | Ingredients | Ingredient modifications |
| [OrderItemModifier](#orderitemmodifier) | Orders | Applied modifiers |
| [OrderItemPizza](#orderitempizza) | Pizza | Pizza order details |
| [OrderType](#ordertype) | Order Types | Configurable order types |
| [Organization](#organization) | Organization | Top-level organization |
| [PaidInOut](#paidinout) | Shifts | Cash in/out transactions |
| [Payment](#payment) | Payments | Payment transactions |
| [PayrollPeriod](#payrollperiod) | Payroll | Pay period definitions |
| [PayrollSettings](#payrollsettings) | Payroll | Payroll configuration |
| [PayStub](#paystub) | Payroll | Employee pay stubs |
| [PizzaCheese](#pizzacheese) | Pizza | Cheese options |
| [PizzaConfig](#pizzaconfig) | Pizza | Pizza builder settings |
| [PizzaCrust](#pizzacrust) | Pizza | Crust options |
| [PizzaSauce](#pizzasauce) | Pizza | Sauce options |
| [PizzaSize](#pizzasize) | Pizza | Size options |
| [PizzaSpecialty](#pizzaspecialty) | Pizza | Specialty pizza templates |
| [PizzaTopping](#pizzatopping) | Pizza | Topping options |
| [PrepStation](#prepstation) | Menu | Kitchen/prep stations |
| [Printer](#printer) | Hardware | Print devices |
| [PrintJob](#printjob) | Hardware | Print job queue |
| [PrintRule](#printrule) | Hardware | Print routing rules |
| [RecipeIngredient](#recipeingredient) | Liquor | Cocktail recipe ingredients |
| [Reservation](#reservation) | Reservations | Table reservations |
| [Role](#role) | Employees | Employee roles |
| [Schedule](#schedule) | Scheduling | Weekly schedules |
| [ScheduledShift](#scheduledshift) | Scheduling | Individual shift assignments |
| [Seat](#seat) | Ticketing | Individual seats |
| [Section](#section) | Floor Plan | Floor plan sections |
| [SectionAssignment](#sectionassignment) | Floor Plan | Server-to-section assignments |
| [Shift](#shift) | Shifts | Employee shift records |
| [SpiritCategory](#spiritcategory) | Liquor | Spirit categories |
| [SpiritModifierGroup](#spiritmodifiergroup) | Liquor | Spirit-to-modifier links |
| [SpiritUpsellEvent](#spiritupsellevent) | Liquor | Spirit upsell tracking |
| [StockAlert](#stockalert) | Inventory | Low stock alerts |
| [Table](#table) | Floor Plan | Tables/furniture |
| [TaxRule](#taxrule) | Tax | Tax rate rules |
| [Ticket](#ticket) | Ticketing | Event tickets |
| [TimeClockEntry](#timeclockentry) | Time Clock | Clock in/out records |
| [TimedSession](#timedsession) | Entertainment | Active rental sessions |
| [TipBank](#tipbank) | Tips | Uncollected tips |
| [TipOutRule](#tipoutrule) | Tips | Automatic tip-out rules |
| [TipPool](#tippool) | Tips | Tip pool definitions |
| [TipPoolEntry](#tippoolentry) | Tips | Tip pool distributions |
| [TipShare](#tipshare) | Tips | Actual tip distributions |
| [UpsellConfig](#upsellconfig) | Upsells | Upsell prompt configuration |
| [UpsellEvent](#upsellevent) | Upsells | Upsell tracking |
| [VoidLog](#voidlog) | Audit | Void transaction logs |

---

## Tables by Domain

### Organization & Locations

#### Organization

Top-level organization entity. One organization can have multiple locations.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key (cuid) |
| `name` | String | Organization name |
| `createdAt` | DateTime | Creation timestamp |
| `updatedAt` | DateTime | Last update |

**Relations**: `locations` → Location[]

**Note**: No `locationId`, `deletedAt`, or `syncedAt` - this is a root table.

---

#### Location

Physical location/venue. All data is scoped to a location.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key (cuid) |
| `organizationId` | String | FK to Organization |
| `name` | String | Location name |
| `address` | String? | Street address |
| `phone` | String? | Phone number |
| `timezone` | String | Default: "America/New_York" |
| `isActive` | Boolean | Active status |
| `settings` | Json? | Location-wide settings |

**Relations**: All other tables link here via `locationId`.

**Note**: No `deletedAt` or `syncedAt` - this is a root table.

---

### Customers

#### Customer

Customer profiles for loyalty tracking, reservations, and order history.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `firstName` | String | First name |
| `lastName` | String | Last name |
| `displayName` | String? | Nickname |
| `email` | String? | Email address |
| `phone` | String? | Phone number |
| `notes` | String? | Allergies, preferences |
| `tags` | Json? | Customer tags (VIP, etc.) |
| `loyaltyPoints` | Int | Loyalty point balance |
| `totalSpent` | Decimal | Lifetime spend |
| `totalOrders` | Int | Order count |
| `averageTicket` | Decimal | Average order value |
| `lastVisit` | DateTime? | Last order date |
| `marketingOptIn` | Boolean | Marketing consent |
| `birthday` | DateTime? | Birthday |

**Relations**: `orders`, `houseAccounts`, `reservations`, `tickets`

**Unique Constraints**: `[locationId, email]`, `[locationId, phone]`

---

### Employees & Roles

#### Role

Employee roles with permissions and tip configuration.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Role name (Server, Bartender, Manager) |
| `permissions` | Json? | Array of permission strings |
| `isTipped` | Boolean | Is this a tipped position? |

**Relations**: `employees`, `tipOutRulesFrom`, `tipOutRulesTo`, `scheduledShifts`

**Unique Constraint**: `[locationId, name]`

---

#### Employee

Staff records with authentication, employment, tax, and payroll data.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `roleId` | String | FK to Role |
| `firstName` | String | First name |
| `lastName` | String | Last name |
| `displayName` | String? | Display name |
| `email` | String? | Email |
| `phone` | String? | Phone |
| `pin` | String | PIN for login (hashed) |
| `password` | String? | Admin password (hashed) |
| `hourlyRate` | Decimal? | Hourly wage |
| `hireDate` | DateTime | Hire date |
| `isActive` | Boolean | Employment status |
| `color` | String? | Floor plan color |
| `posLayoutSettings` | Json? | Personal POS preferences |

**Tax Fields**: `federalFilingStatus`, `federalAllowances`, `stateFilingStatus`, `stateAllowances`, etc.

**YTD Tracking**: `ytdGrossEarnings`, `ytdTips`, `ytdFederalTax`, `ytdStateTax`, etc.

**Bank Info**: `bankName`, `bankRoutingNumber`, `bankAccountNumber`, `bankAccountType`

**Relations**: `orders`, `timeClockEntries`, `shifts`, `voidLogs`, `auditLogs`, `sections`, `tipSharesGiven`, `tipSharesReceived`, `tipBank`, `payStubs`, `scheduledShifts`, `availabilityEntries`

**Unique Constraint**: `[locationId, pin]`

---

### Time Clock & Breaks

#### TimeClockEntry

Employee clock in/out records.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `employeeId` | String | FK to Employee |
| `clockIn` | DateTime | Clock in time |
| `clockOut` | DateTime? | Clock out time |
| `breakStart` | DateTime? | Break start |
| `breakEnd` | DateTime? | Break end |
| `breakMinutes` | Int | Total break time |
| `regularHours` | Decimal? | Regular hours worked |
| `overtimeHours` | Decimal? | Overtime hours |
| `drawerCountIn` | Json? | Opening drawer count |
| `drawerCountOut` | Json? | Closing drawer count |
| `notes` | String? | Notes |

---

#### Break

Individual break records (can have multiple per time entry).

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `timeClockEntryId` | String | FK to TimeClockEntry |
| `employeeId` | String | FK to Employee |
| `breakType` | String | "paid", "unpaid", "meal" |
| `startedAt` | DateTime | Break start |
| `endedAt` | DateTime? | Break end |
| `duration` | Int? | Duration in minutes |
| `status` | String | "active", "completed" |

---

### Shifts & Drawers

#### Shift

Employee shift with sales totals and tip tracking.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `employeeId` | String | FK to Employee |
| `startedAt` | DateTime | Shift start |
| `endedAt` | DateTime? | Shift end |
| `startingCash` | Decimal | Opening cash |
| `expectedCash` | Decimal? | Expected closing cash |
| `actualCash` | Decimal? | Actual closing cash |
| `variance` | Decimal? | Cash variance |
| `totalSales` | Decimal? | Total sales |
| `cashSales` | Decimal? | Cash sales |
| `cardSales` | Decimal? | Card sales |
| `tipsDeclared` | Decimal? | Declared tips |
| `grossTips` | Decimal? | Tips before distribution |
| `tipOutTotal` | Decimal? | Tips given to others |
| `netTips` | Decimal? | Tips kept |
| `status` | String | "open", "closed" |

**Relations**: `tipShares`

---

#### Drawer

Cash drawer configuration.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Drawer name |
| `deviceId` | String? | Associated terminal |
| `isActive` | Boolean | Active status |

**Relations**: `paidInOuts`

---

#### PaidInOut

Cash in/out transactions (tips, petty cash, etc.).

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `drawerId` | String | FK to Drawer |
| `type` | String | "in" or "out" |
| `amount` | Decimal | Amount |
| `reason` | String | Reason |
| `reference` | String? | Check number, vendor |
| `employeeId` | String | Who created |
| `approvedBy` | String? | Manager approval |

---

### Menu Programming

#### PrepStation

Kitchen/prep stations for routing orders.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Station name |
| `displayName` | String? | Display name |
| `color` | String? | KDS theme color |
| `stationType` | String | "kitchen", "bar", "expo", "prep" |
| `sortOrder` | Int | Display order |
| `isActive` | Boolean | Active status |
| `showAllItems` | Boolean | Expo sees all items |
| `autoComplete` | Int? | Auto-complete seconds |

**Relations**: `categories`, `menuItems`, `kdsScreens`

---

#### Category

Menu item categories.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Category name |
| `displayName` | String? | Display name |
| `description` | String? | Description |
| `color` | String? | Button color |
| `imageUrl` | String? | Image URL |
| `categoryType` | String | "food", "drinks", "liquor", "entertainment", "combos" |
| `sortOrder` | Int | Display order |
| `isActive` | Boolean | Active status |
| `showOnPOS` | Boolean | Show on POS |
| `showOnline` | Boolean | Show for online orders |
| `prepStationId` | String? | FK to PrepStation |
| `courseNumber` | Int? | Course number |
| `printerIds` | Json? | Array of printer IDs |

**Relations**: `menuItems`, `printRules`

---

#### MenuItem

Individual menu items.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `categoryId` | String | FK to Category |
| `name` | String | Item name |
| `displayName` | String? | Display name |
| `description` | String? | Description |
| `sku` | String? | SKU code |
| `imageUrl` | String? | Image URL |
| `price` | Decimal | Price |
| `cost` | Decimal? | Cost (for profit) |
| `taxRate` | Decimal? | Override tax rate |
| `isTaxExempt` | Boolean | Tax exempt |
| `sortOrder` | Int | Display order |
| `isActive` | Boolean | Active status |
| `showOnPOS` | Boolean | Show on POS |
| `showOnline` | Boolean | Show online |
| `prepStationId` | String? | Override station |
| `prepTime` | Int? | Prep time (minutes) |
| `courseNumber` | Int? | Override course |
| `printerIds` | Json? | Override printer IDs |
| `backupPrinterIds` | Json? | Backup printers |
| `trackInventory` | Boolean | Track inventory |
| `currentStock` | Int? | Current stock |
| `lowStockAlert` | Int? | Low stock threshold |
| `isAvailable` | Boolean | Available (86'd = false) |
| `itemType` | String | "standard", "combo", "timed_rental" |
| `comboPrintMode` | String? | "individual", "primary", "all" |

**Timed Rental Fields**: `timedPricing`, `minimumMinutes`, `graceMinutes`, `entertainmentStatus`, `currentOrderId`, `currentOrderItemId`, `blockTimeMinutes`, `maxConcurrentUses`, `currentUseCount`

**Scheduling Fields**: `availableFrom`, `availableTo`, `availableDays`

**Commission Fields**: `commissionType`, `commissionValue`

**Liquor Pour Fields**: `pourSizes`, `defaultPourSize`, `applyPourToModifiers`

**Relations**: `modifierGroups`, `orderItems`, `upsellTriggers`, `upsellSuggestions`, `comboComponentItems`, `comboComponentDefaults`, `comboOptions`, `entertainmentWaitlist`, `recipeIngredients`, `linkedModifiers`, `ingredients`, `printRules`, `pizzaSpecialty`

---

#### ModifierGroup

Container for related modifiers.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Group name |
| `displayName` | String? | Display name |
| `modifierTypes` | Json | Types: ["universal", "food", "liquor", "retail", "entertainment", "combo"] |
| `minSelections` | Int | Minimum required |
| `maxSelections` | Int | Maximum allowed |
| `isRequired` | Boolean | Required selection |
| `allowStacking` | Boolean | Allow same modifier multiple times |
| `hasOnlineOverride` | Boolean | Separate online modifier management |
| `sortOrder` | Int | Display order |
| `isSpiritGroup` | Boolean | Liquor builder integration |

**Relations**: `modifiers`, `menuItems`, `parentModifiers`, `comboComponents`, `spiritConfig`, `swappableIngredients`

---

#### Modifier

Individual modifiers (toppings, upgrades, etc.).

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `modifierGroupId` | String | FK to ModifierGroup |
| `name` | String | Modifier name |
| `displayName` | String? | Display name |
| `price` | Decimal | Price |
| `priceType` | String | "upcharge", "override", "from_item" |
| `upsellPrice` | Decimal? | Special upsell price |
| `cost` | Decimal? | Cost |
| `allowedPreModifiers` | Json? | ["no", "lite", "extra", "side"] |
| `extraPrice` | Decimal? | Price for "extra" |
| `extraUpsellPrice` | Decimal? | Upsell price for "extra" |
| `childModifierGroupId` | String? | Sub-modifier group |
| `commissionType` | String? | Commission type |
| `commissionValue` | Decimal? | Commission value |
| `linkedMenuItemId` | String? | Linked item for reporting |
| `spiritTier` | String? | "well", "call", "premium", "top_shelf" |
| `linkedBottleProductId` | String? | FK to BottleProduct |
| `pourSizeOz` | Decimal? | Override pour size |
| `sortOrder` | Int | Display order |
| `isDefault` | Boolean | Pre-selected |
| `isActive` | Boolean | Active status |
| `showOnPOS` | Boolean | Show on POS |
| `showOnline` | Boolean | Show online |
| `printerRouting` | String | "follow", "also", "only" |
| `printerIds` | Json? | Printer IDs |

**Relations**: `orderItemModifiers`, `printRules`

---

#### MenuItemModifierGroup

Links menu items to modifier groups.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `menuItemId` | String | FK to MenuItem |
| `modifierGroupId` | String | FK to ModifierGroup |
| `sortOrder` | Int | Display order |
| `showOnline` | Boolean | Show for online orders |

**Unique Constraint**: `[menuItemId, modifierGroupId]`

---

### Combo Meals

#### ComboTemplate

Defines combo meal structure.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `menuItemId` | String | FK to MenuItem (unique) |
| `basePrice` | Decimal | Combo price |
| `comparePrice` | Decimal? | A la carte total for savings |

**Relations**: `components`

---

#### ComboComponent

Slots within a combo (entree, side, drink).

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `comboTemplateId` | String | FK to ComboTemplate |
| `slotName` | String | "entree", "side", "drink" |
| `displayName` | String | "Choose Your Side" |
| `sortOrder` | Int | Display order |
| `isRequired` | Boolean | Required selection |
| `minSelections` | Int | Minimum selections |
| `maxSelections` | Int | Maximum selections |
| `menuItemId` | String? | Pre-selected item |
| `itemPriceOverride` | Decimal? | Override item price |
| `modifierPriceOverrides` | Json? | Per-modifier overrides |
| `modifierGroupId` | String? | Legacy field |
| `priceOverride` | Decimal? | Legacy field |
| `defaultItemId` | String? | Legacy default |

**Relations**: `options`

---

#### ComboComponentOption

Options for a combo slot.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `comboComponentId` | String | FK to ComboComponent |
| `menuItemId` | String | FK to MenuItem |
| `upcharge` | Decimal | Additional cost |
| `sortOrder` | Int | Display order |
| `isAvailable` | Boolean | Available |

**Unique Constraint**: `[comboComponentId, menuItemId]`

---

### Floor Plan & Tables

#### Section

Floor plan sections (Bar, Patio, Main Floor).

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Section name |
| `color` | String? | Display color |
| `posX` | Int | X position |
| `posY` | Int | Y position |
| `width` | Int | Width |
| `height` | Int | Height |
| `shape` | String | "rectangle", "polygon" |
| `coordinates` | Json? | Polygon coordinates |
| `sortOrder` | Int | Display order |
| `isVisible` | Boolean | Visibility |

**Relations**: `tables`, `assignments`

---

#### SectionAssignment

Links servers to sections.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `sectionId` | String | FK to Section |
| `employeeId` | String | FK to Employee |
| `assignedAt` | DateTime | Assignment time |
| `unassignedAt` | DateTime? | Unassignment time |

---

#### Table

Physical tables and furniture.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `sectionId` | String? | FK to Section |
| `name` | String | Table name |
| `capacity` | Int | Seating capacity |
| `posX` | Int | X position |
| `posY` | Int | Y position |
| `width` | Int | Width |
| `height` | Int | Height |
| `rotation` | Int | Rotation (0-359) |
| `shape` | String | "rectangle", "circle", "square", "booth", "bar" |
| `isTimedRental` | Boolean | Pool table, etc. |
| `timedItemId` | String? | Linked pricing item |
| `status` | String | "available", "occupied", "reserved", "dirty", "in_use" |
| `isActive` | Boolean | Active status |
| `combinedWithId` | String? | Combined with table |
| `combinedTableIds` | Json? | Tables combined into this |
| `originalName` | String? | Name before combine |
| `originalPosX` | Int? | Original X position |
| `originalPosY` | Int? | Original Y position |
| `isLocked` | Boolean | Cannot be moved |

**Relations**: `orders`, `reservations`, `timedSessions`, `seats`, `tickets`, `eventConfigurations`

---

### Order Types

#### OrderType

Configurable order types (Dine In, Takeout, Delivery, etc.).

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Type name |
| `slug` | String | Code reference |
| `description` | String? | Description |
| `color` | String? | Badge color |
| `icon` | String? | Icon name |
| `sortOrder` | Int | Display order |
| `isActive` | Boolean | Active status |
| `isSystem` | Boolean | Built-in type |
| `requiredFields` | Json? | Required field config |
| `optionalFields` | Json? | Optional field config |
| `fieldDefinitions` | Json? | Field details |
| `workflowRules` | Json? | Workflow rules |
| `kdsConfig` | Json? | KDS display config |
| `printConfig` | Json? | Print formatting |

**Relations**: `orders`

**Unique Constraint**: `[locationId, slug]`

---

### Orders

#### Order

Customer orders.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `employeeId` | String | FK to Employee |
| `customerId` | String? | FK to Customer |
| `orderNumber` | Int | Sequential number |
| `displayNumber` | String? | Display number (A23) |
| `parentOrderId` | String? | Parent if split |
| `splitIndex` | Int? | Split index (1, 2, 3) |
| `orderType` | String | Legacy type |
| `orderTypeId` | String? | FK to OrderType |
| `tableId` | String? | FK to Table |
| `guestCount` | Int | Guest count |
| `tabName` | String? | Bar tab name |
| `customFields` | Json? | Custom field values |
| `status` | String | "open", "sent", "paid", "closed", "voided" |
| `openedAt` | DateTime | Opened time |
| `sentAt` | DateTime? | Sent time |
| `paidAt` | DateTime? | Paid time |
| `closedAt` | DateTime? | Closed time |
| `subtotal` | Decimal | Subtotal |
| `discountTotal` | Decimal | Total discounts |
| `taxTotal` | Decimal | Total tax |
| `tipTotal` | Decimal | Total tips |
| `total` | Decimal | Grand total |
| `primaryPaymentMethod` | String? | Cash/card pricing |
| `commissionTotal` | Decimal | Total commission |
| `notes` | String? | Notes |
| `preAuthId` | String? | Pre-auth reference |
| `preAuthAmount` | Decimal? | Pre-auth amount |
| `preAuthLast4` | String? | Card last 4 |
| `preAuthCardBrand` | String? | Card brand |
| `preAuthExpiresAt` | DateTime? | Pre-auth expiry |

**Relations**: `items`, `payments`, `discounts`, `voidLogs`, `splitOrders`

---

#### OrderItem

Line items on an order.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `orderId` | String | FK to Order |
| `menuItemId` | String | FK to MenuItem |
| `name` | String | Item name snapshot |
| `price` | Decimal | Item price |
| `quantity` | Int | Quantity |
| `seatNumber` | Int? | Seat number |
| `courseNumber` | Int? | Course number |
| `courseStatus` | String | "pending", "fired", "ready", "served" |
| `isHeld` | Boolean | Hold status |
| `holdUntil` | DateTime? | Hold until |
| `firedAt` | DateTime? | Fired time |
| `kitchenStatus` | String | "pending", "cooking", "ready", "delivered" |
| `isCompleted` | Boolean | KDS completed |
| `completedAt` | DateTime? | Completion time |
| `resendCount` | Int | Resend count |
| `lastResentAt` | DateTime? | Last resend |
| `resendNote` | String? | Resend note |
| `blockTimeMinutes` | Int? | Block time duration |
| `blockTimeStartedAt` | DateTime? | Block start |
| `blockTimeExpiresAt` | DateTime? | Block expiry |
| `specialNotes` | String? | Special requests |
| `status` | String | "active", "voided", "comped" |
| `voidReason` | String? | Void reason |
| `modifierTotal` | Decimal | Modifier total |
| `itemTotal` | Decimal | Line total |
| `commissionAmount` | Decimal? | Commission |

**Relations**: `modifiers`, `ingredientModifications`, `pizzaData`

---

#### OrderItemModifier

Applied modifiers on order items.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `orderItemId` | String | FK to OrderItem |
| `modifierId` | String? | FK to Modifier |
| `name` | String | Modifier name snapshot |
| `price` | Decimal | Price charged |
| `preModifier` | String? | "no", "lite", "extra", "side" |
| `depth` | Int | Hierarchy depth (0=top) |
| `quantity` | Int | Quantity |
| `commissionAmount` | Decimal? | Commission |
| `linkedMenuItemId` | String? | Linked item ID |
| `linkedMenuItemName` | String? | Linked item name |
| `linkedMenuItemPrice` | Decimal? | Original item price |
| `spiritTier` | String? | Spirit tier |
| `linkedBottleProductId` | String? | Bottle for inventory |

---

### Payments

#### Payment

Payment transactions.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `orderId` | String | FK to Order |
| `employeeId` | String? | Who processed |
| `amount` | Decimal | Payment amount |
| `tipAmount` | Decimal | Tip amount |
| `totalAmount` | Decimal | Total amount |
| `paymentMethod` | String | "cash", "credit", "debit", "gift_card", "house_account" |
| `amountTendered` | Decimal? | Cash tendered |
| `changeGiven` | Decimal? | Change returned |
| `roundingAdjustment` | Decimal? | Rounding amount |
| `cardBrand` | String? | Visa, Mastercard |
| `cardLast4` | String? | Last 4 digits |
| `authCode` | String? | Auth code |
| `transactionId` | String? | Transaction ID |
| `status` | String | "pending", "completed", "refunded", "voided" |
| `refundedAmount` | Decimal | Refunded amount |
| `refundedAt` | DateTime? | Refund time |
| `refundReason` | String? | Refund reason |
| `processedAt` | DateTime | Processed time |

---

### Discounts & Coupons

#### DiscountRule

Automatic and manual discount rules.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Rule name |
| `displayText` | String | Display text |
| `description` | String? | Description |
| `discountType` | String | "bogo", "quantity", "mix_match", "threshold", "time_based", "manual" |
| `triggerConfig` | Json | Trigger conditions |
| `discountConfig` | Json | Discount configuration |
| `scheduleConfig` | Json? | Time/day restrictions |
| `priority` | Int | Priority order |
| `isStackable` | Boolean | Can stack |
| `requiresApproval` | Boolean | Needs manager |
| `maxPerOrder` | Int? | Max per order |
| `isActive` | Boolean | Active status |
| `isAutomatic` | Boolean | Auto-apply |

**Relations**: `appliedDiscounts`

---

#### OrderDiscount

Applied discounts on orders.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `orderId` | String | FK to Order |
| `discountRuleId` | String? | FK to DiscountRule |
| `name` | String | Discount name |
| `amount` | Decimal | Amount discounted |
| `percent` | Decimal? | Percentage |
| `appliedBy` | String? | Employee who applied |
| `isAutomatic` | Boolean | Auto-applied |
| `reason` | String? | Reason |

---

#### Coupon

Coupon and promo codes.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `code` | String | Coupon code |
| `name` | String | Display name |
| `description` | String? | Description |
| `discountType` | String | "percent", "fixed", "free_item" |
| `discountValue` | Decimal | Discount amount |
| `freeItemId` | String? | Free item ID |
| `minimumOrder` | Decimal? | Minimum order |
| `maximumDiscount` | Decimal? | Discount cap |
| `appliesTo` | String | "order", "category", "item" |
| `categoryIds` | Json? | Category IDs |
| `itemIds` | Json? | Item IDs |
| `usageLimit` | Int? | Total usage limit |
| `usageCount` | Int | Current usage |
| `perCustomerLimit` | Int? | Per customer limit |
| `singleUse` | Boolean | One-time per customer |
| `validFrom` | DateTime? | Valid from |
| `validUntil` | DateTime? | Valid until |
| `isActive` | Boolean | Active status |
| `createdBy` | String? | Creator |

**Relations**: `redemptions`

**Unique Constraint**: `[locationId, code]`

---

#### CouponRedemption

Coupon usage tracking.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `couponId` | String | FK to Coupon |
| `orderId` | String | FK to Order |
| `customerId` | String? | FK to Customer |
| `discountAmount` | Decimal | Amount discounted |
| `redeemedAt` | DateTime | Redemption time |
| `redeemedBy` | String? | Employee |

---

### Upsells

#### UpsellConfig

Upsell prompt configuration.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `triggerType` | String | "item", "category", "order_condition" |
| `triggerItemId` | String? | FK to MenuItem |
| `triggerCategoryId` | String? | FK to Category |
| `triggerCondition` | Json? | Condition config |
| `suggestionType` | String | "item", "category", "combo", "upgrade" |
| `suggestionItemId` | String? | FK to MenuItem |
| `suggestionCategoryId` | String? | FK to Category |
| `promptText` | String | Prompt message |
| `displayMode` | String | "inline", "popup", "toast" |
| `showPrice` | Boolean | Show price |
| `triggerOnAdd` | Boolean | Trigger on add |
| `triggerBeforeSend` | Boolean | Trigger before send |
| `triggerAtPayment` | Boolean | Trigger at payment |
| `isActive` | Boolean | Active status |
| `priority` | Int | Priority |

**Relations**: `events`

---

#### UpsellEvent

Upsell tracking.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `upsellConfigId` | String | FK to UpsellConfig |
| `orderId` | String | FK to Order |
| `employeeId` | String | FK to Employee |
| `wasShown` | Boolean | Was shown |
| `wasAccepted` | Boolean | Was accepted |
| `wasDismissed` | Boolean | Was dismissed |
| `addedAmount` | Decimal? | Amount added |

---

### Gift Cards

#### GiftCard

Gift card accounts.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `cardNumber` | String | Unique card number |
| `pin` | String? | Optional PIN |
| `initialBalance` | Decimal | Initial balance |
| `currentBalance` | Decimal | Current balance |
| `status` | String | "active", "depleted", "expired", "frozen" |
| `purchasedAt` | DateTime | Purchase time |
| `expiresAt` | DateTime? | Expiration |
| `frozenAt` | DateTime? | Frozen time |
| `frozenReason` | String? | Freeze reason |
| `purchasedById` | String? | Employee who sold |
| `recipientName` | String? | Recipient |
| `recipientEmail` | String? | Recipient email |
| `recipientPhone` | String? | Recipient phone |
| `purchaserName` | String? | Purchaser |
| `message` | String? | Gift message |
| `orderId` | String? | Purchase order |

**Relations**: `transactions`

**Unique Constraint**: `cardNumber`

---

#### GiftCardTransaction

Gift card activity.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `giftCardId` | String | FK to GiftCard |
| `type` | String | "purchase", "redemption", "reload", "refund", "adjustment" |
| `amount` | Decimal | Amount |
| `balanceBefore` | Decimal | Balance before |
| `balanceAfter` | Decimal | Balance after |
| `orderId` | String? | Related order |
| `employeeId` | String? | Employee |
| `notes` | String? | Notes |

---

### House Accounts

#### HouseAccount

House/tab accounts for credit customers.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Account name |
| `contactName` | String? | Contact person |
| `email` | String? | Email |
| `phone` | String? | Phone |
| `address` | String? | Address |
| `creditLimit` | Decimal | Credit limit |
| `currentBalance` | Decimal | Current balance |
| `paymentTerms` | Int | Days until due |
| `status` | String | "active", "suspended", "closed" |
| `suspendedAt` | DateTime? | Suspended time |
| `suspendedReason` | String? | Suspend reason |
| `billingCycle` | String | "monthly", "weekly", "on_demand" |
| `lastBilledAt` | DateTime? | Last bill time |
| `nextBillDate` | DateTime? | Next bill date |
| `taxExempt` | Boolean | Tax exempt |
| `taxId` | String? | Tax exempt ID |
| `customerId` | String? | FK to Customer |

**Relations**: `transactions`

**Unique Constraint**: `[locationId, name]`

---

#### HouseAccountTransaction

House account activity.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `houseAccountId` | String | FK to HouseAccount |
| `type` | String | "charge", "payment", "adjustment", "credit" |
| `amount` | Decimal | Amount |
| `balanceBefore` | Decimal | Balance before |
| `balanceAfter` | Decimal | Balance after |
| `orderId` | String? | Related order |
| `employeeId` | String? | Employee |
| `paymentMethod` | String? | Payment method |
| `referenceNumber` | String? | Check number, etc. |
| `notes` | String? | Notes |
| `dueDate` | DateTime? | Due date |

---

### Reservations

#### Reservation

Table reservations.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `guestName` | String | Guest name |
| `guestPhone` | String? | Guest phone |
| `guestEmail` | String? | Guest email |
| `partySize` | Int | Party size |
| `reservationDate` | DateTime | Date |
| `reservationTime` | String | Time (HH:MM) |
| `duration` | Int | Duration (minutes) |
| `tableId` | String? | FK to Table |
| `status` | String | "confirmed", "seated", "completed", "cancelled", "no_show" |
| `specialRequests` | String? | Special requests |
| `internalNotes` | String? | Internal notes |
| `customerId` | String? | FK to Customer |
| `orderId` | String? | Linked order |
| `createdBy` | String? | Creator |
| `seatedAt` | DateTime? | Seated time |
| `completedAt` | DateTime? | Completed time |
| `cancelledAt` | DateTime? | Cancelled time |
| `cancelReason` | String? | Cancel reason |

---

### Tips & Tip Sharing

#### TipPool

Tip pool definitions.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Pool name |
| `description` | String? | Description |
| `distributionType` | String | "equal", "hours", "points" |
| `eligibleRoles` | Json | Array of role IDs |
| `isActive` | Boolean | Active status |

**Relations**: `entries`

---

#### TipPoolEntry

Tip pool distributions.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `tipPoolId` | String | FK to TipPool |
| `shiftDate` | DateTime | Shift date |
| `totalAmount` | Decimal | Total amount |
| `distributions` | Json | Distribution details |

---

#### TipOutRule

Automatic tip-out rules by role.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `fromRoleId` | String | FK to Role (giver) |
| `toRoleId` | String | FK to Role (receiver) |
| `percentage` | Decimal | Tip-out percentage |
| `isActive` | Boolean | Active status |

**Relations**: `tipShares`

**Unique Constraint**: `[locationId, fromRoleId, toRoleId]`

---

#### TipShare

Actual tip distributions.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `shiftId` | String? | FK to Shift |
| `fromEmployeeId` | String | FK to Employee (giver) |
| `toEmployeeId` | String | FK to Employee (receiver) |
| `amount` | Decimal | Amount |
| `shareType` | String | "role_tipout", "custom", "pool" |
| `ruleId` | String? | FK to TipOutRule |
| `status` | String | "pending", "collected", "banked", "paid_out" |
| `collectedAt` | DateTime? | Collected time |
| `notes` | String? | Notes |

**Relations**: `tipBankEntry`

---

#### TipBank

Uncollected/banked tips for payroll.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `employeeId` | String | FK to Employee |
| `amount` | Decimal | Amount |
| `source` | String | "tip_share", "tip_pool" |
| `sourceId` | String? | Source ID (unique) |
| `status` | String | "pending", "collected", "paid_out" |
| `collectedAt` | DateTime? | Collected time |
| `paidOutAt` | DateTime? | Paid out time |
| `payrollId` | String? | Payroll reference |

---

### Timed Rentals & Entertainment

#### TimedSession

Active timed rental sessions (pool tables, etc.).

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `menuItemId` | String | FK to MenuItem |
| `tableId` | String? | FK to Table |
| `orderId` | String? | FK to Order |
| `startedAt` | DateTime | Start time |
| `endedAt` | DateTime? | End time |
| `pausedAt` | DateTime? | Paused time |
| `pausedMinutes` | Int | Total paused time |
| `totalMinutes` | Int? | Total minutes |
| `totalCharge` | Decimal? | Total charge |
| `rateType` | String | "per15Min", "per30Min", "hourly", "custom" |
| `rateAmount` | Decimal | Rate amount |
| `status` | String | "active", "paused", "completed", "cancelled" |
| `startedById` | String? | Who started |
| `endedById` | String? | Who ended |
| `notes` | String? | Notes |

---

#### EntertainmentWaitlist

Waitlist for entertainment items.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `menuItemId` | String | FK to MenuItem |
| `customerName` | String | Customer name |
| `phoneNumber` | String? | Phone |
| `partySize` | Int | Party size |
| `notes` | String? | Notes |
| `tabId` | String? | Linked tab |
| `tabName` | String? | Tab name |
| `depositAmount` | Decimal? | Deposit amount |
| `depositMethod` | String? | Deposit method |
| `depositCardLast4` | String? | Card last 4 |
| `depositRefunded` | Boolean | Refunded |
| `status` | String | "waiting", "notified", "seated", "cancelled" |
| `notifiedAt` | DateTime? | Notified time |
| `seatedAt` | DateTime? | Seated time |
| `seatedOrderId` | String? | Seated order |

---

### Events & Ticketing

#### Seat

Individual seats within tables.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `tableId` | String | FK to Table |
| `label` | String | Seat label |
| `seatNumber` | Int | Sequential number |
| `relativeX` | Int | X offset from table |
| `relativeY` | Int | Y offset from table |
| `angle` | Int | Facing direction |
| `seatType` | String | "standard", "premium", "accessible", "booth_end" |
| `isActive` | Boolean | Active status |

**Relations**: `tickets`

**Unique Constraint**: `[tableId, seatNumber]`

---

#### Event

Events, shows, and private occasions.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Event name |
| `description` | String? | Description |
| `imageUrl` | String? | Image |
| `eventType` | String | "dinner_show", "concert", "private_event", "special_occasion" |
| `eventDate` | DateTime | Event date |
| `doorsOpen` | String | Doors open time |
| `startTime` | String | Start time |
| `endTime` | String? | End time |
| `ticketingMode` | String | "per_seat", "per_table", "general_admission", "hybrid" |
| `allowOnlineSales` | Boolean | Online sales |
| `allowPOSSales` | Boolean | POS sales |
| `maxTicketsPerOrder` | Int? | Max per order |
| `totalCapacity` | Int | Total capacity |
| `reservedCapacity` | Int | Reserved capacity |
| `salesStartAt` | DateTime? | Sales start |
| `salesEndAt` | DateTime? | Sales end |
| `status` | String | "draft", "on_sale", "sold_out", "cancelled", "completed" |
| `isActive` | Boolean | Active status |
| `settings` | Json? | Additional settings |
| `reservationConflictsHandled` | Boolean | Conflicts resolved |
| `reservationConflictNotes` | String? | Conflict notes |
| `createdBy` | String? | Creator |

**Relations**: `pricingTiers`, `tickets`, `tableConfigurations`

---

#### EventPricingTier

Ticket pricing tiers for events.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `eventId` | String | FK to Event |
| `name` | String | Tier name |
| `description` | String? | Description |
| `color` | String? | Floor plan color |
| `price` | Decimal | Ticket price |
| `serviceFee` | Decimal | Service fee |
| `quantityAvailable` | Int? | Available quantity |
| `quantitySold` | Int | Sold count |
| `maxPerOrder` | Int? | Max per order |
| `sectionIds` | Json? | Section IDs |
| `sortOrder` | Int | Display order |
| `isActive` | Boolean | Active status |

**Relations**: `tickets`, `tableConfigurations`

---

#### EventTableConfig

Per-event table configuration.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `eventId` | String | FK to Event |
| `tableId` | String | FK to Table |
| `isIncluded` | Boolean | Include in event |
| `bookingMode` | String | "inherit", "per_seat", "per_table", "disabled" |
| `pricingTierId` | String? | FK to EventPricingTier |
| `minPartySize` | Int? | Min party |
| `maxPartySize` | Int? | Max party |

**Unique Constraint**: `[eventId, tableId]`

---

#### Ticket

Event tickets.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `eventId` | String | FK to Event |
| `pricingTierId` | String | FK to EventPricingTier |
| `tableId` | String? | FK to Table |
| `seatId` | String? | FK to Seat |
| `ticketNumber` | String | Human-readable number |
| `barcode` | String | Scannable code |
| `customerName` | String? | Customer name |
| `customerEmail` | String? | Email |
| `customerPhone` | String? | Phone |
| `customerId` | String? | FK to Customer |
| `basePrice` | Decimal | Base price |
| `serviceFee` | Decimal | Service fee |
| `taxAmount` | Decimal | Tax |
| `totalPrice` | Decimal | Total price |
| `status` | String | "available", "held", "sold", "checked_in", "cancelled", "refunded" |
| `heldAt` | DateTime? | Hold time |
| `heldUntil` | DateTime? | Hold expiry |
| `heldBySessionId` | String? | Hold session |
| `purchasedAt` | DateTime? | Purchase time |
| `purchaseChannel` | String? | "pos", "online", "phone", "comp" |
| `orderId` | String? | FK to Order |
| `paymentId` | String? | Payment reference |
| `checkedInAt` | DateTime? | Check-in time |
| `checkedInBy` | String? | Check-in employee |
| `cancelledAt` | DateTime? | Cancel time |
| `cancelReason` | String? | Cancel reason |
| `refundedAt` | DateTime? | Refund time |
| `refundAmount` | Decimal? | Refund amount |
| `refundedBy` | String? | Refund employee |
| `notes` | String? | Notes |

**Unique Constraints**: `ticketNumber`, `barcode`

---

### Tax Rules

#### TaxRule

Tax rate rules.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Tax name |
| `rate` | Decimal | Tax rate (0.0825 = 8.25%) |
| `appliesTo` | String | "all", "category", "item" |
| `categoryIds` | Json? | Category IDs |
| `itemIds` | Json? | Item IDs |
| `isInclusive` | Boolean | Tax-inclusive pricing |
| `priority` | Int | Stacking order |
| `isCompounded` | Boolean | Compound on previous taxes |
| `isActive` | Boolean | Active status |

---

### Inventory

#### InventoryTransaction

Stock movements.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `menuItemId` | String | FK to MenuItem |
| `type` | String | "sale", "purchase", "adjustment", "waste", "transfer", "count" |
| `quantityBefore` | Int | Before quantity |
| `quantityChange` | Int | Change (negative for sales) |
| `quantityAfter` | Int | After quantity |
| `orderId` | String? | Related order |
| `employeeId` | String? | Employee |
| `vendorName` | String? | Vendor |
| `invoiceNumber` | String? | Invoice |
| `reason` | String? | Reason |
| `unitCost` | Decimal? | Unit cost |
| `totalCost` | Decimal? | Total cost |

---

#### StockAlert

Low stock alerts.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `menuItemId` | String | FK to MenuItem |
| `alertType` | String | "low_stock", "out_of_stock", "reorder" |
| `currentStock` | Int | Current stock |
| `threshold` | Int | Threshold level |
| `status` | String | "active", "acknowledged", "resolved" |
| `acknowledgedAt` | DateTime? | Acknowledged time |
| `acknowledgedBy` | String? | Acknowledged by |
| `resolvedAt` | DateTime? | Resolved time |
| `resolvedBy` | String? | Resolved by |

---

### Ingredients

#### Ingredient

Global ingredient library.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Ingredient name |
| `category` | String? | "produce", "protein", "dairy", etc. |
| `allowNo` | Boolean | Allow "No" modification |
| `allowLite` | Boolean | Allow "Lite" modification |
| `allowOnSide` | Boolean | Allow "On Side" |
| `allowExtra` | Boolean | Allow "Extra" |
| `extraPrice` | Decimal | Extra charge |
| `allowSwap` | Boolean | Allow swaps |
| `swapModifierGroupId` | String? | FK to ModifierGroup |
| `swapUpcharge` | Decimal | Swap upcharge |
| `sortOrder` | Int | Display order |
| `isActive` | Boolean | Active status |

**Relations**: `menuItemIngredients`

**Unique Constraint**: `[locationId, name]`

---

#### MenuItemIngredient

Links ingredients to menu items.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `menuItemId` | String | FK to MenuItem |
| `ingredientId` | String | FK to Ingredient |
| `isIncluded` | Boolean | Included by default |
| `sortOrder` | Int | Display order |
| `extraPriceOverride` | Decimal? | Override extra price |
| `swapUpchargeOverride` | Decimal? | Override swap upcharge |

**Unique Constraint**: `[menuItemId, ingredientId]`

---

#### OrderItemIngredient

Ingredient modifications on orders.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `orderItemId` | String | FK to OrderItem |
| `ingredientId` | String | FK to Ingredient |
| `ingredientName` | String | Name snapshot |
| `modificationType` | String | "standard", "no", "lite", "on_side", "extra", "swap" |
| `priceAdjustment` | Decimal | Price change |
| `swappedToModifierId` | String? | Swap modifier |
| `swappedToModifierName` | String? | Swap modifier name |

---

### Liquor Builder

#### SpiritCategory

Spirit categories (Tequila, Vodka, etc.).

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Category name |
| `displayName` | String? | Display name |
| `description` | String? | Description |
| `sortOrder` | Int | Display order |
| `isActive` | Boolean | Active status |

**Relations**: `bottleProducts`, `spiritModifierGroups`

**Unique Constraint**: `[locationId, name]`

---

#### BottleProduct

Bottle inventory for spirits.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Bottle name |
| `brand` | String? | Brand |
| `displayName` | String? | Display name |
| `spiritCategoryId` | String | FK to SpiritCategory |
| `tier` | String | "well", "call", "premium", "top_shelf" |
| `bottleSizeMl` | Int | Bottle size (mL) |
| `bottleSizeOz` | Decimal? | Bottle size (oz) |
| `unitCost` | Decimal | Cost per bottle |
| `pourSizeOz` | Decimal? | Override pour size |
| `poursPerBottle` | Int? | Calculated pours |
| `pourCost` | Decimal? | Cost per pour |
| `currentStock` | Int | Bottles on hand |
| `lowStockAlert` | Int? | Low stock threshold |
| `isActive` | Boolean | Active status |

**Relations**: `spiritModifiers`, `recipeIngredients`

**Unique Constraint**: `[locationId, name]`

---

#### RecipeIngredient

Cocktail recipe ingredients.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `menuItemId` | String | FK to MenuItem |
| `bottleProductId` | String | FK to BottleProduct |
| `pourCount` | Decimal | Number of pours |
| `pourSizeOz` | Decimal? | Override pour size |
| `isRequired` | Boolean | Required ingredient |
| `isSubstitutable` | Boolean | Can upgrade tier |
| `sortOrder` | Int | Display order |
| `notes` | String? | Notes |

**Unique Constraint**: `[menuItemId, bottleProductId]`

---

#### SpiritModifierGroup

Links modifier groups to spirit categories.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `modifierGroupId` | String | FK to ModifierGroup (unique) |
| `spiritCategoryId` | String | FK to SpiritCategory |
| `upsellEnabled` | Boolean | Enable upsells |
| `upsellPromptText` | String? | Upsell prompt |
| `defaultTier` | String | Default tier |

---

#### SpiritUpsellEvent

Spirit upsell tracking.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `orderId` | String | FK to Order |
| `orderItemId` | String | FK to OrderItem |
| `employeeId` | String | FK to Employee |
| `baseModifierId` | String | Well spirit ID |
| `baseTier` | String | Base tier |
| `baseBottleName` | String | Base bottle name |
| `upsellModifierId` | String | Upsell spirit ID |
| `upsellTier` | String | Upsell tier |
| `upsellBottleName` | String | Upsell bottle name |
| `priceDifference` | Decimal | Price difference |
| `wasShown` | Boolean | Was shown |
| `wasAccepted` | Boolean | Was accepted |

---

### Pizza Builder

#### PizzaConfig

Location-level pizza builder configuration.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location (unique) |
| `maxSections` | Int | Maximum sections (1-8) |
| `defaultSections` | Int | Default section view |
| `sectionOptions` | Json | Available section modes |
| `pricingMode` | String | "fractional", "flat", "hybrid" |
| `hybridPricing` | Json? | Custom percentages |
| `freeToppingsEnabled` | Boolean | Enable free toppings |
| `freeToppingsCount` | Int | Number of free toppings |
| `freeToppingsMode` | String | "per_pizza", "per_size" |
| `extraToppingPrice` | Decimal? | Override extra price |
| `showVisualBuilder` | Boolean | Show visual builder |
| `showToppingList` | Boolean | Show topping list |
| `defaultToListView` | Boolean | Default to list view |
| `printerIds` | Json? | Printer IDs |
| `printSettings` | Json? | Print settings |

---

#### PizzaSize

Pizza size options.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Size name |
| `displayName` | String? | Display name |
| `inches` | Int? | Diameter |
| `slices` | Int | Number of slices |
| `basePrice` | Decimal | Base price |
| `priceMultiplier` | Decimal | Price multiplier |
| `toppingMultiplier` | Decimal | Topping multiplier |
| `freeToppings` | Int | Free toppings for size |
| `sortOrder` | Int | Display order |
| `isDefault` | Boolean | Default selection |
| `isActive` | Boolean | Active status |

**Relations**: `orderItemPizzas`

**Unique Constraint**: `[locationId, name]`

---

#### PizzaCrust

Pizza crust options.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Crust name |
| `displayName` | String? | Display name |
| `description` | String? | Description |
| `price` | Decimal | Upcharge |
| `sortOrder` | Int | Display order |
| `isDefault` | Boolean | Default selection |
| `isActive` | Boolean | Active status |

**Relations**: `pizzaSpecialties`, `orderItemPizzas`

**Unique Constraint**: `[locationId, name]`

---

#### PizzaSauce

Pizza sauce options.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Sauce name |
| `displayName` | String? | Display name |
| `description` | String? | Description |
| `price` | Decimal | Upcharge |
| `allowLight` | Boolean | Allow light |
| `allowExtra` | Boolean | Allow extra |
| `extraPrice` | Decimal | Extra price |
| `sortOrder` | Int | Display order |
| `isDefault` | Boolean | Default selection |
| `isActive` | Boolean | Active status |

**Relations**: `pizzaSpecialties`, `orderItemPizzas`

**Unique Constraint**: `[locationId, name]`

---

#### PizzaCheese

Pizza cheese options.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Cheese name |
| `displayName` | String? | Display name |
| `description` | String? | Description |
| `price` | Decimal | Upcharge |
| `allowLight` | Boolean | Allow light |
| `allowExtra` | Boolean | Allow extra |
| `extraPrice` | Decimal | Extra price |
| `sortOrder` | Int | Display order |
| `isDefault` | Boolean | Default selection |
| `isActive` | Boolean | Active status |

**Relations**: `pizzaSpecialties`, `orderItemPizzas`

**Unique Constraint**: `[locationId, name]`

---

#### PizzaTopping

Pizza topping options.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Topping name |
| `displayName` | String? | Display name |
| `description` | String? | Description |
| `category` | String | "meat", "veggie", "premium", "cheese", "seafood" |
| `price` | Decimal | Base price |
| `extraPrice` | Decimal? | Extra (2x) price |
| `color` | String? | Visual color |
| `iconUrl` | String? | Icon image |
| `sortOrder` | Int | Display order |
| `isActive` | Boolean | Active status |

**Unique Constraint**: `[locationId, name]`

---

#### PizzaSpecialty

Specialty pizza templates.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `menuItemId` | String | FK to MenuItem (unique) |
| `defaultCrustId` | String? | FK to PizzaCrust |
| `defaultSauceId` | String? | FK to PizzaSauce |
| `defaultCheeseId` | String? | FK to PizzaCheese |
| `sauceAmount` | String | "none", "light", "regular", "extra" |
| `cheeseAmount` | String | Amount |
| `toppings` | Json | Pre-selected toppings |
| `allowSizeChange` | Boolean | Allow size change |
| `allowCrustChange` | Boolean | Allow crust change |
| `allowSauceChange` | Boolean | Allow sauce change |
| `allowCheeseChange` | Boolean | Allow cheese change |
| `allowToppingMods` | Boolean | Allow topping mods |

---

#### OrderItemPizza

Pizza order details.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `orderItemId` | String | FK to OrderItem (unique) |
| `sizeId` | String | FK to PizzaSize |
| `crustId` | String | FK to PizzaCrust |
| `sauceId` | String? | FK to PizzaSauce |
| `sauceAmount` | String | Sauce amount |
| `cheeseId` | String? | FK to PizzaCheese |
| `cheeseAmount` | String | Cheese amount |
| `toppingsData` | Json | Sectional toppings |
| `cookingInstructions` | String? | Cooking notes |
| `cutStyle` | String? | Cut style |
| `sizePrice` | Decimal | Size price |
| `crustPrice` | Decimal | Crust price |
| `saucePrice` | Decimal | Sauce price |
| `cheesePrice` | Decimal | Cheese price |
| `toppingsPrice` | Decimal | Toppings price |
| `totalPrice` | Decimal | Total price |
| `freeToppingsUsed` | Int | Free toppings used |

---

### Hardware Management

#### Printer

Print devices configuration.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Printer name |
| `printerType` | String | "thermal", "impact" |
| `model` | String? | Model (TM-T88VII) |
| `ipAddress` | String | IP address |
| `port` | Int | Port (default 9100) |
| `printerRole` | String | "receipt", "kitchen", "bar" |
| `isDefault` | Boolean | Default for role |
| `paperWidth` | Int | Paper width (80/40mm) |
| `supportsCut` | Boolean | Supports cut |
| `isActive` | Boolean | Active status |
| `lastPingAt` | DateTime? | Last ping time |
| `lastPingOk` | Boolean | Last ping successful |
| `printSettings` | Json? | Print template settings |
| `sortOrder` | Int | Display order |

**Relations**: `printJobs`, `printRules`

**Unique Constraint**: `[locationId, ipAddress]`

---

#### KDSScreen

Kitchen display screens.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String | Screen name |
| `slug` | String? | URL identifier |
| `screenType` | String | "kds", "entertainment" |
| `columns` | Int | Display columns |
| `fontSize` | String | "small", "normal", "large" |
| `colorScheme` | String | "dark", "light" |
| `agingWarning` | Int | Yellow threshold (min) |
| `lateWarning` | Int | Red threshold (min) |
| `playSound` | Boolean | Play sounds |
| `flashOnNew` | Boolean | Flash on new |
| `deviceToken` | String? | Secure pairing token |
| `pairingCode` | String? | Temporary pairing code |
| `pairingCodeExpiresAt` | DateTime? | Code expiry |
| `isPaired` | Boolean | Paired status |
| `staticIp` | String? | Expected IP |
| `enforceStaticIp` | Boolean | Enforce IP |
| `lastKnownIp` | String? | Last IP seen |
| `deviceInfo` | Json? | Device details |
| `isActive` | Boolean | Active status |
| `lastSeenAt` | DateTime? | Last seen time |
| `isOnline` | Boolean | Online status |
| `sortOrder` | Int | Display order |

**Relations**: `stations`, `printRules`

**Unique Constraints**: `[locationId, name]`, `[locationId, slug]`, `deviceToken`

---

#### KDSScreenStation

Links KDS screens to prep stations.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `kdsScreenId` | String | FK to KDSScreen |
| `stationId` | String | FK to PrepStation |
| `sortOrder` | Int | Display order |

**Unique Constraint**: `[kdsScreenId, stationId]`

---

#### PrintRule

Print routing rules.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `name` | String? | Rule name |
| `ruleLevel` | String | "category", "item", "modifier" |
| `categoryId` | String? | FK to Category |
| `menuItemId` | String? | FK to MenuItem |
| `modifierId` | String? | FK to Modifier |
| `printerId` | String? | FK to Printer |
| `kdsScreenId` | String? | FK to KDSScreen |
| `additionalPrinterIds` | Json? | Additional printers |
| `additionalKDSIds` | Json? | Additional KDS screens |
| `printCopies` | Int | Number of copies |
| `isReference` | Boolean | Reference ticket |
| `printOnSend` | Boolean | Print on send |
| `showOnKDS` | Boolean | Show on KDS |
| `priority` | Int | Priority |
| `isActive` | Boolean | Active status |

---

#### PrintJob

Print job queue and history.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `jobType` | String | "kitchen_ticket", "receipt", "reference" |
| `orderId` | String? | FK to Order |
| `printerId` | String | FK to Printer |
| `status` | String | "pending", "sent", "failed" |
| `errorMessage` | String? | Error message |
| `retryCount` | Int | Retry count |
| `content` | String? | ESC/POS buffer |
| `sentAt` | DateTime? | Sent time |

---

### Payroll

#### PayrollPeriod

Pay period definitions.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `periodStart` | DateTime | Period start |
| `periodEnd` | DateTime | Period end |
| `periodType` | String | "weekly", "biweekly", "semimonthly", "monthly" |
| `status` | String | "open", "processing", "closed", "paid" |
| `closedAt` | DateTime? | Closed time |
| `closedBy` | String? | Closed by |
| `paidAt` | DateTime? | Paid time |
| `totalRegularHours` | Decimal? | Total regular hours |
| `totalOvertimeHours` | Decimal? | Total overtime hours |
| `totalWages` | Decimal? | Total wages |
| `totalTips` | Decimal? | Total tips |
| `totalCommissions` | Decimal? | Total commissions |
| `totalBankedTips` | Decimal? | Total banked tips |
| `grandTotal` | Decimal? | Grand total |
| `notes` | String? | Notes |

**Relations**: `payStubs`

**Unique Constraint**: `[locationId, periodStart, periodEnd]`

---

#### PayStub

Employee pay stubs.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `payrollPeriodId` | String | FK to PayrollPeriod |
| `employeeId` | String | FK to Employee |
| `regularHours` | Decimal | Regular hours |
| `overtimeHours` | Decimal | Overtime hours |
| `breakMinutes` | Int | Break minutes |
| `hourlyRate` | Decimal | Hourly rate |
| `regularPay` | Decimal | Regular pay |
| `overtimePay` | Decimal | Overtime pay |
| `declaredTips` | Decimal | Declared tips |
| `tipSharesGiven` | Decimal | Tips given |
| `tipSharesReceived` | Decimal | Tips received |
| `bankedTipsCollected` | Decimal | Banked tips |
| `netTips` | Decimal | Net tips |
| `commissionTotal` | Decimal | Commission total |
| `grossPay` | Decimal | Gross pay |
| `federalTax` | Decimal | Federal tax |
| `stateTax` | Decimal | State tax |
| `socialSecurityTax` | Decimal | Social Security |
| `medicareTax` | Decimal | Medicare |
| `localTax` | Decimal | Local tax |
| `totalDeductions` | Decimal | Total deductions |
| `deductions` | Json? | Other deductions |
| `netPay` | Decimal | Net pay |
| `checkNumber` | String? | Check number |
| `shiftCount` | Int | Shift count |
| `shiftIds` | Json? | Shift IDs |
| `timeEntryIds` | Json? | Time entry IDs |
| `paymentMethod` | String? | Payment method |
| `paymentRef` | String? | Payment reference |
| `paidAt` | DateTime? | Paid time |
| `status` | String | "pending", "approved", "paid", "void" |
| `notes` | String? | Notes |

**Unique Constraint**: `[payrollPeriodId, employeeId]`

---

#### PayrollSettings

Location payroll configuration.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location (unique) |
| `payPeriodType` | String | "weekly", "biweekly", "semimonthly", "monthly" |
| `payDayOfWeek` | Int? | Pay day (0-6) |
| `payDayOfMonth1` | Int? | First pay day |
| `payDayOfMonth2` | Int? | Second pay day |
| `overtimeThresholdDaily` | Decimal | Daily OT threshold |
| `overtimeThresholdWeekly` | Decimal | Weekly OT threshold |
| `overtimeMultiplier` | Decimal | OT multiplier |
| `doubleTimeThreshold` | Decimal? | Double time threshold |
| `doubleTimeMultiplier` | Decimal | Double time multiplier |
| `stateTaxState` | String? | State code |
| `stateTaxRate` | Decimal? | State tax rate |
| `localTaxEnabled` | Boolean | Local tax enabled |
| `localTaxRate` | Decimal? | Local tax rate |
| `localTaxName` | String? | Local tax name |
| `socialSecurityRate` | Decimal | SS rate |
| `medicareRate` | Decimal | Medicare rate |
| `socialSecurityWageBase` | Decimal | SS wage base |
| `minimumWage` | Decimal | Minimum wage |
| `tippedMinimumWage` | Decimal | Tipped minimum |
| `mealBreakThreshold` | Int | Meal break threshold |
| `mealBreakDuration` | Int | Meal break duration |
| `restBreakInterval` | Int | Rest break interval |
| `restBreakDuration` | Int | Rest break duration |
| `paidMealBreaks` | Boolean | Paid meal breaks |
| `paidRestBreaks` | Boolean | Paid rest breaks |

---

### Scheduling

#### Schedule

Weekly schedule templates.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `weekStart` | DateTime | Monday of week |
| `weekEnd` | DateTime | Sunday of week |
| `status` | String | "draft", "published", "archived" |
| `publishedAt` | DateTime? | Published time |
| `publishedBy` | String? | Publisher |
| `notes` | String? | Notes |

**Relations**: `shifts`

**Unique Constraint**: `[locationId, weekStart]`

---

#### ScheduledShift

Individual shift assignments.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `scheduleId` | String | FK to Schedule |
| `employeeId` | String | FK to Employee |
| `date` | DateTime | Shift date |
| `startTime` | String | Start time (HH:MM) |
| `endTime` | String | End time (HH:MM) |
| `breakMinutes` | Int | Break minutes |
| `roleId` | String? | FK to Role |
| `sectionId` | String? | Section ID |
| `status` | String | "scheduled", "confirmed", "no_show", "called_off", "worked" |
| `actualStartTime` | DateTime? | Actual start |
| `actualEndTime` | DateTime? | Actual end |
| `actualHours` | Decimal? | Actual hours |
| `originalEmployeeId` | String? | Original if swapped |
| `swappedAt` | DateTime? | Swap time |
| `swapApprovedBy` | String? | Swap approver |
| `notes` | String? | Notes |

---

#### AvailabilityEntry

Employee availability preferences.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `employeeId` | String | FK to Employee |
| `dayOfWeek` | Int | Day (0-6) |
| `availableFrom` | String? | Start time |
| `availableTo` | String? | End time |
| `isAvailable` | Boolean | Available |
| `preference` | String | "preferred", "available", "if_needed", "unavailable" |
| `effectiveFrom` | DateTime? | Effective start |
| `effectiveTo` | DateTime? | Effective end |
| `notes` | String? | Notes |

**Unique Constraint**: `[employeeId, dayOfWeek, effectiveFrom]`

---

### Audit & Logs

#### VoidLog

Void transaction logging.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `orderId` | String | FK to Order |
| `employeeId` | String | FK to Employee |
| `voidType` | String | "item", "order" |
| `itemId` | String? | Item ID if item void |
| `amount` | Decimal | Void amount |
| `reason` | String | Void reason |
| `approvedById` | String? | Manager approver |
| `approvedAt` | DateTime? | Approval time |

---

#### AuditLog

System action logging.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `locationId` | String | FK to Location |
| `employeeId` | String? | FK to Employee |
| `action` | String | Action type |
| `entityType` | String? | Entity type |
| `entityId` | String? | Entity ID |
| `details` | Json? | Before/after values |
| `ipAddress` | String? | IP address |
| `userAgent` | String? | User agent |

---

## Database Configuration

### Neon PostgreSQL (All Environments)

```env
# Pooled connection (for queries — goes through PgBouncer)
DATABASE_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/gwi_pos_{slug}?sslmode=require"

# Direct connection (for migrations — bypasses PgBouncer)
DIRECT_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/gwi_pos_{slug}?sslmode=require"
```

Each venue gets its own database: `gwi_pos_{slug}` (e.g., `gwi_pos_joes_bar`).
Master database: `gwi_pos` (stores organization/location metadata).

### Connection in Code

```typescript
import { db } from '@/lib/db'

// Query with multi-tenancy
const items = await db.menuItem.findMany({
  where: {
    locationId,      // ALWAYS filter by location
    deletedAt: null, // ALWAYS exclude soft-deleted
    isActive: true,
  },
})
```

---

## Migration Notes

### PostgreSQL Features in Use

| Feature | Usage |
|---------|-------|
| Native arrays | Available but JSON still used for Prisma compatibility |
| Native DECIMAL | Precise financial calculations |
| Full-text search | Available for menu/ingredient search |
| Advanced JSON | `jsonb` operators for settings/configuration |
| Concurrent writes | Full MVCC support across terminals |
| Connection pooling | Neon PgBouncer via `DATABASE_URL` |

### Backup Commands

```bash
# PostgreSQL backup via pg_dump
pg_dump $DATABASE_URL > backup.sql

# Restore from dump
psql $DATABASE_URL < backup.sql

# Neon also provides point-in-time recovery via dashboard
```

---

## Quick Reference

### Required Fields on New Tables

```prisma
model NewTable {
  id         String   @id @default(cuid())
  locationId String
  location   Location @relation(fields: [locationId], references: [id])

  // ... your fields

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@index([locationId])
}
```

### Query Pattern

```typescript
// ALWAYS include these filters
const records = await db.table.findMany({
  where: {
    locationId,       // Multi-tenancy
    deletedAt: null,  // Exclude soft-deleted
  },
})
```

### Soft Delete Pattern

```typescript
// NEVER hard delete
await db.table.update({
  where: { id },
  data: { deletedAt: new Date() },
})
```

---

*Document generated from `prisma/schema.prisma` - January 2026*
