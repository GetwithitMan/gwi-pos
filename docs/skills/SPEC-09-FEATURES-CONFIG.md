# 09 - Features & Configuration

**Status:** Planning
**Priority:** High
**Dependencies:** None (Foundation)

---

## Overview

The Features & Configuration skill is the **foundation** of the system. It controls which features are enabled/disabled, system-wide settings, location configuration, and provides the central settings management interface.

**Primary Goal:** Provide a flexible configuration system that allows the POS to be customized for different restaurant types and operational needs.

---

## User Stories

### As an Owner...
- I want to enable only the features we need
- I want to configure the system for our specific operation
- I want to manage multiple locations from one place
- I want to set business rules that apply everywhere

### As an Admin...
- I want to quickly enable/disable features
- I want to configure integrations
- I want to manage system-wide settings
- I want to back up and restore configurations

### As a Manager...
- I want to adjust settings for my location
- I want to understand what features are available
- I want to enable features for testing

---

## Features

### Feature Flags

#### Core Feature Toggles
- [ ] **Table Service** - Enable table management, floor plans
- [ ] **Quick Service** - Enable counter/fast casual mode
- [ ] **Bar Mode** - Enable bar tabs, pre-auth
- [ ] **Online Ordering** - Enable online order receipt
- [ ] **Delivery** - Enable delivery management
- [ ] **Reservations** - Enable reservation system
- [ ] **Kiosk Mode** - Enable self-service kiosk

#### Operational Features
- [ ] **Course Management** - Enable coursing and fire control
- [ ] **Seat Tracking** - Track items by seat number
- [ ] **Tip Pooling** - Enable tip pool management
- [ ] **Inventory Tracking** - Enable ingredient-level inventory
- [ ] **Time Tracking** - Enable employee clock in/out
- [ ] **Scheduling** - Enable schedule management

#### Payment Features
- [ ] **Split Checks** - Allow check splitting
- [ ] **Split Payments** - Allow multiple payment types
- [ ] **Gift Cards** - Enable gift card support
- [ ] **House Accounts** - Enable charge accounts
- [ ] **Tipping** - Enable tip functionality

#### Advanced Features
- [ ] **Multi-Location** - Enable multi-location support
- [ ] **Kitchen Display** - Enable KDS integration
- [ ] **Customer Display** - Enable customer-facing screen
- [ ] **API Access** - Enable external API access
- [ ] **Loyalty Program** - Enable loyalty integration

### Location Management

#### Location Profile
- [ ] Business name
- [ ] Address
- [ ] Phone, email
- [ ] Website
- [ ] Logo
- [ ] Time zone
- [ ] Currency

#### Operating Hours
- [ ] Hours by day
- [ ] Holiday hours
- [ ] Special events
- [ ] Business day end time (for late night)

#### Tax Configuration
- [ ] Tax rates by type
- [ ] Tax-exempt handling
- [ ] Tax rounding rules

### System Settings

#### Order Settings
```yaml
orders:
  number_format: "A-###"
  require_server: true
  require_guest_count: true
  auto_send_to_kitchen: false
  default_order_type: "dine_in"
  allow_zero_total: false
```

#### Payment Settings
```yaml
payments:
  processor: "stripe"  # or square, heartland, etc.
  require_signature_above: 25.00
  allow_offline_payments: true
  cash_rounding: "nearest_cent"  # or nearest_nickel
  auto_close_on_payment: true
```

#### Tip Settings
```yaml
tips:
  enabled: true
  suggested_percentages: [18, 20, 22, 25]
  default_selection: 2  # 20%
  calculate_on: "subtotal"  # or "total"
  allow_cash_tips: true
  require_tip_declaration: true
```

#### Receipt Settings
```yaml
receipts:
  header_text: "Thank you for dining with us!"
  footer_text: "Visit us at www.restaurant.com"
  show_server_name: true
  show_table_number: true
  print_tip_line: true
  print_signature_line: true
  auto_print: true
  email_receipt_option: true
```

#### Security Settings
```yaml
security:
  pin_length: 4
  require_pin_for_void: true
  require_pin_for_discount: true
  require_pin_for_no_sale: true
  session_timeout_minutes: 15
  max_login_attempts: 5
  lockout_duration_minutes: 5
```

### Hardware Configuration

#### Terminals
- [ ] Register terminal configuration
- [ ] Printer assignments
- [ ] Payment device pairing
- [ ] Customer display assignment

