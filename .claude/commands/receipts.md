# Receipts & Printing

Generate, print, and email customer receipts.

## Overview

The receipt system generates formatted receipts for orders, supports multiple print destinations, and can email receipts to customers.

## Receipt Types

### Customer Receipt
- Itemized order
- Subtotal, tax, total
- Payment method
- Change due (if cash)
- Tip line (if card)

### Kitchen Ticket
- Items for prep
- Modifiers
- Special instructions
- Table/seat info
- Course number

### Bar Ticket
- Drink orders
- Garnishes
- Tab name

### Credit Card Slip
- Transaction details
- Tip line
- Signature line
- Merchant copy

## Print Destinations

### Configure Printers
1. Go to `/settings/printers`
2. Add printer:
   - Name (e.g., "Kitchen", "Bar")
   - IP address or USB
   - Paper width (80mm standard)
3. Assign to categories

### Routing Rules

| Category Type | Destination |
|---------------|-------------|
| Food | Kitchen printer |
| Drinks | Bar printer |
| Dessert | Kitchen printer |
| All | Receipt printer |

## Printing

### Auto-Print on Send
- Kitchen ticket prints when "Send"
- Configurable per order type
- Can disable for bar tabs

### Manual Print
1. Open order
2. Click "Print" button
3. Select receipt type:
   - Customer receipt
   - Kitchen ticket
   - Order copy

### Reprint
- Access from order history
- Click "Reprint"
- Select receipt type

## Receipt Content

### Header
```
================================
      RESTAURANT NAME
      123 Main Street
      City, State 12345
      (555) 123-4567
================================
```

### Order Details
```
Server: John D.
Table: 5
Guests: 4
Date: 01/28/2026 7:45 PM
Order #: 142
```

### Items
```
2x Burger              $25.98
   - No onion
   - Add bacon +$2.00
1x Fries                $4.99
1x Coke                 $2.99
```

### Totals
```
--------------------------------
Subtotal:              $33.96
Tax (8%):               $2.72
--------------------------------
TOTAL:                 $36.68
================================
```

### Payment
```
VISA ****4242         $36.68
Tip: ________________
Total: _______________
Signature: ___________
```

## Email Receipts

### Send to Customer
1. Complete payment
2. Enter customer email
3. Click "Email Receipt"
4. Receipt sent immediately

### Customer Profile
- Email saved to profile
- Auto-suggest on next visit
- Opt-in for marketing

### Email Content
- Full receipt details
- Restaurant branding
- Optional survey link

## Receipt Settings

### Configure at `/settings/receipts`

| Setting | Description |
|---------|-------------|
| Logo | Restaurant logo |
| Header text | Business name, address |
| Footer text | "Thank you" message |
| Show tax breakdown | Itemize tax |
| Show server name | Include server |
| Tip suggestions | 15%, 18%, 20%, 25% |
| Survey URL | Feedback link |

## API Endpoints

### Generate Receipt
```
GET /api/orders/[id]/receipt
```

### Print Receipt
```
POST /api/print
{
  "orderId": "xxx",
  "type": "customer",
  "printerId": "printer-1"
}
```

### Email Receipt
```
POST /api/orders/[id]/email-receipt
{
  "email": "customer@example.com"
}
```

## Receipt Modal

### View Receipt
1. Click receipt icon on order
2. Receipt modal opens
3. Options:
   - Print
   - Email
   - Download PDF

### Split Receipt
- Show individual split totals
- Print per split ticket
- Separate for each card

## Key Files

| File | Purpose |
|------|---------|
| `src/components/receipt/ReceiptModal.tsx` | Receipt display |
| `src/app/api/orders/[id]/receipt/route.ts` | Generate receipt |
| `src/lib/receipt-formatter.ts` | Format receipt content |
| `src/app/api/print/route.ts` | Print API |
| `src/app/(admin)/settings/printers/page.tsx` | Printer config |
