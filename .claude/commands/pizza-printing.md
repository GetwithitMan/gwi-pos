# Pizza Kitchen Ticket Printing (Skill 103)

## Overview

Specialized print settings for pizza kitchen tickets. Supports sectional toppings, size/crust display, two-color printing, and live preview of ticket appearance.

## Admin Location

`/pizza` → Settings tab → Pizza Print Settings

## Features

### Live Preview
- Real-time preview of ticket appearance
- Updates instantly as settings change
- Shows red text for two-color printer items
- Side-by-side layout: settings left, preview right

### Red Ribbon Support (TM-U220)
Configure which elements print in red:
- RESEND banner
- NO Items (allergies)
- Allergy warnings
- Special notes
- Headers
- Section headers
- Modifiers/toppings
- EXTRA items
- LIGHT items
- Item names

### Text Sizing
All sizes: `small`, `normal`, `large`, `xlarge`
- Header size (KITCHEN, order number)
- Item name size
- Modifier/topping size
- Section header size
- Notes size

### Preset Configurations
- **Standard** - Default balanced settings
- **Compact** - Minimal spacing, smaller text
- **High Visibility** - Larger text, more red highlights
- **Impact Printer** - Optimized for TM-U220

## Priority System

Pizza Print Settings override Printer Settings:
```typescript
// Priority: Pizza Settings > Printer Settings > Defaults
const headerSize = pizzaSettings.textSizing?.headerSize
  ?? printerSettings.textSizing.headerSize
  ?? 'large'
```

## Ticket Content

### Header Section
```
KITCHEN
** RESEND **  (if resend)
#11
DINE IN
Table 1
Server: Brian The Boss
3:13:15 PM
------------------------
```

### Pizza Details
```
1X BUILD YOUR OWN
LARGE (14")
  THIN CRUST
  MARINARA SAUCE
  MOZZARELLA CHEESE
```

### Sectional Toppings
```
[WHOLE]
  PEPPERONI
[1/6-1]
  BACON
  MUSHROOMS
  GRILLED CHICKEN
  STEAK
[1/6-2]
  MUSHROOMS
  GRILLED CHICKEN
  STEAK
[1/6-3]
  GRILLED CHICKEN
  STEAK
...
```

## Section Labels

| Format | Example Labels |
|--------|----------------|
| `full` | LEFT HALF, RIGHT HALF, 1/6-1 |
| `abbreviated` | L, R, 1/6-1 |
| `numbered` | 1/2, 2/2, 1/6-1 |

## Section Order
1. WHOLE
2. LEFT HALF, RIGHT HALF
3. TOP LEFT, TOP RIGHT, BOTTOM LEFT, BOTTOM RIGHT
4. 1/6-1 through 1/6-6

## Sectional Topping Logic

Toppings that span multiple sections appear in each applicable section:

**Example:** Steak on 1/6-1 through 1/6-5
- Sections array: `[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]`
- Appears in: 1/6-1, 1/6-2, 1/6-3, 1/6-4, 1/6-5
- Does NOT appear in: 1/6-6

## Database Models

### PizzaConfig
```prisma
model PizzaConfig {
  id           String @id @default(cuid())
  locationId   String @unique
  printerIds   Json   // String[] - printers for pizza items
  printSettings Json? // PizzaPrintSettings object
}
```

### OrderItemPizza
```prisma
model OrderItemPizza {
  sizeId       String
  crustId      String
  sauceId      String?
  sauceAmount  String  @default("regular")
  cheeseId     String?
  cheeseAmount String  @default("regular")
  toppingsData Json    // { toppings, sauces, cheeses with sections }
  cookingInstructions String?
  cutStyle     String?
}
```

## API Integration

Kitchen print includes pizza relations:
```typescript
pizzaData: {
  include: {
    size: { select: { name: true, inches: true } },
    crust: { select: { name: true } },
    sauce: { select: { name: true } },
    cheese: { select: { name: true } },
  },
}
```

## Style Options

All style dropdowns include red options:
- `bold`
- `caps`
- `underline`
- `boxed`
- `inverted`
- `red`
- `red-bold`
- `red-inverted`

## Key Files

- `src/app/api/print/kitchen/route.ts` - Kitchen ticket generation
- `src/types/pizza-print-settings.ts` - PizzaPrintSettings type
- `src/components/hardware/PizzaPrintSettingsEditor.tsx` - Settings UI with preview
- `src/app/api/pizza/config/route.ts` - Pizza config API

## Troubleshooting

### Missing Sections
- Check if topping's sections array includes indices for that section
- Section indices: 1/6-1 = [0-3], 1/6-2 = [4-7], etc.

### Text Cutoff
- Double-width halves available characters
- Use TALL (height only) for section headers

### Missing Size/Crust
- Ensure pizzaData relation includes size/crust in query
- Check OrderItemPizza has sizeId and crustId set
