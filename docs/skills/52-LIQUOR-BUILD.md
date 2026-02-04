# 52 - Liquor Build System

**Status:** Planning
**Priority:** Critical (Bar Operations)
**Dependencies:** 03-Menu-Programming, 10-Bar-Management, 07-Inventory

---

## Overview

The Liquor Build System enables cocktail ordering where the drink type (Margarita, Old Fashioned) is selected first, then the spirit/liquor is chosen from tiered options (Well, Call, Premium, Top Shelf). Unlike standard modifiers, the selected liquor is a trackable inventory item with pour tracking, cost reporting, and upsell analytics.

**Primary Goal:** Fast cocktail ordering with automatic upsell prompts, accurate pour tracking, and comprehensive liquor reporting - all while maintaining speed of service.

---

## The Problem This Solves

Traditional modifier systems treat "Patron instead of Well" as just a price adjustment. But bars need:

1. **Pour Tracking:** Know exactly how many shots of Patron vs. Well Tequila were poured
2. **Inventory Depletion:** Automatically reduce Patron inventory when selected
3. **Cost Analysis:** Track pour cost vs. revenue by spirit
4. **Upsell Reporting:** See how often servers upsell from Well to Premium
5. **Speed:** One tap to select tier, one tap to select specific brand

---

## User Stories

### As a Bartender...
- I want to ring a Margarita and quickly select the tequila
- I want default to Well but easy upsell to premium
- I want to see the price difference clearly
- I want keyboard shortcuts for common builds

### As a Server...
- I want to suggest premium options to guests
- I want to see what's available in each tier
- I want the price to update automatically
- I want to explain the difference to guests

### As a Manager...
- I want to track pours by specific bottle
- I want to see upsell success rates
- I want pour cost vs. revenue reports
- I want to know which spirits sell most

### As an Owner...
- I want to maximize revenue through upsells
- I want accurate liquor cost tracking
- I want to identify training opportunities
- I want to prevent over-pouring loss

---

## Features

### Drink Templates

#### Cocktail as Template
```yaml
drink_templates:
  margarita:
    name: "Margarita"
    base_spirit_category: "tequila"
    required_components:
      - type: "spirit"
        category: "tequila"
        pour_oz: 1.5
      - type: "liqueur"
        item: "triple_sec"
        pour_oz: 0.75
      - type: "mixer"
        item: "lime_juice"
        pour_oz: 1.0
    optional_components:
      - type: "liqueur"
        category: "orange_liqueur"  # Upgrade from Triple Sec to Cointreau/Grand Marnier
    modifiers:
      - "rocks"
      - "frozen"
      - "salt_rim"
      - "sugar_rim"
      - "no_rim"

  old_fashioned:
    name: "Old Fashioned"
    base_spirit_category: "whiskey"  # Includes bourbon, rye
    required_components:
      - type: "spirit"
        category: "whiskey"
        pour_oz: 2.0
      - type: "mixer"
        item: "simple_syrup"
        pour_oz: 0.25
      - type: "garnish"
        item: "bitters"
        dashes: 2
```

### Spirit Tiers

#### Tier Structure
```yaml
spirit_tiers:
  well:
    display_name: "Well"
    price_modifier: 0.00
    color: "#808080"  # Gray
    description: "House spirits"

  call:
    display_name: "Call"
    price_modifier: 2.00
    color: "#4A90D9"  # Blue
    description: "Name brand spirits"

  premium:
    display_name: "Premium"
    price_modifier: 4.00
    color: "#9B59B6"  # Purple
    description: "Top quality spirits"

  top_shelf:
    display_name: "Top Shelf"
    price_modifier: 8.00
    color: "#F1C40F"  # Gold
    description: "Finest available"

  ultra:
    display_name: "Ultra Premium"
    price_modifier: 15.00
    color: "#E74C3C"  # Red
    description: "Rare & exceptional"
```

### Spirit Categories

