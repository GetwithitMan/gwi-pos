# 08 - Reporting

**Status:** Planning
**Priority:** Medium
**Dependencies:** All other skills (aggregates data)

---

## Overview

The Reporting skill aggregates data from all other skills to provide comprehensive analytics and insights. This includes real-time dashboards, historical reports, and export capabilities for external analysis.

**Primary Goal:** Provide actionable insights through clear, comprehensive reporting that helps operators make better business decisions.

---

## User Stories

### As a Manager...
- I want to see today's sales at a glance
- I want to compare performance to previous periods
- I want to identify my best-selling items
- I want to track labor costs vs sales

### As an Owner...
- I want to see overall business health
- I want to track trends over time
- I want to export data for accountants
- I want to set and track goals

### As a Shift Lead...
- I want to see current shift performance
- I want to know who's performing well
- I want to track ticket times

---

## Features

### Real-Time Dashboard

#### Today's Overview
- [ ] Total sales (vs same day last week)
- [ ] Net sales (after discounts/comps)
- [ ] Order count
- [ ] Average check size
- [ ] Current open checks
- [ ] Guests served
- [ ] Labor percentage

#### Live Activity
- [ ] Orders per hour graph
- [ ] Current table status
- [ ] Kitchen ticket times
- [ ] Open orders list

### Sales Reports

#### Daily Sales
- [ ] Gross sales
- [ ] Net sales
- [ ] Discounts
- [ ] Comps
- [ ] Voids
- [ ] Refunds
- [ ] Tax collected
- [ ] Tips collected

#### Sales by Period
- [ ] Daily
- [ ] Weekly
- [ ] Monthly
- [ ] Custom range
- [ ] Year-over-year comparison

#### Sales Breakdown
- [ ] By hour/daypart
- [ ] By order type (dine-in, takeout, etc.)
- [ ] By category
- [ ] By revenue center (food, bar, etc.)
- [ ] By server
- [ ] By table/section

### Product Reports

#### Product Mix
- [ ] Items sold (quantity and revenue)
- [ ] Percentage of sales
- [ ] Ranking by quantity
- [ ] Ranking by revenue
- [ ] Ranking by profit margin

#### Modifier Report
- [ ] Modifier usage frequency
- [ ] Modifier revenue
- [ ] Popular combinations

#### Category Performance
- [ ] Sales by category
- [ ] Category mix percentage
- [ ] Category trends

#### 86 Report
- [ ] Items 86'd and duration
- [ ] Estimated lost sales
- [ ] 86 frequency by item

### Labor Reports

#### Labor Summary
- [ ] Total labor hours
- [ ] Total labor cost
- [ ] Labor as % of sales
- [ ] Overtime hours
- [ ] Overtime cost

#### By Employee
- [ ] Hours worked
- [ ] Pay earned (if integrated)
- [ ] Sales generated
- [ ] Tips earned
- [ ] Average check
- [ ] Items sold

#### Timecard Report
- [ ] Clock in/out times
- [ ] Break times
- [ ] Exceptions/edits
- [ ] Approval status

#### Scheduling Compliance
- [ ] Scheduled vs actual hours
- [ ] Early/late clock-ins
- [ ] Missed shifts

### Payment Reports

#### Payment Summary
- [ ] Total by payment type
- [ ] Credit card fees (estimated)
- [ ] Cash collected
- [ ] Gift cards redeemed/sold

#### Tip Report
- [ ] Tips by employee
- [ ] Tips by payment type
- [ ] Tip percentage average
- [ ] Pool distributions

#### Cash Management
- [ ] Drawer opens/closes
- [ ] Over/short by drawer
- [ ] Cash drops
- [ ] Paid outs

### Operational Reports

#### Table Turn
- [ ] Average turn time
- [ ] Turns by table
- [ ] Turns by server
- [ ] Peak time analysis

#### Ticket Times
- [ ] Average ticket time
- [ ] By daypart
- [ ] By item category
- [ ] Long ticket alerts

