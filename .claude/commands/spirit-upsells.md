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

## Admin Management

### Creating Spirit Groups

1. Go to `/modifiers` admin page
2. Click "+ New Modifier Group" or edit existing
3. Check **"Spirit Upgrade Group"** checkbox
4. For each modifier (spirit brand):
   - Enter name (e.g., "Patron Silver")
   - Enter upcharge price
   - Click tier button: **Well** | **Call** | **Premium** | **Top Shelf**
5. Save

### Tier Assignment

| Tier | Color | Description | Example |
|------|-------|-------------|---------|
| Well | Gray | House/default | House Tequila |
| Call | Sky Blue | Mid-tier brands | Smirnoff, Bacardi |
| Premium | Violet | Premium brands | Patron, Tito's |
| Top Shelf | Amber | Top shelf brands | Clase Azul, Grey Goose |

### POS Quick Selection

When bartenders use BartenderView:
- Cocktail items show tier buttons: **Call** | **Prem** | **Top**
- Clicking tier opens popup with all spirits in that tier
- One-tap upgrade without full modifier modal
- Well tier excluded (it's the default)

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
