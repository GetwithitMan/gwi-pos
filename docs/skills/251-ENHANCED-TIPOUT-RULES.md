# Skill 251: Enhanced Tip-Out Rules & Tip Guide Basis

**Status:** DONE
**Domain:** Payments, Settings
**Date:** 2026-02-10
**Dependencies:** Skill 250 (Tip Ledger Foundation)
**Phase:** Tip Bank Phase 2

## Overview

Extended the tip-out system with sales-based calculation modes, compliance caps, date-bounded rules, and a comprehensive tip settings admin page.

## What Was Built

### Schema Changes (prisma/schema.prisma)
5 new fields on TipOutRule:
- `basisType` (String, default "tips_earned") — tips_earned, food_sales, bar_sales, total_sales, net_sales
- `salesCategoryIds` (Json?) — Optional category filter for sales-based rules
- `maxPercentage` (Decimal?) — Compliance cap (max % of tips/sales)
- `effectiveDate` (DateTime?) — Rule becomes active on this date
- `expiresAt` (DateTime?) — Rule expires after this date

### Domain Logic (src/lib/domain/payment/tip-calculations.ts)
- `ShiftSalesData` interface — { totalSales, foodSales, barSales, netSales }
- `calculateTipOut()` — Extended: per-rule basisType, sales data, maxPercentage cap
- `calculateTipShares()` — Extended: per-rule basis + cap logic
- `calculateTipDistribution()` — Passes salesData through
- Private `getBasisAmount()` helper — switch on basisType to pick correct amount

### Shift Closeout (src/app/api/shifts/[id]/route.ts)
- `calculateShiftSummary()` — Now queries order items by categoryType (food/combos → foodSales, drinks/liquor → barSales), returns `salesData` object
- `processTipDistribution()` — Receives salesData, loads TipOutRule from DB for each tip-out, recalculates server-side if basisType != tips_earned, applies maxPercentage cap
- Server-side enforcement ensures correct amounts regardless of client calculation

### Tip-Out Rules API
- `GET /api/tip-out-rules` — Returns 5 new fields, filters expired rules by default (?includeExpired=true to show all)
- `POST /api/tip-out-rules` — Accepts and validates new fields (basisType validated, maxPercentage 0-100)
- `GET/PUT /api/tip-out-rules/[id]` — Returns/accepts all 5 new fields

### Tip Settings Admin (NEW)
- `GET/PUT /api/settings/tips` — Read/write tipBank + tipShares settings
- `/settings/tips` page — 6 sections:
  1. Tip Guide (basis, percentages, rounding, explanation toggle)
  2. Tip Bank (allocation mode, pool cash tips, allow negative balances, manager in pools)
  3. Chargeback Policy (business absorbs vs employee chargeback)
  4. Tip Shares (payout method, auto tip-out, acknowledgment, receipt display)
  5. CC Fee Deduction (toggle, fee %, live example)
  6. EOD Tip Payout (allow cash out, require manager approval, default method)

### Tip-Out Admin UI (src/app/(admin)/settings/tip-outs/page.tsx)
- basisType dropdown per rule (Tips Earned, Food Sales, Bar Sales, Total Sales, Net Sales)
- Color-coded basis badges (gray/orange/blue/purple/green)
- maxPercentage cap field per rule
- Effective date / expiration date fields
- Edit mode supports basisType + maxPercentage changes
- Example Calculation card shows correct basis amounts and cap behavior

### ShiftCloseoutModal (src/components/shifts/ShiftCloseoutModal.tsx)
- ShiftSummary interface includes salesData
- TipOutRule interface includes basisType, maxPercentage
- CalculatedTipOut tracks basisType, basisLabel, basisAmount, wasCapped, uncappedAmount
- calculateTipOuts() uses correct basis amount per rule
- Display: "Kitchen (1% of $700.00 food sales)" for sales-based rules
- Cap note: "Capped at 5% of tips (was $7.00)" in amber when capped

## Files Created
- `src/app/api/settings/tips/route.ts`
- `src/app/(admin)/settings/tips/page.tsx`

## Files Modified
- `prisma/schema.prisma` — 5 new fields on TipOutRule
- `src/lib/domain/payment/tip-calculations.ts` — ShiftSalesData, basisType, maxPercentage
- `src/lib/domain/payment/index.ts` — ShiftSalesData export
- `src/lib/settings.ts` — CC fee + EOD payout settings
- `src/app/api/shifts/[id]/route.ts` — Sales data query + server-side recalculation
- `src/app/api/tip-out-rules/route.ts` — New fields in GET/POST
- `src/app/api/tip-out-rules/[id]/route.ts` — New fields in GET/PUT
- `src/app/(admin)/settings/tip-outs/page.tsx` — basisType UI + cap
- `src/components/shifts/ShiftCloseoutModal.tsx` — Sales-based display

## Verification
1. Create rule with basisType=food_sales → verify calculates from food sales, not tips
2. Shift closeout → verify "3% of $1,200 food sales = $36.00" display
3. Set maxPercentage=5 → verify tip-out capped at 5% of tips
4. Set effectiveDate in future → verify rule not applied today
5. /settings/tips → verify all 6 sections save correctly
6. CC fee setting → verify example shows correct deduction