#### Discount/Comp Report
- [ ] Discounts by type
- [ ] Discounts by employee
- [ ] Comp reasons
- [ ] Manager approvals

#### Void Report
- [ ] Voids by item
- [ ] Voids by employee
- [ ] Void reasons
- [ ] Pre-send vs post-send

### Financial Reports

#### Daily Summary
- [ ] Complete P&L snapshot
- [ ] Revenue, costs, labor
- [ ] Comparison to budget

#### Sales Tax
- [ ] Tax collected by rate
- [ ] Tax exempt sales
- [ ] Export for filing

#### Accounting Export
- [ ] Journal entries format
- [ ] QuickBooks compatible
- [ ] Custom mapping

### Custom Reports

#### Report Builder
- [ ] Select data fields
- [ ] Apply filters
- [ ] Choose grouping
- [ ] Save as template

#### Scheduled Reports
- [ ] Daily email
- [ ] Weekly summary
- [ ] Monthly report
- [ ] Custom schedule

---

## UI/UX Specifications

### Dashboard

```
+------------------------------------------------------------------+
| DASHBOARD                                   Jan 27, 2026  4:45 PM |
+------------------------------------------------------------------+
| TODAY'S SALES              | vs Last Week                        |
| ┌──────────────────────┐   | ┌─────────────────────────────────┐ |
| │     $4,523.67        │   | │ ████████████████░░░░  +12.3%    │ |
| │     Net Sales        │   | │ Last Week: $4,027.12            │ |
| └──────────────────────┘   | └─────────────────────────────────┘ |
+------------------------------------------------------------------+
| QUICK STATS                                                      |
| ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐     |
| │    127     │ │   $35.62   │ │    342     │ │   18.2%    │     |
| │   Orders   │ │  Avg Check │ │   Guests   │ │  Labor %   │     |
| │   +8 vs LW │ │  +$2.15    │ │   +23      │ │  Target:20%│     |
| └────────────┘ └────────────┘ └────────────┘ └────────────┘     |
+------------------------------------------------------------------+
| HOURLY SALES                                                     |
| $800 │                          ██                               |
| $600 │                       █████                               |
| $400 │                    ████████                               |
| $200 │    ████         ███████████                               |
| $0   │ ███████████████████████████                               |
|      └─────────────────────────────────────────────────          |
|       11  12   1   2   3   4   5   6   7   8   9  10  11         |
+------------------------------------------------------------------+
| OPEN ORDERS: 12         | TOP ITEMS TODAY                        |
| ┌─────────────────────┐ | 1. Cheeseburger (45)                   |
| │ Table 5 - $156 0:45 │ | 2. Wings (38)                          |
| │ Table 8 - $89  0:32 │ | 3. Caesar Salad (32)                   |
| │ Tab: Johnson $67    │ | 4. Draft IPA (28)                      |
| │ ...                 │ | 5. Fish Tacos (24)                     |
| └─────────────────────┘ |                                        |
+------------------------------------------------------------------+
```

### Sales Report

```
+------------------------------------------------------------------+
| SALES REPORT                                                     |
+------------------------------------------------------------------+
| Period: [Today ▼]  Compare: [Last Week ▼]       [Export] [Print] |
+------------------------------------------------------------------+
|                                   Today      Last Week   Change  |
| ─────────────────────────────────────────────────────────────── |
| Gross Sales                    $5,234.56    $4,678.90   +11.9%  |
| Discounts                        -$156.78     -$123.45   +27.0%  |
| Comps                             -$45.00      -$67.89   -33.7%  |
| ─────────────────────────────────────────────────────────────── |
| Net Sales                      $5,032.78    $4,487.56   +12.2%  |
| ─────────────────────────────────────────────────────────────── |
| Tax Collected                    $403.62      $359.00   +12.4%  |
| Tips Collected                 $1,006.56      $897.51   +12.1%  |
| ─────────────────────────────────────────────────────────────── |
| Total Collected                $6,442.96    $5,744.07   +12.2%  |
+------------------------------------------------------------------+
| BREAKDOWN BY CATEGORY                                            |
| ┌───────────────────────────────────────────────────────────┐   |
| │ Food        ████████████████████████████░░░░  $3,521 (70%)│   |
| │ Beer        █████████░░░░░░░░░░░░░░░░░░░░░░░   $754 (15%) │   |
| │ Wine        ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░   $352 (7%)  │   |
| │ Cocktails   ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   $281 (6%)  │   |
| │ Non-Alc     █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   $125 (2%)  │   |
| └───────────────────────────────────────────────────────────┘   |
+------------------------------------------------------------------+
```

