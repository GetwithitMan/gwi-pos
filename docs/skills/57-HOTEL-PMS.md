# 57 - Hotel PMS Integration

**Status:** Planning
**Priority:** Medium
**Dependencies:** 30-Tender-Types, 04-Order-Management, 53-Enterprise-Multi-Location

---

## Overview

The Hotel PMS Integration skill enables seamless connection between the restaurant POS and hotel Property Management Systems. Guests can charge meals to their room, view room numbers on orders, sync guest profiles, and post charges automatically. Supports major PMS platforms including Opera, Mews, Cloudbeds, and others.

**Primary Goal:** Frictionless room charging for hotel guests and accurate posting to the hotel folio.

---

## User Stories

### As a Hotel Guest...
- I want to charge my meal to my room
- I want to use my room key as identification
- I want to see my restaurant charges on checkout
- I don't want to carry cash or cards

### As a Server...
- I want to quickly verify room and guest name
- I want to post charges with one tap
- I want to see if a room allows charges
- I want to handle failed posts gracefully

### As a Hotel Manager...
- I want all F&B charges to post automatically
- I want to see revenue by outlet
- I want to restrict charges for certain rooms
- I want detailed transaction records

### As a Night Auditor...
- I want reconciliation reports
- I want to see failed postings
- I want to manually post corrections
- I want audit trails for all room charges

---

## Features

### Room Charge Flow

#### Basic Flow
```
1. Server rings order
         ↓
2. Guest requests "Charge to room"
         ↓
3. Enter room number (or scan key)
         ↓
4. POS queries PMS for guest info
         ↓
5. Verify guest name displayed
         ↓
6. Post charge to room folio
         ↓
7. Guest signs (optional)
         ↓
8. Receipt printed/emailed
```

#### Room Charge Interface
```
+------------------------------------------------------------------+
| ROOM CHARGE                                                       |
+------------------------------------------------------------------+
|                                                                   |
| Order Total: $87.50                                              |
|                                                                   |
| ROOM NUMBER                                                       |
| +------------------+                                              |
| |      412        |  [Scan Key Card]                             |
| +------------------+                                              |
|                                                                   |
| LOOKING UP ROOM...                                               |
|                                                                   |
+------------------------------------------------------------------+

           ↓ Room Found ↓

+------------------------------------------------------------------+
| ROOM CHARGE - Room 412                                            |
+------------------------------------------------------------------+
|                                                                   |
| GUEST INFORMATION                                                 |
| +--------------------------------------------------------------+ |
| | Room: 412 - Deluxe King                                       | |
| | Guest: Mr. James Wilson                                       | |
| | Check-In: Jan 25, 2026                                        | |
| | Check-Out: Jan 28, 2026                                       | |
| | Status: ✓ Room Charges Allowed                                | |
| +--------------------------------------------------------------+ |
|                                                                   |
| CHARGE DETAILS                                                    |
| +--------------------------------------------------------------+ |
| | Outlet: Restaurant                                             | |
| | Check #: 1247                                                  | |
| | Amount: $87.50                                                 | |
| | Tip: $17.50                                                    | |
| | Total: $105.00                                                 | |
| +--------------------------------------------------------------+ |
|                                                                   |
| Please confirm guest identity:                                   |
| "Is this Mr. James Wilson?"                                      |
|                                                                   |
| [Cancel]                              [Post to Room]             |
+------------------------------------------------------------------+
```

#### Signature Capture
```
+------------------------------------------------------------------+
| GUEST SIGNATURE                                                   |
+------------------------------------------------------------------+
|                                                                   |
| Room 412 - Mr. James Wilson                                      |
| Total: $105.00 (incl. $17.50 tip)                               |
|                                                                   |
| +--------------------------------------------------------------+ |
| |                                                                | |
| |                                                                | |
| |          [Signature Capture Area]                              | |
| |                                                                | |
| |                    ___________________                         | |
| |                                                                | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Clear]                               [Complete Charge]          |
+------------------------------------------------------------------+
```

### PMS Verification

#### Guest Lookup Response
```yaml
pms_lookup_response:
  room_number: "412"
  room_type: "Deluxe King"

  guest:
    name: "Mr. James Wilson"
    first_name: "James"
    last_name: "Wilson"
    vip_level: "Gold"

  reservation:
    confirmation: "HX78451290"
    check_in: "2026-01-25"
    check_out: "2026-01-28"
    adults: 2
    status: "in_house"

  billing:
    charges_allowed: true
    credit_limit: 500.00
    current_balance: 245.00
    available_credit: 255.00

  restrictions:
    - none

  # Or if charges blocked:
  charges_allowed: false
  restriction_reason: "Credit limit exceeded"
```

