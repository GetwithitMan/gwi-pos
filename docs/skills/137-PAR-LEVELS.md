# Skill 137: Par Levels & Reorder Points

## Overview
Set minimum stock levels and get automated reorder suggestions based on usage patterns.

## Status: Planned

## Problem
Running out of inventory causes:
- 86'd items and lost sales
- Emergency orders at higher prices
- Customer disappointment

Ordering too much causes:
- Spoilage and waste
- Cash tied up in inventory
- Storage space issues

## Solution

### Schema Addition
```prisma
// Add to Ingredient model or create separate model
model InventoryPar {
  id           String    @id @default(cuid())
  locationId   String
  location     Location  @relation(fields: [locationId], references: [id])

  ingredientId String    @unique
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])

  // Par levels
  parLevel     Decimal   // Target amount to have on hand
  parUnit      String

  // Reorder point
  reorderPoint Decimal   // Order when stock falls below this
  reorderQty   Decimal   // Suggested order quantity

  // Safety stock
  safetyStock  Decimal?  // Extra buffer for variability

  // Lead time
  leadTimeDays Int       @default(1)  // Days from order to delivery

  // Auto-calculation basis
  basedOnDays  Int       @default(7)  // Par covers X days of usage

  lastCalculated DateTime?
  manualOverride Boolean  @default(false)

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([locationId])
}
```

### Par Level Calculation
```
Par Level = (Average Daily Usage × Days to Cover) + Safety Stock

Example: Mozzarella Cheese
- Average daily usage: 8 lbs
- Days to cover: 7 (weekly order cycle)
- Safety stock: 10 lbs (buffer for busy days)
- Par Level: (8 × 7) + 10 = 66 lbs

Reorder Point = (Daily Usage × Lead Time) + Safety Stock
- Lead time: 2 days
- Reorder Point: (8 × 2) + 10 = 26 lbs
- When stock hits 26 lbs → time to order
```

### UI - Par Level Management
```
┌─────────────────────────────────────────────────────────────────┐
│ 📊 PAR LEVELS                               [Auto-Calculate All]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Item               Current  Par    Reorder  Status    Action    │
│ ─────────────────────────────────────────────────────────────── │
│ Mozzarella         28 lbs   66 lbs  26 lbs  ✅ OK              │
│ Chicken Wings      18 lbs   80 lbs  30 lbs  ⚠️ LOW    [Order]  │
│ Pepperoni          15 lbs   25 lbs  10 lbs  ✅ OK              │
│ Pizza Dough        45 lbs   50 lbs  20 lbs  ✅ OK              │
│ Flour              90 lbs   150 lbs 50 lbs  ✅ OK              │
│ Tomato Sauce       8 cans   24 cans 8 cans  🔴 CRIT   [Order]  │
│                                                                 │
│ Legend: ✅ Above reorder | ⚠️ At/below reorder | 🔴 Critical   │
└─────────────────────────────────────────────────────────────────┘
```

### UI - Set Par Levels
```
┌─────────────────────────────────────────────────────────────────┐
│ MOZZARELLA CHEESE - Par Settings                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Current Stock: 28 lbs                                           │
│ Avg Daily Usage: 8.2 lbs (based on last 30 days)               │
│                                                                 │
│ ○ Auto-calculate from usage                                     │
│   Days to cover: [7] days                                       │
│   Safety stock: [10] lbs                                        │
│   → Calculated par: 67.4 lbs                                    │
│                                                                 │
│ ● Manual override                                               │
│   Par level: [66] lbs                                           │
│   Reorder point: [26] lbs                                       │
│   Reorder quantity: [50] lbs                                    │
│                                                                 │
│ Delivery lead time: [2] days                                    │
│                                                                 │
│                              [Cancel]   [Save]                  │
└─────────────────────────────────────────────────────────────────┘
```

### Smart Order Suggestions
```
┌─────────────────────────────────────────────────────────────────┐
│ 📦 SUGGESTED ORDER - Sysco (delivers Thu)                       │
├─────────────────────────────────────────────────────────────────┤
│ Based on current stock, usage, and lead time:                   │
│                                                                 │
│ ☑ Chicken Wings      Order: 60 lbs    (brings to par: 78 lbs)  │
│ ☑ Tomato Sauce       Order: 2 cases   (brings to par: 32 cans) │
│ ☐ Mozzarella         Order: 40 lbs    (optional: stock OK)     │
│                                                                 │
│ Estimated total: $245.80                                        │
│                                                                 │
│ [Copy to clipboard]  [Email to vendor]  [Create PO]            │
└─────────────────────────────────────────────────────────────────┘
```

### API Endpoints
- `GET /api/inventory/par-levels` - List all par levels
- `PUT /api/ingredients/[id]/par` - Set par level
- `POST /api/inventory/par-levels/calculate` - Auto-calculate all
- `GET /api/inventory/order-suggestions` - Get items needing reorder
- `GET /api/inventory/order-suggestions?vendorId=X` - By vendor

### Route
`/inventory/par-levels`

## Related Skills
- Skill 132: Alerts System (low stock alerts)
- Skill 134: Vendor Management
- Skill 140: 86 Feature
