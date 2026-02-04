# 60 - Automatic Discounts & Promotions

**Status:** Planning
**Priority:** High
**Dependencies:** 03-Menu-Programming, 04-Order-Management, 18-Discounts

---

## Overview

The Automatic Discounts skill enables rule-based promotions that apply automatically when order conditions are met. Configure "Buy 2 Get 1 Free," "Happy Hour 2-for-1," "10% off when you order 3+ appetizers," and other conditional discounts without manual server intervention. Discounts appear automatically with clear explanations.

**Primary Goal:** Automate promotional discounts to ensure consistent application, reduce errors, and delight guests with automatic savings.

---

## User Stories

### As a Server...
- I want discounts to apply automatically
- I want to see why a discount was applied
- I want guests to be surprised by savings
- I don't want to remember every promotion

### As a Guest...
- I want to get deals I qualify for automatically
- I want to understand what discount I received
- I want to see how close I am to the next deal
- I want fair, consistent pricing

### As a Manager...
- I want to create promotional rules
- I want to schedule promotions
- I want to track promotion effectiveness
- I want to limit discount stacking

---

## Features

### Discount Rule Types

#### Buy X Get Y (BOGO)
```yaml
bogo_rules:
  # Buy 2 Get 1 Free
  wings_b2g1:
    name: "Wings B2G1F"
    display: "Buy 2 Wings, Get 1 FREE!"
    type: "buy_x_get_y"

    trigger:
      item_category: "wings"
      required_quantity: 3  # Need 3 to qualify

    discount:
      apply_to: "cheapest"  # or "most_expensive", "specific_item"
      discount_percent: 100  # 100% = free
      max_discounted: 1

    conditions:
      same_item: false  # Can mix flavors
      stackable: false

  # Buy 1 Get 1 50% Off
  appetizers_bogo50:
    name: "Appetizers BOGO 50%"
    display: "Buy 1 Appetizer, Get 2nd 50% Off!"
    type: "buy_x_get_y"

    trigger:
      item_category: "appetizers"
      required_quantity: 2

    discount:
      apply_to: "cheapest"
      discount_percent: 50
      max_discounted: 1
```

#### Quantity Discount
```yaml
quantity_discounts:
  # 10% off 3+ appetizers
  appetizer_bundle:
    name: "Appetizer Bundle"
    display: "10% off when you order 3+ appetizers!"
    type: "quantity_discount"

    trigger:
      item_category: "appetizers"
      min_quantity: 3

    discount:
      discount_percent: 10
      apply_to: "all_qualifying"

  # Volume pricing
  beer_bucket:
    name: "Beer Bucket Pricing"
    display: "Bucket of 5 beers for $20!"
    type: "quantity_discount"

    trigger:
      item_category: "domestic_beer"
      exact_quantity: 5

    discount:
      fixed_total: 20.00  # Override individual pricing
```

#### Mix & Match
```yaml
mix_match:
  # 2 Entrees + Bottle of Wine = $X
  dinner_for_two:
    name: "Dinner for Two"
    display: "2 Entrees + Wine Bottle = $75!"
    type: "mix_match"

    requirements:
      - category: "entrees"
        quantity: 2
      - category: "wine_bottles"
        quantity: 1

    discount:
      fixed_total: 75.00
      max_item_value: 35.00  # Entrees up to $35 each

  # Taco Tuesday
  taco_tuesday:
    name: "Taco Tuesday"
    display: "3 Tacos for $10!"
    type: "mix_match"

    requirements:
      - category: "tacos"
        quantity: 3
        same_item: false  # Can mix

    discount:
      fixed_total: 10.00

    schedule:
      days: ["tuesday"]
```

#### Spend Threshold
```yaml
spend_threshold:
  # $10 off orders over $50
  ten_off_fifty:
    name: "$10 Off $50"
    display: "You saved $10! (Orders over $50)"
    type: "spend_threshold"

    trigger:
      min_subtotal: 50.00
      before_tax: true

    discount:
      discount_amount: 10.00

  # 15% off orders over $100
  fifteen_percent_hundred:
    name: "15% Off $100"
    display: "15% off your order over $100!"
    type: "spend_threshold"

    trigger:
      min_subtotal: 100.00

    discount:
      discount_percent: 15
      max_discount: 25.00  # Cap at $25
```

