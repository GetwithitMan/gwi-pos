# 22 - Live Dashboard

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 05-Employees-Roles, 08-Reporting

---

## Overview

The Live Dashboard skill provides real-time operational visibility - sales as they happen, labor costs, table status, kitchen performance, and key metrics at a glance. Designed for always-on display in offices or for quick mobile checks.

**Primary Goal:** Provide instant visibility into current operations to enable faster decision-making.

---

## User Stories

### As an Owner...
- I want to see today's sales from anywhere
- I want to know if we're on track compared to last week
- I want instant alerts if something needs attention
- I want a TV display I can glance at

### As a Manager...
- I want to see current labor percentage
- I want to see all open tables and tickets
- I want alerts for long ticket times
- I want to know if we're getting busy

### As a Shift Lead...
- I want to see kitchen performance
- I want to identify bottlenecks
- I want server performance overview

---

## Features

### Dashboard Widgets

#### Sales Widget
- [ ] Today's net sales (live counter)
- [ ] Comparison to same day last week
- [ ] Hourly sales graph
- [ ] Goal progress (if set)

#### Orders Widget
- [ ] Open orders count
- [ ] Orders this hour
- [ ] Average check size
- [ ] Items sold counter

#### Labor Widget
- [ ] Current labor cost
- [ ] Labor % of sales
- [ ] Staff on clock
- [ ] Overtime alert

#### Guests Widget
- [ ] Current seated guests
- [ ] Guests today
- [ ] Available tables
- [ ] Reservation upcoming

#### Kitchen Widget
- [ ] Open tickets
- [ ] Average ticket time
- [ ] Oldest ticket alert
- [ ] Items in queue

#### Table Status Widget
- [ ] Mini floor plan
- [ ] Color-coded status
- [ ] Turn times
- [ ] Needs attention flags

#### Bar Widget
- [ ] Open tabs count
- [ ] Tab total
- [ ] Tabs at warning time
- [ ] Quick tab list

#### Alerts Widget
- [ ] Active alerts
- [ ] Pending approvals
- [ ] System notifications

### Dashboard Layouts

#### Full Dashboard (TV/Desktop)
```
+------------------------------------------------------------------+
|                     GWI POS LIVE DASHBOARD                       |
+------------------------------------------------------------------+
|  SALES TODAY        |  LABOR           |  GUESTS                 |
|  $4,523.67          |  $456.78         |  47 Seated              |
|  +12.3% vs LW       |  18.2% of sales  |  142 Today              |
|  ███████████░ 85%   |  Target: 20%     |  8 Tables Open          |
+------------------------------------------------------------------+
|  ORDERS             |  KITCHEN         |  ALERTS                 |
|  12 Open            |  8 Tickets       |  ⚠️ Table 5: 45 min     |
|  127 Today          |  Avg: 12 min     |  ⚠️ Void pending        |
|  $35.62 Avg Check   |  Oldest: 18 min  |  ✓ All systems normal   |
+------------------------------------------------------------------+
|  HOURLY SALES                          |  TABLE MAP              |
|  $800 │        ██                      |  [Visual floor plan     |
|  $600 │       ████                     |   with color-coded      |
|  $400 │     ███████                    |   table status]         |
|  $200 │   ██████████                   |                         |
|    0  │ █████████████                  |                         |
|       11 12 1 2 3 4 5 6 7              |                         |
+------------------------------------------------------------------+
```

#### Compact Dashboard (Mobile)
```
+---------------------------+
| LIVE DASHBOARD    4:32 PM |
+---------------------------+
| SALES      | $4,523.67    |
|            | +12.3%       |
+---------------------------+
| LABOR      | 18.2%        |
| GUESTS     | 47 seated    |
| ORDERS     | 12 open      |
+---------------------------+
| ⚠️ 2 Alerts              |
| • Table 5: Long wait      |
| • Void pending approval   |
+---------------------------+
| [Full Dashboard]          |
+---------------------------+
```

