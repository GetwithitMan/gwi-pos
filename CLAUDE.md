# CLAUDE.md - GWI POS Project Reference

This file provides context for Claude Code when working on this project.

## Project Overview

GWI POS is a modern point-of-sale system built for bars and restaurants. It emphasizes a "fewest clicks" philosophy for fast service.

## System Architecture

GWI POS is a **hybrid SaaS** system with local servers at each location for speed and offline capability.

```
┌─────────────────────────────────────────────────────────────────┐
│                    GWI ADMIN CONSOLE (Cloud)                     │
│  • Onboard new locations        • Push updates                  │
│  • Manage subscriptions         • Aggregate reporting           │
│  • Monitor all locations        • License enforcement           │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Sync when online
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                LOCAL SERVER (Ubuntu Mini PC)                     │
│  Docker Compose:                                                │
│  ├── GWI POS (Next.js)           ├── PostgreSQL (local data)   │
│  ├── Socket.io (real-time)       └── Watchtower (auto-updates) │
│                                                                 │
│  • Manages all terminals + devices                              │
│  • Works 100% offline                                           │
│  • Sub-10ms response times                                      │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Local network (WiFi/Ethernet)
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         ┌─────────┐    ┌─────────┐    ┌─────────┐
         │Terminal │    │Terminal │    │ Phone/  │
         │   #1    │    │   #2    │    │  iPad   │
         │(browser)│    │(browser)│    │  (PWA)  │
         └─────────┘    └─────────┘    └─────────┘
```

### Build Phases

| Phase | What | Status |
|-------|------|--------|
| **1** | Build the POS | 🔄 In Progress |
| **2** | Build Admin Console | ⏳ Later |
| **3** | Deployment Infrastructure | ⏳ Later |

### Why Local Servers?

| Benefit | Details |
|---------|---------|
| **Speed** | Sub-50ms response (vs 100-500ms cloud) |
| **Offline** | Works 100% when internet is down |
| **Real-time** | Socket.io on local network = instant KDS updates |
| **Reliability** | No dependency on external services |

**Full architecture details:** See `/docs/GWI-ARCHITECTURE.md`

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.1.5 | Framework with App Router |
| React | 19.2.3 | UI Library |
| TypeScript | 5.x | Type Safety |
| Tailwind CSS | 4.x | Styling |
| Prisma | 6.19.2 | ORM |
| SQLite | - | Database (local file: `prisma/pos.db`) |
| Zustand | 5.x | State Management |
| Zod | 4.x | Validation |

## Database

**Database Type**: SQLite (NOT PostgreSQL)

The database is a local SQLite file stored at `prisma/pos.db`. This was migrated from PostgreSQL for easier local development and deployment.

### 🚨 CRITICAL: Protecting Your Data

> **DATA LOSS INCIDENT:** During development, manually-added modifier groups and hardware
> were lost when the database was reset. Custom data not in `seed.ts` will be DELETED
> by reset commands. This is unrecoverable without backups.

**🔴 DESTRUCTIVE COMMANDS - CAN DELETE ALL DATA:**

| Command | Risk Level | What It Does |
|---------|------------|--------------|
| `npm run reset` | 🔴 EXTREME | **DELETES EVERYTHING** - All tables wiped, re-seeded from scratch |
| `npm run db:push` | 🔴 HIGH | Can drop tables/columns if schema changed |
| `npm run db:migrate` | 🟡 MEDIUM | May drop columns, usually safer than push |
| `prisma migrate reset` | 🔴 EXTREME | Same as npm run reset |

**⚠️ BEFORE ANY SCHEMA CHANGE:**
```bash
# Step 1: ALWAYS backup first
npm run db:backup

# Step 2: Verify backup was created
ls -la prisma/backups/

# Step 3: THEN make your changes
npm run db:push  # or db:migrate
```

**If you added data via the UI (modifiers, printers, etc.):**
- That data is NOT in `seed.ts`
- Running `reset` will DELETE it permanently
- Either: 1) Add it to seed.ts, or 2) NEVER run reset

**Recovery from data loss:**
```bash
# List available backups
npm run db:list-backups

# Restore from a backup (OVERWRITES current database)
cp prisma/backups/pos-YYYYMMDD-HHMMSS.db prisma/pos.db
```

### Safe Database Commands

```bash
# SAFE - Generate Prisma client (no data changes)
npx prisma generate

# SAFE - View data in browser
npm run db:studio

# SAFE - Backup current database
npm run db:backup

# SAFE - List all backups
npm run db:list-backups

# SAFE - Restore from latest backup
npm run db:restore
```

### Potentially Destructive Commands

```bash
# ⚠️ Push schema changes (backup first!)
npm run db:backup && npm run db:push

# ⚠️ Run migrations (backup first!)
npm run db:backup && npm run db:migrate

# ⚠️ Seed database (adds demo data, may conflict with existing)
npm run db:seed

# 🔴 DANGER: Reset database (DELETES EVERYTHING, auto-backs up first)
npm run reset
```

### Production Database Rules (MANDATORY)

When we go to production, these rules are NON-NEGOTIABLE:

| Rule | Enforcement |
|------|-------------|
| No `reset` command | Blocked by environment check |
| No `db:push` | Migrations only in production |
| Backup before migrate | Automatic pre-migration backup |
| Test migrations first | Staging environment required |
| Soft deletes only | Never hard delete, use `deletedAt` |
| PostgreSQL required | SQLite is dev-only |

**Why PostgreSQL for production:**
- ACID compliance (atomic transactions)
- Point-in-time recovery (restore to any second)
- Read replicas for backup
- Better concurrent write handling
- Production-grade reliability

### Backup Location

Backups are stored in `prisma/backups/` with timestamps:
- `prisma/backups/pos-20260128-143022.db`

To restore a specific backup:
```bash
cp prisma/backups/pos-20260128-143022.db prisma/pos.db
```

### Environment Variables

Located in `.env.local`:
```
DATABASE_URL="file:./pos.db"
```

### ⚠️ CRITICAL: Multi-Tenancy (locationId)

**EVERY table MUST have `locationId`** (except `Organization` and `Location` which are root tables).

This is a **HARD REQUIREMENT** for multi-tenancy support. Even if a table seems like it only belongs to one parent, it MUST have `locationId` for:
1. **Simpler queries** - No need for complex joins to filter by location
2. **Security** - Direct filtering prevents cross-tenant data leaks
3. **Performance** - Indexed locationId enables fast queries
4. **Consistency** - All data access patterns work the same way

**When creating a new model:**
```prisma
model NewModel {
  id         String   @id @default(cuid())
  locationId String
  location   Location @relation(fields: [locationId], references: [id])

  // ... other fields

  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  // Sync fields (REQUIRED for cloud sync)
  deletedAt  DateTime?
  syncedAt   DateTime?

  @@index([locationId])
}
```

### ⚠️ CRITICAL: Sync Fields (deletedAt, syncedAt)

**EVERY table MUST have sync fields** (except `Organization` and `Location`).

| Field | Purpose |
|-------|---------|
| `deletedAt` | Soft delete - never hard delete records |
| `syncedAt` | Tracks when record was last synced to cloud |

**Why this matters:**
- Cloud sync needs to know what's been pushed
- Soft deletes allow sync to handle "deleted" records
- Hard deletes cause sync conflicts

**Never hard delete - always soft delete:**
```typescript
// ❌ BAD - hard delete causes sync issues
await db.menuItem.delete({ where: { id } })

// ✅ GOOD - soft delete
await db.menuItem.update({
  where: { id },
  data: { deletedAt: new Date() }
})

// ✅ GOOD - filter out soft-deleted in queries
const items = await db.menuItem.findMany({
  where: { locationId, deletedAt: null }
})
```

**When querying data:**
```typescript
// ALWAYS filter by locationId
const items = await db.menuItem.findMany({
  where: { locationId }  // Required!
})

// Even for nested data, include locationId
const order = await db.order.findFirst({
  where: { id: orderId, locationId }  // Double-check!
})
```

**When creating records:**
```typescript
// ALWAYS include locationId
await db.orderItem.create({
  data: {
    locationId,  // Required!
    orderId,
    menuItemId,
    // ... other fields
  }
})
```

**Tables with locationId + sync fields (80 total):**
All tables except `Organization` and `Location` have `locationId`, `deletedAt`, and `syncedAt` including:
- Core: Employee, Role, Category, MenuItem, ModifierGroup, Modifier
- Orders: Order, OrderItem, OrderItemModifier, Payment, OrderDiscount
- Menu: MenuItemModifierGroup, ComboTemplate, ComboComponent, ComboComponentOption
- Operations: Shift, Drawer, PaidInOut, TimeClockEntry, Break
- Tips: TipOutRule, TipShare, TipBank, TipPool, TipPoolEntry
- And all other tables...

## Demo Credentials

| Role | PIN | Description |
|------|-----|-------------|
| Manager | 1234 | Full admin access |
| Server | 2345 | Server permissions |
| Bartender | 3456 | Bar permissions |

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

Dev server runs at: http://localhost:3000

## Application Routes

### POS Routes
| Route | Description |
|-------|-------------|
| `/login` | PIN-based login |
| `/orders` | Main POS order screen |
| `/kds` | Kitchen Display System |
| `/kds/entertainment` | Entertainment KDS (pool tables, etc.) |

### Admin Routes (via hamburger menu in /orders)
| Route | Description |
|-------|-------------|
| `/menu` | Menu management (categories, items, modifiers) |
| `/modifiers` | Modifier group management |
| `/employees` | Employee management |
| `/tables` | Floor plan / table layout |
| `/settings` | System settings |
| `/settings/order-types` | Configurable order types management |
| `/settings/tip-outs` | Tip-out rules configuration |
| `/reports` | Sales and labor reports |
| `/reports/daily` | Daily store report (EOD) |
| `/reports/shift` | Employee shift report |
| `/reports/tip-shares` | Tip share report (standalone) |
| `/reports/tips` | Tips report (tip shares, banked tips) |
| `/customers` | Customer management |
| `/reservations` | Reservation system |
| `/ingredients` | Food inventory (base ingredients + prep items) |
| `/inventory` | Inventory tracking |
| `/liquor-builder` | Liquor/spirit recipe builder |

## Key Features

### Category Types
Categories can be typed for different behaviors:
- `food` - Standard food items
- `drinks` - Non-alcoholic beverages
- `liquor` - Alcoholic beverages (enables pour sizes, recipe builder)
- `entertainment` - Timed rentals (pool tables, darts)
- `combos` - Combo meals
- `retail` - Retail products

### Modifier Types
Modifier groups can have multiple types (stored as JSON array):
- `universal` - Available to all item types
- `food` - Food item modifiers
- `liquor` - Spirit/drink modifiers
- `retail` - Retail item modifiers
- `entertainment` - Entertainment modifiers
- `combo` - Combo/bundle modifiers

### Online Ordering Modifier Override
Control which modifier groups and individual modifiers appear for online orders vs POS.

**Two-Level Control:**
1. **Item Level** - Per menu item, choose which modifier groups appear for online orders
2. **Modifier Level** - Within a group, choose which individual modifiers appear online

**Schema:**
- `MenuItemModifierGroup.showOnline` - Boolean controlling if group appears online for this item
- `ModifierGroup.hasOnlineOverride` - Enables per-modifier visibility management
- `Modifier.showOnPOS` / `Modifier.showOnline` - Per-modifier channel visibility

**API Usage:**
```typescript
// Fetch modifiers for online ordering (filtered)
GET /api/menu/items/{id}/modifiers?channel=online

// Fetch modifiers for POS (all or filtered by showOnPOS)
GET /api/menu/items/{id}/modifiers?channel=pos

// Save modifier group links with online visibility
POST /api/menu/items/{id}/modifiers
{ "modifierGroups": [{ "id": "grp-1", "showOnline": true }, { "id": "grp-2", "showOnline": false }] }
```

**Admin UI:**
- Edit Item Modal: "Modifier Groups" + "Online Modifier Groups" sections
- Modifiers Page: "Enable Online Ordering Override" with visibility table

