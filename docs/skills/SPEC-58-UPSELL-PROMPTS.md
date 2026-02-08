# 58 - Upsell Prompts & Suggestions

**Status:** Planning
**Priority:** High
**Dependencies:** 03-Menu-Programming, 07-Inventory, 02-Operator-Experience

---

## Overview

The Upsell Prompts skill enables intelligent suggestions when items are added to an order. Configure item-specific upsells ("Add bacon for $2?"), category-based suggestions ("Would you like a drink with that?"), and track upsell performance by item, server, and time period. Maximizes average check while maintaining speed of service.

**Primary Goal:** Increase average ticket size through smart, non-intrusive prompts that help servers suggest relevant add-ons.

---

## User Stories

### As a Server...
- I want prompts to remind me of relevant upsells
- I want quick one-tap to add the suggested item
- I want to dismiss prompts that don't apply
- I don't want prompts to slow me down

### As a Manager...
- I want to configure which items trigger upsells
- I want to see upsell success rates
- I want to identify top upselling servers
- I want to adjust prompts based on performance

### As an Owner...
- I want to increase average check size
- I want to push high-margin items
- I want data on what upsells work best
- I want to train staff on effective upselling

---

## Features

### Upsell Configuration

#### Item-Level Upsells
```yaml
item_upsells:
  burger:
    item_id: "burger_classic"
    upsells:
      - trigger: "on_add"
        suggestion: "bacon"
        prompt: "Add bacon?"
        price: "+$2.00"
        position: "inline"  # Show in item row

      - trigger: "on_add"
        suggestion: "cheese_upgrade"
        prompt: "Upgrade to premium cheese?"
        price: "+$1.50"
        position: "inline"

      - trigger: "on_add"
        suggestion: "make_it_combo"
        prompt: "Make it a combo?"
        price: "+$4.00"
        combo_id: "burger_combo"
        position: "popup"

  coffee:
    item_id: "coffee_regular"
    upsells:
      - trigger: "on_add"
        suggestion: "size_upgrade"
        prompt: "Make it a large?"
        price: "+$0.75"

      - trigger: "on_add"
        suggestion: "extra_shot"
        prompt: "Add an extra shot?"
        price: "+$0.50"
```

#### Category-Based Upsells
```yaml
category_upsells:
  entrees:
    category_id: "entrees"
    upsells:
      - trigger: "on_add"
        suggestion_category: "appetizers"
        prompt: "Start with an appetizer?"
        show_items: ["wings", "nachos", "spinach_dip"]
        position: "popup"

      - trigger: "on_add"
        suggestion_category: "sides"
        prompt: "Add a side?"
        show_items: ["fries", "onion_rings", "side_salad"]
        position: "inline"

  drinks:
    category_id: "alcoholic_drinks"
    upsells:
      - trigger: "on_add"
        suggestion: "premium_upgrade"
        prompt: "Make it premium?"
        applies_to: "cocktails"
        links_to: "skill_52_liquor_build"
```

#### Order-Level Upsells
```yaml
order_upsells:
  no_drinks:
    condition: "no_items_in_category:beverages"
    trigger: "before_send"
    prompt: "Add drinks to the order?"
    suggestion_category: "beverages"

  no_dessert:
    condition: "no_items_in_category:desserts"
    trigger: "before_payment"
    prompt: "Save room for dessert?"
    suggestion_category: "desserts"

  low_ticket:
    condition: "subtotal < 20"
    trigger: "before_send"
    prompt: "Add an appetizer to share?"
    suggestion_category: "appetizers"
```

### Upsell Display

