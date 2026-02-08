# 04 - Order Management

**Status:** Planning
**Priority:** Critical
**Dependencies:** 03-Menu-Programming, 05-Employees-Roles

---

## Overview

The Order Management skill handles the complete lifecycle of orders - from creation to close. This includes table management, bar tabs, quick service orders, and all the operations that happen in between (splitting, transferring, voiding, etc.).

**Primary Goal:** Provide flexible order management that supports all service styles while maintaining accurate tracking of every action.

---

## User Stories

### As a Server...
- I want to start an order for my table quickly
- I want to add items and modifiers efficiently
- I want to split checks multiple ways
- I want to transfer tables to another server
- I want to fire courses when the table is ready

### As a Bartender...
- I want to open tabs quickly with a card swipe
- I want to see all my open tabs at a glance
- I want to add items to existing tabs fast
- I want to close out tabs quickly at end of night

### As a Manager...
- I want to see all open orders in the restaurant
- I want to approve voids and comps
- I want to reopen closed checks if needed
- I want to track order times and issues

---

## Features

### Order Types

#### Quick Service Order
- [ ] No table assignment
- [ ] Auto-generated order number
- [ ] Optional customer name
- [ ] Pay at counter flow
- [ ] Ticket prints immediately or on payment

#### Table Service Order
- [ ] Assigned to table and server
- [ ] Guest count tracking
- [ ] Seat assignments (optional)
- [ ] Course management
- [ ] Fire control
- [ ] Check printed at table

#### Bar Tab
- [ ] Opened with card swipe/name
- [ ] Pre-authorization hold
- [ ] Running total visible
- [ ] Time-based alerts
- [ ] Close-out flow

#### Takeout/Pickup Order
- [ ] Customer name/phone
- [ ] Pickup time
- [ ] Ready notification
- [ ] Separate pickup display

#### Delivery Order
- [ ] Customer details
- [ ] Delivery address
- [ ] Driver assignment
- [ ] Delivery status tracking

#### Online Order
- [ ] Integration with online platforms
- [ ] Auto-imported
- [ ] Scheduled orders
- [ ] Special handling flags

### Order Lifecycle

```
[Created] → [Open] → [Sent] → [In Progress] → [Ready] → [Served] → [Paid] → [Closed]
                                    ↓
                               [Partially Paid]
                                    ↓
                                 [Paid]
```

#### States
- **Created:** Order exists but no items yet
- **Open:** Items added, not sent to kitchen
- **Sent:** Sent to kitchen/bar
- **In Progress:** Being prepared
- **Ready:** Ready for pickup/service
- **Served:** Delivered to guest
- **Partially Paid:** Some payments applied
- **Paid:** Fully paid
- **Closed:** Reconciled and closed
- **Voided:** Cancelled before payment

### Order Operations

#### Adding Items
- [ ] Add single item
- [ ] Add item with modifiers
- [ ] Add item with quantity
- [ ] Quick-add recent/favorite
- [ ] Repeat last item
- [ ] Copy item from another order

#### Modifying Items
- [ ] Edit modifiers on existing item
- [ ] Change quantity
- [ ] Add special instructions
- [ ] Change seat assignment
- [ ] Change course assignment

#### Removing Items
- [ ] Void item (before sent) - no approval needed
- [ ] Void item (after sent) - may need approval
- [ ] Record void reason
- [ ] Void vs Comp tracking

#### Item Status
- [ ] Ordered (pending send)
- [ ] Sent (to kitchen)
- [ ] Preparing
- [ ] Ready
- [ ] Served
- [ ] Voided
- [ ] Comped

### Check Operations

#### View Check
- [ ] All items with modifiers
- [ ] Item status indicators
- [ ] Subtotal, tax, total
- [ ] Applied discounts/comps
- [ ] Payments applied
- [ ] Balance due

#### Split Check
- [ ] **By Count:** Divide evenly by number of people
- [ ] **By Seat:** Assign items to seats, create check per seat
- [ ] **By Item:** Drag items to new check
- [ ] **Custom:** Manual item selection for each check
- [ ] **Payment Only:** Keep one check, split payment

#### Merge Checks
- [ ] Select multiple checks
- [ ] Combine into one
- [ ] Preserve item history

