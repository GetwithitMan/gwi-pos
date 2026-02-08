# 06 - Tipping

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 05-Employees-Roles

---

## Overview

The Tipping skill handles all aspects of tip management - from customer tip entry to complex tip pooling and distribution. This is a critical feature for employee satisfaction and legal compliance.

**Primary Goal:** Provide flexible, accurate tip tracking and distribution that supports all common tipping models while maintaining complete transparency and audit trails.

---

## User Stories

### As a Server...
- I want to see my tips for the current shift
- I want to understand how tip pooling affects my take-home
- I want to enter tips from signed receipts quickly
- I want to declare cash tips received

### As a Manager...
- I want to set up tip pooling rules that are fair
- I want to see tip reports by employee
- I want to handle tip adjustments when needed
- I want to ensure compliance with tip regulations

### As a Bartender...
- I want to receive tip-outs from servers
- I want to track my direct tips vs tip-outs
- I want to give one-off tips to back of house

### As a Business Owner...
- I want to export tip data for payroll
- I want to ensure we're compliant with tip regulations
- I want to track tip trends over time

---

## Features

### Tip Entry

#### From Payment Processing
- [ ] Credit card tip entered on card reader
- [ ] Tip amount captured automatically
- [ ] Tip flows to order/employee record

#### From Signed Receipts
- [ ] Server enters tip from paper receipt
- [ ] Adjust tip screen with receipt image option
- [ ] Validation against original transaction
- [ ] Time window for tip entry (configurable)

#### Cash Tips
- [ ] Declare cash tips received
- [ ] Track separate from credit tips
- [ ] Running total for shift

#### Tip Adjustments
- [ ] Manager can adjust tips
- [ ] Reason required
- [ ] Audit trail maintained

### Tip Tracking

#### By Employee
- [ ] Tips per shift
- [ ] Tips per day/week/month
- [ ] Breakdown by type (credit, cash, pooled)
- [ ] Comparison to hours worked

#### By Order
- [ ] Tip associated with order
- [ ] Split tip tracking (for split checks)
- [ ] Tip percentage calculation

### Tip Pooling/Sharing Systems

#### Pool Types

**1. Percentage-Based Pool**
All or portion of tips go into a pool distributed by rules.

Example Configuration:
```
Pool: "Service Staff Pool"
Source: 100% of credit card tips
Distribution:
  - Servers: 70%
  - Bartenders: 20%
  - Hosts: 10%
Split within role: Even by hours worked
```

**2. Tip-Out System**
Individual servers tip out support staff based on sales or tips.

Example Configuration:
```
Tip-Out Rules:
  - Busser: 2% of food sales
  - Bartender: 5% of bar sales
  - Host: 1% of total sales

Server keeps: Remaining tips after tip-outs
```

**3. Points-Based System**
Tips divided by points assigned to each role/person.

Example Configuration:
```
Point Values:
  - Server: 10 points
  - Bartender: 8 points
  - Busser: 5 points
  - Host: 3 points

Calculation: Total Pool ÷ Total Points × Individual Points
```

**4. Hybrid System**
Combination of direct tips and pooling.

Example:
```
Server keeps: 80% of their direct tips
Pool contribution: 20% of their direct tips
Pool distribution: Split evenly among all tipped staff
```

#### Pool Configuration
- [ ] Create multiple pools
- [ ] Define source (which tips go into pool)
- [ ] Define recipients (by role, by individual)
- [ ] Define distribution method
- [ ] Define timing (per shift, daily, weekly)
- [ ] Set active hours (Happy Hour pool vs Dinner pool)

### One-Off Tips

#### Direct Employee Tips
- [ ] Tip specific employee (not from an order)
- [ ] Cash tip handoff tracking
- [ ] Back of house tipping
- [ ] Reason/note optional

#### Back of House Tipping
- [ ] Front of house tips kitchen staff
- [ ] Amount or percentage
- [ ] Distribution among kitchen roles
- [ ] Track BOH tips separately

### Tip Distribution

#### Calculation Timing
- [ ] Per shift (at clock-out)
- [ ] Daily (at end of day)
- [ ] Weekly (for payroll)
- [ ] On-demand calculation

#### Distribution Preview
- [ ] Preview before finalizing
- [ ] What-if scenarios
- [ ] Adjustment capability

#### Distribution Finalization
- [ ] Lock distribution once finalized
- [ ] Cannot modify without manager override
- [ ] Audit trail

### Tip Reporting

#### Employee Reports
- [ ] Tips earned summary
- [ ] Breakdown by source
- [ ] Hours worked correlation
- [ ] Historical comparison

