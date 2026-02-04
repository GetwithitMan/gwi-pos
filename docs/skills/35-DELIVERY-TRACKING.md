# 35 - In-House Delivery Tracking

**Status:** Planning
**Priority:** Medium
**Dependencies:** 04-Order-Management, 23-Online-Ordering

---

## Overview

The Delivery Tracking skill manages in-house delivery operations - driver assignment, route optimization, real-time tracking, delivery status, and customer communication. Designed for restaurants that handle their own deliveries rather than using third-party services.

**Primary Goal:** Efficiently manage delivery operations with real-time tracking and customer visibility.

---

## User Stories

### As a Customer...
- I want to track my delivery in real-time
- I want to know estimated arrival time
- I want to receive updates via text
- I want to contact my driver if needed

### As a Driver...
- I want clear delivery instructions
- I want optimized routes
- I want easy order pickup/completion
- I want to see earnings and tips

### As a Manager...
- I want to assign deliveries efficiently
- I want to track driver performance
- I want to manage delivery zones
- I want delivery analytics

---

## Features

### Delivery Zones

#### Zone Configuration
- [ ] Draw zones on map
- [ ] Zip code-based zones
- [ ] Radius-based zones
- [ ] Delivery fees per zone
- [ ] Minimum order per zone

#### Zone Settings
```yaml
delivery_zones:
  - name: "Zone 1 - Close"
    type: "radius"
    radius_miles: 3
    delivery_fee: 3.99
    minimum_order: 15.00
    estimated_time: "20-30 min"

  - name: "Zone 2 - Medium"
    type: "radius"
    radius_miles: 5
    delivery_fee: 5.99
    minimum_order: 25.00
    estimated_time: "30-45 min"

  - name: "Zone 3 - Far"
    type: "polygon"
    coordinates: [...]
    delivery_fee: 7.99
    minimum_order: 35.00
    estimated_time: "45-60 min"
```

### Driver Management

#### Driver Profiles
- [ ] Driver information
- [ ] Vehicle details
- [ ] License/insurance tracking
- [ ] Availability schedules
- [ ] Performance metrics

#### Driver Status
- [ ] Available
- [ ] On delivery
- [ ] Returning
- [ ] On break
- [ ] Off duty

### Order Assignment

#### Assignment Methods
- [ ] Manual assignment
- [ ] Auto-assign (nearest driver)
- [ ] Auto-assign (least busy)
- [ ] Driver self-select
- [ ] Batched deliveries

#### Batch Deliveries
- [ ] Group nearby orders
- [ ] Route optimization
- [ ] Maximum orders per batch
- [ ] Time window constraints

### Real-Time Tracking

#### GPS Tracking
- [ ] Driver location updates
- [ ] Customer tracking link
- [ ] ETA calculation
- [ ] Route visualization

#### Status Updates
- [ ] Order received
- [ ] Being prepared
- [ ] Ready for pickup
- [ ] Driver assigned
- [ ] Out for delivery
- [ ] Arriving soon
- [ ] Delivered

### Customer Communication

#### Automated Messages
- [ ] Order confirmation
- [ ] Driver assigned notification
- [ ] Out for delivery alert
- [ ] Arriving soon (1 min away)
- [ ] Delivered confirmation
- [ ] Delivery issue notification

#### Tracking Page
- [ ] Real-time map
- [ ] Driver info
- [ ] Order details
- [ ] Contact options
- [ ] Special instructions

### Driver App/Interface

#### Order Queue
- [ ] Assigned deliveries
- [ ] Order details
- [ ] Customer info
- [ ] Navigation launch
- [ ] Status updates

#### Delivery Actions
- [ ] Mark picked up
- [ ] Start navigation
- [ ] Contact customer
- [ ] Mark delivered
- [ ] Photo confirmation
- [ ] Collect signature

### Dispatch Dashboard

#### Real-Time View
- [ ] Active deliveries map
- [ ] Driver locations
- [ ] Pending orders
- [ ] Driver availability
- [ ] Zone coverage

