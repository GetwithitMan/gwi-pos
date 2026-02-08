# 40 - Bouncer/Door Management

**Status:** Planning
**Priority:** Medium
**Dependencies:** 05-Employees-Roles, 04-Order-Management

---

## Overview

The Bouncer/Door Management skill provides tools for door staff - ID scanning/verification, blocked customer lists, photo capture for tab linking, capacity tracking, cover charges, and VIP guest lists. Essential for bars, nightclubs, and age-restricted venues.

**Primary Goal:** Streamline door operations with fast ID verification, customer tracking, and seamless tab creation.

---

## User Stories

### As a Bouncer...
- I want to quickly scan and verify IDs
- I want to see if someone is on the blocked list
- I want to capture photos for tab security
- I want to track entry counts

### As a Manager...
- I want to maintain a blocked customer list
- I want to track venue capacity
- I want to manage VIP guest lists
- I want to see door activity reports

### As a Bartender...
- I want to verify customer photo matches tab
- I want to see ID scan results on tab
- I want to know if customer was pre-verified at door

---

## Features

### ID Scanning

#### Scan Methods
- [ ] Barcode scanner (PDF417)
- [ ] Camera OCR scan
- [ ] NFC/RFID (newer IDs)
- [ ] Manual entry fallback

#### ID Verification
- [ ] Age calculation
- [ ] Expiration check
- [ ] Format validation
- [ ] State/country support
- [ ] Duplicate detection

#### Scan Display
```
+------------------------------------------+
| ID SCAN RESULT                    ✓ VALID|
+------------------------------------------+
| Name: JOHN MICHAEL SMITH                 |
| DOB: 03/15/1995 (29 years old) ✓ 21+    |
| Expires: 03/15/2028 ✓ Valid             |
| State: California                        |
| ID#: D1234567                            |
+------------------------------------------+
| ⚠️ NOT on blocked list                   |
| [ALLOW ENTRY]  [DENY]  [ADD TO BLOCKED] |
+------------------------------------------+
```

### Blocked Customer List

#### Block Reasons
- [ ] Banned - General
- [ ] Banned - Violence
- [ ] Banned - Theft
- [ ] Banned - Intoxication
- [ ] Banned - Harassment
- [ ] Bad check/fraud
- [ ] Custom reason

#### Block Entry
- [ ] Name (required)
- [ ] ID number (if known)
- [ ] Photo (if available)
- [ ] Reason
- [ ] Duration (permanent/temporary)
- [ ] Notes

#### Block Alerts
```
+------------------------------------------+
| ⛔ BLOCKED CUSTOMER DETECTED             |
+------------------------------------------+
| Name: JOHN SMITH                         |
| Reason: Banned - Violence                |
| Blocked: Jan 15, 2026                    |
| Duration: PERMANENT                      |
| Notes: "Involved in altercation with     |
|        staff on 1/15/26"                 |
+------------------------------------------+
| Blocked by: Manager Mike                 |
| [DENY ENTRY]           [Override - Mgr] |
+------------------------------------------+
```

### Photo Capture

#### Photo for Tab
- [ ] Capture at door
- [ ] Link to customer profile
- [ ] Display on bar tabs
- [ ] Verify at payment

#### Photo Flow
```
ID Scan → Photo Capture → Entry Allowed → Tab Created
                ↓                              ↓
          Photo stored            Photo displays on tab
                                  for verification
```

### Guest Lists

#### VIP Lists
- [ ] Create event lists
- [ ] Add guests by name
- [ ] Add guests by phone
- [ ] Group reservations
- [ ] Comp/reduced cover

#### Guest Check-In
- [ ] Search by name
- [ ] Search by phone
- [ ] Mark checked in
- [ ] Party size tracking

### Capacity Management

#### Tracking
- [ ] Set max capacity
- [ ] Current count
- [ ] Entry/exit logging
- [ ] Automatic alerts

