# 23 - Online Ordering

**Status:** Planning
**Priority:** High
**Dependencies:** 03-Menu-Programming, 04-Order-Management

---

## Overview

The Online Ordering skill enables customers to place orders through a web interface or mobile app for pickup or delivery. Includes order management, menu sync, scheduling, and integration with third-party delivery platforms.

**Primary Goal:** Provide a seamless online ordering experience that integrates smoothly with POS operations.

---

## User Stories

### As a Customer...
- I want to browse the menu and see prices
- I want to customize my order with modifiers
- I want to choose pickup or delivery
- I want to schedule an order for later
- I want to track my order status

### As a Restaurant Manager...
- I want online orders to flow into the POS
- I want to control which items are available online
- I want to set lead times and capacity limits
- I want to pause online ordering when too busy

### As a Kitchen Staff...
- I want online orders clearly identified
- I want to see pickup/delivery time
- I want to mark orders as ready

---

## Features

### Customer-Facing Website/App

#### Menu Display
- [ ] Categories and items
- [ ] Item descriptions and photos
- [ ] Prices (including online-specific pricing)
- [ ] Modifier selection
- [ ] Allergen and dietary info
- [ ] Item availability (86'd items hidden)

#### Order Building
- [ ] Add items to cart
- [ ] Customize with modifiers
- [ ] Special instructions
- [ ] Quantity adjustments
- [ ] Cart summary
- [ ] Save cart (logged in users)

#### Order Types
- [ ] Pickup (ASAP or scheduled)
- [ ] Delivery (if enabled)
- [ ] Curbside pickup
- [ ] Dine-in pre-order (future)

#### Scheduling
- [ ] ASAP ordering
- [ ] Future date/time selection
- [ ] Available time slots
- [ ] Lead time requirements
- [ ] Capacity-based availability

#### Checkout
- [ ] Contact information
- [ ] Delivery address (if delivery)
- [ ] Payment processing
- [ ] Tip option
- [ ] Promo code entry
- [ ] Order confirmation

#### Order Tracking
- [ ] Order received confirmation
- [ ] Preparation status
- [ ] Ready for pickup notification
- [ ] Delivery tracking (if integrated)

### Restaurant Management

#### Menu Sync
- [ ] Automatic sync from POS menu
- [ ] Online-specific availability
- [ ] Online-specific pricing
- [ ] Item descriptions/photos for online
- [ ] Category organization for web

#### Order Management
- [ ] View incoming online orders
- [ ] Accept/reject orders
- [ ] Modify lead times
- [ ] Adjust preparation time
- [ ] Mark orders ready
- [ ] Contact customer

#### Capacity Control
- [ ] Orders per time slot
- [ ] Pause online ordering
- [ ] Temporary closure
- [ ] Holiday/special hours

#### Fulfillment
- [ ] Pickup workflow
- [ ] Delivery handoff
- [ ] Driver management (if in-house)

### Integration Options

#### Direct Online Ordering
- [ ] Branded website/app
- [ ] Full menu control
- [ ] Customer data ownership
- [ ] Lower fees

#### Third-Party Platforms
- [ ] DoorDash integration
- [ ] UberEats integration
- [ ] Grubhub integration
- [ ] Menu sync to platforms
- [ ] Order import from platforms

### Notifications

#### Customer Notifications
- [ ] Order confirmation (email/SMS)
- [ ] Preparation started
- [ ] Ready for pickup
- [ ] Delivery update
- [ ] Delay notification

#### Restaurant Notifications
- [ ] New order alert
- [ ] Order approaching due time
- [ ] Customer arrival (curbside)

---

## UI/UX Specifications

### Online Menu (Customer View)

```
+------------------------------------------------------------------+
|  RESTAURANT NAME                    [Cart (3) $45.67]  [Account] |
+------------------------------------------------------------------+
|  [Pickup ▼] at [123 Main St]        [ASAP ▼] or Schedule        |
+------------------------------------------------------------------+
|                                                                  |
|  CATEGORIES                         APPETIZERS                   |
|  +--------------+                                                |
|  | Appetizers   |   +------------------------------------------+ |
|  | Salads       |   | [img] WINGS                              | |
|  | Burgers      |   |       Crispy wings with your choice      | |
|  | Entrees      |   |       of sauce. Served with ranch.       | |
|  | Sides        |   |       $12.99             [Add to Cart]   | |
|  | Desserts     |   +------------------------------------------+ |
|  | Drinks       |                                                |
|  +--------------+   +------------------------------------------+ |
|                     | [img] NACHOS                             | |
|                     |       Loaded nachos with all the         | |
|                     |       toppings. Feeds 2-4.               | |
|                     |       $13.99             [Add to Cart]   | |
|                     +------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
```

### Item Customization Modal

```
+------------------------------------------------------------------+
| WINGS                                                 [Close]    |
+------------------------------------------------------------------+
| [Image]                                                          |
|                                                                  |
| Crispy wings with your choice of sauce. Served with ranch.      |
|                                                                  |
| $12.99                                                          |
+------------------------------------------------------------------+
| SIZE (Required)                                                  |
| ( ) 6 Wings - $12.99                                            |
| (•) 12 Wings - $21.99                                           |
| ( ) 18 Wings - $29.99                                           |
+------------------------------------------------------------------+
| SAUCE (Required - Choose 1)                                      |
| ( ) Buffalo        (•) BBQ           ( ) Garlic Parm            |
| ( ) Honey Mustard  ( ) Lemon Pepper  ( ) Naked (no sauce)       |
+------------------------------------------------------------------+
| EXTRAS (Optional)                                                |
| [ ] Extra Ranch +$0.75     [ ] Extra Sauce +$0.50               |
| [ ] Celery +$1.00          [ ] Blue Cheese +$1.00               |
+------------------------------------------------------------------+
| SPECIAL INSTRUCTIONS                                             |
| [Extra crispy please_____________________________________]       |
+------------------------------------------------------------------+
| QUANTITY:  [-] 1 [+]                                            |
|                                                                  |
| [Cancel]                    [Add to Cart - $21.99]              |
+------------------------------------------------------------------+
```

### POS Online Order View

```
+------------------------------------------------------------------+
| ONLINE ORDERS                              [Pause Ordering]      |
+------------------------------------------------------------------+
| INCOMING                    | IN PROGRESS          | READY       |
+------------------------------------------------------------------+
| +------------------------+  | +------------------+ | +----------+|
| | ORDER #OL-1234        |  | | ORDER #OL-1230   | | | #OL-1228 ||
| | PICKUP - ASAP         |  | | PICKUP 5:45 PM   | | | Ready    ||
| | John Smith            |  | | Sarah J.         | | | Pickup   ||
| | 3 items - $45.67      |  | | 2 items - $28.99 | | | 2 min ago||
| | Placed: 2 min ago     |  | | Due in: 8 min    | | +----------+|
| |                       |  | +------------------+ |             |
| | [Accept] [Reject]     |  |                      | +----------+|
| +------------------------+  | +------------------+ | | #OL-1225 ||
|                            | | ORDER #OL-1232   | | | Ready    ||
| +------------------------+  | | DELIVERY 6:00 PM | | | Delivery ||
| | ORDER #OL-1235        |  | | Mike T.          | | | 5 min ago||
| | DELIVERY - 6:30 PM    |  | | 5 items - $67.50 | | +----------+|
| | Jane Doe              |  | | Due in: 22 min   | |             |
| | 5 items - $67.50      |  | +------------------+ |             |
| | Placed: Just now      |  |                      |             |
| |                       |  |                      |             |
| | [Accept] [Reject]     |  |                      |             |
| +------------------------+  |                      |             |
+------------------------------------------------------------------+
```

### Online Order Detail

```
+------------------------------------------------------------------+
| ORDER #OL-1234                                    [Print] [Edit] |
+------------------------------------------------------------------+
| Type: PICKUP (ASAP)              Status: PREPARING              |
| Customer: John Smith             Phone: (555) 123-4567          |
| Due: 5:15 PM (in 12 minutes)     Placed: 5:03 PM               |
+------------------------------------------------------------------+
| ITEMS                                                            |
| 1x Wings (12 pc)                                         $21.99 |
|    BBQ Sauce, Extra Ranch                                       |
|    "Extra crispy please"                                        |
|                                                                  |
| 1x Cheeseburger                                          $14.99 |
|    Medium, Bacon, No Onion                                      |
|                                                                  |
| 1x House Salad                                            $8.99 |
|    Ranch on the side                                            |
|                                                                  |
| ───────────────────────────────────────────────────────────────  |
| Subtotal:                                                $45.97 |
| Tax:                                                      $3.68 |
| Tip:                                                      $6.00 |
| TOTAL:                                                   $55.65 |
+------------------------------------------------------------------+
| [Contact Customer]    [Mark Ready]    [Cancel Order]             |
+------------------------------------------------------------------+
```

---

## Data Model

### Online Orders
```sql
online_orders {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  order_id: UUID (FK) -- Links to main orders table once accepted

  -- Order identification
  online_order_number: VARCHAR(20) -- e.g., OL-1234
  external_order_id: VARCHAR(100) (nullable) -- Third-party ID

  -- Type
  order_type: VARCHAR(50) (pickup, delivery, curbside)
  source: VARCHAR(50) (website, app, doordash, ubereats, etc.)

  -- Customer
  customer_name: VARCHAR(200)
  customer_email: VARCHAR(200)
  customer_phone: VARCHAR(20)

  -- Delivery
  delivery_address: TEXT (nullable)
  delivery_instructions: TEXT (nullable)

  -- Timing
  is_asap: BOOLEAN DEFAULT true
  scheduled_time: TIMESTAMP (nullable)
  estimated_ready_time: TIMESTAMP (nullable)
  actual_ready_time: TIMESTAMP (nullable)

  -- Status
  status: VARCHAR(50) (pending, accepted, preparing, ready, completed, cancelled)

  -- Totals
  subtotal: DECIMAL(10,2)
  tax: DECIMAL(10,2)
  tip: DECIMAL(10,2)
  delivery_fee: DECIMAL(10,2) DEFAULT 0
  total: DECIMAL(10,2)

  -- Payment
  payment_status: VARCHAR(50) (pending, paid, refunded)
  payment_method: VARCHAR(50)
  payment_reference: VARCHAR(100) (nullable)

  -- Metadata
  promo_code: VARCHAR(50) (nullable)
  special_instructions: TEXT (nullable)

  placed_at: TIMESTAMP
  accepted_at: TIMESTAMP (nullable)
  completed_at: TIMESTAMP (nullable)
  cancelled_at: TIMESTAMP (nullable)
  cancellation_reason: VARCHAR(200) (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Online Order Items
```sql
online_order_items {
  id: UUID PRIMARY KEY
  online_order_id: UUID (FK)

  menu_item_id: UUID (FK)
  item_name: VARCHAR(200)
  quantity: INTEGER

  unit_price: DECIMAL(10,2)
  modifiers_price: DECIMAL(10,2) DEFAULT 0
  total_price: DECIMAL(10,2)

  modifiers: JSONB -- Captured modifier selections
  special_instructions: TEXT (nullable)

  created_at: TIMESTAMP
}
```

### Online Menu Settings
```sql
online_menu_settings {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Availability
  is_enabled: BOOLEAN DEFAULT true
  pickup_enabled: BOOLEAN DEFAULT true
  delivery_enabled: BOOLEAN DEFAULT false

  -- Hours
  online_hours: JSONB -- Day/time availability
  lead_time_minutes: INTEGER DEFAULT 20

  -- Capacity
  orders_per_slot: INTEGER (nullable)
  pause_threshold_orders: INTEGER (nullable)

  -- Delivery
  delivery_radius_miles: DECIMAL(5,2) (nullable)
  delivery_fee: DECIMAL(10,2) (nullable)
  delivery_minimum: DECIMAL(10,2) (nullable)

  -- Payment
  accepted_payments: VARCHAR[] (credit, apple_pay, etc.)
  tip_enabled: BOOLEAN DEFAULT true
  tip_suggestions: DECIMAL[] DEFAULT [0.15, 0.18, 0.20, 0.22]

  updated_at: TIMESTAMP
}
```

### Menu Item Online Settings
```sql
menu_item_online_settings {
  menu_item_id: UUID PRIMARY KEY (FK)

  available_online: BOOLEAN DEFAULT true
  online_price: DECIMAL(10,2) (nullable) -- Override
  online_name: VARCHAR(200) (nullable) -- Override
  online_description: TEXT (nullable)
  online_image_url: VARCHAR(500) (nullable)

  max_per_order: INTEGER (nullable)

  -- Lead time override
  prep_time_minutes: INTEGER (nullable)

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Customer-Facing
```
GET    /api/online/menu
GET    /api/online/menu/{category_id}
GET    /api/online/menu/item/{item_id}
GET    /api/online/availability
GET    /api/online/timeslots

POST   /api/online/orders
GET    /api/online/orders/{id}
GET    /api/online/orders/{id}/status
POST   /api/online/orders/{id}/cancel

POST   /api/online/validate-promo
POST   /api/online/calculate-totals
```

### Restaurant Management
```
GET    /api/online/orders/incoming
GET    /api/online/orders/active
POST   /api/online/orders/{id}/accept
POST   /api/online/orders/{id}/reject
POST   /api/online/orders/{id}/ready
POST   /api/online/orders/{id}/complete

POST   /api/online/pause
POST   /api/online/resume
PUT    /api/online/settings
```

### Menu Management
```
PUT    /api/menu-items/{id}/online-settings
POST   /api/online/menu/sync
```

### Integrations
```
POST   /api/online/integrations/doordash/webhook
POST   /api/online/integrations/ubereats/webhook
GET    /api/online/integrations/status
```

### WebSocket
```
WS     /ws/online-orders/{location_id}

Events:
- order:new
- order:updated
- order:cancelled
- capacity:warning
```

---

## Business Rules

1. **Lead Time:** Orders require minimum lead time (configurable)
2. **Capacity Limits:** Cap orders per time slot
3. **Auto-Pause:** Pause ordering if too many pending orders
4. **Menu Sync:** Online menu syncs from POS within X minutes
5. **86'd Items:** 86'd items automatically hidden online
6. **Pricing:** Online prices can differ from in-house
7. **Tips:** Online tips attributed to order fulfillment staff

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| View online orders | Yes | Yes | Yes |
| Accept/reject orders | Yes | Yes | Yes |
| Mark orders ready | Yes | Yes | Yes |
| Pause ordering | No | Yes | Yes |
| Configure settings | No | Yes | Yes |
| Manage integrations | No | No | Yes |

---

## Configuration Options

```yaml
online_ordering:
  general:
    enabled: true
    require_account: false
    guest_checkout: true

  pickup:
    enabled: true
    lead_time_minutes: 20
    max_advance_days: 7

  delivery:
    enabled: false
    provider: "in_house"  # or "doordash_drive", etc.
    radius_miles: 5
    fee: 3.99
    minimum: 15.00

  capacity:
    orders_per_15min: 10
    auto_pause_at: 15
    pause_message: "We're very busy! Try again soon."

  notifications:
    customer_email: true
    customer_sms: true
    kitchen_alert: true

  payments:
    require_prepay: true
    accepted: ["credit", "debit", "apple_pay", "google_pay"]
```

---

## Open Questions

1. **Build vs Buy:** Build custom ordering site or use platform?

2. **Mobile App:** Native app or progressive web app?

3. **Delivery Partners:** Which integrations are priority?

4. **Loyalty Integration:** Apply loyalty points to online orders?

5. **Kitchen Display:** Separate view for online orders or integrated?

6. **Throttling:** Automatically slow orders when kitchen is behind?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Customer journey mapped
- [ ] Integration requirements

### Development
- [ ] Customer website/app
- [ ] Menu sync
- [ ] Order flow
- [ ] POS integration
- [ ] Notification system
- [ ] Third-party integrations

---

*Last Updated: January 27, 2026*