#### Category Definition
```yaml
spirit_categories:
  vodka:
    name: "Vodka"
    spirits:
      well: ["House Vodka"]
      call: ["Tito's", "Absolut", "Ketel One"]
      premium: ["Grey Goose", "Belvedere", "Chopin"]
      top_shelf: ["Ciroc", "Stolichnaya Elit"]

  tequila:
    name: "Tequila"
    subcategories: ["blanco", "reposado", "anejo"]
    spirits:
      well: ["House Tequila Blanco"]
      call: ["Espolon", "Olmeca Altos", "Casamigos"]
      premium: ["Patron Silver", "Don Julio Blanco", "Herradura"]
      top_shelf: ["Clase Azul", "Don Julio 1942", "Patron Gran Platinum"]

  whiskey:
    name: "Whiskey"
    subcategories: ["bourbon", "rye", "tennessee", "irish", "canadian"]
    spirits:
      well: ["House Bourbon"]
      call: ["Jim Beam", "Jack Daniel's", "Jameson", "Crown Royal"]
      premium: ["Maker's Mark", "Buffalo Trace", "Woodford Reserve", "Bulleit"]
      top_shelf: ["Blanton's", "Pappy Van Winkle", "Michter's", "WhistlePig"]

  rum:
    name: "Rum"
    subcategories: ["white", "gold", "dark", "spiced"]
    spirits:
      well: ["House White Rum"]
      call: ["Bacardi", "Captain Morgan", "Malibu"]
      premium: ["Mount Gay", "Appleton Estate", "Plantation"]
      top_shelf: ["Ron Zacapa", "Diplomatico", "El Dorado 15"]

  gin:
    name: "Gin"
    spirits:
      well: ["House Gin"]
      call: ["Beefeater", "Tanqueray", "Bombay"]
      premium: ["Hendrick's", "Bombay Sapphire", "Aviation"]
      top_shelf: ["Monkey 47", "The Botanist", "Nolet's"]

  scotch:
    name: "Scotch"
    subcategories: ["blended", "single_malt", "islay"]
    spirits:
      well: ["House Scotch"]
      call: ["Johnnie Walker Red", "Dewars", "Chivas"]
      premium: ["Johnnie Walker Black", "Glenlivet 12", "Glenfiddich 12"]
      top_shelf: ["Macallan 18", "Lagavulin 16", "Johnnie Walker Blue"]
```

### Inventory Linkage

#### Spirit as Menu Item + Inventory
```yaml
spirit_item:
  id: "patron_silver"
  name: "Patron Silver"
  category: "tequila"
  subcategory: "blanco"
  tier: "premium"

  # Pricing
  pour_price: 12.00      # When selected in a cocktail
  shot_price: 14.00      # Straight shot
  neat_price: 14.00      # Neat pour

  # Inventory
  inventory_item_id: "inv_patron_750"
  pour_size_oz: 1.5
  bottle_size_oz: 25.4   # 750ml
  pours_per_bottle: 16.9

  # Cost
  bottle_cost: 45.00
  pour_cost: 2.66
  margin: 77.8%

  # Status
  is_available: true
  low_stock_alert: 2     # Bottles
```

---

## UI/UX Specifications

### Cocktail Selection Flow

```
Step 1: Select Drink          Step 2: Select Spirit         Step 3: Confirm
+------------------------+    +------------------------+    +------------------------+
|      MARGARITA         |    |    SELECT TEQUILA      |    |      MARGARITA         |
|      Base: $10.00      |    |                        |    |   Patron Silver        |
+------------------------+    | WELL         $10.00    |    |      $14.00            |
         ↓                    | [House Tequila]        |    +------------------------+
    Auto-prompt               |                        |    | Triple Sec             |
    for spirit                | CALL          $12.00   |    | Lime Juice             |
                              | [Espolon] [Casamigos]  |    | Rocks, Salt Rim        |
                              |                        |    +------------------------+
                              | PREMIUM ★     $14.00   |    |                        |
                              | [Patron] [Don Julio]   | ←  | [Add to Order]         |
                              |                        |    +------------------------+
                              | TOP SHELF     $18.00   |
                              | [Clase Azul] [1942]    |
                              +------------------------+
```

### Quick Build Interface

```
+------------------------------------------------------------------+
| MARGARITA                                          Base: $10.00   |
+------------------------------------------------------------------+
|                                                                   |
| SELECT TEQUILA                                                    |
|                                                                   |
| +--------+ +--------+ +--------+ +--------+ +--------+           |
| |  WELL  | |  CALL  | |PREMIUM | |  TOP   | | ULTRA  |           |
| | $10.00 | | $12.00 | | $14.00 | | $18.00 | | $25.00 |           |
| | [====] | |        | |   ★    | |        | |        |           |
| +--------+ +--------+ +--------+ +--------+ +--------+           |
|                                                                   |
| PREMIUM TEQUILAS ($14.00)                                        |
| +------------------+ +------------------+ +------------------+    |
| |  Patron Silver   | |  Don Julio       | |   Herradura      |    |
| |  [Most Popular]  | |   Blanco         | |    Silver        |    |
| +------------------+ +------------------+ +------------------+    |
| +------------------+ +------------------+                         |
| | Casamigos Blanco | |   Espolon        |                         |
| |                  | |   Reposado       |                         |
| +------------------+ +------------------+                         |
|                                                                   |
| STYLE                                                             |
| (•) Rocks  ( ) Frozen  ( ) Up                                    |
|                                                                   |
| RIM                                                               |
| (•) Salt  ( ) Sugar  ( ) Tajin  ( ) None                         |
|                                                                   |
+------------------------------------------------------------------+
| Margarita - Patron Silver - Rocks - Salt           $14.00        |
| [Cancel]                                    [Add to Order]        |
+------------------------------------------------------------------+
```