**Example Use Case:**
- Servers see all 10 wing sauce options on POS
- Online customers only see 8 popular options (spicy ones hidden)

### Modifier Stacking
Modifier groups with `allowStacking: true` allow selecting the same modifier multiple times.
- Visual feedback: gradient color + yellow glow for stacked selections
- "2x" badge shows stacked count
- Hint text: "Tap same item twice for 2x"

### Modifier Hierarchy (Nested Modifiers)
Child modifier groups create nested selections. Depth is tracked for display:
- `OrderItemModifier.depth` - 0=top level, 1=child, 2=grandchild
- KDS/Orders display uses dash prefix: `- Salad`, `-- Ranch Dressing`

### Pour Sizes (Liquor Items)
Liquor items support quick pour size selection with price multipliers:
- `shot` - Standard pour (1.0x price)
- `double` - Double pour (2.0x price)
- `tall` - Tall/long pour (1.5x price)
- `short` - Short pour (0.75x price)

Configuration stored in MenuItem:
- `pourSizes` - JSON object of enabled pour sizes with multipliers
- `defaultPourSize` - Default selection
- `applyPourToModifiers` - Whether to apply multiplier to spirit modifiers

### Linked Item Modifiers (Spirit Upgrades)
Modifiers can be linked to actual menu items for proper tracking and reporting:
- `linkedMenuItemId` on Modifier - Links to a MenuItem for price/inventory
- `priceType`: 'upcharge' | 'override' | 'from_item'
- When sold, `OrderItemModifier` captures the linked item for sales reporting

This enables:
- "Patron Silver sold 47x: 30 standalone, 17 as margarita upgrades"
- Accurate inventory tracking regardless of how item was ordered
- Price consistency (change item price, modifier updates automatically)

### Entertainment Sessions (Timed Rentals)
Entertainment items like pool tables support timed sessions:
- Timer auto-starts on "Send to Kitchen" or "Send to Tab"
- Block time mode: Fixed duration (e.g., 60 min for $15)
- Per-minute billing mode: Charges based on elapsed time

Configuration stored in MenuItem:
- `itemType: 'timed_rental'` - Marks as entertainment item
- `blockTimeMinutes` - Default session duration
- `entertainmentStatus` - Current state (available, in_use, maintenance)
- `currentOrderId` / `currentOrderItemId` - Links to active session

Session tracking in OrderItem:
- `blockTimeMinutes` - Duration for this session
- `blockTimeStartedAt` - When timer started
- `blockTimeExpiresAt` - When timer expires

Three synchronized views:
1. Entertainment KDS (`/kds/entertainment`) - Full dashboard
2. Open Orders Panel - Badge display with quick controls
3. Orders Page - Inline timer and stop/extend buttons

### Tip Sharing System
Comprehensive tip distribution with automatic tip-outs. ALL tip shares go to payroll (simplified cash flow).

**Tip-Out Rules** (configured at `/settings/tip-outs`):
- Role-based automatic tip-out percentages (e.g., Server → Busser 3%)
- Applied automatically at shift closeout
- Multiple rules per role supported

**Simplified Cash Flow**:
- ALL tip shares go to payroll (no same-day cash handoffs)
- Server gives tip-out cash to house
- House holds for payroll distribution
- No timing dependency on who clocks out first

**Tip Share Settings** (`settings.tipShares`):
```json
{
  "payoutMethod": "payroll",     // "payroll" (auto) or "manual" (use report)
  "autoTipOutEnabled": true,
  "requireTipOutAcknowledgment": true,
  "showTipSharesOnReceipt": true
}
```

**Reports**:

| Report | Endpoint | Description |
|--------|----------|-------------|
| Daily Store Report | `/api/reports/daily` | Comprehensive EOD with tip shares section |
| Employee Shift Report | `/api/reports/employee-shift` | Tips earned vs received separation |
| Tip Share Report | `/api/reports/tip-shares` | Standalone, by recipient/giver, mark as paid |

**Tip Share Report Actions** (POST `/api/reports/tip-shares`):
- `mark_paid` - Mark specific tip share IDs as paid (for manual mode)
- `mark_paid_all` - Mark all for an employee as paid

**Key Distinction in Reports**:
- `tips.earned` = Tips from orders (subject to tip-out rules)
- `tipShares.received` = Tips from other employees (NOT subject to tip-out)

**Related Models**:
- `TipOutRule` - Automatic tip-out rules by role
- `TipShare` - Actual tip distribution records
- `TipBank` - Uncollected/banked tips (legacy)

**Permissions**:
- `tips.view_own` / `tips.view_all` - View tips
- `tips.share` / `tips.collect` - Share and collect tips
- `tips.manage_rules` / `tips.manage_bank` - Admin tip management

### Configurable Order Types
Admin-configurable order types replace hardcoded types, supporting custom fields and workflow rules.

**Default Order Types:**

| Type | Slug | Required Fields | Workflow Rules |
|------|------|-----------------|----------------|
| Table | `dine_in` | tableId | requireTableSelection |
| Bar Tab | `bar_tab` | tabName | requireCustomerName |
| Takeout | `takeout` | - | requirePaymentBeforeSend |
| Delivery | `delivery` | address, phone | - |
| Drive Thru | `drive_thru` | customerName, vehicleType, vehicleColor | - |

**Admin Management** (`/settings/order-types`):
- Create custom order types with name, slug, color, icon
- Configure required/optional fields with various input types
- Set workflow rules (require table, payment, customer name)
- Toggle active/inactive to show/hide in POS
- System types protected from deletion

**Field Types:**
- `text` - Single line input
- `textarea` - Multi-line input
- `phone` - Phone number input
- `time` - Time picker
- `select` - Button grid selection (touch-friendly)

**Workflow Rules:**
- `requireTableSelection` - Must select table before sending
- `requireCustomerName` - Must have customer/tab name
- `requirePaymentBeforeSend` - Must pay before sending to kitchen
- `allowSplitCheck` - Whether split check is allowed
- `showOnKDS` - Whether to display on KDS

**Related Models:**
- `OrderType` - Order type configuration with JSON fields
- `Order.orderTypeId` - Reference to OrderType record
- `Order.customFields` - JSON storage for collected field values

**Key Files:**
- `src/types/order-types.ts` - Type definitions
- `src/app/api/order-types/route.ts` - CRUD API
- `src/components/orders/OrderTypeSelector.tsx` - POS buttons & modal
- `src/app/(admin)/settings/order-types/page.tsx` - Admin page

## Seed Data (Bar Menu)

The seed includes a comprehensive bar menu:

### Spirits (98 items with pour size options)
| Category | Count | Examples |
|----------|-------|----------|
| Whiskey | 30 | Bourbon, Rye, Scotch, Irish, Canadian |
| Vodka | 18 | Well → Grey Goose, flavored options |
| Rum | 15 | White, Spiced, Dark, Aged |
| Tequila | 22 | Blanco, Reposado, Anejo |
| Gin | 13 | London Dry, Craft varieties |

### Cocktails (37 drinks)
Classic cocktails with spirit upgrade modifiers:
- Whiskey: Old Fashioned, Manhattan, Whiskey Sour
- Vodka: Moscow Mule, Cosmopolitan, Martini
- Rum: Mojito, Daiquiri, Pina Colada
- Tequila: Margarita (styles/flavors), Paloma, Ranch Water
- Gin: G&T, Negroni, Tom Collins

### Beer & Wine
- 28 beers (domestic, import, craft, seltzer)
- 16 wines (red, white, rose, sparkling)

### Modifier Groups
| Group | Type | Purpose |
|-------|------|---------|
| Mixers | liquor | Coke, Sprite, Tonic, Red Bull, etc. |
| Garnish | liquor | Lime, Lemon, Olives, Salt Rim, etc. |
| Ice | liquor | Neat, Rocks, Up, Light Ice, etc. |
| Spirit Upgrades | liquor | Upgrade from well to call/premium/top shelf |
| Margarita Style | liquor | Rocks, Frozen, Up |
| Margarita Flavor | liquor | Classic, Strawberry, Mango, etc. |
| Steak Temp | food | Rare → Well Done |
| Wing Sauce | food | Buffalo, BBQ, Garlic Parm, etc. |
| Burger Add-ons | food | Bacon, Cheese, Avocado, etc. |

## Project Structure

```
gwi-pos/
├── prisma/
│   ├── schema.prisma    # Database schema
│   ├── seed.ts          # Seed data script
│   └── pos.db           # SQLite database file
├── src/
│   ├── app/
│   │   ├── (auth)/      # Login pages
│   │   ├── (pos)/       # POS interface
│   │   ├── (admin)/     # Admin pages
│   │   └── api/         # API routes
│   ├── components/      # React components
│   ├── hooks/           # Custom hooks
│   ├── stores/          # Zustand stores
│   ├── lib/             # Utilities
│   │   ├── db.ts        # Prisma client
│   │   └── ...
│   └── types/           # TypeScript types
├── public/              # Static assets
├── CLAUDE.md            # This file
├── INSTALL.txt          # Linux deployment guide
└── package.json
```

## API Conventions

### Route Structure
- `/api/menu` - GET menu with categories and items
- `/api/menu/categories` - CRUD for categories
- `/api/menu/categories/[id]` - Single category operations
- `/api/menu/items` - Create items
- `/api/menu/items/[id]` - Update/delete items
- `/api/menu/modifiers` - CRUD for modifier groups
- `/api/menu/modifiers/[id]` - Single modifier group operations
- `/api/orders/[id]/items` - POST to atomically append items (prevents race conditions)
- `/api/orders/[id]/send` - POST to send order to kitchen

### Response Format
```typescript
// Success
{ data: T }

// Error
{ error: string }
```

### Common Patterns

1. **Decimal fields** - Convert to Number() when returning from API
2. **JSON fields** - Used for arrays in SQLite (e.g., `modifierTypes`, `pourSizes`)
3. **Soft deletes** - Use `deletedAt: new Date()` instead of hard deletes (required for sync)
4. **Sort order** - Most lists support `sortOrder` for custom ordering
5. **Always filter by locationId** - Multi-tenancy requirement
6. **Always filter out deleted** - Add `deletedAt: null` to queries

## Schema Highlights

### Key Models
- `Organization` → `Location` → Most other models
- `Category` → `MenuItem` → `OrderItem`
- `ModifierGroup` → `Modifier`
- `MenuItem` ↔ `ModifierGroup` via `MenuItemModifierGroup`
- `Order` → `OrderItem` → `OrderItemModifier`

### Important Fields

**MenuItem**:
- `itemType`: 'standard' | 'combo' | 'timed_rental'
- `pourSizes`: JSON for liquor pour options
- `timedPricing`: JSON for entertainment pricing

**ModifierGroup**:
- `modifierTypes`: JSON array of type strings
- `isSpiritGroup`: Boolean for liquor builder integration

**Category**:
- `categoryType`: Determines item builder and filtering behavior

## Inventory & Recipe Costing

### Modifier Instruction Multipliers (Lite, Extra, No Logic)

The inventory calculation engine supports instruction-based multipliers for modifiers,
allowing precise tracking of ingredient usage based on how orders are customized.

**Multiplier Defaults (configurable per-location in InventorySettings):**
| Instruction | Multiplier | Example |
|-------------|------------|---------|
| NO, HOLD, REMOVE | 0.0 | "No Onions" - skip deduction |
| LITE, LIGHT, EASY | 0.5 | "Lite Mayo" - half portion |
| NORMAL, REGULAR | 1.0 | Standard amount |
| EXTRA, DOUBLE | 2.0 | "Extra Cheese" - double portion |
| TRIPLE, 3X | 3.0 | "Triple Buffalo" - triple portion |

**The "NO" Logic (Base Recipe Intelligence):**
When a customer orders "No Onions" on a Burger that includes onions in the base recipe,
the system skips the onion deduction entirely. This prevents false "shrinkage" in variance reports.