#### Kitchen Display Dashboard
```
+------------------------------------------------------------------+
| KITCHEN DASHBOARD                                    4:32 PM     |
+------------------------------------------------------------------+
|  TICKETS: 8 Open        AVG TIME: 12 min        OLDEST: 18 min  |
+------------------------------------------------------------------+
|  TICKET TIMES                     |  ITEMS IN QUEUE              |
|  < 10 min: ████████████ (5)      |  Burgers: 4                  |
|  10-15 min: ████ (2)             |  Steaks: 3                   |
|  > 15 min: ██ (1) ⚠️             |  Salads: 6                   |
|                                   |  Apps: 2                     |
+------------------------------------------------------------------+
|  ACTIVE TICKETS                                                  |
|  +--------+  +--------+  +--------+  +--------+                 |
|  | T-5    |  | T-8    |  | T-12   |  | T-3    |                 |
|  | 18 min |  | 14 min |  | 12 min |  | 8 min  |                 |
|  | 3 items|  | 2 items|  | 4 items|  | 2 items|                 |
|  +--------+  +--------+  +--------+  +--------+                 |
+------------------------------------------------------------------+
```

### Real-Time Updates

#### Update Frequency
- [ ] Sales: Every transaction
- [ ] Orders: Every change
- [ ] Labor: Every minute
- [ ] Tables: Every change
- [ ] Kitchen: Every ticket update

#### WebSocket Connection
- [ ] Persistent connection
- [ ] Automatic reconnection
- [ ] Connection status indicator
- [ ] Fallback to polling

### Customization

#### Widget Selection
- [ ] Choose which widgets to display
- [ ] Arrange widget layout
- [ ] Resize widgets
- [ ] Save multiple layouts

#### Display Modes
- [ ] Light mode
- [ ] Dark mode (for bars/TV)
- [ ] High contrast
- [ ] Color blind friendly

#### Auto-Refresh
- [ ] Configurable refresh rate
- [ ] Pause/resume
- [ ] Full refresh option

### Alerts & Notifications

#### Alert Types
- [ ] Long ticket times
- [ ] High labor percentage
- [ ] Sales below target
- [ ] Pending approvals
- [ ] System issues
- [ ] Table waiting too long

#### Alert Display
- [ ] Visual indicator
- [ ] Sound (optional)
- [ ] Push notification (mobile)
- [ ] Count badge

### Historical Comparison

#### Comparison Periods
- [ ] Same day last week
- [ ] Same day last month
- [ ] Same day last year
- [ ] Custom comparison

#### Trend Indicators
- [ ] Up/down arrows
- [ ] Percentage change
- [ ] Color coding (green/red)

---

## UI/UX Specifications

### Sales Widget Detail

```
+----------------------------------+
| SALES TODAY                      |
+----------------------------------+
|                                  |
|    $4,523.67                    |
|    Net Sales                     |
|                                  |
|    ↑ +$498.55 (+12.3%)          |
|    vs last Tuesday               |
|                                  |
|    ━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|    ████████████████░░░░ 85%     |
|    Daily Goal: $5,300            |
|                                  |
|    This Hour: $342.50           |
|    Orders: 127 | Checks: 89      |
+----------------------------------+
```

### Kitchen Widget Detail

```
+----------------------------------+
| KITCHEN PERFORMANCE              |
+----------------------------------+
|                                  |
|    8 OPEN TICKETS               |
|                                  |
|    Average Time: 12:34          |
|    Target: < 15:00              |
|                                  |
|    ⚠️ OLDEST: 18:22             |
|       Table 5 - Ribeye, Salmon   |
|                                  |
|    QUEUE                         |
|    Grill: 5 | Sauté: 3 | Fry: 2 |
|                                  |
|    [View All Tickets]            |
+----------------------------------+
```

### Labor Widget Detail

```
+----------------------------------+
| LABOR                            |
+----------------------------------+
|                                  |
|    $456.78                       |
|    Labor Cost                    |
|                                  |
|    18.2% of Sales               |
|    Target: 20%  ✓ On Track      |
|                                  |
|    ON CLOCK: 8 Staff            |
|    FOH: 5 | BOH: 3              |
|                                  |
|    Projected EOD: $1,234.56     |
|    Projected %: 19.5%           |
|                                  |
|    ⚠️ 1 approaching overtime    |
+----------------------------------+
```

---

## Data Model