### Product Mix Report

```
+------------------------------------------------------------------+
| PRODUCT MIX                                    Jan 27, 2026      |
+------------------------------------------------------------------+
| Category: [All ▼]     Sort: [Revenue ▼]          [Export]        |
+------------------------------------------------------------------+
| RANK | ITEM              | QTY  | REVENUE  | % SALES | MARGIN   |
+------------------------------------------------------------------+
|  1   | Ribeye Steak      |  23  | $667.77  |  13.3%  | 72%      |
|  2   | Cheeseburger      |  45  | $674.55  |  13.4%  | 77%      |
|  3   | Fish Tacos        |  24  | $407.76  |   8.1%  | 68%      |
|  4   | Wings (Large)     |  28  | $531.72  |  10.6%  | 65%      |
|  5   | Caesar Salad      |  32  | $287.68  |   5.7%  | 82%      |
|  6   | Draft IPA         |  28  | $196.00  |   3.9%  | 78%      |
|  7   | House Margarita   |  19  | $209.00  |   4.2%  | 75%      |
|  8   | Salmon            |  15  | $359.85  |   7.2%  | 70%      |
|  ...                                                            |
+------------------------------------------------------------------+
| Showing 1-20 of 156 items                    [1] [2] [3] ... [8] |
+------------------------------------------------------------------+
```

---

## Data Model

Reports primarily query data from other skills. Some aggregation tables for performance:

### Daily Sales Summary (Aggregated)
```sql
daily_sales_summary {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  business_date: DATE

  -- Counts
  order_count: INTEGER
  guest_count: INTEGER

  -- Sales
  gross_sales: DECIMAL(12,2)
  discount_total: DECIMAL(10,2)
  comp_total: DECIMAL(10,2)
  void_total: DECIMAL(10,2)
  refund_total: DECIMAL(10,2)
  net_sales: DECIMAL(12,2)

  -- Payments
  cash_collected: DECIMAL(12,2)
  card_collected: DECIMAL(12,2)
  gift_card_collected: DECIMAL(10,2)
  other_collected: DECIMAL(10,2)

  -- Tips
  tip_total: DECIMAL(10,2)

  -- Tax
  tax_collected: DECIMAL(10,2)

  -- Labor
  labor_hours: DECIMAL(8,2)
  labor_cost: DECIMAL(10,2)

  -- Averages
  average_check: DECIMAL(8,2)
  average_turn_time: INTEGER (minutes)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP

  UNIQUE (location_id, business_date)
}
```

### Hourly Sales
```sql
hourly_sales {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  business_date: DATE
  hour: INTEGER (0-23)

  order_count: INTEGER
  guest_count: INTEGER
  net_sales: DECIMAL(10,2)

  created_at: TIMESTAMP

  UNIQUE (location_id, business_date, hour)
}
```

### Product Sales
```sql
product_daily_sales {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  menu_item_id: UUID (FK)
  business_date: DATE

  quantity_sold: INTEGER
  gross_sales: DECIMAL(10,2)
  discount_amount: DECIMAL(10,2)
  net_sales: DECIMAL(10,2)

  created_at: TIMESTAMP

  UNIQUE (location_id, menu_item_id, business_date)
}
```

