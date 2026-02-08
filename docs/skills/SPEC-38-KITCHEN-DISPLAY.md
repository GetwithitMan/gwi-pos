# 38 - Kitchen Display System (KDS)

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 14-Coursing, 15-Hold-Fire, 34-Device-Management

---

## Overview

The Kitchen Display System (KDS) skill manages digital kitchen ticket display, order routing, bump functionality, expo management, and customer-facing order status. Replaces or supplements paper tickets with real-time digital displays for faster, more accurate kitchen operations.

**Primary Goal:** Streamline kitchen operations with real-time digital order display, intelligent routing, and instant communication between FOH and BOH.

---

## User Stories

### As a Line Cook...
- I want to see only orders for my station
- I want to bump items when complete
- I want clear, readable ticket display
- I want to see item counts and timing

### As an Expo...
- I want to see all orders in one place
- I want to coordinate multiple stations
- I want to mark orders complete for runners
- I want to reprint/resend if needed

### As a Manager...
- I want to monitor kitchen times
- I want to identify bottlenecks
- I want historical performance data
- I want to configure routing rules

### As a Customer...
- I want to see my order status
- I want to know when it's ready
- I want clear pickup notifications

---

## Features

### Screen Types

#### Kitchen Station Screens
- [ ] Hot line display
- [ ] Cold line display
- [ ] Grill station
- [ ] Fry station
- [ ] Prep station
- [ ] Custom stations

#### Expo Screen
- [ ] All-order overview
- [ ] Station status indicators
- [ ] Ready for pickup marking
- [ ] Order assembly tracking

#### Customer Status Screen
- [ ] Order number display
- [ ] Status progression
- [ ] Ready pickup alerts
- [ ] Estimated wait times

### Order Display

#### Ticket Layout
```
+------------------------------------------+
| #1247  TABLE 12  Server: Sarah    2:45 ▲ |
+------------------------------------------+
| SEAT 1                                   |
| ▶ Burger - Medium                        |
|   - No Onion                             |
|   - Extra Pickles                        |
|   - Side: Fries                          |
|                                          |
| SEAT 2                                   |
| ▶ Chicken Sandwich                       |
|   - ADD Bacon                            |
|   - Side: Coleslaw                       |
+------------------------------------------+
| [BUMP]              [RECALL]    [REPRINT]|
+------------------------------------------+
```

#### Display Information
- [ ] Order/ticket number
- [ ] Table/tab identifier
- [ ] Server name
- [ ] Time on screen (aging)
- [ ] Seat assignments
- [ ] Items with modifiers
- [ ] Special instructions (highlighted)
- [ ] Coursing indicators
- [ ] Hold/fire status

### Routing Rules

#### Route By Category
```yaml
routing_rules:
  - station: "Hot Line"
    categories:
      - "Entrees"
      - "Hot Appetizers"
      - "Sides - Hot"

  - station: "Cold Line"
    categories:
      - "Salads"
      - "Cold Appetizers"
      - "Desserts"

  - station: "Grill"
    categories:
      - "Burgers"
      - "Steaks"
    tags:
      - "grill"

  - station: "Fry"
    tags:
      - "fried"
      - "fryer"

  - station: "Bar"
    categories:
      - "Drinks"
      - "Cocktails"
```

#### Route By Tag
- [ ] Item-level tags
- [ ] Modifier-level tags
- [ ] Multi-station routing

### Bump Functionality

#### Bump Actions
- [ ] Single item bump
- [ ] Full ticket bump
- [ ] Bump to expo
- [ ] Bump with status

#### Bump Flow
```
Kitchen Screen → Bump → Expo Screen → Bump → Complete/Served
                         ↓
              Customer Status: READY
```

### Expo Management

#### Expo Features
- [ ] Station consolidation view
- [ ] Order assembly checklist
- [ ] Runner assignment
- [ ] Completion marking
- [ ] Quality check point

