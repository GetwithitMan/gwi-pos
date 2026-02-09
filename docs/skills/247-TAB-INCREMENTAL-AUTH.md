# Skill 247: Tab Incremental Auth & Re-Auth Flow

**Status:** DONE
**Domain:** Payments / Orders
**Date:** 2026-02-09
**Dependencies:** Skill 120 (Datacap Direct), Skill 21 (Pre-Auth)

## Overview

When a bartender adds items to an existing bar tab that already has a card on file, the system automatically fires an `IncrementalAuthByRecordNo` via Datacap to increase the hold — no card re-tap required. The hold includes a configurable tip buffer (default 25%) to cover potential gratuity.

## Key Concepts

### IncrementalAuthByRecordNo (Datacap)
- **Card-not-present** transaction — uses stored `RecordNo` token from initial pre-auth
- Each call **adds** to the existing hold amount
- Bar tab lifecycle: `EMVPreAuth` → `IncrementalAuthByRecordNo` (multiple) → `PreAuthCaptureByRecordNo`

### Re-Auth Button
- When a tab has a card on file, the "Start a Tab" button changes to **"Re-Auth ••••1234"**
- Clicking Re-Auth:
  1. Saves new items to the existing order (POST to `/api/orders/[id]/items`)
  2. Sends items to kitchen
  3. Fires incremental auth with `force: true` (bypasses threshold gate)
  4. Shows approval/decline toast

### Tip Buffer Setting
- **`incrementTipBufferPercent`** — configurable in `/settings` under "Bar Tab / Pre-Auth"
- Default: 25% (covers up to 25% tip)
- Set to 0 to hold exact tab total only
- Formula: `targetHold = orderTotal × (1 + tipBufferPercent / 100)`

### Auto vs Forced Increment
| Mode | Trigger | Threshold | Minimum | Tip Buffer |
|------|---------|-----------|---------|------------|
| **Auto** | Background after adding items | Must reach X% of hold | $25 minimum | Yes |
| **Force** | User clicks Re-Auth | Always fires | No minimum | Yes |

## Settings (Admin → /settings)

| Setting | Default | Description |
|---------|---------|-------------|
| `autoIncrementEnabled` | true | Enable background auto-increment |
| `incrementTipBufferPercent` | 25 | Extra % on hold for potential tip (0 = disabled) |
| `incrementThresholdPercent` | 80 | Auto-increment fires when tab reaches this % of hold |
| `incrementAmount` | $25 | Minimum for background auto-increments |
| `maxTabAlertAmount` | $500 | Alert manager when tab exceeds this |

## API

### POST `/api/orders/[id]/auto-increment`

**Request body:**
```json
{
  "employeeId": "emp-1",
  "force": true
}
```

**Response (approved):**
```json
{
  "data": {
    "action": "incremented",
    "incremented": true,
    "additionalAmount": 10.25,
    "newAuthorizedTotal": 35.08,
    "needsManagerAlert": false,
    "tabTotal": 28.06
  }
}
```

**Response (declined):**
```json
{
  "data": {
    "action": "increment_failed",
    "incremented": false,
    "tabTotal": 28.06,
    "totalAuthorized": 24.83,
    "needsManagerAlert": false,
    "error": { "code": "05", "message": "Do Not Honor", "isRetryable": false }
  }
}
```

## Files Modified

| File | Changes |
|------|---------|
| `src/app/api/orders/[id]/auto-increment/route.ts` | `force` param, tip buffer from settings, `order.total` (with tax), updates both `OrderCard.authAmount` AND `order.preAuthAmount` |
| `src/app/(pos)/orders/page.tsx` | `onStartTab` rewrite: detects existing tab card, skips card modal, POSTs unsent items, sends to kitchen, awaits auto-increment result with toast |
| `src/components/orders/OrderPanelActions.tsx` | Button label: "Re-Auth ••••1234" when tab has card |
| `src/lib/settings.ts` | Added `incrementTipBufferPercent` to `PaymentSettings` interface + defaults |
| `src/hooks/useOrderSettings.ts` | Added `incrementTipBufferPercent` default |
| `src/app/(admin)/settings/page.tsx` | New "Bar Tab / Pre-Auth" settings card with all increment controls |

## Bugs Fixed During Development

1. **Tab duplication** — `saveOrderToDatabase()` created new orders when `savedOrderId` was null in closure. Fixed by reading `existingOrderId` from Zustand store.
2. **`tabCardInfo` race condition** — useEffect cleared card info when `currentOrder` was null during async load. Fixed with `prevOrderRef` pattern.
3. **Hold not updating in Open Orders** — Only updated `OrderCard.authAmount`, not `order.preAuthAmount`. Fixed with `db.$transaction`.
4. **Hold amount short (missing tax)** — Used `order.subtotal` (pre-tax). Fixed to use `order.total`.
5. **$25 minimum overriding small increments** — Forced Re-Auth used same minimum as auto. Fixed: force mode has no minimum floor.
6. **Hardcoded 25% buffer** — Made configurable via `incrementTipBufferPercent` setting.

## Test Scenarios (TODO)

- [ ] Incremental auth decline — what happens? Toast shown? Tab still usable?
- [ ] Add second card to tab — multi-card flow
- [ ] Auto-increment fires at threshold (background, no user action)
- [ ] Manager alert at maxTabAlertAmount
- [ ] Tip buffer set to 0% — hold should equal exact tab total
- [ ] Tab close (PreAuthCapture) after multiple increments
