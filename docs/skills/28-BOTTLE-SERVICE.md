# 28 - Bottle Service

**Status:** Planning
**Priority:** Medium
**Dependencies:** 04-Order-Management, 10-Bar-Management

---

## Overview

The Bottle Service skill manages VIP table service including bottle sales, minimum spend requirements, deposits, and service tracking. Essential for nightclubs, lounges, and upscale venues.

**Primary Goal:** Streamline VIP table operations with spend tracking, alerts, and premium guest experience.

---

## User Stories

### As a VIP Host/Server...
- I want to track bottle purchases per table
- I want to see minimum spend progress
- I want alerts when tables are approaching minimums
- I want to manage deposits and pre-authorizations

### As a Manager...
- I want to set minimum spend by table/section
- I want to see bottle inventory
- I want to track VIP revenue
- I want to manage bottle pricing for events

### As a Guest (VIP)...
- I want to know my minimum spend
- I want to see my running total
- I want easy bottle ordering
- I want bottle presentation service

---

## Features

### VIP Table Setup

#### Table Configuration
- [ ] Designate VIP tables
- [ ] Set minimum spend per table
- [ ] Set deposit requirements
- [ ] Table capacity limits
- [ ] Reservation requirements

#### Minimum Spend Rules
```yaml
vip_tables:
  - table: "VIP 1"
    min_spend: 500.00
    deposit: 200.00
    capacity: 8

  - table: "VIP 2"
    min_spend: 1000.00
    deposit: 400.00
    capacity: 12

  - section: "Cabana"
    min_spend: 2000.00
    deposit: 800.00
    capacity: 20
```

### Deposit Management

#### Collecting Deposits
- [ ] Credit card hold
- [ ] Cash deposit
- [ ] Prior payment
- [ ] Deposit waiver (manager override)

#### Deposit Tracking
- [ ] Amount collected
- [ ] Payment method
- [ ] Applied to final bill
- [ ] Refund handling

### Minimum Spend Tracking

#### Progress Display
- [ ] Current spend total
- [ ] Minimum requirement
- [ ] Remaining to meet minimum
- [ ] Percentage complete
- [ ] Time remaining (if timed)

#### Visual Indicators
```
VIP TABLE 1 - Smith Party
Minimum: $500.00
Current: $325.00
━━━━━━━━━━━━━━░░░░░░ 65%
Remaining: $175.00
```

#### Alerts
- [ ] 50% of minimum reached
- [ ] 75% of minimum reached
- [ ] 30 minutes to close, under minimum
- [ ] Minimum met!

### Bottle Menu

#### Bottle Categories
- [ ] Vodka
- [ ] Whiskey
- [ ] Tequila
- [ ] Champagne
- [ ] Cognac
- [ ] Premium/Reserve

#### Bottle Pricing
- [ ] Regular price
- [ ] Event pricing
- [ ] VIP member pricing
- [ ] Package pricing

#### Bottle Packages
```yaml
packages:
  - name: "Starter Package"
    price: 400.00
    includes:
      - "1 bottle Vodka"
      - "Mixers and garnishes"
      - "Reserved seating for 4"

  - name: "Premium Package"
    price: 800.00
    includes:
      - "2 bottles (choice)"
      - "Champagne toast"
      - "VIP seating for 8"
      - "Dedicated server"
```

### Bottle Service Workflow

#### Ordering Bottles
- [ ] Select from bottle menu
- [ ] Add to VIP table check
- [ ] Note special requests
- [ ] Queue for presentation

#### Presentation
- [ ] Presentation notification
- [ ] Sparklers/effects flag
- [ ] Photo opportunity
- [ ] Server assignment

#### Tracking
- [ ] Bottle opened time
- [ ] Consumption pace (optional)
- [ ] Reorder suggestions

### Inventory Integration

#### Bottle Inventory
- [ ] Track bottles in stock
- [ ] Reserve for VIP service
- [ ] Low stock alerts
- [ ] Premium bottle allocation

