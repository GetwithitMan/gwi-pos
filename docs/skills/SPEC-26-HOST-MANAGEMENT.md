# 26 - Host Management

**Status:** Planning
**Priority:** Medium
**Dependencies:** 04-Order-Management, 25-Reservations

---

## Overview

The Host Management skill provides a dedicated interface for host stand operations - greeting guests, managing the waitlist, seating parties, and coordinating with servers. Optimized for the host workflow.

**Primary Goal:** Streamline host operations to minimize wait times and optimize table utilization.

---

## User Stories

### As a Host...
- I want a clear view of available tables
- I want to quickly add walk-ins to the waitlist
- I want to see when reserved guests arrive
- I want to assign tables to the right server sections

### As a Manager...
- I want to see how efficiently we're seating guests
- I want to track wait times
- I want to balance server workloads
- I want to identify peak times

---

## Features

### Host Dashboard

#### Overview Display
- [ ] Current waitlist count
- [ ] Reservations arriving soon
- [ ] Available tables
- [ ] Estimated wait time
- [ ] Server section status

#### Floor Plan View
- [ ] Visual table layout
- [ ] Table status colors
- [ ] Time seated indicators
- [ ] Server assignments
- [ ] Reservation holds

### Guest Arrival

#### Walk-In Handling
- [ ] Quick party size entry
- [ ] Check table availability
- [ ] Seat immediately if available
- [ ] Add to waitlist if not

#### Reservation Arrival
- [ ] Search by name/phone
- [ ] Mark as arrived
- [ ] Confirm party size
- [ ] Seat at assigned table

### Waitlist Operations

#### Adding Guests
- [ ] Name
- [ ] Party size
- [ ] Phone number
- [ ] Seating preferences
- [ ] Quoted wait time

#### Managing Queue
- [ ] View queue order
- [ ] Reorder queue
- [ ] Update wait estimates
- [ ] Remove from list
- [ ] Text notification

#### Wait Time Display
- [ ] Estimated wait by party size
- [ ] Current average wait
- [ ] Historical comparison

### Table Management

#### Table Status
- [ ] **Available** - Ready to seat
- [ ] **Reserved** - Held for reservation
- [ ] **Occupied** - Currently in use
- [ ] **Bussing** - Being cleaned
- [ ] **Blocked** - Not available

#### Table Assignment
- [ ] Drag guest to table
- [ ] Auto-suggest best table
- [ ] Section balancing
- [ ] Combine tables option

#### Turn Management
- [ ] Time since seated
- [ ] Expected turn time
- [ ] "About to turn" indicators
- [ ] Table turn history

### Server Section Coordination

#### Section View
- [ ] Tables per section
- [ ] Covers per section
- [ ] Server assignments
- [ ] Current workload

#### Rotation Management
- [ ] Server rotation queue
- [ ] Fair distribution
- [ ] Skip in rotation
- [ ] Manual override

### Guest Communication

#### Notifications
- [ ] Table ready text
- [ ] Estimated time updates
- [ ] Custom messages

#### Check-In
- [ ] Self-check-in option
- [ ] QR code for waitlist
- [ ] Digital pager alternative

---

## UI/UX Specifications

### Host Dashboard

```
+------------------------------------------------------------------+
| HOST STAND                                          5:45 PM      |
+------------------------------------------------------------------+
| WAITLIST: 8 parties | EST WAIT: 25 min | NEXT RES: Smith 6:00 PM |
+------------------------------------------------------------------+
|                                                                  |
| FLOOR PLAN                              | UPCOMING               |
| +-------------------------------------+ | +--------------------+ |
| |     [1]    [2]    [3]    [4]       | | | RESERVATIONS       | |
| |     occ    occ    avl    res       | | | 6:00 Smith (4)     | |
| |     0:45   1:15   ---    6:00      | | | 6:00 Johnson (2)   | |
| |                                     | | | 6:30 Williams (6)  | |
| |  [5]    [6]    [7]    [8]    [9]   | | | 6:30 Brown (4)     | |
| |  occ    bus    occ    occ    avl   | | +--------------------+ |
| |  0:30   ---    0:55   1:20   ---   | | | WAITLIST           | |
| |                                     | | | 1. Martinez (4) 20m| |
| |     [10]   [11]   [12]             | | | 2. Taylor (2) 15m  | |
| |     avl    occ    avl              | | | 3. Wilson (6) 30m  | |
| |     ---    0:40   ---              | | | 4. Garcia (4) 25m  | |
| +-------------------------------------+ | +--------------------+ |
|                                                                  |
| LEGEND: [avl]=Available [occ]=Occupied [bus]=Bussing [res]=Reserved
| TIME = minutes seated                                            |
|                                                                  |
+------------------------------------------------------------------+
| QUICK ACTIONS                                                    |
| [+ Walk-In]  [+ Waitlist]  [Find Reservation]  [Text Guest]     |
+------------------------------------------------------------------+
```