#### Expo Display
```
+------------------------------------------------------------------+
| EXPO SCREEN                                              12:45 PM |
+------------------------------------------------------------------+
| READY FOR PICKUP                                                  |
| +---------------------------+ +---------------------------+       |
| | #1245 - Table 8          | | #1246 - Bar Tab "Mike"   |       |
| | 🟢 Hot Line DONE         | | 🟢 Bar DONE              |       |
| | 🟢 Cold Line DONE        | | Items: 2                 |       |
| | [MARK SERVED]            | | [MARK SERVED]            |       |
| +---------------------------+ +---------------------------+       |
|                                                                   |
| IN PROGRESS                                                       |
| +---------------------------+ +---------------------------+       |
| | #1247 - Table 12   3:15  | | #1248 - Table 5    1:30  |       |
| | 🟢 Hot Line DONE         | | 🔵 Hot Line (2 items)   |       |
| | 🔵 Cold Line (1 item)    | | 🟢 Cold Line DONE       |       |
| | 🔵 Grill (1 item)        | |                          |       |
| +---------------------------+ +---------------------------+       |
|                                                                   |
| WAITING                                                           |
| #1249 (0:45) | #1250 (0:30) | #1251 (0:15)                       |
+------------------------------------------------------------------+
```

### Customer Status Display

#### Status Board
```
+------------------------------------------------------------------+
|                    ORDER STATUS                                   |
+==================================================================+
|                                                                   |
|  🔵 PREPARING                                                     |
|  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                 |
|  │  #1247  │ │  #1248  │ │  #1249  │ │  #1250  │                 |
|  └─────────┘ └─────────┘ └─────────┘ └─────────┘                 |
|                                                                   |
|  🟢 READY FOR PICKUP                                              |
|  ┌─────────┐ ┌─────────┐                                         |
|  │  #1245  │ │  #1246  │                                         |
|  │ ★ READY │ │ ★ READY │                                         |
|  └─────────┘ └─────────┘                                         |
|                                                                   |
+------------------------------------------------------------------+
```

#### Status Progression
- [ ] Order Received
- [ ] Preparing
- [ ] Almost Ready
- [ ] Ready for Pickup
- [ ] Complete

### Print from Screen

#### Print Options
- [ ] Reprint ticket
- [ ] Print single station
- [ ] Print expo copy
- [ ] Print runner ticket

### Timing & Alerts

#### Time Tracking
- [ ] Time since order received
- [ ] Time per station
- [ ] Total ticket time
- [ ] Average times by item

#### Visual Alerts
```yaml
timing_alerts:
  normal:
    color: "green"
    threshold: 0  # minutes
  warning:
    color: "yellow"
    threshold: 8
  urgent:
    color: "orange"
    threshold: 12
  critical:
    color: "red"
    threshold: 15
    flash: true
    sound: true
```

### Multi-Screen Sync

#### Screen Coordination
- [ ] Real-time updates across screens
- [ ] Station status on all displays
- [ ] Bump reflects instantly
- [ ] Offline handling

### Configuration

#### Display Settings
- [ ] Font size
- [ ] Color scheme
- [ ] Items per screen
- [ ] Auto-scroll
- [ ] Sound alerts
- [ ] Language options

---

## UI/UX Specifications

### Kitchen Station Screen

