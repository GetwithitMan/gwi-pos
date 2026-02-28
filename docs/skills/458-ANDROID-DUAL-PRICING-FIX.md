# Skill 458: Android Dual Pricing Display Fix

**Date:** 2026-02-27
**Status:** DONE
**Domain:** Android / Payments / UI
**Dependencies:** Skill 31 (Dual Pricing), Skill 457 (Payment Hardening)

## Summary

Fixed inverted dual pricing display on Android. The Android app was incorrectly treating the base price as the cash price and adding a surcharge for card payments. The correct model (matching web POS): **the default price IS the credit card price**, and cash gets a discount.

## Root Cause

Three files had the logic backwards:

| File | Before (WRONG) | After (CORRECT) |
|------|----------------|-----------------|
| `OrderPanel.kt` | `cardTotal = total + surchargeTotal` | `cardTotal = total` |
| `OrderPanel.kt` | `cashTotal = total` | `cashTotal = total - surchargeTotal` |
| `PaymentSheet.kt` | `effectiveTotal = (orderTotal + surchargeTotal)` for card | `effectiveTotal = orderTotal` for card |
| `PaymentSheet.kt` | `effectiveTotal = orderTotalDollars` for cash | `effectiveTotal = (orderTotal - surchargeTotal)` for cash |
| `OrderViewModel.kt payCash` | Total sent as-is | `cashTotalCents = orderTotalCents - cashDiscountCents` |

## UI Changes

### OrderPanel
- Removed "Card Surcharge +$X" line
- Shows "Cash Discount (X%)" in green only when cash toggle is selected
- "You save $X with cash!" message when paying cash

### PaymentSheet
- Card selected: shows full order total (no modification)
- Cash selected: shows discounted total with green "Cash discount applied: -$X.XX" line
- Change due calculated against cash total (not full total)

### OrderViewModel.payCash
- Cash total = order total - surcharge (cash discount)
- Payment request sends cash-discounted amount
- Receipt change calculated against cash total
- PaymentLog records cash total (not card total)

## Files Changed

| File | Lines | What |
|------|-------|------|
| `OrderPanel.kt` | ~10 | Flipped card/cash total, removed surcharge display, added cash discount display |
| `PaymentSheet.kt` | ~8 | Flipped effective total, cash change due, discount label |
| `OrderViewModel.kt` | ~6 | payCash sends cash-discounted amount |

## Verification

1. Card payment: total shows as-is (no surcharge added) ✅
2. Cash payment: total minus cash discount shown ✅
3. Cash discount line: green "-$X.XX" ✅
4. PaymentSheet cash: correct total + change due ✅
5. Matches web POS behavior exactly ✅