#### Charge Restrictions
```
+------------------------------------------------------------------+
| ⚠️ ROOM CHARGE NOT AVAILABLE                                      |
+------------------------------------------------------------------+
|                                                                   |
| Room: 412 - Mr. James Wilson                                     |
|                                                                   |
| Reason: Credit limit exceeded                                    |
|                                                                   |
| Current Balance: $485.00                                         |
| Credit Limit: $500.00                                            |
| This Charge: $105.00                                             |
|                                                                   |
| OPTIONS:                                                          |
| [Pay with Card]  [Split Payment]  [Call Front Desk]              |
|                                                                   |
+------------------------------------------------------------------+
```

### Posting Integration

#### Charge Posting
```yaml
post_to_pms:
  endpoint: "/api/v1/postings"
  method: "POST"

  payload:
    room_number: "412"
    guest_id: "G78451290"
    transaction:
      type: "charge"
      outlet_code: "REST"
      check_number: "1247"
      amount: 105.00
      subtotal: 87.50
      tax: 0.00  # May be included or separate
      tip: 17.50
      currency: "USD"
      description: "Restaurant - Check #1247"
      items:
        - description: "Food & Beverage"
          amount: 87.50
        - description: "Gratuity"
          amount: 17.50
    timestamp: "2026-01-27T19:45:00Z"
    pos_reference: "POS-TXN-78451"
    employee_id: "EMP-042"

  response:
    status: "success"
    pms_transaction_id: "PMS-TXN-891234"
    folio_balance: 350.00
```

### Supported PMS Platforms

#### Integration Status
```yaml
pms_integrations:
  oracle_opera:
    status: "supported"
    connection: "API"
    features:
      - room_lookup
      - charge_posting
      - guest_profiles
      - group_billing

  mews:
    status: "supported"
    connection: "API"
    features:
      - room_lookup
      - charge_posting
      - guest_profiles

  cloudbeds:
    status: "supported"
    connection: "API"
    features:
      - room_lookup
      - charge_posting

  protel:
    status: "supported"
    connection: "API/HTNG"
    features:
      - room_lookup
      - charge_posting
      - guest_profiles

  infor_hms:
    status: "planned"
    connection: "API"

  stayntouch:
    status: "supported"
    connection: "API"
    features:
      - room_lookup
      - charge_posting

  generic_htng:
    status: "supported"
    connection: "HTNG 2.0"
    features:
      - room_lookup
      - charge_posting
```

### Outlet Configuration

#### F&B Outlets
```yaml
outlets:
  restaurant:
    code: "REST"
    name: "Main Restaurant"
    revenue_center: "4100"
    posting_description: "Restaurant"
    auto_post: true

  bar:
    code: "BAR"
    name: "Lobby Bar"
    revenue_center: "4200"
    posting_description: "Bar/Lounge"
    auto_post: true

  room_service:
    code: "IRS"
    name: "In-Room Dining"
    revenue_center: "4300"
    posting_description: "In-Room Dining"
    auto_post: true
    delivery_charge: 5.00

  pool_bar:
    code: "POOL"
    name: "Pool Bar"
    revenue_center: "4400"
    posting_description: "Pool Bar"
    auto_post: true

  minibar:
    code: "MINI"
    name: "Minibar"
    revenue_center: "4500"
    posting_description: "Minibar"
    auto_post: true
```

### Failed Posting Handling

#### Retry & Queue
```
+------------------------------------------------------------------+
| ⚠️ POSTING FAILED                                                 |
+------------------------------------------------------------------+
|                                                                   |
| Room: 412 - Mr. James Wilson                                     |
| Amount: $105.00                                                  |
|                                                                   |
| Error: Connection timeout to PMS                                 |
|                                                                   |
| OPTIONS:                                                          |
| [Retry Now]                                                      |
| [Add to Queue] - Will retry automatically                        |
| [Pay with Card] - Process as regular payment                     |
| [Manual Override] - Manager required                             |
|                                                                   |
+------------------------------------------------------------------+
```