```
+------------------------------------------------------------------+
| HOT LINE                                              12:45 PM    |
+------------------------------------------------------------------+
| +-----------------------------+  +-----------------------------+  |
| | #1247 TABLE 12      ⏱ 3:15 |  | #1248 TABLE 5       ⏱ 1:30 |  |
| | ─────────────────────────── |  | ─────────────────────────── |  |
| | ▶ Burger - MEDIUM           |  | ▶ Steak - MED RARE         |  |
| |   **NO ONION**              |  |   Side: Mashed              |  |
| |   EXTRA Pickles             |  |                             |  |
| |   Side: Fries               |  | ▶ Grilled Chicken          |  |
| |                             |  |   **ALLERGY: GLUTEN FREE** |  |
| | ▶ Chicken Sandwich          |  |   Side: Vegetables         |  |
| |   ADD Bacon                 |  |                             |  |
| | ─────────────────────────── |  | ─────────────────────────── |  |
| |         [BUMP]              |  |         [BUMP]              |  |
| +-----------------------------+  +-----------------------------+  |
|                                                                   |
| +-----------------------------+  +-----------------------------+  |
| | #1249 TABLE 3       ⏱ 0:45 |  | #1250 TOGO #89      ⏱ 0:30 |  |
| | ─────────────────────────── |  | ─────────────────────────── |  |
| | ▶ Fish & Chips              |  | ▶ 2x Burger - WELL         |  |
| |   EXTRA Tartar Side         |  | ▶ 1x Chicken Tenders       |  |
| |                             |  |                             |  |
| | ▶ Wings (12)                |  |                             |  |
| |   Buffalo - Extra Hot       |  |                             |  |
| | ─────────────────────────── |  | ─────────────────────────── |  |
| |         [BUMP]              |  |         [BUMP]              |  |
| +-----------------------------+  +-----------------------------+  |
|                                                                   |
| QUEUE: 3 more tickets | AVG TIME: 8:30 | [ALL ORDERS] [SETTINGS] |
+------------------------------------------------------------------+
```

### KDS Configuration

