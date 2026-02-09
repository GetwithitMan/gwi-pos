# Skill 240: Tax-Inclusive Pricing

**Status:** DONE
**Domain:** Settings / Orders
**Date:** 2026-02-08
**Dependencies:** 36 (Tax Calculations), 239 (Pricing Engine Refactor)

## Overview

Tax-inclusive pricing allows certain categories (liquor, food) to include tax in the displayed price rather than adding it on top. This is common for bar pricing where "$8 beer" means $8 out the door.

## How It Works

### Split Tax Calculation
Orders with mixed inclusive/exclusive items use `calculateSplitTax()`:
- **Inclusive items**: Tax is "backed out" — `tax = price - (price / (1 + rate))`
- **Exclusive items**: Tax is "added on" — `tax = price × rate`
- Both tax amounts rounded to 2 decimals for compliance

### Category-Based Rules
- Configured via TaxRule records with `isInclusive: true`
- `appliesTo: 'all'` makes everything inclusive
- `appliesTo: 'category'` with `categoryIds` targets specific categories
- Categories checked against LIQUOR_TYPES (`liquor`, `drinks`) and FOOD_TYPES (`food`, `pizza`, `combos`)

### Item Stamping
When orders are created, each item is stamped with `isTaxInclusive` based on its category type at time of sale. This persists the tax treatment even if settings change later.

## Files
| File | Role |
|------|------|
| `src/lib/order-calculations.ts` | `calculateSplitTax()`, `isItemTaxInclusive()`, `splitSubtotalsByTaxInclusion()` |
| `src/hooks/usePricing.ts` | Splits subtotals and passes to `calculateOrderTotals` |
| `src/hooks/useOrderSettings.ts` | Exposes `taxInclusiveLiquor`/`taxInclusiveFood` from API |
| `src/app/api/orders/route.ts` | Stamps `isTaxInclusive` on OrderItems at creation |
| `src/app/api/orders/[id]/items/route.ts` | Same stamping on item append |
| `src/app/api/settings/route.ts` | Derives inclusive flags from TaxRule records |
| `prisma/schema.prisma` | `taxFromInclusive`/`taxFromExclusive` on Order model |

## UI
- "Included in item prices" note shown in expanded total breakdown when tax-inclusive items present
- `hasTaxInclusiveItems` prop passed to OrderPanelActions