### Seating Modal

```
+------------------------------------------------------------------+
| SEAT PARTY                                            [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| Party: Martinez (4)                                              |
| Wait Time: 22 minutes                                           |
| Notes: Booth preferred                                          |
|                                                                  |
| SELECT TABLE:                                                    |
| +-------------------------------------------------------------+ |
| | SUGGESTED                                                    | |
| | [Table 3] 4-top, Booth, Sarah's section        [Seat Here]  | |
| +-------------------------------------------------------------+ |
| | AVAILABLE                                                    | |
| | [Table 3] 4-top, Booth, Section A (Sarah)                   | |
| | [Table 10] 4-top, Window, Section B (Mike)                  | |
| | [Table 12] 6-top, Center, Section A (Sarah) *larger         | |
| +-------------------------------------------------------------+ |
|                                                                  |
| Combine Tables: [Table 3 + Table 4 ▼] for larger party          |
|                                                                  |
| SERVER: [Auto-assign ▼] or Sarah M. (Section A)                 |
|                                                                  |
| [Cancel]                                    [Seat at Table 3]    |
+------------------------------------------------------------------+
```

### Waitlist Entry

```
+------------------------------------------------------------------+
| ADD TO WAITLIST                                       [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| Name: [Martinez______________]                                   |
| Party Size: [4 ▼]                                               |
| Phone: [(555) 123-4567_______]                                  |
|                                                                  |
| PREFERENCES:                                                     |
| [ ] Booth     [✓] No preference                                 |
| [ ] Window    [ ] Quiet area                                    |
| [ ] Patio     [ ] High-top OK                                   |
|                                                                  |
| Notes: [_________________________________]                       |
|                                                                  |
| ESTIMATED WAIT: ~25 minutes                                     |
|                                                                  |
| [✓] Text when table ready                                       |
|                                                                  |
| [Cancel]                                    [Add to Waitlist]    |
+------------------------------------------------------------------+
```

### Server Sections

```
+------------------------------------------------------------------+
| SERVER SECTIONS                                                  |
+------------------------------------------------------------------+
|                                                                  |
| SECTION A - Sarah M.                    SECTION B - Mike J.     |
| +---------------------------+          +---------------------------+
| | Tables: 1, 2, 3, 4, 5    |          | Tables: 6, 7, 8, 9, 10   |
| | Covers: 12/20            |          | Covers: 16/20            |
| | Active: 3 tables         |          | Active: 4 tables         |
| +---------------------------+          +---------------------------+
|                                                                  |
| SECTION C - Lisa G.                    UNASSIGNED                |
| +---------------------------+          +---------------------------+
| | Tables: 11, 12           |          | Tables: None             |
| | Covers: 6/12             |          |                          |
| | Active: 2 tables         |          |                          |
| +---------------------------+          +---------------------------+
|                                                                  |
| ROTATION: Next seat goes to → Section B (Mike J.)               |
|                                                                  |
+------------------------------------------------------------------+
```

---

## Data Model

### Host Sessions
```sql
host_sessions {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  employee_id: UUID (FK)

  started_at: TIMESTAMP
  ended_at: TIMESTAMP (nullable)

  -- Stats
  parties_seated: INTEGER DEFAULT 0
  guests_seated: INTEGER DEFAULT 0
  average_wait_minutes: DECIMAL(5,2) (nullable)

  created_at: TIMESTAMP
}
```

