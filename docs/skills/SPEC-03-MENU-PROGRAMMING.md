# 03 - Menu Programming

**Status:** Planning
**Priority:** Critical
**Dependencies:** 09-Features-Config

---

## Overview

The Menu Programming skill handles all aspects of building and managing the restaurant's menu - categories, items, pricing, and the **critically important modifier system**. This is one of the most complex skills because modifiers can be nested multiple levels deep.

**Primary Goal:** Provide an intuitive interface for building complex menus with nested modifiers while keeping the end-user ordering experience simple.

---

## User Stories

### As a Restaurant Owner/Manager...
- I want to organize my menu into logical categories and subcategories
- I want to add items with descriptions, prices, and images
- I want to create modifier groups that apply to multiple items
- I want to set up complex modifiers (modifiers that modify modifiers)
- I want to control which items are available at different times
- I want to 86 items quickly when we run out
- I want to bulk update prices across categories

### As a Server (User of the Menu)...
- I want to find items quickly
- I want clear guidance on required vs optional modifiers
- I want to see modifier prices clearly
- I want to understand what's included vs extra charge

---

## Features

### Category Management

#### Category Hierarchy
```
Level 1: Category (e.g., "Food", "Drinks")
  Level 2: Sub-Category (e.g., "Appetizers", "Entrees")
    Level 3: Sub-Sub-Category (e.g., "Shareables", "Individual")
      Level 4+: Supported but not recommended
```

#### Category Properties
- [ ] Name
- [ ] Description (optional)
- [ ] Image/Icon (optional)
- [ ] Color (for visual identification)
- [ ] Sort order
- [ ] Parent category (for nesting)
- [ ] Availability schedule (time-based)
- [ ] Order type restrictions (dine-in, online, etc.)
- [ ] Active/Inactive status

#### Category Operations
- [ ] Create category
- [ ] Edit category
- [ ] Delete category (with item reassignment)
- [ ] Reorder categories (drag-and-drop)
- [ ] Duplicate category
- [ ] Move category (change parent)
- [ ] Bulk operations

### Item Management

#### Basic Item Properties
- [ ] **Name** - Display name (e.g., "Classic Cheeseburger")
- [ ] **Short Name** - For tickets/KDS (e.g., "Cheese Burg")
- [ ] **Description** - Customer-facing description
- [ ] **Price** - Base price
- [ ] **SKU/PLU** - Unique identifier code
- [ ] **Image** - Product photo
- [ ] **Category** - Parent category assignment

#### Pricing Options
- [ ] Single price
- [ ] Multiple sizes with prices (S/M/L)
- [ ] Time-based pricing (Happy Hour)
- [ ] Order-type pricing (online vs dine-in)
- [ ] Price levels (different menus)

#### Availability Controls
- [ ] Active/Inactive toggle
- [ ] 86'd (temporarily unavailable)
- [ ] Schedule (available only certain hours/days)
- [ ] Order type (dine-in only, online only, etc.)
- [ ] Stock-based (ties to inventory)

#### Kitchen/Operational
- [ ] Print destination(s) - Kitchen, Bar, Expo
- [ ] Prep time (for online ordering)
- [ ] Course assignment (App, Main, Dessert)
- [ ] Fire separately flag

#### Metadata
- [ ] Tax category
- [ ] Cost (for reporting)
- [ ] Allergens (nuts, dairy, gluten, etc.)
- [ ] Dietary tags (vegan, vegetarian, GF)
- [ ] Calories
- [ ] Age-restricted (alcohol)

### Modifier System (CRITICAL)

This is the most complex part of menu programming. Must be extremely well-designed.

#### Modifier Groups

A **Modifier Group** is a collection of related options (e.g., "Cooking Temperature").

**Group Properties:**
- [ ] **Name** - Display name
- [ ] **Internal Name** - For reporting (optional)
- [ ] **Required** - Must select something (yes/no)
- [ ] **Min Selections** - Minimum choices required
- [ ] **Max Selections** - Maximum choices allowed (0 = unlimited)
- [ ] **Free Selections** - Number of free choices before upcharge
- [ ] **Display Style** - How to show in POS (buttons, list, grid)
- [ ] **Sort Order** - Order relative to other groups on item

**Group Types:**
1. **Standard** - Select from options (e.g., temperature)
2. **Add-On** - Add extras (e.g., toppings)
3. **Remove** - Remove ingredients (e.g., "No onion")
4. **Substitution** - Swap one thing for another
5. **Side Choice** - Pick accompanying item
6. **Combo Builder** - Build a meal

