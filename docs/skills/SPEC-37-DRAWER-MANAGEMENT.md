# 37 - Drawer Management

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 30-Tender-Types

---

## Overview

The Drawer Management skill handles cash drawer operations - opening/closing drawers, cash counting, drops, payouts, over/short tracking, and end-of-day reconciliation. Supports multiple drawers, blind counts, and comprehensive cash tracking.

**Primary Goal:** Accurate cash handling with full accountability and easy reconciliation.

---

## User Stories

### As a Cashier...
- I want to quickly count my drawer
- I want to record drops and payouts
- I want to know my drawer balance
- I want to close out easily at end of shift

### As a Manager...
- I want to track over/short by employee
- I want to approve payouts
- I want reconciliation reports
- I want to investigate discrepancies

### As an Owner...
- I want accurate cash tracking
- I want to reduce shrinkage
- I want historical cash reports
- I want employee accountability

---

## Features

### Drawer Assignment

#### Drawer Types
- [ ] Assigned drawer (one cashier)
- [ ] Shared drawer (multiple users)
- [ ] Server bank (carry own cash)
- [ ] Bar drawer

#### Assignment Rules
- [ ] One drawer per employee
- [ ] Required to clock in
- [ ] Auto-assign by terminal
- [ ] Manual assignment

### Opening Procedures

#### Drawer Open
- [ ] Count starting cash
- [ ] Verify starting amount
- [ ] Sign off on count
- [ ] Time stamp

#### Opening Count Options
```yaml
opening_options:
  blind_count: false  # Can't see expected amount
  require_count: true
  default_starting_amount: 200.00
  allow_variance: 0.00  # Must match exactly
```

### Cash Operations

#### Cash In
- [ ] Cash sales
- [ ] Tips received
- [ ] Loans from safe
- [ ] Other deposits

#### Cash Out
- [ ] Cash back
- [ ] Paid outs (vendors, tips)
- [ ] Drops to safe
- [ ] Refunds

### Safe Drops

#### Drop Process
- [ ] Enter drop amount
- [ ] Count verification
- [ ] Generate drop ticket
- [ ] Manager witness (optional)
- [ ] Time stamp

#### Drop Rules
```yaml
drop_rules:
  auto_prompt_at: 500.00  # Prompt when over this amount
  require_witness_above: 200.00
  require_manager_approval: false
  generate_ticket: true
```

### Paid Outs

#### Payout Types
- [ ] Vendor payment
- [ ] Employee tip cash-out
- [ ] Petty cash
- [ ] Refund
- [ ] Other (with reason)

#### Payout Requirements
- [ ] Receipt/documentation
- [ ] Manager approval (configurable)
- [ ] Reason code
- [ ] Recipient name

### Closing Procedures

#### Drawer Close
- [ ] Count all cash
- [ ] Count by denomination
- [ ] Calculate over/short
- [ ] Sign off
- [ ] Manager review (if variance)

#### Blind Close
- [ ] Count without seeing expected
- [ ] System calculates variance
- [ ] Requires investigation if over threshold

### Denomination Counting

#### Count Entry
- [ ] $100 bills
- [ ] $50 bills
- [ ] $20 bills
- [ ] $10 bills
- [ ] $5 bills
- [ ] $1 bills
- [ ] Quarters ($0.25)
- [ ] Dimes ($0.10)
- [ ] Nickels ($0.05)
- [ ] Pennies ($0.01)
- [ ] Rolled coins
- [ ] Quick total entry

### Over/Short Tracking

#### Variance Handling
- [ ] Record over/short
- [ ] Require reason above threshold
- [ ] Manager sign-off
- [ ] Track by employee
- [ ] Trend analysis

#### Variance Thresholds
```yaml
variance_thresholds:
  acceptable: 2.00  # No action needed
  warning: 5.00     # Flag but allow
  critical: 10.00   # Require manager approval
  investigation: 25.00  # Auto-trigger investigation
```