**Key Files:**
- `src/lib/inventory-calculations.ts` - `getModifierMultiplier()`, `isRemovalInstruction()`
- `src/app/api/inventory/settings/route.ts` - Location settings for custom multipliers
- Schema: `OrderItemModifier.preModifier` - stores "no", "lite", "extra", etc.
- Schema: `InventorySettings.multiplierLite/Extra/Triple` - configurable multipliers

**API Example - Custom Multipliers:**
```json
POST /api/inventory/settings
{
  "locationId": "xxx",
  "multiplierLite": 0.75,   // 75% instead of 50%
  "multiplierExtra": 1.5    // 150% instead of 200%
}
```

### Auto-Deduction on Order Paid/Voided

Inventory is automatically deducted when orders are paid or items are voided (if food was made).

**Two Entry Points:**

| Trigger | Function | Transaction Type | Description |
|---------|----------|------------------|-------------|
| Order Paid | `deductInventoryForOrder()` | `sale` | Deducts all recipe ingredients when order is closed |
| Item Voided/Comped | `deductInventoryForVoidedItem()` | `waste` | Deducts ingredients + creates WasteLogEntry |

**Waste Void Reasons (deduction required):**
- `kitchen_error` - Kitchen made wrong item
- `customer_disliked` - Customer didn't like it (food was served)
- `wrong_order` - Server rang in wrong item
- `remade` - Item had to be remade
- `quality_issue` - Food didn't meet quality standards

**Fire-and-Forget Pattern:**
Deductions run asynchronously after payment/void to not block the POS:
```typescript
deductInventoryForOrder(orderId, employeeId).catch(err => {
  console.error('Background inventory deduction failed:', err)
})
```

**Key Files:**
- `src/lib/inventory-calculations.ts` - `deductInventoryForOrder()`, `deductInventoryForVoidedItem()`
- `src/app/api/orders/[id]/pay/route.ts` - Hook after payment (line ~477)
- `src/app/api/orders/[id]/comp-void/route.ts` - Hook after void/comp

**Full Code Reference:** `docs/inventory-auto-deduction-code.txt`

## Liquor Builder

The Liquor Builder system tracks:
- `SpiritCategory` - Tequila, Vodka, Gin, etc.
- `BottleProduct` - Actual bottles with cost/pour calculations
- `RecipeIngredient` - Links menu items to bottles for cocktail recipes

Located at `/liquor-builder` in the admin interface.

## Hardware & Printing

### Printer Configuration

Located at `/settings/hardware` - manage receipt and kitchen printers.

**Printer Types:**
- `thermal` - Thermal receipt printers (e.g., Epson TM-T88)
- `impact` - Impact kitchen printers (e.g., Epson TM-U220)

**Printer Roles:**
- `receipt` - Customer receipts
- `kitchen` - Kitchen tickets (food prep)
- `bar` - Bar tickets

**Printer Models:**
- `Printer` - Printer configuration (IP, port, type, role)
- `PrinterSettings` - Per-printer text sizing and formatting
- `PrintJob` - Print job history/logging

### Print Routes

Located at `/settings/hardware/routing` - named print routes with printer-specific settings.

**Features:**
- Named routes (e.g., "Pizza Printer 1", "Bar Printer")
- Route types: pizza, bar, category, item_type
- Printer-type-specific settings (impact vs thermal)
- Backup printer failover with configurable timeout
- Live preview of ticket appearance
- Priority-based routing

**Routing Priority:**
```
PrintRoute (by priority) > Item printer > Category printer > Default kitchen printer
```

**Related Models:**
- `PrintRoute` - Route configuration with settings and failover
- `RouteSpecificSettings` - Base + impact + thermal + pizza/bar options

**Key Files:**
- `src/types/print-route-settings.ts` - RouteSpecificSettings types
- `src/components/hardware/PrintRouteEditor.tsx` - Editor modal with live preview
- `src/app/api/hardware/print-routes/` - CRUD API

### Pizza Print Settings

Located at `/pizza` settings tab - specialized settings for pizza kitchen tickets.

**Features:**
- **Live Preview** - See exactly how tickets will print as you change settings
- **Red Ribbon Support** - Two-color printing for TM-U220 impact printers
- **Sectional Printing** - Organized by pizza sections (WHOLE, LEFT HALF, 1/6-1, etc.)
- **Size/Crust/Sauce/Cheese** - All pizza attributes print on ticket

**Priority System:**
Pizza Print Settings override Printer Settings when configured:
```typescript
// Priority: Pizza Settings > Printer Settings > Defaults
const headerSize = settings.textSizing?.headerSize ?? printerSettings.textSizing.headerSize
```

**Related Models:**
- `PizzaConfig` - Location pizza settings including `printerIds` and `printSettings`
- `OrderItemPizza` - Pizza order data (size, crust, toppings, sections)

### ESC/POS Commands

The system uses ESC/POS protocol for printer communication:

**Thermal Printers:**
- `GS ! 0x11` - Double width + height
- `GS ! 0x01` - Double height only
- `GS ! 0x00` - Normal size

**Impact Printers (TM-U220):**
- `ESC ! 0x30` - Double width + height
- `ESC ! 0x10` - Double height only
- `ESC ! 0x00` - Normal size

**Two-Color (Red Ribbon):**
- `ESC r 0x01` - Red color
- `ESC r 0x00` - Black color

**Key Files:**
- `src/lib/escpos/commands.ts` - ESC/POS command constants
- `src/lib/escpos/document.ts` - Document building utilities
- `src/lib/printer-connection.ts` - TCP socket connection to printers
- `src/app/api/print/kitchen/route.ts` - Kitchen ticket generation
- `src/types/pizza-print-settings.ts` - Pizza print settings types
- `src/types/printer-settings.ts` - General printer settings types

### KDS Device Security

Production-ready device authentication for KDS screens. Prevents unauthorized access to kitchen displays.

**Security Layers:**
| Layer | Protection |
|-------|-----------|
| 256-bit token | Cryptographically secure device identity |
| httpOnly cookie | XSS-proof token storage (auto-sent with requests) |
| Secure + SameSite | HTTPS-only, CSRF protection |
| 5-min pairing code | Time-limited code expiry |
| Static IP binding | Optional network-level lock (for UniFi) |

**Pairing Flow:**
1. Admin generates 6-digit code at `/settings/hardware/kds-screens`
2. Device enters code at `/kds/pair`
3. Server issues token + sets httpOnly cookie (1-year expiry)
4. All KDS requests verified against token + optional IP

**Schema Fields (`KDSScreen`):**
- `deviceToken` - Unique 256-bit token per paired device
- `pairingCode` / `pairingCodeExpiresAt` - Temporary 6-digit code
- `isPaired` - Pairing status
- `staticIp` / `enforceStaticIp` - Optional IP binding
- `lastKnownIp` / `deviceInfo` - Troubleshooting data

**API Endpoints:**
- `POST /api/hardware/kds-screens/[id]/generate-code` - Generate pairing code
- `POST /api/hardware/kds-screens/pair` - Complete pairing
- `GET /api/hardware/kds-screens/auth` - Verify device
- `POST /api/hardware/kds-screens/[id]/unpair` - Remove pairing

**Key Files:**
- `src/app/api/hardware/kds-screens/auth/route.ts` - Device auth + IP check
- `src/app/api/hardware/kds-screens/pair/route.ts` - Pairing + httpOnly cookie
- `src/app/(kds)/kds/page.tsx` - Auth flow on KDS
- `src/app/(kds)/kds/pair/page.tsx` - Pairing code entry UI
- `docs/skills/102-KDS-DEVICE-SECURITY.md` - Full documentation

### Mobile Device Security (Planned)

Employee phones/tablets can be used as POS terminals via PWA. Security via QR + PIN system:

**Clock-in Flow:**
1. Employee clocks in at manager station
2. System displays QR code (one-time use)
3. Employee scans with phone → QR becomes 4-digit PIN
4. Employee enters PIN on phone → session activated
5. First-time devices get named ("Sarah's iPhone")

**Session Rules:**
- Session valid until clock-out or 8-hour max
- Device bound to session token + fingerprint
- Manager can revoke any session instantly
- Periodic PIN re-entry for voids/discounts

**Planned Schema:**
```prisma
model RegisteredDevice {
  id                String    @id @default(cuid())
  locationId        String
  deviceFingerprint String    @unique
  name              String              // "Sarah's iPhone"
  type              String?             // phone, tablet, terminal
  lastSeenAt        DateTime
  isActive          Boolean   @default(true)
  // ... sync fields
}

model DeviceSession {
  id           String    @id @default(cuid())
  locationId   String
  employeeId   String
  deviceId     String
  token        String    @unique
  expiresAt    DateTime
  revokedAt    DateTime?
  // ... sync fields
}
```

**Full details:** See `/docs/GWI-ARCHITECTURE.md`

## Recent Changes

### Modifier Cascade Delete & Orphan Cleanup (Skill 210 - Feb 2026)
Safe recursive deletion of modifier groups with preview and automatic orphan cleanup.

**Features:**
- `?preview=true` mode shows what will be deleted before committing
- `collectDescendants()` recursively walks child modifier groups
- Automatic orphan cleanup: stale `childModifierGroupId` references auto-cleared on GET
- Soft deletes throughout (sets `deletedAt`, never hard deletes)

**Key Files:**
- `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts` - DELETE with cascade + preview
- `src/app/api/menu/items/[id]/modifier-groups/route.ts` - GET with orphan detection

**Skill Doc:** `docs/skills/210-MODIFIER-CASCADE-DELETE.md`

### Hierarchical Ingredient Picker (Skill 211 - Feb 2026)
Unified hierarchical picker for both ingredient assignment and modifier ingredient linking.

**Architecture:**
- Shared `buildHierarchy(searchTerm)` function generates Category → Parent → Prep Item tree
- Green picker: Item ingredient assignment (top of ItemEditor)
- Purple picker: Modifier ingredient linking (inline in modifier rows)
- Both pickers support inline creation of inventory items and prep items

**Features:**
- Expand/collapse categories and parent ingredients
- Search filters hierarchy while keeping structure
- "+" buttons on categories and parents for inline creation
- Auto-link to modifier after creating prep item (purple picker)
- Auto-add to ingredients after creating prep item (green picker)

**Key Files:**
- `src/components/menu/ItemEditor.tsx` - Both pickers, `buildHierarchy()` function

**Skill Doc:** `docs/skills/211-HIERARCHICAL-INGREDIENT-PICKER.md`

### Per-Modifier Print Routing (Skill 212 - Feb 2026)
Admin UI and API for routing individual modifiers to specific printers.

**Schema Fields (already existed in Prisma, now wired):**
```prisma
model Modifier {
  printerRouting  String   @default("follow")  // "follow" | "also" | "only"
  printerIds      Json?                         // Array of printer IDs
}
```

**Routing Modes:**
| Mode | Behavior |
|------|----------|
| `follow` | Modifier prints wherever parent item prints (default) |
| `also` | Prints to item's printer(s) AND modifier's own printers |
| `only` | Prints ONLY to modifier's own printers (not item's) |

**What's Done (Menu Domain):**
- Admin UI: printer button on each modifier row in ItemEditor
- API: GET/POST/PUT return and accept `printerRouting` + `printerIds`

**What's Pending (Hardware Domain - Skill 103 Phase 3):**
- Print dispatch integration — resolving modifier routing at ticket generation time
- Context line on modifier-only tickets ("FOR: {item name}")

**Key Files:**
- `src/components/menu/ItemEditor.tsx` - Printer routing UI
- `src/app/api/menu/items/[id]/modifier-groups/[groupId]/modifiers/route.ts` - API support

**Cross-Domain:** See `docs/changelogs/HARDWARE-CHANGELOG.md` for Hardware team notes
**Skill Doc:** `docs/skills/212-PER-MODIFIER-PRINT-ROUTING.md`

### Real-Time Ingredient Library (Skill 213 - Feb 2026)
Socket.io cross-terminal sync and optimistic local updates for ingredient creation.

**Problem:** Creating ingredients inline in ItemEditor required page refresh; other terminals never saw changes.