#### Transfer Check
- [ ] Transfer to different server
- [ ] Transfer to different table
- [ ] Move items between checks

#### Discounts & Comps
- [ ] Percentage discount (whole check or item)
- [ ] Dollar amount discount
- [ ] Comp item (with reason)
- [ ] Comp entire check (with reason)
- [ ] Manager approval required (configurable)

#### Other Operations
- [ ] Print check
- [ ] Reprint check
- [ ] Email check
- [ ] Hold/unhold order
- [ ] Add check notes
- [ ] Reopen closed check (manager only)

### Table Management

#### Floor Plan
- [ ] Multiple floor plans (indoor, patio, private)
- [ ] Visual table layout
- [ ] Drag-and-drop arrangement
- [ ] Table shapes and sizes
- [ ] Section assignments

#### Table Status
- [ ] Available (green)
- [ ] Seated - no order (yellow)
- [ ] Has order (blue)
- [ ] Ready to pay (purple)
- [ ] Needs attention (red)
- [ ] Reserved (gray)

#### Table Timer
- [ ] Time since seated
- [ ] Time since last activity
- [ ] Configurable alerts

#### Table Operations
- [ ] Seat party (with guest count)
- [ ] Start order
- [ ] View order
- [ ] Move party to different table
- [ ] Combine tables
- [ ] Split table
- [ ] Clear table

#### Sections
- [ ] Define sections
- [ ] Assign servers to sections
- [ ] Section summary view
- [ ] Rotation tracking

### Bar Tab Management

#### Opening Tab
- [ ] Swipe credit card
- [ ] Enter name
- [ ] Scan ID (optional)
- [ ] Pre-auth amount

#### Tab Display
- [ ] List view of all tabs
- [ ] Sort by: Name, Time, Amount
- [ ] Filter: My tabs / All tabs
- [ ] Search by name

#### Tab Operations
- [ ] Add items
- [ ] View tab
- [ ] Transfer tab
- [ ] Close tab
- [ ] Print tab

#### Tab Safeguards
- [ ] Pre-auth holds
- [ ] Tab timeout warnings
- [ ] Forced close at end of night
- [ ] Card storage security

### Course Management

#### Course Types
- [ ] Appetizers / First Course
- [ ] Soup / Salad
- [ ] Entrees / Main
- [ ] Dessert
- [ ] Custom courses

#### Course Control
- [ ] Assign items to courses
- [ ] Hold course
- [ ] Fire course
- [ ] Fire all courses
- [ ] Automatic progression (optional)

#### Kitchen Communication
- [ ] Course indicator on tickets
- [ ] Fire notification
- [ ] Course timing reports

### Kitchen Integration

#### Send to Kitchen
- [ ] Send all (new items)
- [ ] Send selected
- [ ] Rush order flag
- [ ] Fire order

#### Ticket Printing
- [ ] Printer routing by item type
- [ ] Consolidation rules
- [ ] Reprint tickets
- [ ] Void tickets

#### KDS Integration (if applicable)
- [ ] Real-time order display
- [ ] Item bump
- [ ] Ready notification
- [ ] Time tracking

---

## UI/UX Specifications

### Order Panel

```
+------------------------------------+
| TABLE 12          Server: Sarah   |
| Guests: 4         Time: 0:32      |
+------------------------------------+
| SEAT 1                            |
| 1x Burger          $14.99    [✓]  |
|    Medium Rare, +Bacon            |
| 1x House Salad      $8.99    [✓]  |
|    Ranch                          |
|                                   |
| SEAT 2                            |
| 1x Fish Tacos      $16.99    [~]  |
|    No Cilantro                    |
|                                   |
| SHARED                            |
| 1x Wings (Large)   $18.99    [!]  |
|    Extra Crispy                   |
+------------------------------------+
| Subtotal           $59.96         |
| Tax                 $4.80         |
| TOTAL              $64.76         |
+------------------------------------+
| [Hold]  [Send]  [Print]  [Pay]   |
+------------------------------------+

Status Icons:
[✓] Sent/Complete  [~] In Progress  [!] Ready  [ ] Pending
```

### Table Floor Plan