#### Modifiers

A **Modifier** is a single option within a group (e.g., "Medium Rare").

**Modifier Properties:**
- [ ] **Name** - Display name
- [ ] **Short Name** - For tickets
- [ ] **Price Adjustment** - +$0.00, +$1.50, -$2.00
- [ ] **Default** - Pre-selected by default
- [ ] **Active** - Available for selection
- [ ] **Nested Modifier Groups** - Modifiers can have their own groups!

#### Nested Modifiers (Modifier Modifiers)

**Example Scenario:**
```
Item: Burger ($14.99)
├── Group: Cheese (Required, Max 1)
│   ├── No Cheese ($0)
│   ├── American ($0)
│   ├── Cheddar ($0)
│   └── Blue Cheese (+$1.00)
│       └── Group: Blue Cheese Prep (Optional)
│           ├── Crumbled
│           └── Melted
├── Group: Cooking Temperature (Required)
│   ├── Rare
│   ├── Medium Rare
│   ├── Medium
│   ├── Medium Well
│   └── Well Done
└── Group: Add-Ons (Optional, Max 5, First 2 Free)
    ├── Bacon (+$2.00)
    │   └── Group: Bacon Prep (Optional)
    │       ├── Crispy
    │       └── Regular
    ├── Avocado (+$2.50)
    ├── Fried Egg (+$1.50)
    └── Extra Patty (+$5.00)
        └── Group: Extra Patty Temp (Required)
            ├── Same as main
            ├── Rare
            ├── Medium
            └── Well Done
```

**Nesting Rules:**
- [ ] Modifiers can contain modifier groups (1 level of nesting)
- [ ] Those modifier groups contain modifiers (2 levels)
- [ ] Those modifiers can contain modifier groups (3 levels)
- [ ] **Recommended max depth: 3 levels**
- [ ] Configurable depth limit per location

#### Modifier Templates (Reusable Groups)

To avoid recreating the same modifier groups for multiple items:

- [ ] Create "template" modifier groups (e.g., "Cooking Temperature")
- [ ] Link template to multiple items
- [ ] Changes to template update all linked items
- [ ] Option to "unlink" and create item-specific version
- [ ] Template library management

**Template Examples:**
- Cooking Temperature (for all proteins)
- Salad Dressings (for all salads)
- Side Choices (for all entrees)
- Bread Choices (for all sandwiches)
- Milk Options (for all coffee drinks)

#### Modifier Pricing Logic

**Pricing Modes:**
- [ ] **Fixed Price** - Always +$1.50
- [ ] **Size-Based** - Different price per item size
- [ ] **Quantity-Based** - Price per each after free amount
- [ ] **Included Then Extra** - First 2 free, then $0.50 each

**Price Display:**
- Show +$0.00 or just blank for no-charge modifiers?
- Show prices on buttons or only after selection?
- Configurable per location

### Menu Builder UI

#### Visual Editor
- [ ] Drag-and-drop category organization
- [ ] Drag-and-drop item reordering
- [ ] Visual modifier group builder
- [ ] Preview of how item appears on POS
- [ ] Preview of full modifier flow

#### Bulk Operations
- [ ] Select multiple items
- [ ] Bulk price change (% or $)
- [ ] Bulk category assignment
- [ ] Bulk modifier group assignment
- [ ] Bulk availability change
- [ ] Bulk 86/un-86

#### Import/Export
- [ ] CSV import (items, basic info)
- [ ] CSV export
- [ ] JSON export (full menu with modifiers)
- [ ] Duplicate entire menu
- [ ] Copy from another location

#### Search & Filter
- [ ] Search by name
- [ ] Filter by category
- [ ] Filter by availability
- [ ] Filter by price range
- [ ] Filter by tag (allergens, dietary)
- [ ] Filter by modifier group usage

---

## UI/UX Specifications

### Menu Structure View