### Cash Reconciliation

#### End of Day
- [ ] Sum all drawers
- [ ] Compare to POS sales
- [ ] Account for drops
- [ ] Account for payouts
- [ ] Final variance

#### Reconciliation Report
- [ ] Opening amounts
- [ ] Cash sales
- [ ] Cash refunds
- [ ] Drops made
- [ ] Payouts made
- [ ] Closing amounts
- [ ] Net variance

### Reporting

#### Drawer Reports
- [ ] Drawer activity log
- [ ] Over/short summary
- [ ] Payout report
- [ ] Drop report
- [ ] Employee cash handling

---

## UI/UX Specifications

### Drawer Dashboard

```
+------------------------------------------------------------------+
| DRAWER MANAGEMENT                                   Jan 27, 2026  |
+------------------------------------------------------------------+
|                                                                   |
| ACTIVE DRAWERS                                                    |
| +--------------------------------------------------------------+ |
| | Drawer 1 - Front Register                                     | |
| | Assigned: Sarah M. | Opened: 9:00 AM                          | |
| | Starting: $200.00 | Current: $847.50 | Drops: $400.00         | |
| |                               [Activity] [Drop] [Close]       | |
| +--------------------------------------------------------------+ |
| | Drawer 2 - Bar                                                | |
| | Assigned: Mike T. | Opened: 4:00 PM                           | |
| | Starting: $200.00 | Current: $523.00 | Drops: $0.00           | |
| |                               [Activity] [Drop] [Close]       | |
| +--------------------------------------------------------------+ |
| | Drawer 3 - Back Register                                      | |
| | Status: CLOSED                                                | |
| |                                              [Open Drawer]    | |
| +--------------------------------------------------------------+ |
|                                                                   |
| TODAY'S SUMMARY                                                   |
| +------------------+ +------------------+ +------------------+    |
| | Total Drops      | | Total Payouts    | | Net Variance     |    |
| | $1,200.00        | | $85.00           | | -$2.50           |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| [Open New Drawer]  [Reconciliation Report]  [Cash History]       |
|                                                                   |
+------------------------------------------------------------------+
```

### Drawer Count (Closing)

```
+------------------------------------------------------------------+
| CLOSE DRAWER - Drawer 1                                          |
+------------------------------------------------------------------+
|                                                                   |
| COUNT BY DENOMINATION                                             |
|                                                                   |
| BILLS                                COINS                        |
| +---------------------------+        +---------------------------+|
| | $100 x [__2_] = $200.00  |        | $1.00 x [_25_] = $25.00  ||
| | $50  x [__1_] = $50.00   |        | $0.25 x [_40_] = $10.00  ||
| | $20  x [_15_] = $300.00  |        | $0.10 x [_30_] = $3.00   ||
| | $10  x [__8_] = $80.00   |        | $0.05 x [_20_] = $1.00   ||
| | $5   x [_12_] = $60.00   |        | $0.01 x [_75_] = $0.75   ||
| | $1   x [_47_] = $47.00   |        |                           ||
| +---------------------------+        +---------------------------+|
|                                                                   |
| ROLLED COINS                                                      |
| +--------------------------------------------------------------+ |
| | Quarters ($10) x [_2_] | Dimes ($5) x [_1_] | Nickels ($2) x [_0_]| |
| +--------------------------------------------------------------+ |
|                                                                   |
| OTHER                                                             |
| Checks: $[____0.00_]                                             |
|                                                                   |
| ═══════════════════════════════════════════════════════════════  |
|                                                                   |
| COUNTED TOTAL:            $776.75                                |
| EXPECTED TOTAL:           $777.50                                |
| ─────────────────────────────────────────────────────────────────|
| VARIANCE:                 -$0.75 (SHORT)                         |
|                                                                   |
| Variance is within acceptable range ($2.00)                      |
|                                                                   |
| [Cancel]                                    [Complete Close Out] |
+------------------------------------------------------------------+
```

### Safe Drop