#### Inline Upsell (Non-Intrusive)
```
+------------------------------------------------------------------+
| ORDER - Table 5                                    Total: $14.00  |
+------------------------------------------------------------------+
|                                                                   |
| +--------------------------------------------------------------+ |
| | Classic Burger                                        $12.00  | |
| |   ┌─────────────────────────────────────────────────────┐    | |
| |   │ ⭐ Add bacon +$2  [Yes]  │  Make it a combo +$4 [Yes] │    | |
| |   └─────────────────────────────────────────────────────┘    | |
| +--------------------------------------------------------------+ |
| | Side Salad                                             $6.00  | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

#### Popup Upsell (For Combos/Larger Suggestions)
```
+------------------------------------------------------------------+
|                    MAKE IT A COMBO?                               |
+------------------------------------------------------------------+
|                                                                   |
|  Classic Burger                                          $12.00  |
|                                                                   |
|  ↓ Upgrade to Combo                                      +$4.00  |
|                                                                   |
|  COMBO INCLUDES:                                                  |
|  +--------------------------------------------------------------+|
|  | • Your burger                                                 ||
|  | • Choice of side (Fries, Onion Rings, Coleslaw)              ||
|  | • Choice of drink (Soda, Iced Tea, Lemonade)                 ||
|  +--------------------------------------------------------------+|
|                                                                   |
|  Combo Total: $16.00 (Save $3.00 vs. a la carte)                |
|                                                                   |
|  [No Thanks]                              [Yes, Make it a Combo] |
+------------------------------------------------------------------+
```

#### End-of-Order Upsell
```
+------------------------------------------------------------------+
|                    BEFORE YOU SEND...                             |
+------------------------------------------------------------------+
|                                                                   |
|  No beverages on this order yet!                                 |
|                                                                   |
|  SUGGESTED DRINKS                                                 |
|  +------------------+ +------------------+ +------------------+   |
|  | 🍺 Draft Beer    | | 🍷 House Wine    | | 🥤 Soft Drink   |   |
|  |     $6.00        | |     $8.00        | |     $3.00       |   |
|  |     [Add]        | |     [Add]        | |     [Add]       |   |
|  +------------------+ +------------------+ +------------------+   |
|                                                                   |
|  [Skip - Send Order]                      [Add Selected & Send]  |
+------------------------------------------------------------------+
```

### Smart Suggestions

#### AI/Rule-Based Recommendations
```yaml
smart_suggestions:
  popular_pairings:
    enabled: true
    source: "sales_data"
    description: "Suggest items frequently ordered together"
    example: "Customers who order wings often add ranch"

  time_based:
    enabled: true
    rules:
      - time: "11:00-14:00"
        push: "lunch_combos"
      - time: "17:00-19:00"
        push: "happy_hour_items"
      - time: "20:00-close"
        push: "desserts"

  weather_based:
    enabled: false  # Future feature
    rules:
      - condition: "hot_day"
        push: "cold_drinks, ice_cream"
      - condition: "cold_day"
        push: "soups, hot_drinks"

  margin_based:
    enabled: true
    description: "Prioritize high-margin suggestions"
    minimum_margin: 60%
```

### Upsell Tracking

#### Performance Dashboard
```
+------------------------------------------------------------------+
| UPSELL PERFORMANCE                                 This Week      |
+------------------------------------------------------------------+
|                                                                   |
| SUMMARY                                                           |
| +------------------+ +------------------+ +------------------+    |
| | Upsell Rate      | | Revenue Added    | | Avg Check Impact |   |
| | 34%              | | $2,847.00        | | +$4.25           |   |
| | ↑ 5% vs LW       | | ↑ 12% vs LW      | | ↑ $0.50 vs LW    |   |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| TOP PERFORMING UPSELLS                                            |
| +--------------------------------------------------------------+ |
| | Upsell              | Offered | Accepted | Rate  | Revenue   | |
| +--------------------------------------------------------------+ |
| | Bacon on Burger     | 245     | 156      | 64%   | $312.00   | |
| | Make it a Combo     | 312     | 128      | 41%   | $512.00   | |
| | Premium Liquor      | 189     | 72       | 38%   | $288.00   | |
| | Add Appetizer       | 421     | 84       | 20%   | $672.00   | |
| | Dessert             | 356     | 53       | 15%   | $318.00   | |
| +--------------------------------------------------------------+ |
|                                                                   |
| BY SERVER                                                         |
| +--------------------------------------------------------------+ |
| | Server        | Opportunities | Accepted | Rate  | Revenue   | |
| +--------------------------------------------------------------+ |
| | Sarah M.      | 145           | 62       | 43%   | $496.00   | |
| | Mike T.       | 132           | 51       | 39%   | $408.00   | |
| | Jessica R.    | 98            | 28       | 29%   | $224.00   | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

### Configuration Interface

#### Upsell Builder
```
+------------------------------------------------------------------+
| CONFIGURE UPSELL                                                  |
+------------------------------------------------------------------+
|                                                                   |
| TRIGGER ITEM                                                      |
| When this item is added:                                         |
| [Classic Burger_______________________▼]                          |
|                                                                   |
| SUGGESTION                                                        |
| Suggest this item/action:                                        |
| (•) Specific Item: [Bacon_________________________▼]             |
| ( ) Category: [________________________________▼]                 |
| ( ) Combo: [__________________________________▼]                  |
| ( ) Size Upgrade                                                 |
|                                                                   |
| PROMPT TEXT                                                       |
| [Add bacon for $2?_________________________________]             |
|                                                                   |
| DISPLAY                                                           |
| (•) Inline (subtle, in item row)                                 |
| ( ) Popup (prominent, requires response)                         |
| ( ) Toast notification (dismisses automatically)                 |
|                                                                   |
| TIMING                                                            |
| [✓] Show when item is added                                      |
| [ ] Show before sending to kitchen                               |
| [ ] Show at payment                                              |
|                                                                   |
| CONDITIONS (Optional)                                             |
| [ ] Only during: [___________] to [___________]                  |
| [ ] Only on days: [M] [T] [W] [Th] [F] [Sa] [Su]                 |
| [ ] Only if order subtotal < $[____]                             |
|                                                                   |
| [Cancel]                              [Save Upsell]              |
+------------------------------------------------------------------+
```