**Solution:**
- Optimistic local update: `setIngredientsLibrary(prev => [...prev, newIngredient])` for instant UI
- Socket dispatch: `dispatchIngredientLibraryUpdate()` broadcasts to location room
- Menu page listener: `socket.on('ingredient:updated')` triggers `loadMenu()` on other terminals

**Key Files:**
- `src/components/menu/ItemEditor.tsx` - `onIngredientCreated` callback
- `src/app/(admin)/menu/page.tsx` - Socket listener, `handleIngredientCreated`
- `src/lib/socket-dispatch.ts` - `dispatchIngredientLibraryUpdate()`
- `src/app/api/internal/socket/broadcast/route.ts` - `INGREDIENT_LIBRARY_UPDATE` type
- `src/app/api/ingredients/route.ts` - Fire-and-forget dispatch on POST

**Skill Doc:** `docs/skills/213-REALTIME-INGREDIENT-LIBRARY.md`

### Ingredient Verification Visibility (Skill 214 - Feb 2026)
Full verification visibility across ItemEditor — unverified badges, category warnings, recursive reverse linking.

**Features:**
- Ingredient rows show "Unverified" badge when `needsVerification: true`
- Category headers show count of unverified items within
- `ingredientToModifiers` useMemo recurses into child modifier groups for complete reverse linking

**API Change:**
- `GET /api/menu/items/[id]/ingredients` now returns `needsVerification` field

**Key Files:**
- `src/components/menu/ItemEditor.tsx` - Badge display, category warnings, recursive useMemo
- `src/app/api/menu/items/[id]/ingredients/route.ts` - Returns `needsVerification`

**Skill Doc:** `docs/skills/214-INGREDIENT-VERIFICATION-VISIBILITY.md`

### Unified Modifier Inventory Deduction (Skill 215 - Feb 2026)
Extended the inventory deduction engine so modifiers linked via Menu Builder (`Modifier.ingredientId`) now trigger inventory deductions at payment time. Previously, only legacy `ModifierInventoryLink` records were checked, causing silent inventory gaps.

**Two-Path Fallback:**
- **Path A (Primary):** `ModifierInventoryLink` — legacy manual links. Takes precedence with `continue`.
- **Path B (Fallback):** `Modifier.ingredientId → Ingredient.inventoryItemId → InventoryItem` — Menu Builder links.

**Functions Updated (9 changes across 3 functions + PMIX):**
- `deductInventoryForOrder()` — include tree, "NO" detection, modifier loop
- `deductInventoryForVoidedItem()` — include tree, "NO" detection, modifier loop
- `calculateTheoreticalUsage()` — include tree, "NO" detection, modifier loop
- PMIX report (`/api/reports/pmix/route.ts`) — include tree, cost calculation

**Edge Cases:**
- Both paths exist → Path A wins (checked first, `continue` skips Path B)
- Prep-only ingredients (no `inventoryItemId`) → silently skipped
- `standardQuantity` null → defaults to 1
- Pre-modifier multipliers (NO=0, LITE=0.5, EXTRA=2.0) → apply to both paths

**Key Files:**
- `src/lib/inventory-calculations.ts` - Core deduction engine with fallback
- `src/app/api/reports/pmix/route.ts` - Food cost calculation with fallback

**Skill Doc:** `docs/skills/215-UNIFIED-MODIFIER-INVENTORY-DEDUCTION.md`

### Ingredient-Modifier Connection Visibility (Skill 216 - Feb 2026)
Bidirectional visibility between ingredients and the modifiers that reference them via `Modifier.ingredientId`.

**Features:**
- "Connected" badge (purple) on ingredients linked to modifiers
- Expandable details panel showing modifier name, group name, and menu items
- Dual-path menu item resolution (item-owned groups + legacy junction table)
- `linkedModifierCount` exposed in list API for badge display

**API Changes:**
- `GET /api/ingredients/[id]` — Added `linkedModifiers` include with dual-path menu item dedup via Map
- `GET /api/ingredients` — Added `_count.linkedModifiers` for badge counts

**Key Files:**
- `src/app/api/ingredients/[id]/route.ts` - Dual-path linkedModifiers query
- `src/app/api/ingredients/route.ts` - `_count.linkedModifiers` for badge count
- `src/components/ingredients/IngredientHierarchy.tsx` - Connected badge, linked panel
- `src/components/ingredients/IngredientLibrary.tsx` - `linkedModifierCount` in interface

**Skill Doc:** `docs/skills/216-INGREDIENT-MODIFIER-CONNECTION-VISIBILITY.md`

### Quick Stock Adjustment with Cost Tracking (Skill 127 - Feb 2026)
Manager-facing page for rapid inventory adjustments with full audit trail.

**Features:**
- Quick Stock Adjust page at `/inventory/quick-adjust`
- Touch-friendly +/- controls, collapsed categories
- Double verification: type "VERIFY" + employee PIN
- Staged changes (not saved until verified)
- Color-coded stock levels (critical/low/ok/good)

**New Schema: `IngredientStockAdjustment`**
- Tracks all stock changes with cost data
- `unitCost`, `totalCostImpact` captured at adjustment time
- Links to employee for accountability
- Supports types: manual, count, waste, transfer, receiving

**New API: `/api/auth/verify-pin`**
- Verifies employee PIN without full login
- Returns employee ID for attribution

**Socket Dispatch:**
- `dispatchInventoryAdjustment()` - Bulk notification
- `dispatchStockLevelChange()` - Single item changes

**Key Files:**
- `src/app/(admin)/inventory/quick-adjust/page.tsx` - Quick adjust UI
- `src/app/api/inventory/stock-adjust/route.ts` - Enhanced API
- `src/app/api/auth/verify-pin/route.ts` - PIN verification
- `src/lib/socket-dispatch.ts` - Socket functions

### Ingredient Library Refactor (Skill 204 - Feb 2026)
Major refactor of ingredient library to improve maintainability, performance, and UX.

**Component Size Reduction:**
- Main component: **1,091 → 419 lines (61% smaller)**
- Logic extracted to `useIngredientLibrary` hook (487 lines)
- UI split into `BulkActionBar` (108 lines) and `DeletedItemsPanel` (225 lines)

**Performance Improvements:**
- Race protection with `loadRequestIdRef` prevents stale data
- Debounced search (300ms) reduces re-renders by ~80%
- Bulk API endpoint (`bulk-parent`) reduces N calls → 1 (90% reduction)
- Separate static vs dynamic data loading (~70% reduction in reloads)

**UX Enhancements:**
- "Restore to Previous Location" quick button (⏮️)
- Two-step wizard for custom restore
- Auto-clear selection after mutations
- Consistent toast notifications (replaced all `alert()` calls)

**Accessibility:**
- `aria-label` on all inputs and buttons
- `aria-checked="mixed"` on indeterminate checkboxes
- `aria-pressed` on toggle buttons
- `aria-expanded` on collapsible panels

**Key Files:**
- `src/hooks/useIngredientLibrary.ts` - All business logic
- `src/hooks/useDebounce.ts` - Search debouncing
- `src/components/ingredients/BulkActionBar.tsx` - Bulk operations UI
- `src/components/ingredients/DeletedItemsPanel.tsx` - Restore workflow
- `src/app/api/ingredients/bulk-parent/route.ts` - Bulk move endpoint

**Skill Doc:** `docs/skills/204-INGREDIENT-LIBRARY-REFACTOR.md`

### Ingredient Component Improvements (Skill 205 - Feb 2026)
Component-specific enhancements for PrepItemEditor, InventoryItemEditor, and IngredientHierarchy.

**Shared Cost Hook:**
- Created `useIngredientCost` hook (83 lines)
- Eliminates 45 lines of duplicate logic in PrepItemEditor
- Consistent cost calculation across components

**Recipe Cost Aggregation:**
- New `/api/ingredients/[id]/recipe-cost` endpoint
- Reduces N fetches → 1 fetch (90% reduction for 10-component recipes)
- Server-side calculation for accuracy

**Hierarchy Caching:**
- Created `useHierarchyCache` hook with 5-minute TTL
- Instant expansion for recently-viewed items
- Reduces unnecessary API calls by ~85%

**Error Handling:**
- Recipe component updates now rollback on failure
- Optimistic UI updates with automatic recovery
- User never sees broken state

**Accessibility:**
- Added `aria-label` to all numeric inputs
- Screen reader friendly

**Key Files:**
- `src/hooks/useIngredientCost.ts` - Shared cost calculation
- `src/hooks/useHierarchyCache.ts` - LRU cache with TTL
- `src/app/api/ingredients/[id]/recipe-cost/route.ts` - Aggregated cost API
- `src/components/ingredients/PrepItemEditor.tsx` - Uses shared hook
- `src/components/ingredients/InventoryItemEditor.tsx` - Aggregated API + error handling
- `src/components/ingredients/IngredientHierarchy.tsx` - Caching integration

**Skill Doc:** `docs/skills/205-INGREDIENT-COMPONENT-IMPROVEMENTS.md`

### Explicit Input → Output Model (Skill 126 - Feb 2026)
Major enhancement to prep item tracking with explicit input/output transformation model.

**The Problem (Before):**
- Simple `portionSize` implied 1:1 relationship
- No way to capture bulk-to-bulk transformations (6 oz raw → 2 oz cooked)
- Manual yield calculations

**The Solution (After):**
Explicit Input → Output model with auto-calculated yield and cost:
```
INPUT: 6 oz of Raw Chicken
           ↓
OUTPUT: 2 oz of Shredded Chicken (33% yield, $0.75/oz)
```

**Transformation Types:**
| Type | Example |
|------|---------|
| Bulk → Bulk | 6 oz Raw Chicken → 2 oz Shredded (33% yield) |
| Bulk → Count | 1 lb Cheese → 16 slices |
| Count → Count | 1 Dough Ball → 1 Pizza Crust |

**New Schema Fields:**
```prisma
inputQuantity      Decimal?  // How much parent consumed (e.g., 6)
inputUnit          String?   // Unit for input (e.g., "oz")
outputQuantity     Decimal?  // How much produced (e.g., 2)
outputUnit         String?   // Unit for output (e.g., "oz" or "each")
recipeYieldQuantity Decimal? // For inventory items: batch yield
recipeYieldUnit    String?   // Unit for recipe yield
```

**Split Editor Architecture:**
- `IngredientEditorModal.tsx` - Thin wrapper with type selection
- `PrepItemEditor.tsx` - Input/output fields, cost preview, validation
- `InventoryItemEditor.tsx` - Delivery size, recipe management

**New Unit System (`src/lib/units.ts`):**
- 50+ units organized by category (count, weight, liquid, cooking, portion, package)
- Precision hints ('whole' vs 'decimal')
- `getUnitPrecision()`, `getSuggestedUnits()`, `areUnitsCompatible()`

**New Conversion System (`src/lib/unit-conversions.ts`):**
- Weight conversions (oz, lb, g, kg → grams base)
- Volume conversions (ml, cups, gallons, etc. → ml base)
- `convert()`, `calculateYield()`, `calculateCostPerOutputUnit()`

**Cost API:** `GET /api/ingredients/[id]/cost`
- Returns `costPerUnit`, `costUnit`, `costSource` (parent/recipe/purchase)

**Hierarchy API:** `GET /api/ingredients/[id]/hierarchy`
- Returns full hierarchy: inventoryItem, recipeIngredients[], prepItems[]

**HierarchyView Component** (`src/components/ingredients/HierarchyView.tsx`):
- Tree view: Inventory item with recipe ingredients above, prep items below
- Details panel: Shows transformation, stock levels, daily count settings
- Stock badges: Color-coded (green/yellow/red) based on thresholds
- Actions: Add prep item, edit item, generate usage report (future)

**Key Files:**
- `src/lib/units.ts` - Unit definitions and helpers
- `src/lib/unit-conversions.ts` - Conversion functions
- `src/components/ingredients/PrepItemEditor.tsx` - Prep item editor
- `src/components/ingredients/InventoryItemEditor.tsx` - Inventory editor
- `src/app/api/ingredients/[id]/cost/route.ts` - Cost calculation API

