# 32 - Pre-Modifiers

**Status:** Planning
**Priority:** High
**Dependencies:** 03-Menu-Programming

---

## Overview

The Pre-Modifiers skill provides quick prefix modifiers that can be applied to any item - "Lite", "Extra", "None", "On the Side", "Split", etc. These are universal modifiers that appear before or alongside item modifiers for quick customization.

**Primary Goal:** Speed up order entry with common modifications that apply to most items.

---

## User Stories

### As a Server...
- I want to quickly mark items as "Lite" or "Extra"
- I want one-tap access to common modifiers
- I want "No [ingredient]" to be fast
- I want "On the Side" without finding it in modifiers

### As a Kitchen Staff...
- I want to clearly see pre-modifiers on tickets
- I want consistent formatting
- I want these to stand out from other mods

---

## Features

### Standard Pre-Modifiers

#### Common Pre-Mods
- [ ] **Lite** - Less of something
- [ ] **Extra** - More of something
- [ ] **None / No** - Remove entirely
- [ ] **On the Side** - Serve separately
- [ ] **Split** - Divide between plates
- [ ] **Well Done** - Cook more
- [ ] **Lightly** - Cook less
- [ ] **Add** - Add ingredient
- [ ] **Sub** - Substitute

### Pre-Modifier Application

#### Quick Application
- [ ] Pre-mod buttons always visible
- [ ] Apply to selected item
- [ ] Apply during modifier selection
- [ ] Stack multiple pre-mods

#### Application Flow
```
1. Add item to order
2. Open modifier selection
3. Pre-mods available at top: [Lite] [Extra] [No] [Side]
4. Tap "No" then select "Onion" = "No Onion"
5. Or select modifier first, then apply pre-mod
```

### Display Formatting

#### On Order
```
Burger
  - No Onion
  - Extra Pickles
  - Lite Mayo
  - Cheese on Side
```

#### On Tickets
```
BURGER
  **NO ONION**
  **EXTRA PICKLES**
  **LITE MAYO**
  **SIDE CHEESE**
```

### Configuration

#### Pre-Modifier Setup
- [ ] Enable/disable each pre-mod
- [ ] Custom pre-modifiers
- [ ] Display order
- [ ] Colors/highlighting

#### Price Adjustments
- [ ] Extra typically adds cost
- [ ] Lite/No may not
- [ ] Configurable per combination

### Smart Pre-Mods

#### Context-Aware
- [ ] "Side" only for appropriate items
- [ ] "Well Done" only for proteins
- [ ] Based on item categories

#### Item-Specific Overrides
- [ ] Disable certain pre-mods for items
- [ ] Custom pre-mod prices per item

---

## UI/UX Specifications

### Pre-Mod Bar During Ordering

```
+------------------------------------------------------------------+
| MODIFIER SELECTION - Burger                                      |
+------------------------------------------------------------------+
| PRE-MODIFIERS:                                                   |
| [Lite] [Extra] [No] [Side] [Add] [Sub] [Split]                  |
+------------------------------------------------------------------+
|                                                                  |
| TOPPINGS (Select any)                                            |
| [✓] Lettuce     [ ] Tomato      [✓] Onion      [ ] Pickles     |
| [ ] Jalapeños   [ ] Mushrooms   [ ] Avocado +$2                 |
|                                                                  |
| Tap pre-mod, then tap item to apply.                            |
| Example: [No] + [Onion] = "No Onion"                            |
|                                                                  |
| APPLIED:                                                         |
| • No Onion                                                      |
| • Extra Pickles                                                 |
| • Lite Mayo                                                     |
|                                                                  |
+------------------------------------------------------------------+
| [Cancel]                                    [Done]               |
+------------------------------------------------------------------+
```

### Pre-Mod Quick Add (Without Opening Modifiers)

```
+------------------------------------------------------------------+
| ORDER - Table 12                                                 |
+------------------------------------------------------------------+
| Burger                                                   $14.99  |
|   Medium, American Cheese                                        |
|   [+ Mod]  [Lite] [Extra] [No] [Side]    ← Quick pre-mods       |
|                                                                  |
| Fries                                                     $4.99  |
|   [+ Mod]  [Lite] [Extra] [No] [Side]                           |
|                                                                  |
+------------------------------------------------------------------+
```

### Pre-Mod Application Result

