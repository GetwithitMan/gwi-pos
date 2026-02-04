# 02 - Operator Experience

**Status:** Planning
**Priority:** Critical
**Dependencies:** 03-Menu-Programming, 04-Order-Management, 05-Employees-Roles

---

## Overview

The Operator Experience skill is the **heart of the POS system** - it's the main interface that servers, bartenders, cashiers, and managers use all day. Every design decision must optimize for speed, minimal clicks, and reducing cognitive load.

**Primary Goal:** Enable staff to take orders, manage checks, and process payments with the fewest clicks possible while preventing errors.

---

## User Stories

### As a Server...
- I want to quickly start an order for a table without extra steps
- I want to add items and modifiers with minimal taps
- I want to see my open tables/checks at a glance
- I want to split checks and transfer tables easily
- I want to process payments and close checks quickly

### As a Bartender...
- I want to open tabs with one swipe of a card
- I want quick access to frequently ordered drinks
- I want to see all open tabs and their totals
- I want to close tabs rapidly during rush

### As a Cashier (Quick Service)...
- I want to start taking an order immediately
- I want large, clear buttons for common items
- I want the total always visible
- I want to complete payment in 2-3 taps

### As a Manager...
- I want to see all open orders across the floor
- I want to quickly approve voids/discounts
- I want to help staff with any check issues
- I want to access reports without leaving the floor

---

## Features

### Main POS Interface

#### Navigation Bar (Always Visible)
- [ ] Current employee name/avatar
- [ ] Clock in/out status
- [ ] Current time
- [ ] Quick actions menu
- [ ] Notifications/alerts
- [ ] Manager override button
- [ ] Lock screen button

#### Order Entry Area
- [ ] Active order display (items, mods, prices)
- [ ] Running subtotal, tax, total
- [ ] Guest/seat assignment
- [ ] Order notes
- [ ] Item search bar
- [ ] Recent items quick-add
- [ ] Hold/send controls

#### Menu Navigation
- [ ] Category tabs/buttons
- [ ] Sub-category drill-down
- [ ] Item grid (configurable size)
- [ ] Quick search with autocomplete
- [ ] Favorites/frequent items section
- [ ] 86'd items clearly marked

#### Function Buttons
- [ ] New Order
- [ ] Open Checks
- [ ] Tables/Floor Plan
- [ ] Tabs
- [ ] Pay
- [ ] Void
- [ ] Discount
- [ ] Transfer
- [ ] Split
- [ ] Print
- [ ] Manager Functions

### Order Building Workflow

#### Starting an Order
```
Quick Service:     [New Order] → Start adding items (1 click)
Table Service:     [Tables] → Tap table → [New Order] (2 clicks)
Bar Tab:           [Tabs] → Swipe card → Start adding items (1 click + swipe)
Existing Order:    [Open Checks] → Select check → Add items (2 clicks)
```

#### Adding Items
- [ ] Tap category → Tap item (2 clicks for simple item)
- [ ] Required modifiers auto-prompt
- [ ] Optional modifiers skippable
- [ ] Quantity adjustment (+/- or numpad)
- [ ] Quick repeat last item
- [ ] Search item by name

#### Modifying Items
- [ ] Tap item in order to edit
- [ ] Add/remove modifiers
- [ ] Special instructions (keyboard)
- [ ] Change quantity
- [ ] Void item (if permitted)
- [ ] Change seat assignment

### Check Management

#### Check List View
- [ ] Filter: My checks / All checks
- [ ] Sort: By table, by time, by amount
- [ ] Status indicators (new, in progress, printed, paid)
- [ ] Quick preview on hover/hold
- [ ] Batch select for operations

#### Split Check
- [ ] Split by number of guests (divide evenly)
- [ ] Split by seat (items tagged to seats)
- [ ] Split by item (drag items to new checks)
- [ ] Custom split (manual selection)
- [ ] Split payment only (one check, multiple payments)

#### Transfer Check
- [ ] Transfer to another server
- [ ] Transfer to another table
- [ ] Merge with another check
- [ ] Move items between checks

### Payment Processing

#### Payment Flow
```
[Pay] → Select payment method → Process → Tip (if credit) → Receipt → Close
```

#### Payment Options
- [ ] Cash (with calculator)
- [ ] Credit/Debit card
- [ ] Gift card
- [ ] Split tender
- [ ] House account
- [ ] Comp (with reason)

#### Quick Pay
- [ ] One-tap "Cash - Exact"
- [ ] One-tap "Card" (goes to reader)
- [ ] Preset cash amounts ($20, $50, $100)

### Table/Floor View

#### Floor Plan Display
- [ ] Visual layout of tables
- [ ] Color-coded status
- [ ] Server section highlighting
- [ ] Table timer (time seated)
- [ ] Guest count per table
- [ ] Quick-tap to view/start order

