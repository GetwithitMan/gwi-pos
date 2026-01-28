# Menu Builder

Create and manage menu categories, items, and pricing.

## Overview

The menu builder allows:
- Create categories (Food, Drinks, etc.)
- Add menu items with pricing
- Attach modifiers and prep stations
- Set item availability
- Configure item types (standard, combo, timed rental)

## Admin Access

Navigate to `/menu` for the menu builder.

## Categories

### Category Types

| Type | Description | Special Features |
|------|-------------|------------------|
| Food | Standard food items | Prep stations |
| Drinks | Beverages | Quick add |
| Liquor | Alcoholic beverages | Spirit tiers, recipes |
| Entertainment | Timed rentals | Time-based billing |
| Combos | Combo meals | Bundle pricing |

### Creating a Category

1. Click "Add Category"
2. Set name and type
3. Set display order
4. Choose color (optional)
5. Save

## Menu Items

### Creating an Item

1. Select category
2. Click "Add Item"
3. Enter name and price
4. Set item type
5. Attach modifiers
6. Assign prep stations
7. Save

### Item Types

| Type | Description |
|------|-------------|
| `standard` | Regular menu item |
| `combo` | Combo meal with slots |
| `timed_rental` | Time-billed item |

### Item Fields

```json
{
  "name": "Cheeseburger",
  "description": "Classic beef burger",
  "price": 12.99,
  "categoryId": "cat_xxx",
  "itemType": "standard",
  "isActive": true,
  "taxable": true,
  "prepStations": ["grill"],
  "modifierGroups": ["burger-temp", "burger-toppings"]
}
```

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/menu` | Full menu with categories |
| `GET /api/menu/categories` | Categories only |
| `POST /api/menu/categories` | Create category |
| `GET /api/menu/items` | All items |
| `POST /api/menu/items` | Create item |
| `PUT /api/menu/items/[id]` | Update item |
| `DELETE /api/menu/items/[id]` | Delete item |

## Liquor Items

For liquor category items:
- Link to spirit modifier groups
- Create cocktail recipes
- View pour cost calculations
- Access Liquor Builder: `/liquor-builder`

## Combo Items

For combo type items:
- Define combo slots
- Set slot options with upcharges
- Configure min/max selections
- Access Combo Builder: `/combos`

## Availability

Control when items are available:
- Active/Inactive toggle
- Schedule availability (coming soon)
- 86'd items (out of stock)

## POS Display

Menu items appear in POS:
- Grouped by category
- Category tabs at top
- Item buttons in grid
- Price displayed on button

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/menu/page.tsx` | Menu builder UI |
| `src/app/api/menu/route.ts` | Menu API |
| `src/app/api/menu/categories/route.ts` | Category API |
| `src/app/api/menu/items/route.ts` | Item API |

## Tips

- Use clear, concise item names
- Group related items in categories
- Set appropriate prep stations
- Configure modifiers for customization
- Use item descriptions for details