```
+------------------------------------------------------------------+
| APPLY PRE-MODIFIER                                               |
+------------------------------------------------------------------+
|                                                                  |
| Selected Pre-Mod: [EXTRA]                                        |
| Item: Burger                                                     |
|                                                                  |
| What would you like EXTRA of?                                    |
|                                                                  |
| CURRENT TOPPINGS:                                                |
| [Lettuce] [Onion] [Pickles] [Mayo] [Mustard] [Ketchup]         |
|                                                                  |
| OTHER OPTIONS:                                                   |
| [Bacon +$2] [Cheese +$1] [Avocado +$2.50]                       |
|                                                                  |
+------------------------------------------------------------------+
```

---

## Data Model

### Pre-Modifiers
```sql
pre_modifiers {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(50)
  code: VARCHAR(10) -- LT, EX, NO, SD, etc.
  description: TEXT (nullable)

  -- Formatting
  display_prefix: VARCHAR(20) -- "Lite", "Extra", etc.
  ticket_format: VARCHAR(50) -- "**LITE**", "LITE:", etc.

  -- Pricing
  default_price_adjustment: DECIMAL(10,2) DEFAULT 0
  price_adjustment_type: VARCHAR(20) (none, fixed, percent)

  -- Display
  display_order: INTEGER
  color: VARCHAR(7) (nullable)
  is_active: BOOLEAN DEFAULT true

  -- Applicability
  applicable_categories: UUID[] (nullable) -- NULL = all
  excluded_categories: UUID[] (nullable)

  is_system: BOOLEAN DEFAULT false

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Pre-Modifier Applications
```sql
order_item_pre_modifiers {
  id: UUID PRIMARY KEY
  order_item_id: UUID (FK)
  pre_modifier_id: UUID (FK)

  -- What it applies to
  target_modifier_id: UUID (FK, nullable) -- The modifier being modified
  target_ingredient: VARCHAR(100) (nullable) -- Or free text

  -- Pricing
  price_adjustment: DECIMAL(10,2) DEFAULT 0

  created_at: TIMESTAMP
}
```

### Pre-Modifier Pricing Overrides
```sql
pre_modifier_pricing {
  id: UUID PRIMARY KEY
  pre_modifier_id: UUID (FK)

  -- What this pricing applies to
  menu_item_id: UUID (FK, nullable)
  modifier_id: UUID (FK, nullable)
  category_id: UUID (FK, nullable)

  price_adjustment: DECIMAL(10,2)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

```
GET    /api/pre-modifiers
POST   /api/pre-modifiers
PUT    /api/pre-modifiers/{id}
DELETE /api/pre-modifiers/{id}

POST   /api/orders/{id}/items/{item_id}/pre-modifiers
DELETE /api/orders/{id}/items/{item_id}/pre-modifiers/{pre_mod_id}

GET    /api/menu-items/{id}/available-pre-modifiers
```

---

## Business Rules

1. **Stacking:** Multiple pre-mods can apply to same modifier
2. **Conflicts:** Prevent "Extra" and "No" on same item
3. **Price Logic:** Extra typically costs more, Lite/No usually doesn't
4. **Ticket Formatting:** Pre-mods clearly visible and consistent

---

## Default Pre-Modifiers

```yaml
default_pre_modifiers:
  - name: "Lite"
    code: "LT"
    prefix: "Lite"
    ticket_format: "LITE"
    price_adjustment: 0

  - name: "Extra"
    code: "EX"
    prefix: "Extra"
    ticket_format: "EXTRA"
    price_adjustment: 0.50  # Or per-item

  - name: "No"
    code: "NO"
    prefix: "No"
    ticket_format: "**NO**"
    price_adjustment: 0

  - name: "On the Side"
    code: "SD"
    prefix: "Side"
    ticket_format: "SIDE"
    price_adjustment: 0

  - name: "Add"
    code: "AD"
    prefix: "Add"
    ticket_format: "ADD"
    price_adjustment: varies

  - name: "Sub"
    code: "SB"
    prefix: "Sub"
    ticket_format: "SUB"
    price_adjustment: varies

  - name: "Split"
    code: "SP"
    prefix: "Split"
    ticket_format: "SPLIT"
    price_adjustment: 0
```

---

## Configuration Options

```yaml
pre_modifiers:
  enabled: true

  display:
    show_bar: true
    position: "top"  # or "bottom"
    always_visible: true

  behavior:
    require_target: true  # Must select what to modify
    allow_stacking: true
    prevent_conflicts: true

  pricing:
    extra_default_upcharge: 0.50
    lite_adjust: false
    no_adjust: false
```

---

*Last Updated: January 27, 2026*