### Ingredient Library Enhancements (Feb 2026)
UX improvements to the Food Inventory (`/ingredients`) page.

**Hierarchy View Checkbox Selection:**
- Added checkbox selection to hierarchy view (was only available in list view)
- Category-level "Select All" with indeterminate state for partial selections
- Recursive ID collection for nested prep items under base ingredients
- Changed default view from 'list' to 'hierarchy'

**Key Files:**
- `src/components/ingredients/IngredientHierarchy.tsx` - Checkbox selection support
- `src/components/ingredients/IngredientLibrary.tsx` - Default view, checkbox props

**API Fields Used:**
- `Ingredient.isDailyCountItem` - Include in morning prep count
- `Ingredient.inputQuantity/inputUnit` - Input transformation
- `Ingredient.outputQuantity/outputUnit` - Output transformation

### FloorPlanHome Stale Closure & Position Restoration Fixes (Feb 2026)
Fixed intermittent seat count display issues and race conditions when combining tables.

**Root Cause:**
Multiple useCallback hooks in `FloorPlanHome.tsx` were capturing stale `tables` state in their closures. When tables were combined and data refreshed, callbacks still referenced old data, causing:
- Incorrect seat counts (e.g., showing 5 seats instead of 13 for combined 8+5 tables)
- Stale position data being sent to combine API

**Solution - tablesRef Pattern:**
```typescript
// Create a ref that always points to latest tables data
const tablesRef = useRef(tables)
tablesRef.current = tables

// In useCallback functions, use tablesRef.current instead of tables
const handleTableCombine = useCallback(async (...) => {
  const allTablesData = tablesRef.current.map(t => ({...}))  // Always fresh
  // ...
}, [locationId, employeeId])  // No 'tables' in deps - using ref instead
```

**Callbacks Fixed:**
| Callback | Issue | Fix |
|----------|-------|-----|
| `handleTableCombine` | Stale position data sent to API | Use `tablesRef.current.map()` |
| `handleConfirmVirtualCombine` | Stale virtual group status | Use `tablesRef.current.find()` |
| `handleSeatTap` | Stale combined table detection | Use `tablesRef.current.find()` |
| `handlePointerMove` | Stale hit detection during drag | Use `for (const t of tablesRef.current)` |
| `handleResetToDefault` | Data not awaited before UI update | Added `await loadFloorPlanData()` |

**Key Files:**
- `src/components/floor-plan/FloorPlanHome.tsx` - All stale closure fixes

**When to Use This Pattern:**
Use `tablesRef.current` (or similar refs) instead of state in `useCallback` when:
1. The callback is frequently recreated due to state changes
2. You need the latest state value at execution time, not closure time
3. The callback makes API calls or calculates based on current state

### Menu Builder - Item-Owned Modifier Groups with Child Modifiers (Skill 123)
Single-screen menu builder where all modifier groups are **item-owned** (not shared between items).

**Architecture:**
- Left Panel: Hierarchy tree showing items and nested structure
- Center Panel: ItemEditor for quick item details with compact group display
- Right Panel: ModifiersPanel for detailed modifier group editing

**Child Modifier Groups (Unlimited Depth):**
```
MenuItem
  └─ ModifierGroup (menuItemId = item.id)
       └─ Modifier
            └─ childModifierGroup → ModifierGroup (also item-owned)
                 └─ Modifier → childModifierGroup → ...
```

**Key Features:**
- Click [+] on any modifier to create child group
- Recursive rendering in ModifiersPanel with indentation
- Pre-modifier toggles: No, Lite, Extra on each modifier
- Ingredient linking for inventory tracking
- Legacy shared groups fully removed (Skill 210 cleanup completed)

**API Changes:**
- `GET /api/menu/items/[id]/modifier-groups` - Returns nested child groups recursively
- `POST /api/menu/items/[id]/modifier-groups` - New `parentModifierId` field for child groups

**Key Files:**
- `src/components/menu-builder/ModifiersPanel.tsx` - Full group editor with recursive modifiers
- `src/components/menu-builder/ItemEditor.tsx` - Compact group display
- `src/app/api/menu/items/[id]/modifier-groups/route.ts` - Nested group support

**Skill Doc:** `docs/skills/123-MENU-BUILDER-CHILD-MODIFIERS.md`

### Remote Void Approval via SMS (Skill 122)
SMS-based manager approval for voids/comps when no manager is present:

**Flow:**
1. Server opens CompVoidModal → Selects action → Enters reason
2. Clicks "Request Remote Manager Approval"
3. Selects manager from dropdown (managers with void permission + phone)
4. SMS sent to manager with void details + approval link
5. Manager approves via SMS reply ("YES") or mobile web page
6. 6-digit approval code generated (5-min expiry)
7. Code auto-fills on POS via socket → Void completes

**Components:**
- `RemoteVoidApprovalModal` - POS modal for requesting approval
- `/approve-void/[token]` - Mobile-friendly approval page
- `CompVoidModal` - Added "Request Remote Manager Approval" button

**API Endpoints:**
- `GET /api/voids/remote-approval/managers` - List managers with phone
- `POST /api/voids/remote-approval/request` - Create request + send SMS
- `GET /api/voids/remote-approval/[id]/status` - Poll status
- `POST /api/voids/remote-approval/validate-code` - Validate 6-digit code
- `POST /api/webhooks/twilio/sms` - Twilio webhook for SMS replies
- `GET/POST /api/voids/remote-approval/[token]/*` - Web approval endpoints

**Twilio Integration:**
- `src/lib/twilio.ts` - SMS sending, signature validation, code generation
- Requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` env vars

**Socket Events:**
- `void:approval-update` - Notifies POS when manager approves/rejects
- `dispatchVoidApprovalUpdate()` in `src/lib/socket-dispatch.ts`

### Spirit Tier Admin Management (Skill 118)
Admin UI for configuring spirit upgrade groups in `/modifiers`:

**Features:**
- "Spirit Upgrade Group" toggle on modifier groups
- Per-modifier tier assignment: Well, Call, Premium, Top Shelf
- Visual tier badges with color coding
- API returns `isSpiritGroup` and `spiritTier` fields

### BartenderView Personalization (Skill 119)
Enhanced customization for bartender POS interface:

**Quick Selection:**
- Spirit tier buttons (Call | Prem | Top) on cocktail items
- Pour size buttons (Shot | Dbl | Tall | Shrt) on liquor items
- One-tap upgrade without full modifier modal

**Item Effects:**
- Font styles: normal, bold, italic, boldItalic
- Font families: default, rounded, mono, serif, handwritten
- Animations: pulse, shimmer, rainbow, neon
- Glow and border color customization

**Settings:**
- Scrolling vs pagination toggle for items
- Per-employee localStorage persistence
- Long-press Items button to access settings

### POS Personalization - Category & Menu Item Customization
Each employee can personalize their POS interface with custom colors and effects:

**Category Button Colors** (per employee, per category):
- Custom selected background color
- Custom selected text color
- Custom unselected background color (makes buttons pop!)
- Custom unselected text color
- Access via gear icon → "Reorder Categories" → click paint icon on any category

**Menu Item Styling** (per employee, per item):
- Custom background color
- Custom text color
- Pop effects: Glow, Larger, Border, or "All" (maximum pop!)
- Custom glow/border color
- Access via gear icon → "Customize Item Colors" → click paint icon on any item

**Settings Location**:
- Stored in `Employee.posLayoutSettings` JSON field
- `categoryColors: { [categoryId]: CategoryColorOverride }`
- `menuItemColors: { [menuItemId]: MenuItemCustomization }`

**Reset Options** (in gear dropdown):
- "Reset All Category Colors" - clears all category customizations
- "Reset All Item Styles" - clears all menu item customizations

### Glassmorphism UI Overhaul
- Modern glass effect throughout POS interface
- Frosted glass panels with backdrop blur
- Soft gradients based on Bar/Food mode
- Blue theme for Bar mode, Orange theme for Food mode
- Smooth hover animations and transitions

### Modifier Types Enhancement
- Changed from single `modifierType` string to `modifierTypes` JSON array
- Allows modifier groups to belong to multiple types
- UI uses checkboxes for multi-select

### Pour Size Configuration
- Added `pourSizes`, `defaultPourSize`, `applyPourToModifiers` to MenuItem
- Enables quick pour selection buttons for liquor items
- Multipliers automatically adjust pricing

### FloorPlanHome Integration (Jan 2026)
Major overhaul to make FloorPlanHome the primary POS interface:

**Completed:**
- FloorPlanHome is now the default view for ALL users (including bartenders)
- Inline ordering: Add items → Send to kitchen → Pay (all from floor plan)
- Created `/api/orders/[id]/send` route for sending orders to kitchen
- Created `POST /api/orders/[id]/items` for atomic item append (race condition fix)
- Fixed order loading from Open Orders panel (`orderToLoad` prop)
- Fixed PaymentModal React hooks violation (useState after early returns)
- Fixed race condition in order item updates (PUT replaced → POST appends)
- Added ReceiptModal after payment in floor-plan view
- Auto-clear order panel after receipt close (`paidOrderId` flow)
- Fixed CSS borderColor/border conflict in CategoriesBar
- Timed rental items display with duration badge and session info
- Entertainment session timers start on "Send to Kitchen"

**Key Props for FloorPlanHome:**
- `orderToLoad` / `onOrderLoaded` - Load existing order for editing
- `paidOrderId` / `onPaidOrderCleared` - Clear order after payment complete
- `onOpenPayment` - Callback to open PaymentModal
- `onOpenModifiers` - Callback to open ModifierModal
- `onOpenTimedRental` - Callback for entertainment item session selection
- `onOpenPizzaBuilder` - Callback for pizza item customization

**Payment Flow:**
1. User clicks Pay → `onOpenPayment(orderId)` called
2. PaymentModal opens, fetches order if total=0
3. Payment processed → `onPaymentComplete` shows ReceiptModal
4. Receipt closed → `paidOrderId` set → FloorPlanHome clears order → returns to floor plan

### Entertainment Floor Plan Integration (Feb 2026)
Entertainment menu items can now be placed directly on the floor plan builder:

**Features:**
- Place entertainment items (pool tables, dart boards, etc.) on the floor plan
- Each menu item can only be placed once (multiple pool tables = multiple menu items)
- 12 visual SVG types: pool_table, dartboard, arcade, foosball, shuffleboard, ping_pong, bowling_lane, karaoke_stage, dj_booth, photo_booth, vr_station, game_table
- Visual-only rotation (label stays horizontal for readability)
- Extended rotation handle (40px stem) for easier grabbing with 15° snap
- Status-based glow effects (available=green, in_use=amber, reserved=indigo, maintenance=red)
- Time remaining badge for active sessions
- Waitlist count badge

**Key Components:**
- `FloorPlanElement` model - Stores element position, size, rotation, linked menu item
- `AddEntertainmentPalette` - Bottom sheet for selecting and placing items
- `FloorPlanEntertainment` - Renders element with resize/rotate handles
- `entertainment-visuals.tsx` - SVG components for each visual type

**API Endpoints:**
- `GET /api/floor-plan-elements?locationId=` - List elements
- `POST /api/floor-plan-elements` - Create element
- `PUT /api/floor-plan-elements/[id]` - Update position/size/rotation
- `DELETE /api/floor-plan-elements/[id]` - Soft delete (returns item to available pool)

**Usage:**
1. Create entertainment items in Menu Builder with category type "entertainment"
2. Open Floor Plan → Click "Add Entertainment"
3. Select menu item → Choose visual style → Add to floor plan
4. Drag to position, use corner handles to resize, use top handle to rotate

## Upcoming Work (TODO)

> **See also:** `/docs/PM-TASK-BOARD.md` for the cross-domain task board with granular tasks assigned to specific PMs.

### Priority 1: POS Front-End Ordering UI Lift
The POS ordering experience needs a comprehensive UI overhaul. **Assigned to: PM: Menu**
- [ ] ModifierModal flow redesign — better navigation through modifier groups, stacking, child groups
- [ ] Item selection UX — category/item grid layout, touch target sizing, visual hierarchy
- [ ] Order summary panel polish — item display, modifier depth formatting, quantity controls
- [ ] Glassmorphism consistency — ensure dark glass theme is uniform across all POS order screens
- [ ] Pre-modifier (No/Lite/Extra) interaction — clear visual feedback, easy toggle
- [ ] Spirit tier quick-select polish — Call/Prem/Top buttons on cocktails
- [ ] Pour size selector polish — Shot/Dbl/Tall/Shrt on liquor items
- [ ] Combo step flow UX — step progress, back navigation, clear completion state
- [ ] Mobile/tablet responsive touch targets — ensure all buttons are touch-friendly on iPad
- [ ] Animation/transition cleanup — smooth, consistent, no jank

### Priority 2: Bar Tabs Screen
The tabs panel needs work for bartender workflow:
- [ ] Improve tab list UI in OpenOrdersPanel
- [ ] Quick tab creation from floor plan
- [ ] Pre-auth card capture for tabs
- [ ] Tab transfer between employees
- [ ] Tab merge functionality

### Priority 3: Closed Orders Management
Need ability to view and manage closed/paid orders:
- [ ] Closed orders list view with search/filter
- [ ] View closed order details
- [ ] Void payments on closed orders (manager approval)
- [ ] Adjust tips after close
- [ ] Reprint receipts
- [ ] Reopen closed orders (with reason)

### Priority 4: Kitchen/Print Integration
- [ ] Actually send tickets to printers (currently just TODO in send route)
- [x] Kitchen display updates via WebSocket (Socket.io implemented - see `src/lib/socket-server.ts`)
- [ ] Print route configuration
- [ ] PrintTemplateFactory for template-based ticket generation

### Priority 5: Tip Guide Basis Configuration
Servers are tipped less when discounts/promos/gift cards are applied because tip suggestions are based on net total.
- [ ] Add `tipGuideSettings` to Location (basis: net_total | pre_discount | gross_subtotal | custom)
- [ ] Create tip calculation function that respects settings
- [ ] Add settings UI at `/settings/tips`
- [ ] Update PaymentModal and Receipt to show tips on correct basis
- [ ] Show explanation text: "(on $X pre-discount)"
- **Spec:** `docs/features/tip-guide-basis.md`

### Priority 6: Inventory System Refinements
- [ ] **Unify Liquor + Food Inventory Engines**: Currently `processLiquorInventory()` (for BottleProduct/RecipeIngredient)
      runs separately from `deductInventoryForOrder()` (for MenuItemRecipe/ModifierInventoryLink).
      Migrate liquor cocktail recipes into the unified MenuItemRecipe structure so one order = one deduction pass.
      This reduces risk of one engine failing while the other succeeds.
- [ ] Inventory UI Pages: Dashboard, item management, transaction history, variance reports
- [ ] Low stock alerts and reorder point notifications
- [ ] Vendor purchase order integration

### Priority 7: Tag-Based Routing Completion
- [x] Station model with tag-based pub/sub routing
- [x] OrderRouter with primaryItems/referenceItems separation
- [x] Socket.io real-time KDS updates
- [ ] PrintTemplateFactory for PIZZA_STATION, EXPO_SUMMARY, etc.
- [ ] PitBossDashboard for entertainment expo
- [ ] Migration script testing (`scripts/migrate-routing.ts`)

### Priority 8: Ingredient System Enhancements
- [x] **Checkbox Selection in Hierarchy View**: Added checkbox multi-select to hierarchy view
  - [x] Checkboxes on each ingredient row (base + child prep items)
  - [x] Category-level "Select All" with indeterminate state
  - [x] Recursive ID collection for nested ingredients
  - [ ] Bulk "Move to Category" action for selected items
- [ ] **Remove Customization Options from Ingredient Admin**: The Allow No/Lite/Extra/On Side,
      Extra Price, Multipliers, and Swap Options should NOT be configured at the ingredient level.
      These belong in the **Modifier Groups** when building items in the Item Builder.
- [ ] **Add Customization to Item Builder Modifiers**: When building out the item builder,
      ensure modifier-level customization options are available:
      - Allow No/Lite/Extra/On Side toggles
      - Extra price upcharge
      - Lite/Extra multipliers for inventory
      - Swap group configuration
      (Some of this may already exist in ModifierGroup/Modifier models)

### Priority 9: Table Capacity/Seats Sync (Database Integrity)
The `Table.capacity` column can drift from actual `Seat` count if updated via direct DB edit or third-party API.
This caused the "8 seats for two 4-tops" bug and can recur without proper safeguards.

**Recommended Solutions (choose one):**
- [ ] **PostgreSQL Trigger (Production)**: Create a trigger that updates `Table.capacity` whenever seats are inserted/deleted
  ```sql
  CREATE OR REPLACE FUNCTION sync_table_capacity()
  RETURNS TRIGGER AS $$
  BEGIN
    UPDATE "Table" SET capacity = (SELECT COUNT(*) FROM "Seat" WHERE "tableId" = COALESCE(NEW."tableId", OLD."tableId"))
    WHERE id = COALESCE(NEW."tableId", OLD."tableId");
    RETURN NULL;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER update_table_capacity
  AFTER INSERT OR DELETE ON "Seat"
  FOR EACH ROW EXECUTE FUNCTION sync_table_capacity();
  ```
- [ ] **Prisma Middleware**: Add middleware in `src/lib/db.ts` to intercept Seat create/delete and update Table.capacity
- [ ] **API Wrapper**: Ensure all `/api/tables/[id]/seats` endpoints call a `syncTableCapacity(tableId)` helper after seat operations
- [ ] **Remove Column (Breaking)**: Delete `capacity` column entirely and always derive from `seats.length` (requires migration + code updates)

**Until implemented**: Application code must always derive capacity from `seats.length`, never trust `Table.capacity` directly.

## Toast Notification System

App-wide toast notifications for user feedback on actions and errors.

**Usage:**
```typescript
import { toast } from '@/stores/toast-store'

