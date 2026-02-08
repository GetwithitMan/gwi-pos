# 25 - Reservations

**Status:** Planning
**Priority:** Medium
**Dependencies:** 04-Order-Management, 26-Host-Management

---

## Overview

The Reservations skill manages table bookings, waitlist, and guest capacity planning. Includes online booking, confirmation notifications, and integration with the host stand and floor plan.

**Primary Goal:** Maximize seating efficiency while providing excellent guest experience through organized reservation management.

---

## User Stories

### As a Guest...
- I want to book a table online for a specific time
- I want to receive confirmation and reminders
- I want to modify or cancel my reservation easily
- I want to join a waitlist if no tables available

### As a Host...
- I want to see all reservations for today
- I want to seat reservations efficiently
- I want to manage the waitlist
- I want to accommodate walk-ins around reservations

### As a Manager...
- I want to control available booking slots
- I want to see no-show rates
- I want to set reservation policies
- I want to block dates for private events

---

## Features

### Reservation Booking

#### Booking Channels
- [ ] Online widget (website)
- [ ] Phone (manual entry)
- [ ] Walk-in advance booking
- [ ] Third-party (OpenTable, Resy)
- [ ] Google Reserve integration

#### Booking Information
- [ ] Guest name
- [ ] Party size
- [ ] Date and time
- [ ] Phone number
- [ ] Email
- [ ] Special requests/notes
- [ ] Occasion (birthday, anniversary)
- [ ] Dietary restrictions

#### Booking Rules
- [ ] Advance booking window (how far ahead)
- [ ] Minimum party size
- [ ] Maximum party size
- [ ] Time slot intervals (15 min, 30 min)
- [ ] Turn time expectations
- [ ] Table assignment rules

### Availability Management

#### Capacity Control
- [ ] Tables available per time slot
- [ ] Covers per time slot
- [ ] Overbooking allowance
- [ ] Buffer between reservations

#### Time Slot Configuration
```yaml
time_slots:
  dinner:
    start: "17:00"
    end: "22:00"
    interval_minutes: 30
    turn_time_minutes: 90
    max_covers_per_slot: 40

  brunch:
    days: [saturday, sunday]
    start: "10:00"
    end: "15:00"
    interval_minutes: 30
    turn_time_minutes: 75
```

#### Blocked Dates
- [ ] Full closure
- [ ] Private events
- [ ] Reduced capacity
- [ ] Custom availability

### Table Assignment

#### Auto-Assignment
- [ ] Smart table suggestions
- [ ] Party size matching
- [ ] Section balancing
- [ ] Preference matching

#### Manual Assignment
- [ ] Drag to specific table
- [ ] Override suggestions
- [ ] Notes for assignment

#### Assignment Considerations
- [ ] Table capacity vs party size
- [ ] Server sections
- [ ] Guest preferences
- [ ] Accessibility needs

### Waitlist Management

#### Adding to Waitlist
- [ ] Quote wait time
- [ ] Collect contact info
- [ ] Party size
- [ ] Seating preferences

#### Waitlist Features
- [ ] Real-time wait estimates
- [ ] Position in queue
- [ ] Text when ready
- [ ] Remove from list
- [ ] Promote to reservation

### Guest Communication

#### Confirmations
- [ ] Instant booking confirmation
- [ ] Email confirmation
- [ ] SMS confirmation
- [ ] Calendar invite (ICS)

#### Reminders
- [ ] 24-hour reminder
- [ ] 2-hour reminder
- [ ] Customizable timing
- [ ] Confirmation request

#### Updates
- [ ] Modification confirmation
- [ ] Cancellation confirmation
- [ ] Table ready notification
- [ ] Thank you follow-up

### No-Show Management

#### No-Show Handling
- [ ] Mark as no-show
- [ ] Grace period before releasing table
- [ ] Track no-show history
- [ ] No-show penalties (optional)

#### Deposits/Holds
- [ ] Credit card hold option
- [ ] Deposit for large parties
- [ ] Cancellation fees
- [ ] Refund policies

### Integration

