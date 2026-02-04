# 41 - Ticketing & Events

**Status:** Planning
**Priority:** Medium
**Dependencies:** 04-Order-Management, 27-Texting-SMS, 40-Bouncer-Door

---

## Overview

The Ticketing & Events skill handles event creation, ticket sales, digital ticket delivery, entry scanning, and attendance tracking. Supports general admission, reserved seating, VIP packages, and multi-day events. Integrates with door management for seamless entry.

**Primary Goal:** Enable venues to sell tickets, manage events, and track attendance with a seamless entry experience.

---

## User Stories

### As a Customer...
- I want to buy tickets online or in-person
- I want to receive my tickets digitally
- I want easy entry with my mobile ticket
- I want to transfer tickets to friends

### As a Door Staff...
- I want to quickly scan tickets
- I want to see ticket validity instantly
- I want to handle re-entry scenarios
- I want to spot duplicate/fake tickets

### As a Manager...
- I want to create and manage events
- I want to set pricing tiers
- I want to track sales and attendance
- I want to see real-time entry counts

---

## Features

### Event Management

#### Event Creation
- [ ] Event name and description
- [ ] Date and time
- [ ] Single or recurring
- [ ] Multi-day events
- [ ] Venue/room assignment
- [ ] Event images

#### Event Types
- [ ] General admission
- [ ] Reserved seating
- [ ] Standing room
- [ ] VIP sections
- [ ] Table reservations

### Ticket Types

#### Pricing Tiers
- [ ] General admission
- [ ] VIP/Premium
- [ ] Early bird
- [ ] Group rates
- [ ] Promo codes
- [ ] Complimentary

#### Ticket Options
```yaml
ticket_types:
  - name: "General Admission"
    price: 25.00
    quantity: 200
    includes: ["Entry"]

  - name: "VIP"
    price: 75.00
    quantity: 50
    includes:
      - "Entry"
      - "VIP Lounge Access"
      - "2 Drink Tickets"

  - name: "Table Package"
    price: 500.00
    quantity: 10
    includes:
      - "Entry for 6"
      - "Reserved Table"
      - "1 Bottle"
```

### Ticket Sales

#### Sales Channels
- [ ] POS in-person sales
- [ ] Online sales (website)
- [ ] Mobile app
- [ ] Third-party integration

#### Purchase Flow
- [ ] Select event
- [ ] Choose ticket type
- [ ] Enter quantity
- [ ] Apply promo code
- [ ] Collect payment
- [ ] Deliver tickets

### Digital Tickets

#### Ticket Format
- [ ] QR code
- [ ] Barcode
- [ ] Mobile wallet (Apple/Google)
- [ ] PDF attachment

#### Ticket Delivery
- [ ] Email delivery
- [ ] SMS delivery
- [ ] In-app display
- [ ] Print at home

#### Ticket Contents
```
+------------------------------------------+
|          🎫 EVENT TICKET                  |
+------------------------------------------+
|                                          |
|  Saturday Night Live Music               |
|  January 27, 2026 • 9:00 PM             |
|                                          |
|  The Venue                               |
|  123 Main Street                         |
|                                          |
|  GENERAL ADMISSION                       |
|  1 Guest                                 |
|                                          |
|         [QR CODE HERE]                   |
|                                          |
|  Ticket #: TKT-2026-001234              |
|  Order #: ORD-5678                       |
|                                          |
|  Present this ticket at the door         |
|  for entry. Screenshot accepted.         |
|                                          |
+------------------------------------------+
```

### Entry Scanning

#### Scan Process
- [ ] Scan QR/barcode
- [ ] Validate ticket
- [ ] Check re-entry status
- [ ] Mark as entered
- [ ] Display result

#### Scan Results
```
+------------------------------------------+
| ✓ VALID TICKET - ALLOW ENTRY             |
+------------------------------------------+
| Event: Saturday Night Live Music         |
| Type: General Admission                  |
| Purchased by: John Smith                 |
|                                          |
| Status: First Entry                      |
| Time: 9:15 PM                            |
+------------------------------------------+
```

```
+------------------------------------------+
| ⚠️ RE-ENTRY                              |
+------------------------------------------+
| Event: Saturday Night Live Music         |
| Type: General Admission                  |
|                                          |
| Previous Entry: 9:15 PM                  |
| Exit: 10:30 PM                           |
| Re-entries: 1 of 2 allowed              |
+------------------------------------------+
| [ALLOW RE-ENTRY]  [DENY - Too Many]     |
+------------------------------------------+
```

