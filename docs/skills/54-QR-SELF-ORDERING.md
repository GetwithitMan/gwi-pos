# 54 - QR Code Self-Ordering

**Status:** Planning
**Priority:** High
**Dependencies:** 03-Menu-Programming, 04-Order-Management, 30-Tender-Types

---

## Overview

The QR Code Self-Ordering skill enables guests to scan a QR code at their table, view the digital menu on their phone, place orders, and optionally pay - all without downloading an app. Reduces wait times, increases order accuracy, and allows servers to focus on hospitality rather than order-taking.

**Primary Goal:** Frictionless guest ordering via smartphone that integrates seamlessly with the existing POS workflow.

---

## User Stories

### As a Guest...
- I want to scan a QR code and see the menu instantly
- I want to order at my own pace without waiting
- I want to add items throughout my meal
- I want to pay from my phone when ready

### As a Server...
- I want to see QR orders on my POS like regular orders
- I want to know when a table places a QR order
- I want to still provide personal service
- I want control over when orders fire to kitchen

### As a Manager...
- I want to reduce order errors
- I want to increase table turnover
- I want to track QR vs. server orders
- I want to upsell through the digital menu

---

## Features

### QR Code Generation

#### Table-Specific QR Codes
```yaml
qr_codes:
  type: "table_specific"

  table_12:
    url: "https://order.gwipos.com/loc123/table/12"
    qr_image: "table_12_qr.png"

  # QR encodes:
  # - Location ID
  # - Table/seat identifier
  # - Session token (rotates daily)
```

#### QR Code Types
```yaml
qr_types:
  table_qr:
    use_case: "Dine-in table ordering"
    links_to: "specific_table"
    auto_assign: true

  seat_qr:
    use_case: "Per-seat ordering (stadiums, counters)"
    links_to: "specific_seat"
    separate_checks: true

  general_qr:
    use_case: "Walk-up, pickup ordering"
    links_to: "new_order"
    requires_name: true

  menu_only:
    use_case: "View menu, no ordering"
    links_to: "menu_view"
    ordering_disabled: true
```

### Guest Experience

#### Scan Flow
```
1. Guest scans QR code at table
         ↓
2. Browser opens (no app needed)
         ↓
3. "Welcome to GWI Restaurant - Table 12"
         ↓
4. Browse menu, add items to cart
         ↓
5. Submit order
         ↓
6. Order appears on server's POS
         ↓
7. Add more items anytime (rescan or bookmark)
         ↓
8. Pay via phone or with server
```

#### Mobile Menu Interface
```
+----------------------------------+
|  GWI RESTAURANT        Table 12  |
|  ☰ Menu                    🛒 3  |
+----------------------------------+
|                                  |
|  [Appetizers] [Entrees] [Drinks] |
|                                  |
|  ┌──────────────────────────────┐|
|  │ 📷                           ||
|  │ Grilled Salmon        $28.00 ||
|  │ Fresh Atlantic salmon with   ||
|  │ seasonal vegetables          ||
|  │                              ||
|  │ 🌿 Gluten-Free Available     ||
|  │                              ||
|  │ [  Add to Order  ]           ||
|  └──────────────────────────────┘|
|                                  |
|  ┌──────────────────────────────┐|
|  │ 📷                           ||
|  │ NY Strip Steak        $38.00 ||
|  │ 12oz prime cut, choice of    ||
|  │ two sides                    ||
|  │                              ||
|  │ [  Add to Order  ]           ||
|  └──────────────────────────────┘|
|                                  |
+----------------------------------+
|        View Cart (3) - $72.00    |
+----------------------------------+
```

#### Item Customization
```
+----------------------------------+
|  ← Back           Grilled Salmon |
+----------------------------------+
|                                  |
|  📷 [Item Photo]                 |
|                                  |
|  Grilled Salmon           $28.00|
|  Fresh Atlantic salmon with     |
|  lemon butter sauce             |
|                                  |
|  ─────────────────────────────  |
|                                  |
|  QUANTITY                        |
|  [ - ]    1    [ + ]            |
|                                  |
|  PREPARATION *                   |
|  ○ Grilled (default)            |
|  ○ Blackened (+$2)              |
|  ○ Pan-Seared                   |
|                                  |
|  SIDE CHOICE *                   |
|  ○ Seasonal Vegetables          |
|  ○ Rice Pilaf                   |
|  ○ Mashed Potatoes              |
|  ○ Side Salad (+$3)             |
|                                  |
|  DIETARY NEEDS                   |
|  ☐ Gluten-Free                  |
|  ☐ Dairy-Free                   |
|                                  |
|  SPECIAL REQUESTS                |
|  ┌──────────────────────────────┐|
|  │ Extra lemon on the side      │|
|  └──────────────────────────────┘|
|                                  |
|  ─────────────────────────────  |
|                                  |
|       [ Add to Order - $28.00 ]  |
|                                  |
+----------------------------------+
```

