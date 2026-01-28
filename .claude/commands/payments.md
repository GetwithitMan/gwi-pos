# Payment Processing

Process payments via cash, card, gift card, house account, or loyalty points.

## Payment Methods

| Method | Description |
|--------|-------------|
| Cash | With change calculation |
| Credit/Debit | Card payments (simulated) |
| Gift Card | Redeem gift card balance |
| House Account | Charge to customer account |
| Loyalty Points | Redeem earned points |

## API Endpoint

```
POST /api/orders/[id]/pay
```

## Request Structure

```json
{
  "employeeId": "emp_xxx",
  "payments": [
    {
      "method": "cash",
      "amount": 25.00,
      "tipAmount": 5.00,
      "amountTendered": 40.00
    }
  ]
}
```

## Payment Types

### Cash Payment
```json
{
  "method": "cash",
  "amount": 25.00,
  "tipAmount": 5.00,
  "amountTendered": 40.00
}
```
Response includes `changeGiven`.

### Card Payment
```json
{
  "method": "credit",
  "amount": 25.00,
  "tipAmount": 5.00,
  "cardLast4": "1234",
  "cardBrand": "visa"
}
```

### Gift Card
```json
{
  "method": "gift_card",
  "amount": 25.00,
  "giftCardNumber": "GC-XXXX-XXXX"
}
```

### House Account
```json
{
  "method": "house_account",
  "amount": 25.00,
  "houseAccountId": "ha_xxx"
}
```

### Loyalty Points
```json
{
  "method": "loyalty_points",
  "amount": 10.00,
  "pointsUsed": 1000
}
```

## Split Payments

Multiple payment methods in one request:
```json
{
  "payments": [
    { "method": "gift_card", "amount": 15.00, "giftCardNumber": "..." },
    { "method": "cash", "amount": 20.00, "amountTendered": 20.00 }
  ]
}
```

## Cash Rounding

When enabled, cash amounts round to nearest nickel:
- $10.42 → $10.40 (round down)
- $10.43 → $10.45 (round up)

Configure in Settings → Payment Settings.

## Response

```json
{
  "success": true,
  "payments": [
    {
      "id": "pay_xxx",
      "method": "cash",
      "amount": 25.00,
      "tipAmount": 5.00,
      "totalAmount": 30.00,
      "changeGiven": 10.00
    }
  ],
  "orderStatus": "paid",
  "remainingBalance": 0,
  "loyaltyPointsEarned": 25
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/orders/[id]/pay/route.ts` | Payment processing |
| `src/components/payment/PaymentModal.tsx` | Payment UI |
| `src/lib/payment.ts` | Payment utilities |

## Order Status Flow

1. `open` - Order in progress
2. `partial` - Partial payment received
3. `paid` - Fully paid
4. `closed` - Closed out

## Integrations

On successful payment:
- Loyalty points awarded (if customer attached)
- Gift card balance reduced
- House account charged
- Entertainment items released
- **Liquor inventory deducted** (if applicable)
