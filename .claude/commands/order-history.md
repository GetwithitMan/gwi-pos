# Order History (Skill 65)

View, search, and manage past orders.

## Overview

Order history provides access to completed orders for lookups, reprints, refunds, and reporting.

## Accessing History

### From POS
1. Click "History" or clock icon
2. Recent orders shown
3. Search for specific order

### From Admin
1. Go to `/orders/history`
2. Full order list
3. Advanced filters

## Search & Filter

### Search By
- Order number
- Customer name
- Phone number
- Employee name
- Table number
- Date range

### Filter By
| Filter | Options |
|--------|---------|
| Status | Completed, Paid, Voided, Refunded |
| Order Type | Dine-in, Takeout, Delivery, Bar Tab |
| Payment | Cash, Card, Split, House Account |
| Employee | Specific server |
| Date | Today, Yesterday, This Week, Custom |

## Order Details

### View Order
Click order to see:
- All items ordered
- Modifiers
- Discounts applied
- Payment details
- Timeline (opened, sent, paid)

### Order Timeline
```
7:15 PM - Order opened by John
7:18 PM - 3 items added
7:20 PM - Sent to kitchen
7:35 PM - Payment: VISA $45.50
7:35 PM - Order closed
```

## Actions

### Reprint Receipt
1. Open order
2. Click "Reprint"
3. Select receipt type
4. Send to printer

### Email Receipt
1. Open order
2. Click "Email"
3. Enter email address
4. Send receipt

### Refund
1. Open order
2. Click "Refund"
3. Select items or full order
4. Enter reason
5. Manager approval
6. Process refund

### Reopen Order
1. Open order
2. Click "Reopen"
3. Manager approval
4. Order becomes active

## Closed Orders Panel

### In POS
- Toggle "Show Closed"
- See recently closed orders
- Quick access for reprints/refunds

### Display
- Order number
- Customer/table
- Total
- Payment method
- Close time

## Export

### Export Options
- CSV download
- PDF report
- Date range selection

### Export Fields
- Order ID
- Date/time
- Items
- Subtotal, tax, total
- Payment method
- Employee

## API Endpoints

### List Order History
```
GET /api/orders/history?locationId=xxx&startDate=2026-01-01&endDate=2026-01-28
```

### Search Orders
```
GET /api/orders/search?locationId=xxx&query=Smith
```

### Get Order Details
```
GET /api/orders/[id]?include=items,payments,timeline
```

### Reopen Order
```
POST /api/orders/[id]/reopen
{
  "reason": "Customer returned",
  "approvedBy": "manager-id"
}
```

## Database Queries

### Recent Orders
```prisma
await db.order.findMany({
  where: {
    locationId,
    status: { in: ['completed', 'paid'] },
    closedAt: { gte: startDate }
  },
  orderBy: { closedAt: 'desc' },
  take: 50
})
```

### Order with Details
```prisma
await db.order.findUnique({
  where: { id: orderId },
  include: {
    items: { include: { modifiers: true } },
    payments: true,
    discounts: true,
    employee: true,
    table: true
  }
})
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(pos)/orders/history/page.tsx` | Order history page |
| `src/components/orders/OpenOrdersPanel.tsx` | Includes closed orders toggle |
| `src/app/api/orders/history/route.ts` | History API |
| `src/app/api/orders/[id]/reopen/route.ts` | Reopen order API |
| `src/components/orders/OrderDetailModal.tsx` | Order details view |