#### Bottle Tracking
- [ ] Each bottle tracked individually
- [ ] Serial/batch if applicable
- [ ] Cost tracking

### VIP Guest Management

#### Guest Profiles
- [ ] VIP guest database
- [ ] Preferences
- [ ] Spend history
- [ ] Special requests

#### Recognition
- [ ] Flag repeat VIPs
- [ ] Birthday/celebration alerts
- [ ] Complimentary items

### Gratuity & Service Charges

#### Automatic Gratuity
- [ ] Auto-gratuity percentage
- [ ] Applies to bottle service
- [ ] Display on check

#### Service Charges
- [ ] Room/table charge
- [ ] Event charge
- [ ] Security deposit

---

## UI/UX Specifications

### VIP Table Dashboard

```
+------------------------------------------------------------------+
| VIP TABLES                                          11:45 PM     |
+------------------------------------------------------------------+
|                                                                  |
| +---------------------------+ +---------------------------+      |
| | VIP 1 - SMITH PARTY       | | VIP 2 - JOHNSON PARTY     |      |
| | 8 guests                  | | 12 guests                 |      |
| |                           | |                           |      |
| | Minimum: $500             | | Minimum: $1,000           |      |
| | Current: $725 ✓           | | Current: $650             |      |
| | ████████████████████ 145% | | ████████████░░░░░░ 65%   |      |
| |                           | |                           |      |
| | Bottles: 2                | | Bottles: 1                |      |
| | - Grey Goose              | | - Don Julio 1942          |      |
| | - Moët                    | |                           |      |
| |                           | | ⚠️ $350 to minimum        |      |
| | [View] [Add Bottle]       | | [View] [Add Bottle]       |      |
| +---------------------------+ +---------------------------+      |
|                                                                  |
| +---------------------------+ +---------------------------+      |
| | VIP 3 - AVAILABLE         | | CABANA - WILLIAMS         |      |
| |                           | | 15 guests                 |      |
| | Min: $750 | Deposit: $300 | |                           |      |
| |                           | | Minimum: $2,000           |      |
| | [Reserve]                 | | Current: $1,875           |      |
| +---------------------------+ | ██████████████████░░ 94%  |      |
|                              | |                           |      |
|                              | | Bottles: 4                |      |
|                              | | ⚠️ $125 to minimum        |      |
|                              | | [View] [Add Bottle]       |      |
|                              | +---------------------------+      |
|                                                                  |
+------------------------------------------------------------------+
```

### VIP Table Detail

```
+------------------------------------------------------------------+
| VIP TABLE 2 - Johnson Party                    [Edit] [Close]    |
+------------------------------------------------------------------+
| Host: Sarah M.              Guests: 12          Since: 10:30 PM  |
+------------------------------------------------------------------+
|                                                                  |
| MINIMUM SPEND PROGRESS                                           |
| ┌─────────────────────────────────────────────────────────────┐ |
| │ Minimum Required: $1,000.00                                  │ |
| │ Current Spend:      $650.00                                  │ |
| │ Remaining:          $350.00                                  │ |
| │                                                              │ |
| │ ████████████████████████████████░░░░░░░░░░░░░░░░ 65%        │ |
| └─────────────────────────────────────────────────────────────┘ |
|                                                                  |
| DEPOSIT                                                          |
| Collected: $400.00 (Visa ***4521)                               |
| Applied to bill on close                                        |
|                                                                  |
| BOTTLES ORDERED                                                  |
| +----------------------------------------------------------+    |
| | Don Julio 1942           $350.00    10:45 PM             |    |
| |   Presentation complete                                   |    |
| +----------------------------------------------------------+    |
|                                                                  |
| OTHER ITEMS                                                      |
| +----------------------------------------------------------+    |
| | 6x Red Bull                $30.00                         |    |
| | 2x Sprite                   $8.00                         |    |
| | Mixers package            $50.00                         |    |
| | VIP entry (12)           $240.00                         |    |
| +----------------------------------------------------------+    |
|                                                                  |
| Subtotal: $678.00    Service (20%): $135.60    Tax: $54.24     |
| Deposit: -$400.00                                               |
| TOTAL DUE: $467.84                                              |
|                                                                  |
+------------------------------------------------------------------+
| [Add Bottle]  [Add Items]  [Adjust Minimum]  [Close Check]      |
+------------------------------------------------------------------+
```