### Dashboard Configurations
```sql
dashboard_configurations {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  user_id: UUID (FK, nullable) -- NULL = location default

  name: VARCHAR(100)
  layout_type: VARCHAR(50) (full, compact, kitchen, custom)

  -- Widget configuration
  widgets: JSONB
  /*
  [
    { "type": "sales", "position": {"x": 0, "y": 0, "w": 2, "h": 1}, "settings": {} },
    { "type": "labor", "position": {"x": 2, "y": 0, "w": 1, "h": 1}, "settings": {} },
    ...
  ]
  */

  -- Display settings
  theme: VARCHAR(20) (light, dark)
  refresh_rate_seconds: INTEGER DEFAULT 30
  show_comparisons: BOOLEAN DEFAULT true
  comparison_period: VARCHAR(50) DEFAULT 'last_week'

  is_default: BOOLEAN DEFAULT false

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Dashboard Alerts
```sql
dashboard_alerts {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  alert_type: VARCHAR(50)
  severity: VARCHAR(20) (info, warning, critical)
  title: VARCHAR(200)
  message: TEXT

  -- Reference
  reference_type: VARCHAR(50) (nullable)
  reference_id: UUID (nullable)

  -- Timing
  triggered_at: TIMESTAMP
  expires_at: TIMESTAMP (nullable)

  -- Status
  is_active: BOOLEAN DEFAULT true
  acknowledged_by: UUID (FK, nullable)
  acknowledged_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

### Real-Time Metrics Cache
```sql
realtime_metrics {
  location_id: UUID PRIMARY KEY

  -- Sales
  sales_today: DECIMAL(12,2)
  sales_this_hour: DECIMAL(10,2)
  order_count_today: INTEGER
  average_check: DECIMAL(10,2)

  -- Labor
  labor_cost_today: DECIMAL(10,2)
  labor_percent: DECIMAL(5,2)
  staff_count: INTEGER

  -- Guests
  guests_seated: INTEGER
  guests_today: INTEGER
  tables_available: INTEGER

  -- Kitchen
  open_tickets: INTEGER
  avg_ticket_time_minutes: DECIMAL(5,2)
  oldest_ticket_minutes: DECIMAL(5,2)

  -- Bar
  open_tabs: INTEGER
  tabs_total: DECIMAL(10,2)

  -- Timestamp
  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Dashboard Data
```
GET    /api/dashboard/live
GET    /api/dashboard/metrics
GET    /api/dashboard/sales
GET    /api/dashboard/labor
GET    /api/dashboard/kitchen
GET    /api/dashboard/tables
GET    /api/dashboard/bar
```

### WebSocket
```
WS     /ws/dashboard/{location_id}

Events:
- metrics:updated
- sales:transaction
- order:updated
- table:status
- kitchen:ticket
- alert:new
- alert:dismissed
```

### Configuration
```
GET    /api/dashboard/configurations
POST   /api/dashboard/configurations
PUT    /api/dashboard/configurations/{id}
DELETE /api/dashboard/configurations/{id}
GET    /api/dashboard/configurations/default
```

### Alerts
```
GET    /api/dashboard/alerts
POST   /api/dashboard/alerts/{id}/acknowledge
GET    /api/dashboard/alerts/settings
PUT    /api/dashboard/alerts/settings
```

---

## Business Rules

1. **Real-Time Accuracy:** Metrics update within 5 seconds of change
2. **Connection Resilience:** Dashboard reconnects automatically
3. **Data Freshness:** Show "stale" indicator if data > 60 seconds old
4. **Alert Priority:** Critical alerts always visible
5. **Comparison Accuracy:** Same day comparisons account for holidays

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| View dashboard | Limited | Yes | Yes |
| Customize layout | No | Yes | Yes |
| Acknowledge alerts | No | Yes | Yes |
| Configure alerts | No | Yes | Yes |
| View all metrics | No | Yes | Yes |

---

## Configuration Options

```yaml
live_dashboard:
  refresh:
    default_rate_seconds: 30
    websocket_enabled: true
    fallback_polling: true

  display:
    default_theme: "light"
    show_animations: true
    high_contrast_option: true

  comparisons:
    default_period: "same_day_last_week"
    show_percentage: true
    color_code: true

  alerts:
    long_ticket_minutes: 15
    high_labor_percent: 25
    low_sales_percent_of_target: 70
    sound_enabled: false
```

---

## Open Questions

1. **External Display:** Support for external TV displays?

2. **Mobile App:** Dedicated mobile dashboard app?

3. **Multi-Location:** Single view for multiple locations?

4. **Forecasting:** Show predicted end-of-day based on trends?

5. **Custom Metrics:** Allow custom metric definitions?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Widget specifications detailed
- [ ] Real-time architecture designed

### Development
- [ ] Metrics calculation engine
- [ ] WebSocket infrastructure
- [ ] Widget components
- [ ] Layout system
- [ ] Alert system
- [ ] Mobile view
- [ ] Configuration UI

---

*Last Updated: January 27, 2026*
