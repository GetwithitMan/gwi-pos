# 18 - Discounts

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 05-Employees-Roles

---

## Overview

The Discounts skill manages all types of price reductions - percentage discounts, dollar amounts, BOGO deals, preset discounts, and promotional codes. Includes comprehensive permission controls and tracking.

**Primary Goal:** Provide flexible discounting with proper controls to prevent abuse while enabling legitimate promotions.

---

## User Stories

### As a Server...
- I want to apply a discount quickly when authorized
- I want preset discounts for common scenarios (military, senior)
- I want to enter promo codes customers give me

### As a Manager...
- I want to control who can give what discounts
- I want to see all discounts applied and by whom
- I want to set up BOGO and promotional deals
- I want real-time alerts for excessive discounting

### As an Owner...
- I want to track discount costs
- I want to prevent discount abuse
- I want to see discount effectiveness

---

## Features

### Discount Types

#### Percentage Discount
- [ ] Percentage off entire check
- [ ] Percentage off specific items
- [ ] Percentage off category

#### Dollar Amount Discount
- [ ] Fixed dollar amount off check
- [ ] Fixed dollar amount off item

#### BOGO (Buy One Get One)
- [ ] Buy X Get Y Free
- [ ] Buy X Get Y Discounted (50%, etc.)
- [ ] Buy X Get Next at $ Price
- [ ] Mix and match options

#### Item-Level Discounts
- [ ] Discount specific items
- [ ] Replace price (override)
- [ ] Quantity discounts

#### Promo Codes
- [ ] Code entry at checkout
- [ ] Single-use codes
- [ ] Multi-use codes
- [ ] Expiring codes

### Preset Discounts

#### Common Presets
```yaml
presets:
  - name: "Military"
    type: "percent"
    value: 10
    requires_verification: true
    requires_reason: false

  - name: "Senior"
    type: "percent"
    value: 10
    requires_verification: false
    requires_reason: false

  - name: "Employee Meal"
    type: "percent"
    value: 50
    requires_approval: false
    limit_per_shift: 1

  - name: "Manager Comp"
    type: "percent"
    value: 100
    requires_approval: true
    requires_reason: true

  - name: "Service Recovery"
    type: "amount"
    max_value: 25.00
    requires_reason: true
```

#### Preset Configuration
- [ ] Name and description
- [ ] Discount type and value
- [ ] Verification requirements
- [ ] Reason requirements
- [ ] Approval requirements
- [ ] Usage limits

### Permission Controls

#### Role-Based Limits
```yaml
permissions:
  server:
    can_discount: true
    max_percent: 10
    max_amount: 15.00
    presets_allowed: ["military", "senior"]
    requires_approval_above_percent: 10
    requires_approval_above_amount: 15.00

  shift_lead:
    can_discount: true
    max_percent: 25
    max_amount: 50.00
    presets_allowed: ["all"]
    can_approve: true

  manager:
    can_discount: true
    max_percent: 100
    max_amount: unlimited
    presets_allowed: ["all"]
    can_approve: true
    can_comp: true
```

#### Approval Workflow
- [ ] Request approval from manager
- [ ] Manager notification
- [ ] Approve/deny with reason
- [ ] Audit trail

### BOGO Configuration

#### BOGO Rules
```yaml
bogo_deals:
  - name: "Wing Wednesday"
    trigger:
      item_category: "wings"
      quantity: 1
    reward:
      item_category: "wings"
      discount_percent: 100  # Free
      max_quantity: 1
    schedule:
      days: [wednesday]
    auto_apply: true

  - name: "Happy Hour 2-for-1 Wells"
    trigger:
      item_tag: "well_drink"
      quantity: 2
    reward:
      apply_to: "lowest_priced"
      discount_percent: 100
    schedule:
      promotion_id: "happy_hour"
    auto_apply: true

  - name: "Kids Eat Free"
    trigger:
      item_category: "adult_entree"
      quantity: 1
    reward:
      item_category: "kids_menu"
      discount_percent: 100
      max_value: 8.00
    schedule:
      days: [tuesday]
    requires_manual: true
```

