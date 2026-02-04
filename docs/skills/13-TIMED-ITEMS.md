# 13 - Timed Items

**Status:** Planning
**Priority:** Medium
**Dependencies:** 04-Order-Management, 03-Menu-Programming

---

## Overview

The Timed Items skill handles billable time-based services like pool tables, dart boards, karaoke rooms, bowling lanes, and similar amenities. These items are charged by duration rather than fixed price.

**Primary Goal:** Accurately track and bill time-based services with flexible pricing and automatic notifications.

---

## User Stories

### As a Bartender/Server...
- I want to start a pool table timer with one tap
- I want to see how long each table has been active
- I want to get alerts when time is running low
- I want to easily add more time when requested

### As a Manager...
- I want to set pricing for timed items (per hour, per 30 min)
- I want to see utilization reports for timed equipment
- I want to offer package deals (unlimited for X hours)

### As a Guest (via Server)...
- I want to know how much time I have left
- I want to add more time without going to the bar
- I want the charge added to my tab

---

## Features

### Timed Item Types

#### Common Items
- [ ] Pool tables
- [ ] Dart boards
- [ ] Shuffleboard
- [ ] Karaoke rooms
- [ ] Private party rooms
- [ ] Bowling lanes
- [ ] Arcade games (if timed)
- [ ] Golf simulators
- [ ] Batting cages

#### Item Configuration
- [ ] Item name
- [ ] Location/number (Pool Table 1, Pool Table 2)
- [ ] Pricing model
- [ ] Minimum time
- [ ] Maximum time (optional)
- [ ] Availability schedule

### Pricing Models

#### Per-Time-Unit
```yaml
pool_table:
  rate: 12.00
  unit: "hour"
  minimum: 30  # minutes
  billing_increment: 15  # Bill in 15-min increments
  round_up: true
```

#### Tiered Pricing
```yaml
karaoke_room:
  tiers:
    - up_to_minutes: 60
      rate: 25.00
    - up_to_minutes: 120
      rate: 40.00
    - unlimited: 50.00
```

#### Time-of-Day Pricing
```yaml
pool_table:
  pricing:
    - days: [mon, tue, wed, thu]
      time: "11:00-17:00"
      rate: 8.00
    - days: [mon, tue, wed, thu]
      time: "17:00-close"
      rate: 12.00
    - days: [fri, sat, sun]
      rate: 15.00
```

#### Package/Flat Rate
```yaml
party_room:
  packages:
    - name: "2 Hour Package"
      duration: 120
      price: 150.00
    - name: "4 Hour Package"
      duration: 240
      price: 250.00
    - name: "All Night"
      duration: unlimited
      price: 400.00
```

### Timer Management

#### Starting a Timer
- [ ] Select timed item from POS
- [ ] Assign to tab/check
- [ ] Set initial duration (or open-ended)
- [ ] Timer begins immediately

#### Timer Display
- [ ] Time elapsed
- [ ] Time remaining (if pre-set)
- [ ] Current charge
- [ ] Projected final charge

#### Timer Operations
- [ ] Pause timer (manager only?)
- [ ] Resume timer
- [ ] Add time
- [ ] Stop timer
- [ ] Apply package/discount

#### Alerts & Notifications
- [ ] X minutes remaining alert
- [ ] Time expired alert
- [ ] Auto-notify assigned server
- [ ] Optional customer display

### Integration with Orders

#### Adding to Check
- [ ] Timed item appears on check
- [ ] Running total updates live (or at close)
- [ ] Shows duration and rate
- [ ] Can be voided/comped like regular items

#### Closing Timed Items
- [ ] Stop timer first or auto-close on payment
- [ ] Final calculation applied
- [ ] Minimum charge enforced
- [ ] Rounding applied per config

### Equipment Availability

#### Status Board
- [ ] Visual display of all timed equipment
- [ ] Available vs in-use
- [ ] Time remaining on each
- [ ] Reservation status

#### Reservations (Optional)
- [ ] Reserve equipment for specific time
- [ ] Deposit/pre-payment option
- [ ] No-show handling

---

## UI/UX Specifications

### Timed Items Dashboard

