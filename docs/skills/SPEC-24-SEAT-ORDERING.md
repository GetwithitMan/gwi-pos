# 24 - Seat-Based Ordering

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 11-Splitting

---

## Overview

The Seat-Based Ordering skill enables assigning items to specific seats within a single order, making it easy to track who ordered what and split checks by seat at payment time. Essential for full-service restaurants.

**Primary Goal:** Simplify order tracking and check splitting by associating items with specific guest positions.

---

## User Stories

### As a Server...
- I want to assign items to seats as I take the order
- I want to easily see which items belong to which seat
- I want to split the check by seat with one tap
- I want to move items between seats if guests share

### As a Guest (via Server)...
- I want to pay only for what I ordered
- I want to easily split shared items
- I want my dietary restrictions tracked to my seat

### As a Manager...
- I want to track average spend per guest
- I want to analyze ordering patterns by seat position

---

## Features

### Seat Configuration

#### Table Seat Setup
- [ ] Define number of seats per table
- [ ] Seat numbering (1, 2, 3... or A, B, C...)
- [ ] Visual seat arrangement
- [ ] Flexible seat count (add/remove during service)

#### Seat Layout Options
```
Round Table:        Booth:           Bar:
    [2]             [1][2]           [1][2][3][4][5]
  [1] [3]           [3][4]
    [4]

Rectangle:
[1][2][3]
[6][5][4]
```

### Item Assignment

#### During Order Entry
- [ ] Select seat before/after adding item
- [ ] Default seat (current or last used)
- [ ] Quick seat toggle (1, 2, 3 buttons)
- [ ] "Shared" designation for split items

#### Assignment Display
- [ ] Items grouped by seat in order view
- [ ] Seat indicator on each item
- [ ] Color coding per seat (optional)
- [ ] Running total per seat

#### Reassignment
- [ ] Move item to different seat
- [ ] Split item across seats
- [ ] Assign shared item to multiple seats

### Shared Items

#### Sharing Options
- [ ] Split evenly across all seats
- [ ] Split across selected seats
- [ ] Split with custom amounts
- [ ] Assign to one seat (no split)

#### Shared Item Display
```
Wings (Shared) - $18.00
├── Seat 1: $6.00
├── Seat 2: $6.00
└── Seat 3: $6.00
```

### Integration with Splitting

#### Seat-Based Split
- [ ] One-tap "Split by Seat"
- [ ] Creates separate check per seat
- [ ] Shared items distributed automatically
- [ ] Preview before confirming

#### Partial Seat Splits
- [ ] Some guests on same check
- [ ] Group seats together
- [ ] Mix seat split with other methods

### Order View Modes

#### By Seat
```
SEAT 1                    SEAT 2
├── Burger      $14.99    ├── Salmon      $24.99
├── Fries        $4.99    ├── Salad        $8.99
├── IPA          $7.00    └── Wine         $9.00
└── Subtotal:   $26.98        Subtotal:   $42.98

SHARED (Seats 1-3)
└── Nachos      $13.99 ÷ 3 = $4.66 each
```

#### By Course
- [ ] Group by course, show seat within
- [ ] Fire tickets show seat assignments

#### Chronological
- [ ] Traditional order view
- [ ] Seat tag on each item

### Kitchen Integration

#### Ticket Printing
- [ ] Seat number on each item
- [ ] Group by seat option
- [ ] Group by course then seat
- [ ] Seat position diagrams

#### KDS Display
- [ ] Seat numbers visible
- [ ] Color coding by seat
- [ ] Group view options

### Guest Count Tracking

#### Guest vs Seat
- [ ] Guest count can differ from seat count
- [ ] Track occupied vs total seats
- [ ] Children seat designation

---

## UI/UX Specifications

### Order Entry with Seats

```
+------------------------------------------------------------------+
| TABLE 12 - 4 Seats                              Guest Count: 4   |
+------------------------------------------------------------------+
| CURRENT SEAT: [1] [2] [3] [4] [Shared]          [Add Seat]       |
+------------------------------------------------------------------+
|                                                                  |
| ORDER BY SEAT                        | MENU                      |
| +----------------------------------+ |                           |
| | SEAT 1                    $26.98 | | [Appetizers] [Entrees]   |
| | ├── Burger         $14.99       | |                           |
| | ├── Fries           $4.99       | | +--------+ +--------+     |
| | └── IPA             $7.00       | | | Burger | | Steak  |     |
| |                                  | | | $14.99 | | $29.99 |     |
| | SEAT 2                    $42.98 | | +--------+ +--------+     |
| | ├── Salmon         $24.99       | |                           |
| | ├── Salad           $8.99       | | +--------+ +--------+     |
| | └── Wine            $9.00       | | | Salmon | | Chicken|     |
| |                                  | | | $24.99 | | $18.99 |     |
| | SEAT 3                    $18.99 | | +--------+ +--------+     |
| | └── Chicken        $18.99       | |                           |
| |                                  | |                           |
| | SEAT 4                    $29.99 | |                           |
| | └── Steak          $29.99       | |                           |
| |                                  | |                           |
| | SHARED (All)               $4.66 | |                           |
| | └── Nachos $18.64 ÷ 4            | |                           |
| +----------------------------------+ |                           |
|                                                                  |
| Subtotal: $123.60    Tax: $9.89    TOTAL: $133.49               |
+------------------------------------------------------------------+
| [Send All]  [Fire Seat 1]  [Split by Seat]  [Pay]               |
+------------------------------------------------------------------+
```

### Seat Selection During Item Add