#### Time-Based (Happy Hour)
```yaml
time_based:
  happy_hour_drinks:
    name: "Happy Hour Drinks"
    display: "Happy Hour: 50% Off Select Drinks!"
    type: "time_based"

    schedule:
      days: ["monday", "tuesday", "wednesday", "thursday", "friday"]
      start_time: "16:00"
      end_time: "18:00"

    applies_to:
      categories: ["well_drinks", "house_wine", "draft_beer"]

    discount:
      discount_percent: 50

  late_night:
    name: "Late Night Special"
    display: "Late Night: $5 Appetizers!"
    type: "time_based"

    schedule:
      days: ["thursday", "friday", "saturday"]
      start_time: "22:00"
      end_time: "01:00"

    applies_to:
      specific_items: ["wings", "nachos", "quesadilla", "fries"]

    discount:
      fixed_price: 5.00
```

### Auto-Apply Interface

#### Discount Applied Notification
```
+------------------------------------------------------------------+
| ORDER - Table 5                                    Total: $42.50  |
+------------------------------------------------------------------+
|                                                                   |
| +--------------------------------------------------------------+ |
| | Buffalo Wings (6pc)                                   $12.00  | |
| | Buffalo Wings (6pc)                                   $12.00  | |
| | Garlic Parmesan Wings (6pc)                           $12.00  | |
| |                                                                | |
| | ┌──────────────────────────────────────────────────────────┐  | |
| | │ 🎉 DISCOUNT APPLIED!                                      │  | |
| | │ Buy 2 Wings, Get 1 FREE!                                  │  | |
| | │ Savings: -$12.00                                          │  | |
| | └──────────────────────────────────────────────────────────┘  | |
| +--------------------------------------------------------------+ |
| | Caesar Salad                                          $14.00  | |
| +--------------------------------------------------------------+ |
|                                                                   |
| Subtotal:                                               $50.00   |
| Discount (B2G1 Wings):                                 -$12.00   |
| ─────────────────────────────────────────────────────────────    |
| After Discount:                                         $38.00   |
| Tax:                                                     $3.04   |
| ─────────────────────────────────────────────────────────────    |
| TOTAL:                                                  $41.04   |
|                                                                   |
+------------------------------------------------------------------+
```

#### "Almost There" Suggestion
```
+------------------------------------------------------------------+
|                    💡 YOU'RE ALMOST THERE!                        |
+------------------------------------------------------------------+
|                                                                   |
|  Add 1 more appetizer to unlock:                                 |
|  "10% off 3+ Appetizers!"                                        |
|                                                                   |
|  Current appetizers: 2                                           |
|  Potential savings: ~$4.00                                       |
|                                                                   |
|  SUGGESTED:                                                       |
|  +------------------+ +------------------+ +------------------+   |
|  | Mozzarella       | | Spinach Dip     | | Onion Rings     |   |
|  | Sticks $8.00     | | $10.00          | | $7.00           |   |
|  | [Add]            | | [Add]           | | [Add]           |   |
|  +------------------+ +------------------+ +------------------+   |
|                                                                   |
|  [Dismiss]                                                       |
+------------------------------------------------------------------+
```

### Rule Builder