#### Failed Posting Queue
```
+------------------------------------------------------------------+
| PENDING ROOM POSTINGS                                  [Retry All]|
+------------------------------------------------------------------+
|                                                                   |
| 3 postings pending                                               |
|                                                                   |
| +--------------------------------------------------------------+ |
| | Time   | Room | Guest          | Amount  | Status   | Action  | |
| +--------------------------------------------------------------+ |
| | 7:45PM | 412  | James Wilson   | $105.00 | Retry #2 | [Retry] | |
| | 7:52PM | 218  | Sarah Chen     | $67.50  | Queued   | [Retry] | |
| | 8:01PM | 315  | Mike Johnson   | $42.00  | Queued   | [Retry] | |
| +--------------------------------------------------------------+ |
|                                                                   |
| Last PMS connection: 7:44 PM (15 min ago)                        |
| PMS Status: ⚠️ Connection Issues                                 |
|                                                                   |
| [Contact IT]  [Manual Post Instructions]                         |
+------------------------------------------------------------------+
```

### Reconciliation

#### Daily Reconciliation Report
```
+------------------------------------------------------------------+
| ROOM CHARGE RECONCILIATION                      Jan 27, 2026     |
+------------------------------------------------------------------+
|                                                                   |
| SUMMARY                                                           |
| +------------------+ +------------------+ +------------------+    |
| | Total Posted     | | Total Checks     | | Variance         |   |
| | $4,247.50        | | 47 room charges  | | $0.00            |   |
| | PMS Confirmed    | |                  | | ✓ Balanced       |   |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| BY OUTLET                                                         |
| +--------------------------------------------------------------+ |
| | Outlet           | Checks | POS Total  | PMS Posted | Var   | |
| +--------------------------------------------------------------+ |
| | Restaurant       | 28     | $2,450.00  | $2,450.00  | $0.00 | |
| | Bar              | 15     | $1,247.50  | $1,247.50  | $0.00 | |
| | In-Room Dining   | 4      | $550.00    | $550.00    | $0.00 | |
| +--------------------------------------------------------------+ |
|                                                                   |
| EXCEPTIONS                                                        |
| +--------------------------------------------------------------+ |
| | None - All postings successful                                | |
| +--------------------------------------------------------------+ |
|                                                                   |
| FAILED POSTINGS (Recovered)                                       |
| +--------------------------------------------------------------+ |
| | 7:45 PM | Room 412 | $105.00 | Timeout → Retried → Success   | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Export to PMS]  [Print Report]  [Night Audit Sign-Off]          |
+------------------------------------------------------------------+
```

### Guest Profile Sync

#### Profile Integration
```yaml
guest_profile_sync:
  enabled: true

  sync_fields:
    - name
    - email
    - phone
    - vip_level
    - preferences
    - allergies
    - loyalty_number

  create_local_profile: true
  link_to_loyalty: true

  preferences_import:
    - dietary_restrictions
    - seating_preferences
    - favorite_items
```

---

## Data Model

### Room Charges
```sql
room_charges {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  order_id: UUID (FK)

  -- Room info
  room_number: VARCHAR(20)
  guest_name: VARCHAR(200)
  guest_id: VARCHAR(100) (nullable)  -- PMS guest ID
  reservation_id: VARCHAR(100) (nullable)

  -- Amounts
  subtotal: DECIMAL(10,2)
  tax: DECIMAL(10,2)
  tip: DECIMAL(10,2)
  total: DECIMAL(10,2)

  -- Posting
  outlet_code: VARCHAR(20)
  pms_transaction_id: VARCHAR(100) (nullable)
  posting_status: VARCHAR(50)  -- pending, posted, failed, voided

  -- Retry info
  retry_count: INTEGER DEFAULT 0
  last_retry_at: TIMESTAMP (nullable)
  failure_reason: TEXT (nullable)

  -- Verification
  signature_image: VARCHAR(500) (nullable)
  verified_by: UUID (FK)

  posted_at: TIMESTAMP (nullable)
  created_at: TIMESTAMP
}
```