#### Management Reports
- [ ] Tip pool status
- [ ] Distribution report
- [ ] Tip-out compliance
- [ ] Tip % analysis

#### Payroll Export
- [ ] Export tips by employee
- [ ] Format for payroll systems
- [ ] Separate credit/cash
- [ ] Include declared tips

---

## UI/UX Specifications

### Tip Entry Screen (Server)

```
+------------------------------------------------------------------+
| ENTER TIP - Check #1234                                          |
+------------------------------------------------------------------+
|                                                                  |
| Payment Total: $45.67                                            |
| Suggested Tip (20%): $9.13                                       |
|                                                                  |
| Tip Amount: [$________]                                          |
|                                                                  |
| [Quick Tips]                                                     |
| [15% $6.85] [18% $8.22] [20% $9.13] [22% $10.05] [25% $11.42]   |
|                                                                  |
| [Cancel]                                    [Save Tip]           |
+------------------------------------------------------------------+
```

### Tip Pool Configuration

```
+------------------------------------------------------------------+
| TIP POOL: Dinner Service Pool                        [Save]      |
+------------------------------------------------------------------+
| Name: [Dinner Service Pool    ]                                  |
| Active: [6:00 PM] to [Close]                                     |
| Active Days: ☑Mon ☑Tue ☑Wed ☑Thu ☑Fri ☑Sat ☑Sun               |
+------------------------------------------------------------------+
| SOURCE                                                           |
| Tip Source: [Credit Card Tips ▼]                                 |
| Contribution: [100]%                                             |
+------------------------------------------------------------------+
| DISTRIBUTION                                                     |
| Method: [By Role Percentage ▼]                                   |
|                                                                  |
| Role          | Percentage | Split Within     |                  |
| Server        | [60]%      | [By Hours ▼]    | [×]              |
| Bartender     | [25]%      | [By Hours ▼]    | [×]              |
| Host          | [10]%      | [Even ▼]        | [×]              |
| Busser        | [5]%       | [Even ▼]        | [×]              |
|                            [+ Add Role]                          |
|                                                                  |
| Total: 100% ✓                                                    |
+------------------------------------------------------------------+
```

### Tip-Out Configuration

```
+------------------------------------------------------------------+
| TIP-OUT RULES                                        [Save]      |
+------------------------------------------------------------------+
| Servers tip out the following:                                   |
|                                                                  |
| Role          | Base          | Percentage |                     |
| Bartender     | [Bar Sales ▼] | [5]%       | [×]                 |
| Busser        | [Food Sales ▼]| [2]%       | [×]                 |
| Host          | [Total Sales▼]| [1]%       | [×]                 |
|                                                                  |
| [+ Add Tip-Out Rule]                                             |
|                                                                  |
| Example for $500 in sales ($400 food, $100 bar):                |
| - To Bartender: $5.00 (5% of $100)                              |
| - To Busser: $8.00 (2% of $400)                                 |
| - To Host: $5.00 (1% of $500)                                   |
| - Total tip-out: $18.00                                         |
+------------------------------------------------------------------+
```

### Employee Tip Summary

```
+------------------------------------------------------------------+
| MY TIPS - Sarah Miller                        Jan 27, 2026       |
+------------------------------------------------------------------+
| TODAY'S SHIFT (4:00 PM - Present)                                |
|                                                                  |
| Direct Tips (Credit):    $156.00                                 |
| Direct Tips (Cash):       $45.00  (declared)                     |
| Pool Distribution:        $23.50                                 |
| Tip-Outs Given:         -$18.00                                 |
| ─────────────────────────────────                                |
| NET TIPS:               $206.50                                  |
|                                                                  |
| Hours Worked: 5.5 hrs                                            |
| Tips per Hour: $37.55                                            |
|                                                                  |
+------------------------------------------------------------------+
| BREAKDOWN                                                        |
| ┌─────────────────────────────────────────────────────────────┐ |
| │ Credit Tips    ████████████████████████░░░░░░  $156 (75%)  │ |
| │ Cash Tips      ██████░░░░░░░░░░░░░░░░░░░░░░░   $45 (22%)   │ |
| │ Pool           ██░░░░░░░░░░░░░░░░░░░░░░░░░░░   $24 (12%)   │ |
| │ Tip-Outs       ██░░░░░░░░░░░░░░░░░░░░░░░░░░░  -$18 (-9%)   │ |
| └─────────────────────────────────────────────────────────────┘ |
+------------------------------------------------------------------+
```

### Management Tip Report