// Show notifications
toast.success('Order saved successfully')
toast.error('Failed to connect to printer')
toast.warning('Maximum selections reached')
toast.info('Tip: Double-tap for 2x')

// Optional custom duration (ms)
toast.error('Connection lost', 8000)
```

**Key Files:**
- `src/stores/toast-store.ts` - Zustand store with toast methods
- `src/components/ui/ToastContainer.tsx` - Display component (bottom-right)

**Behavior:**
- Auto-dismiss after 5s (success/info) or 7s (error/warning)
- Click to dismiss early
- Stacks multiple toasts vertically
- Color-coded by type (green/red/yellow/blue)

## Pre-Launch Test Checklist

> **MANDATORY:** This checklist must be maintained and reviewed during every PM EOD session.
> New tests are added as features are built. Nothing ships until all tests pass.
> Mark tests with date completed when verified on live POS.

### How to Use This Checklist
1. PM adds new test items as features are completed during sessions
2. During EOD, PM reviews this list and adds any tests from the day's work
3. Before go-live, every item must have a completion date
4. Tests marked ❌ are known failures — must be resolved before launch

---

### 1. Order Flow & Payment

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 1.1 | Create dine-in order, add items, send to kitchen | Open table → add items → Send → verify KDS shows ticket | ⬜ |
| 1.2 | Create bar tab order | Bar Tab → enter name → add items → Send | ⬜ |
| 1.3 | Create takeout order | Takeout → add items → verify payment required before send | ⬜ |
| 1.4 | Pay with cash (exact) | Add items → Pay → Cash → enter exact amount → verify receipt | ⬜ |
| 1.5 | Pay with cash (change due) | Pay with more than total → verify change displayed | ⬜ |
| 1.6 | Pay with card | Add items → Pay → Card → verify payment completes | ⬜ |
| 1.7 | Split payment (even split) | Pay → Split → Even → 2 ways → verify both payments | ⬜ |
| 1.8 | Split payment (by item) | Pay → Split → By Item → assign items → verify amounts | ⬜ |
| 1.9 | Apply discount (%) | Add items → Discount → percentage → verify total adjusts | ⬜ |
| 1.10 | Apply discount ($) | Add items → Discount → dollar amount → verify total | ⬜ |
| 1.11 | Void item (manager approval) | Add item → void → enter reason → manager PIN → verify removed | ⬜ |
| 1.12 | Comp item (manager approval) | Add item → comp → reason → manager PIN → verify $0 | ⬜ |
| 1.13 | Remote void approval via SMS | Void → Request Remote → select manager → verify SMS + code | ⬜ |
| 1.14 | Add tip on payment | Pay → add tip amount → verify tip recorded | ⬜ |
| 1.15 | Receipt displays correctly | Pay → view receipt → verify items, totals, tip, tax | ⬜ |
| 1.16 | Order auto-clears after payment | Pay → close receipt → verify floor plan returns to clean state | ⬜ |

### 2. Modifiers & Menu Builder

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 2.1 | Add modifier to item | Select item → modifier modal → select modifier → verify on order | ⬜ |
| 2.2 | Pre-modifiers (No/Lite/Extra) | Select modifier → tap No/Lite/Extra → verify prefix on order | ⬜ |
| 2.3 | Stacked modifiers (2x) | Enable stacking → tap same modifier twice → verify 2x badge | ⬜ |
| 2.4 | Child modifier groups (nested) | Select modifier with child group → navigate to child → select → verify depth display | ⬜ |
| 2.5 | Modifier with ingredient link | In Menu Builder: link modifier to ingredient → verify connection badge in /ingredients | ⬜ |
| 2.6 | Spirit tier upgrades (quick select) | On cocktail: tap Call/Prem/Top → verify spirit upgrade applied | ⬜ |
| 2.7 | Pour size selection | On liquor item: tap Shot/Dbl/Tall → verify price multiplier | ⬜ |
| 2.8 | Combo step flow | Select combo → step through components → verify all selections | ⬜ |
| 2.9 | Modifier cascade delete | Menu Builder → delete group with children → verify preview → confirm → all deleted | ⬜ |
| 2.10 | Online modifier override | Set modifier group showOnline=false → verify hidden on online channel query | ⬜ |

### 3. Inventory Deduction (CRITICAL)

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 3.1 | Base recipe deduction on payment | Order item with recipe → pay → check InventoryItem.currentStock decreased | ⬜ |
| 3.2 | Modifier deduction via ModifierInventoryLink (Path A) | Order + modifier with inventoryLink → pay → verify stock decreased | ⬜ |
| 3.3 | Modifier deduction via ingredientId fallback (Path B) | Order + modifier with ingredientId (e.g. Ranch) → pay → verify stock decreased by standardQuantity | ⬜ |
| 3.4 | "Extra" modifier = 2x deduction | Order + "Extra Ranch" → pay → verify 2× standardQuantity deducted (3.0 oz) | ⬜ |
| 3.5 | "No" modifier = 0x deduction + base skip | Order item with base Ranch + "No Ranch" → pay → verify Ranch NOT deducted | ⬜ |
| 3.6 | "Lite" modifier = 0.5x deduction | Order + "Lite" modifier → pay → verify half-quantity deducted | ⬜ |
| 3.7 | Path A takes precedence over Path B | Modifier has BOTH inventoryLink AND ingredientId → verify only inventoryLink quantity used | ⬜ |
| 3.8 | Void item deduction (waste) | Send item → void (kitchen error) → verify waste transaction created | ⬜ |
| 3.9 | Void item NO deduction (not made) | Void before send → verify NO waste transaction | ⬜ |
| 3.10 | InventoryItemTransaction created | After payment → check DB for transaction with type='sale', correct qty | ⬜ |
| 3.11 | Theoretical usage calculation | Run AvT report → verify modifier ingredient path included | ⬜ |
| 3.12 | PMIX food cost includes modifier ingredients | Run PMIX → verify modifier cost from ingredient path shows in food cost % | ⬜ |
| 3.13 | Prep stock deduction at send-to-kitchen | Send order with prep items → verify prepStock decreased | ⬜ |
| 3.14 | Multiple items × modifier qty | Order 3× burger each with Ranch → pay → verify 3 × 1.5 oz = 4.5 oz deducted | ⬜ |

### 4. Ingredient Library & Hierarchy

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 4.1 | Hierarchy view displays correctly | /ingredients → verify category → base → prep tree | ⬜ |
| 4.2 | "Connected" badge on linked ingredients | Ingredient with linkedModifierCount > 0 → verify purple badge | ⬜ |
| 4.3 | Expand linked modifiers panel | Click 🔗 on connected ingredient → verify modifiers + menu items shown | ⬜ |
| 4.4 | Checkbox selection in hierarchy | Select ingredients → verify count → bulk action | ⬜ |
| 4.5 | Category "Select All" with indeterminate | Select some in category → verify indeterminate checkbox on category | ⬜ |
| 4.6 | Create new base ingredient | + New → fill fields → save → verify appears in hierarchy | ⬜ |
| 4.7 | Create prep item under base | Base → Add Preparation → fill input/output → save → verify nested | ⬜ |
| 4.8 | Edit ingredient cost | Edit base → change cost → save → verify cost API returns updated | ⬜ |
| 4.9 | Soft delete ingredient | Delete → verify disappears from list → verify deletedAt set (not hard deleted) | ⬜ |
| 4.10 | Restore deleted ingredient | Deleted panel → restore → verify returns to correct category | ⬜ |
| 4.11 | "Unverified" badge on new ingredients | Create via Menu Builder → verify red Unverified badge in /ingredients | ⬜ |
| 4.12 | Verify ingredient clears badge | Click verify button → confirm → verify badge removed | ⬜ |
| 4.13 | Quick stock adjust | /inventory/quick-adjust → adjust stock → type VERIFY → enter PIN → verify saved | ⬜ |
| 4.14 | Recipe cost aggregation | Base ingredient with recipe → expand → verify total cost shown | ⬜ |
| 4.15 | Debounced search | Type in search → verify no flicker → results appear after 300ms pause | ⬜ |

### 5. Floor Plan & Tables

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 5.1 | Floor plan loads with tables | Navigate to /orders → verify floor plan renders with tables | ⬜ |
| 5.2 | Tap table to start order | Tap available table → verify order panel opens | ⬜ |
| 5.3 | Table status colors | Available=green, occupied=blue, reserved=purple, dirty=yellow | ⬜ |
| 5.4 | Virtual combine tables | Long-press two tables → combine → verify seats renumber | ⬜ |
| 5.5 | Split combined tables | Combined table → split → verify tables separate | ⬜ |
| 5.6 | Table resize and rotation | Floor Plan Editor → drag handles → verify resize + rotation | ⬜ |
| 5.7 | Entertainment items on floor plan | Add entertainment → place on floor plan → verify status glow | ⬜ |
| 5.8 | Seat count correct after combine | Combine 4-top + 5-top → verify 9 seats shown (not stale) | ⬜ |

### 6. KDS & Kitchen

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 6.1 | KDS receives orders | Send order → verify ticket appears on /kds | ⬜ |
| 6.2 | Bump item on KDS | Tap item on KDS → verify bumped/marked done | ⬜ |
| 6.3 | KDS device pairing | Generate code → enter on device → verify paired + cookie set | ⬜ |
| 6.4 | Modifier depth display | Order with nested modifiers → verify KDS shows "- Mod" / "-- Child" | ⬜ |
| 6.5 | Course firing | Multi-course order → fire courses in sequence → verify KDS updates | ⬜ |
| 6.6 | Entertainment KDS dashboard | /kds/entertainment → verify active sessions + timers | ⬜ |

### 7. Tipping & Tip Shares

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 7.1 | Tip-out rules applied at shift close | Server closes shift → verify auto tip-out to busser | ⬜ |
| 7.2 | Tip share report shows correct amounts | /reports/tip-shares → verify amounts match rules | ⬜ |
| 7.3 | Mark tip shares as paid | Tip share report → mark paid → verify status updates | ⬜ |
| 7.4 | Daily store report includes tips | /reports/daily → verify tip section present | ⬜ |

### 8. Employee & Auth

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 8.1 | PIN login works | /login → enter PIN → verify correct employee logged in | ⬜ |
| 8.2 | Permission enforcement | Server tries manager action → verify denied | ⬜ |
| 8.3 | Clock in/out | Clock in → verify time recorded → clock out → verify shift | ⬜ |
| 8.4 | Break tracking | Start break → end break → verify duration recorded | ⬜ |
| 8.5 | Shift close with cash count | Close shift → enter cash count → verify variance calculated | ⬜ |

### 9. Reports

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 9.1 | Daily store report generates | /reports/daily → select date → verify all sections populate | ⬜ |
| 9.2 | Sales by category report | /reports → sales → verify category breakdown | ⬜ |
| 9.3 | PMIX report with food cost | /reports/pmix → verify food cost % includes modifier ingredient costs | ⬜ |
| 9.4 | Void report accuracy | Void items → run void report → verify all voids shown | ⬜ |
| 9.5 | Employee shift report | /reports/shift → verify hours, tips earned vs received | ⬜ |

### 10. Entertainment & Timed Rentals

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 10.1 | Start timed session | Select entertainment item → send → verify timer starts | ⬜ |
| 10.2 | Extend session | Active session → extend → verify new expiry | ⬜ |
| 10.3 | Stop and bill | Stop session → verify final billing calculated | ⬜ |
| 10.4 | Block time mode | Set block time 60min → start → verify countdown | ⬜ |
| 10.5 | Per-minute billing | Set per-minute → start → stop after 15min → verify charge | ⬜ |

### 11. Printing & Hardware

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 11.1 | Receipt prints correctly | Pay order → print receipt → verify formatting | ⬜ |
| 11.2 | Kitchen ticket routes correctly | Send order → verify ticket goes to correct printer/KDS | ⬜ |
| 11.3 | Print route priority | Item printer > category printer > default → verify routing | ⬜ |
| 11.4 | Per-modifier print routing | Modifier with custom routing → verify follows setting | ⬜ |
| 11.5 | Backup printer failover | Primary offline → verify ticket goes to backup | ⬜ |

### 12. UI & Personalization

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 12.1 | Glassmorphism renders | Verify frosted glass panels throughout POS | ⬜ |
| 12.2 | Bar/Food mode theme switch | Switch between bar and food → verify blue/orange themes | ⬜ |
| 12.3 | Category color customization | Gear → Reorder Categories → paint icon → set color → verify | ⬜ |
| 12.4 | Menu item style customization | Gear → Customize Item Colors → set glow/border → verify | ⬜ |
| 12.5 | Reset all customizations | Gear → Reset All → verify defaults restored | ⬜ |
| 12.6 | Toast notifications display | Perform action → verify toast appears bottom-right | ⬜ |

---

### Test Status Legend
- ⬜ = Not tested yet
- ✅ YYYY-MM-DD = Passed (with date)
- ❌ YYYY-MM-DD = Failed (with date — must resolve before launch)
- 🔄 = In progress / partially tested

## Troubleshooting

### Database Issues
```bash
# Reset entire database
npm run reset

