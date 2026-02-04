# 30 - Tender Types

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management

---

## Overview

The Tender Types skill manages all payment methods accepted by the restaurant - standard (cash, credit), custom tenders (house accounts, vouchers), and specialized payment handling. Includes configuration of which roles can use which tenders.

**Primary Goal:** Provide flexible payment acceptance with proper controls and tracking.

---

## User Stories

### As a Cashier...
- I want to easily select the right payment type
- I want to process split payments with multiple tenders
- I want custom tenders for special situations

### As a Manager...
- I want to create custom tender types
- I want to control who can use certain tenders
- I want accurate tender reporting

---

## Features

### Standard Tenders

#### Built-In Types
- [ ] Cash
- [ ] Credit Card
- [ ] Debit Card
- [ ] Gift Card
- [ ] House Account
- [ ] Check

### Custom Tenders

#### Creating Custom Tenders
- [ ] Name and description
- [ ] Tender category
- [ ] Requires reference number
- [ ] Opens cash drawer
- [ ] Requires manager approval

#### Custom Tender Examples
```yaml
custom_tenders:
  - name: "Voucher"
    category: "Voucher"
    requires_reference: true
    opens_drawer: false
    requires_approval: false

  - name: "Employee Comp"
    category: "Comp"
    requires_reference: false
    opens_drawer: false
    requires_approval: true

  - name: "Corporate Account"
    category: "House Account"
    requires_reference: true
    opens_drawer: false
    requires_approval: false

  - name: "Promotional Credit"
    category: "Credit"
    requires_reference: true
    opens_drawer: false
    requires_approval: true
```

### Tender Rules

#### Role Restrictions
- [ ] Tenders allowed by role
- [ ] Dollar limits by role
- [ ] Approval requirements

#### Tender Limits
```yaml
role_tender_rules:
  server:
    allowed:
      - cash
      - credit_card
      - gift_card
    denied:
      - employee_comp
      - void_tender
    limits:
      cash_refund: 25.00

  manager:
    allowed: all
    limits: none
```

### Processing Rules

#### Per-Tender Settings
- [ ] Opens cash drawer (yes/no)
- [ ] Requires signature above amount
- [ ] Requires ID verification
- [ ] Prints receipt automatically
- [ ] Tips allowed