#### Management Actions
- [ ] Assign/reassign orders
- [ ] Contact drivers
- [ ] Adjust ETAs
- [ ] Handle issues

### Reporting

#### Delivery Analytics
- [ ] Deliveries by zone
- [ ] Average delivery time
- [ ] Driver performance
- [ ] On-time percentage
- [ ] Customer ratings

---

## UI/UX Specifications

### Dispatch Dashboard

```
+------------------------------------------------------------------+
| DELIVERY DISPATCH                                    Jan 27, 2026 |
+------------------------------------------------------------------+
|                                                                   |
| PENDING ASSIGNMENT (3)              DRIVERS                       |
| +---------------------------+       +---------------------------+ |
| | #1456 - 123 Main St       |       | 🟢 Mike T. - Available    | |
| | Ready in 5 min | Zone 1   |       |    Last: Zone 1, 10m ago  | |
| | [Assign ▼]                |       |                           | |
| +---------------------------+       | 🔵 Sarah K. - On Delivery | |
| | #1457 - 456 Oak Ave       |       |    #1454 - ETA 8 min      | |
| | Ready NOW | Zone 2        |       |                           | |
| | [Assign ▼]                |       | 🔵 John D. - On Delivery  | |
| +---------------------------+       |    #1455 - ETA 15 min     | |
| | #1458 - 789 Pine Rd       |       |                           | |
| | Ready in 12 min | Zone 3  |       | 🟡 Lisa M. - Returning    | |
| | [Assign ▼]                |       |    ETA back: 5 min        | |
| +---------------------------+       +---------------------------+ |
|                                                                   |
| [============== MAP VIEW ================]                        |
| |                                        |                        |
| |    📍 Restaurant                       |                        |
| |         🚗 Mike (available)            |                        |
| |              🚗 Lisa (returning)       |                        |
| |                   🚗→ Sarah (#1454)    |                        |
| |                        📦 #1456        |                        |
| |                             📦 #1457   |                        |
| |                  🚗→ John (#1455)      |                        |
| |                                        |                        |
| [========================================]                        |
|                                                                   |
| ACTIVE DELIVERIES (2)                                             |
| +--------------------------------------------------------------+ |
| | #1454 | Sarah K. | 123 Elm St | Zone 1 | ETA 8 min | Tracking | |
| | #1455 | John D.  | 567 Maple  | Zone 2 | ETA 15 min| Tracking | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

### Driver Interface

```
+------------------------------------------------------------------+
| DRIVER: Mike Thompson                           [Status: Ready ▼] |
+------------------------------------------------------------------+
|                                                                   |
| ASSIGNED DELIVERIES                                               |
|                                                                   |
| +--------------------------------------------------------------+ |
| | ORDER #1456                                            NEXT    | |
| |                                                                | |
| | 📍 123 Main Street, Apt 4B                                     | |
| |    Smithville, ST 12345                                        | |
| |                                                                | |
| | 👤 John Smith | 📞 (555) 123-4567                              | |
| |                                                                | |
| | 📝 Instructions: "Gate code 1234, buzz #4B"                    | |
| |                                                                | |
| | ITEMS:                                                         | |
| | • 2x Burger Combo                                              | |
| | • 1x Large Pizza                                               | |
| | • 3x Drinks                                                    | |
| |                                                                | |
| | Total: $47.50 | Tip: $8.00 | PAID                              | |
| |                                                                | |
| | Status: Ready for Pickup                                       | |
| |                                                                | |
| | [📦 Pick Up Order]                                             | |
| +--------------------------------------------------------------+ |
|                                                                   |
| +--------------------------------------------------------------+ |
| | ORDER #1459                                            QUEUED  | |
| | 456 Oak Ave | Ready in 10 min                                  | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

### Customer Tracking Page

