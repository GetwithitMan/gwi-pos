# 20 - Loss Tracking

**Status:** Planning
**Priority:** Medium
**Dependencies:** 07-Inventory, 19-Voids, 18-Discounts

---

## Overview

The Loss Tracking skill provides comprehensive monitoring of all revenue and inventory losses - voids, comps, waste, theft, cash shortages, and shrinkage. Aggregates data from multiple skills to provide a complete loss picture.

**Primary Goal:** Identify, quantify, and help reduce all forms of loss to improve profitability.

---

## User Stories

### As an Owner...
- I want to see total losses across all categories
- I want to identify loss trends and patterns
- I want to compare losses to industry benchmarks
- I want actionable insights to reduce losses

### As a Manager...
- I want daily loss summaries
- I want alerts for unusual loss events
- I want to investigate specific loss incidents
- I want to track loss reduction over time

### As an Accountant...
- I want accurate loss data for financial reporting
- I want categorized losses for tax purposes
- I want exportable reports

---

## Features

### Loss Categories

#### Voids
- [ ] Pre-send voids
- [ ] Post-send voids
- [ ] Order cancellations
- [ ] By employee
- [ ] By reason

#### Comps
- [ ] Manager comps
- [ ] Service recovery
- [ ] Staff meals
- [ ] Promotional giveaways

#### Discounts
- [ ] Excessive discounting
- [ ] Unauthorized discounts
- [ ] Over-discount patterns

#### Waste
- [ ] Kitchen waste
- [ ] Spoilage
- [ ] Spills
- [ ] Expired products
- [ ] Preparation errors

#### Cash Shortages
- [ ] Drawer over/short
- [ ] Unaccounted cash
- [ ] Cash handling errors

#### Inventory Shrinkage
- [ ] Unexplained inventory loss
- [ ] Theft (suspected)
- [ ] Receiving errors
- [ ] Count variances

#### Walk-Outs
- [ ] Customers leaving without paying
- [ ] Dine and dash
- [ ] Tab abandonment

### Loss Dashboard

#### Summary View
- [ ] Total loss today/week/month
- [ ] Loss by category
- [ ] Loss as % of sales
- [ ] Trend comparison

#### Detail Views
- [ ] Drill down by category
- [ ] Drill down by employee
- [ ] Drill down by item
- [ ] Drill down by time

### Waste Recording

#### Recording Interface
- [ ] Quick waste entry
- [ ] Item selection
- [ ] Quantity
- [ ] Reason
- [ ] Photo capture (optional)

#### Waste Reasons
```yaml
waste_reasons:
  kitchen:
    - "Overcooked/burned"
    - "Dropped"
    - "Wrong order prepared"
    - "Quality issue"
    - "Expired/spoiled"

  bar:
    - "Spill"
    - "Wrong drink made"
    - "Returned - quality"
    - "Broken glass"

  storage:
    - "Expired"
    - "Spoiled"
    - "Damaged packaging"
    - "Temperature issue"
```

### Pattern Detection

#### Anomaly Alerts
- [ ] Unusual void patterns
- [ ] Excessive discounting
- [ ] High waste by employee
- [ ] Cash shortage patterns

#### Benchmarking
- [ ] Compare to historical averages
- [ ] Compare to industry standards
- [ ] Target setting

### Investigation Tools

#### Audit Trail
- [ ] Complete history of events
- [ ] Filter by date/employee/type
- [ ] Link related events
- [ ] Export for investigation

#### Correlation Analysis
- [ ] Link voids to specific employees
- [ ] Link shrinkage to schedules
- [ ] Identify suspicious patterns

---

## UI/UX Specifications

### Loss Dashboard

```
+------------------------------------------------------------------+
| LOSS TRACKING                                    Jan 27, 2026    |
+------------------------------------------------------------------+
| TOTAL LOSS TODAY: $456.78 (2.1% of sales)                       |
+------------------------------------------------------------------+
|                                                                  |
| LOSS BREAKDOWN                                                   |
| +-------------+ +-------------+ +-------------+ +-------------+  |
| |   VOIDS     | |   COMPS     | |   WASTE     | |   CASH      |  |
| |  $234.67    | |   $89.00    | |   $98.11    | |  -$35.00    |  |
| |   18 items  | |    6 items  | |   12 items  | |  2 drawers  |  |
| | [Details]   | | [Details]   | | [Details]   | | [Details]   |  |
| +-------------+ +-------------+ +-------------+ +-------------+  |
|                                                                  |
| TRENDS (Last 7 Days)                                            |
| Loss $│    ╭─╮                                                  |
|  600  │   ╱  ╲    ╭╮                                            |
|  400  │──╱────╲──╱──╲──────────────────────────────            |
|  200  │ ╱      ╲╱    ╲╱╲                                        |
|    0  │                  ╲___                                   |
|       └─────────────────────────                                |
|        Mon Tue Wed Thu Fri Sat Sun                              |
|                                                                  |
| ⚠️ ALERTS                                                        |
| • Post-send voids up 45% vs last week                           |
| • Cash drawer #2 short 3 days in a row                          |
| • "Ribeye" waste unusually high today                           |
+------------------------------------------------------------------+
```

