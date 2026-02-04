# 07 - Inventory

**Status:** Planning
**Priority:** Medium
**Dependencies:** 03-Menu-Programming

---

## Overview

The Inventory skill handles stock tracking, 86 management, and optionally full inventory control with vendors and ordering. This can range from simple "out of stock" flagging to complete ingredient-level inventory management.

**Primary Goal:** Provide inventory visibility to prevent selling items that aren't available, with optional deep inventory tracking for cost control.

---

## User Stories

### As a Kitchen Manager...
- I want to 86 items when we run out
- I want to see what's running low
- I want to count inventory at end of day/week
- I want to know our food cost percentage

### As a Server...
- I want to know what's 86'd before trying to sell it
- I want real-time updates when items become available again

### As an Owner...
- I want to track food cost and waste
- I want to order from vendors efficiently
- I want to see inventory value

---

## Features

### Basic Inventory (Phase 1)

#### 86 Management
- [ ] Mark item as 86'd (unavailable)
- [ ] Mark item as available again
- [ ] Set quantity remaining (e.g., "3 left")
- [ ] Auto-86 when quantity hits 0
- [ ] Time-based 86 (available again at X time)
- [ ] Real-time sync to all terminals

#### Low Stock Alerts
- [ ] Set low stock threshold per item
- [ ] Dashboard alerts for low items
- [ ] Push notifications (optional)
- [ ] End-of-day low stock report

#### Quick Count
- [ ] Simple count interface
- [ ] Count by category
- [ ] Variance reporting (expected vs actual)

### Advanced Inventory (Phase 2)

#### Ingredient Tracking
- [ ] Define ingredients/inventory items
- [ ] Link menu items to ingredients (recipes)
- [ ] Auto-deduct on sale
- [ ] Par levels and reorder points

#### Recipe/Build System
```
Menu Item: Cheeseburger
Ingredients:
  - Beef Patty (1 each) - Cost: $2.50
  - Burger Bun (1 each) - Cost: $0.35
  - American Cheese (1 slice) - Cost: $0.15
  - Lettuce (0.5 oz) - Cost: $0.10
  - Tomato (2 slices) - Cost: $0.20
  - Onion (3 rings) - Cost: $0.05
  - Pickles (3 each) - Cost: $0.05
Total Build Cost: $3.40
Selling Price: $14.99
Margin: 77%
```

#### Inventory Counts
- [ ] Full inventory count
- [ ] Partial/spot counts
- [ ] Count sheets (printable)
- [ ] Mobile counting
- [ ] Variance analysis
- [ ] Adjustment reasons

#### Purchasing
- [ ] Vendor management
- [ ] Purchase orders
- [ ] Receiving
- [ ] Invoice matching
- [ ] Order guides
- [ ] Auto-reorder suggestions

#### Waste Tracking
- [ ] Record waste/spillage
- [ ] Waste reasons
- [ ] Waste reports
- [ ] Tie to specific employees (accountability)

### Inventory Reporting

#### Stock Reports
- [ ] Current stock levels
- [ ] Stock value
- [ ] Movement report (in/out)
- [ ] Usage report

#### Cost Reports
- [ ] Food cost percentage
- [ ] Cost by category
- [ ] Theoretical vs actual cost
- [ ] Variance analysis

---

## UI/UX Specifications

### 86 Management (Quick View)

```
+------------------------------------------------------------------+
| 86 BOARD                                    [Refresh] [+ Add 86] |
+------------------------------------------------------------------+
| Currently 86'd:                                                  |
|                                                                  |
| +------------------+ +------------------+ +------------------+   |
| | Salmon Entree    | | Tomato Soup      | | Key Lime Pie     |   |
| | Since: 6:45 PM   | | Since: 7:30 PM   | | 2 remaining      |   |
| | [Make Available] | | [Make Available] | | [Update Count]   |   |
| +------------------+ +------------------+ +------------------+   |
|                                                                  |
+------------------------------------------------------------------+
| Low Stock Warnings:                                              |
|                                                                  |
| - Ribeye Steak: 4 remaining (threshold: 5)                      |
| - Crab Cakes: 6 remaining (threshold: 10)                       |
| - Draft IPA: 1 keg remaining                                    |
+------------------------------------------------------------------+
```