### PMS Configuration
```sql
pms_config {
  location_id: UUID PRIMARY KEY (FK)

  -- Connection
  pms_type: VARCHAR(50)  -- opera, mews, cloudbeds, etc.
  api_url: VARCHAR(500)
  api_key_encrypted: TEXT
  property_code: VARCHAR(50)

  -- Settings
  auto_post: BOOLEAN DEFAULT true
  require_signature: BOOLEAN DEFAULT false
  signature_threshold: DECIMAL(10,2) DEFAULT 0  -- Require above this amount

  -- Retry
  max_retries: INTEGER DEFAULT 3
  retry_interval_minutes: INTEGER DEFAULT 5

  -- Outlets
  outlets: JSONB

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Posting Queue
```sql
pms_posting_queue {
  id: UUID PRIMARY KEY
  room_charge_id: UUID (FK)

  -- Status
  status: VARCHAR(50)  -- queued, processing, completed, failed

  -- Attempts
  attempts: INTEGER DEFAULT 0
  last_attempt_at: TIMESTAMP (nullable)
  next_attempt_at: TIMESTAMP

  -- Result
  response_code: VARCHAR(50) (nullable)
  response_message: TEXT (nullable)

  created_at: TIMESTAMP
  completed_at: TIMESTAMP (nullable)
}
```

---

## API Endpoints

### Room Lookup
```
GET    /api/pms/rooms/{room_number}
GET    /api/pms/rooms/{room_number}/guest
POST   /api/pms/rooms/lookup  # By key card
```

### Posting
```
POST   /api/pms/post
GET    /api/pms/postings
GET    /api/pms/postings/{id}
POST   /api/pms/postings/{id}/retry
POST   /api/pms/postings/{id}/void
```

### Queue
```
GET    /api/pms/queue
POST   /api/pms/queue/process
POST   /api/pms/queue/{id}/retry
DELETE /api/pms/queue/{id}
```

### Reconciliation
```
GET    /api/pms/reconciliation
GET    /api/pms/reconciliation/daily
GET    /api/pms/reconciliation/export
```

### Configuration
```
GET    /api/pms/config
PUT    /api/pms/config
POST   /api/pms/test-connection
GET    /api/pms/outlets
PUT    /api/pms/outlets
```

---

## Business Rules

1. **Guest Verification:** Always display guest name for verbal confirmation
2. **Credit Check:** Verify available credit before posting
3. **Retry Logic:** Auto-retry failed postings up to 3 times
4. **Signature Threshold:** Require signature above configurable amount
5. **Void Handling:** Voided charges must also void in PMS
6. **Night Audit:** All charges must post before night audit
7. **Tip Posting:** Tips post as separate line item or combined (configurable)

---

## Permissions

| Action | Server | Front Desk | Manager | Admin |
|--------|--------|------------|---------|-------|
| Charge to room | Yes | Yes | Yes | Yes |
| Override credit limit | No | Yes | Yes | Yes |
| Retry failed postings | No | No | Yes | Yes |
| Void room charges | No | No | Yes | Yes |
| View reconciliation | No | No | Yes | Yes |
| Configure PMS | No | No | No | Yes |
| Night audit sign-off | No | Yes | Yes | Yes |

---

## Configuration Options

```yaml
hotel_pms:
  connection:
    pms_type: "opera"
    api_url: "https://opera.hotel.com/api"
    property_code: "HTLMAIN"
    timeout_seconds: 10

  posting:
    auto_post: true
    require_signature: false
    signature_threshold: 50.00
    include_itemized: false
    tip_as_separate_line: true

  verification:
    require_name_confirm: true
    allow_key_card_lookup: true
    show_folio_balance: false

  retry:
    enabled: true
    max_attempts: 3
    interval_minutes: 5
    alert_on_failure: true

  reconciliation:
    auto_reconcile: true
    reconcile_time: "03:00"  # 3 AM
    alert_on_variance: true

  restrictions:
    block_if_credit_exceeded: true
    block_if_checkout_today: false
    allowed_outlets: ["REST", "BAR", "IRS"]
```

---

## Error Codes

```yaml
pms_errors:
  ROOM_NOT_FOUND:
    message: "Room number not found in PMS"
    action: "Verify room number with guest"

  GUEST_CHECKED_OUT:
    message: "Guest has already checked out"
    action: "Collect payment by card"

  CREDIT_EXCEEDED:
    message: "Room credit limit exceeded"
    action: "Collect payment or contact front desk"

  CHARGES_BLOCKED:
    message: "Room charges are blocked"
    action: "Contact front desk for authorization"

  CONNECTION_FAILED:
    message: "Unable to connect to PMS"
    action: "Add to queue or collect payment"

  POSTING_REJECTED:
    message: "PMS rejected the posting"
    action: "Review error details or contact IT"
```

---

*Last Updated: January 27, 2026*
