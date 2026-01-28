# Combo Meals

Create and manage combo meal deals with bundled items and pricing.

## Overview

Combos bundle multiple items at a discounted price:
- Main item + sides + drink for one price
- Customer chooses options from each group
- Price calculated from combo base + modifier upcharges

## Key Components

### Combo Structure
- **Combo Menu Item**: The purchasable combo (e.g., "Burger Combo $12.99")
- **Combo Slots**: Groups customer must choose from (Entree, Side, Drink)
- **Slot Options**: Available choices per slot with optional upcharges

## Admin Setup

Navigate to `/combos` to manage combos.

### Creating a Combo

1. Click "Add Combo"
2. Set name, price, category
3. Add slots (groups):
   - Slot name: "Choose Entree"
   - Required: Yes/No
   - Min/Max selections
4. Add options to each slot:
   - Link to menu item
   - Price override (optional)
   - Default selection

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/combos` | List all combos |
| `POST /api/combos` | Create combo |
| `GET /api/combos/[id]` | Get combo details |
| `PUT /api/combos/[id]` | Update combo |
| `DELETE /api/combos/[id]` | Delete combo |

## POS Flow

1. Server taps combo item
2. Combo Selection Modal opens
3. Shows each slot with options
4. Server selects one option per required slot
5. Price updates based on selections
6. Tap "Add to Order"

## Example Combo

**Burger Combo - $12.99**

| Slot | Options | Upcharge |
|------|---------|----------|
| Entree | Classic Burger | +$0.00 |
| | Bacon Burger | +$2.00 |
| | Veggie Burger | +$0.00 |
| Side | Fries | +$0.00 |
| | Onion Rings | +$1.00 |
| | Side Salad | +$0.00 |
| Drink | Soda | +$0.00 |
| | Iced Tea | +$0.00 |
| | Lemonade | +$0.50 |

Customer selects: Bacon Burger + Onion Rings + Soda
**Total: $12.99 + $2.00 + $1.00 = $15.99**

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/combos/page.tsx` | Admin combo builder |
| `src/app/api/combos/route.ts` | Combo CRUD |
| `src/components/orders/ComboSelectionModal.tsx` | POS selection UI |

## Database Model

```prisma
model ComboMeal {
  id          String @id
  name        String
  price       Decimal
  slots       ComboSlot[]
}

model ComboSlot {
  id          String @id
  name        String
  required    Boolean
  minSelect   Int
  maxSelect   Int
  options     ComboSlotOption[]
}

model ComboSlotOption {
  id            String @id
  menuItemId    String
  priceOverride Decimal?
  isDefault     Boolean
}
```