#### Floor Plan Integration
- [ ] Reservations visible on floor plan
- [ ] Table status updates
- [ ] Time remaining display

#### POS Integration
- [ ] Auto-create order for seated reservation
- [ ] Link guest history
- [ ] Special occasion flags

---

## UI/UX Specifications

### Reservation Calendar View

```
+------------------------------------------------------------------+
| RESERVATIONS                          January 27, 2026 (Today)   |
+------------------------------------------------------------------+
| [◄ Prev]  [Today]  [Next ►]           View: [Day] [Week] [Month] |
+------------------------------------------------------------------+
|                                                                  |
| 5:00 PM  | ████ Smith (4)      |                    |           |
|          | Table 5              |                    |           |
| ---------|---------------------|--------------------|-----------|
| 5:30 PM  | ████ Johnson (2)    | ████ Williams (6)  |           |
|          | Table 3              | Tables 8-9         |           |
| ---------|---------------------|--------------------|-----------|
| 6:00 PM  | ████ Brown (4)      | ████ Garcia (4)    | ████ Lee  |
|          | Table 5              | Table 12           | (2) T-3   |
| ---------|---------------------|--------------------|-----------|
| 6:30 PM  | ████ Davis (8)                           | ████ Kim  |
|          | Private Room                              | (4) T-10  |
| ---------|---------------------|--------------------|-----------|
| 7:00 PM  | ████ Wilson (4)     |                    |           |
|          | Table 6              |                    |           |
|                                                                  |
| WAITLIST (3)                      WALK-INS                       |
| 1. Martinez (4) - 25 min          Available: 2 tables           |
| 2. Taylor (2) - 15 min            Next slot: 7:30 PM            |
| 3. Anderson (6) - 45 min                                        |
|                                                                  |
+------------------------------------------------------------------+
| [+ New Reservation]  [+ Add to Waitlist]  [Block Time]          |
+------------------------------------------------------------------+
```

### New Reservation Modal

```
+------------------------------------------------------------------+
| NEW RESERVATION                                       [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| GUEST INFORMATION                                                |
| Name: [John Smith______________]  Phone: [(555) 123-4567]       |
| Email: [john@email.com_________]  Party Size: [4 ▼]             |
|                                                                  |
| DATE & TIME                                                      |
| Date: [January 27, 2026 ▼]        Time: [6:00 PM ▼]             |
|                                                                  |
| Available times: [5:30] [6:00] [6:30] [7:00] [7:30]             |
|                                                                  |
| TABLE ASSIGNMENT                                                 |
| ( ) Auto-assign                                                  |
| (•) Specific table: [Table 5 (4-top) ▼]                         |
|                                                                  |
| SPECIAL REQUESTS                                                 |
| Occasion: [Birthday ▼]                                          |
| Notes: [Window seat preferred, celebrating 50th__________]      |
| Dietary: [ ] Vegetarian  [ ] Vegan  [ ] Gluten-Free  [✓] Other |
|          [Shellfish allergy_____________________________]        |
|                                                                  |
| CONFIRMATION                                                     |
| [✓] Send email confirmation                                     |
| [✓] Send SMS confirmation                                       |
| [ ] Require credit card hold                                    |
|                                                                  |
| [Cancel]                                    [Create Reservation] |
+------------------------------------------------------------------+
```

### Reservation Detail / Seat Guest

```
+------------------------------------------------------------------+
| RESERVATION: Smith Party                              [Edit]     |
+------------------------------------------------------------------+
| Status: CONFIRMED → Ready to Seat                                |
+------------------------------------------------------------------+
|                                                                  |
| Guest: John Smith                    Party: 4                    |
| Phone: (555) 123-4567                Time: 6:00 PM              |
| Email: john@email.com                                            |
|                                                                  |
| TABLE: 5 (4-top by window)                                      |
|                                                                  |
| NOTES:                                                           |
| • Birthday celebration (50th)                                   |
| • Window seat preferred ✓                                       |
| • Shellfish allergy - ALERT KITCHEN                             |
|                                                                  |
| HISTORY:                                                         |
| • Created: Jan 25 via Online                                    |
| • Confirmed: Jan 26 via SMS                                     |
| • Reminder sent: Today 4:00 PM                                  |
|                                                                  |
| GUEST HISTORY: 3 previous visits                                |
| Last visit: Dec 15, 2025 - $156.00                             |
|                                                                  |
+------------------------------------------------------------------+
| [Cancel Reservation]  [Move to Waitlist]  [Seat Now]            |
+------------------------------------------------------------------+
```