```
+------------------------------------------------------------------+
| TIP REPORT                                    Jan 27, 2026       |
+------------------------------------------------------------------+
| Period: [Today ▼]          [Export CSV]                          |
+------------------------------------------------------------------+
| SUMMARY                                                          |
| Total Tips Collected:   $1,245.00                                |
| Credit Card Tips:       $1,102.00                                |
| Cash Tips (Declared):     $143.00                                |
| Pool Distributions:       $456.00                                |
| Tip-Outs Processed:       $234.00                                |
+------------------------------------------------------------------+
| BY EMPLOYEE                                                      |
| Employee       | Direct  | Pooled | Tip-Outs | Net    | Hours   |
| Sarah Miller   | $201.00 | $23.50 | -$18.00  | $206.50| 5.5     |
| Mike Johnson   | $312.00 | $45.00 | -$32.00  | $325.00| 6.0     |
| Lisa Garcia    | $89.00  | $67.00 | $0.00    | $156.00| 4.0     |
| Tom Brown (BOH)| $0.00   | $45.00 | $28.00   | $73.00 | 8.0     |
+------------------------------------------------------------------+
```

---

## Data Model

### Tips
```sql
tips {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Source
  order_id: UUID (FK, nullable)
  payment_id: UUID (FK, nullable)

  -- Recipient
  employee_id: UUID (FK)

  -- Amount
  amount: DECIMAL(10,2)
  tip_type: VARCHAR(50) (credit, cash, pool_distribution, tip_out, one_off)

  -- For pooled/tip-out
  pool_id: UUID (FK, nullable)
  source_employee_id: UUID (FK, nullable) -- Who gave the tip-out

  -- Timing
  shift_id: UUID (FK, nullable)
  earned_at: TIMESTAMP

  -- Status
  status: VARCHAR(50) (pending, finalized, adjusted)

  -- Audit
  entered_by: UUID (FK)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Tip Adjustments
```sql
tip_adjustments {
  id: UUID PRIMARY KEY
  tip_id: UUID (FK)

  original_amount: DECIMAL(10,2)
  adjusted_amount: DECIMAL(10,2)
  reason: VARCHAR(200)

  adjusted_by: UUID (FK)
  adjusted_at: TIMESTAMP

  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)
}
```

### Tip Pools
```sql
tip_pools {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)

  -- When active
  active_start_time: TIME (nullable)
  active_end_time: TIME (nullable)
  active_days: INTEGER[] (nullable)

  -- Source
  source_type: VARCHAR(50) (credit_tips, all_tips, percentage)
  source_percentage: DECIMAL(5,2) (if percentage-based)

  -- Distribution
  distribution_method: VARCHAR(50) (role_percentage, points, even)
  distribution_timing: VARCHAR(50) (per_shift, daily, weekly)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Tip Pool Recipients
```sql
tip_pool_recipients {
  id: UUID PRIMARY KEY
  pool_id: UUID (FK)

  -- Who receives
  job_id: UUID (FK, nullable) -- By job/role
  employee_id: UUID (FK, nullable) -- Or specific employee

  -- How much
  percentage: DECIMAL(5,2) (nullable)
  points: INTEGER (nullable)

  -- How to split within group
  split_method: VARCHAR(50) (even, by_hours, by_sales)

  created_at: TIMESTAMP
}
```

