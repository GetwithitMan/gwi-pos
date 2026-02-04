# 46 - Paid In / Paid Out

**Status:** Planning
**Priority:** High
**Dependencies:** 37-Drawer-Management, 05-Employees-Roles

---

## Overview

The Paid In / Paid Out skill provides detailed tracking for cash entering and leaving the register outside of normal sales - vendor payments, employee advances, tips paid out, petty cash, and more. Includes approval workflows, receipt tracking, and comprehensive reporting.

**Primary Goal:** Track every dollar that moves in or out of the drawer with proper documentation and approval controls.

---

## User Stories

### As a Manager...
- I want to record vendor payments
- I want to track petty cash usage
- I want to pay out employee tips
- I want approval controls on large amounts

### As a Cashier...
- I want to quickly record payouts
- I want to request approval when needed
- I want my drawer to balance

### As an Owner...
- I want visibility into all cash movements
- I want documentation for accounting
- I want to prevent cash shrinkage
- I want audit-ready records

---

## Features

### Paid Out (Cash Going Out)

#### Paid Out Categories
- [ ] Vendor/COD payment
- [ ] Employee tip cash-out
- [ ] Employee advance
- [ ] Petty cash
- [ ] Customer refund
- [ ] Delivery driver
- [ ] Supplies purchase
- [ ] Custom category

#### Paid Out Process
- [ ] Select category
- [ ] Enter amount
- [ ] Enter recipient
- [ ] Add description/reason
- [ ] Attach receipt (optional)
- [ ] Get approval (if required)
- [ ] Print voucher

### Paid In (Cash Coming In)

#### Paid In Categories
- [ ] Starting bank/loan from safe
- [ ] Found cash
- [ ] Returned change
- [ ] Vendor refund
- [ ] Personal loan repayment
- [ ] Overage correction
- [ ] Custom category

#### Paid In Process
- [ ] Select category
- [ ] Enter amount
- [ ] Enter source
- [ ] Add description
- [ ] Print receipt

### Approval Workflows

#### Approval Rules
```yaml
approval_rules:
  paid_out:
    - category: "vendor_payment"
      require_approval_above: 100.00
      require_receipt: true

    - category: "employee_advance"
      always_require_approval: true
      max_amount: 200.00

    - category: "petty_cash"
      require_approval_above: 50.00
      daily_limit: 200.00

    - category: "tip_cashout"
      require_approval_above: 100.00
```

### Documentation

#### Receipt/Invoice Tracking
- [ ] Photo capture of receipt
- [ ] Invoice number entry
- [ ] Vendor information
- [ ] Reference number
- [ ] Searchable archive

#### Voucher Printing
- [ ] Print paid out slip
- [ ] Signature line
- [ ] Reference number
- [ ] Duplicate copies

### Reporting

#### Paid In/Out Reports
- [ ] Daily summary
- [ ] By category
- [ ] By employee
- [ ] By vendor
- [ ] Trend analysis

---

## UI/UX Specifications

### Paid Out Screen

```
+------------------------------------------------------------------+
| PAID OUT                                                          |
+------------------------------------------------------------------+
|                                                                   |
| SELECT CATEGORY                                                   |
| +------------------+ +------------------+ +------------------+    |
| | 💵 Vendor       | | 💰 Employee     | | 🧾 Petty Cash   |    |
| |    Payment      | |    Tip Payout   | |                  |    |
| +------------------+ +------------------+ +------------------+    |
| +------------------+ +------------------+ +------------------+    |
| | 👤 Employee     | | 🚗 Delivery     | | 📦 Supplies     |    |
| |    Advance      | |    Driver       | |    Purchase     |    |
| +------------------+ +------------------+ +------------------+    |
| +------------------+ +------------------+                         |
| | 🔄 Customer     | | ➕ Other        |                         |
| |    Refund       | |                  |                         |
| +------------------+ +------------------+                         |
|                                                                   |
+------------------------------------------------------------------+
```

### Paid Out Entry

```
+------------------------------------------------------------------+
| PAID OUT - Vendor Payment                                         |
+------------------------------------------------------------------+
|                                                                   |
| AMOUNT                                                            |
| $ [_______75.00___]                                              |
|                                                                   |
| RECIPIENT/VENDOR                                                  |
| [Sysco - Delivery Driver__________________________________]      |
|                                                                   |
| DESCRIPTION                                                       |
| [COD payment for emergency produce order_________________]       |
|                                                                   |
| REFERENCE                                                         |
| Invoice #: [INV-2026-4567___]                                    |
|                                                                   |
| DOCUMENTATION                                                     |
| [📷 Capture Receipt Photo]   or   [📎 Attach File]              |
|                                                                   |
| Receipt Image: ✓ Attached                                        |
|                                                                   |
| ⚠️ Amounts over $100 require manager approval                    |
|                                                                   |
| Drawer Balance: $542.00 → $467.00 after payout                   |
|                                                                   |
| [Cancel]                              [Submit for Approval]       |
+------------------------------------------------------------------+
```