---

## Data Model

### Reservations
```sql
reservations {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Guest info
  guest_name: VARCHAR(200)
  guest_phone: VARCHAR(20)
  guest_email: VARCHAR(200) (nullable)
  party_size: INTEGER

  -- Timing
  reservation_date: DATE
  reservation_time: TIME
  expected_end_time: TIME (nullable)
  estimated_duration_minutes: INTEGER

  -- Table
  table_id: UUID (FK, nullable)
  table_ids: UUID[] (nullable) -- For combined tables
  section_preference: VARCHAR(100) (nullable)

  -- Details
  occasion: VARCHAR(100) (nullable)
  notes: TEXT (nullable)
  dietary_restrictions: TEXT (nullable)
  special_requests: TEXT (nullable)

  -- Source
  source: VARCHAR(50) (online, phone, walkin, opentable, etc.)
  external_id: VARCHAR(100) (nullable)

  -- Status
  status: VARCHAR(50) (pending, confirmed, seated, completed, cancelled, no_show)
  confirmed_at: TIMESTAMP (nullable)
  seated_at: TIMESTAMP (nullable)
  completed_at: TIMESTAMP (nullable)
  cancelled_at: TIMESTAMP (nullable)
  cancellation_reason: VARCHAR(200) (nullable)

  -- Deposit/Hold
  deposit_required: BOOLEAN DEFAULT false
  deposit_amount: DECIMAL(10,2) (nullable)
  card_token: VARCHAR(200) (nullable)

  -- Notifications
  confirmation_sent_at: TIMESTAMP (nullable)
  reminder_sent_at: TIMESTAMP (nullable)

  -- Link to order when seated
  order_id: UUID (FK, nullable)

  created_by: UUID (FK, nullable)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Waitlist
```sql
waitlist {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Guest info
  guest_name: VARCHAR(200)
  guest_phone: VARCHAR(20)
  party_size: INTEGER

  -- Timing
  added_at: TIMESTAMP
  quoted_wait_minutes: INTEGER
  estimated_seat_time: TIMESTAMP (nullable)

  -- Preferences
  section_preference: VARCHAR(100) (nullable)
  notes: TEXT (nullable)

  -- Status
  status: VARCHAR(50) (waiting, notified, seated, left, cancelled)
  notified_at: TIMESTAMP (nullable)
  seated_at: TIMESTAMP (nullable)
  removed_at: TIMESTAMP (nullable)

  -- If converted to reservation
  reservation_id: UUID (FK, nullable)

  -- If seated
  table_id: UUID (FK, nullable)
  order_id: UUID (FK, nullable)

  position: INTEGER -- Queue position

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Reservation Settings
```sql
reservation_settings {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Booking window
  advance_booking_days: INTEGER DEFAULT 30
  same_day_cutoff_hours: INTEGER DEFAULT 2

  -- Capacity
  default_turn_time_minutes: INTEGER DEFAULT 90
  max_party_size: INTEGER DEFAULT 10
  large_party_threshold: INTEGER DEFAULT 6

  -- Time slots
  slot_interval_minutes: INTEGER DEFAULT 30

  -- Policies
  require_confirmation: BOOLEAN DEFAULT false
  confirmation_deadline_hours: INTEGER DEFAULT 24
  no_show_grace_minutes: INTEGER DEFAULT 15

  -- Deposits
  require_deposit_above_party_size: INTEGER (nullable)
  deposit_amount: DECIMAL(10,2) (nullable)

  -- Notifications
  send_confirmation_email: BOOLEAN DEFAULT true
  send_confirmation_sms: BOOLEAN DEFAULT true
  send_reminder: BOOLEAN DEFAULT true
  reminder_hours_before: INTEGER DEFAULT 24

  updated_at: TIMESTAMP
}
```

### Blocked Times
```sql
reservation_blocks {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  block_date: DATE
  start_time: TIME (nullable) -- NULL = all day
  end_time: TIME (nullable)

  block_type: VARCHAR(50) (closed, private_event, reduced_capacity)
  reduced_capacity_percent: INTEGER (nullable)

  reason: VARCHAR(200) (nullable)

  created_by: UUID (FK)
  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Reservations
```
GET    /api/reservations
POST   /api/reservations
GET    /api/reservations/{id}
PUT    /api/reservations/{id}
DELETE /api/reservations/{id}
POST   /api/reservations/{id}/confirm
POST   /api/reservations/{id}/seat
POST   /api/reservations/{id}/no-show
POST   /api/reservations/{id}/cancel
```

### Availability
```
GET    /api/reservations/availability?date={date}&party_size={size}
GET    /api/reservations/time-slots?date={date}
```

### Waitlist
```
GET    /api/waitlist
POST   /api/waitlist
PUT    /api/waitlist/{id}
DELETE /api/waitlist/{id}
POST   /api/waitlist/{id}/notify
POST   /api/waitlist/{id}/seat
POST   /api/waitlist/{id}/convert-to-reservation
```

### Settings
```
GET    /api/locations/{loc}/reservation-settings
PUT    /api/locations/{loc}/reservation-settings
```

### Blocks
```
GET    /api/locations/{loc}/reservation-blocks
POST   /api/locations/{loc}/reservation-blocks
DELETE /api/locations/{loc}/reservation-blocks/{id}
```

### Public Booking Widget
```
GET    /api/public/reservations/availability
POST   /api/public/reservations
GET    /api/public/reservations/{id}
PUT    /api/public/reservations/{id}/cancel
```

---

## Business Rules

1. **Capacity Check:** Cannot overbook beyond capacity
2. **Confirmation Window:** Unconfirmed reservations may be released
3. **No-Show Tracking:** Track no-shows for repeat offenders
4. **Table Matching:** Suggest appropriate table size for party
5. **Turn Time:** Allow buffer between reservations
6. **Grace Period:** Wait X minutes before marking no-show

---

## Permissions

| Action | Host | Server | Manager | Admin |
|--------|------|--------|---------|-------|
| View reservations | Yes | Yes | Yes | Yes |
| Create reservations | Yes | No | Yes | Yes |
| Modify reservations | Yes | No | Yes | Yes |
| Cancel reservations | Yes | No | Yes | Yes |
| Seat reservations | Yes | No | Yes | Yes |
| Manage waitlist | Yes | No | Yes | Yes |
| Configure settings | No | No | Yes | Yes |
| Block dates | No | No | Yes | Yes |

---

## Configuration Options

```yaml
reservations:
  booking:
    advance_days: 30
    same_day_cutoff_hours: 2
    slot_interval_minutes: 30
    max_party_size: 12

  capacity:
    default_turn_time_minutes: 90
    overbooking_percent: 10
    buffer_minutes: 15

  notifications:
    confirmation: true
    reminder_hours: 24
    sms_enabled: true
    email_enabled: true

  policies:
    require_confirmation: false
    no_show_grace_minutes: 15
    cancellation_deadline_hours: 4

  deposits:
    required_above_party_size: 8
    amount: 50.00
    cancellation_refund_hours: 24
```

---

## Open Questions

1. **Third-Party Integration:** OpenTable, Resy, Yelp priority?

2. **Deposit Processing:** Use primary payment processor?

3. **Guest Database:** Integrate with CRM/loyalty?

4. **Wait Time Accuracy:** Algorithm for estimating wait?

5. **Multi-Location:** Share guest profiles across locations?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Booking flow finalized
- [ ] Notification templates

### Development
- [ ] Reservation CRUD
- [ ] Availability engine
- [ ] Waitlist management
- [ ] Notification system
- [ ] Public booking widget
- [ ] Third-party integrations

---

*Last Updated: January 27, 2026*
