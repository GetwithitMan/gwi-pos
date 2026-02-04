# Modifiers

Customize menu items with add-ons, variations, and special instructions.

## Overview

Modifiers allow customization:
- Size options (Small, Medium, Large)
- Add-ons (Extra cheese, Bacon)
- Preparations (Rare, Medium, Well-done)
- Sides selection
- Special instructions

## Modifier Groups

Groups organize related modifiers:

| Group | Type | Example Modifiers |
|-------|------|-------------------|
| Size | Radio (pick one) | Small, Medium, Large |
| Temperature | Radio | Rare, Med-Rare, Medium, Well |
| Toppings | Checkbox (pick many) | Lettuce, Tomato, Onion |
| Sides | Radio | Fries, Salad, Soup |

## Admin Setup

Navigate to `/modifiers` to manage.

### Creating a Modifier Group

1. Click "Add Group"
2. Set name and selection type:
   - `radio` - Pick exactly one
   - `checkbox` - Pick zero or more
   - `quantity` - Pick with quantity
3. Set min/max selections
4. Add modifiers with prices

### Creating Modifiers

1. Open a group
2. Click "Add Modifier"
3. Set name and price:
   - `+$0.00` - Free option
   - `+$1.50` - Upcharge
4. Set default selection (optional)

## Linking to Menu Items

1. Open menu item in `/menu`
2. Go to Modifiers tab
3. Attach modifier groups
4. Set required/optional

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/modifiers` | List groups |
| `POST /api/modifiers` | Create group |
| `PUT /api/modifiers/[id]` | Update group |
| `DELETE /api/modifiers/[id]` | Delete group |
| `GET /api/menu/items/[id]/modifiers` | Item's modifiers |

## POS Behavior

1. Server taps menu item
2. If item has required modifiers:
   - Modifier modal opens
   - Must select required options
3. If only optional modifiers:
   - Item added immediately
   - Long-press to customize

## Pre-Modifiers

Text prefixes for kitchen tickets:
- "NO" - No lettuce
- "EXTRA" - Extra cheese
- "LIGHT" - Light mayo
- "SIDE" - Side of ranch

## Spirit Groups

Special modifier type for liquor upgrades:

### Setup

1. Go to `/modifiers` admin page
2. Create or edit a modifier group
3. Enable **"Spirit Upgrade Group"** checkbox
4. For each modifier:
   - Enter spirit name (e.g., "Patron Silver")
   - Enter upcharge price
   - Click tier button: **Well** | **Call** | **Premium** | **Top**

### Spirit Tiers

| Tier | Color | Description |
|------|-------|-------------|
| Well | Gray | House/default (no upcharge) |
| Call | Sky Blue | Mid-tier brands |
| Premium | Violet | Premium brands |
| Top Shelf | Amber | Top shelf brands |

### POS Behavior

- BartenderView shows quick tier buttons on cocktails
- Clicking tier opens popup with all spirits in that tier
- One-tap selection without full modifier modal
- Well tier hidden (it's the default)

### Database Fields

- `ModifierGroup.isSpiritGroup`: Boolean flag
- `Modifier.spiritTier`: 'well' | 'call' | 'premium' | 'top_shelf'

### Links

- See `/liquor-builder` skill for bottle inventory
- See `/spirit-upsells` skill for upsell tracking

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/modifiers/page.tsx` | Admin UI |
| `src/app/api/modifiers/route.ts` | API endpoints |
| `src/components/modifiers/ModifierModal.tsx` | POS selection UI |

## Database Model

```prisma
model ModifierGroup {
  id            String @id
  name          String
  selectionType String    // "radio", "checkbox", "quantity"
  minSelections Int
  maxSelections Int
  modifiers     Modifier[]
}

model Modifier {
  id       String @id
  name     String
  price    Decimal
  isDefault Boolean
  groupId  String
}
```
