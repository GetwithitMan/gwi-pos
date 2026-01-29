# Inventory Tracking (Skills 38-39)

Track stock levels, receive inventory, and manage low stock alerts.

## Overview

Inventory tracking monitors stock levels for menu items, automatically decrements on sales, and alerts when items run low.

## Enable Tracking

### Per Menu Item
1. Edit menu item
2. Enable "Track Inventory"
3. Set current stock level
4. Set low stock threshold

### Bulk Enable
1. Go to `/inventory`
2. Select multiple items
3. Click "Enable Tracking"
4. Set initial quantities

## Stock Management

### View Inventory
Navigate to `/inventory` to see:
- All tracked items
- Current stock levels
- Low stock alerts
- Stock value

### Adjust Stock

**Manual Adjustment:**
1. Click item row
2. Enter new quantity
3. Select reason (Received, Waste, Count, Adjustment)
4. Add notes if needed

**Receive Inventory:**
1. Click "Receive" button
2. Enter quantity received
3. Enter cost per unit (optional)
4. Enter vendor/invoice (optional)

### Stock Transactions

| Type | Effect | Use Case |
|------|--------|----------|
| Sale | Decrease | Auto on order completion |
| Purchase | Increase | Receiving inventory |
| Adjustment | +/- | Corrections |
| Waste | Decrease | Spoilage, breakage |
| Transfer | Move | Between locations |
| Count | Set | Physical inventory count |

## Low Stock Alerts

### Configure Threshold
- Set per item in menu settings
- Default: 10 units
- Alert when stock <= threshold

### Alert Display
- Dashboard shows low stock count
- `/inventory` highlights low items
- Optional email notifications

### Reorder Suggestions
- Based on average daily sales
- Suggested order quantity
- Days until stockout estimate

## Auto-Decrement

When order completes:
1. System checks each item
2. If tracking enabled, decrement stock
3. If below threshold, create alert
4. If zero, optionally mark unavailable

### Recipe Ingredients
For items with recipes:
- Decrement each ingredient
- Based on recipe quantities
- Tracks spirit pours accurately

## Reports

### Inventory Value Report
- Total inventory value
- Value by category
- Cost vs retail value

### Stock Movement Report
- Transactions over time
- By item or category
- Identify shrinkage

### Waste Report
- Waste by item
- Waste by reason
- Cost of waste

## API Endpoints

### Get Inventory
```
GET /api/inventory?locationId=xxx
```

### Adjust Stock
```
POST /api/inventory/transactions
{
  "locationId": "xxx",
  "menuItemId": "yyy",
  "type": "adjustment",
  "quantityChange": -5,
  "reason": "Spoilage",
  "employeeId": "zzz"
}
```

### Receive Stock
```
POST /api/inventory/receive
{
  "locationId": "xxx",
  "menuItemId": "yyy",
  "quantity": 24,
  "unitCost": 2.50,
  "vendorName": "ABC Supplier",
  "invoiceNumber": "INV-123"
}
```

## Database Models

### MenuItem Inventory Fields
```prisma
model MenuItem {
  trackInventory  Boolean @default(false)
  currentStock    Int?
  lowStockAlert   Int?
}
```

### InventoryTransaction
```prisma
model InventoryTransaction {
  id             String   @id
  locationId     String
  menuItemId     String
  type           String   // sale, purchase, adjustment, waste, transfer, count
  quantityChange Int
  reason         String?
  vendorName     String?
  invoiceNumber  String?
  unitCost       Decimal?
  employeeId     String?
  createdAt      DateTime
}
```

### StockAlert
```prisma
model StockAlert {
  id           String   @id
  locationId   String
  menuItemId   String
  alertType    String   // low_stock, out_of_stock
  currentStock Int
  threshold    Int
  isResolved   Boolean
  createdAt    DateTime
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/inventory/page.tsx` | Inventory management |
| `src/app/api/inventory/route.ts` | Inventory API |
| `src/app/api/inventory/transactions/route.ts` | Stock transactions |
| `src/components/inventory/StockAdjustModal.tsx` | Adjustment modal |
| `src/components/inventory/ReceiveModal.tsx` | Receive inventory |
