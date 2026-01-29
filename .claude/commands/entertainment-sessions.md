# Entertainment Sessions

Manage timed rental sessions for entertainment items like pool tables, darts, bowling lanes, etc.

## Overview

Entertainment sessions track time-based billing for rental items. The system synchronizes state across three views:

1. **Entertainment KDS** (`/kds/entertainment`) - Dedicated dashboard
2. **Open Orders Panel** - Badge display on tabs
3. **Orders Page** - Inline controls per item

## Starting a Session

### Automatic Start (Recommended)
Sessions auto-start when you click "Send to Kitchen" or "Send to Tab":

1. Add entertainment item to order (e.g., "Pool Table 1")
2. Click "Send to Kitchen"
3. Timer automatically starts using item's default block time

### Manual Start
If timer wasn't started automatically:

1. Open the order from "Open Orders"
2. Find the entertainment item
3. Click "Start Timer" button
4. Select duration (30, 60, 90, 120 min)

### From Entertainment KDS
1. Go to `/kds/entertainment`
2. Click waitlist entry → "Seat Customer"
3. Select table/item
4. Session starts automatically

## Session Controls

### On Orders Page
Each entertainment item shows inline controls:

```
Pool Table 1                    45:23
[Extend Time] [Stop Session]
```

- **Timer Display**: Countdown (green → orange at 5min → red when expired)
- **Extend Time**: Add +15, +30, +45, or +60 minutes
- **Stop Session**: End timer and release item

### On Entertainment KDS
Full session dashboard with:
- All active sessions in grid view
- Waitlist management
- Quick stop/extend actions
- Session history

## Block Time vs Per-Minute

### Block Time (Fixed Duration)
- Customer pays flat rate for set time
- Timer counts DOWN to expiration
- Example: $15 for 60 minutes

### Per-Minute Billing
- Customer pays per minute used
- Timer counts UP elapsed time
- Final charge calculated at stop

## API Endpoints

### Start Timer
```
POST /api/entertainment/block-time
{
  "orderItemId": "xxx",
  "minutes": 60
}
```

### Extend Timer
```
PATCH /api/entertainment/block-time
{
  "orderItemId": "xxx",
  "additionalMinutes": 30
}
```

### Stop Session
```
DELETE /api/entertainment/block-time?orderItemId=xxx
```

## MenuItem Configuration

Entertainment items need these settings:

| Field | Description |
|-------|-------------|
| `itemType` | Must be `timed_rental` |
| `blockTimeMinutes` | Default session duration |
| `timedPricing` | Pricing tiers (per15Min, per30Min, perHour) |
| `entertainmentStatus` | Current state (available, in_use, maintenance) |

## Auto-Refresh

All views auto-refresh every 5 seconds to keep state synchronized:
- Entertainment KDS refreshes items list
- Open Orders Panel refreshes order list
- Orders Page refreshes when viewing entertainment items

## Workflow Example

1. **Customer arrives**: Add to waitlist from Entertainment KDS
2. **Table opens**: Click "Seat Customer" on waitlist entry
3. **Session starts**: Timer begins automatically
4. **Time running low**: Extend time if needed
5. **Customer done**: Click "Stop Session"
6. **Payment**: Pay out the tab with final charges

## Key Files

| File | Purpose |
|------|---------|
| `src/components/orders/EntertainmentSessionControls.tsx` | Inline timer and controls |
| `src/app/(kds)/entertainment/page.tsx` | Entertainment KDS dashboard |
| `src/components/entertainment/SeatFromWaitlistModal.tsx` | Seat from waitlist flow |
| `src/app/api/entertainment/block-time/route.ts` | Block time API |
| `src/app/api/entertainment/status/route.ts` | Item status updates |