---

## Data Model

### Upsell Configurations
```sql
upsell_configs {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Trigger
  trigger_type: VARCHAR(50)  -- item, category, order_condition
  trigger_item_id: UUID (FK, nullable)
  trigger_category_id: UUID (FK, nullable)
  trigger_condition: JSONB (nullable)

  -- Suggestion
  suggestion_type: VARCHAR(50)  -- item, category, combo, upgrade
  suggestion_item_id: UUID (FK, nullable)
  suggestion_category_id: UUID (FK, nullable)
  suggestion_combo_id: UUID (FK, nullable)

  -- Display
  prompt_text: VARCHAR(200)
  display_mode: VARCHAR(50)  -- inline, popup, toast
  show_price: BOOLEAN DEFAULT true

  -- Timing
  trigger_on_add: BOOLEAN DEFAULT true
  trigger_before_send: BOOLEAN DEFAULT false
  trigger_at_payment: BOOLEAN DEFAULT false

  -- Conditions
  active_start_time: TIME (nullable)
  active_end_time: TIME (nullable)
  active_days: INTEGER[]  -- 0=Sun, 6=Sat
  min_subtotal: DECIMAL(10,2) (nullable)
  max_subtotal: DECIMAL(10,2) (nullable)

  -- Status
  is_active: BOOLEAN DEFAULT true
  priority: INTEGER DEFAULT 0  -- Higher = show first

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Upsell Events
```sql
upsell_events {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  upsell_config_id: UUID (FK)

  -- Context
  order_id: UUID (FK)
  order_item_id: UUID (FK, nullable)
  employee_id: UUID (FK)

  -- Result
  was_shown: BOOLEAN DEFAULT true
  was_accepted: BOOLEAN DEFAULT false
  was_dismissed: BOOLEAN DEFAULT false

  -- If accepted
  added_item_id: UUID (FK, nullable)
  added_amount: DECIMAL(10,2) (nullable)

  created_at: TIMESTAMP
}
```

### Upsell Analytics (Aggregated)
```sql
upsell_analytics {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  upsell_config_id: UUID (FK)

  date: DATE

  -- Counts
  times_shown: INTEGER DEFAULT 0
  times_accepted: INTEGER DEFAULT 0
  times_dismissed: INTEGER DEFAULT 0

  -- Revenue
  revenue_added: DECIMAL(10,2) DEFAULT 0

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Configuration
```
GET    /api/upsells
GET    /api/upsells/{id}
POST   /api/upsells
PUT    /api/upsells/{id}
DELETE /api/upsells/{id}
PUT    /api/upsells/{id}/toggle
```

### Runtime
```
GET    /api/upsells/for-item/{item_id}
GET    /api/upsells/for-order/{order_id}
POST   /api/upsells/{id}/shown
POST   /api/upsells/{id}/accepted
POST   /api/upsells/{id}/dismissed
```

### Analytics
```
GET    /api/upsells/analytics
GET    /api/upsells/analytics/by-item
GET    /api/upsells/analytics/by-server
GET    /api/upsells/analytics/by-time
```

---

## Business Rules

1. **Non-Intrusive:** Inline prompts preferred over popups for speed
2. **Limit Prompts:** Max 2 upsells shown per item add
3. **Smart Throttling:** Don't show same upsell twice in one order
4. **Relevance:** Only show contextually appropriate suggestions
5. **Performance Tracking:** Log all shown/accepted/dismissed
6. **Easy Dismiss:** One tap to dismiss without slowing service

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| See upsell prompts | Yes | Yes | Yes |
| Accept/dismiss prompts | Yes | Yes | Yes |
| View upsell analytics | No | Yes | Yes |
| Configure upsells | No | Yes | Yes |
| Create new upsells | No | No | Yes |

---

## Configuration Options

```yaml
upsell_prompts:
  display:
    default_mode: "inline"
    max_per_item: 2
    max_per_order: 5
    auto_dismiss_seconds: 0  # 0 = manual dismiss

  behavior:
    show_on_quick_add: true
    show_on_modifier_screen: false
    require_response: false
    track_all_events: true

  smart_suggestions:
    use_sales_data: true
    minimum_pairing_frequency: 10  # Times ordered together
    prioritize_high_margin: true

  server_incentives:
    track_by_server: true
    show_leaderboard: false
```

---

*Last Updated: January 27, 2026*