```
+------------------------------------------+
| ⛔ INVALID TICKET                        |
+------------------------------------------+
| Reason: Already scanned                  |
| First scan: 9:15 PM by Door 1           |
|                                          |
| [View Details]  [Override - Manager]    |
+------------------------------------------+
```

### Re-Entry Rules

#### Re-Entry Configuration
- [ ] No re-entry allowed
- [ ] Unlimited re-entry
- [ ] Limited re-entries (1, 2, 3)
- [ ] Time-based (within X hours)
- [ ] Wristband required

### Ticket Transfer

#### Transfer Options
- [ ] Transfer to email
- [ ] Transfer to phone
- [ ] Revoke original
- [ ] Transfer history

### Promo Codes

#### Code Types
- [ ] Percentage discount
- [ ] Fixed amount off
- [ ] Free tickets
- [ ] BOGO deals
- [ ] Limited quantity

#### Code Settings
```yaml
promo_codes:
  - code: "EARLYBIRD"
    type: "percent"
    value: 20
    max_uses: 100
    valid_until: "2026-01-20"

  - code: "VIP50"
    type: "fixed"
    value: 50.00
    applies_to: ["VIP"]
    max_uses: 25

  - code: "COMP"
    type: "free"
    requires_approval: true
```

### Reporting

#### Sales Reports
- [ ] Tickets sold by type
- [ ] Revenue by event
- [ ] Sales by channel
- [ ] Promo code usage

#### Attendance Reports
- [ ] Entry counts
- [ ] Entry by time
- [ ] No-shows
- [ ] Re-entry stats

---

## UI/UX Specifications

### Event Creation

```
+------------------------------------------------------------------+
| CREATE EVENT                                              [Save]  |
+------------------------------------------------------------------+
|                                                                   |
| BASIC INFO                                                        |
| Event Name: [Saturday Night Live Music___________________]       |
| Description:                                                      |
| [Live music featuring local bands. 21+ event.___________]        |
|                                                                   |
| DATE & TIME                                                       |
| Date: [Jan 27, 2026]  Start: [9:00 PM]  End: [2:00 AM]          |
| Doors Open: [8:30 PM]                                            |
| [ ] Recurring Event                                               |
|                                                                   |
| VENUE                                                             |
| Location: [Main Floor ▼]  Capacity: [300]                        |
|                                                                   |
| TICKET TYPES                                      [+ Add Type]    |
| +--------------------------------------------------------------+ |
| | General Admission | $25.00  | 200 available | [Edit] [Del]   | |
| | VIP              | $75.00  | 50 available  | [Edit] [Del]   | |
| | Table Package    | $500.00 | 10 available  | [Edit] [Del]   | |
| +--------------------------------------------------------------+ |
|                                                                   |
| SETTINGS                                                          |
| [✓] Allow online sales                                           |
| [✓] Allow in-person sales                                        |
| [✓] Allow re-entry (max: [2] times)                             |
| [ ] Reserved seating                                              |
|                                                                   |
| [Cancel]                                     [Create Event]       |
+------------------------------------------------------------------+
```

### Ticket Sales (POS)

```
+------------------------------------------------------------------+
| SELL TICKETS                                                      |
+------------------------------------------------------------------+
|                                                                   |
| SELECT EVENT                                                      |
| +--------------------------------------------------------------+ |
| | Jan 27 | Saturday Night Live Music    | 156/300 sold         | |
| | Jan 28 | Sunday Brunch                | 45/100 sold          | |
| | Feb 3  | Super Bowl Party             | 89/250 sold          | |
| +--------------------------------------------------------------+ |
|                                                                   |
| SELECTED: Saturday Night Live Music - Jan 27                     |
|                                                                   |
| TICKET TYPES                                                      |
| +--------------------------------------------------------------+ |
| | Type              | Price   | Available | Qty                 | |
| | General Admission | $25.00  | 44        | [__2_]              | |
| | VIP               | $75.00  | 12        | [__0_]              | |
| | Table Package     | $500.00 | 3         | [__0_]              | |
| +--------------------------------------------------------------+ |
|                                                                   |
| Promo Code: [____________] [Apply]                               |
|                                                                   |
| DELIVERY                                                          |
| (•) Email: [customer@email.com_________]                         |
| ( ) SMS: [_______________]                                       |
| ( ) Print Now                                                    |
|                                                                   |
| SUMMARY                                                           |
| 2x General Admission @ $25.00                           $50.00   |
| Service Fee                                              $5.00   |
| ─────────────────────────────────────────────────────────────    |
| Total                                                   $55.00   |
|                                                                   |
| [Cancel]                                      [Process Payment]   |
+------------------------------------------------------------------+
```