### Tier Quick-Select (Speed Mode)

```
+------------------------------------------------------------------+
| COCKTAILS - QUICK BUILD                                           |
+------------------------------------------------------------------+
|                                                                   |
| [Margarita] [Old Fashioned] [Mojito] [Moscow Mule] [Martini]     |
|                                                                   |
| MARGARITA SELECTED - TAP TIER:                                   |
|                                                                   |
| +------------+ +------------+ +------------+ +------------+       |
| |            | |            | |     ★      | |            |       |
| |    WELL    | |    CALL    | |  PREMIUM   | | TOP SHELF  |       |
| |   $10.00   | |   $12.00   | |   $14.00   | |   $18.00   |       |
| |            | |            | |            | |            |       |
| | House      | | Espolon    | | Patron     | | Don Julio  |       |
| | Tequila    | |            | | Silver     | | 1942       |       |
| +------------+ +------------+ +------------+ +------------+       |
|                                                                   |
| Or tap specific brand:                                            |
| [Patron] [Don Julio] [Casamigos] [Herradura] [Clase Azul]        |
|                                                                   |
| Recent: Patron Silver (12) | Don Julio Blanco (8) | Well (24)    |
|                                                                   |
+------------------------------------------------------------------+
```

### Spirit Selection with Inventory Status

```
+------------------------------------------------------------------+
| SELECT WHISKEY FOR OLD FASHIONED                                  |
+------------------------------------------------------------------+
|                                                                   |
| BOURBON                                                           |
| +--------------------------------------------------------------+ |
| | WELL                           | CALL                         | |
| | +------------------+           | +------------------+          | |
| | | House Bourbon    |           | | Jim Beam         |          | |
| | | $11.00           |           | | $13.00           |          | |
| | | [====] In Stock  |           | | [====] In Stock  |          | |
| | +------------------+           | +------------------+          | |
| |                                | +------------------+          | |
| |                                | | Evan Williams    |          | |
| |                                | | $13.00           |          | |
| |                                | | [====] In Stock  |          | |
| |                                | +------------------+          | |
| +--------------------------------------------------------------+ |
| | PREMIUM                        | TOP SHELF                    | |
| | +------------------+           | +------------------+          | |
| | | Maker's Mark     |           | | Blanton's        |          | |
| | | $15.00           |           | | $22.00           |          | |
| | | [====] In Stock  |           | | [==  ] Low Stock |          | |
| | +------------------+           | +------------------+          | |
| | +------------------+           | +------------------+          | |
| | | Buffalo Trace    |           | | Pappy 15yr       |          | |
| | | $15.00           |           | | $45.00           |          | |
| | | [====] In Stock  |           | | [X] OUT          |          | |
| | +------------------+           | +------------------+          | |
| | +------------------+           |                               | |
| | | Woodford Reserve |           |                               | |
| | | $15.00  ★ Popular|           |                               | |
| | | [====] In Stock  |           |                               | |
| | +------------------+           |                               | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

### Upsell Prompt (Optional Feature)

```
+------------------------------------------------------------------+
|                     UPGRADE YOUR MARGARITA?                       |
+------------------------------------------------------------------+
|                                                                   |
|  You selected: House Tequila ($10.00)                            |
|                                                                   |
|  Popular upgrades:                                                |
|                                                                   |
|  +------------------------+  +------------------------+          |
|  |    Patron Silver       |  |    Don Julio Blanco    |          |
|  |    +$4.00 ($14.00)     |  |    +$4.00 ($14.00)     |          |
|  |    "Smooth & clean"    |  |    "Bright citrus"     |          |
|  +------------------------+  +------------------------+          |
|                                                                   |
|  [Keep Well $10.00]              [Upgrade to Patron $14.00]      |
|                                                                   |
+------------------------------------------------------------------+
```

### Order Display with Build Details

```
+------------------------------------------------------------------+
| ORDER - Bar Tab: Mike                            Total: $62.00    |
+------------------------------------------------------------------+
|                                                                   |
| +--------------------------------------------------------------+ |
| | Margarita                                            $14.00   | |
| |   🥃 Patron Silver (Premium)                                  | |
| |   Rocks, Salt Rim                                             | |
| +--------------------------------------------------------------+ |
| | Old Fashioned                                        $18.00   | |
| |   🥃 Woodford Reserve (Premium)                               | |
| +--------------------------------------------------------------+ |
| | Whiskey Sour                                         $11.00   | |
| |   🥃 House Bourbon (Well)                                     | |
| +--------------------------------------------------------------+ |
| | Gin & Tonic                                          $15.00   | |
| |   🥃 Hendrick's (Premium)                                     | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Data Model