#### Capacity Display
```
+------------------------------------------+
| VENUE CAPACITY                           |
+------------------------------------------+
|                                          |
|     [============================   ]    |
|                                          |
|     Current: 245 / 300 (82%)            |
|                                          |
|     Tonight: 412 total entries          |
|     Currently inside: 245               |
|                                          |
| ⚠️ Alert at: 285 (95%)                  |
| 🛑 Stop entry at: 300 (100%)            |
|                                          |
+------------------------------------------+
```

### Cover Charges

#### Cover Types
- [ ] General admission
- [ ] VIP/Premium
- [ ] Event pricing
- [ ] Time-based (before/after)
- [ ] Guest list (reduced/free)

#### Cover Collection
- [ ] Cash collection
- [ ] Card payment
- [ ] Wristband assignment
- [ ] Receipt printing

### Wristband/Stamp Tracking

#### Wristband Types
- [ ] 21+ verification
- [ ] VIP access
- [ ] Cover paid
- [ ] Re-entry allowed

---

## UI/UX Specifications

### Door Check Screen

```
+------------------------------------------------------------------+
| DOOR CHECK                                           Jan 27, 2026 |
+------------------------------------------------------------------+
|                                                                   |
| [Scan ID]  [Manual Entry]  [Guest List]  [Search Blocked]        |
|                                                                   |
+==================================================================+
| LAST SCAN                                                         |
| +--------------------------------------------------------------+ |
| | ✓ VALID - ALLOW ENTRY                                        | |
| |                                                                | |
| | JOHN MICHAEL SMITH                                            | |
| | DOB: 03/15/1995 (29 years old)                               | |
| | CA DL: D1234567                                               | |
| | Expires: 03/15/2028                                           | |
| |                                                                | |
| | ✓ Over 21    ✓ Not expired    ✓ Not blocked                  | |
| |                                                                | |
| | [📷 Capture Photo]                                            | |
| |                                                                | |
| | +------------------+ +------------------+ +------------------+ | |
| | | ✓ ALLOW ENTRY   | |  ⛔ DENY ENTRY  | |  ADD TO BLOCKED  | | |
| | +------------------+ +------------------+ +------------------+ | |
| +--------------------------------------------------------------+ |
|                                                                   |
| CAPACITY: 245/300 (82%)              TONIGHT: 412 entries        |
|                                                                   |
+------------------------------------------------------------------+
```

### Blocked List Management

```
+------------------------------------------------------------------+
| BLOCKED CUSTOMERS                               [+ Add Blocked]   |
+------------------------------------------------------------------+
|                                                                   |
| Search: [_________________________________] [Search]              |
|                                                                   |
| +--------------------------------------------------------------+ |
| | Photo | Name           | ID#        | Reason    | Since      | |
| +--------------------------------------------------------------+ |
| | [📷]  | John Smith     | D1234567   | Violence  | 01/15/26   | |
| | [📷]  | Jane Doe       | D7654321   | Theft     | 12/20/25   | |
| | [ ]   | Mike Johnson   | Unknown    | Fraud     | 11/10/25   | |
| | [📷]  | Sarah Williams | A9876543   | Intox     | 01/25/26 * | |
| +--------------------------------------------------------------+ |
|                                                                   |
| * = Temporary ban, expires 02/25/26                              |
|                                                                   |
| Showing 4 of 23 blocked customers                                |
|                                                                   |
| [Export List]  [Import List]  [Clear Expired]                    |
+------------------------------------------------------------------+
```

### Guest List

