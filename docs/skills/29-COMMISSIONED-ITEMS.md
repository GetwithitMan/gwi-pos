# 29 - Commissioned Items

**Status:** Planning
**Priority:** Low
**Dependencies:** 03-Menu-Programming, 05-Employees-Roles

---

## Overview

The Commissioned Items skill enables tracking and paying commissions to employees for selling specific items. Common for upselling premium items, bottle service, merchandise, or promotional items.

**Primary Goal:** Incentivize sales of specific items through commission tracking and payout management.

---

## User Stories

### As a Server/Bartender...
- I want to see my earned commissions
- I want to know which items earn commission
- I want commission reflected in my pay

### As a Manager...
- I want to set commission rates on items
- I want to run sales contests
- I want to track commission costs
- I want to approve commission payouts

---

## Features

### Commission Configuration

#### Item-Level Commission
- [ ] Enable commission per item
- [ ] Fixed amount per sale
- [ ] Percentage of sale
- [ ] Tiered commissions

#### Commission Types
```yaml
commission_types:
  - type: "flat"
    item: "Premium Whiskey"
    amount: 5.00  # $5 per bottle

  - type: "percent"
    item: "Merchandise"
    rate: 10  # 10% of sale

  - type: "tiered"
    category: "Bottles"
    tiers:
      - min_sales: 1
        rate: 5.00
      - min_sales: 5
        rate: 7.50
      - min_sales: 10
        rate: 10.00
```

#### Category Commissions
- [ ] Apply to entire category
- [ ] Override at item level
- [ ] Time-based commissions

### Sales Tracking

#### Attribution
- [ ] Commission goes to selling employee
- [ ] Track by order/item
- [ ] Handle transfers (who gets commission?)

#### Real-Time Display
- [ ] Employee sees commission on sale
- [ ] Running total for shift
- [ ] Historical view

### Commission Reports

#### Employee View
- [ ] My commissions today
- [ ] My commissions this pay period
- [ ] Item breakdown
- [ ] Pending vs approved

#### Manager View
- [ ] All commissions by employee
- [ ] Commission cost report
- [ ] Top sellers
- [ ] Item performance

### Payout Management

#### Approval Workflow
- [ ] Auto-approve below threshold
- [ ] Manager approval required
- [ ] Batch approval

#### Payout Options
- [ ] Add to payroll
- [ ] Cash payout
- [ ] Gift card
- [ ] Tracked separately

### Sales Contests

#### Contest Setup
- [ ] Define contest period
- [ ] Target items/categories
- [ ] Goals and prizes
- [ ] Leaderboard

---

## Data Model

### Commissioned Items
```sql
commissioned_items {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  menu_item_id: UUID (FK, nullable)
  category_id: UUID (FK, nullable) -- For category-wide

  commission_type: VARCHAR(50) (flat, percent, tiered)
  commission_amount: DECIMAL(10,2) (nullable)
  commission_percent: DECIMAL(5,2) (nullable)

  -- Validity
  start_date: DATE (nullable)
  end_date: DATE (nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Commission Records
```sql
commission_records {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  employee_id: UUID (FK)

  order_id: UUID (FK)
  order_item_id: UUID (FK)
  commissioned_item_id: UUID (FK)

  item_name: VARCHAR(200)
  sale_amount: DECIMAL(10,2)
  commission_amount: DECIMAL(10,2)

  -- Status
  status: VARCHAR(50) (pending, approved, paid, voided)
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)
  paid_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

```
GET    /api/commissions/items
POST   /api/commissions/items
PUT    /api/commissions/items/{id}

GET    /api/commissions/records
GET    /api/employees/{id}/commissions
POST   /api/commissions/{id}/approve
POST   /api/commissions/batch-approve

GET    /api/reports/commissions
```

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| View own commissions | Yes | Yes | Yes |
| View all commissions | No | Yes | Yes |
| Configure items | No | Yes | Yes |
| Approve commissions | No | Yes | Yes |

---

*Last Updated: January 27, 2026*
