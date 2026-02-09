# Liquor Management Domain

**Domain ID:** 19
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Liquor Management domain handles spirits, cocktail recipes, bottle tracking, pour cost analysis, and spirit-specific upselling. It handles:
- Spirit categories and bottle product management
- Cocktail recipe builder with ingredient-to-bottle linking
- Pour cost calculations and bottle yield tracking
- Spirit tier management (Well, Call, Premium, Top Shelf)
- Spirit upsell configuration for cocktails
- Liquor inventory tracking (separate from food inventory)
- Liquor-specific reports (pour cost, bottle usage, variance)

## Domain Trigger

```
PM Mode: Liquor Management
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Spirit Categories | Spirit type management | `src/app/api/liquor/categories/` |
| Bottle Products | Individual bottle tracking | `src/app/api/liquor/bottles/` |
| Recipes | Cocktail recipe builder | `src/app/api/liquor/recipes/` |
| Upsells | Spirit tier upselling | `src/app/api/liquor/upsells/` |
| Inventory | Liquor-specific inventory | `src/lib/liquor-inventory.ts` |
| Admin | Liquor builder admin page | `src/app/(admin)/liquor-builder/page.tsx` |
| Reports | Liquor-specific reporting | `src/app/api/reports/liquor/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/liquor-builder/page.tsx` | Liquor builder admin interface |
| `src/lib/liquor-inventory.ts` | Liquor inventory deduction calculations |
| `src/app/api/reports/liquor/route.ts` | Liquor reports API |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/liquor/categories` | GET/POST | Spirit category CRUD |
| `/api/liquor/bottles` | GET/POST | Bottle product management |
| `/api/liquor/recipes` | GET/POST | Cocktail recipe CRUD |
| `/api/liquor/upsells` | GET/POST | Spirit upsell configuration |
| `/api/liquor/menu-items` | GET | Menu items linked to liquor |
| `/api/reports/liquor` | GET | Liquor reports (pour cost, usage) |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 118 | Spirit Tier Admin | DONE |
| 141 | Menu/Liquor Builder Separation | DONE |

## Integration Points

- **Menu Domain**: Liquor items are menu items with `categoryType: 'liquor'` and pour sizes
- **Inventory Domain**: Liquor deductions run parallel to food deductions (`processLiquorInventory`)
- **Orders Domain**: Pour size selection, spirit tier quick-select on cocktails
- **Reports Domain**: Liquor reports (pour cost %, bottle variance)
- **Financial Domain**: Cost of goods for liquor