#### Table Actions (on tap)
- [ ] View current order
- [ ] Start new order
- [ ] Print check
- [ ] Close/clear table
- [ ] Transfer table
- [ ] Move guests to different table

### Quick Actions

#### Speed Buttons (Customizable)
- [ ] Water/Bread (common free items)
- [ ] Void last item
- [ ] Reprint last ticket
- [ ] Open drawer
- [ ] Call manager

#### Keyboard Shortcuts
```
N - New order
S - Search items
P - Pay current order
V - Void mode
T - Tables view
O - Open checks
Esc - Cancel/back
Enter - Confirm selection
1-9 - Quantity
```

---

## UI/UX Specifications

### Main POS Layout

```
+------------------------------------------------------------------+
| [User] Sarah M.  |  12:45 PM  |  [Alerts 2]  | [Lock] | [Menu]  |
+------------------------------------------------------------------+
|                    |                                              |
|  CURRENT ORDER     |              MENU AREA                       |
|  Table 12 (4)      |                                              |
|  ----------------  |  [Appetizers] [Entrees] [Drinks] [Desserts] |
|  1x Burger  $14.99 |                                              |
|    +Bacon          |  +--------+ +--------+ +--------+ +--------+ |
|    +No Onion       |  | Wings  | | Nachos | | Salad  | | Soup   | |
|  1x Fries    $4.99 |  | $12.99 | | $10.99 | | $8.99  | | $6.99  | |
|  2x IPA      $14.00|  +--------+ +--------+ +--------+ +--------+ |
|                    |                                              |
|  ----------------  |  +--------+ +--------+ +--------+ +--------+ |
|  Subtotal   $33.98 |  | Burger | | Steak  | | Fish   | | Pasta  | |
|  Tax         $2.72 |  | $14.99 | | $28.99 | | $22.99 | | $16.99 | |
|  TOTAL      $36.70 |  +--------+ +--------+ +--------+ +--------+ |
|                    |                                              |
|  [Hold] [Send]     |  +--------+ +--------+ +--------+ +--------+ |
|                    |  | ...    | | ...    | | ...    | | ...    | |
+--------------------+  +--------+ +--------+ +--------+ +--------+ |
|                                                                   |
| [New] [Checks] [Tables] [Tabs] [Pay] [Void] [Disc] [More...]     |
+-------------------------------------------------------------------+
```

### Design Requirements

- **Touch Optimized:** All buttons minimum 44x44px, ideally 60x60px+
- **Visual Hierarchy:** Active order always visible, totals prominent
- **Color Coding:**
  - Green: Available, success, go
  - Yellow/Orange: Warning, pending
  - Red: Alert, void, urgent
  - Blue: Information, selected
- **Font Sizes:**
  - Item names: 16-18px
  - Prices: 16-18px
  - Totals: 20-24px
  - Category headers: 14-16px
- **Grid Options:**
  - Small grid: More items visible
  - Large grid: Bigger touch targets
  - List view: For long menus

### Screen States

1. **Order Entry** - Default view, ready to add items
2. **Modifier Selection** - Modal/overlay for selecting modifiers
3. **Check View** - Full check details, ready for payment
4. **Payment** - Payment method selection and processing
5. **Tables View** - Floor plan with table status
6. **Tabs View** - List of open bar tabs
7. **Search** - Item search interface
8. **Manager Functions** - Manager-only operations

---

## Data Model

This skill primarily orchestrates data from other skills. Stores UI preferences.

### TerminalConfig
```
terminal_config {
  id: UUID
  location_id: UUID (FK)
  terminal_name: string

  // Layout
  menu_grid_size: enum (small, medium, large)
  show_item_images: boolean
  show_item_prices: boolean
  left_handed_mode: boolean

  // Behavior
  default_order_type: enum (quick, table, tab)
  auto_send_to_kitchen: boolean
  confirm_on_send: boolean
  print_on_send: boolean

  // Quick buttons
  quick_buttons: JSON [{ label, action, item_id }]

  // Sound
  sounds_enabled: boolean
  new_order_sound: string

  created_at: timestamp
  updated_at: timestamp
}
```

### EmployeeUIPreferences
```
employee_ui_preferences {
  employee_id: UUID (FK)

  favorite_items: UUID[] (item_ids)
  recent_items_count: integer
  default_view: enum (order, tables, tabs)
  theme: enum (light, dark, auto)
  font_size: enum (normal, large, extra-large)

  updated_at: timestamp
}
```

---

## API Endpoints

### Terminal Configuration
```
GET  /api/terminals/{id}/config
PUT  /api/terminals/{id}/config
```

