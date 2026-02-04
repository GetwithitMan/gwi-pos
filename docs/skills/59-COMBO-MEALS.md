# 59 - Combo Meals & Bundles

**Status:** Planning
**Priority:** High
**Dependencies:** 03-Menu-Programming, 04-Order-Management

---

## Overview

The Combo Meals skill enables creation of bundled menu items with component choices at a set price. Build combos like "Burger + Side + Drink = $16" where guests choose their specific items within each component category. Supports forced combos, optional upgrades, and automatic savings display.

**Primary Goal:** Streamline combo ordering with clear component selection while maximizing value perception and kitchen clarity.

---

## User Stories

### As a Server...
- I want to quickly ring combos
- I want easy component selection
- I want to upgrade components (large fries, premium drink)
- I want combos to print clearly in kitchen

### As a Guest...
- I want to see combo savings
- I want to choose my sides and drinks
- I want to upgrade if I want
- I want to know what's included

### As a Manager...
- I want to create combo templates
- I want to control component options
- I want to track combo vs. a la carte sales
- I want to set combo-specific pricing

---

## Features

### Combo Builder

#### Combo Structure
```yaml
combo_template:
  burger_combo:
    name: "Classic Burger Combo"
    base_price: 16.00
    savings_display: "Save $3.00!"

    components:
      - slot: "entree"
        name: "Choose Your Burger"
        required: true
        default: "classic_burger"
        options:
          - item_id: "classic_burger"
            upcharge: 0
          - item_id: "bacon_burger"
            upcharge: 1.50
          - item_id: "mushroom_swiss"
            upcharge: 2.00
          - item_id: "veggie_burger"
            upcharge: 0

      - slot: "side"
        name: "Choose Your Side"
        required: true
        default: "fries"
        options:
          - item_id: "fries"
            upcharge: 0
          - item_id: "onion_rings"
            upcharge: 1.00
          - item_id: "side_salad"
            upcharge: 0
          - item_id: "sweet_potato_fries"
            upcharge: 1.50

      - slot: "drink"
        name: "Choose Your Drink"
        required: true
        default: "fountain_soda"
        options:
          - item_id: "fountain_soda"
            upcharge: 0
          - item_id: "iced_tea"
            upcharge: 0
          - item_id: "lemonade"
            upcharge: 0
          - item_id: "milkshake"
            upcharge: 2.50
          - item_id: "craft_beer"
            upcharge: 4.00
```

### Combo Selection Interface

#### Combo Order Flow
```
+------------------------------------------------------------------+
| BURGER COMBO                                           $16.00     |
+------------------------------------------------------------------+
|                                                                   |
| 1. CHOOSE YOUR BURGER *                                          |
| +--------------------------------------------------------------+ |
| | (•) Classic Burger                              Included      | |
| | ( ) Bacon Cheeseburger                          +$1.50        | |
| | ( ) Mushroom Swiss                              +$2.00        | |
| | ( ) Veggie Burger                               Included      | |
| +--------------------------------------------------------------+ |
|                                                                   |
| 2. CHOOSE YOUR SIDE *                                            |
| +--------------------------------------------------------------+ |
| | (•) French Fries                                Included      | |
| | ( ) Onion Rings                                 +$1.00        | |
| | ( ) Side Salad                                  Included      | |
| | ( ) Sweet Potato Fries                          +$1.50        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| 3. CHOOSE YOUR DRINK *                                           |
| +--------------------------------------------------------------+ |
| | (•) Fountain Soda                               Included      | |
| | ( ) Iced Tea                                    Included      | |
| | ( ) Lemonade                                    Included      | |
| | ( ) Milkshake                                   +$2.50        | |
| | ( ) Craft Beer                                  +$4.00        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| CUSTOMIZE ITEMS                                                   |
| [Burger Mods]  [Side Mods]  [Drink Mods]                         |
|                                                                   |
| ─────────────────────────────────────────────────────────────    |
| Combo Base:                                          $16.00      |
| Upgrades:                                            +$0.00      |
| ─────────────────────────────────────────────────────────────    |
| COMBO TOTAL:                                         $16.00      |
| You Save: $3.00 vs. ordering separately!                        |
|                                                                   |
| [Cancel]                                    [Add Combo to Order] |
+------------------------------------------------------------------+
```