### Waste Entry

```
+------------------------------------------------------------------+
| RECORD WASTE                                          [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| ITEM: [Search item...________________] [Recent ▼]               |
|                                                                  |
| Selected: Ribeye Steak                                          |
| Cost: $12.50                                                    |
|                                                                  |
| QUANTITY: [1___]                                                |
|                                                                  |
| REASON:                                                          |
| ( ) Overcooked/burned                                            |
| (•) Dropped                                                      |
| ( ) Wrong order prepared                                         |
| ( ) Quality issue                                                |
| ( ) Other: [_________________________]                           |
|                                                                  |
| NOTES (optional):                                                |
| [Slipped off plate during plating_______________]               |
|                                                                  |
| 📷 [Add Photo]                                                  |
|                                                                  |
| [Cancel]                                    [Record Waste]       |
+------------------------------------------------------------------+
```

### Loss Investigation

```
+------------------------------------------------------------------+
| LOSS INVESTIGATION                                               |
+------------------------------------------------------------------+
| Filter: [Employee ▼] [Last 7 Days ▼] [Voids ▼]       [Export]   |
+------------------------------------------------------------------+
|                                                                  |
| Showing voids by employee (Jan 21-27, 2026)                     |
|                                                                  |
| EMPLOYEE        | COUNT | AMOUNT  | % OF SALES | AVG/SHIFT      |
| Sarah M.        |  12   | $234.50 |   4.2%     | $39.08         |
| Mike J.         |   8   | $156.00 |   2.8%     | $26.00         |
| Lisa G.         |   5   |  $89.00 |   1.5%     | $17.80         |
| Tom B.          |   3   |  $45.00 |   0.8%     | $15.00         |
|                                                                  |
| ⚠️ Sarah M. void rate is 2x team average                         |
|                                                                  |
| [View Sarah M. Details]                                          |
+------------------------------------------------------------------+
| SARAH M. - VOID DETAILS                                          |
| +-----------------------------------------------------------+   |
| | Date    | Item           | Amount  | Reason    | Approved |   |
| | Jan 27  | Ribeye         | $34.99  | Quality   | Yes      |   |
| | Jan 27  | Wings          | $12.99  | Changed   | No appr. |   |
| | Jan 26  | Salmon         | $28.99  | Quality   | Yes      |   |
| | Jan 26  | 2x IPA         | $14.00  | Wrong     | No appr. |   |
| | ...                                                        |   |
| +-----------------------------------------------------------+   |
+------------------------------------------------------------------+
```

---

## Data Model

### Loss Summary (Aggregated Daily)
```sql
daily_loss_summary {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  business_date: DATE

  -- Voids
  void_count: INTEGER DEFAULT 0
  void_amount: DECIMAL(10,2) DEFAULT 0
  void_pre_send_amount: DECIMAL(10,2) DEFAULT 0
  void_post_send_amount: DECIMAL(10,2) DEFAULT 0

  -- Comps
  comp_count: INTEGER DEFAULT 0
  comp_amount: DECIMAL(10,2) DEFAULT 0

  -- Discounts (excessive only?)
  discount_amount: DECIMAL(10,2) DEFAULT 0

  -- Waste
  waste_count: INTEGER DEFAULT 0
  waste_amount: DECIMAL(10,2) DEFAULT 0

  -- Cash
  cash_over_short: DECIMAL(10,2) DEFAULT 0

  -- Walk-outs
  walkout_count: INTEGER DEFAULT 0
  walkout_amount: DECIMAL(10,2) DEFAULT 0

  -- Total
  total_loss: DECIMAL(10,2) DEFAULT 0

  -- Context
  gross_sales: DECIMAL(12,2)
  loss_percent: DECIMAL(5,2)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP

  UNIQUE (location_id, business_date)
}
```

