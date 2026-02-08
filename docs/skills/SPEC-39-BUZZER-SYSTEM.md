# 39 - Buzzer/Alert System

**Status:** Planning
**Priority:** Medium
**Dependencies:** 38-Kitchen-Display, 04-Order-Management, 27-Texting-SMS

---

## Overview

The Buzzer/Alert System skill manages customer notification when orders are ready - physical pager systems (like Vetech, LRS), SMS alerts, app push notifications, and integration with KDS bump actions. Automates customer notification to improve pickup efficiency.

**Primary Goal:** Efficiently notify customers when their order is ready through their preferred notification method.

---

## User Stories

### As a Customer...
- I want to know immediately when my order is ready
- I want to choose how I'm notified (pager, SMS, app)
- I want clear pickup instructions
- I want to enjoy my wait without watching a screen

### As a Cashier...
- I want to quickly assign a buzzer or collect a phone number
- I want to see buzzer status at a glance
- I want to manually trigger alerts if needed
- I want easy buzzer return tracking

### As a Manager...
- I want to track buzzer inventory
- I want to see alert delivery success rates
- I want to configure notification preferences
- I want to integrate with existing hardware

---

## Features

### Notification Methods

#### Physical Pagers
- [ ] Vetech pager integration
- [ ] LRS pager integration
- [ ] Generic pager protocols
- [ ] Coaster pagers
- [ ] Visual/vibrate/audio modes

#### SMS Notifications
- [ ] Text when ready
- [ ] Estimated time updates
- [ ] Pickup location info
- [ ] Customizable messages

#### App Push Notifications
- [ ] In-app alerts
- [ ] Rich notifications
- [ ] Deep link to order

#### Display Board
- [ ] Number called display
- [ ] Audio announcement
- [ ] Multi-language support

### Pager Management

#### Pager Assignment
- [ ] Assign at order creation
- [ ] Pager number entry
- [ ] Auto-increment option
- [ ] Quick-assign buttons

#### Pager Inventory
- [ ] Total pager count
- [ ] In-use tracking
- [ ] Missing pager alerts
- [ ] Battery status (if supported)

#### Pager Return
- [ ] Mark returned
- [ ] Time-out alerts
- [ ] Lost pager workflow

### Alert Triggers

#### Automatic Triggers
- [ ] KDS bump triggers alert
- [ ] Expo bump triggers alert
- [ ] Order status change trigger
- [ ] Configurable trigger point

#### Manual Triggers
- [ ] Re-alert button
- [ ] Alert from POS
- [ ] Alert from KDS
- [ ] Bulk alerts

### SMS Configuration

#### Message Templates
```yaml
sms_templates:
  order_received:
    message: "Thanks! Your order #{{order_number}} is being prepared. We'll text you when it's ready!"

  order_ready:
    message: "🔔 Your order #{{order_number}} is READY! Please pick up at {{pickup_location}}."

  reminder:
    message: "Reminder: Order #{{order_number}} is still waiting for pickup at {{pickup_location}}."
```

#### SMS Settings
- [ ] Enable/disable by order type
- [ ] Opt-in requirements
- [ ] Character limits
- [ ] Carrier compliance

### Integration with KDS

#### Bump-to-Alert Flow
```
Order Received → Kitchen → Expo Bumps → Alert Triggered
                                            ↓
                            ┌───────────────┼───────────────┐
                            ↓               ↓               ↓
                        Pager Buzz     SMS Sent      Display Update
```

### Alert Status Tracking

#### Status Dashboard
- [ ] Pending alerts
- [ ] Sent alerts
- [ ] Picked up orders
- [ ] Overdue pickups

---

## UI/UX Specifications

### Buzzer Assignment (at Checkout)

