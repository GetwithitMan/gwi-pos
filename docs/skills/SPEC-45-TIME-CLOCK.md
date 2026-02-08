# 45 - Time Clock

**Status:** Planning
**Priority:** High
**Dependencies:** 05-Employees-Roles, 37-Drawer-Management, 04-Order-Management

---

## Overview

The Time Clock skill provides comprehensive employee clock in/out functionality with pre-shift and post-shift verification requirements. Ensures employees settle tables, count drawers, and complete required tasks before clocking out. Supports blind drops, shift reporting, and labor tracking.

**Primary Goal:** Accurate time tracking with enforced pre/post shift procedures to ensure proper handoffs and accountability.

---

## User Stories

### As an Employee...
- I want to quickly clock in and out
- I want to see my hours worked
- I want to take breaks properly tracked
- I want to see my shift summary at clock out

### As a Manager...
- I want to see who's on the clock
- I want to enforce clock-out procedures
- I want to edit time entries when needed
- I want accurate labor reporting

### As a Payroll Admin...
- I want exportable time records
- I want overtime calculations
- I want break compliance tracking
- I want audit trails for edits

---

## Features

### Clock In

#### Clock In Process
- [ ] Employee PIN entry
- [ ] Job code selection (if multiple)
- [ ] Scheduled shift verification
- [ ] Early clock-in controls
- [ ] Photo capture (optional)

#### Clock In Flow
```
Employee PIN → Verify Identity → Select Job → Clock In
                    ↓
            Early? → Manager Override
                    ↓
            Assign Drawer? → Open Drawer Flow
                    ↓
            Confirmation
```

### Clock Out

#### Pre-Clock-Out Verification
- [ ] Open tables/tabs check
- [ ] Open orders check
- [ ] Drawer assignment check
- [ ] Pending side work
- [ ] Tip declaration

#### Clock Out Blocking Rules
```yaml
clock_out_requirements:
  server:
    - no_open_tables
    - no_open_checks
    - declare_cash_tips
    - complete_sidework

  bartender:
    - no_open_tabs
    - drawer_counted
    - declare_cash_tips
    - complete_checkout

  cashier:
    - no_active_orders
    - drawer_counted
    - blind_drop_complete
```

### Drawer Integration

#### Clock Out with Drawer
- [ ] Blind count option
- [ ] See expected amount option
- [ ] Over/short recording
- [ ] Drop to safe
- [ ] Variance explanation

#### Drawer Flow at Clock Out
```
Clock Out Request
     ↓
Check: Drawer Assigned?
     ↓ Yes
Close Drawer Flow → Count → Verify → Drop → Continue
     ↓
Check: Tables Settled?
     ↓ Yes
Confirm Clock Out
```

### Break Management

#### Break Types
- [ ] Paid break (10-15 min)
- [ ] Unpaid meal break (30+ min)
- [ ] Custom break types
- [ ] Break compliance alerts

#### Break Tracking
- [ ] Start break (clock out to break)
- [ ] End break (clock back in)
- [ ] Break duration tracking
- [ ] Missed break alerts

### Shift Summary

#### End of Shift Report
- [ ] Hours worked
- [ ] Break time
- [ ] Tables served
- [ ] Sales total
- [ ] Tips declared
- [ ] Cash due
- [ ] Drawer variance

### Time Entry Management

#### Employee View
- [ ] View own time entries
- [ ] Request corrections
- [ ] View pay period hours

#### Manager Functions
- [ ] Edit time entries
- [ ] Approve corrections
- [ ] Add missed punches
- [ ] Delete duplicate entries
- [ ] Audit trail

### Scheduling Integration

#### Schedule Comparison
- [ ] Show scheduled vs actual
- [ ] Early/late alerts
- [ ] Approaching overtime
- [ ] Shift swap tracking

---

## UI/UX Specifications

### Clock In Screen

