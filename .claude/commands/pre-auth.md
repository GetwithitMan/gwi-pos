# Pre-Authorization (Bar Tabs)

Capture card details to secure bar tabs before running a final charge.

## Overview

Pre-authorization holds a card on file for bar tabs, ensuring payment can be collected at close without keeping the physical card.

## How It Works

### Start Tab with Pre-Auth
1. Customer orders drink
2. Server clicks "Start Tab"
3. Customer presents card
4. Card swiped/dipped
5. Pre-auth captured
6. Card returned to customer
7. Tab stays open

### Pre-Auth Capture
- Card number captured (last 4 digits)
- Card type (Visa, MC, etc.)
- Optional hold amount
- Expires after 24-48 hours

## Pre-Auth Flow

### Opening Tab
```
Server: "Would you like to start a tab?"
Customer: "Yes" [presents card]
[Swipe card]
System: Pre-auth captured - Visa ****4242
[Return card to customer]
Tab open, secured by pre-auth
```

### During Service
- Add items to tab normally
- No card needed for additions
- Running total visible

### Closing Tab
1. Click "Close Tab"
2. Add tip (optional)
3. Charge pre-auth
4. Receipt generated

## Pre-Auth Settings

### Configure Hold Amount
- No hold (capture only)
- Fixed hold ($50, $100)
- Percentage of first order
- Estimated total + buffer

### Expiration
- Default: 24 hours
- Configurable per location
- Warning before expiration

## Display in POS

### Tab with Pre-Auth
```
🍺 John's Tab          $45.50
   VISA ****4242 (Pre-auth)
   Opened: 7:30 PM
```

### Pre-Auth Badge
- Card icon on tab
- Shows card type
- Shows last 4 digits

## Closing with Pre-Auth

### Normal Close
1. Calculate total + tip
2. Charge captured card
3. Release any excess hold
4. Tab closed

### Card Declined
1. Original pre-auth fails
2. Prompt for new card
3. Or manager override

### Walk-Out Protection
- Card on file can be charged
- Manager approval for disputes
- Full audit trail

## Without Pre-Auth

### Keep Card
- Physical card held at bar
- Customer picks up at close
- Risk of forgotten cards

### Cash Tab
- No card captured
- Pay as you go
- Higher walkout risk

## API Endpoints

### Capture Pre-Auth
```
POST /api/payments/pre-auth
{
  "orderId": "xxx",
  "cardToken": "tok_xxx",
  "holdAmount": 100.00
}
```

### Charge Pre-Auth
```
POST /api/payments/charge-pre-auth
{
  "orderId": "xxx",
  "preAuthId": "pa_xxx",
  "amount": 67.50,
  "tipAmount": 12.50
}
```

### Release Pre-Auth
```
DELETE /api/payments/pre-auth/[id]
```

## Database Fields

### Order Pre-Auth Fields
```prisma
model Order {
  preAuthId         String?
  preAuthCardBrand  String?   // VISA, MC, AMEX
  preAuthLast4      String?   // Last 4 digits
  preAuthAmount     Decimal?  // Hold amount
  preAuthExpiresAt  DateTime? // Expiration
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/components/tabs/PreAuthModal.tsx` | Capture pre-auth UI |
| `src/app/api/payments/pre-auth/route.ts` | Pre-auth API |
| `src/components/orders/OpenOrdersPanel.tsx` | Shows pre-auth badge |
| `src/components/payment/PaymentModal.tsx` | Charge pre-auth |