### Bottle Menu

```
+------------------------------------------------------------------+
| BOTTLE MENU                                       [Cart: 0]      |
+------------------------------------------------------------------+
|                                                                  |
| VODKA                              WHISKEY                       |
| +------------------------+         +------------------------+    |
| | Grey Goose       $300 |         | Johnnie Blue     $450 |    |
| | Belvedere        $275 |         | Macallan 18      $500 |    |
| | Tito's           $200 |         | Hibiki           $400 |    |
| | Ciroc            $300 |         | Jack Daniels     $200 |    |
| +------------------------+         +------------------------+    |
|                                                                  |
| TEQUILA                            CHAMPAGNE                     |
| +------------------------+         +------------------------+    |
| | Don Julio 1942   $350 |         | Moët             $250 |    |
| | Clase Azul       $400 |         | Veuve Clicquot   $275 |    |
| | Patron Silver    $250 |         | Dom Pérignon     $500 |    |
| | Casamigos        $275 |         | Ace of Spades    $600 |    |
| +------------------------+         +------------------------+    |
|                                                                  |
| PACKAGES                                                         |
| +----------------------------------------------------------+    |
| | STARTER PACKAGE                                    $400   |    |
| | 1 bottle vodka, mixers, reserved seating for 4           |    |
| +----------------------------------------------------------+    |
| | PREMIUM PACKAGE                                    $800   |    |
| | 2 bottles (choice), champagne toast, VIP seating for 8   |    |
| +----------------------------------------------------------+    |
|                                                                  |
+------------------------------------------------------------------+
```

---

## Data Model