### Entry Scanner

```
+------------------------------------------------------------------+
| TICKET SCANNER                          Event: Saturday Night     |
+------------------------------------------------------------------+
|                                                                   |
|                    [======= CAMERA =======]                       |
|                    |                       |                       |
|                    |   Point at QR Code   |                       |
|                    |                       |                       |
|                    [=======================]                       |
|                                                                   |
| LAST SCAN:                                                        |
| +--------------------------------------------------------------+ |
| | ✓ VALID - ENTRY ALLOWED                          9:15:32 PM  | |
| | John Smith - General Admission                                | |
| | Ticket #TKT-2026-001234                                       | |
| +--------------------------------------------------------------+ |
|                                                                   |
| STATS                                                             |
| +------------------+ +------------------+ +------------------+    |
| | Scanned: 156     | | Re-entries: 12   | | Denied: 3        |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| [Manual Entry]  [Search Ticket]  [View Denied]                   |
|                                                                   |
+------------------------------------------------------------------+
```

### Event Dashboard

```
+------------------------------------------------------------------+
| EVENT: Saturday Night Live Music                    Jan 27, 2026  |
+------------------------------------------------------------------+
|                                                                   |
| SALES                                                             |
| +------------------+ +------------------+ +------------------+    |
| | Tickets Sold     | | Revenue          | | Available        |    |
| | 256 / 300        | | $7,450.00        | | 44 tickets       |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| BY TYPE                                                           |
| General Admission: 200 sold ($5,000) | 0 remaining              |
| VIP:               38 sold ($2,850)  | 12 remaining             |
| Table Package:      4 sold ($2,000)  | 6 remaining              |
|                                                                   |
| ATTENDANCE (Live)                                                 |
| +------------------+ +------------------+ +------------------+    |
| | Inside Now       | | Total Entries    | | Re-entries       |    |
| | 189              | | 201              | | 15               |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| ENTRY TIMELINE                                                    |
| 8PM [===]                                                        |
| 9PM [===============]                                            |
| 10PM [======================]                                    |
| 11PM [==========]                                                |
|                                                                   |
| [View All Tickets]  [Entry Log]  [Export Report]                |
+------------------------------------------------------------------+
```

---

## Data Model