#### Quick Combo (Default Selections)
```
+------------------------------------------------------------------+
| QUICK COMBOS                                                      |
+------------------------------------------------------------------+
|                                                                   |
| Tap to add with default selections, or hold to customize:        |
|                                                                   |
| +------------------+ +------------------+ +------------------+    |
| | 🍔               | | 🍗               | | 🌮               |    |
| | Burger Combo     | | Chicken Combo    | | Taco Combo       |    |
| | $16.00           | | $14.00           | | $12.00           |    |
| |                  | |                  | |                  |    |
| | Classic Burger   | | Grilled Chicken  | | 3 Tacos          |    |
| | Fries            | | Fries            | | Chips & Salsa    |    |
| | Fountain Soda    | | Fountain Soda    | | Fountain Soda    |    |
| |                  | |                  | |                  |    |
| | [Add Default]    | | [Add Default]    | | [Add Default]    |    |
| | [Customize]      | | [Customize]      | | [Customize]      |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
+------------------------------------------------------------------+
```

### Combo with Modifiers

#### Item-Level Modifiers Within Combo
```
+------------------------------------------------------------------+
| CUSTOMIZE: Classic Burger (in combo)                              |
+------------------------------------------------------------------+
|                                                                   |
| TEMPERATURE                                                       |
| (•) Medium  ( ) Medium-Well  ( ) Well Done                       |
|                                                                   |
| CHEESE                                                            |
| (•) American  ( ) Cheddar  ( ) Swiss  ( ) No Cheese              |
|                                                                   |
| TOPPINGS (included)                                               |
| [✓] Lettuce  [✓] Tomato  [✓] Onion  [✓] Pickle                  |
|                                                                   |
| ADD-ONS                                                           |
| [ ] Extra Patty                                      +$4.00      |
| [ ] Bacon                                            +$2.00      |
| [ ] Avocado                                          +$1.50      |
| [ ] Fried Egg                                        +$1.50      |
|                                                                   |
| [Cancel]                                    [Save & Return]       |
+------------------------------------------------------------------+
```

### Combo Types

#### Fixed Combo
```yaml
fixed_combo:
  name: "Family Meal Deal"
  price: 45.00
  description: "Feeds 4-6 people"

  includes:
    - item: "whole_chicken"
      quantity: 1
      modifiable: false

    - item: "large_side"
      quantity: 3
      choices: ["mashed_potatoes", "coleslaw", "corn", "mac_cheese"]

    - item: "biscuits"
      quantity: 6
      modifiable: false

    - item: "gallon_drink"
      quantity: 1
      choices: ["tea", "lemonade"]
```

#### Build-Your-Own Combo
```yaml
build_your_own:
  name: "Pick 3 Appetizers"
  price: 24.00
  savings: "Save $8!"

  rules:
    pick_count: 3
    from_category: "appetizers"
    allowed_items:
      - "wings_6pc"
      - "mozzarella_sticks"
      - "loaded_nachos"
      - "spinach_dip"
      - "onion_rings"
      - "quesadilla"

    restrictions:
      max_same_item: 2  # Can't pick same item 3 times
```

#### Kids Combo
```yaml
kids_combo:
  name: "Kids Meal"
  price: 8.00
  age_restriction: "12 and under"

  components:
    - slot: "entree"
      options:
        - "kids_burger"
        - "kids_nuggets"
        - "kids_grilled_cheese"
        - "kids_mac_cheese"

    - slot: "side"
      options:
        - "kids_fries"
        - "apple_slices"
        - "kids_salad"

    - slot: "drink"
      options:
        - "kids_soda"
        - "milk"
        - "juice_box"
        - "chocolate_milk"

    - slot: "treat"
      options:
        - "cookie"
        - "ice_cream_cup"
```