```
+------------------------------------------------------------------+
| FLOOR: Main Dining                    [Patio] [Private Room]     |
+------------------------------------------------------------------+
|                                                                  |
|   +-----+     +-----+     +-----+     +-----+                   |
|   |  1  |     |  2  |     |  3  |     |  4  |     BAR          |
|   | 0:45|     |     |     | 0:12|     |     |     [========]   |
|   +-----+     +-----+     +-----+     +-----+                   |
|   [BLUE]      [GREEN]     [YELLOW]    [GREEN]                   |
|                                                                  |
|   +-------+           +-----------+           +-------+         |
|   |   5   |           |     6     |           |   7   |         |
|   |  1:23 |           |           |           |  0:05 |         |
|   +-------+           +-----------+           +-------+         |
|   [PURPLE]            [GREEN]                 [BLUE]            |
|                                                                  |
|         +-----+     +-----+     +-----+                         |
|         |  8  |     |  9  |     | 10  |                         |
|         | 0:34|     |     |     |RSVD |                         |
|         +-----+     +-----+     +-----+                         |
|         [BLUE]      [GREEN]     [GRAY]                          |
|                                                                  |
+------------------------------------------------------------------+
| Section: All     Server: All     Status: All        [Refresh]   |
+------------------------------------------------------------------+
```

### Bar Tabs View

```
+------------------------------------------------------------------+
| OPEN TABS                                    [+ New Tab] [Close All] |
+------------------------------------------------------------------+
| Search: [________________]          Sort: [Name ▼]              |
+------------------------------------------------------------------+
| NAME            | CARD      | TIME    | TOTAL  | ITEMS | ACTION |
+------------------------------------------------------------------+
| Johnson, Mike   | ****4521  | 2:34    | $45.50 | 6     | [View] |
| Smith, Sarah    | ****1234  | 1:12    | $28.00 | 3     | [View] |
| Brown, Tom      | Cash Tab  | 0:45    | $12.50 | 2     | [View] |
| Williams, J     | ****9876  | 3:45!   | $89.00 | 12    | [View] |
| Garcia, Maria   | ****5555  | 0:22    | $15.00 | 2     | [View] |
+------------------------------------------------------------------+
                                     Total Open: $190.00 (5 tabs)
```

---

## Data Model

### Orders
```sql
orders {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Order identification
  order_number: VARCHAR(20)
  order_type: VARCHAR(50) (quick, table, tab, takeout, delivery, online)

  -- Assignment
  table_id: UUID (FK, nullable)
  employee_id: UUID (FK) -- Primary server/owner

  -- Customer info
  customer_name: VARCHAR(100) (nullable)
  customer_phone: VARCHAR(20) (nullable)
  customer_email: VARCHAR(200) (nullable)
  guest_count: INTEGER (nullable)

  -- Bar tab
  tab_name: VARCHAR(100) (nullable)
  card_token: VARCHAR(200) (nullable, encrypted)
  preauth_amount: DECIMAL(10,2) (nullable)

  -- Timing
  created_at: TIMESTAMP
  opened_at: TIMESTAMP
  sent_at: TIMESTAMP (nullable)
  closed_at: TIMESTAMP (nullable)

  -- Status
  status: VARCHAR(50) (created, open, sent, in_progress, ready, served, paid, closed, voided)

  -- Totals (denormalized for performance)
  subtotal: DECIMAL(10,2) DEFAULT 0
  tax_total: DECIMAL(10,2) DEFAULT 0
  discount_total: DECIMAL(10,2) DEFAULT 0
  tip_total: DECIMAL(10,2) DEFAULT 0
  total: DECIMAL(10,2) DEFAULT 0
  balance_due: DECIMAL(10,2) DEFAULT 0

  -- Metadata
  notes: TEXT (nullable)
  source: VARCHAR(50) (pos, online, kiosk, phone)

  updated_at: TIMESTAMP
}
```