### Seating Log
```sql
seating_log {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Guest
  source: VARCHAR(50) (walkin, reservation, waitlist)
  reservation_id: UUID (FK, nullable)
  waitlist_id: UUID (FK, nullable)
  party_size: INTEGER
  guest_name: VARCHAR(200)

  -- Table
  table_id: UUID (FK)
  combined_table_ids: UUID[] (nullable)

  -- Server
  server_id: UUID (FK)
  section_id: UUID (FK, nullable)

  -- Timing
  arrived_at: TIMESTAMP
  seated_at: TIMESTAMP
  wait_time_minutes: INTEGER

  -- Host
  seated_by: UUID (FK)

  created_at: TIMESTAMP
}
```

### Server Sections
```sql
server_sections {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(50)
  table_ids: UUID[]
  max_covers: INTEGER

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Section Assignments
```sql
section_assignments {
  id: UUID PRIMARY KEY
  section_id: UUID (FK)
  employee_id: UUID (FK)

  shift_date: DATE
  start_time: TIME
  end_time: TIME (nullable)

  -- Rotation tracking
  rotation_position: INTEGER
  last_seated_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

### Server Rotation
```sql
server_rotation {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  rotation_order: UUID[] -- Employee IDs in order
  current_position: INTEGER DEFAULT 0

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Host Operations
```
GET    /api/host/dashboard
GET    /api/host/floor-status
POST   /api/host/seat-party
POST   /api/host/table-status/{table_id}
```

### Waitlist
```
GET    /api/host/waitlist
POST   /api/host/waitlist
PUT    /api/host/waitlist/{id}
DELETE /api/host/waitlist/{id}
POST   /api/host/waitlist/{id}/notify
POST   /api/host/waitlist/{id}/seat
GET    /api/host/wait-estimate?party_size={size}
```

### Sections
```
GET    /api/host/sections
PUT    /api/host/sections
GET    /api/host/sections/assignments
POST   /api/host/sections/assignments
GET    /api/host/rotation
PUT    /api/host/rotation
POST   /api/host/rotation/next
POST   /api/host/rotation/skip
```

### Arrivals
```
GET    /api/host/arrivals
POST   /api/host/arrivals/check-in
GET    /api/host/reservations/arriving
```

---

## Business Rules

1. **Fair Rotation:** Servers receive tables in fair rotation
2. **Table Matching:** Suggest appropriately sized tables
3. **Section Balancing:** Avoid overloading one section
4. **Turn Awareness:** Consider expected turn times
5. **Preference Respect:** Honor guest seating preferences when possible

---

## Permissions

| Action | Host | Server | Manager | Admin |
|--------|------|--------|---------|-------|
| View floor status | Yes | Yes | Yes | Yes |
| Seat parties | Yes | No | Yes | Yes |
| Manage waitlist | Yes | No | Yes | Yes |
| Modify sections | No | No | Yes | Yes |
| Override rotation | No | No | Yes | Yes |
| View reports | No | No | Yes | Yes |

---

## Configuration Options

```yaml
host_management:
  waitlist:
    text_notification: true
    quote_wait_in_minutes: true
    allow_self_checkin: true

  seating:
    auto_suggest_table: true
    require_server_assignment: true
    allow_table_combining: true

  rotation:
    enabled: true
    fair_rotation: true
    consider_covers: true  # Not just table count

  display:
    show_time_seated: true
    turn_time_warning_minutes: 90
    section_view: true
```

---

## Open Questions

1. **Self-Service Waitlist:** Kiosk for guests to add themselves?

2. **Pager Integration:** Support for traditional pagers?

3. **Table Combining:** Automatic suggestions for large parties?

4. **Predictive Wait:** Use historical data for accurate estimates?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Host workflow mapped
- [ ] UI mockups

### Development
- [ ] Host dashboard
- [ ] Waitlist management
- [ ] Seating workflow
- [ ] Section management
- [ ] Rotation system
- [ ] Notifications

---

*Last Updated: January 27, 2026*