# Check database in browser
npm run db:studio
```

### Build Errors
```bash
# Regenerate Prisma client
npx prisma generate

# Check types
npx tsc --noEmit
```

### Server Already Running
If port 3000 is in use, the dev server will auto-select another port (usually 3001).

## Worker Prompt Structure (MANDATORY)

When working with multiple Claude instances (workers), prompts MUST follow this structure to ensure clean code boundaries and prevent scope creep.

### Project Manager Role

The **Project Manager** (PM) Claude instance:
- **DOES NOT write code** - only creates prompts for workers
- Reviews the current code state BEFORE writing any prompts
- Ensures each worker stays within their assigned files/scope
- Reviews worker output for quality and boundary violations

### Worker Prompt Template

Every worker prompt MUST include these sections:

```markdown
You are a DEVELOPER [fixing/building/cleaning] [specific task] in GWI POS [Domain Name].

## Context / Your Previous Work
[What the worker built before, if applicable]

## Problem / Task Description
[Clear description of what needs to be done]
[Symptoms if it's a bug fix]

## Files to Modify
[EXPLICIT list of files - workers can ONLY touch these files]

═══════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY MODIFY THESE FILES
═══════════════════════════════════════════════════════════════════

## Changes Required
[Specific changes with line numbers when possible]
[DELETE vs KEEP sections for clarity]

## Acceptance Criteria
- [ ] Checkbox list of what success looks like
- [ ] Testable conditions

## Limitations
- ONLY modify [specific files]
- Do NOT create new files (unless specified)
- Do NOT touch [related but out-of-scope areas]
```

### PM Mode Trigger

To start a session as Project Manager, say:

```
PM Mode: [Domain Name]
```

**Examples:**
- `PM Mode: Floor Plan`
- `PM Mode: Inventory`
- `PM Mode: Orders`
- `PM Mode: Menu`

**What happens when you trigger PM Mode:**
1. Claude enters Project Manager mode (NO code writing)
2. Claude reads CLAUDE.md and the domain's key files
3. Claude asks: "What tasks are we working on today?"
4. You list tasks → Claude creates worker prompts
5. You send prompts to workers → paste results back for review

---

### Domain Registry

Each domain has defined paths, layers, and boundaries. When in PM Mode, Claude uses this registry to:
- Know which files belong to the domain
- Understand layer separation
- Create properly scoped worker prompts

| # | Domain | Trigger | Status |
|---|--------|---------|--------|
| 1 | Floor Plan | `PM Mode: Floor Plan` | ✅ Complete |
| 2 | Inventory | `PM Mode: Inventory` | 🔄 Active |
| 3 | Orders | `PM Mode: Orders` | 🔄 Active |
| 4 | Menu | `PM Mode: Menu` | 🔄 Active |
| 5 | Employees | `PM Mode: Employees` | 🔄 Active |
| 6 | KDS | `PM Mode: KDS` | 🔄 Active |
| 7 | Payments | `PM Mode: Payments` | 🔄 Active |
| 8 | Reports | `PM Mode: Reports` | 🔄 Active |
| 9 | Hardware | `PM Mode: Hardware` | 🔄 Active |
| 10 | Settings | `PM Mode: Settings` | 🔄 Active |
| 11 | Entertainment | `PM Mode: Entertainment` | 🔄 Active |
| 12 | Guest | `PM Mode: Guest` | 🔄 Active |
| 13 | Events | `PM Mode: Events` | 🔄 Active |
| 14 | Financial | `PM Mode: Financial` | 🔄 Active |
| 15 | Development-RnD | `PM Mode: Development-RnD` | 🔄 Active |

---

#### Domain 1: Floor Plan
**Trigger:** `PM Mode: Floor Plan`
**Changelog:** `/docs/changelogs/FLOOR-PLAN-CHANGELOG.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Canvas | Floor plan rendering | `/src/domains/floor-plan/canvas/` |
| Fixtures | Non-seating elements (walls, bars, etc.) | `/src/domains/floor-plan/admin/FixtureProperties.tsx`, `/api/floor-plan-elements` |
| Tables | Table records, resize, rotation | `/api/tables`, `/api/tables/[id]`, `TableRenderer.tsx`, `TableProperties.tsx` |
| Seats | Seat records, positioning, generation | `/api/seats`, `/api/tables/[id]/seats/*`, `SeatRenderer.tsx`, `/src/lib/seat-generation.ts` |
| Virtual Groups | Combined table seat numbering | `/src/lib/virtual-group-seats.ts`, `/api/tables/virtual-combine/` |
| Sections | Rooms/areas | `/api/sections` |
| FOH View | Front-of-house display | `/src/app/test-floorplan/page.tsx`, `FloorPlanHome.tsx` |
| Editor | Admin floor plan builder | `FloorPlanEditor.tsx`, `EditorCanvas.tsx`, `FixtureToolbar.tsx` |

**Related Skills:** 16, 117, 206, 207

---

#### Domain 2: Inventory
**Trigger:** `PM Mode: Inventory`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Ingredients | Base ingredients + prep items | `/src/app/(admin)/ingredients/`, `/api/ingredients` |
| Stock | Stock levels, adjustments | `/api/inventory/stock-adjust`, `/api/inventory/settings` |
| Recipes | Menu item recipes | `/api/menu/items/[id]/recipe` |
| Deductions | Auto-deduction on sale/void | `/src/lib/inventory-calculations.ts` |
| Reports | Variance, usage reports | `/api/reports/inventory` |

---

#### Domain 3: Orders
**Trigger:** `PM Mode: Orders`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Order CRUD | Create, read, update orders | `/api/orders`, `/api/orders/[id]` |
| Order Items | Items within orders | `/api/orders/[id]/items` |
| Send to Kitchen | Kitchen ticket dispatch | `/api/orders/[id]/send` |
| Payment | Payment processing | `/api/orders/[id]/pay` |
| Void/Comp | Void and comp operations | `/api/orders/[id]/comp-void` |
| UI | Order screen components | `/src/app/(pos)/orders/`, `/src/components/orders/` |

---

#### Domain 4: Menu
**Trigger:** `PM Mode: Menu`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Categories | Menu categories | `/api/menu/categories` |
| Items | Menu items | `/api/menu/items`, `/api/menu/items/[id]` |
| Modifiers | Modifier groups and modifiers | `/api/menu/modifiers` |
| Item Modifiers | Item-to-modifier links | `/api/menu/items/[id]/modifiers` |
| UI | Menu builder components | `/src/app/(admin)/menu/`, `/src/components/menu-builder/` |

---

#### Domain 5: Employees
**Trigger:** `PM Mode: Employees`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Employee CRUD | Employee records | `/api/employees` |
| Roles | Role definitions | `/api/roles` |
| Permissions | Permission management | `/api/permissions` |
| Time Clock | Clock in/out | `/api/time-clock` |
| UI | Employee management | `/src/app/(admin)/employees/` |

---

#### Domain 6: KDS
**Trigger:** `PM Mode: KDS`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Display | KDS screen rendering | `/src/app/(kds)/kds/` |
| Tickets | Kitchen ticket management | `/api/kds/tickets` |
| Stations | Station configuration | `/api/kds/stations` |
| Device Auth | KDS device pairing | `/api/hardware/kds-screens` |

---

#### Domain 7: Payments
**Trigger:** `PM Mode: Payments`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Processing | Payment processing | `/api/payments` |
| Tips | Tip management | `/api/tips`, `/src/lib/tip-calculations.ts` |
| Receipts | Receipt generation | `/api/print/receipt` |
| UI | Payment modal | `/src/components/payments/` |

---

#### Domain 8: Reports
**Trigger:** `PM Mode: Reports`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Daily | Daily store report | `/api/reports/daily` |
| Shift | Employee shift reports | `/api/reports/employee-shift` |
| Tips | Tip share reports | `/api/reports/tip-shares` |
| Sales | Sales reports | `/api/reports/sales` |
| UI | Report pages | `/src/app/(admin)/reports/` |

---

#### Domain 9: Hardware
**Trigger:** `PM Mode: Hardware`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Printers | Printer configuration | `/api/hardware/printers` |
| Print Routes | Print routing rules | `/api/hardware/print-routes` |
| KDS Screens | KDS device management | `/api/hardware/kds-screens` |
| ESC/POS | Printer commands | `/src/lib/escpos/` |

---

#### Domain 11: Entertainment
**Trigger:** `PM Mode: Entertainment`
**Documentation:** `/docs/domains/ENTERTAINMENT-DOMAIN.md`
**Changelog:** `/docs/changelogs/ENTERTAINMENT-CHANGELOG.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Builder | Item configuration UI | `/src/app/(admin)/timed-rentals/page.tsx` |
| Status API | Status management | `/api/entertainment/status` |
| Block Time API | Session timers | `/api/entertainment/block-time` |
| Waitlist API | Queue management | `/api/entertainment/waitlist`, `/api/entertainment/waitlist/[id]` |
| KDS Dashboard | Real-time monitoring | `/src/app/(kds)/entertainment/page.tsx` |
| Floor Plan | Element placement | `/api/floor-plan-elements` (elementType='entertainment') |
| Components | UI components | `/src/components/entertainment/`, `/src/components/floor-plan/entertainment-visuals.tsx` |
| Order Controls | Session start/extend/stop | `/src/components/orders/EntertainmentSessionControls.tsx` |
| Utilities | Helper functions | `/src/lib/entertainment.ts` |

**Visual Types:** pool_table, dartboard, arcade, foosball, shuffleboard, ping_pong, bowling_lane, karaoke_stage, dj_booth, photo_booth, vr_station, game_table

**Integration Points:**
- Floor Plan Domain: Entertainment elements on canvas
- Orders Domain: Entertainment items in orders, session controls
- KDS Domain: Entertainment dashboard
- Menu Domain: Category routing to builder

---

#### Domain 15: Development-RnD
**Trigger:** `PM Mode: Development-RnD`
**Documentation:** `/docs/domains/DEVELOPMENT-RND-DOMAIN.md`
**Changelog:** `/docs/changelogs/DEVELOPMENT-RND-CHANGELOG.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| **Prototypes** | Experimental feature implementations | `/src/app/(admin)/rnd/`, `/src/components/rnd/` |
| **Research** | Technical spikes, benchmarks, POCs | `/docs/rnd/research/` |
| **Tooling** | Build tools, scripts, DX improvements | `/scripts/`, `/src/lib/dev-tools/` |
| **Architecture** | Cross-domain refactors, pattern research | `/docs/rnd/architecture/` |
| **Benchmarks** | Performance testing and comparison | `/docs/rnd/benchmarks/` |

**Graduation Pipeline:**
- Prototypes → Production Domain (when ready)
- Research → Archived (when findings documented)
- Abandoned → Documented (lessons learned)

**Key Rules:**
- RnD code must NOT ship to production (feature flags or `/rnd/` paths)
- Production code must never import from `/rnd/` paths
- Features graduate to production domains or get archived

---

### Layer Separation Rule (CRITICAL)

**A worker assigned to one layer must NOT touch code in another layer, even if it's in the same file.**

Example: If a worker is assigned to "Tables" layer:
- ✅ CAN modify table CRUD operations
- ❌ CANNOT add/modify seat code (that's the "Seats" layer)
- ❌ CANNOT modify fixture code (that's the "Fixtures" layer)

If code from another layer exists in their file, the worker should:
- REMOVE it (if that's the task)
- IGNORE it (if not relevant to their task)
- NEVER add new functionality for that layer

---

### Morning Startup Protocol

When starting a new day:

1. **Say:** `PM Mode: [Domain]`
2. **Claude responds with:**
   - Confirmation of PM mode
   - **Reads the PM Task Board** at `/docs/PM-TASK-BOARD.md` — check for tasks assigned to THIS domain
   - **Reads domain changelog** at `/docs/changelogs/[DOMAIN]-CHANGELOG.md`
   - **Reads the Pre-Launch Test Checklist** in CLAUDE.md — check for failures or untested items in this domain
   - Shows: Last session summary, pending workers, known issues
   - Shows: **Cross-domain tasks assigned to this PM** (from task board)
   - Shows: **Failing or untested tests** in this domain's categories
   - "What tasks are we working on today?"
3. **You list tasks** (or say "continue from yesterday")
4. **Claude reads relevant files** (to get accurate line numbers)
5. **Claude creates worker prompts** (following the template)
6. **You send prompts to workers**
7. **Workers return results → paste back to PM for review**

**Morning Startup Files to Check (MANDATORY — ALL of these):**
- `/docs/PM-TASK-BOARD.md` - **Cross-domain task board** (check for tasks assigned to your domain)
- `/docs/changelogs/[DOMAIN]-CHANGELOG.md` - Session history
- `/docs/skills/SKILLS-INDEX.md` - Skill status
- `CLAUDE.md` "Pre-Launch Test Checklist" section - Test status for your domain
- Domain-specific skill docs in `/docs/skills/`

---

### End of Day Protocol (EOD)

**Trigger:** Say `EOD: [Domain]` or `End of Day: [Domain]`

When you trigger EOD, Claude will:

1. **Update Domain Changelog** (`/docs/changelogs/[DOMAIN]-CHANGELOG.md`)
   - Add session date
   - List workers completed with status
   - List pending workers with prompts ready
   - Document issues discovered
   - Note architectural decisions made
   - List files created/modified

2. **Create/Update Skill Docs** (`/docs/skills/`)
   - New skills get their own numbered doc
   - Existing skills get status updates
   - Update SKILLS-INDEX.md with new entries

3. **Document Pending Work**
   - Worker prompts ready to send
   - Known issues/bugs
   - Next priority tasks

4. **Session Recovery Info**
   - "How to Resume" section in changelog
   - Key context for next session

5. **🧪 Update Pre-Launch Test Checklist (MANDATORY)**
   - Review features completed today
   - Add NEW test items for any new functionality
   - Flag any tests that can now be verified
   - Note any tests that are currently FAILING
   - Update the "Pre-Launch Test Checklist" section in CLAUDE.md
   - This is NON-NEGOTIABLE — every EOD must include test updates

6. **📋 Update Cross-Domain Task Board (MANDATORY)**
   - Open `/docs/PM-TASK-BOARD.md`
   - **Add tasks** discovered during this session that belong to OTHER domains
   - **Pick up tasks** assigned to YOUR domain → move to "In Progress"
   - **Complete tasks** you finished today → move to "Completed" with date
   - **Assign correctly**: Use the Domain PM Registry table to route tasks to the right PM
   - Tasks stay on the board until the assigned PM picks them up
   - This is NON-NEGOTIABLE — every EOD must update the task board

**EOD Output Format:**
```
## EOD Summary for [Domain] - [Date]

### Completed Today
- [x] Worker 1: Task name
- [x] Worker 2: Task name

### Pending (Prompts Ready)
- [ ] Worker 3: Task name
- [ ] Worker 4: Task name

### Issues Discovered
1. Issue description

### New Skills Documented
- Skill XXX: Name

### Tests Added/Updated
- Added: Test X.XX - [description]
- Ready to verify: Test X.XX - [description]
- FAILING: Test X.XX - [description + reason]

### Cross-Domain Tasks Added/Updated
- NEW → PM: [Domain]: T-XXX - [description]
- PICKED UP: T-XXX - [description]
- COMPLETED: T-XXX - [description]

### Files Updated
- /docs/changelogs/[DOMAIN]-CHANGELOG.md
- /docs/skills/XXX-SKILL-NAME.md
- /docs/PM-TASK-BOARD.md
- CLAUDE.md (test checklist)

### Resume Tomorrow
1. Say: `PM Mode: [Domain]`
2. Review PM Task Board for assigned tasks
3. Review changelog
4. Review test checklist for failures
5. Send pending worker prompts
```

---

### Quality Control

Before accepting worker output:

1. **Boundary check** - Did they ONLY modify allowed files?
2. **Scope check** - Did they stay within their layer?
3. **No extras** - Did they add unrequested features?
4. **Tests pass** - Does the code work?
5. **Types clean** - No TypeScript errors?

### Example: Good vs Bad Worker Prompt

**❌ BAD (vague, no boundaries):**
```
Fix the table API to not create seats.
```

**✅ GOOD (specific, bounded):**
```
You are a DEVELOPER cleaning up the Table API in GWI POS Floor Plan domain.

## Files to Modify
1. /src/app/api/tables/route.ts
2. /src/app/api/tables/[id]/route.ts

⚠️ STRICT BOUNDARY - ONLY MODIFY THESE TWO FILES

## Changes Required
DELETE: generateSeatPositions function (lines 84-157)
DELETE: skipSeatGeneration parameter
DELETE: All db.seat.* operations
KEEP: capacity field (metadata)
KEEP: seatPattern field (configuration)

## Acceptance Criteria
- [ ] POST /api/tables creates table WITHOUT seats
- [ ] No db.seat.* calls in POST or PUT handlers

## Limitations
- Do NOT create /seats routes
- Do NOT modify Seat model
```