```
+------------------------------------------------------------------+
| EMPLOYEE TIME CLOCK                                               |
+------------------------------------------------------------------+
|                                                                   |
|                      Enter Your PIN                               |
|                                                                   |
|                    [ _ _ _ _ ]                                    |
|                                                                   |
|     [ 1 ]      [ 2 ]      [ 3 ]                                  |
|     [ 4 ]      [ 5 ]      [ 6 ]                                  |
|     [ 7 ]      [ 8 ]      [ 9 ]                                  |
|     [Clear]    [ 0 ]      [Enter]                                |
|                                                                   |
|                                                                   |
| Currently Clocked In: Sarah M., Mike T., John D.                 |
|                                                                   |
+------------------------------------------------------------------+
```

### Clock In Confirmation

```
+------------------------------------------------------------------+
| CLOCK IN - Sarah Martinez                                         |
+------------------------------------------------------------------+
|                                                                   |
| ✓ Identity Verified                                              |
|                                                                   |
| JOB CODE                                                          |
| (•) Server         $2.13/hr + tips                               |
| ( ) Bartender      $2.13/hr + tips                               |
| ( ) Host           $12.00/hr                                     |
|                                                                   |
| SCHEDULE                                                          |
| Scheduled: 4:00 PM - 10:00 PM                                    |
| Current Time: 3:52 PM                                            |
| ✓ Within clock-in window                                         |
|                                                                   |
| DRAWER ASSIGNMENT                                                 |
| [ ] Assign drawer now                                            |
|     Available: Drawer 3, Drawer 4                                |
|                                                                   |
| [Cancel]                                         [Clock In]       |
+------------------------------------------------------------------+
```

### Clock Out Screen

```
+------------------------------------------------------------------+
| CLOCK OUT - Sarah Martinez                                        |
+------------------------------------------------------------------+
|                                                                   |
| SHIFT SUMMARY                                                     |
| Clock In: 3:52 PM                                                |
| Current Time: 10:15 PM                                           |
| Total Hours: 6h 23m                                              |
|                                                                   |
| PRE-CHECKOUT VERIFICATION                                         |
| +--------------------------------------------------------------+ |
| | ✓ No open tables                                              | |
| | ✓ No open checks                                              | |
| | ⚠️ Cash tips not declared                                     | |
| | ⚠️ Side work not completed                                    | |
| +--------------------------------------------------------------+ |
|                                                                   |
| REQUIRED BEFORE CLOCK OUT:                                        |
|                                                                   |
| 1. DECLARE CASH TIPS                                              |
|    Cash Tips Received: $[________]                               |
|                                                                   |
| 2. COMPLETE SIDE WORK                                             |
|    [ ] Restock station                                           |
|    [ ] Clean section                                             |
|    [ ] Roll silverware (20 sets)                                |
|                                                                   |
| [Cancel]                    [Complete & Clock Out]               |
+------------------------------------------------------------------+
```

### Clock Out with Drawer

```
+------------------------------------------------------------------+
| CLOCK OUT - Mike Thompson (Bartender)                             |
+------------------------------------------------------------------+
|                                                                   |
| DRAWER #2 - CLOSE OUT REQUIRED                                    |
|                                                                   |
| Your drawer must be counted before clocking out.                 |
|                                                                   |
| COUNT TYPE                                                        |
| (•) Blind Count - I cannot see the expected amount               |
| ( ) Standard Count - Show me the expected amount                 |
|                                                                   |
| [Proceed to Drawer Count]                                        |
|                                                                   |
| ═══════════════════════════════════════════════════════════════  |
|                                                                   |
| Or, if another bartender is taking over:                         |
|                                                                   |
| [Transfer Drawer to Another Employee]                            |
|                                                                   |
+------------------------------------------------------------------+
```

### Shift Summary (End of Day)

