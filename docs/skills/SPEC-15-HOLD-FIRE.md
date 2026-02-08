# 15 - Hold & Fire

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 14-Coursing

---

## Overview

The Hold & Fire skill provides granular control over when orders and items are sent to the kitchen. This includes immediate firing, holding for later, timed delays, and batch firing. Works in conjunction with coursing but can operate independently.

**Primary Goal:** Give servers precise control over kitchen timing to optimize guest experience and kitchen workflow.

---

## User Stories

### As a Server...
- I want to hold an order while I finish taking it
- I want to fire items immediately for a hungry table
- I want to delay an item until a specific time
- I want to fire desserts when I see the table is finishing entrees

### As a Kitchen Manager...
- I want to see all pending (held) orders
- I want to know when held items will be fired
- I want to prepare for upcoming orders

### As a Bartender...
- I want to hold drink orders until food is ready
- I want to fire a round of drinks immediately

---

## Features

### Hold Operations

#### Hold Order
- [ ] Hold entire order (nothing fires)
- [ ] Hold until manually fired
- [ ] Hold for specific duration
- [ ] Hold until specific time

#### Hold Item
- [ ] Hold specific item(s)
- [ ] Rest of order fires normally
- [ ] Item fires when released

#### Hold Status Display
- [ ] Visual "HELD" indicator
- [ ] Time remaining (if timed hold)
- [ ] Who placed hold
- [ ] Why held (optional note)

### Fire Operations

#### Immediate Fire
- [ ] Fire all pending items
- [ ] Fire selected items
- [ ] Fire with "RUSH" flag

#### Timed Fire
- [ ] Fire after X minutes
- [ ] Fire at specific time
- [ ] Countdown visible

#### Batch Fire
- [ ] Fire multiple tables together
- [ ] Fire all items for a party/event
- [ ] Coordinate large group timing

### Fire Status

#### Item Fire States
```
[PENDING] → [HELD] → [QUEUED] → [FIRED] → [ACKNOWLEDGED]
                ↓
           [TIMED]
```

- **Pending:** Added to order, not yet sent
- **Held:** Explicitly held by server
- **Queued:** Will fire on next send
- **Timed:** Will fire at scheduled time
- **Fired:** Sent to kitchen
- **Acknowledged:** Kitchen confirmed receipt

### Kitchen Communication

#### Fire Notifications
- [ ] Sound/alert on new fire
- [ ] Priority indicator for rush
- [ ] Estimated timing info
- [ ] Special instructions visible

#### Kitchen Feedback
- [ ] Acknowledge receipt
- [ ] Request more time
- [ ] Report issues
- [ ] Mark complete

### Hold Reasons

#### Pre-Set Reasons
- [ ] Waiting for full party
- [ ] Guest request
- [ ] Timing with another table
- [ ] VIP pacing
- [ ] Kitchen requested

#### Custom Notes
- [ ] Free-text hold reason
- [ ] Fire instructions
- [ ] Timing notes

---

## UI/UX Specifications

### Order with Hold Controls

```
+------------------------------------------------------------------+
| ORDER - Table 12                               [HELD - 5:32]     |
+------------------------------------------------------------------+
|                                                                  |
| ITEMS                                                            |
| +----------------------------------------------------------+    |
| | Wings                    $12.99    [FIRE NOW]  [HOLD]    |    |
| | Burger                   $14.99    [FIRE NOW]  [HOLD]    |    |
| | Salad                     $8.99    [FIRE NOW]  [HOLD]    |    |
| |                                                          |    |
| | ---- HELD ITEMS ----                                     |    |
| | Dessert Sampler ⏸️       $15.99    [RELEASE]  [TIMER]    |    |
| |   Held: "Fire after entrees"                             |    |
| +----------------------------------------------------------+    |
|                                                                  |
| ORDER CONTROLS:                                                  |
| [Fire All] [Hold All] [Send] [Timed Send ▼]                     |
|                                                                  |
+------------------------------------------------------------------+
```

### Hold Modal

```
+------------------------------------------------------------------+
| HOLD OPTIONS                                          [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| Item: Dessert Sampler                                           |
|                                                                  |
| HOLD TYPE:                                                       |
| (•) Until I fire manually                                        |
| ( ) For [__] minutes                                             |
| ( ) Until [__:__] time                                           |
| ( ) Until course fires: [Entrees ▼]                             |
|                                                                  |
| REASON (optional):                                               |
| [Wait for entrees to clear ________________]                    |
|                                                                  |
| [Cancel]                                    [Hold Item]          |
+------------------------------------------------------------------+
```

### Timed Fire Modal

```
+------------------------------------------------------------------+
| TIMED FIRE                                            [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| Fire order for Table 12 in:                                     |
|                                                                  |
| [5 min] [10 min] [15 min] [20 min] [Custom: ____ min]           |
|                                                                  |
| Or at specific time: [__:__]                                    |
|                                                                  |
| Preview: Will fire at 7:25 PM                                   |
|                                                                  |
| [Cancel]                                    [Set Timer]          |
+------------------------------------------------------------------+
```

### Kitchen Pending View

