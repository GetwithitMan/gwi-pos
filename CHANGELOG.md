# GWI POS Changelog

All notable changes to this project will be documented in this file.

---

## [2026-02-03] Session 29

### Menu/Liquor Builder Separation & Inventory Seeding (Skill 141)

Complete separation of food menu management from liquor inventory, establishing Liquor Builder as the sole source of truth for all spirits, wines, and cocktails.

**The Problem:**
- Menu page (`/menu`) was showing both food AND liquor categories
- Liquor categories appeared empty in menu management
- Confusion about where to manage spirits vs food items
- Previous restore operation created duplicate liquor items as menu items

**The Solution:**

**1. Menu Page Filtering:**
- `/menu` now filters out `categoryType: 'liquor'` and `categoryType: 'drinks'`
- Only food, pizza, entertainment, and combo categories appear in menu management
- Liquor categories no longer visible in food menu interface

**File Modified:**
- `src/app/(admin)/menu/page.tsx` - Added category type filtering at line 248

**2. Comprehensive Liquor Inventory Seeding:**
Created automated seeding script to populate Liquor Builder with complete bar inventory:

**Categories Created:**
- Whiskey (32 bottles)
- Vodka (20 bottles)
- Rum (16 bottles)
- Tequila (29 bottles)
- Gin (14 bottles)
- Cocktails (36 bottles)

**Total: 147 bottles across 6 categories**

**Tier Distribution:**
Bottles automatically assigned to spirit tiers based on sell price:
- **Well**: $0-$6 (24 bottles)
- **Call**: $6.01-$9 (59 bottles)
- **Premium**: $9.01-$13 (50 bottles)
- **Top Shelf**: $13.01+ (14 bottles)

**Script Features:**
- Checks for existing bottles to avoid duplicates
- Creates linked `InventoryItem` for each bottle (unified inventory tracking)
- Calculates pour costs, pours per bottle automatically
- Standard 750ml bottle size, 1.5oz pour
- Estimated costs: sell price × 0.25

**Files Created:**
- `scripts/seed-liquor-inventory.ts` - Seeding script for liquor builder inventory

**API Endpoints Used:**
- `POST /api/liquor/categories` - Create spirit categories
- `POST /api/liquor/bottles` - Create bottle products with inventory items

**Clear Separation:**
- **Menu (`/menu`)**: Food items only (burgers, pizzas, appetizers, etc.)
- **Liquor Builder (`/liquor-builder`)**: ALL spirits, cocktails, wines, beers
- No overlap or confusion between the two systems

**Why This Matters:**
- Prevents accidental duplicate liquor items in menu system
- Clear mental model: "Food goes in Menu, Drinks go in Liquor Builder"
- Liquor Builder has specialized features (pour sizes, recipes, spirit tiers)
- Menu builder focused on food-specific features (recipes, modifiers, combos)

**Skill Doc:** `docs/skills/141-MENU-LIQUOR-SEPARATION.md`

---

## [2026-02-02] Session 28

### Ingredient Costing & Recipe System (Skill 125)

Complete ingredient tracking system enabling full cost calculation from raw materials through menu items, including prep yields, portion sizes, and modifier adjustments.

**The Complete Tracking Flow:**
```
RAW MATERIALS (Flour, Yeast, Oil, Water)
    ↓ Recipe (IngredientRecipe model)
INVENTORY ITEM (Pizza Dough - 5 lb batch)
    ↓ Batch Yield + Yield %
PREP ITEMS (Personal Crust 8", Large Crust 14")
    ↓ Portion Size + Modifiers (Lite/Extra/No)
MENU ITEMS (Personal Pizza, Large Supreme)
```

**Schema Changes:**

1. **New Model: IngredientRecipe** - Links inventory items to their component raw materials
   - `outputId` - The item being made (e.g., Pizza Dough)
   - `componentId` - The raw material used (e.g., Flour)
   - `quantity` / `unit` - Amount needed
   - `batchSize` / `batchUnit` - For batch recipes

2. **New Ingredient Fields:**
   - `portionSize` / `portionUnit` - How much per serving
   - `batchYield` - How many prep items from one inventory unit