```
+------------------------------------------------------------------+
| ADD TO ORDER: Burger                                             |
+------------------------------------------------------------------+
|                                                                  |
| ASSIGN TO SEAT:                                                  |
|                                                                  |
|   +-----+  +-----+  +-----+  +-----+  +--------+                |
|   |  1  |  |  2  |  |  3  |  |  4  |  | Shared |                |
|   |     |  | *** |  |     |  |     |  |        |                |
|   +-----+  +-----+  +-----+  +-----+  +--------+                |
|              ▲ Selected                                          |
|                                                                  |
| Or: [Don't Assign] (Add to order without seat)                  |
|                                                                  |
+------------------------------------------------------------------+
```

### Split by Seat Preview

```
+------------------------------------------------------------------+
| SPLIT BY SEAT - Table 12                              [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| This will create 4 separate checks:                             |
|                                                                  |
| +---------------+ +---------------+ +---------------+            |
| | CHECK - SEAT 1| | CHECK - SEAT 2| | CHECK - SEAT 3|            |
| | Burger  $14.99| | Salmon  $24.99| | Chicken $18.99|            |
| | Fries    $4.99| | Salad    $8.99| | Nachos   $4.66|            |
| | IPA      $7.00| | Wine     $9.00| |               |            |
| | Nachos   $4.66| | Nachos   $4.66| | Tax      $1.89|            |
| | Tax      $2.53| | Tax      $3.81| | TOTAL   $25.54|            |
| | TOTAL   $34.17| | TOTAL   $51.45| +---------------+            |
| +---------------+ +---------------+                              |
|                                                                  |
| +---------------+                                                |
| | CHECK - SEAT 4|                                                |
| | Steak   $29.99|                                                |
| | Nachos   $4.66|                                                |
| | Tax      $2.77|                                                |
| | TOTAL   $37.42|                                                |
| +---------------+                                                |
|                                                                  |
| Grand Total: $148.58                                            |
|                                                                  |
| [Cancel]                           [Create 4 Checks]             |
+------------------------------------------------------------------+
```

---

## Data Model

### Table Seats Configuration
```sql
table_seats {
  id: UUID PRIMARY KEY
  table_id: UUID (FK)

  seat_number: INTEGER
  seat_label: VARCHAR(10) (nullable) -- "A", "Window", etc.

  -- Position for visual display
  position_x: INTEGER (nullable)
  position_y: INTEGER (nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Order Seat Assignments
```sql
order_seats {
  id: UUID PRIMARY KEY
  order_id: UUID (FK)

  seat_number: INTEGER
  guest_name: VARCHAR(100) (nullable)

  -- Running totals (denormalized)
  subtotal: DECIMAL(10,2) DEFAULT 0

  created_at: TIMESTAMP
  updated_at: TIMESTAMP

  UNIQUE (order_id, seat_number)
}
```

### Order Item Seat Assignment
```sql
-- Add to order_items table:
order_items {
  ...
  seat_number: INTEGER (nullable)
  is_shared: BOOLEAN DEFAULT false
  shared_seat_numbers: INTEGER[] (nullable) -- For items split across seats
  ...
}
```

### Shared Item Splits
```sql
order_item_seat_splits {
  id: UUID PRIMARY KEY
  order_item_id: UUID (FK)

  seat_number: INTEGER
  split_amount: DECIMAL(10,2)
  split_quantity: DECIMAL(10,3) (nullable) -- For quantity-based splits

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Seat Management
```
GET    /api/orders/{id}/seats
POST   /api/orders/{id}/seats
PUT    /api/orders/{id}/seats/{seat_number}
DELETE /api/orders/{id}/seats/{seat_number}
```

### Item Assignment
```
PUT    /api/orders/{id}/items/{item_id}/seat
POST   /api/orders/{id}/items/{item_id}/share
DELETE /api/orders/{id}/items/{item_id}/share
```

### Seat Operations
```
POST   /api/orders/{id}/split-by-seat
GET    /api/orders/{id}/split-by-seat/preview
POST   /api/orders/{id}/seats/{seat}/fire
```

### Table Configuration
```
GET    /api/tables/{id}/seats
PUT    /api/tables/{id}/seats
```

---

## Business Rules

1. **Seat Flexibility:** Seats can be added mid-service
2. **Unassigned Items:** Items without seats go to "Shared" or prompt
3. **Split Calculation:** Shared items divide evenly unless specified
4. **Tax Distribution:** Tax calculated per seat after split
5. **Void Handling:** Voiding shared item updates all seat totals

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| Assign seats | Yes | Yes | Yes |
| Reassign items | Yes | Yes | Yes |
| Split by seat | Yes | Yes | Yes |
| Configure table seats | No | Yes | Yes |

---

## Configuration Options

```yaml
seat_ordering:
  enabled: true

  defaults:
    require_seat_assignment: false
    default_to_last_seat: true
    show_seat_totals: true

  shared_items:
    default_split: "all_seats"  # or "prompt", "first_seat"
    allow_uneven_splits: true

  display:
    group_by_seat: true
    show_seat_colors: true
    seat_on_tickets: true

  splitting:
    auto_calculate_tax: true
    preview_before_split: true
```

---

## Open Questions

1. **Seat Persistence:** Remember seat assignments across visits?

2. **Guest Profiles:** Link seats to customer profiles?

3. **Dietary Tracking:** Track allergies/preferences by seat?

4. **Seat Naming:** Allow custom names per seat (e.g., "Birthday Person")?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] UI mockups
- [ ] Integration with splitting detailed

### Development
- [ ] Seat configuration
- [ ] Item assignment
- [ ] Shared item handling
- [ ] Split by seat
- [ ] Kitchen integration
- [ ] Reporting

---

*Last Updated: January 27, 2026*