```
+------------------------------------------------------------------+
| GUEST LIST: Saturday Night Event                    Jan 27, 2026  |
+------------------------------------------------------------------+
|                                                                   |
| Search: [________________] [Search]        [+ Add Guest]          |
|                                                                   |
| STATS: 45 on list | 28 checked in | 17 remaining                 |
|                                                                   |
| +--------------------------------------------------------------+ |
| | Name              | Party | Cover    | Status    | Check In   | |
| +--------------------------------------------------------------+ |
| | VIP: Mike Jones   | 4     | COMP     | ✓ Arrived | 9:45 PM   | |
| | Sarah Smith       | 2     | Reduced  | ✓ Arrived | 10:15 PM  | |
| | Tom Wilson        | 6     | COMP     | Pending   | [Check In]| |
| | Lisa Brown +1     | 2     | Reduced  | Pending   | [Check In]| |
| | Corporate: Acme   | 10    | COMP     | 6 of 10   | [+ More]  | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Print List]  [Text All Pending]  [Close List]                   |
+------------------------------------------------------------------+
```

---

## Data Model

### ID Scans
```sql
id_scans {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Scan data
  scan_type: VARCHAR(50) (barcode, ocr, manual)
  raw_data: TEXT (nullable)

  -- Parsed data
  first_name: VARCHAR(100)
  last_name: VARCHAR(100)
  middle_name: VARCHAR(100) (nullable)
  date_of_birth: DATE
  id_number: VARCHAR(50)
  id_state: VARCHAR(50)
  id_country: VARCHAR(50) DEFAULT 'US'
  expiration_date: DATE

  -- Calculated
  age_at_scan: INTEGER
  is_valid: BOOLEAN
  is_expired: BOOLEAN
  is_underage: BOOLEAN

  -- Result
  entry_allowed: BOOLEAN
  denial_reason: VARCHAR(200) (nullable)

  -- Photo
  photo_url: VARCHAR(500) (nullable)

  -- Link
  customer_id: UUID (FK, nullable)
  tab_id: UUID (FK, nullable)

  scanned_by: UUID (FK)
  scanned_at: TIMESTAMP

  created_at: TIMESTAMP
}
```

