# Skill 127: Quick Stock Adjustment with Cost Tracking

## Overview

Manager-facing page for rapid inventory adjustments with full audit trail and cost tracking. Includes double verification system (type "VERIFY" + employee PIN) and real-time socket notifications.

## The Problem

Managers needed a fast way to adjust stock levels without going through the formal inventory count process. Previous workflows were:
- Daily Prep Counts: Formal morning count with approval workflow
- Inventory Counts: Full counts with expected vs actual variance

Neither supported quick on-the-fly adjustments like "we just received a delivery" or "I found 5 extra cases in the walk-in."

## The Solution

A dedicated Quick Stock Adjust page (`/inventory/quick-adjust`) with:
- Touch-friendly +/- controls
- Collapsed category view for quick navigation
- Staged changes (not saved immediately)
- Double verification before saving
- Full cost tracking for reports
- Real-time socket notifications

## Page Features

### UI Layout
- **Header**: Blue gradient with stats (critical/low/total counts)
- **Search Bar**: Filter items by name
- **Stock Filter**: All / Low Only / Critical Only
- **Category Cards**: Collapsed by default, click to expand
- **Item Rows**: Compact 36px rows with +/- controls

### Item Row Controls
| Control | Action |
|---------|--------|
| − button | Decrease by step (1 or 0.5) |
| Stock display | Tap to enter exact value |
| + button | Increase by step |
| +5 button | Quick add 5× step |

### Pending Changes System
- Changes staged locally (not saved to server)
- Orange highlighting on changed items
- "was X" indicator shows original value
- Footer shows pending count with Review & Save button

### Verification Modal
1. **Review**: Shows all pending changes with before → after
2. **Type VERIFY**: Must type "VERIFY" to confirm
3. **Enter PIN**: Employee PIN required for authorization
4. **Confirm**: Saves all changes with attribution

## Schema: IngredientStockAdjustment

New model for tracking all stock adjustments:

```prisma
model IngredientStockAdjustment {
  id           String   @id @default(cuid())
  locationId   String
  ingredientId String

  type         String   // "manual", "count", "waste", "transfer", "receiving"

  // Quantity tracking
  quantityBefore  Decimal
  quantityChange  Decimal  // Positive or negative
  quantityAfter   Decimal
  unit            String?

  // Cost tracking (captured at adjustment time)
  unitCost        Decimal?  // purchaseCost / unitsPerPurchase
  totalCostImpact Decimal?  // quantityChange × unitCost

  // Attribution
  employeeId   String?
  reason       String?
  notes        String?

  // Reference to source workflow
  referenceType String?  // "daily_count", "waste_log", "purchase_order"
  referenceId   String?

  createdAt DateTime
  ...
}
```

## API Endpoints

### GET /api/inventory/stock-adjust
Returns all daily count items grouped by category.

```typescript
Response: {
  data: {
    items: StockItem[]
    byCategory: Record<string, StockItem[]>
    totalItems: number
  }
}
```

### POST /api/inventory/stock-adjust
Single item adjustment (for immediate saves).

```typescript
Request: {
  ingredientId: string
  operation: 'set' | 'add' | 'subtract'
  quantity: number
  reason?: string
  employeeId?: string
}

Response: {
  data: {
    ingredient: { currentStock, previousStock, change, costImpact }
    message: string
  }
}
```

### PATCH /api/inventory/stock-adjust
Bulk adjustments (used by Quick Stock Adjust page).

```typescript
Request: {
  adjustments: Array<{
    ingredientId: string
    quantity: number
    operation: 'set' | 'add' | 'subtract'
  }>
  employeeId: string  // Required for audit
}

Response: {
  data: {
    results: Array<{ id, name, previousStock, newStock, costImpact, success }>
    summary: { total, success, failed, totalCostImpact }
    adjustedBy: { id, name }
  }
}
```

### POST /api/auth/verify-pin
Verifies employee PIN without full login.

```typescript
Request: { pin: string, locationId: string }
Response: { employee: { id, firstName, lastName, role }, verified: true }
```

## Socket Events

### INVENTORY_ADJUSTMENT
Broadcast when bulk adjustments are saved.

```typescript
payload: {
  adjustments: Array<{
    ingredientId, name, previousStock, newStock, change, unit
  }>
  adjustedById: string
  adjustedByName: string
  totalItems: number
}
```

### STOCK_LEVEL_CHANGE
Broadcast for single item changes.

```typescript
payload: {
  ingredientId: string
  name: string
  currentStock: number
  previousStock: number
  unit: string
  stockLevel: 'critical' | 'low' | 'ok' | 'good'
}
```

## Cost Tracking

### Cost Calculation
```typescript
costPerUnit = purchaseCost / unitsPerPurchase
totalCostImpact = quantityChange × costPerUnit
```

### Data Available for Reports
| Field | Description |
|-------|-------------|
| `quantityBefore` | Stock before adjustment |
| `quantityAfter` | Stock after adjustment |
| `quantityChange` | Delta (positive or negative) |
| `unitCost` | Cost per unit at time of adjustment |
| `totalCostImpact` | Financial impact of adjustment |
| `employeeId` | Who made the adjustment |
| `createdAt` | When adjustment was made |
| `reason` | Why adjustment was made |

## Audit Trail

Each adjustment creates:
1. **IngredientStockAdjustment**: Cost tracking record
2. **AuditLog**: Compliance/audit record with full details
3. **Socket Event**: Real-time UI notification

## Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/inventory/quick-adjust/page.tsx` | Main page component |
| `src/app/api/inventory/stock-adjust/route.ts` | API endpoints |
| `src/app/api/auth/verify-pin/route.ts` | PIN verification |
| `src/lib/socket-dispatch.ts` | Socket dispatch functions |
| `prisma/schema.prisma` | IngredientStockAdjustment model |

## Navigation

Added to:
- `InventoryNav.tsx`: "⚡ Quick Adjust" tab
- `AdminSubNav.tsx`: inventorySubNav array

## Future Enhancements

- [ ] Add reason/note field to adjustment modal
- [ ] Batch operations (receive delivery, waste multiple items)
- [ ] Adjustment templates (common scenarios)
- [ ] Manager approval workflow for large adjustments
- [ ] Integration with vendor receiving workflow

## Related Skills

- **Skill 126**: Explicit Input/Output Model (ingredient cost structure)
- **Skill 139**: Inventory Count (formal count workflow)
- **Skill 136**: Waste Logging (waste-specific adjustments)
- **Skill 130**: Historical Costs (cost tracking over time)