```
+------------------------------------------------------------------+
| KITCHEN DISPLAY CONFIGURATION                             [Save]  |
+------------------------------------------------------------------+
|                                                                   |
| SCREENS                                           [+ Add Screen]  |
| +--------------------------------------------------------------+ |
| | Screen 1: Hot Line     | IP: 192.168.1.201 | Online ✓        | |
| | Screen 2: Cold Line    | IP: 192.168.1.202 | Online ✓        | |
| | Screen 3: Expo         | IP: 192.168.1.203 | Online ✓        | |
| | Screen 4: Customer     | IP: 192.168.1.204 | Online ✓        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| ROUTING                                                           |
| +--------------------------------------------------------------+ |
| | Hot Line receives:                                            | |
| | [✓] Entrees  [✓] Hot Apps  [✓] Sides-Hot  [ ] Salads        | |
| |                                                                | |
| | Cold Line receives:                                           | |
| | [ ] Entrees  [ ] Hot Apps  [ ] Sides-Hot  [✓] Salads        | |
| | [✓] Desserts  [✓] Cold Apps                                  | |
| +--------------------------------------------------------------+ |
|                                                                   |
| TIMING THRESHOLDS                                                 |
| Warning (Yellow): [8] minutes                                    |
| Urgent (Orange): [12] minutes                                    |
| Critical (Red): [15] minutes                                     |
|                                                                   |
| DISPLAY OPTIONS                                                   |
| Tickets per row: [2 ▼]                                           |
| Font size: [Large ▼]                                             |
| [✓] Show seat numbers                                            |
| [✓] Show server name                                             |
| [✓] Flash critical tickets                                       |
| [✓] Sound on new ticket                                          |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Data Model

### KDS Screens
```sql
kds_screens {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  device_id: UUID (FK)

  screen_name: VARCHAR(100)
  screen_type: VARCHAR(50) (station, expo, customer_status)

  -- Display settings
  tickets_per_row: INTEGER DEFAULT 2
  font_size: VARCHAR(20) DEFAULT 'medium'
  color_scheme: VARCHAR(50) DEFAULT 'dark'
  show_seats: BOOLEAN DEFAULT true
  show_server: BOOLEAN DEFAULT true

  -- Alerts
  warning_minutes: INTEGER DEFAULT 8
  urgent_minutes: INTEGER DEFAULT 12
  critical_minutes: INTEGER DEFAULT 15
  flash_critical: BOOLEAN DEFAULT true
  sound_enabled: BOOLEAN DEFAULT true

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### KDS Routing Rules
```sql
kds_routing_rules {
  id: UUID PRIMARY KEY
  screen_id: UUID (FK)
  location_id: UUID (FK)

  rule_type: VARCHAR(50) (category, tag, item)
  rule_value: VARCHAR(100) -- category_id, tag name, or item_id

  priority: INTEGER DEFAULT 0

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### KDS Tickets
```sql
kds_tickets {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  order_id: UUID (FK)
  screen_id: UUID (FK)

  ticket_number: INTEGER

  -- Timing
  received_at: TIMESTAMP
  bumped_at: TIMESTAMP (nullable)

  -- Status
  status: VARCHAR(50) (pending, in_progress, bumped, recalled)

  bumped_by: UUID (FK, nullable)

  created_at: TIMESTAMP
}
```

### KDS Ticket Items
```sql
kds_ticket_items {
  id: UUID PRIMARY KEY
  ticket_id: UUID (FK)
  order_item_id: UUID (FK)

  -- Display
  item_name: VARCHAR(200)
  modifiers_display: TEXT
  seat_number: INTEGER (nullable)
  course_number: INTEGER (nullable)

  -- Status
  status: VARCHAR(50) (pending, done)
  done_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

### KDS Performance
```sql
kds_performance_log {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  screen_id: UUID (FK)
  ticket_id: UUID (FK)

  -- Timing
  time_to_bump: INTEGER -- seconds
  items_count: INTEGER

  -- Context
  day_part: VARCHAR(20)
  recorded_at: TIMESTAMP
}
```

---

## API Endpoints

### Screens
```
GET    /api/kds/screens
POST   /api/kds/screens
PUT    /api/kds/screens/{id}
DELETE /api/kds/screens/{id}
GET    /api/kds/screens/{id}/tickets
```

### Tickets
```
GET    /api/kds/tickets
GET    /api/kds/tickets/{id}
POST   /api/kds/tickets/{id}/bump
POST   /api/kds/tickets/{id}/recall
POST   /api/kds/tickets/{id}/reprint
```

### Items
```
POST   /api/kds/tickets/{id}/items/{item_id}/done
POST   /api/kds/tickets/{id}/items/{item_id}/undo
```

### Routing
```
GET    /api/kds/routing
PUT    /api/kds/routing
POST   /api/kds/routing/test
```

### Customer Status
```
GET    /api/kds/customer-status
GET    /api/kds/order-status/{order_number}
```

### Analytics
```
GET    /api/kds/analytics/times
GET    /api/kds/analytics/station/{id}
GET    /api/kds/analytics/bottlenecks
```

---

## Business Rules

1. **Auto-Routing:** Items automatically route to correct station based on rules
2. **Multi-Station:** Single item can appear on multiple screens if needed
3. **Bump Cascade:** Bumping from station moves to expo (if configured)
4. **Time Tracking:** All timing measured from order send, not ticket creation
5. **Recall Limit:** Recalled tickets maintain original timing
6. **Customer Display:** Only shows order numbers, no item details

---

## Permissions

| Action | Cook | Expo | Manager | Admin |
|--------|------|------|---------|-------|
| View station screen | Yes | Yes | Yes | Yes |
| Bump items/tickets | Yes | Yes | Yes | Yes |
| Recall tickets | No | Yes | Yes | Yes |
| Reprint tickets | No | Yes | Yes | Yes |
| View all stations | No | Yes | Yes | Yes |
| Configure screens | No | No | Yes | Yes |
| Configure routing | No | No | Yes | Yes |
| View analytics | No | No | Yes | Yes |

---

## Configuration Options

```yaml
kds:
  general:
    default_screen_type: "station"
    auto_bump_to_expo: true
    consolidate_same_items: true

  display:
    theme: "dark"  # dark, light, high_contrast
    font_size: "large"
    tickets_per_row: 2
    max_tickets_display: 8

  timing:
    warning_threshold: 8
    urgent_threshold: 12
    critical_threshold: 15
    flash_critical: true

  sounds:
    new_ticket: true
    warning_alert: true
    critical_alert: true
    bump_confirmation: false

  customer_display:
    show_order_numbers: true
    show_names: false
    ready_flash: true
    ready_sound: true

  routing:
    default_to_all: false
    expo_required: true
```

---

## Integration Points

- **04-Order-Management:** Receives orders when sent to kitchen
- **14-Coursing:** Respects course firing
- **15-Hold-Fire:** Shows hold status, fires when released
- **39-Buzzer-System:** Triggers alerts on bump
- **34-Device-Management:** Screen registration and monitoring

---

*Last Updated: January 27, 2026*
