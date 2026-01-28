# Create Cocktail Recipe

Define the ingredients and pour costs for a cocktail menu item.

## Overview

Recipes define what goes into a cocktail:
- Which bottles/spirits to use
- How many pours of each
- Which ingredients can be substituted (tier upgrades)
- Total pour cost calculation

## Required Information

1. **Menu Item** - The cocktail to create recipe for (must be in a 'liquor' category)
2. **Ingredients** - List of:
   - Bottle product (from bottle library)
   - Pour count (1, 0.5, 2, etc.)
   - Is substitutable? (allows tier upgrades)

## API Endpoints

### Get Recipe
```
GET /api/menu/items/[id]/recipe
```

### Save Recipe
```
POST /api/menu/items/[id]/recipe
```

## Example Request

```json
{
  "ingredients": [
    {
      "bottleProductId": "cuid_house_tequila",
      "pourCount": 1.5,
      "isSubstitutable": true,
      "sortOrder": 0
    },
    {
      "bottleProductId": "cuid_triple_sec",
      "pourCount": 0.5,
      "isSubstitutable": false,
      "sortOrder": 1
    },
    {
      "bottleProductId": "cuid_lime_juice",
      "pourCount": 1,
      "isSubstitutable": false,
      "sortOrder": 2
    }
  ]
}
```

## Pour Cost Calculation

Total pour cost = sum of (ingredient.pourCost × ingredient.pourCount)

```typescript
const totalPourCost = ingredients.reduce((sum, ing) => {
  return sum + (ing.bottleProduct.pourCost * ing.pourCount)
}, 0)

const margin = ((sellPrice - totalPourCost) / sellPrice) * 100
```

## Example Recipe

**Margarita ($12.00)**

| Ingredient | Pours | Pour Cost | Total | Substitutable |
|------------|-------|-----------|-------|---------------|
| House Tequila | 1.5 | $0.49 | $0.74 | Yes |
| Triple Sec | 0.5 | $0.53 | $0.27 | No |
| Lime Juice | 1.0 | $0.33 | $0.33 | No |
| **Total** | | | **$1.34** | |

**Margin**: 88.8%

## Spirit Substitution

When `isSubstitutable: true`:
1. POS shows tier selection (Well → Call → Premium → Top Shelf)
2. Customer upgrades from House Tequila ($0.49/pour) to Patron ($2.53/pour)
3. Price difference added to order
4. On payment, inventory deducted from actual bottle used (Patron)
5. Pour cost in reports reflects actual bottle

## Admin UI

Navigate to `/liquor-builder` → Recipes tab to manage recipes via the UI.