#### Create Discount Rule
```
+------------------------------------------------------------------+
| CREATE AUTOMATIC DISCOUNT                                         |
+------------------------------------------------------------------+
|                                                                   |
| BASIC INFO                                                        |
| Name: [Wings Buy 2 Get 1 Free________________]                   |
| Display Text: [Buy 2 Wings, Get 1 FREE!______]                   |
|                                                                   |
| DISCOUNT TYPE                                                     |
| (•) Buy X Get Y (BOGO)                                           |
| ( ) Quantity Discount                                            |
| ( ) Mix & Match Bundle                                           |
| ( ) Spend Threshold                                              |
| ( ) Time-Based / Happy Hour                                      |
|                                                                   |
| TRIGGER CONDITIONS                                                |
| Applies to: [Wings (Category)_______________▼]                   |
| Required quantity: [3___]                                        |
|                                                                   |
| DISCOUNT                                                          |
| Apply discount to: [Cheapest Item___________▼]                   |
| Discount: [100__]%  (100% = FREE)                                |
| Max items discounted: [1___]                                     |
|                                                                   |
| SCHEDULE (Optional)                                               |
| [ ] Limit to specific days/times                                 |
|     Days: [M] [T] [W] [Th] [F] [Sa] [Su]                         |
|     Time: [____] to [____]                                       |
|                                                                   |
| DATE RANGE (Optional)                                             |
| [ ] Limit to date range                                          |
|     Start: [__________]  End: [__________]                       |
|                                                                   |
| RULES                                                             |
| [ ] Must be same item (can't mix)                                |
| [✓] Can combine with other auto-discounts                        |
| [ ] Requires manager approval                                    |
| [ ] Limit per order: [___]                                       |
|                                                                   |
| [Cancel]                              [Create Discount Rule]     |
+------------------------------------------------------------------+
```

### Active Promotions Display

#### Current Promotions
```
+------------------------------------------------------------------+
| ACTIVE PROMOTIONS                               [+ Add Promotion] |
+------------------------------------------------------------------+
|                                                                   |
| ALWAYS ACTIVE                                                     |
| +--------------------------------------------------------------+ |
| | 🏷️ Wings B2G1F                                    [Edit] [Off]| |
| |    Buy 2 Wings, Get 1 FREE!                                   | |
| |    This Week: 124 applied | $1,488 discount given             | |
| +--------------------------------------------------------------+ |
| | 🏷️ 10% Off 3+ Apps                                [Edit] [Off]| |
| |    10% off when you order 3+ appetizers                       | |
| |    This Week: 87 applied | $348 discount given                | |
| +--------------------------------------------------------------+ |
|                                                                   |
| SCHEDULED                                                         |
| +--------------------------------------------------------------+ |
| | 🕐 Happy Hour                              Mon-Fri 4PM-6PM    | |
| |    50% off well drinks, house wine, draft beer                | |
| |    Currently: ACTIVE (ends in 1h 23m)                         | |
| +--------------------------------------------------------------+ |
| | 🕐 Taco Tuesday                            Tuesdays All Day   | |
| |    3 Tacos for $10                                            | |
| |    Next: Tuesday Jan 28                                       | |
| +--------------------------------------------------------------+ |
| | 🕐 Late Night Bites                        Thu-Sat 10PM-1AM   | |
| |    $5 Select Appetizers                                       | |
| |    Currently: INACTIVE                                        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| LIMITED TIME                                                      |
| +--------------------------------------------------------------+ |
| | 📅 Super Bowl Special                      Feb 9, 2026 only   | |
| |    $10 off orders over $50                                    | |
| |    Status: Scheduled                                          | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

### Discount Stacking Rules

```yaml
stacking_rules:
  global:
    allow_multiple_auto_discounts: true
    max_auto_discounts_per_order: 3

  priority:
    # Higher number = applied first
    1: "happy_hour"      # Apply first (time-based)
    2: "bogo"            # Then BOGO
    3: "quantity"        # Then quantity discounts
    4: "spend_threshold" # Finally spend thresholds

  exclusions:
    - rule: "happy_hour"
      excludes: ["late_night"]  # Can't stack these two

  combination_limits:
    manual_and_auto: true  # Can combine manual discount with auto
    max_total_discount_percent: 50  # Never more than 50% off