```
+------------------------------------------------------------------+
| SHIFT COMPLETE - Sarah Martinez                    Jan 27, 2026   |
+------------------------------------------------------------------+
|                                                                   |
| HOURS                                                             |
| Clock In: 3:52 PM                                                |
| Clock Out: 10:18 PM                                              |
| Break: 30 min (unpaid)                                           |
| Total Worked: 5h 56m                                             |
|                                                                   |
| SALES                                                             |
| Tables Served: 12                                                |
| Total Sales: $847.50                                             |
| Average Check: $70.63                                            |
|                                                                   |
| TIPS                                                              |
| Credit Card Tips: $142.00                                        |
| Cash Tips Declared: $65.00                                       |
| Total Tips: $207.00                                              |
| Tip Rate: 24.4%                                                  |
|                                                                   |
| CASH DUE                                                          |
| Cash Sales: $125.00                                              |
| Tips Owed to Others: -$28.50                                     |
| Net Cash Due: $96.50                                             |
|                                                                   |
| [Print Summary]                              [Confirm & Exit]     |
+------------------------------------------------------------------+
```

### Manager Time Edit

```
+------------------------------------------------------------------+
| EDIT TIME ENTRY                                                   |
+------------------------------------------------------------------+
|                                                                   |
| Employee: Sarah Martinez                                          |
| Date: January 27, 2026                                           |
|                                                                   |
| ORIGINAL ENTRY                                                    |
| Clock In: 3:52 PM                                                |
| Clock Out: 10:18 PM                                              |
| Total: 6h 26m (5h 56m worked + 30m break)                       |
|                                                                   |
| EDIT ENTRY                                                        |
| Clock In: [3:52 PM___]                                           |
| Clock Out: [10:30 PM__]  ← Changed from 10:18 PM                |
| Break: [30] minutes                                              |
| Total: 6h 38m (6h 8m worked + 30m break)                        |
|                                                                   |
| Reason for Edit: [Forgot to clock out, verified end time_______] |
|                                                                   |
| [Cancel]                                      [Save with Reason]  |
+------------------------------------------------------------------+
```

---

## Data Model