```
+------------------------------------------------------------------+
| MENU BUILDER                                    [+ New Category] |
+------------------------------------------------------------------+
|                                                                  |
| CATEGORIES                    | ITEMS IN: Appetizers             |
| ├── Food                     |                                   |
| │   ├── Appetizers  [active] | [+ New Item]  [Bulk Edit]        |
| │   │   ├── Shareables      |                                   |
| │   │   └── Individual      | +--------+ +--------+ +--------+  |
| │   ├── Salads              | | Wings  | | Nachos | | Calamari| |
| │   ├── Entrees             | | $12.99 | | $10.99 | | $14.99  | |
| │   │   ├── Beef            | | [Edit] | | [Edit] | | [Edit]  | |
| │   │   ├── Chicken         | +--------+ +--------+ +--------+  |
| │   │   └── Seafood         |                                   |
| │   └── Desserts            | +--------+ +--------+              |
| ├── Drinks                  | | Soup   | | Bread  |              |
| │   ├── Beer                | | $6.99  | | $4.99  |              |
| │   ├── Wine                | +--------+ +--------+              |
| │   ├── Cocktails           |                                   |
| │   └── Non-Alcoholic       |                                   |
| └── [+ Category]            |                                   |
|                             |                                   |
+------------------------------------------------------------------+
```

### Item Editor

```
+------------------------------------------------------------------+
| EDIT ITEM: Classic Cheeseburger                         [Save]   |
+------------------------------------------------------------------+
| BASIC INFO                  | MODIFIERS                          |
| Name: [Classic Cheeseburger]| [+ Add Modifier Group]             |
| Short: [Cheese Burg       ] |                                    |
| Price: [$14.99            ] | ┌─ Cheese (Required) ─────────────┐|
| Category: [Entrees > Beef ] | │ ○ No Cheese    ○ American      │|
| [Upload Image]              | │ ○ Cheddar      ○ Blue (+$1)    │|
|                             | │ [Edit Group] [Remove]           │|
| AVAILABILITY                | └─────────────────────────────────┘|
| ☑ Active                    |                                    |
| ☐ 86'd                      | ┌─ Temperature (Required) ────────┐|
| Schedule: [Always        ]  | │ ○ Rare   ○ Med-Rare  ○ Medium  │|
|                             | │ ○ Med-Well  ○ Well Done        │|
| KITCHEN                     | │ [Edit Group] [Remove]           │|
| Print to: [Kitchen, Expo  ] | └─────────────────────────────────┘|
| Course: [Main             ] |                                    |
|                             | ┌─ Add-Ons (0-5, 2 free) ─────────┐|
| DETAILS                     | │ ☐ Bacon +$2   ☐ Avocado +$2.50 │|
| Description:                | │ ☐ Egg +$1.50  ☐ Patty +$5      │|
| [8oz beef patty with...]    | │ [Edit Group] [Remove]           │|
| Allergens: [Dairy, Gluten ] | └─────────────────────────────────┘|
| Calories: [850            ] |                                    |
+------------------------------------------------------------------+
```

### Modifier Group Editor

```
+------------------------------------------------------------------+
| MODIFIER GROUP: Cheese Options                                   |
+------------------------------------------------------------------+
| Name: [Cheese Options     ]                                      |
| Type: [Standard ▼]                                               |
|                                                                  |
| RULES                                                            |
| Required: [Yes ▼]    Min: [1]    Max: [1]    Free: [1]          |
|                                                                  |
| MODIFIERS                                          [+ Add]       |
| +------------------------------------------------------------+  |
| | Name          | Price  | Default | Nested Mods | Actions   |  |
| +------------------------------------------------------------+  |
| | No Cheese     | $0.00  | ☐       | -           | [Edit][×] |  |
| | American      | $0.00  | ☑       | -           | [Edit][×] |  |
| | Cheddar       | $0.00  | ☐       | -           | [Edit][×] |  |
| | Swiss         | $0.00  | ☐       | -           | [Edit][×] |  |
| | Blue Cheese   | +$1.00 | ☐       | [1 group]   | [Edit][×] |  |
| +------------------------------------------------------------+  |
|                                                                  |
| ☐ Save as Template (reusable across items)                      |
|                                                                  |
| [Cancel]                                         [Save Group]    |
+------------------------------------------------------------------+
```

---

## Data Model