```
+------------------------------------------------------------------+
| 🍕 TRACK YOUR ORDER                                              |
+------------------------------------------------------------------+
|                                                                   |
| [================== LIVE MAP ==================]                  |
| |                                              |                  |
| |                    📍 Your Location          |                  |
| |                         ↑                    |                  |
| |                    🚗 Mike is 2 min away     |                  |
| |                    ↑                         |                  |
| |              🏪 Restaurant                   |                  |
| |                                              |                  |
| [==============================================]                  |
|                                                                   |
| ORDER STATUS                                                      |
| ✅ Order Received ─────────────── 6:15 PM                        |
| ✅ Being Prepared ─────────────── 6:18 PM                        |
| ✅ Ready for Pickup ───────────── 6:32 PM                        |
| ✅ Out for Delivery ───────────── 6:35 PM                        |
| 🔵 Arriving Soon... ───────────── ETA 6:42 PM                    |
| ⚪ Delivered                                                      |
|                                                                   |
| YOUR DRIVER                                                       |
| +--------------------------------------------------------------+ |
| | 👤 Mike T.                                                     | |
| | ⭐ 4.9 rating | 500+ deliveries                                | |
| | 🚗 Silver Honda Civic - ABC 1234                               | |
| |                                                                | |
| | [📞 Call Driver]  [💬 Text Driver]                             | |
| +--------------------------------------------------------------+ |
|                                                                   |
| ORDER DETAILS                                                     |
| • 2x Burger Combo                                                |
| • 1x Large Pizza                                                 |
| • 3x Drinks                                                      |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Data Model

### Delivery Zones
```sql
delivery_zones {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  zone_type: VARCHAR(50) (radius, polygon, zipcode)

  -- For radius
  center_lat: DECIMAL(10,7) (nullable)
  center_lng: DECIMAL(10,7) (nullable)
  radius_miles: DECIMAL(5,2) (nullable)

  -- For polygon
  polygon_coordinates: JSONB (nullable)

  -- For zipcode
  zip_codes: VARCHAR[] (nullable)

  -- Settings
  delivery_fee: DECIMAL(10,2)
  minimum_order: DECIMAL(10,2)
  estimated_minutes_min: INTEGER
  estimated_minutes_max: INTEGER

  is_active: BOOLEAN DEFAULT true
  display_order: INTEGER

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Drivers
```sql
delivery_drivers {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  employee_id: UUID (FK)

  -- Vehicle
  vehicle_type: VARCHAR(50)
  vehicle_make: VARCHAR(50) (nullable)
  vehicle_model: VARCHAR(50) (nullable)
  vehicle_color: VARCHAR(50) (nullable)
  license_plate: VARCHAR(20) (nullable)

  -- Documents
  drivers_license: VARCHAR(50)
  license_expiry: DATE
  insurance_policy: VARCHAR(100) (nullable)
  insurance_expiry: DATE (nullable)

  -- Status
  status: VARCHAR(50) (available, on_delivery, returning, break, off_duty)
  current_lat: DECIMAL(10,7) (nullable)
  current_lng: DECIMAL(10,7) (nullable)
  last_location_update: TIMESTAMP (nullable)

  -- Stats
  total_deliveries: INTEGER DEFAULT 0
  average_rating: DECIMAL(3,2) (nullable)
  on_time_percentage: DECIMAL(5,2) (nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Deliveries
```sql
deliveries {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  order_id: UUID (FK)
  zone_id: UUID (FK)

  -- Assignment
  driver_id: UUID (FK, nullable)
  assigned_at: TIMESTAMP (nullable)
  assigned_by: UUID (FK, nullable)

  -- Customer
  customer_name: VARCHAR(200)
  customer_phone: VARCHAR(20)
  delivery_address: TEXT
  address_lat: DECIMAL(10,7)
  address_lng: DECIMAL(10,7)
  delivery_instructions: TEXT (nullable)

  -- Fees
  delivery_fee: DECIMAL(10,2)
  driver_tip: DECIMAL(10,2) DEFAULT 0

  -- Timing
  estimated_ready_at: TIMESTAMP
  actual_ready_at: TIMESTAMP (nullable)
  picked_up_at: TIMESTAMP (nullable)
  estimated_delivery_at: TIMESTAMP (nullable)
  delivered_at: TIMESTAMP (nullable)

  -- Status
  status: VARCHAR(50) (pending, assigned, ready, picked_up, in_transit, arriving, delivered, cancelled)

  -- Confirmation
  delivery_photo_url: VARCHAR(500) (nullable)
  signature_url: VARCHAR(500) (nullable)
  delivery_notes: TEXT (nullable)

  -- Rating
  customer_rating: INTEGER (nullable) -- 1-5
  customer_feedback: TEXT (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Delivery Tracking
```sql
delivery_tracking {
  id: UUID PRIMARY KEY
  delivery_id: UUID (FK)

  lat: DECIMAL(10,7)
  lng: DECIMAL(10,7)
  accuracy: DECIMAL(10,2) (nullable)
  speed: DECIMAL(10,2) (nullable)

  recorded_at: TIMESTAMP
}
```

### Delivery Status History
```sql
delivery_status_history {
  id: UUID PRIMARY KEY
  delivery_id: UUID (FK)

  status: VARCHAR(50)
  notes: TEXT (nullable)
  updated_by: UUID (FK, nullable)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Zones
```
GET    /api/delivery-zones
POST   /api/delivery-zones
PUT    /api/delivery-zones/{id}
DELETE /api/delivery-zones/{id}
POST   /api/delivery-zones/check-address
```

### Drivers
```
GET    /api/drivers
POST   /api/drivers
PUT    /api/drivers/{id}
PUT    /api/drivers/{id}/status
GET    /api/drivers/{id}/location
PUT    /api/drivers/{id}/location
GET    /api/drivers/available
```

### Deliveries
```
GET    /api/deliveries
POST   /api/deliveries
GET    /api/deliveries/{id}
PUT    /api/deliveries/{id}/assign
PUT    /api/deliveries/{id}/status
GET    /api/deliveries/{id}/tracking
GET    /api/deliveries/active
```

### Customer Tracking
```
GET    /api/track/{tracking_code}
```

### Dispatch
```
GET    /api/dispatch/overview
POST   /api/dispatch/auto-assign
POST   /api/dispatch/batch
```

---

## Business Rules

1. **Zone Validation:** Verify address is in delivery zone before accepting
2. **Driver Assignment:** Only assign to available, active drivers
3. **Order Batching:** Maximum 3 orders per batch, same zone preferred
4. **ETA Updates:** Recalculate ETA when driver status changes
5. **Timeout Handling:** Alert if delivery exceeds estimated time by 50%
6. **Customer Communication:** Auto-notify at key status changes

---

## Permissions

| Action | Driver | Dispatcher | Manager | Admin |
|--------|--------|------------|---------|-------|
| View assigned deliveries | Yes | Yes | Yes | Yes |
| Update own status | Yes | No | No | No |
| Assign deliveries | No | Yes | Yes | Yes |
| Reassign deliveries | No | Yes | Yes | Yes |
| Configure zones | No | No | Yes | Yes |
| View all driver locations | No | Yes | Yes | Yes |
| Manage drivers | No | No | Yes | Yes |
| View delivery reports | No | Yes | Yes | Yes |

---

## Configuration Options

```yaml
delivery:
  enabled: true

  zones:
    max_radius_miles: 10
    default_fee: 4.99
    default_minimum: 20.00

  drivers:
    require_photo_confirmation: true
    require_signature_above: 50.00
    max_orders_per_batch: 3

  tracking:
    update_interval_seconds: 30
    show_live_map: true
    share_driver_info: true

  notifications:
    sms_enabled: true
    notify_on_assign: true
    notify_on_pickup: true
    notify_arriving: true
    arriving_distance_meters: 200

  timing:
    default_prep_minutes: 20
    late_threshold_minutes: 15
```

---

## Integrations

### Mapping Services
- Google Maps API
- Mapbox
- Apple Maps (for iOS)

### Communication
- Twilio for SMS (see Skill 27)
- Push notifications

---

*Last Updated: January 27, 2026*