#### Printers
- [ ] Printer discovery/setup
- [ ] Print station configuration
- [ ] Routing rules (kitchen, bar, receipt)
- [ ] Ticket format settings

#### Payment Devices
- [ ] Device pairing
- [ ] Connection settings
- [ ] Test transactions

### Integration Settings

#### Payment Processor
- [ ] Processor selection
- [ ] API credentials
- [ ] Merchant account settings
- [ ] Test mode toggle

#### Online Ordering
- [ ] Platform connections
- [ ] Menu sync settings
- [ ] Order routing

#### Delivery Services
- [ ] DoorDash, UberEats, etc.
- [ ] Menu sync
- [ ] Order handling

#### Accounting
- [ ] QuickBooks integration
- [ ] Xero integration
- [ ] Export formats

#### Loyalty Programs
- [ ] Program integration
- [ ] Point rules
- [ ] Redemption settings

### Data Management

#### Backup & Restore
- [ ] Automatic backups
- [ ] Manual backup
- [ ] Restore from backup
- [ ] Export all data

#### Data Retention
- [ ] Retention policies
- [ ] Data purging
- [ ] Archive settings

---

## UI/UX Specifications

### Settings Dashboard

```
+------------------------------------------------------------------+
| SETTINGS                                                         |
+------------------------------------------------------------------+
|                                                                  |
| QUICK ACCESS                                                     |
| +------------+ +------------+ +------------+ +------------+      |
| | Features   | | Locations  | | Payments   | | Hardware   |      |
| +------------+ +------------+ +------------+ +------------+      |
|                                                                  |
| +------------+ +------------+ +------------+ +------------+      |
| | Tax Setup  | | Receipts   | | Security   | | Integrations|     |
| +------------+ +------------+ +------------+ +------------+      |
|                                                                  |
+------------------------------------------------------------------+
| SYSTEM STATUS                                                    |
| ┌────────────────────────────────────────────────────────────┐  |
| │ Payment Processor: Connected ✓                              │  |
| │ Printers: 3 of 3 online ✓                                  │  |
| │ Last Backup: Today, 3:00 AM ✓                              │  |
| │ Software Version: 1.2.3                                     │  |
| └────────────────────────────────────────────────────────────┘  |
+------------------------------------------------------------------+
```

### Feature Flags

```
+------------------------------------------------------------------+
| FEATURES                                              [Save All] |
+------------------------------------------------------------------+
| Enable or disable features for your operation.                   |
|                                                                  |
| SERVICE MODES                                                    |
| +------------------------------------------------------+        |
| | ☑ Table Service           Full-service dining        |        |
| | ☑ Quick Service           Counter/fast casual        |        |
| | ☑ Bar Mode                Bar tabs and pre-auth      |        |
| | ☐ Kiosk Mode              Self-service ordering      |        |
| +------------------------------------------------------+        |
|                                                                  |
| ORDER FEATURES                                                   |
| +------------------------------------------------------+        |
| | ☑ Course Management       Appetizer, Main, Dessert   |        |
| | ☐ Seat Tracking           Track items by seat        |        |
| | ☑ Split Checks            Allow splitting bills      |        |
| | ☑ Discounts               Enable discount codes      |        |
| +------------------------------------------------------+        |
|                                                                  |
| ADVANCED                                                         |
| +------------------------------------------------------+        |
| | ☐ Kitchen Display         KDS integration            |        |
| | ☑ Customer Display        Customer-facing screen     |        |
| | ☐ Inventory Tracking      Ingredient-level tracking  |        |
| | ☐ API Access              External integrations      |        |
| +------------------------------------------------------+        |
+------------------------------------------------------------------+
```

### Tax Configuration

```
+------------------------------------------------------------------+
| TAX SETTINGS                                           [Save]    |
+------------------------------------------------------------------+
| TAX RATES                                         [+ Add Rate]   |
| +-------------------------------------------------------------+ |
| | Name           | Rate   | Type        | Default | Actions   | |
| +-------------------------------------------------------------+ |
| | State Sales    | 6.00%  | Percentage  | ☑       | [Edit] [×]| |
| | City Tax       | 1.50%  | Percentage  | ☑       | [Edit] [×]| |
| | Alcohol Tax    | 2.00%  | Percentage  | ☐       | [Edit] [×]| |
| +-------------------------------------------------------------+ |
|                                                                  |
| TAX SETTINGS                                                     |
| Tax Calculation: [After Discounts ▼]                            |
| Rounding: [Standard (half-up) ▼]                                |
| Show Tax Breakdown on Receipt: [Yes ▼]                          |
|                                                                  |
| TAX-EXEMPT                                                       |
| ☑ Allow tax-exempt transactions                                 |
| Require tax-exempt ID: [Yes ▼]                                  |
+------------------------------------------------------------------+
```

