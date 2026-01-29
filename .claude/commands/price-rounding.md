# Price Rounding (Skill 88)

Configure price rounding rules for cash transactions.

## Overview

Price rounding automatically rounds totals to convenient amounts for cash transactions, eliminating the need for pennies.

## Rounding Options

### Round to Nearest
| Option | Example $10.47 |
|--------|----------------|
| $0.05 | $10.45 |
| $0.10 | $10.50 |
| $0.25 | $10.50 |
| $1.00 | $10.00 |

### Round Direction
| Direction | Effect |
|-----------|--------|
| Nearest | Rounds up or down |
| Down | Always rounds down (customer benefit) |
| Up | Always rounds up (house benefit) |

## Configuration

### Enable Rounding
1. Go to `/settings`
2. Find "Price Rounding"
3. Enable for cash transactions
4. Select rounding amount
5. Choose direction

### Settings

```typescript
{
  enableRounding: true,
  roundTo: 0.05,        // $0.05 increments
  direction: 'nearest', // or 'down', 'up'
  applyTo: 'cash'       // or 'all'
}
```

## How It Works

### Cash Payments
1. Order total calculated: $23.47
2. Rounding applied: $23.45
3. Cash tendered: $25.00
4. Change given: $1.55

### Card Payments
- Rounding typically NOT applied
- Exact amount charged
- Configurable per location

## Display

### On Receipt
```
Subtotal:        $21.76
Tax:              $1.71
--------------------------------
Total:           $23.47
Cash Rounding:   -$0.02
--------------------------------
Amount Due:      $23.45
```

### In POS
- Shows rounded amount for cash
- Shows exact amount for card
- Clear indicator of rounding applied

## Rounding Report

### Track Impact
- Total rounding adjustments
- Average per transaction
- Net impact (+ or -)

### Example Report
```
Period: January 2026
Transactions: 1,247
Total Rounding: -$15.23 (down)
Average: -$0.01/transaction
```

## Best Practices

### Customer Friendly
- Round DOWN or to NEAREST
- Small increment ($0.05 or $0.10)
- Speeds up cash transactions

### Legal Compliance
- Some jurisdictions have rules
- Track all rounding for tax purposes
- Consult local regulations

## API

### Calculate Rounded Total
```
POST /api/orders/calculate
{
  "items": [...],
  "paymentMethod": "cash"
}

Response:
{
  "subtotal": 21.76,
  "tax": 1.71,
  "total": 23.47,
  "roundedTotal": 23.45,
  "roundingAdjustment": -0.02
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/price-calculator.ts` | Rounding logic |
| `src/app/(admin)/settings/page.tsx` | Rounding settings |
| `src/components/payment/PaymentModal.tsx` | Shows rounded amount |