```
+------------------------------------------------------------------+
| ORDER #1247 - COMPLETE                                            |
+------------------------------------------------------------------+
|                                                                   |
| NOTIFICATION METHOD                                               |
|                                                                   |
| +------------------+ +------------------+ +------------------+    |
| |    📟 PAGER      | |    📱 SMS        | |   🔔 DISPLAY    |    |
| |                  | |                  | |     ONLY        |    |
| |  [Assign #___]   | | [Enter Phone]    | |   [Order #]     |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| PAGER QUICK ASSIGN:                                               |
| [01] [02] [03] [04] [05] [06] [07] [08] [09] [10]                |
| [11] [12] [13] [14] [15] [16] [17] [18] [19] [20]                |
|                                                                   |
| -- OR --                                                          |
|                                                                   |
| SMS: [(___) ___-____]                                            |
| [ ] Send order confirmation now                                   |
|                                                                   |
| [Skip Notification]                         [Confirm & Complete]  |
+------------------------------------------------------------------+
```

### Pager Dashboard

```
+------------------------------------------------------------------+
| PAGER MANAGEMENT                                     Jan 27, 2026 |
+------------------------------------------------------------------+
|                                                                   |
| ACTIVE PAGERS (12 of 20 in use)                                   |
| +--------------------------------------------------------------+ |
| | # | Order  | Assigned | Status      | Time Out | Actions     | |
| +--------------------------------------------------------------+ |
| |01 | #1245  | 12:30 PM | 🟢 Alerting | -        | [Re-Alert]  | |
| |02 | #1246  | 12:32 PM | 🟡 Waiting  | -        | [Alert Now] | |
| |03 | #1247  | 12:35 PM | 🔵 Prepping | -        | [Return]    | |
| |05 | #1248  | 12:20 PM | 🔴 Overdue  | 15 min   | [Re-Alert]  | |
| |07 | #1249  | 12:38 PM | 🔵 Prepping | -        | -           | |
| +--------------------------------------------------------------+ |
|                                                                   |
| AVAILABLE: 01, 04, 06, 08, 09, 10, 11-20                         |
|                                                                   |
| PAGER INVENTORY                                                   |
| Total: 20 | In Use: 12 | Available: 8 | Missing: 0              |
|                                                                   |
| [Mark All Returned]  [Find Missing]  [Inventory Count]           |
+------------------------------------------------------------------+
```

### SMS Alert Log

