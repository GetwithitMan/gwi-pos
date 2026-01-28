# Split Tickets

Create multiple tickets from a single order for separate payment.

## Overview

Split tickets allow dividing one order into multiple sub-orders (e.g., 30-1, 30-2, 30-3) so different guests can pay separately.

## Access

1. Open an order in the POS
2. Click "Tickets" button in the sidebar
3. Full-screen Split Ticket Manager opens

## Features

### Create Tickets
- Click "+ New Ticket" to add tickets
- Tickets numbered as OrderNumber-1, OrderNumber-2, etc.

### Move Items
1. Check items to select
2. Click "Move Selected"
3. Choose destination ticket
4. Items transfer with pricing

### Pricing Strategy
- **Proportional discounts**: Order discounts split proportionally by item value
- **Round to nickel**: Amounts rounded for cash handling
- **Remainder bucket**: Last ticket absorbs rounding differences
- **Per-item discounts**: Stay with their item

## API Endpoints

### Get Split Info
```
POST /api/orders/[id]/split-tickets
Body: { "action": "get" }
```

### Create Tickets
```
POST /api/orders/[id]/split-tickets
Body: {
  "action": "create",
  "tickets": [
    { "items": ["item1", "item2"] },
    { "items": ["item3"] }
  ]
}
```

### Delete Ticket
```
DELETE /api/orders/[id]/split-tickets?ticketId=xxx
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/split-pricing.ts` | Pricing calculations |
| `src/hooks/useSplitTickets.ts` | State management |
| `src/components/orders/SplitTicketManager.tsx` | Full-screen UI |
| `src/components/orders/SplitTicketCard.tsx` | Individual ticket |
| `src/app/api/orders/[id]/split-tickets/route.ts` | API endpoint |

## Flow

1. User clicks "Tickets" button
2. Original order shown as Ticket 1
3. Create additional tickets as needed
4. Drag/move items between tickets
5. Click "Save & Create Tickets"
6. Each ticket becomes a payable order
7. Pay tickets separately
