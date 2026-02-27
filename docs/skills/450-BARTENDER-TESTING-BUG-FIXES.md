# Skill 450: Bartender Testing Bug Fixes — 5 POS Issues

**Date:** 2026-02-26
**Commit:** `a4ac377`
**Status:** DONE

## Overview

Bartender testing revealed 9 issues. After investigation, 4 were working as designed or environmental. 5 required code fixes across 4 files.

## Fix 1: Cash "Payment Complete" Before Server Confirms (CRITICAL)

**File:** `src/components/payment/PaymentModal.tsx`

### Root Cause
`setCashComplete(true)` at line 624 triggered the "Payment Complete" screen as soon as `cashTendered >= totalWithTip`. The server API call didn't happen until the user clicked "Done" → `handleCashFinalize()`. User saw "Payment Complete" before ANY server call.

### Fix
- Renamed screen heading from "Payment Complete" → "Change Due"
- Changed button text from "Done" → "Complete Payment"
- Real confirmation is the modal closing after API success
- If API fails, the error toast + modal staying open is correct behavior

## Fix 2: 409 After Failed Cash Payment (MINOR)

**File:** `src/components/payment/PaymentModal.tsx`

### Root Cause
Cascade of Fix 1. After cash payment failed, UI stayed on "Payment Complete" screen. User confused, may retry or create new order causing 409.

### Fix
Added `setCashComplete(false); setCashTendered(0)` in both error paths:
1. Server returns non-OK response (line 728)
2. Network error in catch block (line 735)

## Fix 3: Split Orders Leave Parent Table Occupied (CRITICAL)

**File:** `src/app/api/orders/[id]/pay/route.ts`

### Root Cause
When all split siblings are paid, `parentTableId` was extracted from the parent order update, but the table was never freed. The table-freeing logic at line 1344 only checked `order.tableId` — the child's table ID, which is null for split orders.

### Fix
Added parent table reset after `parentWasMarkedPaid` socket dispatch (line 1290):
```typescript
if (parentTableId) {
  void db.table.update({
    where: { id: parentTableId },
    data: { status: 'available' },
  }).then(() => {
    invalidateSnapshotCache(order.locationId)
  }).catch(err => {
    console.error('[Pay] Parent table status reset failed:', err)
  })
}
```

## Fix 4: Payment Buttons Hidden on Tablet (MODERATE)

**File:** `src/components/orders/OrderPanel.tsx`

### Root Cause
Items container at line 1447 had `flex: 1` but no `minHeight: 0`. Without it, a flex child won't shrink below its content size, pushing the footer (payment buttons) off-screen on 768×1024 viewports.

### Fix
Added `minHeight: 0` to the items container style.

## Fix 5: Shift Modal Flashes on Page Reload (MINOR)

**File:** `src/hooks/useShiftManagement.ts`

### Root Cause
All shift state was pure `useState` — lost on every page reload. Bootstrap API re-check triggers `setShowShiftStartModal(true)` before the response arrives confirming a shift exists.

### Fix
- Seed `currentShift` from `sessionStorage.getItem('gwi_current_shift')` on mount
- Seed `shiftChecked` from `sessionStorage.getItem('gwi_shift_checked')` on mount
- Wrapped both setters to also persist to `sessionStorage`
- Clearing shift (`setCurrentShift(null)`) also clears both storage keys

## Issues NOT Requiring Code Changes

| # | Issue | Finding |
|---|-------|---------|
| 2 | QTY buttons control wrong thing | Working as designed — `handleQuickPickNumber` correctly updates selected item qty |
| 4 | Click item text adds duplicate | Not a click-through bug — `onItemClick` opens edit UI, doesn't add items |
| 6 | Mobile locationId mismatch | Environmental — seed uses `loc-1`, user was passing `loc-demo-001` |
| 7 | Mobile register 401 | Environmental — wrong PIN or wrong locationId |