```
+------------------------------------------------------------------+
| SAFE DROP - Drawer 1                                             |
+------------------------------------------------------------------+
|                                                                   |
| Current Drawer Balance: $847.50                                  |
| Recommended Drop: $400.00+ (to bring below $500)                 |
|                                                                   |
| DROP AMOUNT                                                       |
| [  $400.00  ]                                                    |
|                                                                   |
| Quick Amounts:                                                    |
| [$100] [$200] [$300] [$400] [$500] [Custom]                     |
|                                                                   |
| COUNT VERIFICATION                                                |
| +--------------------------------------------------------------+ |
| | Count the cash you are dropping:                              | |
| | $20 x [_20_] = $400.00                                        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| CONFIRMATION                                                      |
| [ ] I have counted $400.00 and placed it in the drop envelope   |
| [ ] Envelope sealed and labeled                                  |
|                                                                   |
| After drop, drawer balance will be: $447.50                      |
|                                                                   |
| [Cancel]                                    [Complete Drop]       |
+------------------------------------------------------------------+
```

### Paid Out

```
+------------------------------------------------------------------+
| PAID OUT - Drawer 1                                              |
+------------------------------------------------------------------+
|                                                                   |
| PAYOUT TYPE                                                       |
| (•) Vendor Payment                                               |
| ( ) Employee Tip Cash-Out                                        |
| ( ) Petty Cash                                                   |
| ( ) Customer Refund                                              |
| ( ) Other                                                        |
|                                                                   |
| AMOUNT: $[____45.00___]                                          |
|                                                                   |
| RECIPIENT: [Sysco - Delivery Driver_________]                    |
|                                                                   |
| REASON/DESCRIPTION:                                               |
| [Emergency produce delivery - paid COD_________________]         |
|                                                                   |
| DOCUMENTATION                                                     |
| [✓] Receipt/Invoice attached                                     |
| Invoice #: [INV-2026-1234____]                                   |
|                                                                   |
| ⚠️ Payouts over $25.00 require manager approval                  |
|                                                                   |
| [Cancel]                    [Request Approval] [Complete Payout] |
+------------------------------------------------------------------+
```

### Over/Short Report

```
+------------------------------------------------------------------+
| OVER/SHORT REPORT                               Jan 2026         |
+------------------------------------------------------------------+
|                                                                   |
| SUMMARY                                                           |
| +------------------+ +------------------+ +------------------+    |
| | Total Over       | | Total Short      | | Net Variance     |    |
| | $23.50           | | $45.75           | | -$22.25          |    |
| | (8 instances)    | | (12 instances)   |                    |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| BY EMPLOYEE                                                       |
| +--------------------------------------------------------------+ |
| | Employee       | Shifts | Over    | Short   | Net     | Avg  | |
| +--------------------------------------------------------------+ |
| | Sarah M.       | 15     | $8.00   | $12.25  | -$4.25  |-$0.28| |
| | Mike T.        | 12     | $5.50   | $8.50   | -$3.00  |-$0.25| |
| | John D.        | 10     | $10.00  | $15.00  | -$5.00  |-$0.50| |
| | Lisa K.        | 8      | $0.00   | $10.00  | -$10.00 |-$1.25|⚠️|
| +--------------------------------------------------------------+ |
|                                                                   |
| ⚠️ Lisa K. flagged for review - average variance exceeds $1.00   |
|                                                                   |
| RECENT VARIANCES                                                  |
| +--------------------------------------------------------------+ |
| | Date     | Employee   | Drawer  | Expected | Counted | Var   | |
| +--------------------------------------------------------------+ |
| | Jan 27   | Sarah M.   | #1      | $777.50  | $776.75 | -$0.75| |
| | Jan 27   | Mike T.    | #2      | $523.00  | $524.50 | +$1.50| |
| | Jan 26   | Lisa K.    | #1      | $812.00  | $807.00 | -$5.00|⚠️|
| +--------------------------------------------------------------+ |
|                                                                   |
| [Export]  [Print]  [Investigate Selected]                        |
+------------------------------------------------------------------+
```

