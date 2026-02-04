# Skill 135: Theoretical vs Actual Usage

## Overview
Compare what inventory SHOULD have been used (based on sales) vs what was ACTUALLY used (based on counts).

## Status: Planned

## Problem
Restaurants lose money to waste, over-portioning, and theft:
- No visibility into what "should" have been used
- Can't identify problem areas
- Variance discovered too late (end of month)

## Solution

### Theoretical Usage Calculation
```
For each ingredient, calculate expected usage:

Theoretical Usage = Σ (Sales Qty × Recipe Qty)

Example: Mozzarella Cheese
- Sold 50 pizzas × 8oz cheese = 400oz (25 lbs)
- Sold 20 calzones × 6oz cheese = 120oz (7.5 lbs)
- Sold 15 cheese sticks × 4oz = 60oz (3.75 lbs)
- Total theoretical: 36.25 lbs
```

### Actual Usage Calculation
```
Actual Usage = Beginning Inventory + Purchases - Ending Inventory

Example:
- Started with: 45 lbs
- Received: 50 lbs
- Ended with: 47 lbs
- Actual used: 48 lbs
```

### Variance Analysis
```
Variance = Actual - Theoretical
Variance % = ((Actual - Theoretical) / Theoretical) × 100

Example:
- Theoretical: 36.25 lbs
- Actual: 48 lbs
- Variance: +11.75 lbs (+32%)
- Dollar Impact: $37.60 over
```

### UI - Variance Report
```
┌─────────────────────────────────────────────────────────────────┐
│ 📊 USAGE VARIANCE REPORT              Period: Feb 1-7, 2026     │
├─────────────────────────────────────────────────────────────────┤
│ ⚠️ 3 items with variance > 10%                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Item               Theoretical  Actual   Variance    $ Impact   │
│ ─────────────────────────────────────────────────────────────── │
│ Mozzarella         36.25 lbs    48 lbs   +32% 🔴     +$37.60   │
│ Chicken Wings      82 lbs       89 lbs   +8.5%       +$18.87   │
│ Pepperoni          12 lbs       13.5 lbs +12.5% ⚠️   +$6.75    │
│ Pizza Sauce        24 cans      25 cans  +4.2%       +$3.60    │
│ All-Purpose Flour  125 lbs      128 lbs  +2.4% ✅    +$1.38    │
│                                                                 │
│ ─────────────────────────────────────────────────────────────── │
│ Total Variance Impact: +$68.20 this week                        │
│ Weekly Average (last 4 weeks): +$52.40                          │
└─────────────────────────────────────────────────────────────────┘
```

### Drill-Down View
```
┌─────────────────────────────────────────────────────────────────┐
│ MOZZARELLA CHEESE - Variance Details                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ THEORETICAL USAGE BREAKDOWN:                                    │
│ ├─ Large Pizza (50 sold × 8oz) .............. 25.0 lbs         │
│ ├─ Medium Pizza (35 sold × 6oz) ............. 13.1 lbs         │
│ ├─ Calzone (20 sold × 6oz) .................. 7.5 lbs          │
│ ├─ Cheese Sticks (15 sold × 4oz) ............ 3.75 lbs         │
│ └─ TOTAL THEORETICAL ........................ 49.35 lbs        │
│                                                                 │
│ ACTUAL USAGE:                                                   │
│ ├─ Beginning Count (Feb 1) .................. 45 lbs           │
│ ├─ + Received (Feb 3) ....................... 50 lbs           │
│ ├─ - Ending Count (Feb 7) ................... 47 lbs           │
│ └─ TOTAL ACTUAL ............................. 48 lbs           │
│                                                                 │
│ 💡 ANALYSIS:                                                    │
│ Variance of +32% is unusual. Check:                             │
│ • Pizza line portioning (target: 8oz per large)                 │
│ • Waste log entries                                             │
│ • Potential unreported spillage                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Schema Addition
```prisma
// Add to InventoryCount or create new model
model UsageVariance {
  id           String    @id @default(cuid())
  locationId   String
  location     Location  @relation(fields: [locationId], references: [id])

  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])

  periodStart  DateTime
  periodEnd    DateTime

  theoreticalQty Decimal
  actualQty      Decimal
  varianceQty    Decimal
  variancePct    Decimal
  varianceDollar Decimal?

  // Status
  reviewed       Boolean   @default(false)
  reviewedBy     String?
  reviewNotes    String?

  createdAt    DateTime  @default(now())

  @@index([locationId])
  @@index([ingredientId])
  @@index([periodEnd])
}
```

### API Endpoints
- `GET /api/reports/usage-variance?from=&to=` - Get variance report
- `GET /api/ingredients/[id]/variance-history` - Historical variance for item
- `POST /api/reports/calculate-variance` - Trigger variance calculation

### Route
`/reports/variance` or `/inventory/variance`

## Related Skills
- Skill 131: Food Cost Dashboard
- Skill 132: Alerts System
- Skill 136: Waste Logging