#### Cart & Checkout
```
+----------------------------------+
|  ← Menu              Your Order  |
+----------------------------------+
|                                  |
|  TABLE 12                        |
|                                  |
|  ┌──────────────────────────────┐|
|  │ 1x Grilled Salmon     $28.00 ||
|  │    Rice Pilaf                ||
|  │    Gluten-Free               ||
|  │    "Extra lemon"             ||
|  │              [Edit] [Remove] ||
|  └──────────────────────────────┘|
|  ┌──────────────────────────────┐|
|  │ 1x Caesar Salad       $14.00 ||
|  │    No Croutons               ||
|  │              [Edit] [Remove] ||
|  └──────────────────────────────┘|
|  ┌──────────────────────────────┐|
|  │ 2x House Margarita    $24.00 ||
|  │    Patron (+$4 each)         ||
|  │              [Edit] [Remove] ||
|  └──────────────────────────────┘|
|                                  |
|  ─────────────────────────────  |
|  Subtotal                $66.00  |
|  Tax                      $5.28  |
|  ─────────────────────────────  |
|  Total                   $71.28  |
|                                  |
|  ┌──────────────────────────────┐|
|  │  ⚠️ Orders are final once    │|
|  │  sent to kitchen             │|
|  └──────────────────────────────┘|
|                                  |
|    [ Send Order to Kitchen ]     |
|                                  |
|  ─────── or ───────             |
|                                  |
|    [ Pay Now & Close Tab ]       |
|                                  |
+----------------------------------+
```

### POS Integration

#### Server Notification
```
+------------------------------------------------------------------+
|  🔔 NEW QR ORDER - TABLE 12                              2:45 PM  |
+------------------------------------------------------------------+
|                                                                   |
|  Guest ordered via QR code                                       |
|                                                                   |
|  1x Grilled Salmon                                       $28.00  |
|     Rice Pilaf, Gluten-Free                                      |
|     "Extra lemon"                                                |
|  1x Caesar Salad                                         $14.00  |
|     No Croutons                                                  |
|  2x House Margarita - Patron                             $24.00  |
|                                                                   |
|  Total: $71.28                                                   |
|                                                                   |
|  [Accept & Fire]    [Review First]    [Contact Guest]            |
|                                                                   |
+------------------------------------------------------------------+
```

#### QR Orders on Order Screen
```
+------------------------------------------------------------------+
| TABLES                                                            |
+------------------------------------------------------------------+
|                                                                   |
| +--------+ +--------+ +--------+ +--------+ +--------+           |
| |   1    | |   2    | |   3    | |   4    | |   5    |           |
| | $45.00 | | $82.50 | |        | | $124.0 | |        |           |
| | Sarah  | | Mike   | |  Open  | | Sarah  | |  Open  |           |
| +--------+ +--------+ +--------+ +--------+ +--------+           |
|                                                                   |
| +--------+ +--------+ +--------+ +--------+ +--------+           |
| |   6    | |   7    | |   8    | |   9    | |   10   |           |
| |        | | $67.00 | |        | | $55.20 | |        |           |
| |  Open  | | Mike   | |  Open  | | Sarah  | |  Open  |           |
| +--------+ +--------+ +--------+ +--------+ +--------+           |
|                                                                   |
| +--------+ +--------+ +--------+ +--------+ +--------+           |
| |   11   | |  12 📱 | |   13   | |   14   | |   15   |           |
| |        | | $71.28 | |        | |        | |        |           |
| |  Open  | |QR Order| |  Open  | |  Open  | |  Open  |           |
| +--------+ +--------+ +--------+ +--------+ +--------+           |
|                                                                   |
|  📱 = QR Self-Order (tap to review)                              |
|                                                                   |
+------------------------------------------------------------------+
```

