# 16 - Happy Hour

**Status:** Planning
**Priority:** Medium
**Dependencies:** 03-Menu-Programming, 10-Bar-Management

---

## Overview

The Happy Hour skill manages time-based pricing promotions including happy hour, late night specials, brunch pricing, and other scheduled price changes. Integrates with the price levels system but provides dedicated management for promotional periods.

**Primary Goal:** Automate promotional pricing with flexible scheduling and easy management.

---

## User Stories

### As a Manager...
- I want to set up happy hour pricing that activates automatically
- I want different specials for different days of the week
- I want to easily extend or cancel happy hour on specific days
- I want to see how happy hour affects my sales

### As a Server/Bartender...
- I want to know when happy hour pricing is active
- I want a clear indicator of which prices are discounted
- I want to manually apply happy hour if a guest just missed it

### As an Owner...
- I want to track the effectiveness of our promotions
- I want to A/B test different happy hour configurations
- I want compliance with local happy hour regulations

---

## Features

### Promotion Types

#### Happy Hour
- [ ] Standard time-based discounts
- [ ] Food and/or drink specials
- [ ] Fixed price items
- [ ] Percentage discounts

#### Other Promotions
- [ ] Late Night Menu
- [ ] Brunch Specials
- [ ] Industry Night
- [ ] Game Day Specials
- [ ] Holiday Specials

### Scheduling

#### Time-Based Rules
```yaml
happy_hour:
  name: "Happy Hour"
  schedules:
    - days: [mon, tue, wed, thu, fri]
      start: "16:00"
      end: "19:00"
    - days: [sat, sun]
      start: "12:00"
      end: "15:00"
```

#### Day-Specific Rules
- [ ] Different times per day
- [ ] Different items per day
- [ ] Exclude specific days
- [ ] Holiday handling

#### Date Range Rules
- [ ] Start/end dates for limited promotions
- [ ] Seasonal specials
- [ ] Event-specific pricing

### Pricing Configuration

#### Item Pricing
- [ ] Fixed happy hour price
- [ ] Percentage off regular price
- [ ] Dollar amount off
- [ ] Buy X get Y free/discounted

#### Category Pricing
- [ ] Apply discount to entire category
- [ ] "All drafts $5"
- [ ] "50% off appetizers"

#### Bundle Pricing
- [ ] Combo deals during happy hour
- [ ] "$20 Burger + Beer"
- [ ] "2-for-1 wells"

### Activation Control

#### Automatic
- [ ] Activates/deactivates on schedule
- [ ] No manual intervention needed
- [ ] System clock based

#### Manual Override
- [ ] Start happy hour early
- [ ] Extend happy hour
- [ ] Cancel happy hour today
- [ ] Apply to specific check retroactively

#### Override Permissions
- [ ] Who can extend/cancel
- [ ] Limits on extensions
- [ ] Logging of overrides

### Display & Communication

#### POS Indicators
- [ ] Happy hour active banner
- [ ] Items showing both prices
- [ ] Countdown timer (time remaining)
- [ ] Visual distinction on menu

#### Customer Communication
- [ ] Customer display message
- [ ] Receipt notation
- [ ] Menu board integration

### Compliance Features

#### Regulations
- [ ] Some jurisdictions limit happy hour
- [ ] Maximum discount percentages
- [ ] Required food with drink deals
- [ ] Time restrictions

#### Compliance Settings
```yaml
compliance:
  max_discount_percent: 50
  require_food_with_drink: false
  restricted_hours: []  # Hours when HH not allowed
  max_consecutive_hours: 4
```

---

## UI/UX Specifications

### Happy Hour Management

```
+------------------------------------------------------------------+
| HAPPY HOUR MANAGEMENT                              [+ New Promo] |
+------------------------------------------------------------------+
|                                                                  |
| ACTIVE NOW: Happy Hour (ends in 1:23)              [Extend]      |
|                                                                  |
| PROMOTIONS                                                       |
| +-------------------------------------------------------------+ |
| | Happy Hour                              [Edit] [Disable]     | |
| | Mon-Fri 4PM-7PM, Sat-Sun 12PM-3PM                           | |
| | 15 items, Avg discount: 30%                                  | |
| +-------------------------------------------------------------+ |
| | Late Night                              [Edit] [Disable]     | |
| | Daily 10PM-Close                                             | |
| | 8 items, Avg discount: 25%                                   | |
| +-------------------------------------------------------------+ |
| | Industry Night                          [Edit] [Disable]     | |
| | Mondays 9PM-Close (with industry ID)                        | |
| | All drinks 50% off                                           | |
| +-------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
```

### Promotion Editor

```
+------------------------------------------------------------------+
| EDIT PROMOTION: Happy Hour                             [Save]    |
+------------------------------------------------------------------+
| Name: [Happy Hour____________]     Active: [Yes ▼]              |
|                                                                  |
| SCHEDULE                                                         |
| +-------------------------------------------------------------+ |
| | Day       | Start    | End      | Active |                   | |
| | Monday    | [4:00 PM]| [7:00 PM]|   ☑    |                   | |
| | Tuesday   | [4:00 PM]| [7:00 PM]|   ☑    |                   | |
| | Wednesday | [4:00 PM]| [7:00 PM]|   ☑    |                   | |
| | Thursday  | [4:00 PM]| [7:00 PM]|   ☑    |                   | |
| | Friday    | [4:00 PM]| [7:00 PM]|   ☑    |                   | |
| | Saturday  | [12:00PM]| [3:00 PM]|   ☑    |                   | |
| | Sunday    | [12:00PM]| [3:00 PM]|   ☑    |                   | |
| +-------------------------------------------------------------+ |
|                                                                  |
| PRICING                                     [+ Add Item/Category]|
| +-------------------------------------------------------------+ |
| | Item/Category      | Regular  | HH Price | Discount          | |
| | All Draft Beer     | Varies   | $5.00    | Fixed price       | |
| | Well Drinks        | $8.00    | $5.00    | -$3.00           | |
| | Appetizers         | Varies   | -50%     | 50% off           | |
| | Burger + Beer      | $22.00   | $15.00   | Bundle           | |
| +-------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
```