### Order Operations (delegates to 04-ORDER-MANAGEMENT)
```
POST /api/orders
GET  /api/orders/{id}
PUT  /api/orders/{id}
POST /api/orders/{id}/items
DELETE /api/orders/{id}/items/{item_id}
POST /api/orders/{id}/send
POST /api/orders/{id}/hold
```

### Check Operations
```
POST /api/orders/{id}/split
POST /api/orders/{id}/merge
POST /api/orders/{id}/transfer
```

### Payment (delegates to payment system)
```
POST /api/orders/{id}/payments
GET  /api/orders/{id}/payments
```

### Real-Time (WebSocket)
```
WS /ws/terminal/{terminal_id}

Events:
- order:updated
- order:new (from another terminal)
- kitchen:ready (order ready)
- manager:alert
- sync:refresh
```

---

## Business Rules

1. **Order Ownership:** Orders are "owned" by creating employee until transferred
2. **Void Permissions:** Item voids may require manager approval based on employee role
3. **Price Overrides:** Only managers can override prices
4. **Discount Limits:** Employees may have maximum discount amount/percentage
5. **Cash Handling:** Cash drawers assigned to employees, tracked per shift
6. **Session Timeout:** Terminal locks after X minutes of inactivity (configurable)
7. **Force Clock-In:** Cannot take orders without being clocked in

---

## Permissions

| Action | Server | Bartender | Cashier | Manager | Admin |
|--------|--------|-----------|---------|---------|-------|
| Take orders | Yes | Yes | Yes | Yes | Yes |
| View own orders | Yes | Yes | Yes | Yes | Yes |
| View all orders | No | No | No | Yes | Yes |
| Void own items | Config | Config | Config | Yes | Yes |
| Void any items | No | No | No | Yes | Yes |
| Apply discount | Config | Config | Config | Yes | Yes |
| Process refund | No | No | No | Yes | Yes |
| Override price | No | No | No | Yes | Yes |
| Transfer checks | Yes | Yes | Yes | Yes | Yes |
| Access manager functions | No | No | No | Yes | Yes |
| Configure terminal | No | No | No | Yes | Yes |

---

## Configuration Options

Located in: 09-FEATURES-CONFIG

```yaml
operator_experience:
  layout:
    default_grid_size: "medium"
    show_images: true
    show_prices: true
    order_panel_position: "left"  # or "right"

  behavior:
    auto_send_enabled: false
    print_on_send: true
    require_guest_count: true
    require_table_for_dine_in: true

  quick_service:
    enabled: true
    auto_order_number: true
    number_format: "A-###"

  table_service:
    enabled: true
    course_management: true
    seat_tracking: true

  bar_tabs:
    enabled: true
    require_card: true
    preauth_amount: 50.00
    tab_timeout_hours: 4

  security:
    session_timeout_minutes: 15
    require_pin_for_void: true
    require_pin_for_discount: true
```

---

## Open Questions

1. **Left-Handed Mode:** Should we support a mirrored layout for left-handed users?

2. **Voice Commands:** Is voice ordering (accessibility) a consideration?

3. **Multi-Language:** Support for Spanish on operator interface?

4. **Training Mode:** A "sandbox" mode for training new employees without affecting real data?

5. **Offline Mode:** How much functionality should work when internet is down?

6. **Custom Quick Buttons:** Let employees customize their own quick buttons?

7. **Theme Options:** Light/dark/custom themes?

8. **Peripheral Status:** Show payment terminal, printer, KDS connection status?

---

## Screen Flows

### New Table Order
```
[Tables] → [Tap Table 12] → [Start Order]
         → [Enter Guest Count: 4] → [Order Screen Ready]
```

### Add Item with Modifiers
```
[Tap "Burger"] → [Modifier: Cooking Temp - Required]
              → [Tap "Medium"]
              → [Modifier: Add-Ons - Optional]
              → [Tap "Bacon" "+$2"]
              → [Tap "Done"] → Item Added
```

### Quick Close Tab
```
[Tabs] → [Tap "Johnson Tab"] → [Pay] → [Card]
      → Customer tips on card reader → [Close Tab]
```

### Split Check
```
[Checks] → [Tap Check #1234] → [Split] → [Select: By Seat]
        → [Drag items to Seat 1, Seat 2, etc.]
        → [Confirm Split] → Two separate checks created
```

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Screen flows mapped
- [ ] UI mockups created
- [ ] Component library defined
- [ ] API contract finalized

### Development
- [ ] Navigation/shell component
- [ ] Order entry panel
- [ ] Menu navigation
- [ ] Modifier selection
- [ ] Check management
- [ ] Payment flow
- [ ] Tables view
- [ ] Tabs view
- [ ] Search functionality
- [ ] Manager functions

### Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] Performance testing (speed)
- [ ] Usability testing
- [ ] Stress testing (rush simulation)

---

*Last Updated: January 27, 2026*
