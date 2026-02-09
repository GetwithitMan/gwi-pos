# Inventory Domain

**Domain ID:** 2
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Inventory domain manages food ingredients, prep items, stock tracking, recipe costing, and automatic inventory deduction. It handles:
- Base ingredients and prep item hierarchy (input → output transformations)
- Stock levels, adjustments, and audit trails
- Recipe costing and food cost analysis
- Auto-deduction on order payment and void/comp
- Theoretical vs actual usage variance
- Par levels and reorder suggestions

## Domain Trigger

```
PM Mode: Inventory
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Ingredients | Base ingredients + prep items | `src/app/(admin)/ingredients/`, `src/app/api/ingredients/` |
| Stock | Stock levels, adjustments | `src/app/api/inventory/stock-adjust/`, `src/app/api/inventory/settings/` |
| Recipes | Menu item recipes, costing | `src/app/api/menu/items/[id]/recipe/` |
| Deductions | Auto-deduction on sale/void | `src/lib/inventory-calculations.ts` |
| Reports | Variance, usage, PMIX | `src/app/api/reports/inventory/`, `src/app/api/reports/pmix/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/inventory-calculations.ts` | Core deduction engine (sale + waste), modifier fallback paths |
| `src/lib/units.ts` | 50+ unit definitions, precision hints |
| `src/lib/unit-conversions.ts` | Weight/volume conversions, yield calculations |
| `src/hooks/useIngredientLibrary.ts` | Business logic for ingredient library page |
| `src/hooks/useIngredientCost.ts` | Shared cost calculation hook |
| `src/hooks/useHierarchyCache.ts` | LRU cache with 5-min TTL for hierarchy data |
| `src/hooks/useDebounce.ts` | Search debouncing |
| `src/components/ingredients/IngredientHierarchy.tsx` | Hierarchy view with checkbox selection |
| `src/components/ingredients/IngredientLibrary.tsx` | Main library component |
| `src/components/ingredients/PrepItemEditor.tsx` | Prep item input/output editor |
| `src/components/ingredients/InventoryItemEditor.tsx` | Inventory item editor |
| `src/components/ingredients/BulkActionBar.tsx` | Bulk operations UI |
| `src/components/ingredients/DeletedItemsPanel.tsx` | Restore workflow |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/ingredients` | GET/POST | List/create ingredients |
| `/api/ingredients/[id]` | GET/PUT/DELETE | Single ingredient CRUD |
| `/api/ingredients/[id]/cost` | GET | Cost per unit calculation |
| `/api/ingredients/[id]/hierarchy` | GET | Full hierarchy tree |
| `/api/ingredients/[id]/recipe-cost` | GET | Aggregated recipe cost |
| `/api/ingredients/bulk-parent` | POST | Bulk move to category |
| `/api/ingredient-categories` | GET/POST | Ingredient categories |
| `/api/inventory/stock-adjust` | POST | Stock adjustments with audit trail |
| `/api/inventory/settings` | GET/POST | Location inventory settings |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 37 | 86 Items | DONE |
| 38 | Inventory Tracking | DONE |
| 39 | Low Stock Alerts | DONE |
| 125 | Ingredient Costing & Recipes | DONE |
| 126 | Explicit Input → Output Model | DONE |
| 127 | Quick Stock Adjustment | DONE |
| 204 | Ingredient Library Refactor | DONE |
| 205 | Component Improvements | DONE |
| 211 | Hierarchical Ingredient Picker | DONE |
| 213 | Real-Time Ingredient Library | DONE |
| 214 | Ingredient Verification Visibility | DONE |
| 215 | Unified Modifier Inventory Deduction | DONE |
| 216 | Ingredient-Modifier Connection Visibility | DONE |

## Integration Points

- **Orders Domain**: Auto-deduction on payment via `deductInventoryForOrder()`
- **Menu Domain**: Ingredient linking via `Modifier.ingredientId`, recipe components
- **Reports Domain**: PMIX food cost, theoretical vs actual variance
