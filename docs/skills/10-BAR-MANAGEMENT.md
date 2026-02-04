# 10 - Bar Management

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 06-Tipping

---

## Overview

The Bar Management skill handles everything specific to bar operations - tab management, pour tracking, double/happy hour pricing, and bar-specific workflows. This is separate from general order management because bars have unique needs.

**Primary Goal:** Provide fast, efficient bar service with accurate pour tracking and flexible tab management.

---

## User Stories

### As a Bartender...
- I want to open tabs instantly with a card swipe
- I want to see all my open tabs at a glance
- I want to track my pours for accountability
- I want to quickly switch between happy hour and regular pricing
- I want to transfer tabs to servers when guests move to tables

### As a Bar Manager...
- I want to track pour costs and waste
- I want to see which bartenders are over-pouring
- I want to manage happy hour timing automatically
- I want to reconcile tabs at end of night

### As an Owner...
- I want to reduce liquor shrinkage
- I want accurate pour cost reporting
- I want to see bar performance vs restaurant

---

## Features

### Tab Management

#### Opening Tabs
- [ ] Swipe credit card to open (pre-auth)
- [ ] Open with name only (cash tab)
- [ ] Scan ID for name auto-fill
- [ ] Quick-open (one tap for regulars)
- [ ] Pre-auth amount configurable
- [ ] Tab naming (customer name, seat position)

#### Tab Display
- [ ] All open tabs list view
- [ ] Sort by: Name, Time, Amount, Seat
- [ ] Filter: My tabs / All tabs
- [ ] Running total visible
- [ ] Time open indicator
- [ ] Color coding (time warnings)

#### Tab Operations
- [ ] Add items to tab
- [ ] View tab detail
- [ ] Print running tab
- [ ] Transfer tab to table
- [ ] Transfer tab to another bartender
- [ ] Merge tabs
- [ ] Split tab
- [ ] Close tab

#### Tab Safeguards
- [ ] Pre-authorization holds
- [ ] Tab timeout warnings (configurable)
- [ ] Walk-out protection
- [ ] End-of-night forced close
- [ ] Declined card handling
- [ ] Card on file security (tokenization)

#### Tab Timeout Rules
```yaml
tab_timeouts:
  warning_1: 2 hours    # Yellow indicator
  warning_2: 3 hours    # Orange indicator
  critical: 4 hours     # Red indicator, alert
  auto_close: false     # Or true with tip %
  auto_close_tip_percent: 20
```

### Double Pricing

#### Price Levels
- [ ] Regular price
- [ ] Happy Hour price
- [ ] Late Night price
- [ ] Industry Night price
- [ ] Custom price levels

#### Price Display
- [ ] Show both prices on POS
- [ ] Visual indicator of active price
- [ ] Easy toggle between levels
- [ ] Automatic switching by time

#### Item-Level Pricing
```
Item: Draft IPA
├── Regular: $7.00
├── Happy Hour: $5.00
├── Late Night: $6.00
└── Industry: $4.00
```

### Pour Tracking

#### Pour Types
- [ ] Standard pour (1.5 oz)
- [ ] Double pour (3 oz)
- [ ] Rocks pour (2 oz)
- [ ] Tall pour
- [ ] Custom pour sizes

#### Tracking Methods
- [ ] Manual ring-in (item selection)
- [ ] Pour spout integration (future)
- [ ] Bottle tracking (inventory deduction)
- [ ] Waste/spill recording

#### Pour Cost Calculation
```
Bottle Cost: $25.00
Bottle Size: 750ml (25.4 oz)
Standard Pour: 1.5 oz
Pours per Bottle: 16.9
Cost per Pour: $1.48
Sell Price: $8.00
Pour Cost %: 18.5%
```

#### Pour Reporting
- [ ] Pours by bartender
- [ ] Pours by product
- [ ] Expected vs actual usage
- [ ] Variance alerts
- [ ] Shrinkage tracking

### Bar-Specific Items

#### Drink Building
- [ ] Base spirit selection
- [ ] Mixer additions
- [ ] Garnish tracking
- [ ] Recipe lookup
- [ ] Upsell prompts (premium spirits)

#### Quick-Add Buttons
- [ ] Configurable quick buttons
- [ ] Most popular drinks
- [ ] "Same again" button
- [ ] Round ordering (multiple of same)

#### Drink Modifiers
- [ ] Up/Rocks/Neat
- [ ] Dirty/Extra Dirty
- [ ] With a twist
- [ ] Premium upgrade
- [ ] Extra shot

### Bar Layout

#### Bar Top Tracking
- [ ] Seat positions (1-20+)
- [ ] Assign tabs to seats
- [ ] Visual bar top view
- [ ] Move between seats

#### Service Zones
- [ ] Define service areas
- [ ] Assign bartenders to zones
- [ ] Service well vs bar top

### Cash Bar Operations

#### Drink Tickets
- [ ] Print drink tickets for events
- [ ] Ticket redemption
- [ ] Ticket tracking
- [ ] Pre-paid drink packages

#### Event Mode
- [ ] Open bar (no charge)
- [ ] Limited selection open bar
- [ ] Drink ticket events
- [ ] Cash bar with minimum