```

---

## Data Model

### Discount Rules
```sql
auto_discount_rules {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Identity
  name: VARCHAR(200)
  display_text: VARCHAR(200)
  description: TEXT (nullable)

  -- Type
  discount_type: VARCHAR(50)  -- bogo, quantity, mix_match, threshold, time_based

  -- Trigger conditions
  trigger_config: JSONB
  /*
  {
    "category_ids": ["uuid1", "uuid2"],
    "item_ids": ["uuid3"],
    "min_quantity": 3,
    "min_subtotal": 50.00
  }
  */

  -- Discount
  discount_config: JSONB
  /*
  {
    "discount_type": "percent",  // or "amount", "fixed_price"
    "discount_value": 100,
    "apply_to": "cheapest",
    "max_discounted": 1,
    "max_discount_amount": 25.00
  }
  */

  -- Schedule
  schedule_config: JSONB (nullable)
  /*
  {
    "days": [1, 2, 3, 4, 5],  // Mon-Fri
    "start_time": "16:00",
    "end_time": "18:00",
    "start_date": "2026-01-01",
    "end_date": "2026-12-31"
  }
  */

  -- Rules
  priority: INTEGER DEFAULT 0
  stackable: BOOLEAN DEFAULT true
  requires_approval: BOOLEAN DEFAULT false
  max_per_order: INTEGER (nullable)

  -- Status
  is_active: BOOLEAN DEFAULT true

  created_by: UUID (FK)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Applied Discounts
```sql
auto_discounts_applied {
  id: UUID PRIMARY KEY
  order_id: UUID (FK)
  discount_rule_id: UUID (FK)

  -- What was discounted
  discounted_items: JSONB  -- Array of order_item_ids
  discount_amount: DECIMAL(10,2)

  -- Context
  trigger_met: TEXT  -- Description of why it applied
  applied_at: TIMESTAMP
}
```

### Discount Analytics
```sql
auto_discount_analytics {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  discount_rule_id: UUID (FK)

  date: DATE

  -- Usage
  times_applied: INTEGER DEFAULT 0
  total_discount_given: DECIMAL(10,2) DEFAULT 0
  orders_affected: INTEGER DEFAULT 0

  -- Impact
  avg_check_with_discount: DECIMAL(10,2)
  avg_check_without_discount: DECIMAL(10,2)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Rule Management
```
GET    /api/auto-discounts
GET    /api/auto-discounts/{id}
POST   /api/auto-discounts
PUT    /api/auto-discounts/{id}
DELETE /api/auto-discounts/{id}
PUT    /api/auto-discounts/{id}/toggle
```

### Runtime
```
GET    /api/orders/{id}/applicable-discounts
POST   /api/orders/{id}/apply-auto-discounts
GET    /api/orders/{id}/discount-suggestions  # "Almost there"
```

### Analytics
```
GET    /api/auto-discounts/analytics
GET    /api/auto-discounts/{id}/analytics
GET    /api/auto-discounts/analytics/impact
```

---

## Business Rules

1. **Automatic Application:** Discounts apply automatically when conditions met
2. **Real-Time Evaluation:** Re-evaluate on every order change
3. **Clear Communication:** Always show what discount applied and why
4. **Stacking Rules:** Enforce priority and exclusion rules
5. **Removal on Unqualify:** Remove discount if items removed
6. **Audit Trail:** Log all auto-discount applications

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| See applied discounts | Yes | Yes | Yes |
| Override auto-discount | No | Yes | Yes |
| View discount analytics | No | Yes | Yes |
| Create discount rules | No | Yes | Yes |
| Delete discount rules | No | No | Yes |
| Set stacking rules | No | No | Yes |

---

## Configuration Options

```yaml
auto_discounts:
  behavior:
    auto_apply: true
    show_notification: true
    notification_duration: 5  # seconds
    show_almost_there: true

  stacking:
    allow_multiple: true
    max_per_order: 3
    max_total_percent: 50
    combine_with_manual: true

  display:
    show_savings: true
    show_on_receipt: true
    savings_format: "You saved $X!"

  suggestions:
    show_threshold_hints: true
    items_away_threshold: 1  # Show when 1 item away
    spend_away_threshold: 10  # Show when $10 away
```

---

*Last Updated: January 27, 2026*
