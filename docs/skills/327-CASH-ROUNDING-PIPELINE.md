# Skill 327: Cash Rounding Pipeline Fix

## Status: DONE
## Domain: Payments, Reports
## Date: February 11, 2026
## Dependencies: Skill 88 (Price Rounding)

## Summary

Fixed the complete cash payment rounding pipeline from client display through server validation to daily report tracking. Two separate rounding systems existed (`priceRounding` from Skill 88 and legacy `cashRounding`) that were not synchronized, causing payment failures and missing report data.

## Problems Fixed

### 1. Payment Validation Failure
**Symptom:** "Payment amount ($3.25) is less than remaining balance ($3.29)"
**Root Cause:** Client used `priceRounding` (quarter rounding, enabled) but server only checked `cashRounding` (set to 'none'). Server rejected the rounded amount.
**Fix:** Server now checks `priceRounding` first, falls back to `cashRounding`.

### 2. Stale Totals After Void
**Symptom:** "Payment amount ($6.84) is less than remaining balance ($9.87)" after voiding items
**Root Cause:** `handleCompVoidComplete` triggered async reload but didn't immediately update the store, so PaymentModal read stale pre-void totals.
**Fix:** Immediately call `syncServerTotals()` with comp-void response data before async reload.

### 3. Rounding Artifact in Remaining Balance
**Symptom:** "$0.04 remaining" shown after $3.25 cash payment on $3.29 order
**Root Cause:** (a) Client `remainingBeforeTip` computed from raw total, (b) Server "fully paid" check used hardcoded 0.01 tolerance, too tight for quarter rounding.
**Fix:** (a) Client detects rounding artifacts and treats as $0. (b) Server computes `paidTolerance` from rounding increment.

### 4. Rounding Not Stored on Payment Records
**Symptom:** `roundingAdjustment` always null on new cash payments
**Root Cause:** Client sends already-rounded amount; server re-rounded `payment.amount` which was already rounded, getting adjustment of 0.
**Fix:** Server now computes adjustment against `rawRemaining` (the unrounded order balance), not `payment.amount`.

### 5. Rounding Missing From Daily Report
**Symptom:** No rounding data in daily sales report
**Root Cause:** `payment.roundingAdjustment` was stored in DB but never queried by reports.
**Fix:** Added cumulative rounding total to both Revenue and Cash sections of daily report.

## Files Modified

### Pay Route (`src/app/api/orders/[id]/pay/route.ts`)
- Import `applyPriceRounding` from `@/lib/pricing`
- Validation block checks `priceRounding` first, then `cashRounding`
- Cash processing computes `roundingAdjustment` from `rawRemaining` (not `payment.amount`)
- `paidTolerance` computed from rounding increment (not hardcoded 0.01)
- "Fully paid" check and response use `paidTolerance`

### Payment Modal (`src/components/payment/PaymentModal.tsx`)
- Added `cashRoundingAdjustment` memo
- `remainingBeforeTip` detects and absorbs rounding artifacts
- Shows "Rounding" line in Order Summary when cash selected
- Displays rounded remaining (not raw) when cash selected

### Orders Page (`src/app/(pos)/orders/page.tsx`)
- `handleCompVoidComplete` immediately calls `syncServerTotals()` and `updateItem()` before async reload

### Daily Report API (`src/app/api/reports/daily/route.ts`)
- Accumulates `totalRoundingAdjustments` from `payment.roundingAdjustment`
- Added `roundingAdjustments` to `revenue` section
- Added `roundingAdjustments` to `cash` section
- `cashDue` includes rounding adjustments

### Daily Report UI (`src/app/(admin)/reports/daily/page.tsx`)
- Updated `DailyReport` interface with `roundingAdjustments` fields
- Yellow "Cash Rounding" line in Revenue section (cumulative day total)
- Yellow "Cash Rounding" line in Cash section

## Two Rounding Systems

| System | Source | Settings Key | Format | Status |
|--------|--------|-------------|--------|--------|
| `priceRounding` (Skill 88) | `settings.priceRounding` | `{ enabled, increment, direction, applyToCash, applyToCard }` | Increment: '0.05', '0.10', '0.25' | **Active** |
| `cashRounding` (legacy) | `settings.payments.cashRounding` | Named mode string | 'none', 'nickel', 'dime', 'quarter' | Set to 'none' |

**Priority:** `priceRounding` takes precedence when enabled. Legacy `cashRounding` is the fallback.

## Key Patterns

### Rounding Artifact Detection (Client)
```typescript
// If raw remaining rounds to $0, treat as fully paid
if (priceRounding?.enabled && priceRounding.applyToCash) {
  const rounded = applyPriceRounding(raw, priceRounding, 'cash')
  if (rounded <= 0) return 0
}
```

### Server Adjustment from Raw Balance (Not Payment Amount)
```typescript
// Client sends rounded amount — compare against raw order balance
const rawRemaining = remaining - alreadyPaidInLoop
const rounded = applyPriceRounding(rawRemaining, settings.priceRounding, 'cash')
roundingAdjustment = Math.round((rounded - rawRemaining) * 100) / 100
```

### Tolerance from Increment
```typescript
const paidTolerance = (hasCash && settings.priceRounding?.enabled)
  ? parseFloat(settings.priceRounding.increment) / 2
  : 0.01
```
