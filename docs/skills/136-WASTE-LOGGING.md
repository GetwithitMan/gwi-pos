# Skill 136: Waste Logging

## Overview
Track inventory waste to improve variance accuracy and identify problem areas.

## Status: Planned

## Problem
Without waste tracking:
- Variance reports show higher numbers than actual issues
- Can't distinguish between waste, over-portioning, and theft
- No data to reduce waste systematically
- Health department may require waste logs

## Solution

### Schema
```prisma
model WasteLog {
  id           String    @id @default(cuid())
  locationId   String
  location     Location  @relation(fields: [locationId], references: [id])

  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])

  quantity     Decimal
  unit         String

  // Categorization
  reason       String    // "expired", "spoiled", "dropped", "burnt", "overproduction", "other"
  category     String?   // "prep", "line", "storage", "receiving"

  // Context
  shiftId      String?
  employeeId   String?
  employee     Employee? @relation(fields: [employeeId], references: [id])

  notes        String?

  loggedAt     DateTime  @default(now())

  // Dollar impact (calculated)
  costImpact   Decimal?

  // Sync
  deletedAt    DateTime?
  syncedAt     DateTime?

  @@index([locationId])
  @@index([ingredientId])
  @@index([loggedAt])
  @@index([reason])
}
```

### UI - Quick Waste Entry (Mobile-Friendly)
```
┌─────────────────────────────────────────┐
│ 🗑️ LOG WASTE                            │
├─────────────────────────────────────────┤
│                                         │
│ What was wasted?                        │
│ [Search ingredients...        ] 🔍      │
│                                         │
│ How much?                               │
│ [2.5    ] [lbs ▼]                       │
│                                         │
│ Why?                                    │
│ ○ Expired / Out of date                 │
│ ○ Spoiled / Went bad                    │
│ ● Dropped / Spilled                     │
│ ○ Burnt / Overcooked                    │
│ ○ Over-production                       │
│ ○ Customer return                       │
│ ○ Other                                 │
│                                         │
│ Where did this happen?                  │
│ [Kitchen Line ▼]                        │
│                                         │
│ Notes (optional)                        │
│ [Knocked over container          ]      │
│                                         │
│           [Cancel]    [Log Waste]       │
└─────────────────────────────────────────┘
```

### UI - Waste Summary Dashboard
```
┌─────────────────────────────────────────────────────────────────┐
│ 🗑️ WASTE SUMMARY                        This Week | This Month  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ TOTAL WASTE: $142.50                                            │
│ ████████████████████░░░░░░░░░░░░░░░░░░░░                        │
│ vs last week: +$28.20 (+24.7%)                                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ BY REASON                          BY LOCATION                  │
│ ─────────────────────              ────────────────────         │
│ 🥀 Expired      $52.30             🍕 Line         $68.40       │
│ 💧 Spoiled      $38.20             📦 Storage      $52.30       │
│ 🔥 Burnt        $28.40             🔪 Prep         $21.80       │
│ ↓ Dropped       $15.60                                          │
│ 📦 Over-prod    $8.00                                           │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ TOP WASTED ITEMS                                                │
│ 1. Chicken Wings .......... $38.40 (14.3 lbs expired)          │
│ 2. Lettuce ................ $24.60 (8.2 lbs spoiled)           │
│ 3. Pizza Dough ............ $18.80 (12 balls over-prod)        │
│ 4. Tomatoes ............... $15.20 (6.4 lbs spoiled)           │
│ 5. French Fries ........... $12.40 (5.2 lbs burnt)             │
└─────────────────────────────────────────────────────────────────┘
```

### Integration with Variance
```
Adjusted Variance = Actual Usage - Theoretical Usage - Logged Waste

Example:
- Theoretical: 36.25 lbs
- Actual: 48 lbs
- Raw Variance: +11.75 lbs
- Logged Waste: 8 lbs (expired)
- Adjusted Variance: +3.75 lbs (10.3%)

Now we know most variance was documented waste, not mysterious loss.
```

### API Endpoints
- `POST /api/inventory/waste` - Log waste entry
- `GET /api/inventory/waste` - List waste entries
- `GET /api/reports/waste-summary?from=&to=` - Waste summary report
- `DELETE /api/inventory/waste/[id]` - Remove erroneous entry

### Route
`/inventory/waste`

## Related Skills
- Skill 132: Alerts System
- Skill 135: Theoretical vs Actual Usage
