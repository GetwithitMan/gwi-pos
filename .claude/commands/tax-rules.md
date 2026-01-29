# Tax Rules (Skill 36)

Configure tax rates by category, item type, or custom rules.

## Overview

Tax rules allow different tax rates for different item types (food vs alcohol), categories, or specific items.

## Default Tax Rate

Set in Location Settings:
1. Go to `/settings`
2. Find Tax Settings
3. Set default rate (e.g., 8%)

## Tax Rules

### Rule Types

| Rule Type | Description |
|-----------|-------------|
| Category | Apply rate to entire category |
| Item Type | Apply to food, liquor, retail, etc. |
| Specific Item | Override for single item |
| Time-Based | Different rates at different times |

### Create Tax Rule
1. Go to `/settings/tax-rules`
2. Click "Add Rule"
3. Configure:
   - Name (e.g., "Alcohol Tax")
   - Rate (e.g., 10%)
   - Apply To: Category, Item Type, or Specific
   - Target: Which categories/items

### Rule Priority
1. Specific item rules (highest)
2. Category rules
3. Item type rules
4. Default rate (lowest)

## Tax Inclusive Pricing (Skill 89)

### Enable
1. Go to Location Settings
2. Enable "Tax Inclusive Pricing"
3. Displayed prices include tax
4. Receipt shows tax breakdown

### How It Works
- Menu prices shown include tax
- System calculates pre-tax amount
- Receipt itemizes: Subtotal, Tax, Total
- Tax remittance calculated correctly

### Cash Discount with Tax Inclusive
- Cash discount calculated on total (tax included)
- Tax still properly tracked for reporting

## Tax Exempt

### Exempt Orders
- Mark order as tax exempt
- Requires reason/documentation
- Tracked for audit

### Tax Exempt Customers
- Link customer to order
- Customer marked as tax exempt
- Auto-applies to their orders

## Reports

### Tax Report
- Total tax collected by rate
- Tax by category
- Tax exempt orders
- Period comparisons

## API Endpoints

### Get Tax Rules
```
GET /api/tax-rules?locationId=xxx
```

### Create Tax Rule
```
POST /api/tax-rules
{
  "locationId": "xxx",
  "name": "Alcohol Tax",
  "rate": 10.0,
  "applyTo": "category",
  "targetIds": ["cat-beer", "cat-wine", "cat-liquor"]
}
```

### Calculate Tax
```
POST /api/orders/calculate-tax
{
  "items": [...],
  "locationId": "xxx"
}
```

## Database Model

### TaxRule
```prisma
model TaxRule {
  id          String   @id
  locationId  String
  name        String
  rate        Decimal
  applyTo     String   // category, itemType, item
  targetIds   Json     // Array of IDs
  priority    Int      @default(0)
  isActive    Boolean  @default(true)
  startTime   String?  // For time-based rules
  endTime     String?
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/settings/tax-rules/page.tsx` | Tax rules management |
| `src/app/api/tax-rules/route.ts` | Tax rules API |
| `src/lib/tax-calculator.ts` | Tax calculation logic |
