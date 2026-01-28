# Timed Rentals

Bill customers by time for entertainment items like pool tables, karaoke rooms, or bowling lanes.

## Overview

Timed rentals track usage time and bill accordingly:
- Start timer when item added to order
- Auto-calculate charges based on elapsed time
- Stop and bill when customer is done
- Different rates for different time increments

## Item Configuration

Navigate to `/menu` and set category type to "Entertainment" or `/timed-rentals`

### Rate Structure
- **15-minute rate**: $5.00
- **30-minute rate**: $8.00 (discount for longer)
- **Hourly rate**: $15.00 (bigger discount)
- **Minimum time**: e.g., 15 minutes

## POS Flow

### Starting a Rental
1. Add timed rental item to order
2. Timer starts automatically
3. Item shows "In Use" status
4. Running time displayed on order

### Stopping a Rental
1. Tap item in order
2. Click "Stop & Bill"
3. System calculates charge based on time
4. Price updates on order
5. Item status returns to "Available"

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/menu?type=timed_rental` | List rental items |
| `POST /api/timed-rentals/start` | Start rental timer |
| `POST /api/timed-rentals/stop` | Stop and calculate |
| `GET /api/timed-rentals/active` | Get active rentals |

## Status Tracking

| Status | Description |
|--------|-------------|
| `available` | Ready for use |
| `in_use` | Timer running |
| `needs_cleaning` | After use, before available |
| `out_of_order` | Not available |

## Billing Calculation

```typescript
function calculateRentalCharge(
  startTime: Date,
  endTime: Date,
  rates: { minutes15: number, minutes30: number, hourly: number }
): number {
  const minutes = (endTime - startTime) / 60000

  // Use most favorable rate for customer
  const hourlyCharge = Math.ceil(minutes / 60) * rates.hourly
  const thirtyMinCharge = Math.ceil(minutes / 30) * rates.minutes30
  const fifteenMinCharge = Math.ceil(minutes / 15) * rates.minutes15

  return Math.min(hourlyCharge, thirtyMinCharge, fifteenMinCharge)
}
```

## Example

**Pool Table #3**
- 15-min rate: $5.00
- 30-min rate: $8.00
- Hourly rate: $15.00

Customer plays for 47 minutes:
- 15-min billing: 4 × $5 = $20.00
- 30-min billing: 2 × $8 = $16.00
- Hourly billing: 1 × $15 = $15.00

**Charge: $15.00** (hourly rate is best)

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/timed-rentals/page.tsx` | Admin setup |
| `src/app/api/timed-rentals/route.ts` | API endpoints |
| `src/lib/timed-rentals.ts` | Billing calculations |

## Database Fields

```prisma
model MenuItem {
  itemType            String   // "timed_rental"
  entertainmentStatus String   // "available", "in_use", etc.
  rate15Min           Decimal?
  rate30Min           Decimal?
  rateHourly          Decimal?
  currentOrderId      String?  // Active rental order
  currentOrderItemId  String?  // Active rental item
}
```