---

## UI/UX Specifications

### Bar Tab View

```
+------------------------------------------------------------------+
| BAR TABS                    [+ New Tab]  [Close All]  [Transfer] |
+------------------------------------------------------------------+
| Search: [________________]     Sort: [Time ▼]     Filter: [Mine] |
+------------------------------------------------------------------+
| SEAT | NAME           | CARD     | TIME  | TOTAL  | ITEMS | ACT |
+------------------------------------------------------------------+
|  3   | Johnson, M     | ***4521  | 1:45  | $45.50 |   6   | [+] |
|  5   | Smith, Sarah   | ***1234  | 0:32  | $18.00 |   2   | [+] |
|  7   | Cash - Tom     | Cash     | 2:15! | $67.00 |   8   | [+] |
|  12  | Williams       | ***9876  | 3:30! | $89.00 |  12   | [+] |
|  --  | Garcia (moved) | ***5555  | 0:45  | $23.00 |   3   | [+] |
+------------------------------------------------------------------+
|                                          Total Open: $242.50     |
+------------------------------------------------------------------+

! = Warning (approaching timeout)
[+] = Quick add item
```

### Bar Top Layout

```
+------------------------------------------------------------------+
| BAR TOP VIEW                                           [Edit]    |
+------------------------------------------------------------------+
|                                                                  |
|     SERVICE WELL                                                 |
|   [=====================================]                        |
|                                                                  |
|   +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+    |
|   | 1|  | 2|  | 3|  | 4|  | 5|  | 6|  | 7|  | 8|  | 9|  |10|    |
|   |  |  |  |  |$$|  |  |  |$$|  |  |  |$$|  |  |  |  |  |  |    |
|   +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+    |
|                                                                  |
|   +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+    |
|   |11|  |12|  |13|  |14|  |15|  |16|  |17|  |18|  |19|  |20|    |
|   |  |  |$$|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |    |
|   +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+  +--+    |
|                                                                  |
|   $$ = Has open tab       Empty = Available                      |
+------------------------------------------------------------------+
```

### Quick-Add Bar Menu

```
+------------------------------------------------------------------+
| QUICK BAR                              [Full Menu] [Happy Hour]  |
+------------------------------------------------------------------+
| BEER                           | WELLS              | SHOTS      |
| +--------+ +--------+          | +--------+         | +--------+ |
| | Bud Lt | | Miller | ...      | | Vodka  |         | | Fireball||
| | $5.00  | | $5.00  |          | | $6.00  |         | | $5.00  | |
| +--------+ +--------+          | +--------+         | +--------+ |
|                                |                    |            |
| DRAFT                          | CALL               | WINE       |
| +--------+ +--------+          | +--------+         | +--------+ |
| | IPA    | | Lager  | ...      | | Tito's |         | | House  | |
| | $7.00  | | $6.00  |          | | $8.00  |         | | $8.00  | |
| +--------+ +--------+          | +--------+         | +--------+ |
|                                |                    |            |
| COCKTAILS                      | PREMIUM            | NON-ALC    |
| +--------+ +--------+          | +--------+         | +--------+ |
| | Marg   | | Moscow | ...      | | Grey   |         | | Soda   | |
| | $10.00 | | $9.00  |          | | $10.00 |         | | $3.00  | |
| +--------+ +--------+          | +--------+         | +--------+ |
+------------------------------------------------------------------+
| [Same Again]  [Round for Seat 3]  [Tab: Johnson $45.50]  [Pay]   |
+------------------------------------------------------------------+
```

---

## Data Model

