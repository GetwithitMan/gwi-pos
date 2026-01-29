# Voids & Comps

Remove items from orders with proper tracking and authorization.

## Overview

Voids remove unsent items from orders, while comps remove sent items with manager approval. All voids/comps are logged for accountability.

## Void vs Comp

| Action | When | Approval | Billing |
|--------|------|----------|---------|
| Void | Before sending to kitchen | Server can do | No charge |
| Comp | After sending to kitchen | Manager required | No charge, tracked |

## Voiding Items

### Before Kitchen Send
1. Click item in order
2. Click "Remove" or swipe left
3. Item removed immediately
4. No record kept (not yet sent)

### Quick Remove
- Swipe left on item (mobile)
- Click X button (desktop)
- Quantity -1 for multiples

## Comping Items

### After Kitchen Send
1. Click item in order
2. Click "Comp" button
3. Select comp reason:
   - Quality issue
   - Wrong item made
   - Customer complaint
   - Manager decision
   - Spillage
4. Enter manager PIN
5. Item marked as comped

### Comp Reasons

| Reason | Description |
|--------|-------------|
| Quality | Food/drink quality issue |
| Wrong Item | Kitchen made wrong item |
| Complaint | Customer dissatisfaction |
| Manager | Manager discretion |
| Spillage | Dropped/spilled |
| Allergy | Allergy concern |

## Full Order Void

### Void Entire Order
1. Open order
2. Click "Void Order"
3. Select reason
4. Enter manager PIN
5. Order cancelled

### When to Use
- Customer left before ordering
- Duplicate order created
- Test order

## Tracking & Accountability

### Void Log
Every comp/void records:
- Item name and price
- Order ID
- Employee who voided
- Manager who approved
- Reason
- Timestamp

### Void Report
- Total voids by employee
- Total comps by reason
- Dollar amount voided
- Patterns/anomalies

## Manager Controls

### Void Thresholds
- Servers: Can void unsent items
- Managers: Can void any item
- Over threshold: Requires manager

### Approval Requirements
Configure which actions need manager PIN:
- All comps
- Voids over $X amount
- Voids of alcohol
- Multiple voids same order

## API Endpoints

### Void Item (Unsent)
```
DELETE /api/orders/[orderId]/items/[itemId]
```

### Comp Item (Sent)
```
POST /api/orders/[orderId]/items/[itemId]/comp
{
  "reason": "quality",
  "notes": "Steak overcooked",
  "approvedBy": "manager-id"
}
```

### Void Order
```
POST /api/orders/[orderId]/void
{
  "reason": "Customer left",
  "approvedBy": "manager-id"
}
```

### Get Void Log
```
GET /api/reports/voids?locationId=xxx&startDate=2026-01-01
```

## Database Model

### VoidLog
```prisma
model VoidLog {
  id            String   @id
  locationId    String
  orderId       String
  orderItemId   String?
  itemName      String
  itemPrice     Decimal
  voidType      String   // void, comp
  reason        String
  notes         String?
  employeeId    String   // Who initiated
  approvedById  String?  // Manager who approved
  createdAt     DateTime
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(pos)/orders/page.tsx` | Void/comp UI in order panel |
| `src/components/orders/CompModal.tsx` | Comp reason selection |
| `src/app/api/orders/[id]/items/[itemId]/comp/route.ts` | Comp API |
| `src/app/api/orders/[id]/void/route.ts` | Void order API |
| `src/app/api/reports/voids/route.ts` | Void report API |
