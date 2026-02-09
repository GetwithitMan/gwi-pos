# Skill 239: Pricing Engine Refactor — Single Source of Truth

**Status:** DONE
**Domain:** Payments / Orders
**Date:** 2026-02-08
**Dependencies:** 31 (Dual Pricing), 36 (Tax Calculations), 88 (Price Rounding)

## Problem

Two 3rd-party code reviews identified structural issues in the pricing engine:
1. `roundPrice` used floating-point math → artifacts with nickels/dimes (e.g., 32.3999 instead of 32.40)
2. Ad-hoc `Math.round(x * 100) / 100` scattered throughout — no single rounding utility
3. `usePricing` hook re-implemented tax + rounding instead of delegating to `calculateOrderTotals`
4. Two conflicting `calculateOrderTotals` existed (`order-calculations.ts` vs `tax-calculations.ts`)
5. Rounding wasn't truly "last step" — sub-components rounded independently
6. Dual pricing computed in multiple places (per-item in components + per-subtotal in hook)
7. React components contained inline math (`item.price * multiplier * cpm`) instead of consuming pre-computed values

## Solution

### Step 1: Cent-Safe Rounding Utility (`pricing.ts`)
- Added `roundToCents()` — single money-rounding utility used everywhere
- Rewrote `roundPrice()` to use cent-based integer math (no float drift)
- Replaced all `Math.round(x*100)/100` across codebase with `roundToCents()`

### Step 2: Extended `calculateOrderTotals` (`order-calculations.ts`)
- Extended `OrderTotals` interface: added `totalBeforeRounding`, `roundingDelta`
- Extended function signature: optional `priceRounding` + `paymentMethod` params
- Pipeline: sum raw → split tax → total → round (absolute last step)
- Backward compatible: callers without `priceRounding` get `roundingDelta: 0`

### Step 3: Rewrote `usePricing` as Thin Adapter (`usePricing.ts`)
- Removed ~130 lines of duplicate tax/rounding math
- Builds synthetic items from inclusive/exclusive subtotals
- Calls `calculateOrderTotals` twice (cash + card)
- Returns `cashRoundingDelta` and `cardRoundingDelta` separately
- Dual pricing computed once: `cardSubtotal = calculateCardPrice(cashSubtotal, discountPct)`

### Step 4: Tax-Calculations Deprecated Facade (`tax-calculations.ts`)
- Kept for backward compatibility with 8 existing callers
- Uses `roundToCents` from pricing.ts
- Marked deprecated with migration instructions

### Step 5: Removed Inline Math from Components
- `OrderPanelActions.tsx`: removed IIFE subtotal computation, uses `cashSubtotal`/`cardSubtotal` props
- Per-item display prices use `roundToCents()` instead of `Math.round(x*100)/100`
- Props chain: `usePricing` → parent → `OrderPanel` → `OrderPanelActions`

### Step 6: Cash Rounding UI
- "Rounding" line only shows when `paymentMode === 'cash'`
- Card view shows unrounded total with no rounding line
- `cashRoundingDelta` passed separately from active `roundingDelta`

## Principles Applied
- **One rounding utility** — all money rounding through `roundToCents()`
- **Rounding is absolute last step** — sum raw → surcharge → discount → tax → tip → THEN round
- **Dual pricing derived once** — at subtotal level, not per-item
- **`taxRate` always decimal** (0.08) — never ambiguous 8 vs 0.08
- **React components consume, never compute** — no `Math.round` in JSX

## Files Modified (29 total)
| File | Change |
|------|--------|
| `src/lib/pricing.ts` | Added `roundToCents()`, rewrote `roundPrice()` to cent-based |
| `src/lib/order-calculations.ts` | Extended `OrderTotals` + `calculateOrderTotals` with rounding/paymentMethod |
| `src/hooks/usePricing.ts` | Rewritten as thin adapter, returns `cashRoundingDelta`/`cardRoundingDelta` |
| `src/lib/tax-calculations.ts` | Deprecated facade, uses `roundToCents` |
| `src/components/orders/OrderPanelActions.tsx` | Removed inline math, uses pre-computed subtotals |
| `src/components/orders/OrderPanel.tsx` | Added `cashSubtotal`/`cardSubtotal` props pass-through |
| `src/components/floor-plan/FloorPlanHome.tsx` | Passes `pricing.cashSubtotal`/`cardSubtotal`/`cashRoundingDelta` |
| `src/app/(pos)/orders/page.tsx` | Same prop updates |
| `src/app/api/settings/route.ts` | Fixed `priceRounding` deep merge in PUT handler |
| `src/hooks/useActiveOrder.ts` | Fixed empty response body crash |
| `src/hooks/useOrderSettings.ts` | Tax-inclusive settings exposure |
| `src/lib/settings.ts` | PriceRounding settings type |
| `prisma/schema.prisma` | `taxFromInclusive`/`taxFromExclusive` on Order |
| `src/app/api/orders/route.ts` | Tax-inclusive split on order creation |
| `src/app/api/orders/[id]/items/route.ts` | Tax-inclusive split on item append |
| + 14 other component files | Card price as default display, `roundToCents` usage |

## Verification
- `roundPrice(32.39, '0.05', 'nearest')` → `32.40` (not 32.3999...)
- Cash toggle shows rounded total with "Rounding +$0.01" line
- Card view shows exact unrounded total, no rounding line
- Tax line is exact 2-decimal value, never touched by price rounding
- API routes without `priceRounding` param work identically (`roundingDelta: 0`)
- Card price displayed as default across all views