### Bar Tabs
```sql
bar_tabs {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  order_id: UUID (FK) -- Links to orders table

  -- Tab identification
  tab_name: VARCHAR(100)
  seat_number: INTEGER (nullable)

  -- Card info
  card_token: VARCHAR(200) (nullable, encrypted)
  card_last_four: VARCHAR(4) (nullable)
  preauth_amount: DECIMAL(10,2) (nullable)
  preauth_transaction_id: VARCHAR(100) (nullable)

  -- Assignment
  bartender_id: UUID (FK)

  -- Timing
  opened_at: TIMESTAMP
  last_activity_at: TIMESTAMP
  closed_at: TIMESTAMP (nullable)

  -- Status
  status: VARCHAR(50) (open, transferred, closed, walked)

  -- If transferred
  transferred_to_table_id: UUID (FK, nullable)
  transferred_to_server_id: UUID (FK, nullable)
  transferred_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Pour Tracking
```sql
pour_records {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- What
  inventory_item_id: UUID (FK) -- The spirit/wine
  menu_item_id: UUID (FK, nullable) -- The drink sold
  order_item_id: UUID (FK, nullable)

  -- Pour details
  pour_size_oz: DECIMAL(4,2)
  pour_type: VARCHAR(50) (standard, double, rocks, tall, waste, comp)
  quantity: INTEGER DEFAULT 1

  -- Cost
  cost_per_oz: DECIMAL(8,4)
  total_cost: DECIMAL(10,2)

  -- Who
  bartender_id: UUID (FK)

  -- When
  poured_at: TIMESTAMP

  -- Notes
  notes: VARCHAR(200) (nullable)

  created_at: TIMESTAMP
}
```

### Price Levels
```sql
price_levels {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  code: VARCHAR(20)
  description: TEXT (nullable)

  -- When active
  is_default: BOOLEAN DEFAULT false
  is_timed: BOOLEAN DEFAULT false
  start_time: TIME (nullable)
  end_time: TIME (nullable)
  active_days: INTEGER[] (nullable)

  -- Manual override
  can_manual_activate: BOOLEAN DEFAULT true

  sort_order: INTEGER
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Item Price Levels
```sql
item_price_levels {
  id: UUID PRIMARY KEY
  menu_item_id: UUID (FK)
  price_level_id: UUID (FK)

  price: DECIMAL(10,2)

  created_at: TIMESTAMP

  UNIQUE (menu_item_id, price_level_id)
}
```

### Bar Seats
```sql
bar_seats {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  seat_number: INTEGER
  zone: VARCHAR(50) (nullable) -- bar_top, service_well, etc.
  position_x: INTEGER (for visual layout)
  position_y: INTEGER

  is_active: BOOLEAN DEFAULT true

  UNIQUE (location_id, seat_number)
}
```

---

## API Endpoints

### Tabs
```
POST   /api/bar/tabs                    -- Open new tab
GET    /api/bar/tabs                    -- List open tabs
GET    /api/bar/tabs/{id}               -- Get tab details
PUT    /api/bar/tabs/{id}               -- Update tab
POST   /api/bar/tabs/{id}/close         -- Close tab
POST   /api/bar/tabs/{id}/transfer      -- Transfer tab
POST   /api/bar/tabs/{id}/merge         -- Merge with another tab
GET    /api/bar/tabs/warnings           -- Get tabs near timeout
```

### Pour Tracking
```
POST   /api/bar/pours                   -- Record pour
GET    /api/bar/pours                   -- List pours
POST   /api/bar/pours/waste             -- Record waste/spill
GET    /api/bar/pours/summary           -- Pour summary
GET    /api/bar/pours/variance          -- Variance report
```

### Price Levels
```
GET    /api/price-levels                -- List price levels
POST   /api/price-levels                -- Create price level
PUT    /api/price-levels/{id}           -- Update price level
GET    /api/price-levels/active         -- Get currently active
POST   /api/price-levels/{id}/activate  -- Manual activate
```

### Bar Layout
```
GET    /api/bar/seats                   -- Get bar seats
PUT    /api/bar/seats                   -- Update layout
GET    /api/bar/seats/status            -- Get seat status
```

---

## Business Rules

1. **Pre-Auth Required:** Credit card tabs require successful pre-auth
2. **Tab Timeout:** Tabs exceeding timeout threshold trigger alerts
3. **Walk-Out:** If tab closed without payment, flag and report
4. **Pour Tracking:** All pours must be recorded for inventory accuracy
5. **Price Level Priority:** Timed price levels override default automatically
6. **Transfer Rules:** Transferred tabs retain original bartender for tip tracking
7. **End of Night:** All tabs must be closed before system close

---

## Permissions

| Action | Bartender | Bar Manager | Manager | Admin |
|--------|-----------|-------------|---------|-------|
| Open tabs | Yes | Yes | Yes | Yes |
| Close tabs | Yes | Yes | Yes | Yes |
| Transfer tabs | Yes | Yes | Yes | Yes |
| View all tabs | Own | Yes | Yes | Yes |
| Force close tabs | No | Yes | Yes | Yes |
| Record pours | Yes | Yes | Yes | Yes |
| View pour reports | No | Yes | Yes | Yes |
| Manage price levels | No | Yes | Yes | Yes |
| Edit bar layout | No | Yes | Yes | Yes |

---

## Configuration Options

```yaml
bar_management:
  tabs:
    require_card: true
    preauth_amount: 50.00
    allow_cash_tabs: true
    timeout_warning_minutes: 120
    timeout_critical_minutes: 240
    auto_close_enabled: false
    auto_close_tip_percent: 20

  pour_tracking:
    enabled: true
    standard_pour_oz: 1.5
    require_pour_record: false
    variance_alert_threshold: 10  # percent

  price_levels:
    enabled: true
    auto_switch: true
    show_both_prices: true

  bar_layout:
    seat_count: 20
    zones_enabled: true
```

---

## Open Questions

1. **Pour Spout Integration:** Support for automated pour tracking hardware?

2. **ID Scanning:** Integrate with ID scanners for age verification?

3. **Regular Recognition:** Track regulars and their usual orders?

4. **Bar Games:** Integration with electronic dart boards, pool tables?

5. **Drink Recipes:** Built-in recipe database for training?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Tab workflow finalized
- [ ] Pour tracking approach confirmed
- [ ] UI mockups

### Development
- [ ] Tab management
- [ ] Price levels
- [ ] Pour tracking
- [ ] Bar layout
- [ ] Quick-add interface
- [ ] Timeout alerts
- [ ] End-of-night workflow

---

*Last Updated: January 27, 2026*