### VIP Table Configuration
```sql
vip_tables {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  table_id: UUID (FK)

  minimum_spend: DECIMAL(10,2)
  deposit_amount: DECIMAL(10,2)
  capacity: INTEGER

  -- Service charges
  auto_gratuity_percent: DECIMAL(5,2) (nullable)
  service_charge: DECIMAL(10,2) (nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### VIP Sessions
```sql
vip_sessions {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  vip_table_id: UUID (FK)
  order_id: UUID (FK)

  -- Party info
  party_name: VARCHAR(200)
  party_size: INTEGER
  host_employee_id: UUID (FK)

  -- Minimum
  minimum_spend: DECIMAL(10,2)
  current_spend: DECIMAL(10,2) DEFAULT 0
  minimum_met: BOOLEAN DEFAULT false
  minimum_met_at: TIMESTAMP (nullable)

  -- Deposit
  deposit_amount: DECIMAL(10,2)
  deposit_collected: BOOLEAN DEFAULT false
  deposit_payment_id: UUID (FK, nullable)

  -- Guest
  vip_guest_id: UUID (FK, nullable)

  -- Timing
  started_at: TIMESTAMP
  ended_at: TIMESTAMP (nullable)

  -- Status
  status: VARCHAR(50) (active, closed, cancelled)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Bottle Orders
```sql
bottle_orders {
  id: UUID PRIMARY KEY
  vip_session_id: UUID (FK)
  order_item_id: UUID (FK)

  bottle_item_id: UUID (FK) -- Menu item
  bottle_name: VARCHAR(200)
  price: DECIMAL(10,2)

  -- Presentation
  presentation_requested: BOOLEAN DEFAULT true
  sparklers: BOOLEAN DEFAULT false
  presentation_completed: BOOLEAN DEFAULT false
  presented_at: TIMESTAMP (nullable)

  -- Tracking
  opened_at: TIMESTAMP (nullable)

  notes: TEXT (nullable)

  created_at: TIMESTAMP
}
```

### VIP Guests
```sql
vip_guests {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(200)
  phone: VARCHAR(20) (nullable)
  email: VARCHAR(200) (nullable)

  -- Preferences
  preferred_table: VARCHAR(100) (nullable)
  preferred_bottles: VARCHAR[] (nullable)
  notes: TEXT (nullable)

  -- History
  total_visits: INTEGER DEFAULT 0
  total_spend: DECIMAL(12,2) DEFAULT 0
  last_visit: DATE (nullable)

  -- Status
  vip_tier: VARCHAR(50) (nullable)
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Bottle Inventory
```sql
bottle_inventory {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  menu_item_id: UUID (FK)

  quantity_on_hand: INTEGER
  reserved_for_vip: INTEGER DEFAULT 0
  reorder_point: INTEGER (nullable)

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### VIP Tables
```
GET    /api/vip/tables
GET    /api/vip/tables/{id}
PUT    /api/vip/tables/{id}
GET    /api/vip/tables/available
```

### VIP Sessions
```
POST   /api/vip/sessions
GET    /api/vip/sessions
GET    /api/vip/sessions/{id}
PUT    /api/vip/sessions/{id}
POST   /api/vip/sessions/{id}/close
GET    /api/vip/sessions/{id}/progress
```

### Bottles
```
POST   /api/vip/sessions/{id}/bottles
GET    /api/vip/sessions/{id}/bottles
PUT    /api/vip/bottles/{id}/presented
```

### Deposits
```
POST   /api/vip/sessions/{id}/deposit
DELETE /api/vip/sessions/{id}/deposit
```

### VIP Guests
```
GET    /api/vip/guests
POST   /api/vip/guests
GET    /api/vip/guests/{id}
PUT    /api/vip/guests/{id}
GET    /api/vip/guests/{id}/history
```

### Reporting
```
GET    /api/reports/vip/summary
GET    /api/reports/vip/by-table
GET    /api/reports/vip/by-guest
GET    /api/reports/bottles/sales
```

---

## Business Rules

1. **Deposit First:** Deposit must be collected before service begins
2. **Minimum Tracking:** Spend tracked in real-time
3. **Auto-Gratuity:** Automatically applied to bottle service
4. **Presentation Queue:** Bottles queued for presentation in order
5. **Under-Minimum:** Alert staff if closing under minimum

---

## Permissions

| Action | VIP Server | Manager | Admin |
|--------|------------|---------|-------|
| Start VIP session | Yes | Yes | Yes |
| Add bottles | Yes | Yes | Yes |
| Collect deposit | Yes | Yes | Yes |
| Waive deposit | No | Yes | Yes |
| Adjust minimum | No | Yes | Yes |
| Close under minimum | No | Yes | Yes |
| Configure VIP tables | No | Yes | Yes |
| Manage VIP guests | No | Yes | Yes |

---

## Configuration Options

```yaml
bottle_service:
  minimums:
    enforce_minimum: true
    allow_close_under: false  # Or require manager
    grace_period_minutes: 30

  deposits:
    required: true
    hold_vs_charge: "hold"
    apply_to_bill: true

  presentation:
    default_sparklers: false
    notification_sound: true
    photo_prompt: true

  gratuity:
    auto_gratuity_percent: 20
    show_on_check: true

  alerts:
    progress_50_percent: true
    progress_75_percent: true
    under_minimum_warning_minutes: 30
```

---

## Open Questions

1. **Minimum Enforcement:** What happens if party can't meet minimum?

2. **Bottle Tracking:** Individual bottle serial tracking?

3. **Membership Tiers:** VIP membership levels with perks?

4. **Event Pricing:** Dynamic pricing for special events?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Workflow finalized
- [ ] UI mockups

### Development
- [ ] VIP table setup
- [ ] Session management
- [ ] Minimum tracking
- [ ] Deposit handling
- [ ] Bottle ordering
- [ ] Presentation queue
- [ ] Reporting

---

*Last Updated: January 27, 2026*