### Payment Options

#### Pay at Table
```
+----------------------------------+
|  Pay Your Bill         Table 12  |
+----------------------------------+
|                                  |
|  YOUR TOTAL                      |
|                                  |
|  Subtotal              $66.00    |
|  Tax                    $5.28    |
|  ────────────────────────────   |
|  Total                 $71.28    |
|                                  |
|  ADD TIP                         |
|  +--------+ +--------+ +--------+|
|  |  18%   | |  20%   | |  25%   ||
|  | $12.83 | | $14.26 | | $17.82 ||
|  +--------+ +--------+ +--------+|
|                                  |
|  Custom: $[______]               |
|                                  |
|  ────────────────────────────   |
|  Total with Tip        $85.54    |
|                                  |
|  PAYMENT METHOD                  |
|  ┌──────────────────────────────┐|
|  │ 💳 Apple Pay                 │|
|  └──────────────────────────────┘|
|  ┌──────────────────────────────┐|
|  │ 💳 Google Pay                │|
|  └──────────────────────────────┘|
|  ┌──────────────────────────────┐|
|  │ 💳 Credit Card               │|
|  └──────────────────────────────┘|
|  ┌──────────────────────────────┐|
|  │ 🧾 Pay with Server           │|
|  └──────────────────────────────┘|
|                                  |
+----------------------------------+
```

#### Split Payment (QR)
```
+----------------------------------+
|  Split the Bill        Table 12  |
+----------------------------------+
|                                  |
|  HOW WOULD YOU LIKE TO SPLIT?    |
|                                  |
|  ┌──────────────────────────────┐|
|  │ 👥 Split Evenly              │|
|  │    Divide by number of people│|
|  └──────────────────────────────┘|
|                                  |
|  ┌──────────────────────────────┐|
|  │ 🍽️ Pay for My Items          │|
|  │    Select what you ordered   │|
|  └──────────────────────────────┘|
|                                  |
|  ┌──────────────────────────────┐|
|  │ 💵 Pay Custom Amount         │|
|  │    Enter a specific amount   │|
|  └──────────────────────────────┘|
|                                  |
|  ┌──────────────────────────────┐|
|  │ 🧾 Pay Full Bill             │|
|  │    Pay for everyone          │|
|  └──────────────────────────────┘|
|                                  |
+----------------------------------+
```

### Server Controls

#### QR Order Settings
```yaml
qr_order_controls:
  auto_accept:
    enabled: false  # Require server review
    exceptions:
      - "drinks_only"  # Auto-accept drink orders

  auto_fire:
    enabled: false  # Server controls kitchen send

  server_assignment:
    mode: "section_based"  # Assign to section server
    notify: true

  guest_payment:
    enabled: true
    require_server_close: false  # Guest can fully close

  reorder_window:
    enabled: true
    minutes: 120  # Can add items for 2 hours
```

### Upselling & Suggestions

#### Smart Recommendations
```
+----------------------------------+
|  You might also like...          |
+----------------------------------+
|                                  |
|  With your Grilled Salmon:       |
|                                  |
|  ┌──────────────────────────────┐|
|  │ 🍷 Glass of Chardonnay $12   │|
|  │    Perfect pairing    [Add]  │|
|  └──────────────────────────────┘|
|                                  |
|  ┌──────────────────────────────┐|
|  │ 🥗 Side Caesar Salad   $8    │|
|  │    Start your meal    [Add]  │|
|  └──────────────────────────────┘|
|                                  |
+----------------------------------+
```

---

## Data Model

### QR Sessions
```sql
qr_sessions {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Link to order
  order_id: UUID (FK, nullable)
  table_id: UUID (FK, nullable)
  seat_number: INTEGER (nullable)

  -- Session info
  session_token: VARCHAR(100) UNIQUE
  device_fingerprint: VARCHAR(200) (nullable)

  -- Status
  status: VARCHAR(50)  -- active, ordered, paid, expired

  -- Timing
  started_at: TIMESTAMP
  last_activity: TIMESTAMP
  expires_at: TIMESTAMP

  created_at: TIMESTAMP
}
```