### Waste Records
```sql
waste_records {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- What
  inventory_item_id: UUID (FK, nullable)
  menu_item_id: UUID (FK, nullable)
  item_name: VARCHAR(200)
  quantity: DECIMAL(10,3)
  unit_cost: DECIMAL(10,4)
  total_cost: DECIMAL(10,2)

  -- Why
  waste_reason_id: UUID (FK)
  reason_text: VARCHAR(200)
  notes: TEXT (nullable)

  -- Evidence
  photo_url: VARCHAR(500) (nullable)

  -- Who
  recorded_by: UUID (FK)
  recorded_at: TIMESTAMP

  -- Approval (if required)
  requires_approval: BOOLEAN DEFAULT false
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

### Waste Reasons
```sql
waste_reasons {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  category: VARCHAR(50) (kitchen, bar, storage, general)
  reason_text: VARCHAR(200)
  requires_notes: BOOLEAN DEFAULT false
  requires_photo: BOOLEAN DEFAULT false
  requires_approval: BOOLEAN DEFAULT false

  is_active: BOOLEAN DEFAULT true
  sort_order: INTEGER

  created_at: TIMESTAMP
}
```

### Walk-Outs
```sql
walkout_records {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  order_id: UUID (FK)
  amount: DECIMAL(10,2)

  -- Details
  table_id: UUID (FK, nullable)
  server_id: UUID (FK)
  description: TEXT (nullable)

  -- Resolution
  recovered: BOOLEAN DEFAULT false
  recovered_amount: DECIMAL(10,2) (nullable)
  recovery_notes: TEXT (nullable)

  recorded_at: TIMESTAMP
  created_at: TIMESTAMP
}
```

### Loss Alerts
```sql
loss_alerts {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  alert_type: VARCHAR(50) (void_spike, cash_short, waste_high, pattern)
  severity: VARCHAR(20) (info, warning, critical)

  title: VARCHAR(200)
  description: TEXT
  data: JSONB -- Alert-specific data

  -- Status
  is_read: BOOLEAN DEFAULT false
  is_resolved: BOOLEAN DEFAULT false
  resolved_by: UUID (FK, nullable)
  resolution_notes: TEXT (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Dashboard
```
GET    /api/loss/dashboard
GET    /api/loss/summary?period={period}
GET    /api/loss/trends
```

### Waste
```
POST   /api/loss/waste
GET    /api/loss/waste
GET    /api/loss/waste/{id}
PUT    /api/loss/waste/{id}
```

### Walk-Outs
```
POST   /api/loss/walkouts
GET    /api/loss/walkouts
PUT    /api/loss/walkouts/{id}
```

### Investigation
```
GET    /api/loss/by-employee
GET    /api/loss/by-item
GET    /api/loss/by-category
GET    /api/loss/patterns
```

### Alerts
```
GET    /api/loss/alerts
PUT    /api/loss/alerts/{id}/read
PUT    /api/loss/alerts/{id}/resolve
```

### Reporting
```
GET    /api/reports/loss/summary
GET    /api/reports/loss/detailed
GET    /api/reports/loss/export
```

---

## Business Rules

1. **Aggregation:** Loss data aggregated from voids, comps, waste, cash
2. **Real-Time:** Dashboard updates in real-time
3. **Alerts:** Automatic alerts for anomalies
4. **Attribution:** All losses attributed to responsible employee
5. **No Deletion:** Loss records cannot be deleted (audit requirement)

---

## Permissions

| Action | Server | Kitchen | Manager | Admin |
|--------|--------|---------|---------|-------|
| Record waste | Limited | Yes | Yes | Yes |
| View own losses | Yes | Yes | Yes | Yes |
| View all losses | No | No | Yes | Yes |
| Investigate | No | No | Yes | Yes |
| Configure alerts | No | No | Yes | Yes |
| Export reports | No | No | Yes | Yes |

---

## Configuration Options

```yaml
loss_tracking:
  aggregation:
    include_voids: true
    include_comps: true
    include_discounts: false  # Or only excessive
    include_waste: true
    include_cash: true

  alerts:
    enabled: true
    void_spike_threshold: 150  # % of normal
    cash_short_threshold: 10.00
    waste_daily_threshold: 200.00

  waste:
    require_photo_above: 50.00
    require_approval_above: 100.00

  targets:
    total_loss_percent: 3.0
    void_percent: 1.5
    waste_percent: 1.0
```

---

## Open Questions

1. **Discount Inclusion:** Include all discounts or only "excessive"?

2. **Theft Tracking:** Explicit theft category or infer from patterns?

3. **Benchmarks:** Industry benchmarks by restaurant type?

4. **Gamification:** Loss reduction incentives/competitions?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Alert thresholds defined
- [ ] Integration points mapped

### Development
- [ ] Dashboard
- [ ] Waste recording
- [ ] Walk-out tracking
- [ ] Aggregation engine
- [ ] Alert system
- [ ] Investigation tools
- [ ] Reporting

---

*Last Updated: January 27, 2026*
