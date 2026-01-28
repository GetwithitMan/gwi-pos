# Spirit Upsells

Track and analyze spirit upgrade prompts and acceptance.

## Overview

When a customer orders a cocktail with Well spirits, the POS can prompt an upsell:
> "Upgrade to Patron for just $5 more?"

The system tracks:
- When upsells are shown
- When they're accepted
- Revenue generated from upsells
- Performance by tier and employee

## How It Works

1. Customer orders a Margarita
2. Server selects Well (House Tequila)
3. System displays upsell prompt for Premium (Patron)
4. If accepted → price increases, SpiritUpsellEvent recorded
5. If declined → original selection kept, event still recorded

## API Endpoints

### Record Upsell Event
```
POST /api/liquor/upsells
```

### Get Upsell Stats
```
GET /api/liquor/upsells?startDate=xxx&endDate=xxx
```

## Event Fields

```json
{
  "orderId": "order_cuid",
  "orderItemId": "item_cuid",
  "employeeId": "emp_cuid",
  "baseModifierId": "mod_house_tequila",
  "baseTier": "well",
  "baseBottleName": "House Tequila",
  "upsellModifierId": "mod_patron",
  "upsellTier": "premium",
  "upsellBottleName": "Patron Silver",
  "priceDifference": 5.00,
  "wasShown": true,
  "wasAccepted": true
}
```

## Key Metrics

### Acceptance Rate
```
rate = (totalAccepted / totalShown) * 100
```

Industry benchmarks:
- 10-15%: Below average
- 20-25%: Average
- 30%+: Excellent

### Revenue per Upsell
```
avgRevenue = totalUpsellRevenue / totalAccepted
```

### Employee Performance
Track which servers have highest upsell rates to:
- Identify training opportunities
- Recognize top performers
- Set incentive goals

## Upsell Configuration

In the SpiritModifierGroup:
- `upsellEnabled`: true/false
- `upsellPromptText`: Custom message template

Default prompt: "Upgrade to {bottleName} for ${priceDifference} more?"

## Database Model

```prisma
model SpiritUpsellEvent {
  id               String   @id @default(cuid())
  locationId       String
  orderId          String
  orderItemId      String
  employeeId       String
  baseModifierId   String
  baseTier         String
  baseBottleName   String
  upsellModifierId String
  upsellTier       String
  upsellBottleName String
  priceDifference  Decimal
  wasShown         Boolean
  wasAccepted      Boolean
  createdAt        DateTime @default(now())
}
```

## Reports

View upsell analytics at `/reports/liquor` → Upsells tab:
- Summary metrics
- Performance by tier
- Performance by employee

## Best Practices

1. **Train servers** on upsell language and timing
2. **Set realistic targets** (20-25% acceptance)
3. **Review weekly** to identify trends
4. **Incentivize** top performers
5. **Test different prompts** to optimize acceptance