#### Reference Requirements
- [ ] No reference needed
- [ ] Optional reference
- [ ] Required reference (e.g., voucher #)
- [ ] Validated reference (lookup)

### Tender Categories

#### Standard Categories
- [ ] Cash
- [ ] Card
- [ ] Gift Card
- [ ] House Account
- [ ] Voucher
- [ ] Comp
- [ ] Other

### Reporting

#### Tender Reports
- [ ] Sales by tender type
- [ ] Custom tender usage
- [ ] Tender by employee
- [ ] Approval tracking

---

## UI/UX Specifications

### Payment Screen with Tenders

```
+------------------------------------------------------------------+
| PAYMENT - Check #1234                            Total: $87.50   |
+------------------------------------------------------------------+
|                                                                  |
| SELECT TENDER:                                                   |
|                                                                  |
| STANDARD                                                         |
| +--------+ +--------+ +--------+ +--------+                     |
| | Cash   | | Credit | | Debit  | | Gift   |                     |
| |        | | Card   | | Card   | | Card   |                     |
| +--------+ +--------+ +--------+ +--------+                     |
|                                                                  |
| HOUSE ACCOUNTS                                                   |
| +--------+ +--------+                                           |
| |Corp Acct| |Employee|                                          |
| |        | | Meal   |                                           |
| +--------+ +--------+                                           |
|                                                                  |
| OTHER                                                            |
| +--------+ +--------+ +--------+                                |
| |Voucher | | Promo  | | Check  |                                |
| |        | | Credit | |        |                                |
| +--------+ +--------+ +--------+                                |
|                                                                  |
| [Split Payment]                    [Exact Cash: $87.50]         |
+------------------------------------------------------------------+
```

### Tender Configuration

```
+------------------------------------------------------------------+
| TENDER TYPES                                    [+ New Tender]   |
+------------------------------------------------------------------+
|                                                                  |
| STANDARD TENDERS                                                 |
| +--------------------------------------------------------------+|
| | Cash                    | Opens Drawer: Yes | Active ✓      ||
| | Credit Card             | Tips: Yes         | Active ✓      ||
| | Debit Card              | Tips: Yes         | Active ✓      ||
| | Gift Card               | Opens Drawer: No  | Active ✓      ||
| +--------------------------------------------------------------+|
|                                                                  |
| CUSTOM TENDERS                                                   |
| +--------------------------------------------------------------+|
| | Voucher                 | Ref Required: Yes | [Edit] [Del]  ||
| | Corporate Account       | Approval: No      | [Edit] [Del]  ||
| | Employee Comp           | Approval: Yes     | [Edit] [Del]  ||
| | Promotional Credit      | Ref Required: Yes | [Edit] [Del]  ||
| +--------------------------------------------------------------+|
|                                                                  |
+------------------------------------------------------------------+
```

---

## Data Model

### Tender Types
```sql
tender_types {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  code: VARCHAR(20) UNIQUE
  category: VARCHAR(50)
  description: TEXT (nullable)

  -- Behavior
  is_system: BOOLEAN DEFAULT false -- Built-in tenders
  opens_drawer: BOOLEAN DEFAULT false
  tips_allowed: BOOLEAN DEFAULT true
  requires_reference: BOOLEAN DEFAULT false
  reference_label: VARCHAR(50) (nullable)
  validate_reference: BOOLEAN DEFAULT false

  -- Approval
  requires_approval: BOOLEAN DEFAULT false
  requires_approval_above: DECIMAL(10,2) (nullable)

  -- Receipt
  auto_print_receipt: BOOLEAN DEFAULT true
  signature_required_above: DECIMAL(10,2) (nullable)

  -- Display
  display_order: INTEGER
  icon: VARCHAR(50) (nullable)
  color: VARCHAR(7) (nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Role Tender Permissions
```sql
role_tender_permissions {
  id: UUID PRIMARY KEY
  role_id: UUID (FK)
  tender_type_id: UUID (FK)

  allowed: BOOLEAN DEFAULT true
  max_amount: DECIMAL(10,2) (nullable)
  requires_approval_override: BOOLEAN (nullable)

  created_at: TIMESTAMP

  UNIQUE (role_id, tender_type_id)
}
```

### Payment Tenders
```sql
-- Add to payments table or separate:
payment_tenders {
  id: UUID PRIMARY KEY
  payment_id: UUID (FK)
  tender_type_id: UUID (FK)

  amount: DECIMAL(10,2)
  reference: VARCHAR(100) (nullable)

  -- For cards
  card_last_four: VARCHAR(4) (nullable)
  card_type: VARCHAR(50) (nullable)
  authorization_code: VARCHAR(50) (nullable)

  -- Approval
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

```
GET    /api/tender-types
POST   /api/tender-types
PUT    /api/tender-types/{id}
DELETE /api/tender-types/{id}
GET    /api/tender-types/available  -- Based on user role

GET    /api/roles/{id}/tender-permissions
PUT    /api/roles/{id}/tender-permissions

GET    /api/reports/tenders
```

---

## Business Rules

1. **System Tenders:** Cannot delete built-in tenders
2. **Role Enforcement:** Check permissions before allowing tender
3. **Reference Validation:** Validate if configured
4. **Approval Workflow:** Route to manager if required
5. **Audit Trail:** Log all tender transactions

---

## Configuration Options

```yaml
tender_types:
  defaults:
    tips_on_cash: true
    tips_on_card: true
    signature_threshold: 25.00

  cash:
    drawer_required: true
    allow_over_tender: true

  cards:
    preauth_enabled: true
    offline_enabled: false

  custom:
    require_approval_by_default: false
    max_custom_tenders: 20
```

---

*Last Updated: January 27, 2026*