```
+------------------------------------------------------------------+
| TIMED ITEMS                                        [+ Start New] |
+------------------------------------------------------------------+
|                                                                  |
| POOL TABLES                                                      |
| +-------------+ +-------------+ +-------------+ +-------------+  |
| | TABLE 1     | | TABLE 2     | | TABLE 3     | | TABLE 4     |  |
| | ████████░░  | | ░░░░░░░░░░  | | ██████████  | | ████░░░░░░  |  |
| | 0:45 / 1:00 | | AVAILABLE   | | 1:32 (open) | | 0:15 / 1:00 |  |
| | $12.00 due  | |             | | $18.40 due  | | $12.00 due  |  |
| | Tab: Smith  | | [Start]     | | Tab: Jones  | | Tab: Wilson |  |
| | [Add Time]  | |             | | [Add Time]  | | [Add Time]  |  |
| +-------------+ +-------------+ +-------------+ +-------------+  |
|                                                                  |
| DART BOARDS                                                      |
| +-------------+ +-------------+                                  |
| | DARTS 1     | | DARTS 2     |                                  |
| | ░░░░░░░░░░  | | ████████░░  |                                  |
| | AVAILABLE   | | 0:50 / 1:00 |                                  |
| |             | | $8.00 due   |                                  |
| | [Start]     | | Tab: Garcia |                                  |
| +-------------+ +-------------+                                  |
|                                                                  |
| KARAOKE ROOMS                                                    |
| +-------------+                                                  |
| | ROOM A      |                                                  |
| | ██████░░░░  |                                                  |
| | 1:30 / 2:00 |                                                  |
| | $40.00 pkg  |                                                  |
| | Tab: Party  |                                                  |
| +-------------+                                                  |
+------------------------------------------------------------------+
```

### Start Timer Modal

```
+------------------------------------------------------------------+
| START TIMER - Pool Table 2                            [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| Rate: $12.00/hour (minimum 30 min)                              |
|                                                                  |
| DURATION:                                                        |
| ( ) Open-ended (bill at close)                                   |
| (•) Set time:                                                    |
|     [30 min] [1 hour] [1.5 hours] [2 hours] [Custom]            |
|                                                                  |
| ASSIGN TO:                                                       |
| ( ) New tab: [Name: ____________]                                |
| (•) Existing: [Smith - Tab ***4521 ▼]                           |
|                                                                  |
| PRICING:                                                         |
| [Standard $12/hr ▼]                                             |
| Options: Standard, Happy Hour $8/hr, VIP Rate                   |
|                                                                  |
| Estimated charge: $12.00                                        |
|                                                                  |
| [Cancel]                                    [Start Timer]        |
+------------------------------------------------------------------+
```

### Timer Alert

```
+------------------------------------------------------------------+
| ⚠️ TIME ALERT                                                    |
+------------------------------------------------------------------+
|                                                                  |
| Pool Table 1 - Smith Tab                                        |
|                                                                  |
| Time remaining: 5 MINUTES                                        |
| Current charge: $12.00                                          |
|                                                                  |
| [Add 30 min ($6)]  [Add 1 hour ($12)]  [Notify Customer]        |
|                                                                  |
| [Dismiss]                              [Go to Tab]              |
+------------------------------------------------------------------+
```

---

## Data Model

