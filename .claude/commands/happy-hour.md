# Happy Hour

Automatic time-based pricing for scheduled discounts.

## Overview

Happy Hour applies automatic price adjustments during configured time windows:
- Different prices by day of week
- Multiple time windows per day
- Percentage or fixed amount discounts
- Category or item-specific rules

## Configuration

Navigate to `/settings` → Happy Hour or `/happy-hour`

### Creating a Happy Hour Rule

1. **Name**: "Weekday Happy Hour"
2. **Days**: Select applicable days (Mon-Fri)
3. **Time Window**: Start time to end time (4:00 PM - 7:00 PM)
4. **Discount Type**: Percentage or fixed amount
5. **Discount Value**: e.g., 20% or $2.00 off
6. **Apply To**: All items, category, or specific items

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/happy-hour` | List rules |
| `POST /api/happy-hour` | Create rule |
| `PUT /api/happy-hour/[id]` | Update rule |
| `DELETE /api/happy-hour/[id]` | Delete rule |
| `GET /api/happy-hour/active` | Get currently active rules |

## POS Behavior

1. System checks current time against rules
2. If happy hour active:
   - Affected items show discounted price
   - "Happy Hour" badge displayed
   - Discount auto-applied to order
3. When happy hour ends:
   - Prices revert to normal
   - New orders use regular pricing

## Example Rules

### Weekday Happy Hour
- Days: Monday - Friday
- Time: 4:00 PM - 7:00 PM
- Discount: 25% off
- Applies to: Drinks category

### Late Night Special
- Days: Thursday - Saturday
- Time: 10:00 PM - 1:00 AM
- Discount: $3.00 off
- Applies to: Appetizers category

### Sunday Brunch
- Days: Sunday
- Time: 10:00 AM - 2:00 PM
- Discount: 15% off
- Applies to: Brunch category

## Database Model

```prisma
model HappyHourRule {
  id            String @id
  name          String
  daysOfWeek    Int[]    // 0=Sun, 1=Mon, etc.
  startTime     String   // "16:00"
  endTime       String   // "19:00"
  discountType  String   // "percentage" or "fixed"
  discountValue Decimal
  appliesToType String   // "all", "category", "item"
  appliesToIds  String[] // Category or item IDs
  isActive      Boolean
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/happy-hour/page.tsx` | Admin UI |
| `src/app/api/happy-hour/route.ts` | API endpoints |
| `src/lib/happy-hour.ts` | Time/price calculations |
