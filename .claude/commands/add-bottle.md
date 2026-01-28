# Add Bottle Product

Add a new bottle to the liquor inventory system.

## Required Information

When adding a bottle, collect:
1. **Name** - Product name (e.g., "Patron Silver")
2. **Brand** - Brand name (optional)
3. **Spirit Category** - Tequila, Vodka, Gin, Rum, Whiskey, etc.
4. **Tier** - well, call, premium, or top_shelf
5. **Bottle Size** - in mL (50, 200, 375, 500, 750, 1000, 1750)
6. **Unit Cost** - Purchase price per bottle

## Auto-Calculated Fields

The system automatically calculates:
- **Pours per Bottle**: `Math.floor(bottleSizeMl / (pourSizeOz * 29.5735))`
- **Pour Cost**: `unitCost / poursPerBottle`

Default pour size is 1.5 oz (44.36 mL).

## API Endpoint

```
POST /api/liquor/bottles
```

## Example Request

```json
{
  "name": "Patron Silver",
  "brand": "Patron",
  "spiritCategoryId": "cuid_of_tequila_category",
  "tier": "premium",
  "bottleSizeMl": 750,
  "unitCost": 42.99
}
```

## Example Response

```json
{
  "id": "...",
  "name": "Patron Silver",
  "tier": "premium",
  "bottleSizeMl": 750,
  "unitCost": 42.99,
  "poursPerBottle": 16,
  "pourCost": 2.69
}
```

## Common Bottle Sizes

| Size | Label | Typical Pours (1.5oz) |
|------|-------|----------------------|
| 50 mL | Mini | 1 |
| 200 mL | Half Pint | 4 |
| 375 mL | Pint | 8 |
| 750 mL | Fifth | 16-17 |
| 1000 mL | Liter | 22 |
| 1750 mL | Handle | 39 |

## Admin UI

Navigate to `/liquor-builder` → Bottles tab to add bottles via the UI.
