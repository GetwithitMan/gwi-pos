# Skill 130: Historical Cost Tracking

## Overview
Track ingredient cost changes over time to understand margin shifts and vendor price trends.

## Status: Planned

## Problem
When ingredient prices change, there's no record of:
- When the change happened
- What the old price was
- Who made the change
- What caused the change (manual update, invoice, etc.)

This makes it hard to:
- Understand why margins shifted
- Negotiate with vendors
- Plan for seasonal price changes

## Solution

### Schema
```prisma
model IngredientPriceHistory {
  id            String    @id @default(cuid())
  locationId    String
  location      Location  @relation(fields: [locationId], references: [id])

  ingredientId  String
  ingredient    Ingredient @relation(fields: [ingredientId], references: [id])

  oldCost       Decimal?  // null for initial entry
  newCost       Decimal
  changePercent Decimal?  // calculated: (new-old)/old * 100

  // Context
  source        String    // "manual", "invoice", "api", "bulk_update"
  invoiceId     String?   // link to invoice if applicable
  note          String?   // optional note about the change

  // Audit
  changedBy     String?   // Employee ID
  changedAt     DateTime  @default(now())

  // Sync
  deletedAt     DateTime?
  syncedAt      DateTime?

  @@index([locationId])
  @@index([ingredientId])
  @@index([changedAt])
}
```

### Auto-Logging
Whenever `purchaseCost` or `unitsPerPurchase` changes on an Ingredient:
1. Calculate the new cost per unit
2. Compare to previous cost per unit
3. Create IngredientPriceHistory entry
4. Optionally trigger alerts if change exceeds threshold

### UI - Price History View
```
┌─────────────────────────────────────────────────────────────┐
│ All-Purpose Flour - Price History                           │
├──────────────┬────────────┬──────────┬─────────────────────┤
│ Date         │ Old Cost   │ New Cost │ Change              │
├──────────────┼────────────┼──────────┼─────────────────────┤
│ Feb 1, 2026  │ $0.42/lb   │ $0.46/lb │ +9.5% ⚠️            │
│ Jan 15, 2026 │ $0.40/lb   │ $0.42/lb │ +5.0%               │
│ Dec 1, 2025  │ $0.40/lb   │ -        │ Initial             │
└──────────────┴────────────┴──────────┴─────────────────────┘

📈 Trend: +15% over 3 months
📊 Avg change: +7.25% per update
```

### API Endpoints
- `GET /api/ingredients/[id]/price-history` - Get price history for ingredient
- `GET /api/reports/price-changes?from=&to=` - Price changes in date range

## Related Skills
- Skill 131: Food Cost Dashboard
- Skill 132: Alerts System
- Skill 133: Quick Pricing Update