### Blocked Customers
```sql
blocked_customers {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Identity
  first_name: VARCHAR(100)
  last_name: VARCHAR(100)
  id_number: VARCHAR(50) (nullable)
  id_state: VARCHAR(50) (nullable)
  photo_url: VARCHAR(500) (nullable)

  -- Block details
  reason: VARCHAR(100)
  reason_detail: TEXT (nullable)

  -- Duration
  blocked_at: TIMESTAMP
  expires_at: TIMESTAMP (nullable) -- null = permanent
  is_permanent: BOOLEAN DEFAULT true

  -- Audit
  blocked_by: UUID (FK)
  unblocked_by: UUID (FK, nullable)
  unblocked_at: TIMESTAMP (nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Guest Lists
```sql
guest_lists {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(200)
  event_date: DATE
  description: TEXT (nullable)

  -- Settings
  default_cover_type: VARCHAR(50) (comp, reduced, full)
  reduced_cover_amount: DECIMAL(10,2) (nullable)

  is_active: BOOLEAN DEFAULT true

  created_by: UUID (FK)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Guest List Entries
```sql
guest_list_entries {
  id: UUID PRIMARY KEY
  guest_list_id: UUID (FK)
  location_id: UUID (FK)

  guest_name: VARCHAR(200)
  phone: VARCHAR(20) (nullable)
  email: VARCHAR(200) (nullable)
  party_size: INTEGER DEFAULT 1

  cover_type: VARCHAR(50) (comp, reduced, full)
  cover_amount: DECIMAL(10,2) (nullable)

  notes: TEXT (nullable)
  added_by: VARCHAR(200) (nullable) -- Who requested

  -- Check-in
  checked_in: BOOLEAN DEFAULT false
  checked_in_count: INTEGER DEFAULT 0
  checked_in_at: TIMESTAMP (nullable)
  checked_in_by: UUID (FK, nullable)

  created_at: TIMESTAMP
}
```

### Entry Log
```sql
door_entry_log {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  entry_type: VARCHAR(50) (entry, exit, denied)

  -- Customer
  id_scan_id: UUID (FK, nullable)
  guest_list_entry_id: UUID (FK, nullable)
  customer_name: VARCHAR(200) (nullable)

  -- Cover
  cover_collected: DECIMAL(10,2) DEFAULT 0
  cover_type: VARCHAR(50) (nullable)
  payment_method: VARCHAR(50) (nullable)

  -- Wristband
  wristband_type: VARCHAR(50) (nullable)
  wristband_number: VARCHAR(50) (nullable)

  processed_by: UUID (FK)
  processed_at: TIMESTAMP

  created_at: TIMESTAMP
}
```

### Capacity Settings
```sql
capacity_settings {
  location_id: UUID PRIMARY KEY (FK)

  max_capacity: INTEGER
  warning_threshold: INTEGER -- Alert at this count
  current_count: INTEGER DEFAULT 0

  track_exits: BOOLEAN DEFAULT false
  reset_time: TIME DEFAULT '04:00:00' -- When to reset count

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### ID Scanning
```
POST   /api/door/scan
GET    /api/door/scan/{id}
POST   /api/door/scan/{id}/photo
POST   /api/door/manual-entry
```

### Blocked List
```
GET    /api/door/blocked
POST   /api/door/blocked
PUT    /api/door/blocked/{id}
DELETE /api/door/blocked/{id}
GET    /api/door/blocked/search?q={query}
POST   /api/door/blocked/check
```

### Guest Lists
```
GET    /api/door/guest-lists
POST   /api/door/guest-lists
GET    /api/door/guest-lists/{id}
PUT    /api/door/guest-lists/{id}
POST   /api/door/guest-lists/{id}/entries
PUT    /api/door/guest-lists/{id}/entries/{entry_id}/check-in
```

### Entry/Capacity
```
POST   /api/door/entry
POST   /api/door/exit
GET    /api/door/capacity
GET    /api/door/log
```

### Cover Charges
```
POST   /api/door/cover
GET    /api/door/cover/summary
```

---

## Business Rules

1. **Age Verification:** Must be 21+ for alcohol-serving venues (configurable)
2. **Blocked Check:** Every scan checks against blocked list
3. **ID Expiration:** Expired IDs rejected by default
4. **Photo Link:** Photos linked to tabs for verification
5. **Capacity Enforcement:** Entry denied when at capacity
6. **Guest List Priority:** Guest list entries may bypass cover/capacity

---

## Permissions

| Action | Door Staff | Manager | Admin |
|--------|------------|---------|-------|
| Scan IDs | Yes | Yes | Yes |
| Allow/Deny entry | Yes | Yes | Yes |
| Capture photos | Yes | Yes | Yes |
| View blocked list | Yes | Yes | Yes |
| Add to blocked list | Limited | Yes | Yes |
| Remove from blocked | No | Yes | Yes |
| Manage guest lists | No | Yes | Yes |
| Override capacity | No | Yes | Yes |
| View reports | No | Yes | Yes |
| Configure settings | No | No | Yes |

---

## Configuration Options

```yaml
door_management:
  id_scanning:
    minimum_age: 21
    accept_expired: false
    allowed_states: "all"  # or specific list
    allow_manual_entry: true

  blocked_list:
    share_across_locations: true
    require_photo: false
    default_duration: "permanent"

  capacity:
    enabled: true
    max_capacity: 300
    warning_percent: 95
    track_exits: true
    reset_at: "04:00"

  cover_charges:
    enabled: true
    default_amount: 10.00
    vip_amount: 20.00
    accept_card: true

  photos:
    capture_at_door: true
    link_to_tabs: true
    retention_days: 30

  guest_lists:
    enabled: true
    text_reminders: true
    default_cover: "reduced"
```

---

## Hardware Requirements

- Barcode scanner (PDF417 capable)
- Tablet/phone with camera for OCR
- Camera for photo capture
- Optional: Clicker counter for manual tracking

---

*Last Updated: January 27, 2026*
