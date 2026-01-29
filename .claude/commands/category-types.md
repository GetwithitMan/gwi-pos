# Category Types (Skill 83)

Different category types enable specialized item builders and behaviors.

## Overview

Category types determine how items in that category behave, what builder UI they use, and how they're processed.

## Available Types

| Type | Description | Special Features |
|------|-------------|------------------|
| `food` | Standard food items | Modifiers, courses |
| `drinks` | Non-alcoholic beverages | Quick add |
| `liquor` | Alcoholic beverages | Pour sizes, recipes |
| `entertainment` | Timed rentals | Timer, session |
| `combos` | Combo meals | Component selection |
| `retail` | Retail products | Inventory, SKU |

## Food Category

### Features
- Standard item builder
- Modifier groups
- Course assignment
- Kitchen routing

### Item Builder
1. Click item
2. Select modifiers
3. Add special instructions
4. Add to order

## Drinks Category

### Features
- Quick add (no modifiers usually)
- Bar routing
- Size options

### Item Builder
- Simple add for most drinks
- Optional modifier groups

## Liquor Category

### Features
- Pour size selection
- Spirit modifiers (upgrades)
- Recipe ingredients
- Bar routing

### Item Builder
1. Select item (e.g., "Margarita")
2. Choose pour size (if applicable)
3. Select spirit upgrades
4. Add modifiers
5. Add to order

See `liquor-builder.md` for full details.

## Entertainment Category

### Features
- Timed sessions
- Block time pricing
- Timer controls
- Waitlist integration

### Item Builder
1. Select item (e.g., "Pool Table 1")
2. Auto-starts timer on send
3. Timer shown in order
4. Stop/extend controls

See `entertainment-sessions.md` for full details.

## Combos Category

### Features
- Component selection
- Price calculation
- Upsell tracking

### Item Builder
1. Select combo (e.g., "Burger Combo")
2. Choose entree
3. Choose side
4. Choose drink
5. Calculated price

See `combo-meals.md` for full details.

## Retail Category

### Features
- SKU tracking
- Inventory management
- No kitchen routing

### Item Builder
- Quick add
- Quantity selection
- Inventory decremented

## Conditional Item Builders (Skill 87)

System automatically shows appropriate builder based on:
1. Category type
2. Item configuration
3. Modifier requirements

### Builder Selection Logic
```
If itemType === 'combo' → ComboBuilder
If itemType === 'timed_rental' → EntertainmentBuilder
If category.categoryType === 'liquor' → LiquorBuilder
If item has required modifiers → ModifierBuilder
Else → QuickAdd
```

## Setting Category Type

### In Admin
1. Go to `/menu`
2. Edit category
3. Select "Category Type"
4. Save

### Via API
```
PUT /api/menu/categories/[id]
{
  "categoryType": "liquor"
}
```

## Database

### Category Model
```prisma
model Category {
  id           String @id
  locationId   String
  name         String
  categoryType String @default("food")
  // food, drinks, liquor, entertainment, combos, retail
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(pos)/orders/page.tsx` | Builder selection logic |
| `src/components/modifiers/ModifierModal.tsx` | Standard builder |
| `src/components/combos/ComboBuilderModal.tsx` | Combo builder |
| `src/components/liquor/LiquorBuilderModal.tsx` | Liquor builder |
| `src/components/entertainment/EntertainmentModal.tsx` | Entertainment builder |