### Time Entries
```sql
time_entries {
  id: UUID PRIMARY KEY
  employee_id: UUID (FK)
  location_id: UUID (FK)

  -- Job
  job_code_id: UUID (FK, nullable)

  -- Times
  clock_in: TIMESTAMP
  clock_out: TIMESTAMP (nullable)

  -- Breaks
  break_start: TIMESTAMP (nullable)
  break_end: TIMESTAMP (nullable)
  break_minutes: INTEGER DEFAULT 0
  break_paid: BOOLEAN DEFAULT false

  -- Calculated
  hours_worked: DECIMAL(5,2) (nullable)
  regular_hours: DECIMAL(5,2) (nullable)
  overtime_hours: DECIMAL(5,2) (nullable)

  -- Tips
  cash_tips_declared: DECIMAL(10,2) DEFAULT 0
  credit_tips: DECIMAL(10,2) DEFAULT 0

  -- Status
  status: VARCHAR(50) (active, completed, edited)

  -- Audit
  edited: BOOLEAN DEFAULT false
  edited_by: UUID (FK, nullable)
  edited_at: TIMESTAMP (nullable)
  edit_reason: TEXT (nullable)
  original_data: JSONB (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Clock Events
```sql
clock_events {
  id: UUID PRIMARY KEY
  time_entry_id: UUID (FK)
  employee_id: UUID (FK)
  location_id: UUID (FK)

  event_type: VARCHAR(50) (clock_in, clock_out, break_start, break_end)
  event_time: TIMESTAMP

  -- Context
  terminal_id: UUID (FK, nullable)
  ip_address: VARCHAR(45) (nullable)
  photo_url: VARCHAR(500) (nullable)

  -- Manager actions
  is_manual_entry: BOOLEAN DEFAULT false
  entered_by: UUID (FK, nullable)

  created_at: TIMESTAMP
}
```

### Time Clock Settings
```sql
time_clock_settings {
  location_id: UUID PRIMARY KEY (FK)

  -- Clock in rules
  early_clock_in_minutes: INTEGER DEFAULT 10
  require_job_code: BOOLEAN DEFAULT true
  capture_photo: BOOLEAN DEFAULT false

  -- Clock out rules
  require_tables_settled: BOOLEAN DEFAULT true
  require_drawer_count: BOOLEAN DEFAULT true
  require_tip_declaration: BOOLEAN DEFAULT true
  default_blind_count: BOOLEAN DEFAULT false

  -- Breaks
  auto_deduct_break: BOOLEAN DEFAULT false
  auto_deduct_after_hours: DECIMAL(3,1) DEFAULT 6.0
  auto_deduct_minutes: INTEGER DEFAULT 30

  -- Overtime
  overtime_after_hours: DECIMAL(3,1) DEFAULT 40.0
  overtime_daily_after: DECIMAL(3,1) (nullable)

  updated_at: TIMESTAMP
}
```

### Side Work Tasks
```sql
clock_out_tasks {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  task_name: VARCHAR(200)
  description: TEXT (nullable)

  applies_to_roles: UUID[] -- Role IDs
  is_required: BOOLEAN DEFAULT false

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Clock Out Task Completion
```sql
clock_out_task_completions {
  id: UUID PRIMARY KEY
  time_entry_id: UUID (FK)
  task_id: UUID (FK)

  completed: BOOLEAN DEFAULT false
  completed_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Clock Operations
```
POST   /api/clock/in
POST   /api/clock/out
POST   /api/clock/break/start
POST   /api/clock/break/end
GET    /api/clock/status/{employee_id}
GET    /api/clock/active
```

### Time Entries
```
GET    /api/time-entries
GET    /api/time-entries/{id}
PUT    /api/time-entries/{id}
DELETE /api/time-entries/{id}
POST   /api/time-entries/manual
GET    /api/time-entries/employee/{id}
```

### Clock Out Verification
```
GET    /api/clock/checkout-requirements/{employee_id}
POST   /api/clock/declare-tips
POST   /api/clock/complete-tasks
```

### Reporting
```
GET    /api/time-entries/report
GET    /api/time-entries/payroll-export
GET    /api/time-entries/overtime-report
```

---

## Business Rules

1. **Clock In Window:** Can only clock in within X minutes of scheduled shift
2. **Clock Out Requirements:** Must complete all required tasks before clocking out
3. **Drawer Handoff:** Drawer must be counted or transferred before clock out
4. **Break Compliance:** Alert if breaks not taken per labor law
5. **Overtime Alerts:** Notify approaching overtime threshold
6. **Edit Audit:** All edits require reason and are logged

---

## Permissions

| Action | Employee | Manager | Admin |
|--------|----------|---------|-------|
| Clock self in/out | Yes | Yes | Yes |
| View own time | Yes | Yes | Yes |
| View others' time | No | Yes | Yes |
| Edit own time | No | No | No |
| Edit others' time | No | Yes | Yes |
| Add manual entry | No | Yes | Yes |
| Delete entry | No | Yes | Yes |
| Configure settings | No | No | Yes |
| Export payroll | No | Yes | Yes |

---

## Configuration Options

```yaml
time_clock:
  clock_in:
    early_minutes_allowed: 10
    require_job_code: true
    capture_photo: false
    assign_drawer_prompt: true

  clock_out:
    require_tables_settled: true
    require_drawer_count: true
    require_tip_declaration: true
    require_sidework: true
    blind_count_default: true

  breaks:
    track_breaks: true
    auto_deduct: false
    auto_deduct_after_hours: 6.0
    auto_deduct_minutes: 30
    paid_break_minutes: 10
    unpaid_break_minutes: 30

  overtime:
    weekly_threshold: 40
    daily_threshold: null  # or 8 for CA
    alert_at_hours: 38

  compliance:
    minor_restrictions: true
    max_consecutive_days: 6
    required_rest_hours: 8
```

---

## Integrations

- **05-Employees-Roles:** Employee records and permissions
- **37-Drawer-Management:** Drawer count at clock out
- **04-Order-Management:** Check for open orders/tables
- **06-Tipping:** Tip declaration and pooling

---

*Last Updated: January 27, 2026*