### Order Items
```sql
order_items {
  id: UUID PRIMARY KEY
  order_id: UUID (FK)
  menu_item_id: UUID (FK)

  -- Item details (captured at time of order)
  item_name: VARCHAR(200)
  item_short_name: VARCHAR(50)
  base_price: DECIMAL(10,2)

  -- Customization
  quantity: INTEGER DEFAULT 1
  seat_number: INTEGER (nullable)
  course: VARCHAR(50) (nullable)
  special_instructions: TEXT (nullable)

  -- Pricing
  unit_price: DECIMAL(10,2) -- Base + modifier adjustments
  total_price: DECIMAL(10,2) -- Unit price * quantity

  -- Status
  status: VARCHAR(50) (pending, sent, preparing, ready, served, voided, comped)
  sent_at: TIMESTAMP (nullable)
  ready_at: TIMESTAMP (nullable)
  served_at: TIMESTAMP (nullable)

  -- Void/Comp info
  void_reason: VARCHAR(200) (nullable)
  voided_by: UUID (FK, nullable)
  voided_at: TIMESTAMP (nullable)
  comp_reason: VARCHAR(200) (nullable)
  comped_by: UUID (FK, nullable)

  -- Tracking
  created_by: UUID (FK)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP

  sort_order: INTEGER
}
```

### Order Item Modifiers
```sql
order_item_modifiers {
  id: UUID PRIMARY KEY
  order_item_id: UUID (FK)
  modifier_id: UUID (FK)
  parent_modifier_id: UUID (FK, nullable) -- For nested modifiers

  -- Captured at time of order
  modifier_name: VARCHAR(100)
  modifier_group_name: VARCHAR(100)
  price_adjustment: DECIMAL(10,2)

  nesting_level: INTEGER DEFAULT 0

  created_at: TIMESTAMP
}
```

