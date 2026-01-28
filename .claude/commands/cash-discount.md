# Cash Discount Program

Dual pricing system compliant with card brand rules.

## Overview

The Cash Discount Program shows:
- **Card price** as the default/displayed price
- **Cash price** as a discount at time of payment

This approach complies with Visa/Mastercard rules by treating the discount as a benefit for cash customers rather than a surcharge for card customers.

## How It Works

1. **Menu prices entered as cash prices** (e.g., $10.00)
2. **System calculates card price**: cash × (1 + discount%)
   - Example: $10.00 × 1.04 = $10.40
3. **Card price displayed everywhere** as the "regular" price
4. **At payment**: Cash customers see discount ("Save $0.40")

## Configuration

Navigate to `/settings` → Payment Settings → Cash Discount Program

| Setting | Description |
|---------|-------------|
| Enable Cash Discount | Turn feature on/off |
| Cash Discount % | Percentage (e.g., 4%) |

## Price Display

### Menu Items
Shows card price (the default):
```
Burger  $10.40
```

### At Payment
- **Cash button**: Shows cash total (green) - $10.00
- **Card button**: Shows card total (blue) - $10.40

### Receipt
- Card payment: Shows card total
- Cash payment: Shows discount applied

## Key Functions

```typescript
// src/lib/pricing.ts

// Calculate card price from stored cash price
getCardPrice(cashPrice, discountPercent)
// $10.00 × (1 + 0.04) = $10.40

// Calculate cash price from card price
getCashPrice(cardPrice, discountPercent)
// $10.40 / (1 + 0.04) = $10.00

// Get discount amount
getCashDiscount(cardPrice, discountPercent)
// $10.40 - $10.00 = $0.40
```

## Compliance Notes

- **No surcharge language**: Always frame as cash discount
- **Card price is default**: Posted prices are card prices
- **Cash is the discount**: Benefit for paying cash
- **Signage**: "4% discount for cash payments"

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/pricing.ts` | Price calculation functions |
| `src/lib/settings.ts` | Settings schema |
| `src/app/(admin)/settings/page.tsx` | Settings UI |

## Settings Schema

```typescript
{
  payments: {
    cashDiscountEnabled: boolean,
    cashDiscountPercent: number  // e.g., 4
  }
}
```
