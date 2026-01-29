# Timed Rentals

Bill customers by time for entertainment items like pool tables, karaoke rooms, or bowling lanes.

> **See also**: [Entertainment Sessions](entertainment-sessions.md) for managing active sessions and the Entertainment KDS.

## Overview

Timed rentals track usage time and bill accordingly:
- Timer auto-starts on "Send to Kitchen"
- Block time (fixed duration) or per-minute billing
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

## Block Time Mode

For fixed-duration sessions (e.g., "$15 for 1 hour"):

1. Set `blockTimeMinutes` on the menu item (e.g., 60)
2. When order is sent, timer starts with that duration
3. Timer counts DOWN to expiration
4. Extend time if needed (+15, +30, +45, +60 min options)
5. Stop session when done

### Session Controls
Entertainment items show inline controls on the Orders page:
- Countdown timer (color-coded urgency)
- "Extend Time" button
- "Stop Session" button

## Entertainment KDS

The dedicated Entertainment KDS at `/kds/entertainment` provides:
- Grid view of all entertainment items
- Waitlist management
- Quick session start/stop
- Status overview (available, in_use, maintenance)

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(kds)/entertainment/page.tsx` | Entertainment KDS |
| `src/components/orders/EntertainmentSessionControls.tsx` | Session timer/controls |
| `src/app/api/entertainment/block-time/route.ts` | Block time API |
| `src/app/api/entertainment/status/route.ts` | Item status updates |
| `src/lib/entertainment.ts` | Entertainment utilities |

## Database Fields

```prisma
model MenuItem {
  itemType            String   // "timed_rental"
  entertainmentStatus String   // "available", "in_use", etc.
  blockTimeMinutes    Int?     // Default session duration (e.g., 60)
  rate15Min           Decimal?
  rate30Min           Decimal?
  rateHourly          Decimal?
  currentOrderId      String?  // Active rental order
  currentOrderItemId  String?  // Active rental item
}

model OrderItem {
  blockTimeMinutes    Int?     // Duration for this session
  blockTimeStartedAt  DateTime? // When timer started
  blockTimeExpiresAt  DateTime? // When timer expires
}
```
