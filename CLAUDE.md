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

### ⚠️ IMPORTANT: Protecting Your Data

**NEVER run these commands without backing up first:**
- `npm run reset` - DELETES ALL DATA and reseeds
- `npm run db:push` - Can cause data loss if schema changes are destructive
- `npm run db:migrate` - May drop tables/columns

**ALWAYS backup before schema changes:**
```bash
npm run db:backup   # Creates timestamped backup in prisma/backups/
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