### Saved Reports
```sql
saved_reports {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  created_by: UUID (FK)

  name: VARCHAR(100)
  report_type: VARCHAR(50)
  configuration: JSONB -- Filters, groupings, etc.

  is_scheduled: BOOLEAN DEFAULT false
  schedule_frequency: VARCHAR(50) (nullable)
  schedule_time: TIME (nullable)
  email_recipients: VARCHAR[] (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Dashboard
```
GET    /api/dashboard
GET    /api/dashboard/live-stats
WS     /ws/dashboard/{location_id}
```

### Sales Reports
```
GET    /api/reports/sales/summary
GET    /api/reports/sales/by-hour
GET    /api/reports/sales/by-category
GET    /api/reports/sales/by-server
GET    /api/reports/sales/by-order-type
GET    /api/reports/sales/comparison
```

### Product Reports
```
GET    /api/reports/products/mix
GET    /api/reports/products/modifiers
GET    /api/reports/products/categories
GET    /api/reports/products/86-history
```

### Labor Reports
```
GET    /api/reports/labor/summary
GET    /api/reports/labor/by-employee
GET    /api/reports/labor/timecards
GET    /api/reports/labor/overtime
```

### Payment Reports
```
GET    /api/reports/payments/summary
GET    /api/reports/payments/tips
GET    /api/reports/payments/cash
GET    /api/reports/payments/cards
```

### Operational Reports
```
GET    /api/reports/operations/table-turns
GET    /api/reports/operations/ticket-times
GET    /api/reports/operations/discounts
GET    /api/reports/operations/voids
```

### Custom & Export
```
POST   /api/reports/custom
GET    /api/reports/saved
POST   /api/reports/saved
DELETE /api/reports/saved/{id}
GET    /api/reports/export?type={type}&format={format}
```

---

## Business Rules

1. **Business Date:** Use business date (may differ from calendar date for late-night)
2. **Comparison Periods:** Same day last week is default comparison
3. **Real-Time:** Dashboard updates every 30 seconds
4. **Data Retention:** Keep detailed data for 2 years, summaries indefinitely
5. **Export Formats:** Support CSV, Excel, PDF
6. **Scheduled Reports:** Run at end of business day

---

## Permissions

| Action | Server | Shift Lead | Manager | Admin |
|--------|--------|------------|---------|-------|
| View dashboard | Limited | Yes | Yes | Yes |
| View own stats | Yes | Yes | Yes | Yes |
| View all stats | No | Limited | Yes | Yes |
| View sales reports | No | No | Yes | Yes |
| View labor reports | No | No | Yes | Yes |
| View financial | No | No | Config | Yes |
| Export data | No | No | Yes | Yes |
| Create saved reports | No | No | Yes | Yes |

---

## Configuration Options

```yaml
reporting:
  dashboard:
    refresh_interval_seconds: 30
    default_comparison: "last_week"  # or "last_month", "last_year"

  business_day:
    end_time: "04:00"  # 4 AM - for late night operations

  retention:
    detailed_data_days: 730  # 2 years
    summary_data_years: 10

  exports:
    formats: ["csv", "xlsx", "pdf"]
    max_rows: 100000

  scheduled_reports:
    enabled: true
    default_send_time: "06:00"
```

---

## Open Questions

1. **Real-Time Frequency:** How often should dashboard refresh?

2. **Comparison Options:** What comparison periods are most useful?

3. **Goal Setting:** Include goal/budget tracking in reports?

4. **External BI:** Export to external BI tools (Tableau, Power BI)?

5. **Mobile Reports:** Simplified mobile reporting view?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Report specifications detailed
- [ ] Dashboard mockups

### Development
- [ ] Dashboard
- [ ] Sales reports
- [ ] Product reports
- [ ] Labor reports
- [ ] Payment reports
- [ ] Export functionality
- [ ] Scheduled reports
- [ ] Custom report builder

---

*Last Updated: January 27, 2026*