**API Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ingredients/[id]/recipe` | Get recipe components |
| POST | `/api/ingredients/[id]/recipe` | Add component |
| PUT | `/api/ingredients/[id]/recipe` | Update component |
| DELETE | `/api/ingredients/[id]/recipe?recipeId=X` | Remove component |

**UI Updates:**

1. **Inventory Item Editor** - New "Recipe - What makes this item?" section
   - Collapsible recipe components list
   - Dropdown to add components from available ingredients
   - Remove button per component
   - Cost calculation preview

2. **Prep Item Editor** - Complete costing fields:
   - Batch Yield (green box) - "From 1 lb of Chicken → X oz"
   - Yield % (amber box) - Cooking/prep loss with quick buttons
   - Portion Size (blue box) - How much per serving
   - Modifier Amounts (purple box) - Lite/Extra multipliers

3. **Hierarchy View:**
   - Daily count badge for prep items marked for daily counting
   - Alphabetical sorting for categories and prep items

**Files Modified:**
- `prisma/schema.prisma` - Added IngredientRecipe model, portionSize, portionUnit, batchYield
- `src/app/api/ingredients/route.ts` - Added all new fields to responses, fixed grandchildren query
- `src/app/api/ingredients/[id]/route.ts` - Added portionSize, portionUnit support
- `src/app/api/ingredients/[id]/recipe/route.ts` - NEW: Recipe CRUD
- `src/components/ingredients/IngredientEditorModal.tsx` - Complete rewrite with costing sections
- `src/components/ingredients/IngredientHierarchy.tsx` - Daily badge, alphabetical sorting

**Bug Fixes:**
- Fixed `isDailyCountItem` not appearing on prep items (missing from API response)
- Fixed `batchYield` unknown field error (Prisma client regeneration required)
- Fixed grandchildren select missing fields (portionSize, portionUnit, liteMultiplier, etc.)

**Skill Doc:** `docs/skills/125-INGREDIENT-COSTING-RECIPES.md`

---

## [2026-02-02] Session 27

### Admin Navigation Standardization (Skill 124)

Completed the admin navigation page structure reorganization, adding standardized `AdminPageHeader` and `AdminSubNav` components across all admin pages.

**Components Created:**

1. **AdminPageHeader** (`src/components/admin/AdminPageHeader.tsx`)
   - Unified page header with title, subtitle (ReactNode), breadcrumbs, back button, and actions
   - Consistent styling across all admin pages

2. **AdminSubNav** (`src/components/admin/AdminSubNav.tsx`)
   - Pre-defined sub-navigation configs: `menuSubNav`, `customersSubNav`, `teamSubNav`, `floorSubNav`
   - Responsive horizontal tab-style navigation

**Pages Updated:**

| Section | Pages |
|---------|-------|
| **Customers** | customers, gift-cards, house-accounts, coupons |
| **Team** | employees, roles, scheduling, payroll, events |
| **Floor** | tables, floor-plan, reservations |

**Files Modified:**
- `src/app/(admin)/customers/page.tsx`
- `src/app/(admin)/gift-cards/page.tsx`
- `src/app/(admin)/house-accounts/page.tsx`
- `src/app/(admin)/coupons/page.tsx`
- `src/app/(admin)/employees/page.tsx`
- `src/app/(admin)/roles/page.tsx`
- `src/app/(admin)/scheduling/page.tsx`
- `src/app/(admin)/payroll/page.tsx`
- `src/app/(admin)/events/page.tsx`
- `src/app/(admin)/tables/page.tsx`
- `src/app/(admin)/floor-plan/page.tsx`
- `src/app/(admin)/reservations/page.tsx`

**Bug Fixes:**
- Fixed AdminPageHeader subtitle prop to accept `React.ReactNode` instead of just `string`
- Fixed unclosed JSX tags in multiple pages (coupons, events, gift-cards, house-accounts, reservations)

---

### Bar Tab Button → Bar Mode (FloorPlanHome)

Changed the "Bar Tab" button in the POS floor plan interface to switch to Bar Mode instead of creating a bar tab order type.

**What Changed:**
- Renamed button from "Bar Tab" to "Bar Mode"
- Button now calls `onSwitchToBartenderView()` to switch to bartender interface
- Button is conditionally rendered only when `onSwitchToBartenderView` prop is provided

**File Modified:**
- `src/components/floor-plan/FloorPlanHome.tsx` (line ~2315)

**Rationale:**
Bar tabs are created through the normal order flow. The "Bar Tab" button was redundant and better serves the workflow by providing quick access to the specialized bartender view.

---

## [2026-02-01] Session 26

### Entertainment Floor Plan Integration (Skill 123)

Integrated entertainment menu items directly into the floor plan builder, allowing visual placement and management of timed rental equipment like pool tables, dart boards, and karaoke rooms.

**Core Features:**

1. **FloorPlanElement Model** (`prisma/schema.prisma`)
   - New model for placing entertainment items on floor plan
   - Links to MenuItem via `linkedMenuItemId` for pricing/sessions
   - Supports position, size, rotation, status, and visual customization
   - Includes waitlist relation for entertainment queuing

2. **Entertainment Visual Components** (`src/components/floor-plan/entertainment-visuals.tsx`)
   - 12 inline SVG visual types: pool_table, dartboard, arcade, foosball, shuffleboard, ping_pong, bowling_lane, karaoke_stage, dj_booth, photo_booth, vr_station, game_table
   - Status-based color theming (available=green, in_use=amber, reserved=indigo, maintenance=red)
   - Auto-detection of visual type from menu item name

3. **AddEntertainmentPalette** (`src/components/floor-plan/AddEntertainmentPalette.tsx`)
   - Bottom sheet modal for adding entertainment to floor plan
   - Filters to show only items from `categoryType: 'entertainment'`
   - One placement per menu item (prevents duplicates)
   - Two-step selection: choose item → choose visual style

4. **FloorPlanEntertainment** (`src/components/floor-plan/FloorPlanEntertainment.tsx`)
   - Renders elements on floor plan canvas
   - Visual-only rotation (label stays horizontal for readability)
   - Extended rotation handle (40px stem, 24px handle) for easier grabbing
   - 15-degree snap increments
   - Resize handles at corners
   - Status glow effects and badges (time remaining, waitlist count)

5. **API Endpoints** (`src/app/api/floor-plan-elements/`)
   - `GET /api/floor-plan-elements` - List elements with linkedMenuItem and section includes
   - `POST /api/floor-plan-elements` - Create new element with validation
   - `GET/PUT/DELETE /api/floor-plan-elements/[id]` - CRUD operations

6. **Floor Plan Store** (`src/components/floor-plan/use-floor-plan.ts`)
   - Added `elements` and `selectedElementId` state
   - Element management actions: add, update, updatePosition, updateSize, delete, select

7. **Filtering Fix**
   - Elements without room assignment (sectionId: null) now always display
   - Prevents newly placed elements from being hidden when a room is selected

**Files Created:**
- `src/components/floor-plan/entertainment-visuals.tsx`
- `src/components/floor-plan/AddEntertainmentPalette.tsx`
- `src/components/floor-plan/FloorPlanEntertainment.tsx`
- `src/app/api/floor-plan-elements/route.ts`
- `src/app/api/floor-plan-elements/[id]/route.ts`
- `docs/skills/123-ENTERTAINMENT-FLOOR-PLAN.md`

**Files Modified:**
- `prisma/schema.prisma` - FloorPlanElement model
- `src/components/floor-plan/use-floor-plan.ts` - Element state/actions
- `src/app/(admin)/floor-plan/page.tsx` - Integration with palette and rendering

**Bug Fixes:**
- Fixed Prisma client not recognizing FloorPlanElement (cleared .next and .prisma caches)
- Fixed elements not showing when room selected (updated filter to include null sectionId)

---

## [2026-01-31] Session 25

### Tag-Based Routing Engine - Finalization

Completed the unified tag-based routing system that replaces scattered `printerIds` fields with a pub/sub architecture where items publish to `routeTags` and stations subscribe to tags.

**Core Components:**

1. **OrderRouter Enhancement** (`src/lib/order-router.ts`)
   - Added `primaryItems` / `referenceItems` separation
   - Reference items show other items in order for cook context
   - "This burger is part of a larger order with a pizza"
   - See: Skill #201

2. **Atomic Print Configuration** (`src/types/routing.ts`)
   - Per-element print settings (stationName, orderNumber, tabName, etc.)
   - Each element has: enabled, align, size, reverse, bold, prefix, suffix
   - Divider styles: single-line, double-line, dashed, dots, stars, equals
   - `DEFAULT_ATOMIC_PRINT_CONFIG` constant for new stations

3. **Schema Updates** (`prisma/schema.prisma`)
   - Added `showReferenceItems` Boolean to Station (default: true)
   - Added `atomicPrintConfig` JSON field to Station
   - Updated RoutingManifest interface with new fields

4. **Migration Script** (`scripts/migrate-routing.ts`)
   - Non-destructive migration from old printerIds to new Station model
   - Converts Printers → Stations with inferred tags
   - Creates Pizza Station from PizzaConfig.printerIds
   - Creates Expo Station if none exists
   - Generates routeTags for Categories based on categoryType
   - Run: `npx ts-node scripts/migrate-routing.ts [locationId]`

**Files Created:**
- `scripts/migrate-routing.ts` - Migration utility

**Files Modified:**
- `prisma/schema.prisma` - Added showReferenceItems, atomicPrintConfig
- `src/lib/order-router.ts` - primaryItems/referenceItems separation
- `src/types/routing.ts` - AtomicPrintConfig types, updated RoutingManifest

---

### Socket.io Real-Time KDS Architecture

Replaced 3-5 second polling with WebSocket-based real-time updates using a room-based architecture.

**Room Architecture:**
```
location:{id}   - Global venue alerts (sync status, hardware failures)
tag:{tagName}   - Prep stations (pizza KDS only hears tag:pizza)
terminal:{id}   - Direct messages to specific handheld
```

**Server Components:**

1. **Socket Server** (`src/lib/socket-server.ts`)
   - Room-based event routing
   - `join_station` - Terminals join tag-based rooms
   - `new_order` - Dispatches to tag rooms from routing manifest
   - `item_status` - Broadcasts item status changes
   - `entertainment_update` - Syncs timer updates

2. **Socket Dispatch Helper** (`src/lib/socket-dispatch.ts`)
   - `dispatchNewOrder()` - Called after OrderRouter.resolveRouting()
   - `dispatchItemStatus()` - Item cooking/ready/served
   - `dispatchOrderBumped()` - Order fully served
   - `dispatchEntertainmentUpdate()` - Timer start/extend/stop

3. **KDS React Hook** (`src/hooks/useKDSSockets.ts`)
   - Replaces polling with WebSocket subscriptions
   - Optimistic local state updates on bump
   - Automatic reconnection with fallback to polling
   - Sound alerts on new orders
   - See: Skill #202

4. **Event Types** (`src/lib/events/types.ts`)
   - `KDSOrderReceivedEvent` - Full order with primary/reference items
   - `KDSItemStatusUpdateEvent` - Item status change
   - `KDSOrderBumpedEvent` - Order bumped from station
   - `EntertainmentSessionUpdateEvent` - Timer updates
   - New channel types: `tag`, `terminal`

5. **API Integration** (`src/app/api/orders/[id]/send/route.ts`)
   - Integrated OrderRouter.resolveRouting()
   - Fire-and-forget socket dispatch after DB update
   - Returns routing info in response

**Performance Benefits:**
- Latency: <50ms on local network (vs 3-5 second polling)
- DB Load: ~200-300 hits/min → near zero during service
- Battery: Handhelds idle until actual orders arrive
- Sync: No more "ghost bumps" - all KDS screens update instantly

**Files Created:**
- `src/lib/socket-server.ts` - Socket.io server
- `src/lib/socket-dispatch.ts` - Dispatch helpers
- `src/hooks/useKDSSockets.ts` - React hook
- `src/app/api/internal/socket/broadcast/route.ts` - Internal API

**Files Modified:**
- `src/lib/events/types.ts` - New KDS event types
- `src/app/api/orders/[id]/send/route.ts` - Routing + dispatch integration

**Dependencies Added:**
- `socket.io` - Server-side WebSocket
- `socket.io-client` - Client-side WebSocket

---

### ESC/POS Impact Printer Fix

Fixed TM-U220 impact printer color state bleed issue.

**Problem:** Impact printers are stateful - if a print job ends with red color enabled, the next job might start in red.

**Solution:** Added `COLOR_BLACK` reset at end of document building functions.

**Files Modified:**
- `src/lib/escpos/commands.ts`
  - `buildDocument()` - Added COLOR_BLACK + NORMAL_SIZE reset
  - `buildDocumentNoCut()` - Added COLOR_BLACK + IMPACT_NORMAL reset

---

### Tip Guide Basis Configuration (Planned)

Added feature spec for configurable tip guide calculations. Servers will no longer be penalized when discounts/promos/gift cards are applied.

**Settings Options:**
- `net_total` - Current behavior (after all adjustments)
- `pre_discount` - Before discounts, after tax
- `gross_subtotal` - Original item subtotal (recommended)
- `custom` - Selective exclusions via checkboxes

**Files Created:**
- `docs/features/tip-guide-basis.md` - Feature specification

**CLAUDE.md Updated:**
- Added as Priority 4 in TODO section
- Updated Priority 3 (Kitchen/Print) with Socket.io completion
- Added Priority 6 for Tag-Based Routing completion

---

### Skills Documentation

Created/updated skills documentation for new features.

**Skills Created:**
| Skill # | Name | File |
|---------|------|------|
| 201 | Tag-Based Routing Engine | `docs/skills/201-tag-based-routing.md` |
| 202 | Socket.io Real-Time KDS | `docs/skills/202-socketio-realtime-kds.md` |
| 203 | Reference Items & Atomic Print | `docs/skills/203-reference-items-atomic-print.md` |

---

## [2026-01-29] Session 24

### Simplified Print Routing System

Completely redesigned the print routing system to be simpler and more intuitive. Removed the complex PrintRoute system and replaced it with direct printer/KDS assignment at the category and item level.

**Key Changes:**

1. **Removed PrintRoute System**
   - Deleted `PrintRoute` model from schema
   - Removed `/api/hardware/print-routes/` API endpoints
   - Removed `PrintRouteEditor.tsx` and `PrintRoutePreview.tsx` components
   - Removed `print-route-settings.ts` types file

2. **Simplified Schema**
   - `Category.printerIds` - JSON array of printer/KDS IDs (replaces single `printerId`)
   - `MenuItem.printerIds` - JSON array for item-level override
   - `MenuItem.backupPrinterIds` - JSON array for failover destinations
   - `Modifier.printerRouting` - Routing mode: "follow" | "also" | "only"
   - `Modifier.printerIds` - JSON array when routing is "also" or "only"

3. **Multiple Destination Support**
   - Categories can print to multiple printers/KDS screens
   - Items can override with their own destinations
   - Items can have backup destinations for failover
   - KDS screens available as print destinations

4. **Improved UI**
   - Dropdown with checkboxes for multi-select (scales with many printers)
   - Grouped by type: "Printers" and "KDS Screens"
   - Visual distinction: Blue for printers, Green for KDS, Orange for backups
   - Shows selected count: "Sending to X destination(s)"

5. **New Routing Priority**
   ```
   Item destinations (array) → Category destinations (array) → Default kitchen printer
   ```

**Database Changes:**
- Removed `PrintRoute` model
- Changed `Category.printerId` → `Category.printerIds` (JSON array)
- Changed `MenuItem.printerId` → `MenuItem.printerIds` (JSON array)
- Added `MenuItem.backupPrinterIds` (JSON array)
- Changed `Modifier.printerId` → `Modifier.printerIds` (JSON array)
- Added `Modifier.printerRouting` (string with default "follow")

**Modified Files:**
- `prisma/schema.prisma` - Schema simplification
- `src/app/(admin)/menu/page.tsx` - Multi-select dropdown for items/categories
- `src/app/(admin)/settings/hardware/routing/page.tsx` - Added KDS support
- `src/app/api/menu/categories/route.ts` - Handle printerIds array
- `src/app/api/menu/categories/[id]/route.ts` - Handle printerIds array
- `src/app/api/menu/items/route.ts` - Handle printerIds/backupPrinterIds
- `src/app/api/menu/items/[id]/route.ts` - Handle printerIds/backupPrinterIds
- `src/app/api/menu/modifiers/route.ts` - Handle printerRouting/printerIds
- `src/app/api/menu/modifiers/[id]/route.ts` - Handle printerRouting/printerIds
- `src/app/api/menu/route.ts` - Return backupPrinterIds
- `src/app/api/print/kitchen/route.ts` - Multi-printer routing logic

**Deleted Files:**
- `src/app/api/hardware/print-routes/` (entire directory)
- `src/components/hardware/PrintRouteEditor.tsx`
- `src/components/hardware/PrintRoutePreview.tsx`
- `src/types/print-route-settings.ts`

**UI Features:**
- Edit Item Modal: Dropdown with checkboxes for printers + KDS screens
- Edit Category Modal: Dropdown with checkboxes for printers + KDS screens
- Routing Page: Toggle buttons for quick category/item routing with KDS support
- Both support primary destinations and backup destinations

---

## [2026-01-29] Session 23

### Print Routing Rules System

Redesigned the print routing system to centralize print settings per route (not per location), with support for multiple printers, printer-type-specific settings, live preview, and backup failover.

**New Features:**

1. **Print Routes**
   - Named routes with printer-specific settings (e.g., "Pizza Printer 1")
   - Route types: Pizza, Bar/Drinks, Category, Item Type
   - Priority-based routing (higher priority checked first)
   - Each route can have different print settings

2. **Printer-Type-Specific Settings**
   - Impact printers (TM-U220): Red ribbon options, emphasized text, double-strike
   - Thermal printers (TM-T88): Print density, speed settings
   - Settings automatically change based on selected printer type

3. **Backup Printer Failover**
   - Configure backup printer per route
   - Automatic failover on primary printer failure
   - Configurable timeout delay (1000-30000ms)

4. **Live Preview**
   - Real-time ticket preview as settings change
   - Shows red text for impact printer elements
   - Different preview content based on route type

5. **Route-Specific Pizza Settings**
   - Section headers, topping display options
   - Modification highlighting (NO, EXTRA, LIGHT)
   - Footer options (topping count, size repeat)

**Database Changes:**
- Added `PrintRoute` model with:
  - `name`, `description`, `routeType`
  - `printerId`, `backupPrinterId` (with relations)
  - `printSettings` (JSON) for route-specific settings
  - `failoverEnabled`, `failoverDelayMs`
  - `priority`, `printCopies`, `isActive`

**New Files:**
- `prisma/schema.prisma` - PrintRoute model added
- `src/types/print-route-settings.ts` - RouteSpecificSettings types
- `src/app/api/hardware/print-routes/route.ts` - CRUD API
- `src/app/api/hardware/print-routes/[id]/route.ts` - Single route ops
- `src/app/api/hardware/print-routes/[id]/test/route.ts` - Test print
- `src/components/hardware/PrintRouteEditor.tsx` - Route editor modal
- `src/components/hardware/PrintRoutePreview.tsx` - Live preview

**Modified Files:**
- `src/app/(admin)/settings/hardware/routing/page.tsx` - Added Print Routes section

**Routing Priority:**
```
PrintRoute (by priority) > Item printer > Category printer > Default kitchen printer
```

---

## [2026-01-29] Session 22

### Pizza Kitchen Ticket Printing Improvements

Major overhaul of pizza kitchen ticket printing with comprehensive settings, live preview, and proper sectional topping support.

**Pizza Print Settings Editor:**

1. **Live Receipt Preview**
   - Real-time preview showing exactly how the ticket will print
   - Updates instantly as settings change
   - Shows red text for items that will print in red on TM-U220
   - Side-by-side layout: settings on left, preview on right

2. **Red Ribbon / Two-Color Support (TM-U220)**
   - Enable/disable red printing per element type
   - Options: Headers, Item Names, Modifiers, NO Items, EXTRA Items, LIGHT Items, Notes, Allergies, Section Headers
   - All style dropdowns include RED, RED Bold, RED Inverted options

3. **Text Sizing Controls**
   - Header size: Normal, Large, XLarge
   - Item name size: Normal, Large, XLarge
   - Modifier size: Small, Normal, Large
   - Section header size: Normal, Large, XLarge
   - Notes size: Normal, Large

4. **Preset Configurations**
   - Standard (default settings)
   - Compact (minimal spacing)
   - High Visibility (larger text, more red)
   - Impact Printer (optimized for TM-U220)

**Kitchen Ticket Content Improvements:**

1. **Size & Crust Now Print**
   - Size printed prominently: `LARGE (14")`
   - Crust type: `THIN CRUST`
   - Base sauce: `MARINARA SAUCE`
   - Base cheese: `MOZZARELLA CHEESE`

2. **Sectional Toppings Fixed**
   - Toppings that span multiple sections now correctly appear in each applicable section
   - Example: Steak on 1/6-1 through 1/6-5 appears in all five sections
   - Sections print in logical order: WHOLE → Halves → Quarters → Sixths
   - Empty sections are skipped (no more "LEFT HALF: -")

3. **Text Wrapping Prevention**
   - Smart sizing uses height-only scaling for long text
   - Prevents "BUILD YOUR OW\nN" wrapping issues
   - Order type abbreviated: DINE_IN → DINE IN

4. **Impact Printer Commands**
   - Uses correct ESC ! commands instead of GS ! for impact printers
   - Proper double-height and double-width support

**Screen Freeze Fix:**

- Replaced blocking `prompt()`/`alert()` with React modal for resend
- Eliminates "[Violation] 'click' handler took 2029ms" errors
- Non-blocking UI for kitchen resend operations

**Files Modified:**
- `src/app/api/print/kitchen/route.ts` - Complete rewrite of pizza section logic, size/crust printing
- `src/components/hardware/PizzaPrintSettingsEditor.tsx` - Live preview, all settings tabs
- `src/types/pizza-print-settings.ts` - Added red style options throughout
- `src/app/(pos)/orders/page.tsx` - Non-blocking resend modal

**API Changes:**
- Kitchen print now includes size/crust/sauce/cheese relations
- Added detailed logging for print debugging

---

## [2026-01-28] Session 21

### New Feature: Configurable Order Types System (Skill 101)

Transformed hardcoded order types (dine_in, takeout, delivery, bar_tab) into a fully admin-configurable system supporting custom order types with required fields, workflow rules, and KDS display options.

**Core Features:**

1. **Admin-Configurable Order Types**
   - Create custom order types (Drive Thru, Call-in, Curbside, etc.)
   - Configure name, slug, color, and icon per type
   - Set sort order for button display
   - Toggle active/inactive to show/hide in POS
   - System types (Table, Bar Tab, Takeout) are protected from deletion

2. **Custom Field Collection**
   - Define required and optional fields per order type
   - Field types: text, textarea, phone, time, select
   - Touch-friendly button grids for select fields
   - Color fields display actual colors as button backgrounds
   - Dynamic grid layouts (2-4 columns based on option count)

3. **Workflow Rules**
   - `requireTableSelection` - Must select table before sending
   - `requireCustomerName` - Must have customer/tab name
   - `requirePaymentBeforeSend` - Must pay before sending to kitchen
   - Pre-send validation enforces all configured rules

4. **Open Orders Display**
   - Custom order types show correct badges (not "Dine In")
   - Uses configured color and icon from database
   - Displays custom field values (vehicle info, phone, etc.)

**Default Order Types Configured:**

| Type | Slug | Color | Required Fields |
|------|------|-------|-----------------|
| Table | `dine_in` | Blue | tableId |
| Bar Tab | `bar_tab` | Purple | tabName |
| Takeout | `takeout` | Green | - (payment required) |
| Delivery | `delivery` | Green | address, phone |
| Drive Thru | `drive_thru` | Cyan | customerName, vehicleType, vehicleColor |

**Drive Thru Configuration:**
- Customer name text field (required)
- Vehicle type selection: Sedan, SUV, Pickup Truck, Van, Sports Car, Motorcycle, Other
- Vehicle color selection: 12 colors displayed as actual colored buttons
- All fields collected in modal before order starts

**Files Created:**
- `src/types/order-types.ts` - Type definitions, system type configs
- `src/app/api/order-types/route.ts` - Order types CRUD API (GET, POST, PUT)
- `src/app/api/order-types/[id]/route.ts` - Single order type operations
- `src/app/(admin)/settings/order-types/page.tsx` - Admin management page
- `src/components/orders/OrderTypeSelector.tsx` - POS order type buttons & field modal
- `.claude/commands/order-types.md` - Comprehensive skill documentation

**Files Modified:**
- `prisma/schema.prisma` - Added OrderType model, updated Order with orderTypeId/customFields
- `src/lib/validations.ts` - Added orderTypeId and customFields to order schema
- `src/stores/order-store.ts` - Added orderTypeId and customFields to Order interface
- `src/app/(pos)/orders/page.tsx` - Integrated OrderTypeSelector, added pre-send validation
- `src/app/api/orders/route.ts` - Handle orderTypeId and customFields in order creation
- `src/app/api/orders/open/route.ts` - Include orderTypeRef relation and customFields
- `src/components/orders/OpenOrdersPanel.tsx` - Support custom order type display
- `src/app/(admin)/settings/page.tsx` - Added Order Types to Quick Links

**API Endpoints:**
- `GET /api/order-types?locationId=xxx` - List active order types (POS)
- `GET /api/order-types?locationId=xxx&includeInactive=true` - List all (Admin)
- `POST /api/order-types` - Create new order type
- `PUT /api/order-types` - Initialize system types for location
- `PUT /api/order-types/[id]` - Update order type
- `DELETE /api/order-types/[id]` - Delete order type (non-system only)

**Bug Fixes:**
- Fixed order type not being saved when starting order (missing orderTypeId)
- Fixed table picker always setting 'dine_in' instead of selected order type
- Fixed Open Orders panel showing "Dine In" for all custom order types
- API now filters inactive order types by default for POS

---

## [2026-01-28] Session 20

### Database: Multi-Tenancy locationId Implementation

Added `locationId` to all tables for proper multi-tenancy support. This is a foundational change that ensures all data can be properly scoped by location.

**Tables Updated (22 new locationId columns):**
- Order Details: `OrderItem`, `OrderItemModifier`, `Payment`, `OrderDiscount`
- Menu: `Modifier`, `MenuItemModifierGroup`
- Combos: `ComboTemplate`, `ComboComponent`, `ComboComponentOption`
- Operations: `PaidInOut`, `SectionAssignment`, `VoidLog`, `Break`
- Transactions: `CouponRedemption`, `GiftCardTransaction`, `HouseAccountTransaction`
- Events: `EventPricingTier`, `EventTableConfig`, `UpsellEvent`
- Tips: `TipPoolEntry`
- Liquor Builder: `RecipeIngredient`, `SpiritModifierGroup`

**Also added Location relations to:**
- `TaxRule`, `InventoryTransaction`, `StockAlert` (had locationId but missing relation)

**Migration:**
- Created `prisma/migrations/add-location-ids.sql` for data migration
- All existing records populated with locationId from parent records
- Added indexes on all new locationId columns

**Documentation:**
- Updated CLAUDE.md with multi-tenancy requirements
- All new models MUST include locationId
- All queries MUST filter by locationId

### Codebase Cleanup & Optimization

Comprehensive codebase analysis and cleanup to reduce technical debt.

**Removed Unused Dependencies:**
- Removed `@types/uuid` from devDependencies (was never used)

**Created Centralized API Client:**
- New file: `src/lib/api-client.ts`
- Typed methods for all 27+ API endpoint groups
- Eliminates duplicate fetch patterns across 75+ files
- Includes error handling, query string building, and consistent response parsing
- Usage: `import { api } from '@/lib/api-client'` then `api.customers.list({ locationId })`

**Extracted Components:**
- `SortableCategoryButton` → `src/components/pos/SortableCategoryButton.tsx`
- Created shared payment types → `src/components/payment/types.ts`

**Fixed TODO Comments:**
- Settings page: Fixed auth context to use proper permission checking via `useAuthStore`
- Reports page: Updated labor metrics comments with implementation notes
- Receipt route: Added basic loyalty points calculation for customers

**Code Quality Findings (for future reference):**
- Large files identified for future splitting:
  - `orders/page.tsx` (3,574 lines) - Main POS interface
  - `ShiftCloseoutModal.tsx` (953 lines)
  - `SplitCheckModal.tsx` (882 lines)
  - `PaymentModal.tsx` (874 lines)
- All custom hooks (4) are actively used
- All Zustand stores (2) are actively used
- No dead API routes found

---

## [2026-01-28] Session 19

### New Feature: POS Personalization - Category & Menu Item Customization (Skill 99)
Each employee can personalize their POS interface with custom colors and effects for a fully customized experience.

**Core Features:**

1. **Category Button Colors** (per employee, per category)
   - Custom selected background color
   - Custom selected text color
   - Custom unselected background color (makes buttons pop!)
   - Custom unselected text color
   - Access via gear icon → "Reorder Categories" → click paint icon on any category

2. **Menu Item Styling** (per employee, per item)
   - Custom background color
   - Custom text color
   - Pop effects: Glow, Larger, Border, or "All" (maximum pop!)
   - Custom glow/border color
   - Access via gear icon → "Customize Item Colors" → click paint icon on any item

3. **Reset Options** (in gear dropdown)
   - "Reset All Category Colors" - clears all category customizations
   - "Reset All Item Styles" - clears all menu item customizations

**Settings Storage:**
- Stored in `Employee.posLayoutSettings` JSON field
- `categoryColors: { [categoryId]: CategoryColorOverride }`
- `menuItemColors: { [menuItemId]: MenuItemCustomization }`

### New Feature: Glassmorphism UI Overhaul (Skill 100)
Modern glass effect throughout the POS interface for a sleek, contemporary look.

**Visual Enhancements:**
- Frosted glass panels with backdrop blur
- Soft gradients based on Bar/Food mode
- Blue theme for Bar mode
- Orange theme for Food mode
- Smooth hover animations and transitions
- Semi-transparent overlays with blur effects

---

## [2026-01-28] Session 18

### New Feature: Tips & Commission Sharing System (Skill 98)
Comprehensive tip sharing system with automatic role-based tip-outs, custom sharing, banked tips, and detailed reporting.

**Core Features:**

1. **Role-Based Tip-Outs**
   - Configure automatic tip-out percentages by role (e.g., Server → Busser 3%, Server → Bartender 2%)
   - Rules apply automatically at shift closeout
   - Toggle rules active/inactive as needed
   - Supports multiple rules per role

2. **Custom Tip Sharing**
   - One-off tip shares to specific employees during closeout
   - Share fixed dollar amounts to any team member
   - Add notes to custom shares for tracking

3. **Tip Distribution at Closeout**
   - New "Tips" step in shift closeout flow
   - Shows gross tips collected during shift
   - Auto-calculates role-based tip-outs
   - Allows adding custom one-off shares
   - Displays net tips (what server keeps)

4. **Banked Tips System**
   - Tips auto-bank when recipient is not on shift
   - Tracks pending banked tips for payroll
   - Supports collection at next clock-in or via payroll

5. **Tip Collection Notification**
   - Notification appears when clocked in with pending tips
   - Shows breakdown of tips from each source
   - One-click collection or dismiss for later

6. **Tips Report**
   - Comprehensive tips report at `/reports/tips`
   - By Employee tab: gross, given, received, net tips
   - Tip Shares tab: all tip share transactions
   - Banked Tips tab: uncollected tips for payroll
   - Filter by date range and employee
   - Personal "My Tips" shortcut in reports hub

7. **Tip Permissions**
   - `tips.view_own` - See your own tips
   - `tips.view_all` - See all employees' tips
   - `tips.share` - Share tips to others
   - `tips.collect` - Collect shared tips
   - `tips.manage_rules` - Configure tip-out rules
   - `tips.manage_bank` - Manage banked tips / payroll

**Database Changes:**
- Added `TipOutRule` model for automatic tip-out rules
- Added `TipShare` model for tip distribution records
- Added `TipBank` model for uncollected/banked tips
- Added `isTipped` field to Role model
- Added `grossTips`, `tipOutTotal`, `netTips` fields to Shift model

### New Files Created
| File | Purpose |
|------|---------|
| `src/app/(admin)/settings/tip-outs/page.tsx` | Tip-out rules configuration UI |
| `src/app/api/tip-out-rules/route.ts` | CRUD API for tip-out rules |
| `src/app/api/tip-out-rules/[id]/route.ts` | Single tip-out rule operations |
| `src/app/api/employees/[id]/tips/route.ts` | Employee tip collection API |
| `src/app/(admin)/reports/tips/page.tsx` | Tips report page |
| `src/app/api/reports/tips/route.ts` | Tips report API |
| `.claude/commands/tip-sharing.md` | Tip sharing skill documentation |

### Files Modified
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Added TipOutRule, TipShare, TipBank models |
| `src/components/shifts/ShiftCloseoutModal.tsx` | Added tip distribution step |
| `src/app/api/shifts/[id]/route.ts` | Process tip distribution on closeout |
| `src/components/time-clock/TimeClockModal.tsx` | Added pending tips notification |
| `src/app/(admin)/reports/page.tsx` | Added Tips Report links |
| `src/app/(admin)/settings/page.tsx` | Added Tip-Outs link |
| `src/lib/auth.ts` | Added tip permissions |
| `src/components/payment/PaymentModal.tsx` | Added employeeId prop for tip tracking |
| `src/app/(pos)/orders/page.tsx` | Pass employeeId to PaymentModal |

### Bug Fixes

1. **Tips Not Showing in Shift Closeout**
   - **Issue**: Gross tips showed $0.00 at closeout even when tips were collected
   - **Cause**: PaymentModal wasn't passing `employeeId` when processing payments, so tips weren't attributed to the employee
   - **Fix**: Added `employeeId` prop to PaymentModal and included it in payment API requests

2. **Tip-Outs Settings "No Location Found" Error**
   - **Issue**: Tip-out rules settings page showed "No location found. Please log in again."
   - **Cause**: Page was reading from wrong localStorage key instead of using auth store
   - **Fix**: Updated page to use `useAuthStore` hook to get employee/location data

3. **Improved Error Messages**
   - Added detailed error messages to tip-out rules API for better debugging

### New Skills Added
| Skill | Name | Description |
|-------|------|-------------|
| 98 | Tip Sharing | Role-based tip-outs, custom sharing, banked tips |
| - | Reports | General reports overview (sales, employees, tips, liquor) |

---

## [2026-01-28] Session 17

### New Feature: POS Display Settings & Bar/Food Mode (Skills 96-97)
Major POS UI overhaul with customizable display settings, Bar/Food mode toggle, and smart favorites bar.

**Core Features:**

1. **Bar/Food Mode Toggle**
   - Prominent toggle in header to switch between Bar and Food modes
   - Smooth animated transition between modes
   - Categories auto-sort based on mode (drinks first in Bar, food first in Food)
   - Remembers last used mode per employee

2. **Smart Favorites Bar**
   - Quick-access row for frequently used items
   - Separate favorites per mode (bar favorites vs food favorites)
   - Drag-and-drop reordering with @dnd-kit
   - Right-click any menu item to add/remove from favorites
   - Favorite items show star indicator
   - Edit mode for managing favorites

3. **Menu Item Size Options**
   - Compact (64px) - Maximum items visible, minimal scrolling
   - Normal (80px) - Balanced view (default, smaller than previous)
   - Large (112px) - Original size, easier to tap

4. **Grid Column Control**
   - Configurable 3-6 columns per row
   - Adapts to screen size and preference

5. **Category Button Sizing**
   - Small, Medium, Large options
   - Affects category bar button sizes

6. **Order Panel Width**
   - Narrow (256px) - More menu space
   - Normal (320px) - Default
   - Wide (384px) - More order details

7. **Category Color Modes**
   - Solid - Full color background when selected
   - Subtle - Light tint with colored border
   - Outline - Border only with transparent background

8. **Permission-Based Customization**
   - New `posLayout` permission category
   - Admins can customize global layouts
   - Managers/employees can customize personal layouts (with permission)
   - Personal settings stored per-employee

**Dependencies Added:**
- `@dnd-kit/core` - Drag-and-drop framework
- `@dnd-kit/sortable` - Sortable lists
- `@dnd-kit/utilities` - DnD utilities
- `framer-motion` - Smooth animations

### New Files Created
| File | Purpose |
|------|---------|
| `src/hooks/usePOSDisplay.ts` | Hook for display settings (sizing, colors) |
| `src/hooks/usePOSLayout.ts` | Hook for layout settings (mode, favorites, category order) |
| `src/components/orders/POSDisplaySettings.tsx` | Display settings modal |
| `src/components/pos/ModeToggle.tsx` | Bar/Food mode toggle component |
| `src/components/pos/FavoritesBar.tsx` | Draggable favorites bar with @dnd-kit |
| `src/app/api/employees/[id]/layout/route.ts` | Employee layout settings API |

### Files Modified
| File | Changes |
|------|---------|
| `src/lib/settings.ts` | Added `POSDisplaySettings` and `POSLayoutSettings` interfaces |
| `src/app/(pos)/orders/page.tsx` | Integrated mode toggle, favorites bar, dynamic sizing |
| `prisma/schema.prisma` | Added `posLayoutSettings` field to Employee model |
| `prisma/seed.ts` | Added `posLayout` permission to roles |

### Database Changes
- Added `posLayoutSettings Json?` field to Employee model for personal layout preferences

### New Skills Added
| Skill | Name | Description |
|-------|------|-------------|
| 96 | POS Display Settings | Customizable sizing, colors, grid layout |
| 97 | Bar/Food Mode | Mode toggle, favorites bar, category sorting |

---

## [2026-01-28] Session 16

### New Feature: Entertainment Session Synchronization (Skill 95)
Unified entertainment/timed rental session management across all POS views with auto-start timers and synchronized state.

**Core Features:**

1. **Four-System Synchronization**
   - Entertainment KDS (`/kds/entertainment`) - Full session management view
   - Open Orders Panel - Badge display and quick controls
   - Orders Page - Inline session controls per item
   - Orders Page Menu Grid - Shows IN USE badge on entertainment items
   - All views auto-refresh every 3 seconds when viewing entertainment

2. **Auto-Start Timers on Send**
   - Timers automatically start when clicking "Send to Kitchen" or "Send to Tab"
   - Uses item's `blockTimeMinutes` setting (default: 60 minutes)
   - No manual timer start needed for typical workflow

3. **Entertainment Session Controls Component**
   - Countdown timer display with color-coded urgency (green → orange → red)
   - "Extend Time" with quick options (+15, +30, +45, +60 min)
   - "Stop Session" to end and release item
   - "Start Timer" UI when timer not yet started
   - Shows elapsed time for per-minute billing mode

4. **Unified API Endpoints**
   - All systems use same `/api/entertainment/block-time` endpoints
   - POST - Start block time timer
   - PATCH - Extend time
   - DELETE - Stop session and release item
   - Automatic MenuItem status sync (available/in_use)

5. **Open Orders Enhancement**
   - Entertainment badge on orders with active sessions
   - Shows item name, elapsed/remaining time, status
   - Quick access to session controls

6. **Database Protection**
   - Added backup/restore scripts to package.json
   - Auto-backup before database reset
   - Timestamped backups in `prisma/backups/`

**Bug Fixes:**
- Fixed `MenuItem.currentOrderId` storing wrong ID (was session.id, now order.id)
- Fixed Orders page menu not refreshing entertainment status after stopping timer
- Added auto-refresh (3 sec) to Orders page when viewing Entertainment category
- Added cache-busting headers to all entertainment/menu API calls
- Added `dynamic = 'force-dynamic'` to API routes to prevent Next.js caching
- Fixed stale closure issue with useCallback for loadMenu functions
- Fixed Entertainment KDS passing wrong parameter (orderId vs orderItemId)
- Fixed SeatFromWaitlistModal not starting block time on seat
- Fixed block time not showing on reopened orders

### New Files Created
| File | Purpose |
|------|---------|
| `src/components/orders/EntertainmentSessionControls.tsx` | Reusable session controls (timer, stop, extend) |

### Files Modified
| File | Changes |
|------|---------|
| `src/app/(pos)/orders/page.tsx` | Added `startEntertainmentTimers()`, integrated session controls |
| `src/components/orders/OpenOrdersPanel.tsx` | Added auto-refresh (5s), entertainment badges |
| `src/app/(kds)/entertainment/page.tsx` | Fixed DELETE endpoint usage, correct orderItemId |
| `src/components/entertainment/SeatFromWaitlistModal.tsx` | Start block time when seating, pass orderItemId |
| `src/app/api/orders/open/route.ts` | Added entertainment fields to items response |
| `src/app/api/entertainment/status/route.ts` | Added orderItemId to response |
| `src/stores/order-store.ts` | Added entertainment fields to OrderItem interface |
| `src/app/api/orders/[id]/route.ts` | Added entertainment fields to GET response |
| `src/types/index.ts` | Added `blockTimeMinutes` to MenuItem interface |
| `src/app/api/menu/route.ts` | Added `blockTimeMinutes` to item response |
| `package.json` | Added db:backup, db:restore, db:list-backups scripts |
| `CLAUDE.md` | Added database protection documentation |

### New Skills Added
| Skill | Name | Description |
|-------|------|-------------|
| 95 | Entertainment Sessions | Session controls, auto-start timers, three-system sync |

### Claude Commands Created
| Command | Description |
|---------|-------------|
| `entertainment-sessions` | Managing entertainment/timed rental sessions |

---

## [2026-01-28] Session 15

### New Feature: Liquor Builder & Spirit Selection System (Skill 94)
Comprehensive liquor management system with tiered spirit selection, recipe tracking, pour cost calculation, and upsell analytics.

**Core Features:**

1. **Tiered Spirit Selection**
   - Four tiers: Well, Call, Premium, Top Shelf
   - Color-coded UI: Gray (Well), Blue (Call), Purple (Premium), Amber (Top Shelf)
   - Automatic price upcharges per tier
   - Expandable tier sections showing all available bottles

2. **Bottle Product Library**
   - Track actual bottles with size (50mL to 1750mL)
   - Unit cost and automatic pour cost calculation
   - Formula: `pourCost = unitCost / poursPerBottle`
   - Pours per bottle: `Math.floor(bottleSizeMl / (pourSizeOz * 29.5735))`
   - Tier assignment per bottle

3. **Spirit Categories**
   - Organize bottles by type: Tequila, Vodka, Gin, Rum, Whiskey, etc.
   - Create modifier groups linked to spirit categories
   - Upsell prompt configuration per category

4. **Cocktail Recipes**
   - Define ingredients with pour counts (1 pour, 0.5 pour, 2 pours)
   - Mark spirits as substitutable (allows tier upgrades)
   - Auto-calculate total pour cost and profit margin
   - Recipe builder UI in Liquor Builder admin page

5. **Upsell Prompts**
   - "Upgrade to [Premium] for $X more?" prompts after well selection
   - Track shown vs accepted upsells per order
   - Employee upsell performance tracking

6. **Inventory Integration**
   - Automatic pour deduction on order payment
   - InventoryTransaction records for pour tracking
   - Spirit substitution detection (upgraded vs default bottle)

7. **Reporting Dashboard**
   - Sales by tier (revenue, drink count, order count)
   - Sales by category (pours, cost, revenue, margin %)
   - Bottle usage (pours per bottle, cost tracking)
   - Pour cost analysis (cocktails ranked by margin)
   - Upsell performance (acceptance rate, revenue, by employee)

**Database Schema (New Models):**
- `BottleProduct` - Bottle library with cost/pour calculations
- `SpiritCategory` - Spirit type classification
- `SpiritModifierGroup` - Links modifier groups to spirit categories
- `RecipeIngredient` - Cocktail recipe ingredients
- `SpiritUpsellEvent` - Upsell tracking for analytics

**Two-Layer Architecture:**
1. **Bottle/Product Library** - Inventory/costing layer (unit cost, pour cost, stock)
2. **Spirits as Modifiers** - Menu/pricing layer (price upcharges, tier display)

### New Files Created
| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Added 5 new models for liquor system |
| `src/lib/constants.ts` | Added SPIRIT_TIERS, BOTTLE_SIZES, LIQUOR_DEFAULTS |
| `src/lib/liquor-inventory.ts` | Pour tracking and inventory deduction on payment |
| `src/app/api/liquor/bottles/route.ts` | Bottle library CRUD |
| `src/app/api/liquor/bottles/[id]/route.ts` | Single bottle operations |
| `src/app/api/liquor/categories/route.ts` | Spirit category CRUD |
| `src/app/api/liquor/categories/[id]/route.ts` | Single category operations |
| `src/app/api/liquor/recipes/route.ts` | List cocktails with recipes |
| `src/app/api/liquor/upsells/route.ts` | Upsell event tracking |
| `src/app/api/menu/items/[id]/recipe/route.ts` | Recipe ingredients CRUD |
| `src/app/api/reports/liquor/route.ts` | Liquor reporting API |
| `src/app/(admin)/liquor-builder/page.tsx` | Admin page (Bottles, Categories, Recipes tabs) |
| `src/app/(admin)/reports/liquor/page.tsx` | Liquor reports (5 tabs) |

### Files Modified
| File | Changes |
|------|---------|
| `src/types/index.ts` | Added spirit fields to Modifier, ModifierGroup, SelectedModifier |
| `src/components/modifiers/ModifierModal.tsx` | Added spirit tier UI with color-coded buttons and upsell prompts |
| `src/components/admin/AdminNav.tsx` | Added Liquor Builder and Liquor Reports links |
| `src/app/(admin)/menu/page.tsx` | Added Liquor Builder button, pour cost display, Recipe button |
| `src/app/api/menu/route.ts` | Added recipe data with pour cost calculation |
| `src/app/api/menu/modifiers/route.ts` | Added isSpiritGroup, spiritConfig fields |
| `src/app/api/menu/items/[id]/modifiers/route.ts` | Added spirit fields to response |
| `src/app/api/orders/route.ts` | Save spiritTier and linkedBottleProductId on modifiers |
| `src/app/api/orders/[id]/route.ts` | Spirit fields in PUT/GET for order updates |
| `src/app/api/orders/[id]/pay/route.ts` | Integrated processLiquorInventory() |
| `src/app/api/orders/[id]/split/route.ts` | Preserve spirit fields when splitting orders |

### New Skills Added
| Skill | Name | Description |
|-------|------|-------------|
| 94 | Liquor Builder | Complete liquor management with spirit tiers, recipes, pour costs, and upsells |

### Claude Commands Created
Created `.claude/commands/` directory with 18 skill documentation files:

**Liquor System (6 files)**
| Command | Description |
|---------|-------------|
| `liquor-builder` | Main liquor system overview |
| `add-bottle` | Adding bottles with pour cost calculation |
| `cocktail-recipe` | Creating cocktail recipes |
| `spirit-categories` | Managing spirit categories |
| `liquor-reports` | Viewing liquor analytics |
| `spirit-upsells` | Tracking upsell performance |

**Core POS (12 files)**
| Command | Description |
|---------|-------------|
| `menu-builder` | Create categories, items, pricing |
| `modifiers` | Customize items with add-ons |
| `combo-meals` | Bundle items with pricing |
| `payments` | Process all payment types |
| `split-tickets` | Divide orders for separate payment |
| `kds` | Kitchen display system |
| `timed-rentals` | Time-based billing items |
| `happy-hour` | Scheduled price adjustments |
| `cash-discount` | Dual pricing compliance |
| `gift-cards` | Sell and redeem gift cards |
| `house-accounts` | Charge to customer accounts |
| `loyalty-program` | Points earning and redemption |

---

## [2026-01-28] Session 14

### New Feature: Split Ticket View (Skill 93)
Full-screen split ticket manager for creating multiple tickets from a single order (e.g., 30-1, 30-2, 30-3).

**Hybrid Pricing Strategy:**
- Item-level proportional discount distribution
- Round to nearest nickel (configurable)
- Remainder bucket - last ticket absorbs rounding differences
- Per-item discounts stay with their item

**UI Features:**
- Full-screen grid layout showing all split tickets
- Checkbox item selection with "Select All" option
- "Move Selected" to transfer items between tickets
- Auto-create new tickets with "+ New Ticket" button
- Real-time pricing updates as items move
- Balance verification (ensures split totals match original)

**Flow:**
1. User clicks "Tickets" button on order sidebar
2. Full-screen manager opens with original order as Ticket 30-1
3. User clicks "+ New Ticket" to create 30-2, 30-3, etc.
4. User selects items and moves them between tickets
5. Pricing updates in real-time with hybrid calculation
6. User clicks "Save & Create Tickets"
7. API creates child orders with proper pricing

### New Files Created
| File | Purpose |
|------|---------|
| `src/lib/split-pricing.ts` | Hybrid pricing calculations |
| `src/hooks/useSplitTickets.ts` | Split state management |
| `src/components/orders/SplitTicketManager.tsx` | Full-screen UI |
| `src/components/orders/SplitTicketCard.tsx` | Individual ticket card |
| `src/app/api/orders/[id]/split-tickets/route.ts` | API endpoint (GET, POST, DELETE) |

### Files Modified
- `src/app/(pos)/orders/page.tsx` - Added "Tickets" button and SplitTicketManager integration

### New Skills Added
| Skill | Name | Description |
|-------|------|-------------|
| 93 | Split Ticket View | Create multiple tickets from one order |

---

## [2026-01-28] Session 13

### Code Cleanup & Refactoring
Comprehensive codebase cleanup to remove bloat, fix issues, and improve maintainability.

#### Phase 1: Remove Dead Code
- Removed 3 unused npm packages: `@tanstack/react-query`, `date-fns`, `uuid` (~25KB bundle reduction)
- Removed duplicate `formatCurrency()` from `src/lib/pricing.ts`
- Removed unused functions from `src/lib/utils.ts`: `calculateTax`, `debounce`, `sleep`
- Cleaned legacy dual pricing fields from `src/lib/settings.ts`

#### Phase 2: Consolidate Types
- Created `src/types/index.ts` with 15+ shared TypeScript interfaces
- Moved scattered types (Category, MenuItem, ModifierGroup, etc.) to centralized location
- Updated orders page to import from shared types

#### Phase 3: Extract Hardcoded Values
- Removed hardcoded `0.08` tax rate from 6+ locations
- Created `src/lib/constants.ts` with shared constants (CATEGORY_TYPES, STATUS_COLORS, etc.)
- Tax rate now loads dynamically from location settings

#### Phase 4: Complete Missing CRUD Operations
Created 6 new API routes with full CRUD (GET, PUT, DELETE):
- `src/app/api/roles/[id]/route.ts`
- `src/app/api/discounts/[id]/route.ts`
- `src/app/api/house-accounts/[id]/route.ts`
- `src/app/api/tax-rules/[id]/route.ts`
- `src/app/api/prep-stations/[id]/route.ts`
- `src/app/api/reservations/[id]/route.ts`

#### Phase 5: Fix N+1 Query Problems
- Fixed inventory route with batch menu item name lookup
- Added `locationId` scoping to `/api/auth/login` route for better performance
- Added pagination to high-traffic routes:
  - `/api/employees` - page/limit with total count
  - `/api/orders` - offset/limit pagination
  - `/api/tabs` - offset/limit pagination

#### Phase 6: Refactor Orders Page
- Extracted `ModifierModal` to `src/components/modifiers/ModifierModal.tsx` (~545 lines)
- Created `src/hooks/useOrderSettings.ts` for settings state management
- **Orders page reduced from 3,235 → 2,631 lines (18% reduction)**

#### Phase 7: Component Organization
- ModifierModal now a standalone, reusable component
- Settings state consolidated into custom hook

#### Phase 8: Add Input Validation with Zod
- Created `src/lib/validations.ts` with comprehensive Zod schemas for:
  - Employee creation/updates
  - Order creation/updates
  - Payment processing
  - Menu items
  - Customers
  - Discounts
  - Tabs
  - Inventory transactions
- Added `validateRequest()` helper function for API routes
- Applied validation to `/api/orders` and `/api/employees` POST routes

#### Phase 9: Error Handling
- Created `src/components/ErrorBoundary.tsx` for React error boundaries
- Created `src/lib/api-errors.ts` with:
  - Custom error classes: `ApiError`, `ValidationError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`
  - `handleApiError()` for standardized API error responses
  - `successResponse()`, `createdResponse()`, `noContentResponse()` helpers

### New Files Created
| File | Purpose |
|------|---------|
| `src/types/index.ts` | Centralized TypeScript interfaces |
| `src/lib/constants.ts` | Shared constants |
| `src/lib/validations.ts` | Zod validation schemas |
| `src/lib/api-errors.ts` | Standardized API error handling |
| `src/hooks/useOrderSettings.ts` | Settings state hook |
| `src/components/ErrorBoundary.tsx` | React error boundary |
| `src/components/modifiers/ModifierModal.tsx` | Extracted modifier modal |
| `src/app/api/roles/[id]/route.ts` | Role CRUD |
| `src/app/api/discounts/[id]/route.ts` | Discount CRUD |
| `src/app/api/house-accounts/[id]/route.ts` | House account CRUD |
| `src/app/api/tax-rules/[id]/route.ts` | Tax rule CRUD |
| `src/app/api/prep-stations/[id]/route.ts` | Prep station CRUD |
| `src/app/api/reservations/[id]/route.ts` | Reservation CRUD |

### New Skills Added
| Skill | Name | Description |
|-------|------|-------------|
| 88 | Price Rounding | Round totals for easier cash handling |
| 89 | Input Validation | Zod schemas for API request validation |
| 90 | Error Boundaries | React error handling components |
| 91 | API Error Handling | Standardized error responses |
| 92 | Query Optimization | N+1 fixes, pagination, batch queries |

---

## [2026-01-28] Session 12

### Redesigned - Cash Discount Program (Card Brand Compliance)
Complete overhaul of dual pricing to comply with card brand rules:

**Key Changes:**
- **Card price is now the DEFAULT** - displayed everywhere (menu, order totals, receipts)
- **Cash is a DISCOUNT** - only shown at time of payment
- **No "surcharge" language** - removed all references to card surcharges
- **Stored prices = Cash prices** - entered in menu builder, system calculates card price

**Flow:**
1. Enter cash price when building items (e.g., $10.00)
2. System calculates card price (cash × (1 + discount%)) → $10.40
3. Card price displayed everywhere as the "regular" price
4. At payment: Cash customers see discount (save $0.40)

**Settings Changes:**
- Renamed "Dual Pricing" to "Cash Discount Program"
- Renamed `cardSurchargePercent` to `cashDiscountPercent`
- Removed "Show both prices on POS menu" option
- Updated settings UI with clearer explanations

**Files Changed:**
- `src/lib/pricing.ts` - Updated functions with clear documentation
- `src/lib/settings.ts` - New field names with legacy fallback
- `src/app/(pos)/orders/page.tsx` - Card prices displayed, cash discount at payment
- `src/app/(admin)/settings/page.tsx` - Updated UI and labels
- `src/components/payment/PaymentModal.tsx` - Updated pricing display

### Enhanced - Dual Price Display on Menu Items & Payment Buttons
Show both card and cash prices throughout the POS interface:

**Menu Items:**
- Each item button now shows both prices side by side: "Mashed Potatoes $5.19 - $4.99"
- Card price (gray) shown first, cash price (green) shown second
- Clearer visual for staff and customers

**Modifier Modal:**
- Modifier upcharges show both prices: "+$0.52 - +$0.50"
- Modal footer shows total with both prices

**Payment Method Buttons:**
- Cash button shows cash total underneath (in green)
- Card button shows card total underneath (in blue)
- Makes it easy to see exact amount for each payment method

**Files Changed:**
- `src/app/(pos)/orders/page.tsx`:
  - Updated `formatItemPrice()` to show both prices
  - Updated `formatModPrice()` in ModifierModal to show both prices
  - Updated ModifierModal footer to show dual price totals
  - Updated payment method buttons with totals underneath

### Added - Price Rounding (Skill 88)
New feature for rounding totals to make cash handling easier:

**Settings:**
- **Increment options:** None, $0.05 (nickel), $0.10 (dime), $0.25 (quarter), $0.50, $1.00
- **Rounding direction:** Nearest, Up, Down
- **Apply to:** Cash payments (default), Card payments (optional)

**How it works:**
- Rounding is applied to the final total after all other calculations
- Shows "Rounding" line item when adjustment is made
- Example: $16.47 → $16.50 (rounded up to nearest quarter)

**Files Added/Changed:**
- `src/lib/settings.ts` - Added `PriceRoundingSettings` interface
- `src/lib/pricing.ts` - Added `roundPrice()` and `applyPriceRounding()` functions
- `src/app/(admin)/settings/page.tsx` - Added Price Rounding settings section
- `src/app/(pos)/orders/page.tsx` - Applied rounding to order totals

### New Skills To Add (Future)
- **Skill 89: Tax Inclusive Pricing** - Prices include tax, cash discount calculated accordingly

---

## [2026-01-28] Session 11

### New Skills Added
| Skill | Name | Description |
|-------|------|-------------|
| 83 | Category Types | Food/Drinks/Liquor/Entertainment/Combos field for reporting & conditional builders |
| 84 | Combo Price Overrides | Per-modifier price overrides for combo-specific pricing |
| 85 | Entertainment Item Builder | Admin UI for timed billing items (15min/30min/hour rates) |
| 86 | Combo Selection Modal | POS modal showing combo items with modifier groups |
| 87 | Conditional Item Builders | Different item UIs based on category type |

### Added - Category Types (Skill 83)
- **Category Type System** - Categories now have a `categoryType` field
  - Options: `food`, `drinks`, `liquor`, `entertainment`, `combos`
  - Used for reporting segmentation and conditional UI builders
  - Visual badge shows category type on admin menu page

### Added - Entertainment Item Builder (Skill 85)
- When category type is "Entertainment", the item modal shows timed billing builder
- Rate inputs: Per 15 min, Per 30 min, Per Hour
- Minimum minutes selector
- Automatically sets `itemType: 'timed_rental'` when enabled
- Existing timed_rental items show the builder regardless of category type

### Added - Conditional Item Builders (Skill 87)
- System that detects category type and shows appropriate item builder
- Entertainment categories → timed billing builder
- Food/Drinks/Liquor → standard item builder with modifiers
- Extensible for future category types (e.g., Combos → combo builder)

### Fixed - Combo Pricing (Skill 84)
- **Double-counting modifier prices** - Combo total was calculated incorrectly
  - Problem: `item.price = basePrice + totalUpcharge`, then modifier prices added again
  - Fix: `item.price = basePrice` only, modifier upcharges stored separately
  - Now correctly calculates: basePrice + sum(modifier upcharges)

- **Modifier default pricing in combos**
  - Problem: Modifiers without explicit override used regular menu prices
  - Fix: Modifiers in combos are $0 (included) unless explicitly set as upcharge
  - Only modifiers with `modifierPriceOverrides[modifierId]` add to price

### Enhanced - Combo Selection Modal (Skill 86)
- POS modal redesigned for item-based combos
- Shows each combo slot with its menu item
- Displays item's modifier groups for selection
- Price overrides shown (e.g., "+$1.50" or included)

### Database Schema
```prisma
model Category {
  categoryType String @default("food")  // food, drinks, liquor, entertainment, combos
  @@index([categoryType])
}
```

### API Updates
- `GET /api/menu` - Returns `categoryType` for each category
- `POST /api/menu/categories` - Accepts `categoryType`
- `PUT /api/menu/categories/[id]` - Accepts `categoryType`

### Files Changed
- `prisma/schema.prisma` - Added `categoryType` to Category model
- `src/app/(admin)/menu/page.tsx` - Category type selector, entertainment builder, conditional builders
- `src/app/(pos)/orders/page.tsx` - Fixed combo pricing, enhanced combo modal
- `src/app/api/menu/route.ts` - Return categoryType
- `src/app/api/menu/categories/route.ts` - Accept categoryType
- `src/app/api/menu/categories/[id]/route.ts` - Accept categoryType

### Deployment
- https://gwi-pos.vercel.app

---

## [2026-01-28] Session 10

### Fixed - Order Creation with Combos
- **Critical Bug Fix**: Orders with combo items were failing to save
  - Root cause: `OrderItemModifier.modifierId` had a foreign key constraint requiring valid Modifier IDs
  - Combo selections use synthetic IDs like `combo-componentId-modifierId` which aren't real modifier references
  - Fix: Made `modifierId` optional in schema, APIs now set it to `null` for combo selections

### Redesigned - Combo System (Skill 41)
Complete overhaul of how combos work:

**New Flow:**
1. Add a slot to combo → Select a **menu item** (e.g., Taco)
2. That item's **existing modifier groups** automatically appear
3. Set **price overrides** per modifier for combo-specific pricing

**Admin Page (`/combos`):**
- Dropdown to select any menu item for each combo slot
- When item is selected, its modifier groups load automatically
- Per-modifier price override inputs (override default prices for combo purposes)
- Display name customization per slot

**POS Combo Modal:**
- Shows each combo item as a labeled section
- Under each item, displays its modifier groups
- Users select modifiers just like ordering the item normally
- Price overrides show "(free)" or custom prices

**Database Schema:**
```prisma
model ComboComponent {
  menuItemId             String?   // The menu item for this slot
  menuItem               MenuItem? // Relation to MenuItem
  itemPriceOverride      Decimal?  // Override item base price
  modifierPriceOverrides Json?     // { "modifierId": 0.00, ... }
}

model OrderItemModifier {
  modifierId   String?   // Now optional for combo selections
  modifier     Modifier? // Optional relation
}
```

**Files Changed:**
- `prisma/schema.prisma` - New combo component fields, optional modifierId
- `src/app/(admin)/combos/page.tsx` - Complete rewrite for item-based combos
- `src/app/api/combos/route.ts` - GET/POST with menu item's modifier groups
- `src/app/api/combos/[id]/route.ts` - GET/PUT with menu item support
- `src/app/(pos)/orders/page.tsx` - New combo modal UI with item modifiers
- `src/app/api/orders/route.ts` - Handle combo modifier IDs
- `src/app/api/orders/[id]/route.ts` - Handle combo modifier IDs

### Deployment
- https://gwi-pos.vercel.app
- https://www.barpos.restaurant

---

## [2026-01-27] Session 9

### Enhanced - Timed Rentals POS Integration (Skill 81)
- **Rate Selection Modal Improvements**
  - Added fallback rate option when `timedPricing` is null (uses base price per hour)
  - Loading state on "Start Timer" button during session creation
  - Proper rate display for all pricing tiers (15min, 30min, hourly)

- **Active Sessions Display**
  - Added "Active Sessions" section in order panel
  - Shows running time with live elapsed display (Xh Ym format)
  - Rate information with formatted rate type
  - "Stop & Bill" button for each active session
  - Purple styling to distinguish from regular order items

- **Session Stop & Bill**
  - Stops session and calculates final charges
  - Updates order item with billed amount and duration
  - Creates new order item if placeholder doesn't exist
  - Removes from active sessions list

- **Timed Sessions API** (`/api/timed-sessions`)
  - `POST` - Start new timed session with location, item, rate type
  - `GET` - List active sessions for location with menu item names

- **Timed Sessions Detail API** (`/api/timed-sessions/[id]`)
  - `GET` - Fetch single session with menu item info
  - `PUT` - Actions: stop (calculates charges), pause, resume
  - Automatic charge calculation based on rate type (per15Min, per30Min, perHour)

### Enhanced - Combo Meals Full CRUD (Skill 41)
- **Combo Update API** (`PUT /api/combos/[id]`)
  - Update combo name, description, price, category
  - Update compare price (a la carte total for savings display)
  - Toggle active/inactive status
  - Full component rebuild with new options
  - Supports upcharge modifications per option

- **Combo Delete API** (`DELETE /api/combos/[id]`)
  - Cascade delete: options → components → template → menu item
  - Proper cleanup of all related records

- **Admin Page Now Fully Functional**
  - Create new combos with slots and options
  - Edit existing combos with component management
  - Delete combos with confirmation
  - Activate/deactivate toggle

### Updated - Skills Status
| Skill | Name | Status | Notes |
|-------|------|--------|-------|
| 81 | Timed Rentals | Done | Enhanced: POS session management, stop & bill |
| 41 | Combo Meals | Done | Enhanced: Full CRUD (create/update/delete) |

### Deployment
- https://gwi-pos.vercel.app
- https://www.barpos.restaurant

---

## [2026-01-27] Session 8

### Added - Combos & Timed Rentals in POS (Skills 41, 81)
- **Combos in Orders Page**
  - Combos category visible in POS menu
  - Click combo item opens selection modal
  - Component selection UI (choose side, drink, etc.)
  - Upcharge display for premium options
  - Savings display vs a la carte pricing
  - Adds combo with selections to order

- **Timed Rentals in Orders Page**
  - Entertainment category visible in POS menu
  - Click rental item opens rate selection modal
  - Rate options: Per 15 min, Per 30 min, Per hour
  - Shows minimum rental time requirement
  - Starts timed session via API
  - Adds session placeholder to order

- **Demo Data** (Seed Updates)
  - **Combos Category**: Burger Combo ($18.99), Wings Combo ($16.99), Steak Dinner ($34.99)
  - **Entertainment Category**: Pool Table, Dart Board, Karaoke Room, Bowling Lane
  - **Combo Components**: Side and drink selections with options
  - **Combo Options**: French Fries, Onion Rings, Coleslaw, Side Salad, Mashed Potatoes, Soft Drink, Draft Beer
  - **Timed Pricing**: Flexible per-15min/30min/hourly rates

- **Combo API** (`/api/combos/[id]`)
  - `GET` - Fetch combo template with components and options
  - Returns component display names, requirements, and item options
  - Includes upcharge amounts for each option

### Fixed - Login Redirect Flow
- Login page now accepts `?redirect=` parameter
- After login, redirects to original destination instead of always /orders
- Updated all 20+ admin pages to pass redirect parameter
- Fixed Suspense boundary for useSearchParams in login page

### Database Schema Updates
- Added `MenuItem` → `ComboComponentOption` relation
- Added index on `ComboComponentOption.menuItemId`

### Updated - Skills Status
| Skill | Name | Status | Notes |
|-------|------|--------|-------|
| 41 | Combo Meals | Done | Full POS integration |
| 81 | Timed Rentals | Done | Full POS integration |
| 82 | Login Redirect | Done | New skill identified |

---

## [2026-01-27] Session 7

### Added - Floor Plan Editor (Skill 80)
- **Floor Plan Admin Page** (`/floor-plan`)
  - Drag and drop table positioning on canvas
  - Grid-based visual layout (600px height)
  - Real-time position saving to database
  - Properties panel for selected table editing

- **Table Configuration**
  - Table shapes: Rectangle, Square, Circle, Booth, Bar Seat
  - Rotation slider (0-359 degrees)
  - Custom width and height
  - Capacity setting
  - Section assignment

- **Visual Features**
  - Color-coded status: Available (green), Occupied (red), Reserved (yellow), In Use (purple), Dirty (gray)
  - Grid lines for alignment
  - Selected table border highlight
  - Status legend display

### Added - Timed Rentals (Skill 81)
- **Timed Sessions API** (`/api/timed-sessions`)
  - `GET` - List active and completed sessions
  - `POST` - Start new timed session with rate type

- **Timed Session Management** (`/api/timed-sessions/[id]`)
  - Pause/Resume session controls
  - Stop & Bill - calculates charges based on elapsed time
  - Rate types: Per 15 min, Per 30 min, Hourly
  - Tracks paused time separately

- **Timed Rentals Admin Page** (`/timed-rentals`)
  - Active sessions grid with live timer display
  - Current charge calculation (updates every 30s)
  - Pause/Resume/Stop & Bill controls
  - Recent completed sessions table
  - Start session modal with item and rate selection

- **Use Cases**
  - Pool tables (hourly)
  - Dart boards (by the game or hour)
  - Karaoke rooms (per 30 minutes)
  - Any time-based rental item

### Added - Tax Rules (Skill 36)
- **Tax Rules API** (`/api/tax-rules`)
  - `GET` - List tax rules for location
  - `POST` - Create new tax rule

- **Tax Rule Management** (`/api/tax-rules/[id]`)
  - `GET/PUT/DELETE` - Individual rule CRUD
  - Toggle active/inactive
  - Multiple rates per location

- **Tax Rules Admin Page** (`/tax-rules`)
  - Summary cards: Total rules, Active rules, Default rate
  - Rules table with all configuration
  - Create/Edit modal with full options
  - Activate/Deactivate toggle

- **Tax Rule Options**
  - Name and percentage rate
  - Applies to: All items, Specific categories, Specific items
  - Priority ordering (lower = applied first)
  - Compounded taxes (tax on tax)
  - Tax-inclusive pricing option

### Added - Inventory Tracking (Skill 38)
- **Inventory API** (`/api/inventory`)
  - `GET` - List stock levels with low/out-of-stock status
  - `POST` - Record inventory transactions

- **Inventory Transactions**
  - Purchase (add stock)
  - Sale (auto-decrement)
  - Waste (spoilage, spills)
  - Adjustment (corrections)
  - Count (physical inventory)

- **Inventory Admin Page** (`/inventory`)
  - Stock levels tab with item search
  - Low stock indicators (yellow)
  - Out of stock indicators (red)
  - Recent transactions tab
  - Adjustment modal for recording changes

### Added - Low Stock Alerts (Skill 39)
- **Stock Alerts API** (`/api/stock-alerts`)
  - `GET` - List active alerts
  - `PUT` - Acknowledge alerts

- **Alert Features**
  - Auto-generated when stock < reorder point
  - Alert types: low_stock, out_of_stock, expiring_soon
  - Priority levels: low, medium, high, urgent
  - Acknowledge to clear
  - Alerts display in inventory admin

### Added - Employee Breaks (Skill 48)
- **Breaks API** (`/api/breaks`)
  - `GET` - List breaks for employee/time clock entry
  - `POST` - Start a break (paid/unpaid)
  - `PUT` - End a break with duration calculation

- **Break Features**
  - Break types: paid, unpaid
  - Auto-calculates duration in minutes
  - Updates time clock entry break minutes
  - Prevents multiple concurrent breaks

### Updated - AdminNav
- Added navigation links to new pages:
  - Inventory (under Menu section)
  - Floor Plan (under Tables & Reservations)
  - Timed Rentals (under Tables & Reservations)
  - Tax Rules (under Settings section)

### Database Schema Updates
- Added `TimedSession` model for time-based rentals
- Added `TaxRule` model for multiple tax rates
- Added `InventoryTransaction` model for stock tracking
- Added `StockAlert` model for low stock notifications
- Added `Break` model for employee break tracking
- Updated `Table` model with rotation and floor plan fields
- Updated `MenuItem` with timedPricing, minimumMinutes, graceMinutes
- Updated `Section` with coordinates for floor plan

---

## [2026-01-27] Session 6

### Added - Admin Navigation Consolidation
- **AdminNav Component** (`src/components/admin/AdminNav.tsx`)
  - Consolidated navigation sidebar for all admin features
  - Collapsible sections: POS, Menu, Tables & Reservations, Customers & Payments, Team, Reports, Settings
  - Mobile responsive with slide-out drawer
  - Active route highlighting
  - Links to all features including new Combos and Report pages

### Added - Order History (Skill 65)
- **Order History API** (`/api/reports/order-history`)
  - Pagination with configurable limit (default 50)
  - Filters: date range, status, orderType, employeeId, customerId, search
  - Summary stats: order count, subtotal, tax, discounts, total
  - Status, type, and payment method breakdowns
  - Search by order number, table name, tab name, or customer name

- **Order History Page** (`/reports/order-history`)
  - Date range picker with status and type filters
  - Summary cards: orders, subtotal, discounts, tax, total
  - Breakdown cards by status, type, payment method
  - Paginated orders table with View Receipt button
  - ReceiptModal integration for viewing/printing past receipts

### Added - Menu Scheduling (Skill 40)
- **Prisma Schema** - Added scheduling fields to MenuItem:
  - `availableFrom` - Time format "HH:mm" (e.g., "06:00")
  - `availableTo` - Time format "HH:mm" (e.g., "11:00")
  - `availableDays` - Comma-separated days (0-6, 0=Sunday)

- **Menu APIs Updated**
  - POST `/api/menu/items` accepts scheduling fields
  - PUT `/api/menu/items/[id]` accepts scheduling fields
  - GET `/api/menu` returns scheduling fields and itemType

### Added - Combo Meals (Skill 41)
- **Combos API** (`/api/combos`)
  - `GET` - List all combo menu items with templates and components
  - `POST` - Create combo with base price, components, and options

- **Combo Details API** (`/api/combos/[id]`)
  - `GET` - Combo details with component options and item info
  - `PUT` - Update combo, template, and components
  - `DELETE` - Remove combo and associated template

- **Combos Admin Page** (`/combos`)
  - List combos with expand/collapse for component details
  - Create/edit modal with component management
  - Add options from existing menu items with upcharge
  - Component slot configuration (name, required, min/max selections)

### Added - Coupon Reports (Skill 78)
- **Coupon Reports API** (`/api/reports/coupons`)
  - Summary: total coupons, active, total redemptions, discount given
  - Per-coupon stats: redemption count, total discount, avg order value
  - Daily redemption trend
  - Breakdown by discount type
  - Recent redemptions list with order details

- **Coupon Reports Page** (`/reports/coupons`)
  - Date range picker with preset buttons (7/30/90 days)
  - Summary cards: total coupons, active, redemptions, discount given
  - Tabs: Overview, By Coupon, Redemptions
  - Top performing coupons display
  - Detailed coupon table with usage stats
  - Recent redemptions list

### Added - Reservation Reports (Skill 79)
- **Reservation Reports API** (`/api/reports/reservations`)
  - Summary: total reservations, covers, completion/no-show/cancellation rates
  - Revenue from completed reservations
  - By day of week, time slot, and table analysis
  - Party size distribution
  - Daily trend with status breakdown
  - Recent reservations list

- **Reservation Reports Page** (`/reports/reservations`)
  - Date range picker with preset buttons
  - Summary cards: total, covers, party size, no-show rate, revenue
  - Tabs: Overview, Patterns, By Table, Reservations
  - Day of week and time slot distribution
  - Party size breakdown with buckets
  - Table utilization with completion rates
  - Daily trend chart data
  - Recent reservations table

---

## [2026-01-27] Session 5 (Continued)

### Added - Course/Seat Management UI (Skill 76)
- **SeatCourseHoldControls Component** (`src/components/orders/SeatCourseHoldControls.tsx`)
  - Inline controls for each order item
  - Seat assignment buttons (1-N based on guest count)
  - Course assignment buttons (1-5)
  - Hold/Fire/Release buttons with status display
  - Compact badge display (S1, C2, HELD, etc.)
  - Real-time updates via API calls
  - Different UI for sent vs unsent items

- **CourseOverviewPanel Component** (`src/components/orders/CourseOverviewPanel.tsx`)
  - Collapsible course manager panel
  - Shows all courses with item counts
  - Status indicators: pending (blue), fired (yellow), ready (green), served (gray), held (red)
  - Bulk course actions: Fire Course, Hold All, Mark Ready, Mark Served
  - Fire All Pending Courses button
  - Course item list with seat numbers and hold status

- **ItemBadges Component** (`src/components/orders/SeatCourseHoldControls.tsx`)
  - Compact inline badges for seat, course, and hold status
  - Used in item name display

### Added - Hold & Fire UI (Skill 77)
- **Hold Controls**
  - Hold Item button for unsent items
  - Fire Now / Release buttons for held items
  - Visual HELD badge with pulse animation
  - Hold status persisted via API

- **Orders Page Integration** (`src/app/(pos)/orders/page.tsx`)
  - SeatCourseHoldControls under each order item
  - ItemBadges inline with item names
  - CourseOverviewPanel between items list and payment toggle
  - Auto-refresh of course statuses after updates

- **Order Store Updates** (`src/stores/order-store.ts`)
  - Added courseStatus, isHeld, holdUntil, firedAt to OrderItem interface
  - Updated loadOrder to map these fields from API
  - Properly typed course status values

---

## [2026-01-27] Session 5

### Added - Coupons / Promo Codes (Skill 35)
- **Prisma Schema** - Coupon and CouponRedemption models
  - Code (unique per location), name, description
  - Discount type: percent, fixed amount, free item
  - Restrictions: minimum order, maximum discount
  - Applies to: entire order, specific categories, or items
  - Usage limits: total uses, per customer limit, single use flag
  - Validity period: validFrom, validUntil dates
  - Usage tracking with redemption history

- **Coupons API** (`/api/coupons`)
  - `GET` - List coupons, lookup by code for validation
  - `POST` - Create new coupon with all configuration

- **Coupons Details API** (`/api/coupons/[id]`)
  - `GET` - Coupon details with redemption history
  - `PUT` - Update, activate/deactivate, redeem coupon
  - `DELETE` - Remove coupon (soft delete if has redemptions)

- **Coupons Admin Page** (`/coupons`)
  - List all coupons with status badges
  - Filter by active/inactive status
  - Stats: total coupons, active, redemptions
  - Create/edit modal with full configuration
  - Activate/deactivate toggle

### Added - Reservations (Skill 19)
- **Prisma Schema** - Reservation model
  - Guest info: name, phone, email, party size
  - Timing: date, time, duration
  - Table assignment with capacity check
  - Status: confirmed, seated, completed, cancelled, no_show
  - Special requests and internal notes
  - Links to Customer profile and Order

- **Reservations API** (`/api/reservations`)
  - `GET` - List by date, status, table
  - `POST` - Create reservation with conflict checking

- **Reservations Details API** (`/api/reservations/[id]`)
  - `GET` - Full reservation details
  - `PUT` - Actions: seat, complete, cancel, no_show, assign_table
  - `DELETE` - Remove future reservations

- **Reservations Admin Page** (`/reservations`)
  - Timeline view by time slot
  - Date navigation with today button
  - Status filters
  - Stats: total, confirmed, seated, covers
  - Quick seat and complete actions
  - Table assignment dropdown
  - Create/edit reservation modal

### Added - Table Transfer (Skill 18)
- **Table Transfer API** (`/api/tables/[id]/transfer`)
  - `POST` - Transfer table to another server
  - Moves all open orders for the table
  - Creates audit log entries for each order
  - Returns count of transferred orders

### Added - Product Mix Reports (Skill 44)
- **Product Mix API** (`/api/reports/product-mix`)
  - Item-level sales data: quantity, revenue, cost, profit
  - Category aggregation with totals
  - Hourly distribution chart data
  - Top performers: by quantity, revenue, profit
  - Bottom performers identification
  - Item pairings analysis (frequently ordered together)

- **Product Mix Report Page** (`/reports/product-mix`)
  - Date range picker with presets (7/30/90 days)
  - Summary cards: revenue, cost, profit, margin
  - View tabs: items, categories, hourly, pairings
  - Top performers cards
  - Full item table with all metrics
  - Category breakdown with percentages
  - Hourly distribution visualization
  - Item pairing recommendations

### Added - Seat Tracking (Skill 11)
- **Order Item Update API** (`/api/orders/[id]/items/[itemId]`)
  - `assign_seat` action - Assign item to seat number
  - Seat number tracked in OrderItem model (already existed)
  - UI support in orders page (items include seatNumber)

### Added - Course Firing (Skill 12)
- **Course API** (`/api/orders/[id]/courses`)
  - `GET` - Get course status summary for order
  - `POST` - Fire, hold, mark ready, mark served by course number

- **Order Item Update API** (`/api/orders/[id]/items/[itemId]`)
  - `assign_course` action - Assign item to course
  - `fire_course` action - Fire item (optionally all in course)
  - `mark_ready` action - Kitchen marks item ready
  - `mark_served` action - Server marks item served
  - Course status: pending, fired, ready, served

### Added - Hold & Fire (Skill 13)
- **Order Item Update API** (`/api/orders/[id]/items/[itemId]`)
  - `hold` action - Put item on hold with optional holdUntil time
  - `fire` action - Fire held item immediately
  - `release` action - Release hold without firing
  - isHeld flag and holdUntil timestamp tracked

---

## [2026-01-27] Session 4

### Added - Gift Cards (Skill 32)
- **Prisma Schema** - GiftCard and GiftCardTransaction models
  - Card number (unique), PIN, initial/current balance
  - Status: active, depleted, expired, frozen
  - Recipient/purchaser info, gift message
  - Transaction history with type, amounts, references

- **Gift Card API** (`/api/gift-cards`)
  - `GET` - List gift cards with search, status filter
  - `POST` - Create/purchase new gift card with auto-generated number

- **Gift Card Details API** (`/api/gift-cards/[id]`)
  - `GET` - Lookup by ID or card number, includes transaction history
  - `PUT` - Actions: freeze, unfreeze, reload, redeem, refund

- **Payment Integration** (`/api/orders/[id]/pay`)
  - `gift_card` payment method added
  - Validates card status and balance
  - Auto-depletes card when balance reaches zero
  - Creates redemption transaction with order reference

- **Gift Cards Admin Page** (`/gift-cards`)
  - List all gift cards with search and status filter
  - Create new gift card with amount, recipient info, message
  - Card detail view with balance, status, transaction history
  - Reload and freeze/unfreeze actions

- **PaymentModal Update**
  - Gift card lookup by number
  - Shows available balance
  - Handles partial payments when balance < amount due

### Added - House Accounts (Skill 33)
- **Prisma Schema** - HouseAccount and HouseAccountTransaction models
  - Account name, contact info, address
  - Credit limit (0 = unlimited), current balance
  - Payment terms (Net 7/15/30/45/60/90)
  - Billing cycle (monthly, weekly, on_demand)
  - Tax exempt flag with tax ID
  - Status: active, suspended, closed
  - Link to Customer profile (optional)

- **House Account API** (`/api/house-accounts`)
  - `GET` - List accounts with search, status filter
  - `POST` - Create new account with credit settings

- **House Account Details API** (`/api/house-accounts/[id]`)
  - `GET` - Account details with transaction history
  - `PUT` - Actions: suspend, reactivate, charge, payment, adjustment, credit
  - `DELETE` - Close account (soft delete, requires zero balance)

- **Payment Integration** (`/api/orders/[id]/pay`)
  - `house_account` payment method added
  - Validates account status and credit limit
  - Creates charge transaction with due date
  - Stores account name in authCode for receipts

- **House Accounts Admin Page** (`/house-accounts`)
  - List all accounts with total outstanding balance
  - Create/edit account with full configuration
  - Account detail view with balance, limits, transaction history
  - Record payment modal (check, cash, ACH, wire, card)
  - Suspend/reactivate accounts

- **PaymentModal Update**
  - House account selection from list
  - Search by account name
  - Shows available credit, validates limit

### Updated - Receipt Display
- Gift card payments show card number last 4 digits
- House account payments show account name
- Added `authCode` to ReceiptPayment interface

### Added - Happy Hour / Time-Based Pricing (Skill 27)
- **Settings Types** (`src/lib/settings.ts`)
  - HappyHourSchedule interface (dayOfWeek, startTime, endTime)
  - HappyHourSettings interface (enabled, name, schedules, discount settings)
  - Multiple schedules supported (e.g., weekday happy hour + weekend brunch)
  - Discount type: percentage off or fixed amount off
  - Applies to: all items, specific categories, or specific items
  - Display options: badge, show original price

- **Helper Functions** (`src/lib/settings.ts`)
  - `isHappyHourActive(settings)` - Check if happy hour is currently active
  - `getHappyHourPrice(price, settings, itemId?, categoryId?)` - Calculate discounted price
  - Handles overnight schedules (e.g., 10pm-2am)

- **Settings Admin** (`/settings`)
  - Full happy hour configuration UI
  - Multi-schedule management with add/remove
  - Day-of-week selector (visual buttons)
  - Start/end time pickers
  - Discount type and value configuration
  - Live example showing calculated price

### Added - Order Merging (Skill 15)
- **Merge API** (`/api/orders/[id]/merge`)
  - `POST` - Merge source order into target order
  - Moves all items and discounts
  - Recalculates totals
  - Updates guest count (combined)
  - Voids source order with merge note
  - Creates audit log entry
  - Validates: same location, not paid/voided

---

## [2026-01-27] Session 3

### Added - Loyalty Program (Skill 52)
- **Loyalty Settings** (`src/lib/settings.ts`)
  - LoyaltySettings interface with full configuration
  - Points per dollar earned, minimum order amount
  - Redemption rate (points per $1), minimum points to redeem
  - Maximum % of order payable with points
  - Welcome bonus for new customers
  - Show points on receipt toggle

- **Settings Admin** (`/settings`)
  - Full loyalty configuration UI
  - Points earning settings
  - Points redemption settings with enable toggle
  - Real-time example calculations

- **Payment Integration** (`/api/orders/[id]/pay`)
  - `loyalty_points` payment method added
  - Points redemption validation (min, max, available)
  - Automatic points earning when order is paid
  - Customer stats update (totalSpent, totalOrders, averageTicket, lastVisit)

- **Customer Lookup Modal** (`src/components/customers/CustomerLookupModal.tsx`)
  - Search customers by name/phone/email from POS
  - Quick add new customer inline
  - Shows loyalty points balance
  - Link customer to order for earning points

- **Order Customer API** (`/api/orders/[id]/customer`)
  - GET - Get linked customer with loyalty info
  - PUT - Link/unlink customer to order

- **Receipt Updates**
  - Loyalty points section on receipt
  - Shows points redeemed, points earned, new balance
  - Customer name displayed

### Added - Customer Management UI (Skill 51)
- **Customer Admin Page** (`/customers`)
  - List all customers with search (name, email, phone)
  - Filter by tags (VIP, Regular, First-Timer, Staff, Family, Business, Birthday Club)
  - Create/edit customer modal with all fields
  - Customer detail view with:
    - Contact info and spending stats
    - Tags and notes display
    - Favorite items (most ordered)
    - Recent order history
  - Soft delete with confirmation

- **Features**
  - Customer tags with color coding
  - Marketing opt-in tracking
  - Birthday tracking
  - Notes for allergies/preferences
  - Total spent, order count, average ticket
  - Last visit tracking

### Added - Receipt Printing (Skill 08)
- **Receipt Component** (`src/components/receipt/Receipt.tsx`)
  - Formatted receipt display with business header, order details, items, totals
  - Support for modifiers, special notes, comped items
  - Payment breakdown with cash change display
  - Configurable via ReceiptSettings (header text, footer text, show server, show table)

- **ReceiptModal** (`src/components/receipt/ReceiptModal.tsx`)
  - Modal wrapper with print functionality
  - Print button opens new window with thermal-receipt sized formatting (80mm width)
  - Auto-print and close after printing

- **Receipt API** (`/api/orders/[id]/receipt`)
  - GET endpoint returns fully formatted receipt data
  - Includes location info, employee name, table, items, payments
  - Filters out voided items, shows comped items with notation

- **Integration**
  - Receipt automatically shown after successful payment
  - "View Receipt" button on closed orders in Open Orders panel
  - Receipt settings loaded from location settings

---

## [2026-01-27] Session 2

### Added - End of Day / Shift Closeout (Skill 50)
- **Shift Management API** (`/api/shifts`)
  - `GET /api/shifts` - List shifts with filters (location, employee, status, date)
  - `POST /api/shifts` - Start new shift with starting cash amount
  - `GET /api/shifts/[id]` - Get shift details with live sales summary
  - `PUT /api/shifts/[id]` - Close shift with cash count and reconciliation

- **ShiftStartModal** (`src/components/shifts/ShiftStartModal.tsx`)
  - Quick amount buttons ($100, $150, $200, $250, $300)
  - Manual entry option
  - Notes field
  - Auto-prompts when employee logs in without open shift

- **ShiftCloseoutModal** (`src/components/shifts/ShiftCloseoutModal.tsx`)
  - Step 1: Summary - Total sales, cash/card breakdown, tips, expected drawer
  - Step 2: Count - Denomination counting or manual total entry
  - Step 3: Confirm - Variance display (over/short with visual indicators)
  - Step 4: Complete - Success screen with final summary

- **Features**
  - Expected cash = Starting Cash + Cash Received - Change Given
  - Variance tracking with color coding (green/yellow/red)
  - Tips declaration (pre-filled from system)
  - "Close Shift" button in POS menu dropdown

### Added - Closed Orders View
- Toggle between "Open" and "Closed" in Open Orders panel
- `/api/orders/closed` - Returns today's paid/closed orders
- Closed orders show "Paid" badge
- Filter by employee (All/Mine) works for both views

### Added - Split Check Navigation (Skill 14 Enhancement)
- `navigate_splits` mode in SplitCheckModal
- When clicking "Split" on already-split order, shows existing splits
- Click any split to navigate to it and take payment
- "Split Further" option to create additional splits
- Navigation shows paid/unpaid status for each split
- `onNavigateToSplit` callback to load split orders

### Added - Employee Reports (Skill 74)
- `/api/reports/employees` - Employee performance reporting
- Sales by employee with tips, payments, commission
- Hours worked from TimeClockEntry
- Cash/card payment breakdown
- Purse balance calculation (cash received - cash owed)
- Three views: By Employee, By Day, Purse/Cash Out
- `/app/(admin)/reports/employees/page.tsx` - UI with tabs

### Fixed - Split Check Payment Flow
- Pay button now enabled for split orders (orders with total but no items)
- `handleOpenPayment` allows payment for split orders
- Payment modal uses stored total for split orders
- Split order display shows "Split Check" info instead of "No items"

### Fixed - Order Closing After Payment
- Orders now set `closedAt` timestamp when fully paid
- Split child orders properly marked as paid/closed
- When all split orders are paid, parent order auto-closes

### Fixed - Commission Report
- Added required `locationId` filter
- Updated UI to pass `employee.location.id`

---

## [2026-01-27] Session 1 - Earlier Today

### Added

#### KDS Display (Skill 23) - 2026-01-27
- `src/app/api/kds/route.ts` - KDS orders API:
  - GET orders filtered by station (using PrepStation routing)
  - Items filtered by prepStationId (item override > category assignment)
  - Time status calculation (fresh < 8min, aging 8-15min, late > 15min)
  - PUT to mark items complete/uncomplete/bump order
- `src/app/(kds)/kds/page.tsx` - Full KDS display:
  - Dark theme optimized for kitchen monitors
  - Order cards with time status color (green/yellow/red with pulse)
  - Order type badges (dine in, takeout, delivery, bar)
  - Item click to bump (complete), click again to uncomplete
  - Modifier display in yellow
  - Special notes display in orange with warning icon
  - "BUMP ORDER" button to complete all items at once
  - Station selector dropdown
  - Show/hide completed toggle
  - Fullscreen mode support
  - Auto-refresh every 5 seconds
  - Live clock display in footer
  - Link from POS menu dropdown
- `src/app/(kds)/layout.tsx` - KDS route group layout

#### Prep Stations / KDS Routing (New Skill) - 2026-01-27
- Database schema: `PrepStation` model for kitchen routing
  - Station types: kitchen, bar, expo, prep
  - Category and item assignment relations
  - Display settings (showAllItems for expo, autoComplete)
- `src/app/api/prep-stations/route.ts` - List/create stations
- `src/app/api/prep-stations/[id]/route.ts` - Get/update/delete, assign categories
- `src/app/(admin)/prep-stations/page.tsx` - Admin UI:
  - Station cards with type badges
  - Color customization
  - Assignment modal for categories and item overrides
  - Expo mode toggle (show all items)
- Link in POS menu dropdown

#### Clock In/Out (Skill 47) - 2026-01-27
- Uses existing `TimeClockEntry` schema
- `src/app/api/time-clock/route.ts` - Time clock API:
  - Clock in/out
  - Start/end break
  - Automatic hours calculation (regular + overtime)
  - Entry listing with filters
- `src/components/time-clock/TimeClockModal.tsx` - Time clock UI:
  - Live elapsed time display
  - Clock in/out buttons
  - Break start/end
  - Shift summary on clock out (hours, pay estimate)
- Accessible from POS menu dropdown

#### Sales Reports (Skill 42) - 2026-01-27
- `src/app/api/reports/sales/route.ts` - Sales report API:
  - Summary metrics (gross sales, net, tax, tips, order count, avg order value)
  - Payment method breakdown (cash vs card with percentages)
  - Sales by day with orders, gross, tax, tips, net totals
  - Sales by hour with visual bar chart
  - Sales by category with quantity and percentage
  - Top 20 selling items
  - Sales by employee with percentage of total
  - Date range filtering
- `src/app/(admin)/reports/sales/page.tsx` - Sales report UI:
  - Tabbed interface (Summary, By Day, By Hour, Categories, Top Items, Employees)
  - Summary cards with key metrics
  - Payment method visualization
  - Daily sales table with totals
  - Hourly bar chart visualization
  - Category and item tables
  - Employee sales ranking
- Link added to POS menu dropdown

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

## Skills Implementation Status (Updated 2026-01-28)

**Total: 65 Done / 3 Partial / 7 Todo = 91% Complete**

### Core POS (100% Complete)
| Skill | Name | Status |
|-------|------|--------|
| 01 | Employee Management | Done |
| 02 | Quick Order Entry | Done |
| 03 | Menu Display | Done |
| 04 | Modifiers | Done |
| 06 | Tipping | Done |
| 07 | Send to Kitchen | Done |
| 08 | Receipt Printing | Done |
| 09 | Features & Config | Done |
| 10 | Item Notes | Done |

### Payments (100% Complete)
| Skill | Name | Status |
|-------|------|--------|
| 30 | Payment Processing | Done |
| 31 | Dual Pricing | Done |
| 32 | Gift Cards | Done |
| 33 | House Accounts | Done |
| 52 | Loyalty Program | Done |

### Order Features (100% Complete)
| Skill | Name | Status |
|-------|------|--------|
| 11 | Seat Tracking | Done |
| 12 | Course Firing | Done |
| 13 | Hold & Fire | Done |
| 14 | Order Splitting | Done |
| 15 | Order Merging | Done |

### Tables & Reservations (100% Complete)
| Skill | Name | Status |
|-------|------|--------|
| 16 | Table Layout | Done |
| 17 | Table Status | Done |
| 18 | Table Transfer | Done |
| 19 | Reservations | Done |

### Bar Features (100% Complete)
| Skill | Name | Status |
|-------|------|--------|
| 20 | Bar Tabs | Done |
| 21 | Pre-auth | Done |
| 22 | Tab Transfer | Done |

### Kitchen (60% Complete)
| Skill | Name | Status |
|-------|------|--------|
| 67 | Prep Stations | Done |
| 23 | KDS Display | Done |
| 25 | Expo Station | Partial |
| 24 | Bump Bar | Todo |
| 26 | Prep Tickets | Todo |

### Pricing & Discounts (100% Complete)
| Skill | Name | Status |
|-------|------|--------|
| 27 | Happy Hour | Done |
| 28 | Discounts | Done |
| 29 | Commissioned Items | Done |
| 34 | Comps & Voids | Done |
| 35 | Coupons | Done |

### Reports (100% Complete)
| Skill | Name | Status |
|-------|------|--------|
| 42 | Sales Reports | Done |
| 43 | Labor Reports | Done |
| 44 | Product Mix | Done |
| 45 | Void Reports | Done |
| 46 | Commission Reports | Done |
| 70 | Discount Reports | Done |
| 71 | Transfer Reports | Done |
| 72 | Table Reports | Done |
| 73 | Customer Reports | Done |

### Employee & Customer (88% Complete)
| Skill | Name | Status |
|-------|------|--------|
| 47 | Clock In/Out | Done |
| 48 | Breaks | Done |
| 49 | Cash Drawer | Partial |
| 50 | Shift Close | Done |
| 51 | Customer Profiles | Done |

### Not Started
- 53-54: Online Ordering
- 55-58: Hardware Integration
- 59: Location Multi-tenancy
- 60: Offline Mode
- 66: Quick Reorder

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

Based on development, these skills have been added to the index:

| Skill # | Name | Status | Dependencies |
|---------|------|--------|--------------|
| 61 | Open Orders View | Done | 02 |
| 62 | Order Updates | Done | 02, 07 |
| 63 | Resend to Kitchen | Done | 07, 23 |
| 64 | KDS ↔ POS Sync | Done | 23 |
| 65 | Order History | Todo | 02, 30 |
| 66 | Quick Reorder | Todo | 65, 51 |
| 67 | Prep Stations | Done | - |
| 68 | Item Transfer | Done | 02 |
| 69 | Split Item Payment | Done | 14, 30 |
| 70 | Discount Reports | Done | 28 |
| 71 | Transfer Reports | Done | 22, 68 |
| 72 | Table Reports | Done | 16, 42 |
| 73 | Customer Reports | Done | 51 |
| 74 | Employee Reports | Done | 47, 30 |
| 75 | Closed Orders View | Done | 02, 30 |
| 76 | Course/Seat Management UI | Todo | 11, 12 |
| 77 | Hold & Fire UI | Todo | 13 |
| 78 | Coupon Reports | Done | 35 |
| 79 | Reservation Reports | Done | 19 |
| 80 | Floor Plan Editor | Done | 16 |
| 81 | Timed Rentals | Done | 03 |
| 82 | Login Redirect | Done | 09 |
| 83 | Category Types | Done | 09 |
| 84 | Combo Price Overrides | Done | 41 |
| 85 | Entertainment Item Builder | Done | 81, 83 |
| 86 | Combo Selection Modal | Done | 41 |
| 87 | Conditional Item Builders | Done | 83 |

---

## Deployment History

| Date | Version | URL | Notes |
|------|---------|-----|-------|
| 2026-01-28 | - | https://gwi-pos.vercel.app | Session 11: Category types, entertainment builder, combo pricing fix |
| 2026-01-28 | - | https://gwi-pos.vercel.app | Session 10: Combo system redesign (item-based), modifierId optional |
| 2026-01-27 | - | https://gwi-pos.vercel.app | Session 9: Timed rentals POS integration, combo CRUD |
| 2026-01-27 | - | https://gwi-pos.vercel.app | Floor plan editor, timed rentals, tax rules, inventory, alerts, breaks |
| 2026-01-27 | - | https://gwi-pos.vercel.app | Fixed layout scrolling, roles permissions array fix |
| 2026-01-27 | - | https://gwi-pos.vercel.app | Open orders panel, sent item tracking, order updates |
| 2026-01-27 | - | https://gwi-pos.vercel.app | Fix order creation, send to kitchen, payments |
| 2026-01-27 | - | https://gwi-pos.vercel.app | Initial dual pricing, commission, settings |