### Events
```sql
events {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(200)
  description: TEXT (nullable)
  image_url: VARCHAR(500) (nullable)

  -- Timing
  event_date: DATE
  start_time: TIME
  end_time: TIME (nullable)
  doors_open_time: TIME (nullable)

  -- Recurring
  is_recurring: BOOLEAN DEFAULT false
  recurrence_rule: VARCHAR(100) (nullable)

  -- Capacity
  venue_area: VARCHAR(100) (nullable)
  total_capacity: INTEGER

  -- Settings
  allow_online_sales: BOOLEAN DEFAULT true
  allow_pos_sales: BOOLEAN DEFAULT true
  allow_reentry: BOOLEAN DEFAULT true
  max_reentries: INTEGER DEFAULT 2

  -- Status
  status: VARCHAR(50) (draft, published, cancelled, completed)
  published_at: TIMESTAMP (nullable)

  created_by: UUID (FK)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Ticket Types
```sql
ticket_types {
  id: UUID PRIMARY KEY
  event_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)
  price: DECIMAL(10,2)
  quantity_total: INTEGER
  quantity_sold: INTEGER DEFAULT 0

  -- Includes
  includes: TEXT[] (nullable)

  -- Limits
  min_per_order: INTEGER DEFAULT 1
  max_per_order: INTEGER DEFAULT 10

  -- Availability
  sale_start: TIMESTAMP (nullable)
  sale_end: TIMESTAMP (nullable)

  is_active: BOOLEAN DEFAULT true
  sort_order: INTEGER

  created_at: TIMESTAMP
}
```

### Tickets
```sql
tickets {
  id: UUID PRIMARY KEY
  event_id: UUID (FK)
  ticket_type_id: UUID (FK)
  order_id: UUID (FK)

  -- Ticket identification
  ticket_number: VARCHAR(50) UNIQUE
  barcode: VARCHAR(100) UNIQUE
  qr_code_data: TEXT

  -- Purchaser
  purchaser_name: VARCHAR(200)
  purchaser_email: VARCHAR(200)
  purchaser_phone: VARCHAR(20) (nullable)

  -- Delivery
  delivery_method: VARCHAR(50) (email, sms, print)
  delivered_at: TIMESTAMP (nullable)

  -- Transfer
  transferred_to_email: VARCHAR(200) (nullable)
  transferred_at: TIMESTAMP (nullable)
  original_ticket_id: UUID (FK, nullable)

  -- Status
  status: VARCHAR(50) (active, used, transferred, refunded, cancelled)

  -- Entry
  scanned_at: TIMESTAMP (nullable)
  scanned_by: UUID (FK, nullable)
  entry_count: INTEGER DEFAULT 0
  last_entry_at: TIMESTAMP (nullable)
  last_exit_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

### Ticket Scans
```sql
ticket_scans {
  id: UUID PRIMARY KEY
  ticket_id: UUID (FK)
  event_id: UUID (FK)

  scan_type: VARCHAR(50) (entry, exit, reentry, denied)
  scan_result: VARCHAR(50) (valid, invalid, duplicate, expired)
  denial_reason: VARCHAR(200) (nullable)

  scanned_by: UUID (FK)
  scanned_at: TIMESTAMP
  door_location: VARCHAR(100) (nullable)

  created_at: TIMESTAMP
}
```

### Promo Codes
```sql
ticket_promo_codes {
  id: UUID PRIMARY KEY
  event_id: UUID (FK, nullable) -- null = all events
  location_id: UUID (FK)

  code: VARCHAR(50) UNIQUE
  description: TEXT (nullable)

  discount_type: VARCHAR(50) (percent, fixed, free)
  discount_value: DECIMAL(10,2)

  -- Restrictions
  applies_to_types: UUID[] (nullable) -- null = all
  min_quantity: INTEGER DEFAULT 1
  max_uses: INTEGER (nullable)
  uses_count: INTEGER DEFAULT 0

  -- Validity
  valid_from: TIMESTAMP (nullable)
  valid_until: TIMESTAMP (nullable)
  requires_approval: BOOLEAN DEFAULT false

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Events
```
GET    /api/events
POST   /api/events
GET    /api/events/{id}
PUT    /api/events/{id}
DELETE /api/events/{id}
POST   /api/events/{id}/publish
POST   /api/events/{id}/cancel
```

### Ticket Types
```
GET    /api/events/{id}/ticket-types
POST   /api/events/{id}/ticket-types
PUT    /api/ticket-types/{id}
DELETE /api/ticket-types/{id}
```

### Tickets
```
POST   /api/events/{id}/tickets/purchase
GET    /api/tickets/{id}
POST   /api/tickets/{id}/resend
POST   /api/tickets/{id}/transfer
POST   /api/tickets/{id}/refund
GET    /api/tickets/lookup?code={code}
```

### Scanning
```
POST   /api/events/{id}/scan
GET    /api/events/{id}/scans
POST   /api/tickets/{id}/entry
POST   /api/tickets/{id}/exit
```

### Promo Codes
```
GET    /api/events/{id}/promo-codes
POST   /api/events/{id}/promo-codes
PUT    /api/promo-codes/{id}
POST   /api/promo-codes/validate
```

### Reports
```
GET    /api/events/{id}/sales-report
GET    /api/events/{id}/attendance-report
GET    /api/events/{id}/entry-timeline
```

---

## Business Rules

1. **Ticket Uniqueness:** Each ticket has unique number and QR code
2. **One Entry Per Ticket:** Ticket marked as used after first scan
3. **Re-Entry Tracking:** Track entries/exits for re-entry enforcement
4. **Promo Limits:** Enforce max uses on promo codes
5. **Capacity Check:** Cannot sell more than capacity allows
6. **Transfer Chain:** Track full transfer history

---

## Permissions

| Action | Door Staff | Manager | Admin |
|--------|------------|---------|-------|
| Scan tickets | Yes | Yes | Yes |
| Sell tickets (POS) | Yes | Yes | Yes |
| Create events | No | Yes | Yes |
| Edit events | No | Yes | Yes |
| Create promo codes | No | Yes | Yes |
| Override denied entry | No | Yes | Yes |
| Refund tickets | No | Yes | Yes |
| View reports | No | Yes | Yes |

---

## Configuration Options

```yaml
ticketing:
  sales:
    service_fee_type: "fixed"  # fixed, percent
    service_fee_amount: 2.50
    allow_refunds: true
    refund_deadline_hours: 24

  tickets:
    format: "qr"  # qr, barcode, both
    delivery_default: "email"
    allow_transfer: true
    allow_print_at_home: true

  entry:
    allow_reentry: true
    max_reentries: 2
    reentry_window_hours: 4
    track_exits: true

  scanning:
    sound_on_valid: true
    sound_on_invalid: true
    require_door_assignment: false
```

---

*Last Updated: January 27, 2026*
