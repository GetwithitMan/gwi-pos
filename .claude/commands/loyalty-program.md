# Loyalty Program

Reward repeat customers with points they can redeem for discounts.

## Overview

Loyalty program features:
- Earn points on purchases
- Redeem points for payment
- Track customer visit history
- Automatic point calculation

## Configuration

Navigate to `/settings` → Loyalty Program

### Earning Points
- Points per dollar spent (e.g., 1 point = $1)
- Earn on subtotal or total
- Include tips in earning
- Minimum spend to earn

### Redeeming Points
- Points per dollar redemption (e.g., 100 pts = $1)
- Minimum points to redeem
- Maximum % of order payable with points

## Customer Flow

### Earning
1. Customer makes purchase
2. Attach customer to order
3. Order paid
4. Points calculated and added
5. Customer notified of balance

### Redeeming
1. Attach customer to order
2. Select "Loyalty Points" payment
3. Enter points to use
4. Discount applied
5. Points deducted

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/customers/[id]` | Get customer with points |
| `POST /api/customers/[id]/points` | Adjust points |
| `GET /api/customers/[id]/history` | Point history |

## Customer Record

```json
{
  "id": "cust_xxx",
  "name": "John Doe",
  "email": "john@example.com",
  "loyaltyPoints": 1250,
  "totalSpent": 1250.00,
  "totalOrders": 15,
  "lastVisit": "2026-01-28"
}
```

## Point Calculation

### Earning
```typescript
pointsEarned = Math.floor(eligibleAmount * pointsPerDollar)
// $50 order × 1 pt/$1 = 50 points
```

### Redeeming
```typescript
dollarValue = pointsUsed / pointsPerDollarRedemption
// 500 points ÷ 100 pts/$1 = $5.00 discount
```

## Settings Schema

```typescript
{
  loyalty: {
    enabled: true,
    pointsPerDollar: 1,
    pointsPerDollarRedemption: 100,
    earnOnSubtotal: true,
    earnOnTips: false,
    minimumEarnAmount: 5.00,
    minimumRedemptionPoints: 100,
    maximumRedemptionPercent: 50
  }
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/customers/page.tsx` | Customer management |
| `src/app/api/customers/route.ts` | Customer API |
| `src/lib/settings.ts` | Loyalty settings |

## Reports

View loyalty metrics at `/reports/customers`:
- Top customers by points
- Points issued vs redeemed
- Redemption rate
- Customer visit frequency