### Tip-Out Rules
```sql
tip_out_rules {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Who tips out
  from_job_id: UUID (FK)

  -- Who receives
  to_job_id: UUID (FK)

  -- Calculation
  base_type: VARCHAR(50) (food_sales, bar_sales, total_sales, tips)
  percentage: DECIMAL(5,2)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Tip Pool Distributions
```sql
tip_pool_distributions {
  id: UUID PRIMARY KEY
  pool_id: UUID (FK)

  -- Period
  distribution_date: DATE
  shift_id: UUID (FK, nullable)

  -- Totals
  total_collected: DECIMAL(10,2)
  total_distributed: DECIMAL(10,2)

  -- Status
  status: VARCHAR(50) (pending, calculated, finalized)

  finalized_by: UUID (FK, nullable)
  finalized_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

### Declared Cash Tips
```sql
declared_cash_tips {
  id: UUID PRIMARY KEY
  employee_id: UUID (FK)
  location_id: UUID (FK)

  amount: DECIMAL(10,2)
  shift_id: UUID (FK, nullable)
  declared_at: TIMESTAMP

  notes: TEXT (nullable)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Tips
```
POST   /api/tips                           -- Record tip
GET    /api/tips                           -- List tips
GET    /api/tips/{id}                      -- Get tip details
PUT    /api/tips/{id}                      -- Adjust tip
GET    /api/employees/{id}/tips            -- Employee tips
GET    /api/orders/{id}/tip                -- Order tip
```

### Cash Tips
```
POST   /api/tips/declare-cash              -- Declare cash tip
GET    /api/employees/{id}/declared-cash   -- Get declared cash
```

### Tip Pools
```
GET    /api/tip-pools                      -- List pools
POST   /api/tip-pools                      -- Create pool
GET    /api/tip-pools/{id}                 -- Get pool details
PUT    /api/tip-pools/{id}                 -- Update pool
DELETE /api/tip-pools/{id}                 -- Delete pool
GET    /api/tip-pools/{id}/recipients      -- Get recipients
PUT    /api/tip-pools/{id}/recipients      -- Update recipients
```

### Tip-Out Rules
```
GET    /api/tip-out-rules                  -- List rules
POST   /api/tip-out-rules                  -- Create rule
PUT    /api/tip-out-rules/{id}             -- Update rule
DELETE /api/tip-out-rules/{id}             -- Delete rule
```

### Distribution
```
POST   /api/tip-pools/{id}/calculate       -- Calculate distribution
GET    /api/tip-pools/{id}/distributions   -- Get distributions
POST   /api/tip-distributions/{id}/finalize -- Finalize
GET    /api/tip-distributions/{id}/preview -- Preview
```

### Reporting
```
GET    /api/reports/tips/summary           -- Summary report
GET    /api/reports/tips/by-employee       -- By employee
GET    /api/reports/tips/by-pool           -- By pool
GET    /api/reports/tips/export            -- Export for payroll
```

---

## Business Rules

1. **Tip Ownership:** Tips belong to employee who took the order unless pooled
2. **Tip Entry Window:** Credit tips can only be adjusted within X hours (configurable)
3. **Pool Calculation:** Pools calculate based on actual hours worked during pool period
4. **Tip-Out Calculation:** Tip-outs calculated at end of shift before pooling
5. **Finalization:** Once finalized, tips cannot be changed without manager override
6. **Cash Declaration:** Employees must declare cash tips for tax purposes
7. **Zero Tips:** Zero tips must be explicitly entered (not left blank)
8. **Negative Protection:** Tips cannot go negative (tip-outs capped at tips earned)

---

## Permissions

| Action | Server | Bartender | Manager | Admin |
|--------|--------|-----------|---------|-------|
| Enter tips (own) | Yes | Yes | Yes | Yes |
| View tips (own) | Yes | Yes | Yes | Yes |
| View tips (all) | No | No | Yes | Yes |
| Adjust tips | No | No | Yes | Yes |
| Declare cash | Yes | Yes | Yes | Yes |
| Configure pools | No | No | Yes | Yes |
| Configure tip-outs | No | No | Yes | Yes |
| Finalize distributions | No | No | Yes | Yes |
| Export for payroll | No | No | Yes | Yes |
| Give one-off tips | Yes | Yes | Yes | Yes |

---

## Configuration Options

```yaml
tipping:
  entry:
    tip_entry_window_hours: 24
    require_zero_tip_entry: true
    allow_negative_adjustment: false
    require_adjustment_reason: true

  pooling:
    enabled: true
    default_distribution_timing: "per_shift"
    auto_calculate_at_clock_out: true
    require_approval_to_finalize: true

  tip_outs:
    enabled: true
    calculate_before_pooling: true
    cap_at_tips_earned: true

  cash_tips:
    require_declaration: true
    declare_at_clock_out: true

  display:
    show_tip_percentage: true
    show_tips_to_employees: true
    real_time_tip_tracking: true
```

---

## Open Questions

1. **Tip Credit:** Support for states that allow tip credit against minimum wage?

2. **Service Charges:** How to handle automatic service charges vs tips?

3. **Tip Splitting Algorithms:** What if employee works multiple jobs in one shift?

4. **Real-Time vs End of Shift:** Calculate pools in real-time or at end of period?

5. **Tip Compliance:** What state-specific regulations need consideration?

6. **BOH Tip Pool:** Legal considerations for back-of-house in tip pool?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [x] Data model defined
- [ ] Pool calculation logic reviewed
- [ ] UI mockups created

### Development
- [ ] Tip entry interface
- [ ] Cash tip declaration
- [ ] Pool configuration
- [ ] Tip-out rules
- [ ] Distribution calculation
- [ ] Employee tip view
- [ ] Management reports
- [ ] Payroll export

### Testing
- [ ] Unit tests (calculations)
- [ ] Pool distribution scenarios
- [ ] Edge cases (splits, transfers)
- [ ] Compliance review

---

*Last Updated: January 27, 2026*
