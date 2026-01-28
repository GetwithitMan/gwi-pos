# Gift Cards

Sell and redeem gift cards for payment.

## Overview

Gift card features:
- Sell cards with custom amounts
- Check balance
- Redeem for payment (full or partial)
- Track transaction history

## Admin Management

Navigate to `/gift-cards` to manage.

### Issue a Gift Card

1. Click "Issue Card"
2. Enter amount (e.g., $50.00)
3. Optionally assign to customer
4. Card number generated
5. Print or send digitally

### Check Balance

1. Enter card number
2. View current balance
3. See transaction history

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/gift-cards` | List cards |
| `POST /api/gift-cards` | Issue new card |
| `GET /api/gift-cards/[id]` | Get card details |
| `GET /api/gift-cards/lookup?number=xxx` | Find by number |
| `POST /api/gift-cards/[id]/reload` | Add balance |

## Card Structure

```json
{
  "id": "gc_xxx",
  "cardNumber": "GC-XXXX-XXXX-XXXX",
  "initialBalance": 50.00,
  "currentBalance": 35.50,
  "status": "active",
  "customerId": "cust_xxx",
  "expiresAt": "2027-01-01",
  "transactions": [...]
}
```

## Status Values

| Status | Description |
|--------|-------------|
| `active` | Ready for use |
| `depleted` | Balance is zero |
| `expired` | Past expiration date |
| `suspended` | Temporarily disabled |

## POS Redemption

1. Select "Gift Card" payment
2. Enter or scan card number
3. System checks balance
4. Apply full or partial amount
5. Remaining balance shown

## Partial Redemption

If order is $35 and card has $25:
1. Apply $25 from gift card
2. Pay remaining $10 with other method
3. Card balance becomes $0

## Transaction History

Each card tracks:
- Activation (initial load)
- Reloads (adding balance)
- Redemptions (using balance)
- Adjustments (manual changes)

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/gift-cards/page.tsx` | Admin UI |
| `src/app/api/gift-cards/route.ts` | API endpoints |
| `src/components/payment/GiftCardInput.tsx` | Payment UI |

## Settings

Configure in `/settings`:
- Card number format
- Default expiration period
- Minimum/maximum amounts
- Allow reloads
