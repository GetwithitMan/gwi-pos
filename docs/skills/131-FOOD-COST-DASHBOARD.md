# Skill 131: Food Cost & Margin Dashboard

## Overview
Visual dashboard showing menu item margins vs targets, with drill-down into problem areas.

## Status: Planned

## Problem
Owners don't have visibility into:
- Overall food cost percentage
- Which categories are over/under target
- Which specific items are eating into margins
- How costs trend over time

## Solution

### Location Settings
```prisma
// Add to InventorySettings
targetFoodCostPct      Decimal?  // e.g., 30 = 30%
targetMarginByCategory Json?     // { "pizza": 30, "wings": 35 }
```

### Dashboard Components

#### 1. Overall Food Cost Gauge
```
┌─────────────────────────────────────────────────────────────┐
│ 🍕 FOOD COST DASHBOARD                    Target: 30%       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Overall Food Cost: 32.4%  ⚠️ (+2.4% over target)          │
│  ████████████████████████████░░░░░░░░░░                     │
│  0%              30%                    50%                 │
│                   ↑ target                                  │
└─────────────────────────────────────────────────────────────┘
```

#### 2. Category Breakdown
```
┌─────────────────────────────────────────────────────────────┐
│ BY CATEGORY                        Cost %    Target  Status │
│ ─────────────────────────────────────────────────────────── │
│ 🍕 Pizza                           28.2%     30%     ✅     │
│ 🍔 Burgers                         34.1%     32%     ⚠️     │
│ 🥗 Salads                          26.5%     28%     ✅     │
│ 🍗 Wings                           38.2%     35%     🔴     │
│ 🍟 Sides                           22.1%     25%     ✅     │
└─────────────────────────────────────────────────────────────┘
```

#### 3. Problem Items List
```
┌─────────────────────────────────────────────────────────────┐
│ ITEMS OVER TARGET (click to drill down)                     │
│ ─────────────────────────────────────────────────────────── │
│ Item                    Cost    Price   Cost%   Target Gap  │
│ Buffalo Wings (10pc)    $4.20   $10.99  38.2%   +3.2%  🔴   │
│ Bacon Cheeseburger      $4.85   $13.99  34.7%   +2.7%  ⚠️   │
│ BBQ Chicken Pizza       $5.10   $15.99  31.9%   +1.9%  ⚠️   │
│                                                             │
│ 💡 Quick Fix: Raise Wing price by $1.50 to hit 35% target  │
└─────────────────────────────────────────────────────────────┘
```

#### 4. Trend Chart
```
Food Cost % Over Time (Last 12 Weeks)
35% │            ╭──╮
    │      ╭────╯  ╰──╮
30% │─────╯           ╰────  ← Target
    │
25% │
    └────────────────────────
     W1   W4   W8   W12
```

### Calculations

**Menu Item Food Cost:**
```
Food Cost % = (Recipe Cost / Menu Price) × 100

Recipe Cost = Σ (ingredient.costPerUnit × ingredient.quantity)
            + Σ (modifier.ingredient.costPerUnit × modifier.quantity)
```

**Category Food Cost:**
```
Category Cost % = (Total Recipe Costs / Total Sales) × 100
```

### API Endpoints
- `GET /api/reports/food-cost-dashboard` - Full dashboard data
- `GET /api/reports/food-cost-by-category` - Category breakdown
- `GET /api/reports/food-cost-trend?weeks=12` - Historical trend
- `GET /api/menu/items/[id]/cost-breakdown` - Item cost details

### Route
`/reports/food-cost` or `/dashboard/food-cost`

## Related Skills
- Skill 130: Historical Cost Tracking
- Skill 132: Alerts System
- Skill 139: Menu Engineering Matrix