### Tables
```sql
tables {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  floor_plan_id: UUID (FK)

  table_number: VARCHAR(20)
  table_name: VARCHAR(50) (nullable) -- e.g., "Window Booth"

  -- Position (for floor plan rendering)
  position_x: INTEGER
  position_y: INTEGER
  width: INTEGER
  height: INTEGER
  shape: VARCHAR(20) (round, square, rectangle)
  rotation: INTEGER DEFAULT 0

  -- Capacity
  min_capacity: INTEGER DEFAULT 1
  max_capacity: INTEGER

  -- Assignment
  section_id: UUID (FK, nullable)

  -- Status
  status: VARCHAR(50) (available, seated, occupied, reserved, blocked)
  current_order_id: UUID (FK, nullable)
  seated_at: TIMESTAMP (nullable)
  guest_count: INTEGER (nullable)

  is_active: BOOLEAN DEFAULT true
  sort_order: INTEGER

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Floor Plans
```sql
floor_plans {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)

  -- Dimensions
  width: INTEGER
  height: INTEGER

  is_default: BOOLEAN DEFAULT false
  is_active: BOOLEAN DEFAULT true
  sort_order: INTEGER

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Sections
```sql
sections {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(50)
  color: VARCHAR(7) (hex)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Order Discounts
```sql
order_discounts {
  id: UUID PRIMARY KEY
  order_id: UUID (FK)
  order_item_id: UUID (FK, nullable) -- If item-level discount

  discount_type: VARCHAR(50) (percent, amount, comp)
  discount_value: DECIMAL(10,2)
  discount_amount: DECIMAL(10,2) -- Calculated amount

  reason: VARCHAR(200)
  approved_by: UUID (FK, nullable)

  created_by: UUID (FK)
  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Orders
```
POST   /api/orders                          -- Create order
GET    /api/orders                          -- List orders (filterable)
GET    /api/orders/{id}                     -- Get order details
PUT    /api/orders/{id}                     -- Update order
DELETE /api/orders/{id}                     -- Void order
POST   /api/orders/{id}/send                -- Send to kitchen
POST   /api/orders/{id}/close               -- Close order
POST   /api/orders/{id}/reopen              -- Reopen closed order
```

### Order Items
```
POST   /api/orders/{id}/items               -- Add item
PUT    /api/orders/{id}/items/{item_id}     -- Update item
DELETE /api/orders/{id}/items/{item_id}     -- Remove/void item
POST   /api/orders/{id}/items/{item_id}/void  -- Void with reason
```

### Check Operations
```
POST   /api/orders/{id}/split               -- Split check
POST   /api/orders/merge                    -- Merge checks
POST   /api/orders/{id}/transfer            -- Transfer check
POST   /api/orders/{id}/discounts           -- Apply discount
```

### Tables
```
GET    /api/locations/{loc}/tables          -- List all tables
GET    /api/locations/{loc}/tables/{id}     -- Get table details
PUT    /api/locations/{loc}/tables/{id}     -- Update table
POST   /api/tables/{id}/seat                -- Seat guests
POST   /api/tables/{id}/clear               -- Clear table
POST   /api/tables/{id}/move                -- Move to different table
```

### Floor Plans
```
GET    /api/locations/{loc}/floor-plans
POST   /api/locations/{loc}/floor-plans
PUT    /api/locations/{loc}/floor-plans/{id}
DELETE /api/locations/{loc}/floor-plans/{id}
```

### Tabs
```
GET    /api/locations/{loc}/tabs            -- List open tabs
POST   /api/locations/{loc}/tabs            -- Open new tab
GET    /api/tabs/{id}                       -- Get tab details
POST   /api/tabs/{id}/close                 -- Close tab
```

### Real-Time
```
WS /ws/orders/{location_id}

Events:
- order:created
- order:updated
- order:item-added
- order:item-updated
- order:sent
- order:ready
- order:paid
- order:closed
- table:status-changed
```

---

## Business Rules

1. **Order Ownership:** Order created by employee A belongs to A until transferred
2. **Void Tracking:** All voids recorded with timestamp, employee, and reason
3. **Void Approval:** Items sent to kitchen require manager approval to void (configurable)
4. **Check Reopen:** Only managers can reopen closed checks
5. **Tab Pre-Auth:** Credit card tabs require pre-authorization hold
6. **Tab Timeout:** Tabs open longer than X hours trigger alert
7. **Split Limits:** Split checks inherit original order's tracking
8. **Course Firing:** Items not fired until explicitly fired or end of course
9. **Table Timing:** Table turns tracked for reporting

---

## Permissions

| Action | Server | Bartender | Manager | Admin |
|--------|--------|-----------|---------|-------|
| Create orders | Yes | Yes | Yes | Yes |
| View own orders | Yes | Yes | Yes | Yes |
| View all orders | No | No | Yes | Yes |
| Add items | Yes | Yes | Yes | Yes |
| Void own items (unsent) | Yes | Yes | Yes | Yes |
| Void own items (sent) | Config | Config | Yes | Yes |
| Void any items | No | No | Yes | Yes |
| Apply discount | Config | Config | Yes | Yes |
| Comp items | No | No | Yes | Yes |
| Transfer orders | Yes | Yes | Yes | Yes |
| Split checks | Yes | Yes | Yes | Yes |
| Reopen closed check | No | No | Yes | Yes |
| Manage tables | Yes | Yes | Yes | Yes |
| Edit floor plan | No | No | Yes | Yes |

---

## Configuration Options

```yaml
order_management:
  order_types:
    quick_service:
      enabled: true
      number_format: "Q-###"
    table_service:
      enabled: true
      require_guest_count: true
      require_table: true
    bar_tabs:
      enabled: true
      require_card: true
      preauth_amount: 50.00
      timeout_hours: 4
    takeout:
      enabled: true
    delivery:
      enabled: false

  voiding:
    require_reason: true
    require_approval_after_sent: true

  discounts:
    require_reason: true
    max_percent_without_approval: 20
    max_amount_without_approval: 25.00

  tables:
    timer_enabled: true
    timer_warning_minutes: 60
    auto_clear_on_close: true

  courses:
    enabled: true
    default_courses: ["Appetizer", "Entree", "Dessert"]
    auto_fire: false
```

---

## Open Questions

1. **Reservations:** Should reservation system be part of this skill or separate?

2. **Waitlist:** Include waitlist management?

3. **Server Banking:** Each server has own cash drawer vs shared drawer?

4. **Course Auto-Fire:** Automatically fire next course after X minutes?

5. **Table Merge:** When merging tables, how to handle partial orders?

6. **Online Order Integration:** Which platforms to support? Custom API?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [x] Data model defined
- [ ] Screen flows mapped
- [ ] API contract reviewed

### Development
- [ ] Order CRUD
- [ ] Item management
- [ ] Check operations
- [ ] Table management
- [ ] Floor plan editor
- [ ] Bar tab system
- [ ] Course management
- [ ] Kitchen integration
- [ ] Real-time updates

### Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] Split/merge scenarios
- [ ] Performance testing

---

*Last Updated: January 27, 2026*