```
+------------------------------------------------------------------+
| PENDING ORDERS (Not Yet Fired)                                   |
+------------------------------------------------------------------+
|                                                                  |
| HELD ORDERS                                                      |
| +----------------------------------------------------------+    |
| | Table 12 - Sarah M.                                      |    |
| | Held: 5 min ago | Reason: Waiting for full party        |    |
| | 4 items: Wings, Burger, 2x Salad                         |    |
| +----------------------------------------------------------+    |
| | Table 8 - Mike J.                                        |    |
| | Held: 2 min ago | Reason: VIP timing                    |    |
| | 3 items: Ribeye, Salmon, Pasta                           |    |
| +----------------------------------------------------------+    |
|                                                                  |
| TIMED ORDERS (Upcoming)                                          |
| +----------------------------------------------------------+    |
| | Table 15 - Lisa G.                  Fires in: 8 min      |    |
| | 2 items: Dessert Sampler, Coffee                         |    |
| +----------------------------------------------------------+    |
| | Table 3 - Tom B.                    Fires in: 12 min     |    |
| | 6 items: Full dinner order                               |    |
| +----------------------------------------------------------+    |
|                                                                  |
+------------------------------------------------------------------+
```

### Server Held Items View

```
+------------------------------------------------------------------+
| MY HELD ITEMS                                                    |
+------------------------------------------------------------------+
| TABLE | ITEMS HELD       | DURATION  | REASON        | ACTION   |
+------------------------------------------------------------------+
| 12    | Dessert (1)      | 15 min    | After entrees | [Fire]   |
| 8     | Full order (6)   | 3 min     | Waiting party | [Fire]   |
| 15    | Drinks (4)       | Timer 5m  | With food     | [Cancel] |
+------------------------------------------------------------------+
```

---

## Data Model

### Hold Records
```sql
order_holds {
  id: UUID PRIMARY KEY
  order_id: UUID (FK)
  order_item_id: UUID (FK, nullable) -- NULL = whole order

  -- Hold details
  hold_type: VARCHAR(50) (manual, timed, until_course, until_time)

  -- Timing
  held_at: TIMESTAMP
  release_at: TIMESTAMP (nullable) -- For timed holds
  released_at: TIMESTAMP (nullable) -- When actually released

  -- For course-based holds
  release_on_course_id: UUID (FK, nullable)

  -- Context
  reason: VARCHAR(200) (nullable)
  notes: TEXT (nullable)

  -- Status
  status: VARCHAR(50) (active, released, cancelled, expired)

  -- Who
  held_by: UUID (FK)
  released_by: UUID (FK, nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Fire Queue
```sql
fire_queue {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- What
  order_id: UUID (FK)
  order_item_id: UUID (FK, nullable) -- NULL = whole order

  -- When
  fire_at: TIMESTAMP
  fired_at: TIMESTAMP (nullable)

  -- Priority
  priority: INTEGER DEFAULT 0 -- Higher = more urgent
  is_rush: BOOLEAN DEFAULT false

  -- Status
  status: VARCHAR(50) (queued, firing, fired, cancelled)

  -- Who
  queued_by: UUID (FK)

  created_at: TIMESTAMP
}
```

### Kitchen Acknowledgments
```sql
kitchen_acknowledgments {
  id: UUID PRIMARY KEY

  order_id: UUID (FK)
  order_item_id: UUID (FK, nullable)

  acknowledged_at: TIMESTAMP
  acknowledged_by: UUID (FK, nullable) -- Kitchen staff

  notes: TEXT (nullable)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Hold Operations
```
POST   /api/orders/{id}/hold
POST   /api/orders/{id}/items/{item_id}/hold
DELETE /api/orders/{id}/hold                   -- Release hold
DELETE /api/orders/{id}/items/{item_id}/hold
GET    /api/orders/{id}/holds
```

### Fire Operations
```
POST   /api/orders/{id}/fire
POST   /api/orders/{id}/items/{item_id}/fire
POST   /api/orders/{id}/fire-timed
POST   /api/orders/{id}/rush
```

### Queue Management
```
GET    /api/kitchen/queue
GET    /api/kitchen/pending
POST   /api/kitchen/acknowledge/{order_id}
```

### Server Views
```
GET    /api/employees/{id}/held-items
GET    /api/employees/{id}/timed-orders
```

### Real-Time
```
WS     /ws/kitchen/queue
WS     /ws/holds/{location_id}
```

---

## Business Rules

1. **Default Behavior:** Items fire immediately unless held
2. **Hold Inheritance:** New items added to held order are also held
3. **Timed Release:** Timed holds auto-release at scheduled time
4. **Course Integration:** Can hold until specific course fires
5. **Rush Priority:** Rush items jump to front of kitchen queue
6. **Expiration:** Very old holds may require re-confirmation

---

## Permissions

| Action | Server | Kitchen | Manager | Admin |
|--------|--------|---------|---------|-------|
| Hold items | Yes | No | Yes | Yes |
| Fire items | Yes | No | Yes | Yes |
| Rush orders | Yes | No | Yes | Yes |
| View queue | No | Yes | Yes | Yes |
| Acknowledge | No | Yes | Yes | Yes |
| Cancel holds | Own | No | Yes | Yes |

---

## Configuration Options

```yaml
hold_fire:
  defaults:
    auto_fire_on_send: true
    hold_timeout_minutes: 60
    require_hold_reason: false

  rush:
    enabled: true
    sound_alert: true
    visual_highlight: true

  kitchen:
    require_acknowledgment: false
    show_timing_info: true

  alerts:
    long_hold_warning_minutes: 30
    timed_fire_reminder_minutes: 5
```

---

## Open Questions

1. **Hold Limits:** Maximum time an order can be held?

2. **Kitchen Override:** Can kitchen release a hold if ready?

3. **Batch Coordination:** Coordinate timing across multiple tables for events?

4. **Smart Suggestions:** AI suggest optimal fire times based on kitchen load?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Workflow finalized
- [ ] Kitchen integration detailed

### Development
- [ ] Hold functionality
- [ ] Fire controls
- [ ] Timed fire
- [ ] Kitchen queue
- [ ] Real-time updates
- [ ] Alerts/notifications

---

*Last Updated: January 27, 2026*