### Categories
```sql
menu_categories {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  parent_id: UUID (FK, self-referential, nullable)

  name: VARCHAR(100)
  description: TEXT (nullable)
  image_url: VARCHAR(500) (nullable)
  color: VARCHAR(7) (hex color, nullable)
  sort_order: INTEGER

  is_active: BOOLEAN DEFAULT true

  -- Availability
  available_start_time: TIME (nullable)
  available_end_time: TIME (nullable)
  available_days: INTEGER[] (0=Sun, 6=Sat, nullable)
  order_types: VARCHAR[] (dine_in, online, takeout, etc.)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Items
```sql
menu_items {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  category_id: UUID (FK)

  name: VARCHAR(200)
  short_name: VARCHAR(50) (nullable)
  description: TEXT (nullable)

  -- Pricing
  base_price: DECIMAL(10,2)
  cost: DECIMAL(10,2) (nullable, for margin calc)
  tax_category_id: UUID (FK, nullable)

  -- Media
  image_url: VARCHAR(500) (nullable)

  -- Identifiers
  sku: VARCHAR(50) (nullable)
  plu: VARCHAR(20) (nullable)
  barcode: VARCHAR(50) (nullable)

  -- Availability
  is_active: BOOLEAN DEFAULT true
  is_86: BOOLEAN DEFAULT false
  available_start_time: TIME (nullable)
  available_end_time: TIME (nullable)
  available_days: INTEGER[] (nullable)
  order_types: VARCHAR[]

  -- Kitchen
  print_destinations: VARCHAR[] (kitchen, bar, expo)
  default_course: VARCHAR(50) (nullable)
  prep_time_minutes: INTEGER (nullable)
  fire_separately: BOOLEAN DEFAULT false

  -- Metadata
  allergens: VARCHAR[]
  dietary_tags: VARCHAR[]
  calories: INTEGER (nullable)
  is_alcohol: BOOLEAN DEFAULT false

  sort_order: INTEGER
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Item Sizes (for size-based pricing)
```sql
menu_item_sizes {
  id: UUID PRIMARY KEY
  item_id: UUID (FK)

  name: VARCHAR(50) (Small, Medium, Large)
  short_name: VARCHAR(10) (S, M, L)
  price: DECIMAL(10,2)
  sort_order: INTEGER
  is_default: BOOLEAN DEFAULT false

  created_at: TIMESTAMP
}
```

### Modifier Groups
```sql
modifier_groups {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  internal_name: VARCHAR(100) (nullable)
  group_type: VARCHAR(50) (standard, addon, remove, substitution, side, combo)

  is_required: BOOLEAN DEFAULT false
  min_selections: INTEGER DEFAULT 0
  max_selections: INTEGER DEFAULT 0 (0 = unlimited)
  free_selections: INTEGER DEFAULT 0

  display_style: VARCHAR(50) (buttons, list, grid)
  sort_order: INTEGER

  is_template: BOOLEAN DEFAULT false

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Modifiers
```sql
modifiers {
  id: UUID PRIMARY KEY
  modifier_group_id: UUID (FK)

  name: VARCHAR(100)
  short_name: VARCHAR(50) (nullable)

  price_adjustment: DECIMAL(10,2) DEFAULT 0.00
  is_default: BOOLEAN DEFAULT false
  is_active: BOOLEAN DEFAULT true

  sort_order: INTEGER

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Item-Modifier Group Links
```sql
item_modifier_groups {
  id: UUID PRIMARY KEY
  item_id: UUID (FK)
  modifier_group_id: UUID (FK)

  sort_order: INTEGER

  -- Override group settings for this specific item
  is_required_override: BOOLEAN (nullable)
  min_override: INTEGER (nullable)
  max_override: INTEGER (nullable)
  free_override: INTEGER (nullable)

  created_at: TIMESTAMP
}
```

### Nested Modifier Groups (Modifiers that have their own modifier groups)
```sql
modifier_nested_groups {
  id: UUID PRIMARY KEY
  parent_modifier_id: UUID (FK to modifiers)
  modifier_group_id: UUID (FK to modifier_groups)

  sort_order: INTEGER

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Categories
```
GET    /api/locations/{loc}/menu/categories
POST   /api/locations/{loc}/menu/categories
GET    /api/locations/{loc}/menu/categories/{id}
PUT    /api/locations/{loc}/menu/categories/{id}
DELETE /api/locations/{loc}/menu/categories/{id}
PUT    /api/locations/{loc}/menu/categories/reorder
```

### Items
```
GET    /api/locations/{loc}/menu/items
POST   /api/locations/{loc}/menu/items
GET    /api/locations/{loc}/menu/items/{id}
PUT    /api/locations/{loc}/menu/items/{id}
DELETE /api/locations/{loc}/menu/items/{id}
POST   /api/locations/{loc}/menu/items/{id}/86
DELETE /api/locations/{loc}/menu/items/{id}/86
POST   /api/locations/{loc}/menu/items/bulk-update
PUT    /api/locations/{loc}/menu/items/reorder
```

### Modifier Groups
```
GET    /api/locations/{loc}/menu/modifier-groups
POST   /api/locations/{loc}/menu/modifier-groups
GET    /api/locations/{loc}/menu/modifier-groups/{id}
PUT    /api/locations/{loc}/menu/modifier-groups/{id}
DELETE /api/locations/{loc}/menu/modifier-groups/{id}
GET    /api/locations/{loc}/menu/modifier-groups/templates
```

### Modifiers
```
GET    /api/modifier-groups/{gid}/modifiers
POST   /api/modifier-groups/{gid}/modifiers
PUT    /api/modifier-groups/{gid}/modifiers/{id}
DELETE /api/modifier-groups/{gid}/modifiers/{id}
PUT    /api/modifier-groups/{gid}/modifiers/reorder
```

### Item-Modifier Assignments
```
GET    /api/items/{id}/modifier-groups
POST   /api/items/{id}/modifier-groups
DELETE /api/items/{id}/modifier-groups/{gid}
PUT    /api/items/{id}/modifier-groups/reorder
```

### Nested Modifiers
```
GET    /api/modifiers/{id}/nested-groups
POST   /api/modifiers/{id}/nested-groups
DELETE /api/modifiers/{id}/nested-groups/{gid}
```

### Import/Export
```
GET    /api/locations/{loc}/menu/export?format=csv|json
POST   /api/locations/{loc}/menu/import
POST   /api/locations/{loc}/menu/duplicate
```

---

## Business Rules

1. **Category Deletion:** Cannot delete category with items - must reassign or delete items first
2. **Circular Reference:** Cannot make a category its own parent/grandparent
3. **Modifier Depth:** Enforce configurable max depth (recommend 3)
4. **Template Updates:** When template modifier group is updated, propagate to all linked items
5. **86 Cascading:** When item is 86'd, it should be visible but not orderable
6. **Price Validation:** Prices must be >= 0 for items, can be negative for modifiers (discounts)
7. **Required Modifiers:** If a modifier group is required, at least one modifier must exist
8. **Default Modifier:** Only one modifier per group can be marked as default

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| View menu | Yes | Yes | Yes |
| 86 items | No | Yes | Yes |
| Edit items | No | Yes | Yes |
| Create items | No | Yes | Yes |
| Delete items | No | No | Yes |
| Edit categories | No | Yes | Yes |
| Edit modifier groups | No | Yes | Yes |
| Manage templates | No | Yes | Yes |
| Import/Export | No | No | Yes |

---

## Configuration Options

Located in: 09-FEATURES-CONFIG

```yaml
menu_programming:
  categories:
    max_depth: 4
    require_category_for_items: true

  items:
    require_price: true
    require_image: false
    require_description: false
    allow_negative_price: false

  modifiers:
    max_nesting_depth: 3
    allow_negative_price_adjustment: true
    show_zero_price: false

  availability:
    enable_time_based: true
    enable_day_based: true
    enable_order_type_based: true

  display:
    default_grid_size: "medium"
    show_images_in_admin: true
    show_sku: true
```

---

## Open Questions

1. **Modifier Inheritance:** Should nested modifiers inherit settings from parent group?

2. **Combo Building:** How complex should combo/meal deal building be? (Entree + Side + Drink)

3. **Dynamic Pricing:** Support for price changes based on day/time programmatically?

4. **Variant System:** Should we have a variant system (like Shopify) in addition to modifiers?

5. **Menu Versioning:** Save and restore previous menu versions?

6. **Cross-Location Menus:** Share menu templates across multiple locations?

7. **Ingredient Level:** Track modifiers at ingredient level for inventory deduction?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [x] Data model defined
- [ ] UI mockups created
- [ ] API contract reviewed

### Development
- [ ] Database migrations
- [ ] Category CRUD
- [ ] Item CRUD
- [ ] Modifier group management
- [ ] Nested modifier support
- [ ] Template system
- [ ] Menu builder UI
- [ ] Import/Export
- [ ] POS menu display

### Testing
- [ ] Unit tests
- [ ] API tests
- [ ] UI tests
- [ ] Complex modifier scenarios
- [ ] Performance with large menus

---

*Last Updated: January 27, 2026*
