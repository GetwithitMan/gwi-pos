# Skill 139: Inventory Count Sheets

## Overview
Streamlined inventory counting with mobile-friendly sheets and automatic valuation.

## Status: Planned

## Problem
Physical inventory counts are tedious:
- Paper sheets get lost or damaged
- Manual calculations cause errors
- Hard to track count history
- No real-time visibility into progress

## Solution

### Schema
```prisma
model InventoryCount {
  id           String    @id @default(cuid())
  locationId   String
  location     Location  @relation(fields: [locationId], references: [id])

  // Count metadata
  countDate    DateTime
  countType    String    // "full", "spot", "category", "daily"
  status       String    @default("in_progress")  // "in_progress", "completed", "verified"

  // Who/when
  startedBy    String?
  startedAt    DateTime  @default(now())
  completedBy  String?
  completedAt  DateTime?
  verifiedBy   String?
  verifiedAt   DateTime?

  // Totals (calculated)
  totalItems   Int?
  totalValue   Decimal?

  notes        String?

  // Line items
  items        InventoryCountItem[]

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?
  syncedAt     DateTime?

  @@index([locationId])
  @@index([countDate])
}

model InventoryCountItem {
  id           String    @id @default(cuid())
  countId      String
  count        InventoryCount @relation(fields: [countId], references: [id])

  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])

  // Count data
  expectedQty  Decimal?  // From system
  countedQty   Decimal?  // Actual count
  unit         String

  // Valuation
  unitCost     Decimal?
  totalValue   Decimal?

  // Variance
  varianceQty  Decimal?
  variancePct  Decimal?
  varianceValue Decimal?

  // Notes for discrepancies
  notes        String?

  countedBy    String?
  countedAt    DateTime?

  @@index([countId])
  @@index([ingredientId])
}
```

### UI - Count Sheet (Mobile-Optimized)
```
┌─────────────────────────────────────────┐
│ 📋 INVENTORY COUNT          Feb 7, 2026 │
│ Category: Dairy             3/12 done   │
├─────────────────────────────────────────┤
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ MOZZARELLA CHEESE                   │ │
│ │ Expected: ~45 lbs | Par: 66 lbs     │ │
│ │                                     │ │
│ │ Count: [    47    ] lbs             │ │
│ │                                     │ │
│ │ [  <  ]  [DONE ✓]  [  >  ]         │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ CHEDDAR CHEESE                      │ │
│ │ Expected: ~12 lbs | Par: 20 lbs     │ │
│ │                                     │ │
│ │ Count: [         ] lbs              │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ PARMESAN                            │ │
│ │ Expected: ~4 lbs | Par: 8 lbs       │ │
│ │                                     │ │
│ │ Count: [         ] lbs              │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [< Prev Category]    [Next Category >]  │
└─────────────────────────────────────────┘
```

### UI - Count Summary
```
┌─────────────────────────────────────────────────────────────────┐
│ 📋 INVENTORY COUNT SUMMARY              Feb 7, 2026             │
├─────────────────────────────────────────────────────────────────┤
│ Status: ✅ COMPLETED                    Counted by: Mike        │
│ Total Items: 47 | Total Value: $3,842.50                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ VARIANCES (4 items):                                            │
│ Item               Expected  Counted  Variance  $ Impact        │
│ ─────────────────────────────────────────────────────────────── │
│ Chicken Wings      52 lbs    45 lbs   -7 lbs    -$18.83  🔴    │
│ Mozzarella         45 lbs    47 lbs   +2 lbs    +$6.40         │
│ Lettuce            8 heads   5 heads  -3        -$4.50   ⚠️    │
│ Tomato Sauce       18 cans   20 cans  +2        +$1.70         │
│                                                                 │
│ Net Variance: -$15.23                                           │
│                                                                 │
│ [Investigate Variances]  [Approve & Close]                      │
└─────────────────────────────────────────────────────────────────┘
```

### Count Types

**Full Count**
- All inventory items
- Usually weekly or monthly
- Takes 30-60 minutes

**Category Count**
- Single category at a time
- Good for rotating counts (different category each day)

**Spot Count**
- Specific items only
- For investigating variances
- High-value items

**Daily Count**
- Prep items and high-velocity ingredients
- Quick morning/evening counts
- Integrates with daily count feature

### API Endpoints
- `GET /api/inventory/counts` - List counts
- `POST /api/inventory/counts` - Start new count
- `GET /api/inventory/counts/[id]` - Get count with items
- `PUT /api/inventory/counts/[id]` - Update count status
- `PUT /api/inventory/counts/[id]/items/[itemId]` - Update count item
- `POST /api/inventory/counts/[id]/complete` - Complete count

### Route
`/inventory/count` or `/inventory/counts`

## Related Skills
- Skill 135: Theoretical vs Actual Usage
- Skill 137: Par Levels
- Daily Count (existing feature)