### Drink Templates
```sql
drink_templates {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  display_name: VARCHAR(100)
  category_id: UUID (FK)

  -- Base pricing
  base_price: DECIMAL(10,2)  -- Well price

  -- Required spirit
  base_spirit_category: VARCHAR(50)  -- vodka, tequila, whiskey, etc.
  default_tier: VARCHAR(20) DEFAULT 'well'

  -- Recipe
  components: JSONB
  /*
  [
    {"type": "spirit", "category": "tequila", "pour_oz": 1.5},
    {"type": "liqueur", "item_id": "triple_sec", "pour_oz": 0.75},
    {"type": "mixer", "item_id": "lime_juice", "pour_oz": 1.0}
  ]
  */

  -- Options
  available_modifiers: UUID[]  -- Links to modifier groups
  allow_double: BOOLEAN DEFAULT true
  double_multiplier: DECIMAL(3,2) DEFAULT 2.0

  is_active: BOOLEAN DEFAULT true
  display_order: INTEGER

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Spirit Tiers
```sql
spirit_tiers {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(50)        -- well, call, premium, top_shelf
  display_name: VARCHAR(50)
  price_modifier: DECIMAL(10,2)

  color: VARCHAR(7)
  icon: VARCHAR(50) (nullable)
  description: VARCHAR(200) (nullable)

  display_order: INTEGER
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Spirit Categories
```sql
spirit_categories {
  id: UUID PRIMARY KEY

  name: VARCHAR(50)        -- vodka, tequila, whiskey
  display_name: VARCHAR(100)

  -- Subcategories
  subcategories: VARCHAR[] (nullable)  -- [blanco, reposado, anejo]

  display_order: INTEGER
  is_active: BOOLEAN DEFAULT true
}
```

### Spirits (Inventory-Linked Menu Items)
```sql
spirits {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Identity
  name: VARCHAR(100)
  brand: VARCHAR(100)
  category_id: UUID (FK)
  subcategory: VARCHAR(50) (nullable)
  tier_id: UUID (FK)

  -- Pricing
  cocktail_price: DECIMAL(10,2)  -- When used in mixed drink
  shot_price: DECIMAL(10,2)      -- Straight shot
  neat_price: DECIMAL(10,2)      -- Neat pour
  rocks_price: DECIMAL(10,2)     -- On the rocks

  -- Pour sizes
  cocktail_pour_oz: DECIMAL(4,2) DEFAULT 1.5
  shot_pour_oz: DECIMAL(4,2) DEFAULT 1.5
  neat_pour_oz: DECIMAL(4,2) DEFAULT 2.0

  -- Inventory link
  inventory_item_id: UUID (FK)
  bottle_size_oz: DECIMAL(6,2)
  pours_per_bottle: DECIMAL(6,2)  -- Calculated

  -- Cost
  bottle_cost: DECIMAL(10,2)
  pour_cost: DECIMAL(10,2)  -- Calculated

  -- Status
  is_available: BOOLEAN DEFAULT true
  is_featured: BOOLEAN DEFAULT false
  popularity_score: INTEGER DEFAULT 0

  display_order: INTEGER

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Order Item Spirit Selection
```sql
order_item_spirits {
  id: UUID PRIMARY KEY
  order_item_id: UUID (FK)

  -- Spirit selected
  spirit_id: UUID (FK)
  spirit_name: VARCHAR(100)  -- Denormalized for speed
  tier_name: VARCHAR(50)

  -- Pour
  pour_oz: DECIMAL(4,2)
  is_double: BOOLEAN DEFAULT false

  -- Pricing at time of order
  price_charged: DECIMAL(10,2)
  tier_upcharge: DECIMAL(10,2)

  -- Cost at time of order
  pour_cost: DECIMAL(10,2)

  created_at: TIMESTAMP
}
```

### Pour Tracking
```sql
spirit_pours {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  spirit_id: UUID (FK)
  order_item_id: UUID (FK)
  employee_id: UUID (FK)

  -- Pour details
  pour_oz: DECIMAL(4,2)
  is_double: BOOLEAN DEFAULT false
  pour_type: VARCHAR(20)  -- cocktail, shot, neat, rocks

  -- Context
  drink_template_id: UUID (FK, nullable)  -- If part of cocktail
  was_upsell: BOOLEAN DEFAULT false
  upsold_from_tier: VARCHAR(20) (nullable)

  -- Revenue
  price_charged: DECIMAL(10,2)
  pour_cost: DECIMAL(10,2)
  profit: DECIMAL(10,2)

  poured_at: TIMESTAMP
}
```

### Upsell Tracking
```sql
spirit_upsells {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  order_item_id: UUID (FK)
  employee_id: UUID (FK)

  -- What happened
  drink_template_id: UUID (FK)
  original_tier: VARCHAR(20)
  selected_tier: VARCHAR(20)
  was_upgraded: BOOLEAN

  -- If upgraded
  spirit_id: UUID (FK, nullable)
  upcharge_amount: DECIMAL(10,2) DEFAULT 0

  -- If upsell was offered but declined
  upsell_offered: BOOLEAN DEFAULT false
  upsell_declined: BOOLEAN DEFAULT false

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Drink Templates
```
GET    /api/drink-templates
GET    /api/drink-templates/{id}
POST   /api/drink-templates
PUT    /api/drink-templates/{id}
DELETE /api/drink-templates/{id}
```

### Spirits
```
GET    /api/spirits
GET    /api/spirits/{id}
GET    /api/spirits/category/{category}
GET    /api/spirits/tier/{tier}
POST   /api/spirits
PUT    /api/spirits/{id}
DELETE /api/spirits/{id}
POST   /api/spirits/{id}/86
POST   /api/spirits/{id}/available
```

### Spirit Tiers
```
GET    /api/spirit-tiers
POST   /api/spirit-tiers
PUT    /api/spirit-tiers/{id}
DELETE /api/spirit-tiers/{id}
```

### Pour Tracking
```
GET    /api/pours
GET    /api/pours/spirit/{spirit_id}
GET    /api/pours/employee/{employee_id}
GET    /api/pours/report
```

### Upsell Analytics
```
GET    /api/upsells/report
GET    /api/upsells/by-employee
GET    /api/upsells/by-drink
GET    /api/upsells/conversion-rate
```

---

## Reports

### Pour Report
```
+------------------------------------------------------------------+
| POUR REPORT                                    Jan 27, 2026       |
+------------------------------------------------------------------+
|                                                                   |
| SUMMARY                                                           |
| +------------------+ +------------------+ +------------------+    |
| | Total Pours      | | Liquor Revenue   | | Pour Cost        |   |
| | 847              | | $8,470.00        | | $1,694.00        |   |
| | +12% vs last wk  | | +15% vs last wk  | | 20% cost ratio   |   |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| BY TIER                                                           |
| +--------------------------------------------------------------+ |
| | Tier       | Pours | Revenue  | Cost     | Margin | % Total  | |
| +--------------------------------------------------------------+ |
| | Well       | 312   | $2,496   | $624.00  | 75%    | 37%      | |
| | Call       | 245   | $2,450   | $490.00  | 80%    | 29%      | |
| | Premium    | 198   | $2,376   | $396.00  | 83%    | 23%      | |
| | Top Shelf  | 92    | $1,148   | $184.00  | 84%    | 11%      | |
| +--------------------------------------------------------------+ |
|                                                                   |
| TOP SPIRITS                                                       |
| +--------------------------------------------------------------+ |
| | Spirit              | Pours | Revenue | Avg/Day | Trend     | |
| +--------------------------------------------------------------+ |
| | Patron Silver       | 87    | $1,218  | 12.4    | ↑ +8%     | |
| | Tito's Vodka        | 76    | $912    | 10.9    | ↔ 0%      | |
| | House Tequila       | 68    | $544    | 9.7     | ↓ -3%     | |
| | Hendrick's Gin      | 54    | $756    | 7.7     | ↑ +12%    | |
| | Woodford Reserve    | 48    | $720    | 6.9     | ↑ +5%     | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

### Upsell Report
```
+------------------------------------------------------------------+
| UPSELL REPORT                                  Jan 27, 2026       |
+------------------------------------------------------------------+
|                                                                   |
| CONVERSION SUMMARY                                                |
| +------------------+ +------------------+ +------------------+    |
| | Upsell Rate      | | Additional Rev   | | Avg Upcharge     |   |
| | 34%              | | $1,240.00        | | $4.25            |   |
| | ↑ 5% vs target   | | This shift       | | Per upgrade      |   |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| BY EMPLOYEE                                                       |
| +--------------------------------------------------------------+ |
| | Employee      | Orders | Upsells | Rate  | Revenue | Rank    | |
| +--------------------------------------------------------------+ |
| | Sarah M.      | 45     | 21      | 47%   | $325.00 | ★★★★★   | |
| | Mike T.       | 52     | 19      | 37%   | $285.00 | ★★★★    | |
| | Jessica R.    | 38     | 12      | 32%   | $180.00 | ★★★     | |
| | David K.      | 41     | 9       | 22%   | $135.00 | ★★      | |
| +--------------------------------------------------------------+ |
|                                                                   |
| MOST SUCCESSFUL UPSELLS                                           |
| +--------------------------------------------------------------+ |
| | From              | To                  | Count | Revenue     | |
| +--------------------------------------------------------------+ |
| | Well Tequila      | Patron Silver       | 34    | $136.00     | |
| | House Vodka       | Tito's              | 28    | $56.00      | |
| | House Bourbon     | Woodford Reserve    | 24    | $96.00      | |
| | Tito's            | Grey Goose          | 18    | $72.00      | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Business Rules

1. **Default Selection:** Drinks default to Well tier unless configured otherwise
2. **Price Calculation:** Base drink price + tier upcharge = final price
3. **Pour Tracking:** Every spirit selection creates a pour record
4. **Inventory Impact:** Pour automatically deducts from spirit inventory
5. **86 Propagation:** When spirit is 86'd, hide from selection
6. **Double Pours:** Double = 2x pour size at 2x spirit upcharge
7. **Upsell Logging:** Track when Well is selected vs. upgraded
8. **Cost Tracking:** Pour cost captured at time of order

---

## Permissions

| Action | Bartender | Server | Manager | Admin |
|--------|-----------|--------|---------|-------|
| Select spirits | Yes | Yes | Yes | Yes |
| See pour costs | No | No | Yes | Yes |
| 86 spirits | Yes | No | Yes | Yes |
| Edit spirit prices | No | No | Yes | Yes |
| View pour reports | No | No | Yes | Yes |
| Configure tiers | No | No | No | Yes |
| Manage templates | No | No | Yes | Yes |

---

## Configuration Options

```yaml
liquor_build:
  behavior:
    default_tier: "well"
    auto_prompt_spirit: true       # Show spirit selection after drink
    show_upsell_prompt: false      # Optional upgrade prompt
    require_spirit_selection: true # Can't skip spirit selection

  display:
    show_tier_prices: true
    show_availability: true
    show_popularity: true
    group_by_tier: true
    group_by_category: false

  pricing:
    tier_is_upcharge: true         # Tier price added to base
    # vs tier_is_absolute: false   # Tier price replaces base

  doubles:
    allow_doubles: true
    double_spirit_multiplier: 2.0
    double_base_included: false    # Only charge spirit 2x

  upsell:
    track_upsells: true
    upsell_prompt_enabled: false
    minimum_tier_for_prompt: "well"

  pour_tracking:
    track_all_pours: true
    link_to_inventory: true
    alert_on_variance: true
    variance_threshold_percent: 5

  keyboard_shortcuts:
    well: "1"
    call: "2"
    premium: "3"
    top_shelf: "4"
```

---

## Kitchen/Bar Ticket Display

```
============================================
           TICKET #1247 - BAR
============================================

1x  MARGARITA
    🥃 PATRON SILVER (Premium)
    Rocks, Salt Rim

1x  OLD FASHIONED
    🥃 WOODFORD RESERVE (Premium)

2x  MOSCOW MULE
    🥃 TITO'S (Call)

1x  MARTINI
    🥃 GREY GOOSE (Premium)
    Dirty, Up, 3 Olives

============================================
Server: Sarah          Sent: 7:45 PM
============================================
```

---

*Last Updated: January 27, 2026*