---

## Data Model

### Locations
```sql
locations {
  id: UUID PRIMARY KEY
  organization_id: UUID (FK)

  -- Identity
  name: VARCHAR(200)
  short_name: VARCHAR(50)
  code: VARCHAR(20) UNIQUE

  -- Contact
  address_line_1: VARCHAR(200)
  address_line_2: VARCHAR(200) (nullable)
  city: VARCHAR(100)
  state: VARCHAR(50)
  postal_code: VARCHAR(20)
  country: VARCHAR(50) DEFAULT 'US'
  phone: VARCHAR(20)
  email: VARCHAR(200)
  website: VARCHAR(200) (nullable)

  -- Settings
  timezone: VARCHAR(50)
  currency: VARCHAR(3) DEFAULT 'USD'
  locale: VARCHAR(10) DEFAULT 'en-US'
  business_day_end_time: TIME DEFAULT '04:00'

  -- Media
  logo_url: VARCHAR(500) (nullable)

  -- Status
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Feature Flags
```sql
feature_flags {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  feature_key: VARCHAR(100)
  is_enabled: BOOLEAN DEFAULT false
  configuration: JSONB (nullable) -- Feature-specific settings

  updated_by: UUID (FK)
  updated_at: TIMESTAMP

  UNIQUE (location_id, feature_key)
}
```

### System Settings
```sql
system_settings {
  id: UUID PRIMARY KEY
  location_id: UUID (FK, nullable) -- NULL = organization-wide

  category: VARCHAR(100)
  setting_key: VARCHAR(100)
  setting_value: JSONB
  value_type: VARCHAR(50) (string, number, boolean, array, object)

  updated_by: UUID (FK)
  updated_at: TIMESTAMP

  UNIQUE (location_id, category, setting_key)
}
```

### Tax Rates
```sql
tax_rates {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  rate: DECIMAL(6,4) -- Supports 0.0000 to 99.9999%
  tax_type: VARCHAR(50) (percentage, flat)

  applies_to: VARCHAR[] (food, alcohol, merchandise, all)
  is_default: BOOLEAN DEFAULT false
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Operating Hours
```sql
operating_hours {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  day_of_week: INTEGER (0-6, 0=Sunday)
  open_time: TIME
  close_time: TIME
  is_closed: BOOLEAN DEFAULT false

  UNIQUE (location_id, day_of_week)
}
```

### Holiday Hours
```sql
holiday_hours {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  date: DATE
  name: VARCHAR(100) (nullable)
  open_time: TIME (nullable)
  close_time: TIME (nullable)
  is_closed: BOOLEAN DEFAULT false

  UNIQUE (location_id, date)
}
```

### Terminals
```sql
terminals {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  terminal_type: VARCHAR(50) (register, kiosk, mobile, server)

  -- Hardware assignments
  receipt_printer_id: UUID (FK, nullable)
  payment_device_id: UUID (FK, nullable)
  customer_display_id: UUID (FK, nullable)

  -- Settings
  configuration: JSONB

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Printers
```sql
printers {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  printer_type: VARCHAR(50) (receipt, kitchen, label)
  connection_type: VARCHAR(50) (network, usb, bluetooth)
  connection_address: VARCHAR(200)

  -- Settings
  configuration: JSONB

  is_active: BOOLEAN DEFAULT true
  last_online: TIMESTAMP (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Print Routing
```sql
print_routing {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  printer_id: UUID (FK)

  route_type: VARCHAR(50) (category, item, revenue_center)
  route_value: VARCHAR(100) -- Category name, item ID, etc.

  created_at: TIMESTAMP
}
```

### Integrations
```sql
integrations {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  integration_type: VARCHAR(100) (payment, accounting, delivery, loyalty)
  provider: VARCHAR(100) (stripe, quickbooks, doordash, etc.)

  -- Credentials (encrypted)
  credentials: BYTEA

  -- Configuration
  configuration: JSONB

  is_active: BOOLEAN DEFAULT true
  last_sync: TIMESTAMP (nullable)
  sync_status: VARCHAR(50) (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Locations
```
GET    /api/locations
POST   /api/locations
GET    /api/locations/{id}
PUT    /api/locations/{id}
DELETE /api/locations/{id}
```

### Feature Flags
```
GET    /api/locations/{loc}/features
PUT    /api/locations/{loc}/features/{key}
PUT    /api/locations/{loc}/features  -- Bulk update
```

### Settings
```
GET    /api/locations/{loc}/settings
GET    /api/locations/{loc}/settings/{category}
PUT    /api/locations/{loc}/settings/{category}/{key}
PUT    /api/locations/{loc}/settings  -- Bulk update
```

### Tax Rates
```
GET    /api/locations/{loc}/tax-rates
POST   /api/locations/{loc}/tax-rates
PUT    /api/locations/{loc}/tax-rates/{id}
DELETE /api/locations/{loc}/tax-rates/{id}
```

### Hours
```
GET    /api/locations/{loc}/hours
PUT    /api/locations/{loc}/hours
GET    /api/locations/{loc}/holiday-hours
POST   /api/locations/{loc}/holiday-hours
```

### Hardware
```
GET    /api/locations/{loc}/terminals
POST   /api/locations/{loc}/terminals
PUT    /api/locations/{loc}/terminals/{id}
GET    /api/locations/{loc}/printers
POST   /api/locations/{loc}/printers
PUT    /api/locations/{loc}/printers/{id}
POST   /api/locations/{loc}/printers/{id}/test
```

### Integrations
```
GET    /api/locations/{loc}/integrations
POST   /api/locations/{loc}/integrations
PUT    /api/locations/{loc}/integrations/{id}
DELETE /api/locations/{loc}/integrations/{id}
POST   /api/locations/{loc}/integrations/{id}/test
```

### Backup/Export
```
POST   /api/locations/{loc}/backup
GET    /api/locations/{loc}/backups
POST   /api/locations/{loc}/restore
GET    /api/locations/{loc}/export
```

---

## Feature Flag Reference

```yaml
# Complete feature flag list with defaults

service_modes:
  table_service: true
  quick_service: true
  bar_mode: false
  kiosk_mode: false
  online_ordering: false
  delivery: false

order_features:
  course_management: false
  seat_tracking: false
  split_checks: true
  split_payments: true
  discounts: true
  comps: true

payment_features:
  cash: true
  credit_card: true
  gift_cards: false
  house_accounts: false
  tipping: true
  tip_pooling: false

employee_features:
  time_tracking: true
  scheduling: false
  multiple_jobs: true
  permissions: true

inventory_features:
  eighty_six: true
  stock_tracking: false
  full_inventory: false
  recipes: false

hardware_features:
  kitchen_display: false
  customer_display: false
  multiple_printers: true
  cash_drawer: true

advanced_features:
  multi_location: false
  api_access: false
  loyalty_program: false
  reservations: false
  analytics: true
```

---

## Business Rules

1. **Feature Dependencies:** Some features require others (e.g., tip_pooling requires tipping)
2. **Plan Limits:** Feature availability may depend on subscription plan
3. **Setting Inheritance:** Location settings inherit from organization defaults
4. **Tax Rules:** Tax configuration must comply with local regulations
5. **Hardware Validation:** Verify hardware connections before enabling features

---

## Permissions

| Action | Manager | Admin |
|--------|---------|-------|
| View settings | Yes | Yes |
| Edit basic settings | Yes | Yes |
| Enable/disable features | No | Yes |
| Manage integrations | No | Yes |
| Configure hardware | Yes | Yes |
| Access backup/restore | No | Yes |
| Manage locations | No | Yes |
| View audit of changes | Yes | Yes |

---

## Open Questions

1. **Plan/Pricing Tiers:** Will features be limited by subscription level?

2. **White Label:** Support for rebranding/white labeling?

3. **Multi-Tenant:** Single database or database per customer?

4. **Feature Rollout:** Gradual feature rollout to subset of locations?

5. **Config Export:** Allow customers to export/import configurations?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [x] Feature flag list defined
- [ ] Settings schema finalized
- [ ] UI mockups

### Development
- [ ] Location management
- [ ] Feature flag system
- [ ] Settings management
- [ ] Tax configuration
- [ ] Hardware management
- [ ] Integration framework
- [ ] Backup/restore
- [ ] Settings UI

---

*Last Updated: January 27, 2026*
