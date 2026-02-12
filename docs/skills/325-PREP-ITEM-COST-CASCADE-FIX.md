# Skill 325: Prep Item Cost Cascade Fix

**Status:** DONE
**Domain:** Inventory
**Date:** 2026-02-11
**Dependencies:** Skill 126 (Input/Output Model)

## Summary

Fixed two bugs that prevented prep item costs from displaying:

1. **Cost API HTTP self-fetch** — The `/api/ingredients/[id]/cost` endpoint used recursive `fetch()` calls to itself via HTTP, which failed when the dev server port changed or in production environments
2. **List API field stripping** — The ingredient list API was silently dropping transformation fields (`inputQuantity`, `inputUnit`, `outputQuantity`, `outputUnit`) from responses, so prep item data appeared empty on page reload

## Root Cause #1: Cost API Self-Fetch

The cost endpoint used `fetch('http://localhost:3000/api/ingredients/${id}/cost')` to recursively calculate costs for recipe components and parent ingredients. This broke because:
- Dev server could be on a different port (3001, etc.)
- The `sourceType === 'delivered'` gate blocked items without explicit sourceType
- Server-to-server HTTP fetch in Next.js is fragile

### Fix
Rewrote the entire cost API to use direct Prisma DB queries via a `calculateIngredientCost()` function with 4-priority fallback:
1. If `purchaseCost` exists → direct calculation
2. If has recipe components → sum component costs from DB data
3. If prep item with parent → recursive `calculateIngredientCost()` call (DB function, not HTTP)
4. If linked inventoryItem with costPerUnit → use that

## Root Cause #2: List API Field Stripping

The `formatChildIngredient()` and parent `formattedIngredients` mapping in `/api/ingredients/route.ts` explicitly listed fields to return. These fields were missing:
- `inputQuantity`, `inputUnit`, `outputQuantity`, `outputUnit`
- `sourceType`, `purchaseCost`, `unitsPerPurchase`, `purchaseUnit`
- `recipeYieldQuantity`, `recipeYieldUnit`, `showOnQuick86`

### Fix
Added all missing fields to both formatting functions and the grandchild `select` query, with proper `Number()` conversion for Prisma Decimal fields.

## Files Modified

| File | Changes |
|------|---------|
| `src/app/api/ingredients/[id]/cost/route.ts` | Complete rewrite — replaced HTTP self-fetch with direct DB queries via `calculateIngredientCost()` |
| `src/app/api/ingredients/route.ts` | Added 11 missing fields to `formatChildIngredient()`, parent mapping, and grandchild `select` |
| `src/app/api/ingredients/[id]/route.ts` | Added `Number()` conversions for Decimal fields in GET and PUT responses |
| `src/components/ingredients/PrepItemEditor.tsx` | Removed `(ingredient as any)` casts, added yellow "Cost unavailable" hint |
| `src/components/ingredients/InventoryItemEditor.tsx` | Minor cleanup for cost display consistency |

## Verification

Tested via curl after fix:
- **Pizza Dough**: `{costPerUnit: 0.5, costUnit: "oz", costSource: "recipe"}` ✓
- **Breadsticks** (prep): `{costPerUnit: 0.5556, costUnit: "each", costSource: "parent"}` ✓
- **Personal Pizza Crust** (prep): `{costPerUnit: 0.5556, costUnit: "each", costSource: "parent"}` ✓