### Promo Codes

#### Code Types
- [ ] **Single-Use:** One redemption total
- [ ] **Multi-Use:** Unlimited redemptions
- [ ] **Limited:** X total redemptions
- [ ] **Per-Customer:** One per customer

#### Code Configuration
- [ ] Code string (auto-generate or custom)
- [ ] Discount type and value
- [ ] Start/end dates
- [ ] Minimum purchase
- [ ] Item restrictions
- [ ] Usage tracking

### Discount Stacking

#### Stacking Rules
- [ ] Allow multiple discounts
- [ ] Only one discount per order
- [ ] Best discount wins
- [ ] Specific combinations allowed

#### Priority Rules
```yaml
stacking:
  mode: "best_discount"  # or "stack", "first_applied"
  allow_promo_with_preset: false
  allow_manual_with_auto: true
```

### Tracking & Reporting

#### Discount Tracking
- [ ] Every discount logged
- [ ] Employee attribution
- [ ] Reason captured
- [ ] Approval status
- [ ] Original vs discounted amount

#### Alerts
- [ ] Excessive discounting alert
- [ ] Unusual patterns
- [ ] Threshold notifications

---

## UI/UX Specifications

### Apply Discount Modal

```
+------------------------------------------------------------------+
| APPLY DISCOUNT - Check #1234                          [Cancel]   |
+------------------------------------------------------------------+
| Check Total: $87.50                                              |
|                                                                  |
| PRESET DISCOUNTS                                                 |
| +--------+ +--------+ +--------+ +--------+                     |
| |Military| |Senior  | |Employee| |Service |                     |
| |  10%   | |  10%   | |  50%   | |Recovery|                     |
| +--------+ +--------+ +--------+ +--------+                     |
|                                                                  |
| CUSTOM DISCOUNT                                                  |
| Type: (•) Percent  ( ) Amount                                    |
| Value: [____]%     (Your max: 10%)                              |
|                                                                  |
| Apply to: (•) Entire Check  ( ) Selected Items                  |
|                                                                  |
| Reason: [Service issue - long wait_________________]             |
|         (Required for discounts over 10%)                        |
|                                                                  |
| Preview: $87.50 - $8.75 (10%) = $78.75                          |
|                                                                  |
| [Cancel]                                    [Apply Discount]     |
+------------------------------------------------------------------+
```

### Approval Request

```
+------------------------------------------------------------------+
| APPROVAL NEEDED                                                  |
+------------------------------------------------------------------+
|                                                                  |
| Server Sarah M. is requesting approval for:                      |
|                                                                  |
| Check #1234 - Table 12                                          |
| Discount: 20% ($17.50)                                          |
| Reason: "Customer found hair in food"                           |
|                                                                  |
| [Deny]                                    [Approve]              |
+------------------------------------------------------------------+
```

### Promo Code Entry

```
+------------------------------------------------------------------+
| PROMO CODE                                            [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| Enter promo code: [SAVE20____________]         [Apply]           |
|                                                                  |
| ✓ Code valid: "20% Off Your Order"                              |
|   Expires: Jan 31, 2026                                         |
|   Discount: 20% off ($17.50)                                    |
|                                                                  |
| [Cancel]                                    [Apply Code]         |
+------------------------------------------------------------------+
```

### Discount Report

```
+------------------------------------------------------------------+
| DISCOUNT REPORT                                  Jan 27, 2026    |
+------------------------------------------------------------------+
| Period: [Today ▼]                                    [Export]    |
+------------------------------------------------------------------+
| SUMMARY                                                          |
| Total Discounts: $456.78                                        |
| Gross Sales: $5,234.00                                          |
| Discount %: 8.7%                                                 |
| Transactions with Discount: 34                                   |
+------------------------------------------------------------------+
| BY TYPE                                                          |
| Preset - Military:     $123.45 (15 uses)                        |
| Preset - Senior:        $89.00 (12 uses)                        |
| Preset - Employee:      $67.50 (3 uses)                         |
| Manual - Percent:       $98.33 (8 uses)                         |
| Promo Codes:            $78.50 (6 uses)                         |
+------------------------------------------------------------------+
| BY EMPLOYEE                                                      |
| Sarah M.:  $134.50 (12 discounts)   Avg: $11.21                 |
| Mike J.:    $98.00 (8 discounts)    Avg: $12.25                 |
| Lisa G.:    $67.28 (7 discounts)    Avg: $9.61                  |
+------------------------------------------------------------------+
| ⚠️ ALERTS                                                        |
| Mike J. - 3 discounts over 15% today                            |
+------------------------------------------------------------------+
```

