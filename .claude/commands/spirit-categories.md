# Spirit Categories

Manage spirit categories for organizing bottles and creating spirit modifier groups.

## Overview

Spirit categories classify bottles by type:
- Tequila
- Vodka
- Gin
- Rum
- Whiskey/Bourbon
- Scotch
- Brandy/Cognac
- Liqueurs
- etc.

## Purpose

1. **Organize Bottles** - Group bottles by spirit type
2. **Create Modifier Groups** - Link to modifier groups for POS selection
3. **Substitution Logic** - Same-category spirits can substitute in recipes

## API Endpoints

### List Categories
```
GET /api/liquor/categories
```

### Create Category
```
POST /api/liquor/categories
```

### Update Category
```
PUT /api/liquor/categories/[id]
```

### Delete Category
```
DELETE /api/liquor/categories/[id]
```

## Example Request (Create)

```json
{
  "name": "Tequila",
  "displayName": "Tequila",
  "description": "Agave-based spirits from Mexico",
  "sortOrder": 0
}
```

## Linking to Modifier Groups

When creating a spirit modifier group:

1. Create a `ModifierGroup` with `isSpiritGroup: true`
2. Create a `SpiritModifierGroup` linking it to a `SpiritCategory`
3. Add `Modifier` entries for each bottle tier:
   - Well: House Tequila (+$0)
   - Call: Jose Cuervo (+$2)
   - Premium: Patron Silver (+$5)
   - Top Shelf: Don Julio 1942 (+$15)

Each modifier has:
- `spiritTier`: well/call/premium/top_shelf
- `linkedBottleProductId`: Reference to actual bottle
- `price`: Upcharge amount

## Common Categories

| Category | Examples |
|----------|----------|
| Tequila | House, Cuervo, Patron, Don Julio |
| Vodka | House, Absolut, Grey Goose, Belvedere |
| Gin | House, Tanqueray, Bombay, Hendricks |
| Rum | House, Bacardi, Captain Morgan, Malibu |
| Whiskey | House, Jack Daniels, Makers Mark, Woodford |
| Bourbon | Jim Beam, Buffalo Trace, Bulleit |
| Scotch | Dewars, Johnnie Walker, Glenlivet |

## Admin UI

Navigate to `/liquor-builder` → Categories tab to manage categories via the UI.