### Approval Request (Manager)

```
+------------------------------------------------------------------+
| 🔔 PAID OUT APPROVAL REQUIRED                                     |
+------------------------------------------------------------------+
|                                                                   |
| Requested by: Sarah M. (Cashier)                                 |
| Drawer: #1 - Front Register                                      |
| Time: 2:45 PM                                                    |
|                                                                   |
| DETAILS                                                           |
| Category: Vendor Payment                                         |
| Amount: $75.00                                                   |
| Recipient: Sysco - Delivery Driver                               |
| Description: COD payment for emergency produce order             |
| Invoice #: INV-2026-4567                                         |
|                                                                   |
| RECEIPT                                                           |
| +------------------------------------------+                     |
| |  [Receipt Image Preview]                  |                     |
| |  Sysco Foods                              |                     |
| |  INV-2026-4567                            |                     |
| |  Amount: $75.00                           |                     |
| +------------------------------------------+                     |
|                                                                   |
| [Deny]                              [Approve Payout]             |
+------------------------------------------------------------------+
```

### Paid In Screen

```
+------------------------------------------------------------------+
| PAID IN                                                           |
+------------------------------------------------------------------+
|                                                                   |
| SELECT CATEGORY                                                   |
| +------------------+ +------------------+ +------------------+    |
| | 🏦 Bank/Loan    | | 💵 Found Cash   | | 🔄 Returned     |    |
| |    from Safe    | |                  | |    Change       |    |
| +------------------+ +------------------+ +------------------+    |
| +------------------+ +------------------+ +------------------+    |
| | 📦 Vendor       | | ✓ Overage       | | ➕ Other        |    |
| |    Refund       | |    Correction   | |                  |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| AMOUNT                                                            |
| $ [_______50.00___]                                              |
|                                                                   |
| SOURCE                                                            |
| [Office safe - additional bank for busy night____________]       |
|                                                                   |
| Drawer Balance: $200.00 → $250.00 after deposit                  |
|                                                                   |
| [Cancel]                                      [Complete Paid In]  |
+------------------------------------------------------------------+
```

### Paid In/Out Report

```
+------------------------------------------------------------------+
| PAID IN / PAID OUT REPORT                       Jan 27, 2026     |
+------------------------------------------------------------------+
|                                                                   |
| SUMMARY                                                           |
| +------------------+ +------------------+ +------------------+    |
| | Total Paid Out   | | Total Paid In    | | Net             |    |
| | $345.00          | | $200.00          | | -$145.00        |    |
| | (8 transactions) | | (2 transactions) | |                 |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| PAID OUT BY CATEGORY                                              |
| +--------------------------------------------------------------+ |
| | Category           | Count | Total    | Avg      | Receipt  | |
| +--------------------------------------------------------------+ |
| | Vendor Payment     | 3     | $175.00  | $58.33   | 3/3 ✓   | |
| | Employee Tip Payout| 4     | $120.00  | $30.00   | N/A      | |
| | Petty Cash         | 1     | $50.00   | $50.00   | 1/1 ✓   | |
| +--------------------------------------------------------------+ |
|                                                                   |
| DETAIL                                                            |
| +--------------------------------------------------------------+ |
| | Time   | Type    | Category       | Amount | Recipient       | |
| +--------------------------------------------------------------+ |
| | 10:15  | OUT     | Vendor Payment | $75.00 | Sysco           | |
| | 11:30  | IN      | Bank from Safe | $200.00| Opening bank    | |
| | 2:45   | OUT     | Tip Payout     | $45.00 | Sarah M.        | |
| | 3:00   | OUT     | Petty Cash     | $50.00 | Office supplies | |
| | 4:30   | OUT     | Tip Payout     | $35.00 | Mike T.         | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Export CSV]  [Print Report]  [View Receipts]                    |
+------------------------------------------------------------------+
```

---

## Data Model

### Paid In/Out Transactions
```sql
paid_in_out {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  drawer_session_id: UUID (FK, nullable)

  -- Type
  transaction_type: VARCHAR(50) (paid_in, paid_out)
  category: VARCHAR(100)

  -- Amount
  amount: DECIMAL(10,2)

  -- Details
  recipient: VARCHAR(200) (nullable)
  source: VARCHAR(200) (nullable)
  description: TEXT

  -- Reference
  reference_number: VARCHAR(100) (nullable)
  invoice_number: VARCHAR(100) (nullable)

  -- Documentation
  receipt_image_url: VARCHAR(500) (nullable)
  has_receipt: BOOLEAN DEFAULT false

  -- Approval
  requires_approval: BOOLEAN DEFAULT false
  status: VARCHAR(50) (pending, approved, denied, completed)
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)
  denial_reason: TEXT (nullable)

  -- Voucher
  voucher_number: VARCHAR(50)
  voucher_printed: BOOLEAN DEFAULT false

  -- Audit
  created_by: UUID (FK)
  created_at: TIMESTAMP
}
```

