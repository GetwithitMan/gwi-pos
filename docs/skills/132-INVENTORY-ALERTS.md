# Skill 132: Inventory Alerts System

## Overview
Proactive notifications when margins slip, costs rise, or variances exceed thresholds.

## Status: Planned

## Problem
Managers find out about margin problems too late - after the damage is done. They need proactive alerts for:
- Cost increases that affect margins
- Variance issues (theoretical vs actual usage)
- Items falling below target margin
- Low stock warnings

## Solution

### Alert Types

#### 1. Margin Alert
Triggered when an item's food cost % exceeds target.
```
🔴 MARGIN ALERT - Buffalo Wings (10pc)
   Food cost rose from 35% → 38.2%

   Cause: Chicken wing price +12% ($2.40 → $2.69/lb)

   💡 Suggestions:
   • Raise menu price by $1.50 to restore 35% margin
   • Reduce portion by 1 wing
   • Find alternative supplier
```

#### 2. Cost Increase Alert
Triggered when ingredient cost increases beyond threshold.
```
⚠️ COST INCREASE - All-Purpose Flour
   Price increased 9.5% ($0.42 → $0.46/lb)

   Impact:
   • Pizza Dough: +$0.08/batch
   • Breading: +$0.02/lb
   • Pasta: +$0.04/serving

   Total Weekly Impact: ~$45
```

#### 3. Variance Alert
Triggered when actual usage exceeds theoretical by threshold.
```
📉 VARIANCE ALERT - Mozzarella Cheese
   Theoretical usage: 45 lbs
   Actual usage: 52 lbs
   Variance: +15.5% ($28 over)

   💡 Possible causes:
   • Over-portioning on pizza line
   • Waste not being logged
   • Theft

   Action: Review portion training, check waste logs
```

#### 4. Low Stock Alert
Triggered when stock falls below par level.
```
📦 LOW STOCK - Chicken Wings
   Current: 15 lbs
   Par Level: 50 lbs
   Next Delivery: Thursday (2 days)

   ⚠️ May run out before delivery based on usage
```

### Schema
```prisma
model InventoryAlert {
  id           String    @id @default(cuid())
  locationId   String
  location     Location  @relation(fields: [locationId], references: [id])

  alertType    String    // "margin", "cost_increase", "variance", "low_stock", "86"
  severity     String    // "info", "warning", "critical"

  // What triggered it
  ingredientId String?
  menuItemId   String?

  // Alert content
  title        String
  message      String
  details      Json?     // Additional structured data
  suggestions  Json?     // Array of suggestion strings

  // Status
  status       String    @default("new")  // "new", "acknowledged", "resolved", "dismissed"
  acknowledgedBy String?
  acknowledgedAt DateTime?
  resolvedAt   DateTime?

  createdAt    DateTime  @default(now())
  expiresAt    DateTime? // Auto-dismiss after this time

  // Sync
  deletedAt    DateTime?
  syncedAt     DateTime?

  @@index([locationId])
  @@index([status])
  @@index([alertType])
}
```

### Alert Settings
```prisma
// Add to InventorySettings
alertsEnabled           Boolean @default(true)
marginAlertThreshold    Decimal @default(5)    // Alert if over target by 5%
costIncreaseThreshold   Decimal @default(10)   // Alert if cost rises 10%+
varianceAlertThreshold  Decimal @default(10)   // Alert if variance exceeds 10%
lowStockAlertEnabled    Boolean @default(true)
```

### UI - Alerts Page
```
┌─────────────────────────────────────────────────────────────┐
│ 🔔 INVENTORY ALERTS                      3 new | 5 total    │
├──────────────────────────┬──────────────────────────────────┤
│ Filter: [All ▼]          │ Sort: [Newest ▼]                │
├──────────────────────────┴──────────────────────────────────┤
│                                                             │
│ 🔴 MARGIN ALERT - Wings                     2 hours ago    │
│ ├─ Food cost rose from 35% → 38.2% due to:                 │
│ │  • Chicken wing price +12% ($2.40 → $2.69/lb)            │
│ ├─ 💡 Raise price by $1.00 or reduce portion               │
│ └─ [Acknowledge] [Resolve] [Dismiss]                       │
│                                                             │
│ ⚠️ COST INCREASE - All-Purpose Flour        Yesterday      │
│ ├─ Price increased 9.5% ($0.42 → $0.46/lb)                 │
│ ├─ Affects: Pizza Dough, Breading, Pasta                   │
│ └─ [Acknowledge] [Resolve] [Dismiss]                       │
│                                                             │
│ 📉 VARIANCE ALERT - Mozzarella              Yesterday      │
│ ├─ Theoretical: 45 lbs | Actual: 52 lbs (+15.5%)           │
│ ├─ 💡 Check for waste, over-portioning, or theft           │
│ └─ [Acknowledge] [Resolve] [Dismiss]                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Alert Delivery
- In-app notifications (bell icon badge)
- Dashboard widget
- Optional: Email digest (daily/weekly)
- Optional: SMS for critical alerts

### API Endpoints
- `GET /api/inventory/alerts` - List alerts
- `PUT /api/inventory/alerts/[id]` - Update alert status
- `POST /api/inventory/alerts/dismiss-all` - Dismiss all of type
- `GET /api/inventory/alerts/count` - Get unread count for badge

### Route
`/inventory/alerts` or `/alerts`

## Related Skills
- Skill 130: Historical Cost Tracking
- Skill 131: Food Cost Dashboard
- Skill 135: Theoretical vs Actual Usage