### Display on Order/Ticket

#### Order Display
```
+------------------------------------------------------------------+
| ORDER - Table 5                                    Total: $34.50  |
+------------------------------------------------------------------+
|                                                                   |
| +--------------------------------------------------------------+ |
| | 🎁 Burger Combo                                       $18.50  | |
| |   ├─ Bacon Cheeseburger (+$1.50)                              | |
| |   │    Medium, American, No Onion                             | |
| |   │    + Extra Bacon (+$1.00)                                 | |
| |   ├─ Sweet Potato Fries (+$1.50)                              | |
| |   └─ Craft Beer (+$4.00)                                      | |
| |                                            [Edit] [Remove]    | |
| +--------------------------------------------------------------+ |
| | 🎁 Burger Combo                                       $16.00  | |
| |   ├─ Classic Burger                                           | |
| |   ├─ French Fries                                             | |
| |   └─ Iced Tea                                                 | |
| |                                            [Edit] [Remove]    | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

#### Kitchen Ticket
```
============================================
           TICKET #1247
            TABLE 5
============================================

*** COMBO ***
1x  BACON CHEESEBURGER
    Medium
    American Cheese
    NO Onion
    + Extra Bacon

1x  SWEET POTATO FRIES

*** COMBO ***
1x  CLASSIC BURGER
    (Standard build)

1x  FRENCH FRIES

============================================
```

### Combo Analytics

```
+------------------------------------------------------------------+
| COMBO PERFORMANCE                                  This Month     |
+------------------------------------------------------------------+
|                                                                   |
| TOP COMBOS                                                        |
| +--------------------------------------------------------------+ |
| | Combo             | Sold  | Revenue  | % of Sales | Avg Check | |
| +--------------------------------------------------------------+ |
| | Burger Combo      | 847   | $14,399  | 32%        | $17.00    | |
| | Chicken Combo     | 623   | $9,345   | 24%        | $15.00    | |
| | Kids Meal         | 412   | $3,296   | 16%        | $8.00     | |
| | Family Meal       | 89    | $4,005   | 4%         | $45.00    | |
| +--------------------------------------------------------------+ |
|                                                                   |
| UPGRADE ANALYSIS                                                  |
| +--------------------------------------------------------------+ |
| | Upgrade             | Times Added | Revenue  | % Upgrade     | |
| +--------------------------------------------------------------+ |
| | Bacon Burger        | 245         | $367.50  | 29%           | |
| | Onion Rings         | 312         | $312.00  | 37%           | |
| | Milkshake           | 189         | $472.50  | 22%           | |
| | Craft Beer          | 156         | $624.00  | 18%           | |
| +--------------------------------------------------------------+ |
|                                                                   |
| COMBO vs. A LA CARTE                                              |
| +--------------------------------------------------------------+ |
| | Metric                    | Combo Orders | A La Carte        | |
| +--------------------------------------------------------------+ |
| | Average Check             | $24.50       | $18.75            | |
| | Items per Order           | 4.2          | 2.8               | |
| | Guest Satisfaction        | 4.6/5        | 4.4/5             | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Data Model