### Timed Item Definitions
```sql
timed_item_definitions {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  category: VARCHAR(50) -- pool, darts, karaoke, etc.
  description: TEXT (nullable)

  -- Identification
  item_number: VARCHAR(20) -- "Table 1", "Room A"

  -- Base pricing
  base_rate: DECIMAL(10,2)
  rate_unit: VARCHAR(20) -- minute, hour
  minimum_minutes: INTEGER DEFAULT 0
  billing_increment_minutes: INTEGER DEFAULT 1
  round_up: BOOLEAN DEFAULT true

  -- Limits
  max_duration_minutes: INTEGER (nullable)

  is_active: BOOLEAN DEFAULT true
  sort_order: INTEGER

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Timed Item Pricing Tiers
```sql
timed_item_pricing {
  id: UUID PRIMARY KEY
  timed_item_definition_id: UUID (FK)

  -- When this pricing applies
  name: VARCHAR(100)
  days_of_week: INTEGER[] (nullable)
  start_time: TIME (nullable)
  end_time: TIME (nullable)

  -- Rate
  rate: DECIMAL(10,2)
  rate_unit: VARCHAR(20)

  -- Or package
  is_package: BOOLEAN DEFAULT false
  package_minutes: INTEGER (nullable)
  package_price: DECIMAL(10,2) (nullable)

  priority: INTEGER DEFAULT 0 -- Higher = takes precedence

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Active Timers
```sql
timed_item_sessions {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  timed_item_definition_id: UUID (FK)

  -- Assignment
  order_id: UUID (FK)
  order_item_id: UUID (FK) -- Line item on the check

  -- Timing
  started_at: TIMESTAMP
  target_end_at: TIMESTAMP (nullable) -- If pre-set duration
  actual_end_at: TIMESTAMP (nullable)
  paused_at: TIMESTAMP (nullable)
  total_paused_minutes: INTEGER DEFAULT 0

  -- Pricing used
  pricing_id: UUID (FK, nullable)
  applied_rate: DECIMAL(10,2)
  applied_rate_unit: VARCHAR(20)
  is_package: BOOLEAN DEFAULT false

  -- Calculated
  total_minutes: INTEGER (nullable) -- Set at close
  total_charge: DECIMAL(10,2) (nullable)

  -- Status
  status: VARCHAR(50) (active, paused, completed, cancelled)

  started_by: UUID (FK)
  ended_by: UUID (FK, nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Timer Extensions
```sql
timed_item_extensions {
  id: UUID PRIMARY KEY
  session_id: UUID (FK)

  added_minutes: INTEGER
  added_at: TIMESTAMP
  added_by: UUID (FK)

  previous_end_at: TIMESTAMP (nullable)
  new_end_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Definitions
```
GET    /api/timed-items
POST   /api/timed-items
PUT    /api/timed-items/{id}
DELETE /api/timed-items/{id}
GET    /api/timed-items/{id}/pricing
PUT    /api/timed-items/{id}/pricing
```

### Sessions
```
POST   /api/timed-items/{id}/start
GET    /api/timed-items/sessions/active
GET    /api/timed-items/sessions/{id}
POST   /api/timed-items/sessions/{id}/pause
POST   /api/timed-items/sessions/{id}/resume
POST   /api/timed-items/sessions/{id}/extend
POST   /api/timed-items/sessions/{id}/stop
```

### Dashboard
```
GET    /api/timed-items/dashboard
WS     /ws/timed-items  -- Real-time updates
```

### Reporting
```
GET    /api/reports/timed-items/utilization
GET    /api/reports/timed-items/revenue
```

---

## Business Rules

1. **Minimum Charge:** Always apply minimum regardless of actual time
2. **Rounding:** Round to billing increment (up or nearest)
3. **Pause Limits:** May limit total pause time or require manager
4. **Active Timer Required:** Can't close check with active timer without stopping
5. **Concurrent Limits:** Item can only have one active session
6. **Pricing Lock:** Lock pricing at session start or calculate at close

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| Start timers | Yes | Yes | Yes |
| Stop timers | Yes | Yes | Yes |
| Add time | Yes | Yes | Yes |
| Pause timers | No | Yes | Yes |
| Override pricing | No | Yes | Yes |
| Configure items | No | Yes | Yes |
| View reports | No | Yes | Yes |

---

## Configuration Options

```yaml
timed_items:
  alerts:
    warning_minutes: [15, 5]  # Alert at 15 and 5 min remaining
    alert_sound: true
    notify_server: true

  billing:
    calculate_at: "stop"  # or "close" (when check closes)
    allow_pause: true
    max_pause_minutes: 30

  display:
    show_rate_on_dashboard: true
    show_running_total: true
    countdown_display: true
```

---

## Open Questions

1. **Hardware Integration:** Support for physical timers/displays?

2. **Customer Self-Service:** Customers add time via app/kiosk?

3. **Deposits:** Require deposit for high-value equipment?

4. **Waitlist:** Queue management when all items in use?

5. **Loyalty Integration:** Reward points for timed services?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Pricing models finalized
- [ ] UI mockups

### Development
- [ ] Item definitions
- [ ] Timer sessions
- [ ] Dashboard
- [ ] Alerts
- [ ] Pricing engine
- [ ] Reporting

---

*Last Updated: January 27, 2026*