### POS Happy Hour Indicator

```
+------------------------------------------------------------------+
|  🍺 HAPPY HOUR ACTIVE - Ends in 1:23                    [Menu]  |
+------------------------------------------------------------------+
| HAPPY HOUR SPECIALS                                              |
| +--------+ +--------+ +--------+ +--------+ +--------+          |
| | Draft  | | Well   | | Wings  | | Nachos | | Marg   |          |
| | Beer   | | Drink  | |        | |        | |        |          |
| | $5     | | $5     | | $6     | | $7     | | $6     |          |
| | reg $7 | | reg $8 | | reg $12| | reg $11| | reg $10|          |
| +--------+ +--------+ +--------+ +--------+ +--------+          |
|                                                                  |
| [View Full Menu]                                                |
+------------------------------------------------------------------+
```

---

## Data Model

### Promotions
```sql
promotions {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)
  promotion_type: VARCHAR(50) (happy_hour, late_night, brunch, custom)

  -- Validity
  start_date: DATE (nullable) -- NULL = no start limit
  end_date: DATE (nullable) -- NULL = no end limit
  is_active: BOOLEAN DEFAULT true

  -- Display
  display_message: VARCHAR(200) (nullable)
  show_on_customer_display: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Promotion Schedules
```sql
promotion_schedules {
  id: UUID PRIMARY KEY
  promotion_id: UUID (FK)

  day_of_week: INTEGER (0-6)
  start_time: TIME
  end_time: TIME
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Promotion Items
```sql
promotion_items {
  id: UUID PRIMARY KEY
  promotion_id: UUID (FK)

  -- What gets the promotion
  menu_item_id: UUID (FK, nullable)
  menu_category_id: UUID (FK, nullable) -- For category-wide
  applies_to: VARCHAR(50) (item, category, tag)

  -- Pricing
  discount_type: VARCHAR(50) (fixed_price, percent_off, amount_off, bogo)
  discount_value: DECIMAL(10,2)

  -- For BOGO
  buy_quantity: INTEGER (nullable)
  get_quantity: INTEGER (nullable)
  get_discount_percent: DECIMAL(5,2) (nullable) -- e.g., 100 for free, 50 for half off

  created_at: TIMESTAMP
}
```

### Promotion Overrides
```sql
promotion_overrides {
  id: UUID PRIMARY KEY
  promotion_id: UUID (FK)

  override_date: DATE
  override_type: VARCHAR(50) (extend, cancel, early_start, custom_times)

  -- For custom times
  custom_start: TIME (nullable)
  custom_end: TIME (nullable)

  reason: VARCHAR(200) (nullable)

  created_by: UUID (FK)
  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Promotions
```
GET    /api/promotions
POST   /api/promotions
GET    /api/promotions/{id}
PUT    /api/promotions/{id}
DELETE /api/promotions/{id}
GET    /api/promotions/active
```

### Schedules
```
GET    /api/promotions/{id}/schedules
PUT    /api/promotions/{id}/schedules
```

### Items
```
GET    /api/promotions/{id}/items
POST   /api/promotions/{id}/items
DELETE /api/promotions/{id}/items/{item_id}
```

### Overrides
```
POST   /api/promotions/{id}/extend
POST   /api/promotions/{id}/cancel-today
POST   /api/promotions/{id}/override
```

### Status
```
GET    /api/promotions/status
WS     /ws/promotions  -- Real-time status updates
```

---

## Business Rules

1. **Automatic Activation:** Promotions activate/deactivate based on schedule
2. **Price Priority:** Happy hour price overrides regular price when active
3. **Stacking:** Configure whether promotions stack or use best price
4. **Retroactive:** Manager can apply HH price to recent order if just ended
5. **Extension Limits:** May limit how long HH can be extended

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| View active promotions | Yes | Yes | Yes |
| Apply manually | No | Yes | Yes |
| Extend | No | Yes | Yes |
| Cancel today | No | Yes | Yes |
| Configure promotions | No | Yes | Yes |
| Create promotions | No | No | Yes |

---

## Configuration Options

```yaml
happy_hour:
  auto_activate: true
  show_countdown: true
  show_both_prices: true

  overrides:
    allow_extend: true
    max_extend_minutes: 60
    allow_early_start: true
    max_early_minutes: 30

  compliance:
    enabled: false
    max_discount_percent: 50
```

---

## Open Questions

1. **Price Display:** Show savings or just special price?

2. **Notification:** Alert staff X minutes before HH ends?

3. **Grace Period:** Apply HH to orders placed right after end time?

4. **A/B Testing:** Track different promotion configurations?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Scheduling logic finalized
- [ ] UI mockups

### Development
- [ ] Promotion management
- [ ] Scheduling engine
- [ ] Price integration
- [ ] Override controls
- [ ] POS indicators
- [ ] Reporting

---

*Last Updated: January 27, 2026*