```
+------------------------------------------------------------------+
| SMS ALERTS                                        Today           |
+------------------------------------------------------------------+
|                                                                   |
| RECENT ALERTS                                                     |
| +--------------------------------------------------------------+ |
| | Time     | Order | Phone        | Type     | Status          | |
| +--------------------------------------------------------------+ |
| | 12:45 PM | #1250 | (555)123-4567| Ready    | ✓ Delivered     | |
| | 12:42 PM | #1249 | (555)234-5678| Ready    | ✓ Delivered     | |
| | 12:40 PM | #1248 | (555)345-6789| Reminder | ✓ Delivered     | |
| | 12:38 PM | #1247 | (555)456-7890| Confirm  | ✓ Delivered     | |
| | 12:35 PM | #1246 | (555)567-8901| Ready    | ⚠ Failed        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| TODAY'S STATS                                                     |
| Sent: 47 | Delivered: 45 | Failed: 2 | Avg Response: 2.5 min    |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Data Model

### Pagers
```sql
pagers {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  pager_number: VARCHAR(10)
  pager_type: VARCHAR(50) (vetech, lrs, coaster, generic)
  device_id: VARCHAR(100) (nullable) -- Hardware ID

  status: VARCHAR(50) (available, in_use, missing, maintenance)
  battery_level: INTEGER (nullable)

  last_used: TIMESTAMP (nullable)
  last_returned: TIMESTAMP (nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Order Notifications
```sql
order_notifications {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  order_id: UUID (FK)

  -- Method
  notification_type: VARCHAR(50) (pager, sms, push, display)

  -- Pager
  pager_id: UUID (FK, nullable)
  pager_number: VARCHAR(10) (nullable)

  -- SMS
  phone_number: VARCHAR(20) (nullable)

  -- Status
  status: VARCHAR(50) (pending, sent, delivered, failed, picked_up)

  -- Timing
  assigned_at: TIMESTAMP
  alert_sent_at: TIMESTAMP (nullable)
  picked_up_at: TIMESTAMP (nullable)

  -- Tracking
  alert_count: INTEGER DEFAULT 0
  last_alert_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Alert Log
```sql
alert_log {
  id: UUID PRIMARY KEY
  notification_id: UUID (FK)
  location_id: UUID (FK)

  alert_type: VARCHAR(50) (initial, reminder, manual)

  -- For SMS
  message_content: TEXT (nullable)
  delivery_status: VARCHAR(50) (nullable)
  carrier_response: TEXT (nullable)

  -- For Pager
  pager_response: VARCHAR(50) (nullable)

  sent_at: TIMESTAMP
  delivered_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

### Buzzer Settings
```sql
buzzer_settings {
  location_id: UUID PRIMARY KEY (FK)

  -- Pager settings
  pager_system: VARCHAR(50) (vetech, lrs, none)
  pager_api_endpoint: VARCHAR(500) (nullable)
  pager_api_key: VARCHAR(200) (nullable)
  total_pagers: INTEGER DEFAULT 20

  -- SMS settings
  sms_enabled: BOOLEAN DEFAULT true
  sms_confirmation: BOOLEAN DEFAULT true
  sms_ready_alert: BOOLEAN DEFAULT true
  sms_reminder_enabled: BOOLEAN DEFAULT true
  sms_reminder_minutes: INTEGER DEFAULT 10

  -- Trigger settings
  trigger_on: VARCHAR(50) DEFAULT 'expo_bump' -- station_bump, expo_bump, manual

  -- Timeouts
  overdue_minutes: INTEGER DEFAULT 10
  auto_reminder_minutes: INTEGER DEFAULT 8

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Pagers
```
GET    /api/pagers
POST   /api/pagers
PUT    /api/pagers/{id}
GET    /api/pagers/available
POST   /api/pagers/{id}/return
GET    /api/pagers/inventory
```

### Notifications
```
POST   /api/orders/{id}/notification
GET    /api/orders/{id}/notification
POST   /api/orders/{id}/alert
POST   /api/orders/{id}/alert/resend
PUT    /api/orders/{id}/notification/picked-up
```

### SMS
```
POST   /api/sms/send
GET    /api/sms/log
GET    /api/sms/stats
```

### Dashboard
```
GET    /api/buzzer/dashboard
GET    /api/buzzer/active
GET    /api/buzzer/overdue
```

---

## Business Rules

1. **One Notification Per Order:** Each order has one active notification method
2. **Auto-Alert:** Alert triggered automatically based on configured trigger point
3. **Reminder Logic:** Send reminder if not picked up within threshold
4. **Pager Availability:** Cannot assign pager that's already in use
5. **SMS Opt-In:** Comply with SMS marketing regulations (TCPA)
6. **Return Tracking:** Pagers auto-timeout if not returned

---

## Permissions

| Action | Cashier | Manager | Admin |
|--------|---------|---------|-------|
| Assign pagers | Yes | Yes | Yes |
| Send SMS alerts | Yes | Yes | Yes |
| Re-alert | Yes | Yes | Yes |
| Mark picked up | Yes | Yes | Yes |
| View dashboard | Yes | Yes | Yes |
| Configure settings | No | Yes | Yes |
| Manage inventory | No | Yes | Yes |
| View SMS log | No | Yes | Yes |

---

## Configuration Options

```yaml
buzzer_system:
  pagers:
    enabled: true
    system: "vetech"  # vetech, lrs, generic
    total_count: 20
    timeout_minutes: 15

  sms:
    enabled: true
    provider: "twilio"
    send_confirmation: true
    send_ready_alert: true
    send_reminder: true
    reminder_delay_minutes: 8

  triggers:
    alert_on: "expo_bump"  # station_bump, expo_bump, manual
    auto_alert: true

  display:
    show_on_customer_screen: true
    announce_audio: true
    flash_ready: true

  messages:
    confirmation: "Order #{number} received! We'll notify you when ready."
    ready: "Order #{number} is READY! Pick up at the counter."
    reminder: "Your order #{number} is still waiting for pickup."
```

---

## Hardware Integrations

### Vetech Pagers
- API integration for pager control
- Battery monitoring
- Range alerts

### LRS Pagers
- Serial/USB connection
- Coaster pager support
- Status feedback

### Generic/Custom
- HTTP webhook triggers
- Custom hardware protocols

---

*Last Updated: January 27, 2026*