---

## Data Model

### Discount Definitions (Presets)
```sql
discount_definitions {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)
  code: VARCHAR(20) UNIQUE (nullable) -- For presets

  -- Type
  discount_type: VARCHAR(50) (percent, amount, bogo, price_override)
  discount_value: DECIMAL(10,2) (nullable)
  max_value: DECIMAL(10,2) (nullable) -- Cap for percent discounts

  -- Scope
  applies_to: VARCHAR(50) (check, item, category)
  category_id: UUID (FK, nullable)
  item_ids: UUID[] (nullable)

  -- Requirements
  requires_reason: BOOLEAN DEFAULT false
  requires_approval: BOOLEAN DEFAULT false
  requires_verification: BOOLEAN DEFAULT false

  -- Limits
  min_check_amount: DECIMAL(10,2) (nullable)
  max_uses_per_check: INTEGER (nullable)
  max_uses_per_day_employee: INTEGER (nullable)

  -- Availability
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Promo Codes
```sql
promo_codes {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  code: VARCHAR(50) UNIQUE
  name: VARCHAR(100)
  description: TEXT (nullable)

  -- Discount
  discount_type: VARCHAR(50)
  discount_value: DECIMAL(10,2)
  max_discount: DECIMAL(10,2) (nullable)

  -- Validity
  start_date: TIMESTAMP (nullable)
  end_date: TIMESTAMP (nullable)
  is_active: BOOLEAN DEFAULT true

  -- Usage
  usage_type: VARCHAR(50) (single, multi, limited, per_customer)
  max_uses: INTEGER (nullable)
  current_uses: INTEGER DEFAULT 0

  -- Requirements
  min_purchase: DECIMAL(10,2) (nullable)
  excluded_items: UUID[] (nullable)
  excluded_categories: UUID[] (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### BOGO Rules
```sql
bogo_rules {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)

  -- Trigger
  trigger_category_id: UUID (FK, nullable)
  trigger_item_ids: UUID[] (nullable)
  trigger_quantity: INTEGER

  -- Reward
  reward_category_id: UUID (FK, nullable)
  reward_item_ids: UUID[] (nullable)
  reward_quantity: INTEGER DEFAULT 1
  reward_discount_percent: DECIMAL(5,2) -- 100 = free
  reward_max_value: DECIMAL(10,2) (nullable)
  reward_apply_to: VARCHAR(50) (any, lowest, highest)

  -- Schedule
  promotion_id: UUID (FK, nullable)
  days_of_week: INTEGER[] (nullable)

  -- Behavior
  auto_apply: BOOLEAN DEFAULT false
  stackable: BOOLEAN DEFAULT false

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Applied Discounts
```sql
order_discounts {
  id: UUID PRIMARY KEY
  order_id: UUID (FK)
  order_item_id: UUID (FK, nullable) -- NULL = check-level

  -- What
  discount_definition_id: UUID (FK, nullable)
  promo_code_id: UUID (FK, nullable)
  bogo_rule_id: UUID (FK, nullable)

  discount_type: VARCHAR(50)
  discount_name: VARCHAR(100)

  -- Amount
  discount_percent: DECIMAL(5,2) (nullable)
  discount_amount: DECIMAL(10,2)

  -- Context
  reason: TEXT (nullable)
  verification_note: VARCHAR(200) (nullable)

  -- Approval
  requires_approval: BOOLEAN DEFAULT false
  approval_status: VARCHAR(50) (nullable) -- pending, approved, denied
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)
  denial_reason: VARCHAR(200) (nullable)

  -- Who
  applied_by: UUID (FK)
  applied_at: TIMESTAMP

  created_at: TIMESTAMP
}
```

### Role Discount Permissions
```sql
role_discount_permissions {
  id: UUID PRIMARY KEY
  role_id: UUID (FK)

  can_apply_discounts: BOOLEAN DEFAULT false
  max_percent: DECIMAL(5,2) (nullable)
  max_amount: DECIMAL(10,2) (nullable)
  allowed_presets: UUID[] (nullable) -- NULL = all
  can_use_promo_codes: BOOLEAN DEFAULT true
  can_approve_discounts: BOOLEAN DEFAULT false
  requires_approval_above_percent: DECIMAL(5,2) (nullable)
  requires_approval_above_amount: DECIMAL(10,2) (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Discount Definitions
```
GET    /api/discounts/definitions
POST   /api/discounts/definitions
PUT    /api/discounts/definitions/{id}
DELETE /api/discounts/definitions/{id}
```

### Promo Codes
```
GET    /api/discounts/promo-codes
POST   /api/discounts/promo-codes
PUT    /api/discounts/promo-codes/{id}
DELETE /api/discounts/promo-codes/{id}
GET    /api/discounts/promo-codes/validate?code={code}
```

### BOGO Rules
```
GET    /api/discounts/bogo
POST   /api/discounts/bogo
PUT    /api/discounts/bogo/{id}
DELETE /api/discounts/bogo/{id}
```

### Apply Discounts
```
POST   /api/orders/{id}/discounts
DELETE /api/orders/{id}/discounts/{discount_id}
POST   /api/orders/{id}/promo-code
GET    /api/orders/{id}/available-discounts
```

### Approval
```
GET    /api/discounts/pending-approvals
POST   /api/discounts/{id}/approve
POST   /api/discounts/{id}/deny
```

### Reporting
```
GET    /api/reports/discounts/summary
GET    /api/reports/discounts/by-employee
GET    /api/reports/discounts/by-type
GET    /api/reports/discounts/alerts
```

---

## Business Rules

1. **Permission Check:** Always verify employee can apply requested discount
2. **Approval Flow:** Discounts above threshold queue for manager approval
3. **Reason Required:** Configurable requirement for discount reasons
4. **One Promo Code:** Only one promo code per order (configurable)
5. **Auto-BOGO:** Automatic BOGO applies when conditions met
6. **Void Tracking:** Discounts on voided items still tracked

---

## Permissions

| Action | Server | Shift Lead | Manager | Admin |
|--------|--------|------------|---------|-------|
| Apply preset | Allowed | All | All | All |
| Apply custom (up to 10%) | Yes | Yes | Yes | Yes |
| Apply custom (10-25%) | No | Yes | Yes | Yes |
| Apply custom (25%+) | No | No | Yes | Yes |
| Comp (100%) | No | No | Yes | Yes |
| Use promo codes | Yes | Yes | Yes | Yes |
| Approve discounts | No | Yes | Yes | Yes |
| Configure discounts | No | No | Yes | Yes |
| View all discount reports | No | No | Yes | Yes |

---

## Configuration Options

```yaml
discounts:
  general:
    allow_multiple: false
    best_discount_mode: true
    require_reason_above_percent: 15

  promo_codes:
    enabled: true
    case_sensitive: false
    allow_with_other_discounts: false

  bogo:
    enabled: true
    auto_apply: true

  alerts:
    daily_discount_threshold_percent: 15
    alert_on_excessive: true
```

---

## Open Questions

1. **Discount Stacking:** Allow multiple discounts to stack?

2. **Retroactive Discounts:** Apply discount after items sent to kitchen?

3. **Employee Discounts:** Separate employee meal program or use discounts?

4. **Loyalty Integration:** How do discounts interact with loyalty points?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Permission matrix finalized
- [ ] BOGO logic detailed

### Development
- [ ] Discount definitions
- [ ] Promo codes
- [ ] BOGO rules
- [ ] Permission controls
- [ ] Approval workflow
- [ ] Reporting
- [ ] Alerts

---

*Last Updated: January 27, 2026*