### QR Orders
```sql
qr_orders {
  id: UUID PRIMARY KEY
  session_id: UUID (FK)
  order_id: UUID (FK)

  -- Source tracking
  source: VARCHAR(50) DEFAULT 'qr_self_order'

  -- Status
  status: VARCHAR(50)  -- pending_review, accepted, rejected
  reviewed_by: UUID (FK, nullable)
  reviewed_at: TIMESTAMP (nullable)

  -- Items snapshot
  items: JSONB
  subtotal: DECIMAL(10,2)

  created_at: TIMESTAMP
}
```

### QR Codes
```sql
qr_codes {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Target
  qr_type: VARCHAR(50)  -- table, seat, general, menu_only
  target_type: VARCHAR(50)  -- table, seat, location
  target_id: UUID (nullable)

  -- Code
  code_url: VARCHAR(500)
  short_code: VARCHAR(20) UNIQUE

  -- Rotation
  session_token: VARCHAR(100)
  token_expires_at: TIMESTAMP

  -- Settings
  settings: JSONB

  is_active: BOOLEAN DEFAULT true
  created_at: TIMESTAMP
}
```

### QR Analytics
```sql
qr_analytics {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  date: DATE

  -- Scans
  total_scans: INTEGER DEFAULT 0
  unique_devices: INTEGER DEFAULT 0

  -- Conversions
  orders_started: INTEGER DEFAULT 0
  orders_completed: INTEGER DEFAULT 0

  -- Revenue
  qr_order_revenue: DECIMAL(10,2) DEFAULT 0
  avg_qr_check: DECIMAL(10,2) DEFAULT 0

  -- Comparison
  server_order_revenue: DECIMAL(10,2) DEFAULT 0
  avg_server_check: DECIMAL(10,2) DEFAULT 0

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Guest-Facing (Public)
```
GET    /api/qr/{code}/menu
GET    /api/qr/{code}/session
POST   /api/qr/{code}/order
PUT    /api/qr/{code}/order/{id}
GET    /api/qr/{code}/order/{id}/status
POST   /api/qr/{code}/pay
```

### POS Integration
```
GET    /api/qr-orders/pending
POST   /api/qr-orders/{id}/accept
POST   /api/qr-orders/{id}/reject
GET    /api/qr-orders/by-table/{table_id}
```

### Management
```
GET    /api/qr-codes
POST   /api/qr-codes
PUT    /api/qr-codes/{id}
DELETE /api/qr-codes/{id}
POST   /api/qr-codes/{id}/regenerate
GET    /api/qr-codes/{id}/print
```

### Analytics
```
GET    /api/qr/analytics
GET    /api/qr/analytics/daily
GET    /api/qr/analytics/conversion
```

---

## Business Rules

1. **Session Binding:** QR session bound to table until order complete
2. **Server Notification:** Always notify assigned server of QR orders
3. **Kitchen Control:** Server controls when order fires (unless auto-fire enabled)
4. **Reorder Window:** Guests can add items within configured time window
5. **Payment Flexibility:** Guest can pay via phone or request server
6. **No App Required:** Must work in mobile browser without installation
7. **Offline Handling:** Show cached menu if connection lost

---

## Permissions

| Action | Guest | Server | Manager | Admin |
|--------|-------|--------|---------|-------|
| View menu | Yes | Yes | Yes | Yes |
| Place QR order | Yes | - | - | - |
| Accept QR order | - | Yes | Yes | Yes |
| Reject QR order | - | Yes | Yes | Yes |
| Configure QR settings | - | No | Yes | Yes |
| Generate QR codes | - | No | Yes | Yes |
| View QR analytics | - | No | Yes | Yes |

---

## Configuration Options

```yaml
qr_ordering:
  enabled: true

  guest_experience:
    require_name: false
    require_phone: false
    show_wait_time: true
    allow_special_requests: true
    max_special_request_chars: 200

  ordering:
    auto_accept: false
    auto_fire_to_kitchen: false
    drink_auto_fire: true
    reorder_window_minutes: 120

  payment:
    allow_guest_payment: true
    allow_split_payment: true
    require_server_close: false
    tip_suggestions: [18, 20, 25]

  upselling:
    show_recommendations: true
    show_popular_items: true
    show_pairings: true

  notifications:
    notify_server: true
    notification_sound: true

  security:
    session_timeout_minutes: 180
    rotate_tokens_daily: true
    require_table_validation: false
```

---

*Last Updated: January 27, 2026*