### Item Stock Editor

```
+------------------------------------------------------------------+
| ITEM: Ribeye Steak                                    [Save]     |
+------------------------------------------------------------------+
| STOCK STATUS                                                     |
|                                                                  |
| Current Status: ( ) Available  (•) Limited  ( ) 86'd            |
|                                                                  |
| Quantity on Hand: [4      ]                                      |
| Low Stock Alert At: [5     ]                                     |
|                                                                  |
| Auto-86 when quantity reaches: [0]                              |
|                                                                  |
+------------------------------------------------------------------+
| TRACKING (Advanced)                                              |
|                                                                  |
| ☑ Track Inventory for this item                                 |
| Unit of Measure: [Each ▼]                                       |
| Cost per Unit: [$28.00   ]                                      |
|                                                                  |
+------------------------------------------------------------------+
```

---

## Data Model

### Inventory Items
```sql
inventory_items {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(200)
  description: TEXT (nullable)
  sku: VARCHAR(50) (nullable)
  barcode: VARCHAR(50) (nullable)

  -- Categorization
  category: VARCHAR(100)

  -- Units
  unit_of_measure: VARCHAR(50) (each, oz, lb, case, etc.)
  pack_size: DECIMAL(10,3) (nullable) -- e.g., 24 in a case

  -- Tracking
  track_inventory: BOOLEAN DEFAULT true
  current_quantity: DECIMAL(10,3) DEFAULT 0
  par_level: DECIMAL(10,3) (nullable)
  reorder_point: DECIMAL(10,3) (nullable)
  reorder_quantity: DECIMAL(10,3) (nullable)

  -- Cost
  last_cost: DECIMAL(10,4) (nullable)
  average_cost: DECIMAL(10,4) (nullable)

  -- Vendor
  primary_vendor_id: UUID (FK, nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Menu Item Inventory (Recipes)
```sql
menu_item_ingredients {
  id: UUID PRIMARY KEY
  menu_item_id: UUID (FK)
  inventory_item_id: UUID (FK)

  quantity: DECIMAL(10,3)
  unit_of_measure: VARCHAR(50)

  -- For modifiers that affect quantity
  modifier_id: UUID (FK, nullable)
  modifier_quantity_adjustment: DECIMAL(10,3) (nullable)

  created_at: TIMESTAMP
}
```

### Stock Status (for 86 tracking)
```sql
item_stock_status {
  id: UUID PRIMARY KEY
  menu_item_id: UUID (FK)
  location_id: UUID (FK)

  status: VARCHAR(50) (available, limited, eighty_sixed)
  quantity_remaining: INTEGER (nullable)
  low_stock_threshold: INTEGER (nullable)

  eighty_sixed_at: TIMESTAMP (nullable)
  eighty_sixed_by: UUID (FK, nullable)
  eighty_sixed_reason: VARCHAR(200) (nullable)

  available_again_at: TIMESTAMP (nullable) -- Scheduled availability

  updated_at: TIMESTAMP
}
```

### Inventory Counts
```sql
inventory_counts {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  count_date: DATE
  count_type: VARCHAR(50) (full, spot, cycle)
  status: VARCHAR(50) (in_progress, completed, approved)

  started_by: UUID (FK)
  started_at: TIMESTAMP
  completed_at: TIMESTAMP (nullable)
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)

  notes: TEXT (nullable)

  created_at: TIMESTAMP
}
```

### Inventory Count Items
```sql
inventory_count_items {
  id: UUID PRIMARY KEY
  count_id: UUID (FK)
  inventory_item_id: UUID (FK)

  expected_quantity: DECIMAL(10,3)
  counted_quantity: DECIMAL(10,3) (nullable)
  variance: DECIMAL(10,3) (nullable)
  variance_value: DECIMAL(10,2) (nullable)

  counted_by: UUID (FK, nullable)
  counted_at: TIMESTAMP (nullable)

  notes: TEXT (nullable)
}
```

### Inventory Transactions
```sql
inventory_transactions {
  id: UUID PRIMARY KEY
  inventory_item_id: UUID (FK)
  location_id: UUID (FK)

  transaction_type: VARCHAR(50) (sale, purchase, adjustment, waste, transfer, count)
  quantity_change: DECIMAL(10,3) -- Positive for in, negative for out
  quantity_before: DECIMAL(10,3)
  quantity_after: DECIMAL(10,3)

  unit_cost: DECIMAL(10,4) (nullable)
  total_cost: DECIMAL(10,2) (nullable)

  -- Reference
  reference_type: VARCHAR(50) (nullable) -- order, purchase_order, count, etc.
  reference_id: UUID (nullable)

  reason: VARCHAR(200) (nullable)

  created_by: UUID (FK)
  created_at: TIMESTAMP
}
```

---

## API Endpoints

### 86 Management
```
GET    /api/locations/{loc}/86-board
POST   /api/menu-items/{id}/86
DELETE /api/menu-items/{id}/86
PUT    /api/menu-items/{id}/stock-status
```

### Inventory Items
```
GET    /api/inventory
POST   /api/inventory
GET    /api/inventory/{id}
PUT    /api/inventory/{id}
DELETE /api/inventory/{id}
PUT    /api/inventory/{id}/adjust
```

### Counts
```
POST   /api/inventory-counts
GET    /api/inventory-counts
GET    /api/inventory-counts/{id}
PUT    /api/inventory-counts/{id}
POST   /api/inventory-counts/{id}/complete
POST   /api/inventory-counts/{id}/approve
```

### Recipes
```
GET    /api/menu-items/{id}/ingredients
PUT    /api/menu-items/{id}/ingredients
GET    /api/menu-items/{id}/cost
```

### Reporting
```
GET    /api/reports/inventory/levels
GET    /api/reports/inventory/valuation
GET    /api/reports/inventory/usage
GET    /api/reports/food-cost
```

---

## Business Rules

1. **86 Visibility:** 86'd items appear on POS but cannot be ordered
2. **Auto-86:** Items auto-86 when tracked quantity hits threshold
3. **Count Variance:** Large variances flag for manager review
4. **FIFO Costing:** Use first-in-first-out for cost calculations
5. **Sales Deduction:** Inventory auto-deducts when order sent to kitchen
6. **Void Restoration:** Voided items restore inventory

---

## Permissions

| Action | Server | Kitchen | Manager | Admin |
|--------|--------|---------|---------|-------|
| View 86 board | Yes | Yes | Yes | Yes |
| 86 items | No | Yes | Yes | Yes |
| Update counts | No | Yes | Yes | Yes |
| Full inventory | No | No | Yes | Yes |
| Adjustments | No | No | Yes | Yes |
| View cost data | No | No | Yes | Yes |

---

## Configuration Options

```yaml
inventory:
  basic:
    eighty_six_enabled: true
    low_stock_alerts: true
    real_time_sync: true

  advanced:
    track_ingredients: false  # Phase 2
    auto_deduct_on_sale: false
    require_count_approval: true

  costing:
    method: "fifo"  # or "average", "last"
    include_waste_in_cost: true
```

---

## Open Questions

1. **Ingredient Depth:** Track at ingredient level or just menu item level?

2. **Multi-Location:** Transfer inventory between locations?

3. **Vendor Integration:** Direct ordering integration with distributors?

4. **Waste Categories:** What waste reasons to track?

5. **Count Frequency:** Daily, weekly, or custom count schedules?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Phase 1 vs Phase 2 scope confirmed
- [ ] Data model reviewed

### Development
- [ ] 86 management
- [ ] Stock status tracking
- [ ] Low stock alerts
- [ ] Basic counting
- [ ] Reporting (basic)
- [ ] (Phase 2) Full inventory
- [ ] (Phase 2) Recipes/costing

---

*Last Updated: January 27, 2026*
