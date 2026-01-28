# Liquor Builder

Manage the liquor builder system including bottles, spirit categories, cocktail recipes, and reporting.

## Overview

The Liquor Builder is a comprehensive system for:
- Managing bottle products with automatic pour cost calculation
- Organizing spirits into categories (Tequila, Vodka, Gin, etc.)
- Creating cocktail recipes with ingredient tracking
- Tiered spirit selection in POS (Well → Call → Premium → Top Shelf)
- Upsell tracking and performance analytics
- Pour cost and profit margin reporting

## Key Files

### Database Models
- `BottleProduct` - Bottle library with size, cost, tier
- `SpiritCategory` - Spirit type classification
- `SpiritModifierGroup` - Links modifier groups to categories
- `RecipeIngredient` - Cocktail recipe ingredients
- `SpiritUpsellEvent` - Upsell tracking

### API Endpoints
| Endpoint | Purpose |
|----------|---------|
| `/api/liquor/bottles` | Bottle CRUD with auto pour cost |
| `/api/liquor/categories` | Spirit category CRUD |
| `/api/liquor/recipes` | List cocktails with recipes |
| `/api/liquor/upsells` | Upsell event tracking |
| `/api/menu/items/[id]/recipe` | Recipe ingredient CRUD |
| `/api/reports/liquor` | Comprehensive liquor reporting |

### Admin Pages
| Page | Purpose |
|------|---------|
| `/liquor-builder` | Admin: Bottles, Categories, Recipes tabs |
| `/reports/liquor` | Reports: Overview, Tiers, Bottles, Pour Cost, Upsells |

### Core Libraries
| File | Purpose |
|------|---------|
| `src/lib/liquor-inventory.ts` | Pour deduction on payment |
| `src/lib/constants.ts` | SPIRIT_TIERS, BOTTLE_SIZES, LIQUOR_DEFAULTS |

## Spirit Tiers

| Tier | Color | Description |
|------|-------|-------------|
| Well | Gray | House/rail spirits |
| Call | Blue | Named brand spirits |
| Premium | Purple | Premium brand spirits |
| Top Shelf | Amber | Luxury spirits |

## Pour Cost Calculation

```typescript
const pourSizeMl = pourSizeOz * 29.5735  // Default: 1.5 oz = 44.36 mL
const poursPerBottle = Math.floor(bottleSizeMl / pourSizeMl)
const pourCost = unitCost / poursPerBottle
```

## Recipe Example

```
Margarita Recipe:
- 1.5 pour Tequila (default: House) - $0.67 - Substitutable
- 0.5 pour Triple Sec (DeKuyper) - $0.27 - Fixed
- 1.0 pour Lime Juice - $0.33 - Fixed

Total Pour Cost: $1.27
Sell Price: $12.00
Margin: 89.4%
```

## Inventory Flow

1. Order placed with spirit selection (e.g., Patron instead of House Tequila)
2. Order paid → `processLiquorInventory()` called
3. Recipe ingredients checked for spirit substitutions
4. `InventoryTransaction` records created for pour tracking
5. Reports updated with pour usage and cost data

## Common Tasks

### Add a New Bottle
1. Go to `/liquor-builder` → Bottles tab
2. Click "Add Bottle"
3. Enter name, select category and tier
4. Enter bottle size and unit cost
5. Pour cost auto-calculates on save

### Create a Cocktail Recipe
1. Go to `/liquor-builder` → Recipes tab
2. Select a cocktail menu item
3. Click "Edit Recipe"
4. Add ingredients with pour counts
5. Mark spirits as substitutable for tier upgrades
6. Save to see calculated pour cost

### View Spirit Reports
1. Go to `/reports/liquor`
2. Set date range
3. Tabs: Overview, By Tier, Bottle Usage, Pour Cost, Upsells