---

## Data Model

### Cash Drawers
```sql
cash_drawers {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  terminal_id: UUID (FK, nullable)

  drawer_number: INTEGER
  name: VARCHAR(100)

  drawer_type: VARCHAR(50) (assigned, shared, server_bank)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Drawer Sessions
```sql
drawer_sessions {
  id: UUID PRIMARY KEY
  drawer_id: UUID (FK)
  location_id: UUID (FK)

  -- Assignment
  employee_id: UUID (FK)
  opened_by: UUID (FK)

  -- Opening
  opening_amount: DECIMAL(10,2)
  opened_at: TIMESTAMP
  opening_verified: BOOLEAN DEFAULT false

  -- Closing
  expected_amount: DECIMAL(10,2) (nullable)  -- Calculated
  counted_amount: DECIMAL(10,2) (nullable)
  variance: DECIMAL(10,2) (nullable)
  closed_at: TIMESTAMP (nullable)
  closed_by: UUID (FK, nullable)

  -- Count details
  count_details: JSONB (nullable)  -- Denomination breakdown

  -- Status
  status: VARCHAR(50) (open, closed, reconciled)

  -- Review
  variance_reason: TEXT (nullable)
  reviewed_by: UUID (FK, nullable)
  reviewed_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

### Drawer Transactions
```sql
drawer_transactions {
  id: UUID PRIMARY KEY
  session_id: UUID (FK)
  drawer_id: UUID (FK)
  location_id: UUID (FK)

  transaction_type: VARCHAR(50) (sale, refund, drop, payout, loan, adjustment)
  amount: DECIMAL(10,2) -- Positive = in, Negative = out

  -- Reference
  order_id: UUID (FK, nullable)
  payment_id: UUID (FK, nullable)

  -- For drops/payouts
  reason: TEXT (nullable)
  recipient: VARCHAR(200) (nullable)
  reference_number: VARCHAR(100) (nullable)

  -- Approval
  requires_approval: BOOLEAN DEFAULT false
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)

  processed_by: UUID (FK)
  created_at: TIMESTAMP
}
```

### Safe Drops
```sql
safe_drops {
  id: UUID PRIMARY KEY
  session_id: UUID (FK)
  location_id: UUID (FK)

  amount: DECIMAL(10,2)
  drop_number: INTEGER

  -- Verification
  counted_by: UUID (FK)
  witnessed_by: UUID (FK, nullable)

  -- Deposit
  deposited: BOOLEAN DEFAULT false
  deposited_at: TIMESTAMP (nullable)
  deposit_reference: VARCHAR(100) (nullable)

  notes: TEXT (nullable)

  created_at: TIMESTAMP
}
```

### Paid Outs
```sql
paid_outs {
  id: UUID PRIMARY KEY
  session_id: UUID (FK)
  location_id: UUID (FK)

  payout_type: VARCHAR(50) (vendor, tip_cashout, petty_cash, refund, other)
  amount: DECIMAL(10,2)

  recipient: VARCHAR(200)
  reason: TEXT

  -- Documentation
  has_receipt: BOOLEAN DEFAULT false
  invoice_number: VARCHAR(100) (nullable)
  receipt_image_url: VARCHAR(500) (nullable)

  -- Approval
  requires_approval: BOOLEAN DEFAULT false
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)

  processed_by: UUID (FK)
  created_at: TIMESTAMP
}
```

### Drawer Settings
```sql
drawer_settings {
  location_id: UUID PRIMARY KEY (FK)

  -- Opening
  require_opening_count: BOOLEAN DEFAULT true
  blind_opening: BOOLEAN DEFAULT false
  default_starting_amount: DECIMAL(10,2) DEFAULT 200.00

  -- Operations
  auto_drop_threshold: DECIMAL(10,2) (nullable)
  require_drop_witness_above: DECIMAL(10,2) (nullable)
  require_payout_approval_above: DECIMAL(10,2) (nullable)

  -- Closing
  require_closing_count: BOOLEAN DEFAULT true
  blind_closing: BOOLEAN DEFAULT false
  require_denomination_count: BOOLEAN DEFAULT true

  -- Variance
  acceptable_variance: DECIMAL(10,2) DEFAULT 2.00
  warning_variance: DECIMAL(10,2) DEFAULT 5.00
  critical_variance: DECIMAL(10,2) DEFAULT 10.00

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Drawers
```
GET    /api/drawers
POST   /api/drawers
PUT    /api/drawers/{id}
GET    /api/drawers/{id}/status
```

### Sessions
```
GET    /api/drawer-sessions
POST   /api/drawer-sessions/open
PUT    /api/drawer-sessions/{id}/close
GET    /api/drawer-sessions/{id}
GET    /api/drawer-sessions/active
```

### Transactions
```
GET    /api/drawer-sessions/{id}/transactions
POST   /api/drawer-sessions/{id}/transactions
```

### Drops
```
POST   /api/drawer-sessions/{id}/drop
GET    /api/drops
PUT    /api/drops/{id}/deposit
```

### Payouts
```
POST   /api/drawer-sessions/{id}/payout
GET    /api/payouts
PUT    /api/payouts/{id}/approve
```

### Reports
```
GET    /api/reports/drawer/reconciliation
GET    /api/reports/drawer/over-short
GET    /api/reports/drawer/activity
GET    /api/reports/drawer/employee/{id}
```

---

## Business Rules

1. **One Open Session:** Employee can only have one drawer open at a time
2. **Close Before Reopen:** Must close drawer before opening another
3. **Drop Recording:** All drops must be recorded with amount verification
4. **Payout Approval:** Payouts above threshold require manager approval
5. **Variance Investigation:** Critical variances require documented explanation
6. **Blind Count:** If enabled, employee cannot see expected amount

---

## Permissions

| Action | Cashier | Manager | Admin |
|--------|---------|---------|-------|
| Open own drawer | Yes | Yes | Yes |
| Close own drawer | Yes | Yes | Yes |
| Make drops | Yes | Yes | Yes |
| Make payouts | Limited | Yes | Yes |
| Approve payouts | No | Yes | Yes |
| View own variance | Yes | Yes | Yes |
| View all variances | No | Yes | Yes |
| Adjust drawer | No | Yes | Yes |
| Configure settings | No | No | Yes |
| Run reports | No | Yes | Yes |

---

## Configuration Options

```yaml
drawer_management:
  opening:
    require_count: true
    blind_count: false
    default_amount: 200.00
    allow_custom_amount: true

  drops:
    auto_prompt_threshold: 500.00
    require_witness_above: 200.00
    require_envelope_seal: true
    generate_ticket: true

  payouts:
    require_receipt: true
    approval_threshold: 25.00
    allowed_types:
      - vendor
      - tip_cashout
      - petty_cash

  closing:
    require_denomination_count: true
    blind_count: false
    require_zero_balance: false  # Server banks often don't

  variance:
    acceptable: 2.00
    warning: 5.00
    critical: 10.00
    auto_flag_employee_average: 1.00

  tracking:
    track_by_employee: true
    track_trends: true
    alert_patterns: true
```

---

## Workflow Examples

### Shift Start
1. Clock in (if time tracking enabled)
2. Assigned drawer or select available
3. Count starting cash
4. Verify amount matches expected
5. Sign off and begin shift

### During Shift
1. Process cash sales (auto-tracked)
2. Drop when prompted or manually
3. Process payouts as needed
4. Track running balance

### Shift End
1. Complete any pending orders
2. Initiate drawer close
3. Count all cash by denomination
4. System calculates expected vs counted
5. Document variance if any
6. Manager reviews if over threshold
7. Session closed

---

*Last Updated: January 27, 2026*