### Paid In/Out Categories
```sql
paid_in_out_categories {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  category_type: VARCHAR(50) (paid_in, paid_out)
  name: VARCHAR(100)
  description: TEXT (nullable)
  icon: VARCHAR(50) (nullable)

  -- Rules
  require_approval: BOOLEAN DEFAULT false
  approval_threshold: DECIMAL(10,2) (nullable)
  require_receipt: BOOLEAN DEFAULT false
  require_reference: BOOLEAN DEFAULT false
  daily_limit: DECIMAL(10,2) (nullable)
  per_transaction_limit: DECIMAL(10,2) (nullable)

  -- Permissions
  allowed_roles: UUID[] (nullable) -- Null = all

  is_system: BOOLEAN DEFAULT false
  is_active: BOOLEAN DEFAULT true
  display_order: INTEGER

  created_at: TIMESTAMP
}
```

### Paid In/Out Settings
```sql
paid_in_out_settings {
  location_id: UUID PRIMARY KEY (FK)

  -- Global rules
  require_approval_above: DECIMAL(10,2) DEFAULT 100.00
  require_receipt_above: DECIMAL(10,2) DEFAULT 25.00
  daily_paid_out_limit: DECIMAL(10,2) (nullable)

  -- Vouchers
  auto_print_voucher: BOOLEAN DEFAULT true
  voucher_copies: INTEGER DEFAULT 2

  -- Notifications
  notify_managers: BOOLEAN DEFAULT true

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Transactions
```
GET    /api/paid-in-out
POST   /api/paid-in-out
GET    /api/paid-in-out/{id}
PUT    /api/paid-in-out/{id}
DELETE /api/paid-in-out/{id}
```

### Approval
```
GET    /api/paid-in-out/pending
POST   /api/paid-in-out/{id}/approve
POST   /api/paid-in-out/{id}/deny
```

### Categories
```
GET    /api/paid-in-out/categories
POST   /api/paid-in-out/categories
PUT    /api/paid-in-out/categories/{id}
DELETE /api/paid-in-out/categories/{id}
```

### Reports
```
GET    /api/paid-in-out/report
GET    /api/paid-in-out/summary
GET    /api/paid-in-out/by-category
GET    /api/paid-in-out/by-employee
```

### Receipts
```
POST   /api/paid-in-out/{id}/receipt
GET    /api/paid-in-out/{id}/receipt
DELETE /api/paid-in-out/{id}/receipt
```

---

## Business Rules

1. **Drawer Impact:** All paid in/out affects drawer balance
2. **Approval Chain:** Amounts above threshold require manager approval
3. **Receipt Required:** Vendor payments require receipt documentation
4. **Voucher Audit:** All payouts generate numbered voucher
5. **Daily Limits:** Enforce category daily limits
6. **Employee Tips:** Tip payouts deduct from declared tips

---

## Permissions

| Action | Cashier | Manager | Admin |
|--------|---------|---------|-------|
| Create paid in/out | Yes | Yes | Yes |
| Limited categories only | Yes | No | No |
| Approve transactions | No | Yes | Yes |
| Deny transactions | No | Yes | Yes |
| Edit transactions | No | Yes | Yes |
| Delete transactions | No | No | Yes |
| Create categories | No | No | Yes |
| View reports | No | Yes | Yes |
| Configure settings | No | No | Yes |

---

## Configuration Options

```yaml
paid_in_out:
  approval:
    require_above: 100.00
    notify_managers: true
    auto_deny_after_hours: 24

  documentation:
    require_receipt_above: 25.00
    capture_photo: true
    store_days: 365

  vouchers:
    auto_print: true
    copies: 2
    include_signature_line: true

  limits:
    daily_paid_out: 500.00
    per_transaction: 200.00

  categories:
    allow_custom: true
    require_category: true

  tip_payout:
    from_declared_tips: true
    require_clock_out: false
```

---

## Voucher Template

```
+------------------------------------------+
|            PAID OUT VOUCHER              |
|           [Location Name]                |
|                                          |
| Voucher #: PO-2026-001234               |
| Date: January 27, 2026  Time: 2:45 PM   |
|                                          |
| Category: Vendor Payment                 |
| Amount: $75.00                           |
|                                          |
| Recipient: Sysco - Delivery Driver       |
| Reference: INV-2026-4567                 |
|                                          |
| Description:                             |
| COD payment for emergency produce order  |
|                                          |
| ────────────────────────────────────     |
|                                          |
| Processed by: Sarah M.                   |
| Approved by: Mike T. (Manager)           |
|                                          |
| ────────────────────────────────────     |
| Recipient Signature:                     |
|                                          |
| _______________________________          |
|                                          |
| Drawer: #1 - Front Register             |
+------------------------------------------+
```

---

*Last Updated: January 27, 2026*