### Combo Templates
```sql
combo_templates {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Identity
  name: VARCHAR(200)
  display_name: VARCHAR(200)
  description: TEXT (nullable)
  image_url: VARCHAR(500) (nullable)

  -- Pricing
  base_price: DECIMAL(10,2)
  compare_price: DECIMAL(10,2) (nullable)  -- A la carte total for savings display

  -- Category
  category_id: UUID (FK)
  menu_position: INTEGER

  -- Rules
  combo_type: VARCHAR(50)  -- fixed, configurable, build_your_own
  min_components: INTEGER DEFAULT 1
  max_components: INTEGER (nullable)

  -- Status
  is_active: BOOLEAN DEFAULT true
  available_start: TIME (nullable)
  available_end: TIME (nullable)
  available_days: INTEGER[]

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Combo Components
```sql
combo_components {
  id: UUID PRIMARY KEY
  combo_template_id: UUID (FK)

  -- Slot
  slot_name: VARCHAR(100)  -- "entree", "side", "drink"
  display_name: VARCHAR(100)  -- "Choose Your Side"
  slot_order: INTEGER

  -- Requirements
  is_required: BOOLEAN DEFAULT true
  min_selections: INTEGER DEFAULT 1
  max_selections: INTEGER DEFAULT 1

  -- Default
  default_item_id: UUID (FK, nullable)

  created_at: TIMESTAMP
}
```

### Combo Component Options
```sql
combo_component_options {
  id: UUID PRIMARY KEY
  combo_component_id: UUID (FK)

  item_id: UUID (FK)
  upcharge: DECIMAL(10,2) DEFAULT 0

  display_order: INTEGER
  is_available: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Order Combos
```sql
order_combos {
  id: UUID PRIMARY KEY
  order_id: UUID (FK)
  combo_template_id: UUID (FK)

  -- Pricing
  base_price: DECIMAL(10,2)
  total_upcharges: DECIMAL(10,2) DEFAULT 0
  total_price: DECIMAL(10,2)

  -- Status
  quantity: INTEGER DEFAULT 1

  created_at: TIMESTAMP
}
```

### Order Combo Items
```sql
order_combo_items {
  id: UUID PRIMARY KEY
  order_combo_id: UUID (FK)
  combo_component_id: UUID (FK)

  -- Selected item
  item_id: UUID (FK)
  item_name: VARCHAR(200)

  -- Pricing
  upcharge: DECIMAL(10,2) DEFAULT 0

  -- Modifiers (if any)
  modifiers: JSONB (nullable)
  modifier_total: DECIMAL(10,2) DEFAULT 0

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Combo Templates
```
GET    /api/combos
GET    /api/combos/{id}
POST   /api/combos
PUT    /api/combos/{id}
DELETE /api/combos/{id}
```

### Combo Components
```
GET    /api/combos/{id}/components
POST   /api/combos/{id}/components
PUT    /api/combo-components/{id}
DELETE /api/combo-components/{id}
```

### Ordering
```
POST   /api/orders/{id}/combos
PUT    /api/order-combos/{id}
DELETE /api/order-combos/{id}
GET    /api/orders/{id}/combos
```

### Analytics
```
GET    /api/combos/analytics
GET    /api/combos/analytics/upgrades
GET    /api/combos/analytics/performance
```

---

## Business Rules

1. **Required Components:** Can't add combo without required selections
2. **Upcharge Display:** Always show upcharges clearly
3. **Savings Display:** Show savings vs. a la carte when applicable
4. **Modifier Pricing:** Item modifiers add to combo total
5. **Kitchen Clarity:** Print combo items clearly grouped
6. **Availability:** Combo unavailable if any required item is 86'd

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| Order combos | Yes | Yes | Yes |
| View combo analytics | No | Yes | Yes |
| Create/edit combos | No | Yes | Yes |
| Delete combos | No | No | Yes |
| Set combo pricing | No | Yes | Yes |

---

## Configuration Options

```yaml
combo_meals:
  display:
    show_savings: true
    savings_format: "Save $X!"
    show_compare_price: true
    combo_icon: "🎁"

  ordering:
    allow_quick_add: true  # Add with defaults
    require_all_selections: true
    allow_duplicate_items: false

  kitchen:
    group_on_ticket: true
    label_as_combo: true
    print_item_details: true

  analytics:
    track_upgrades: true
    track_vs_alacarte: true
```

---

*Last Updated: January 27, 2026*
