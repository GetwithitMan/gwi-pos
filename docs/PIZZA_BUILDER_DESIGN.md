# GWI POS Pizza Builder - Complete Design Document

## Executive Summary

This document outlines the design for an industry-leading pizza builder module for GWI POS. The system supports:
- **Up to 8 sectional toppings** (whole, halves, quarters, or 8 slices)
- **Two modes**: Full custom builder + Quick specialty pizza editor
- **Fewest clicks philosophy**: Most orders complete in 3-5 taps
- **Glassmorphism UI**: Consistent with existing POS design
- **Smart pricing**: Automatic fractional topping pricing

---

## Research Summary

### Industry Leaders Analyzed
- [LINGA POS](https://www.lingapos.com/restaurant/pizzeria) - Half/quarter builds with smart modifiers
- [Quantic Pizza](https://getquantic.com/pizza-builder/) - Auto-creates Left/Right/Whole modifier groups
- [Lavu](https://lavu.com/the-1-pos-system-for-pizza-restaurants-in-city-name/) - Powers Little Caesars & Papa John's
- [VouchPOS](https://vouchpos.com/pizza-pos-system/) - Claims 12-second ordering vs 3+ minutes
- [HungerRush](https://pos.hungerrush.com/pizza-point-of-sale-system) - Seamless complex pizza orders
- [Rezku](https://rezku.com/restaurant-pos/pizza) - Build-your-own with smart automatic pricing

### Key Industry Features
1. **Sectional Toppings**: Half, quarter, or full pizza coverage
2. **Smart Pricing**: Toppings priced by percentage of pie covered
3. **Visual Builder**: Drag-and-drop or tap-based pizza visualization
4. **Specialty Pizzas**: Pre-built with quick modification
5. **Size/Crust Multipliers**: Price scales with size selection
6. **Cooking Instructions**: Well done, light bake, cut style, etc.

### UX Best Practices (from [Agente Studio](https://agentestudio.com/blog/design-principles-pos-interface))
- Eliminate cognitive load - no redundant UI elements
- KISS principle - minimal steps per action
- Avoid decorative animations - only informative feedback
- Clear, intuitive icons to minimize errors
- Staff work under time pressure - speed is critical

---

## Architecture Design

### New Database Models

```prisma
// New category type for pizzas
// categoryType: 'pizza' (add to existing enum)

model PizzaConfig {
  id                  String   @id @default(cuid())
  locationId          String
  location            Location @relation(fields: [locationId], references: [id])

  // Sectional settings
  maxSections         Int      @default(8)  // Max sections: 1 (whole), 2 (halves), 4 (quarters), 8 (eighths)
  defaultSections     Int      @default(2)  // Default view (halves)
  sectionOptions      Json     @default("[1, 2, 4, 8]")  // Available section modes

  // Pricing strategy (FRACTIONAL is the default and recommended)
  pricingMode         String   @default("fractional")
  // "fractional" (DEFAULT): coverage% = price% (half = 50%, quarter = 25%, eighth = 12.5%)
  //    - Most fair for customers, industry standard (Domino's, Papa John's)
  //    - Encourages upselling: "just $1 more for the whole pizza!"
  // "flat": any coverage = full topping price (higher margin, simpler)
  // "hybrid": custom percentages per coverage level
  hybridPricing       Json?    // Only used if pricingMode="hybrid": { "whole": 1.0, "half": 0.6, ... }

  // Free toppings system
  freeToppingsEnabled Boolean  @default(false)
  freeToppingsCount   Int      @default(0)   // Number of free toppings (0 = none free)
  freeToppingsMode    String   @default("per_pizza")  // "per_pizza" | "per_size"
  // per_pizza: same free count regardless of size
  // per_size: different free count per size (configured in PizzaSize)

  // Extra topping charges (after free toppings exhausted)
  extraToppingPrice   Decimal? // Override price for toppings after free ones (null = use topping's own price)

  // Display settings
  showVisualBuilder   Boolean  @default(true)  // Toggle for visual pizza graphic
  showToppingList     Boolean  @default(true)  // Show list view of toppings
  defaultToListView   Boolean  @default(false) // Start in list view instead of visual

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([locationId])
}

model PizzaSize {
  id                String   @id @default(cuid())
  locationId        String
  location          Location @relation(fields: [locationId], references: [id])

  name              String   // "Small", "Medium", "Large", "XL"
  displayName       String?  // "10\"", "12\"", "14\"", "18\""
  inches            Int?     // Diameter in inches
  slices            Int      @default(8)  // Number of slices
  basePrice         Decimal  // Base price for cheese pizza this size
  priceMultiplier   Decimal  @default(1.0)  // 1.0 for base, 1.5 for large, etc.
  toppingMultiplier Decimal  @default(1.0)  // Topping price multiplier for this size

  // Free toppings per size (when freeToppingsMode = "per_size")
  freeToppings      Int      @default(0)   // Number of free toppings for this size

  sortOrder         Int      @default(0)
  isDefault         Boolean  @default(false)
  isActive          Boolean  @default(true)

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([locationId])
}

model PizzaCrust {
  id             String   @id @default(cuid())
  locationId     String
  location       Location @relation(fields: [locationId], references: [id])

  name           String   // "Hand Tossed", "Thin", "Deep Dish", "Stuffed"
  displayName    String?
  price          Decimal  @default(0)  // Upcharge for specialty crusts
  isDefault      Boolean  @default(false)
  isActive       Boolean  @default(true)
  sortOrder      Int      @default(0)

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([locationId])
}

model PizzaSauce {
  id             String   @id @default(cuid())
  locationId     String
  location       Location @relation(fields: [locationId], references: [id])

  name           String   // "Marinara", "White", "BBQ", "Buffalo", "No Sauce"
  displayName    String?
  price          Decimal  @default(0)
  isDefault      Boolean  @default(false)
  isActive       Boolean  @default(true)
  sortOrder      Int      @default(0)

  // Sauce amount options
  allowLight     Boolean  @default(true)
  allowExtra     Boolean  @default(true)
  extraPrice     Decimal  @default(0)

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([locationId])
}

model PizzaCheese {
  id             String   @id @default(cuid())
  locationId     String
  location       Location @relation(fields: [locationId], references: [id])

  name           String   // "Mozzarella", "No Cheese", "Extra Cheese", "Vegan"
  displayName    String?
  price          Decimal  @default(0)
  isDefault      Boolean  @default(false)
  isActive       Boolean  @default(true)
  sortOrder      Int      @default(0)

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([locationId])
}

model PizzaTopping {
  id             String   @id @default(cuid())
  locationId     String
  location       Location @relation(fields: [locationId], references: [id])

  name           String   // "Pepperoni", "Mushrooms", "Onions"
  displayName    String?
  category       String   @default("standard")  // "meat", "veggie", "premium", "cheese"
  price          Decimal  // Base price for whole pizza
  extraPrice     Decimal? // Price for "extra" (2x)
  isActive       Boolean  @default(true)
  sortOrder      Int      @default(0)

  // Visual
  color          String?  // Hex color for visual builder
  iconUrl        String?  // Optional icon

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([locationId])
}

model PizzaSpecialty {
  id             String   @id @default(cuid())
  locationId     String
  location       Location @relation(fields: [locationId], references: [id])
  menuItemId     String   @unique  // Links to MenuItem with itemType="pizza"
  menuItem       MenuItem @relation(fields: [menuItemId], references: [id])

  // Default configuration
  defaultCrustId  String?
  defaultSauceId  String?
  defaultCheeseId String?
  sauceAmount     String   @default("regular")  // "none", "light", "regular", "extra"
  cheeseAmount    String   @default("regular")

  // Pre-selected toppings (JSON array)
  // [{ toppingId: "...", coverage: "whole", amount: "regular" }, ...]
  toppings        Json     @default("[]")

  // Allow modifications?
  allowSizeChange   Boolean @default(true)
  allowCrustChange  Boolean @default(true)
  allowSauceChange  Boolean @default(true)
  allowCheeseChange Boolean @default(true)
  allowToppingMods  Boolean @default(true)  // Add/remove toppings

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([locationId])
}

// Order item extension for pizza orders
model OrderItemPizza {
  id              String    @id @default(cuid())
  orderItemId     String    @unique
  orderItem       OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Cascade)

  // Selections
  sizeId          String
  crustId         String
  sauceId         String?
  cheeseId        String?
  sauceAmount     String    @default("regular")
  cheeseAmount    String    @default("regular")

  // Sectional toppings (JSON)
  // {
  //   "toppings": [
  //     { "toppingId": "...", "name": "Pepperoni", "sections": [0,1,2,3,4,5,6,7], "amount": "regular", "price": 2.50 },
  //     { "toppingId": "...", "name": "Mushrooms", "sections": [0,1,2,3], "amount": "regular", "price": 1.25 }
  //   ]
  // }
  toppingsData    Json      @default("{}")

  // Cooking instructions
  cookingInstructions String?  // "well done", "light bake", etc.
  cutStyle            String?  // "normal", "square", "uncut"

  // Pricing snapshot
  sizePrice       Decimal
  crustPrice      Decimal
  saucePrice      Decimal
  cheesePrice     Decimal
  toppingsPrice   Decimal

  createdAt       DateTime  @default(now())

  @@index([orderItemId])
}
```

### Category Type Extension

Add `pizza` to the existing category types:
```typescript
categoryType: 'food' | 'drinks' | 'liquor' | 'entertainment' | 'combos' | 'pizza'
```

When a category has `categoryType: 'pizza'`, clicking any item in that category opens the Pizza Builder instead of the standard Modifier Modal.

---

## UI/UX Design

### Component Hierarchy

```
PizzaBuilderModal (main container)
├── PizzaBuilderHeader
│   ├── Item name + base price
│   └── Running total
├── PizzaBuilderTabs (for custom mode)
│   ├── "Quick" tab (specialty pizza quick-edit)
│   └── "Custom" tab (full builder)
├── PizzaSizeSelector (prominent, first choice)
├── PizzaCrustSelector
├── PizzaSauceSelector
├── PizzaCheeseSelector
├── PizzaToppingSelector
│   ├── SectionToggle (whole/halves/quarters/8ths)
│   ├── VisualPizzaBuilder (interactive pizza graphic)
│   └── ToppingGrid (categorized topping buttons)
├── CookingInstructions
└── PizzaBuilderFooter
    ├── Total price
    └── Add to Order / Update
```

### Mode 1: Specialty Pizza (Quick Edit)

For pre-designed pizzas (Pepperoni, Supreme, Meat Lovers, etc.):

```
┌─────────────────────────────────────────────────────┐
│  PEPPERONI PIZZA                    Total: $18.99  │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  SIZE        ○ SM $12  ● MED $16  ○ LG $20  ○ XL   │
│              ──────────────────────────────────────  │
│                                                     │
│  CRUST       ● Regular  ○ Thin  ○ Deep +$2         │
│              ──────────────────────────────────────  │
│                                                     │
│  INCLUDED:   ✓ Pepperoni (whole)                   │
│              ───────────────────────                │
│              [- Remove] [Half Only] [Extra +$2]    │
│                                                     │
│  ADD MORE TOPPINGS?  [+ Add Toppings...]           │
│                                                     │
│  SPECIAL:    [Well Done] [Light Bake] [Square Cut] │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  [Cancel]                          [Add to Order]  │
└─────────────────────────────────────────────────────┘
```

**Key Features:**
- Size prominently displayed first (biggest price impact)
- Pre-selected toppings shown with quick modify options
- One-tap: Remove, Make Half, or Extra
- "+ Add Toppings" expands to full topping selector
- 3-5 taps for most orders

### Mode 2: Custom Pizza Builder (Full) - Visual Mode

For build-your-own pizzas with interactive visual:

```
┌─────────────────────────────────────────────────────┐
│  BUILD YOUR PIZZA                   Total: $21.50  │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  [SIZE: Large $20]  [CRUST: Hand Tossed]           │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  [Sauce: Marinara ▼]  [Cheese: Mozzarella ▼]       │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  TOPPINGS  [1][2][4][8]        [🍕 Visual | ☰ List]│
│  ┌─────────────────────────────────────────────┐   │
│  │              ╭─────────╮                    │   │
│  │           ╭──│ 🍕      │──╮                 │   │
│  │          │  L│  HALF   │R  │                │   │
│  │           ╰──│         │──╯                 │   │
│  │              ╰─────────╯                    │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  MEATS        [Pepperoni●] [Sausage] [Bacon]       │
│  VEGGIES      [Mushroom●L] [Onion] [Peppers]       │
│  PREMIUM      [Chicken +$3] [Steak +$4]            │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  SELECTED:    Pepperoni (whole) $2.50              │
│               Mushrooms (left half) $1.25          │
│  ─────────────────────────────────────────────────  │
│  [Cancel]                          [Add to Order]  │
└─────────────────────────────────────────────────────┘
```

### Mode 2: Custom Pizza Builder (Full) - List Mode

For staff who prefer list-only view (toggle to switch):

```
┌─────────────────────────────────────────────────────┐
│  BUILD YOUR PIZZA                   Total: $21.50  │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  [SIZE: Large $20]  [CRUST: Hand Tossed]           │
│  [Sauce: Marinara ▼]  [Cheese: Mozzarella ▼]       │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  TOPPINGS  [1][2][4][8]        [🍕 Visual | ☰ List]│
│  ─────────────────────────────────────────────────  │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ MEATS                                         │ │
│  │ ┌─────────────────────────────────────────┐   │ │
│  │ │ Pepperoni     $2.50  [Whole●][L][R][−]  │   │ │
│  │ │ Sausage       $2.50  [Whole][L][R][−]   │   │ │
│  │ │ Bacon         $2.75  [Whole][L][R][−]   │   │ │
│  │ │ Ham           $2.50  [Whole][L][R][−]   │   │ │
│  │ └─────────────────────────────────────────┘   │ │
│  │ VEGETABLES                                    │ │
│  │ ┌─────────────────────────────────────────┐   │ │
│  │ │ Mushrooms     $1.50  [Whole][L●][R][−]  │   │ │
│  │ │ Onions        $1.50  [Whole][L][R][−]   │   │ │
│  │ │ Green Peppers $1.50  [Whole][L][R][−]   │   │ │
│  │ └─────────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  [Cancel]                          [Add to Order]  │
└─────────────────────────────────────────────────────┘
```

**List Mode Features:**
- Each topping row shows: Name, Price, Coverage buttons, Remove
- Coverage buttons adapt to section mode: [Whole][L][R] or [1][2][3][4] or [1-8]
- Faster for experienced staff who know what they want
- Better for small screens or accessibility needs

**Key Features:**
- Visual pizza shows topping placement
- Section toggle: Whole → Halves → Quarters → 8ths
- Tap topping = add to whole pizza
- Long-press or mode = add to specific section
- Selected toppings list shows coverage and price
- Fractional pricing automatic

### Visual Pizza Component

The interactive pizza graphic:

```
      8-Section View              4-Section View           2-Section View

         ╭─────╮                    ╭─────╮                  ╭─────╮
       ╱ 0 │ 1 ╲                  ╱   0   ╲                ╱       ╲
      │7   │   2│                │ 3     1 │              │  LEFT   │
      ├────┼────┤                ├─────────┤              ├─────────┤
      │6   │   3│                │ 2     0 │              │  RIGHT  │
       ╲ 5 │ 4 ╱                  ╲   1   ╱                ╲       ╱
         ╰─────╯                    ╰─────╯                  ╰─────╯
```

- Sections are numbered 0-7 (clockwise from top-left)
- Tapping a section while topping is selected adds to that section
- Sections highlight on hover/active
- Color-coded by topping category (meats = red tones, veggies = green tones)

### Section Selection UX

**Tap Behavior (configurable):**
1. **Whole-First Mode** (default): First tap = whole pizza, subsequent taps toggle sections
2. **Section-First Mode**: Each tap toggles individual section, shift+click for whole
3. **Smart Mode**: Tap = whole, long-press opens section picker

**Section Picker Modal:**
```
┌─────────────────────────────────┐
│  Add PEPPERONI to:              │
│  ─────────────────────────────  │
│  [Whole Pizza]                  │
│  ─────────────────────────────  │
│  [Left Half]    [Right Half]    │
│  ─────────────────────────────  │
│  [Q1] [Q2] [Q3] [Q4]            │
│  ─────────────────────────────  │
│  [Custom Sections...]           │
└─────────────────────────────────┘
```

### Topping Grid Design

Glassmorphism buttons matching existing POS style:

```tsx
// Topping button states
const ToppingButton = ({ topping, coverage, isSelected }) => (
  <motion.button
    className={cn(
      // Base glass style
      "px-3 py-2 rounded-xl backdrop-blur-sm border transition-all",
      // Unselected
      !isSelected && "bg-white/60 border-white/40 text-gray-700 hover:bg-white/80",
      // Selected - whole
      isSelected && coverage === 'whole' && "bg-gradient-to-r from-orange-500 to-red-500 text-white border-white/20 shadow-lg",
      // Selected - partial
      isSelected && coverage !== 'whole' && "bg-gradient-to-r from-orange-400 to-orange-500 text-white border-white/20"
    )}
  >
    <span className="font-medium">{topping.name}</span>
    {topping.price > 0 && (
      <span className="ml-1 text-sm opacity-80">+${topping.price}</span>
    )}
    {coverage === 'left' && <span className="ml-1 text-xs">◐</span>}
    {coverage === 'right' && <span className="ml-1 text-xs">◑</span>}
  </motion.button>
)
```

### Pricing Display

Real-time price calculation with breakdown:

```
┌─────────────────────────────────┐
│  PRICE BREAKDOWN                │
│  ─────────────────────────────  │
│  Large Pizza (14")      $20.00  │
│  Deep Dish Crust         +$2.00 │
│  ─────────────────────────────  │
│  Pepperoni (whole)       +$2.50 │
│  Mushrooms (½)           +$1.25 │
│  Bacon (¼)               +$0.88 │
│  Extra Cheese            +$2.00 │
│  ─────────────────────────────  │
│  TOTAL                  $28.63  │
└─────────────────────────────────┘
```

**Pricing Formulas:**

```typescript
// Pricing mode options
type PricingMode = 'fractional' | 'flat' | 'hybrid'

interface HybridPricing {
  whole: number    // e.g., 1.0 (100%)
  half: number     // e.g., 0.6 (60%)
  quarter: number  // e.g., 0.4 (40%)
  eighth: number   // e.g., 0.25 (25%)
}

const calculateToppingPrice = (
  basePrice: number,
  sectionsSelected: number[],
  totalSections: number,
  sizeMultiplier: number,
  pricingMode: PricingMode,
  hybridPricing?: HybridPricing
): number => {
  const coverage = sectionsSelected.length / totalSections

  let priceMultiplier: number

  switch (pricingMode) {
    case 'fractional':
      // Exact coverage percentage
      priceMultiplier = coverage
      break

    case 'flat':
      // Any coverage = full price
      priceMultiplier = sectionsSelected.length > 0 ? 1.0 : 0
      break

    case 'hybrid':
      // Use configured percentages
      if (coverage === 1) priceMultiplier = hybridPricing?.whole ?? 1.0
      else if (coverage >= 0.5) priceMultiplier = hybridPricing?.half ?? 0.6
      else if (coverage >= 0.25) priceMultiplier = hybridPricing?.quarter ?? 0.4
      else priceMultiplier = hybridPricing?.eighth ?? 0.25
      break
  }

  return basePrice * priceMultiplier * sizeMultiplier
}

// Examples (8-section mode, Large 1.25x topping multiplier, $2.00 base):
//
// FRACTIONAL MODE:
// Whole (8/8): $2.00 * 1.00 * 1.25 = $2.50
// Half (4/8):  $2.00 * 0.50 * 1.25 = $1.25
// Quarter (2/8): $2.00 * 0.25 * 1.25 = $0.63
// Eighth (1/8): $2.00 * 0.125 * 1.25 = $0.31
//
// FLAT MODE:
// Any coverage: $2.00 * 1.00 * 1.25 = $2.50
//
// HYBRID MODE (60/40/25):
// Whole: $2.00 * 1.00 * 1.25 = $2.50
// Half:  $2.00 * 0.60 * 1.25 = $1.50
// Quarter: $2.00 * 0.40 * 1.25 = $1.00
// Eighth: $2.00 * 0.25 * 1.25 = $0.63
```

**Free Toppings System:**

```typescript
interface FreeToppingsConfig {
  enabled: boolean
  count: number              // Number of free toppings
  mode: 'per_pizza' | 'per_size'
  extraToppingPrice?: number // Override price after free ones
}

const calculatePizzaTotal = (
  size: PizzaSize,
  crust: PizzaCrust,
  sauce: PizzaSauce,
  cheese: PizzaCheese,
  toppings: PizzaToppingSelection[],
  config: PizzaConfig
): PriceBreakdown => {
  // Base price from size
  let total = Number(size.basePrice)

  // Add crust upcharge
  total += Number(crust.price)

  // Add sauce/cheese if they have prices
  total += Number(sauce.price)
  total += Number(cheese.price)

  // Calculate topping prices with free toppings logic
  const freeToppings = config.freeToppingsMode === 'per_size'
    ? size.freeToppings
    : config.freeToppingsCount

  // Sort toppings by price (highest first) so free applies to cheapest
  // OR sort by order added - configurable behavior
  const sortedToppings = [...toppings].sort((a, b) => b.basePrice - a.basePrice)

  let toppingsCharged = 0
  const toppingDetails: ToppingPriceDetail[] = []

  sortedToppings.forEach((topping, index) => {
    const isFree = index < freeToppings && config.freeToppingsEnabled

    // Calculate price based on coverage
    let toppingPrice = calculateToppingPrice(
      config.extraToppingPrice && !isFree
        ? Number(config.extraToppingPrice)
        : topping.basePrice,
      topping.sections,
      config.maxSections,
      Number(size.toppingMultiplier),
      config.pricingMode as PricingMode,
      config.hybridPricing
    )

    if (isFree) {
      toppingPrice = 0
    }

    toppingsCharged += toppingPrice
    toppingDetails.push({
      name: topping.name,
      coverage: topping.sections.length / config.maxSections,
      basePrice: topping.basePrice,
      finalPrice: toppingPrice,
      isFree,
    })
  })

  total += toppingsCharged

  return {
    sizePrice: Number(size.basePrice),
    crustPrice: Number(crust.price),
    saucePrice: Number(sauce.price),
    cheesePrice: Number(cheese.price),
    toppingsPrice: toppingsCharged,
    toppingDetails,
    freeToppingsUsed: Math.min(freeToppings, toppings.length),
    total,
  }
}
```

**Example: 2-Topping Deal Pricing**

Config: 2 free toppings on Large, $1.50 per extra topping after

```
Large Cheese Pizza           $16.00
+ Pepperoni (whole)          FREE (1 of 2)
+ Mushrooms (half)           FREE (2 of 2)
+ Bacon (whole)              $1.50 (extra)
+ Onions (quarter)           $0.75 (extra, 50% coverage)
─────────────────────────────────────
TOTAL                        $18.25
```

---

## User Flows

### Flow 1: Quick Specialty Pizza (Most Common)

**Scenario:** Customer orders a Large Pepperoni Pizza, well done

```
1. Tap "Pizzas" category
2. Tap "Pepperoni Pizza" → Opens specialty quick-edit modal
3. Tap "LG" size button (already highlighted if default)
4. Tap "Well Done" cooking instruction
5. Tap "Add to Order"

Total taps: 5 (including category)
Time: ~8-12 seconds
```

### Flow 2: Specialty with Modification

**Scenario:** Medium Pepperoni, half pepperoni half mushroom

```
1. Tap "Pizzas" category
2. Tap "Pepperoni Pizza" → Opens quick-edit modal
3. Tap "MED" size
4. Tap "Half Only" on pepperoni row → Changes to left half
5. Tap "+ Add Toppings" → Expands topping grid
6. Tap "Mushrooms" → Adds to whole
7. Modal shows: "Mushrooms added. Make it:" [Whole●] [Left] [Right]
8. Tap "Right" → Now pepperoni left, mushrooms right
9. Tap "Add to Order"

Total taps: 9
Time: ~15-20 seconds
```

### Flow 3: Full Custom Build

**Scenario:** Build-your-own with multiple toppings on different sections

```
1. Tap "Pizzas" category
2. Tap "Build Your Own" → Opens full custom builder
3. Tap "LG" size
4. Tap "Thin" crust
5. Tap section toggle → "Halves"
6. Tap "Pepperoni" → Whole pizza
7. Tap visual pizza LEFT section
8. Tap "Mushrooms" → Adds to left only
9. Tap visual pizza RIGHT section
10. Tap "Sausage" → Adds to right only
11. Tap "Add to Order"

Total taps: 11
Time: ~25-30 seconds
```

### Flow 4: Complex 8-Section Pizza

**Scenario:** 8-section pizza, different topping each section

```
1. Tap "Pizzas" → "Build Your Own"
2. Tap "XL" size
3. Tap section toggle → "8 Sections"
4. For each section (1-8):
   - Tap section on visual pizza
   - Tap desired topping
5. Tap "Add to Order"

Total taps: ~20
Time: ~45-60 seconds
Note: This is a complex order - 45 seconds is excellent for 8 different toppings
```

---

## Component Specifications

### PizzaBuilderModal.tsx

```typescript
interface PizzaBuilderModalProps {
  item: MenuItem
  specialty?: PizzaSpecialty  // If pre-built pizza
  editingItem?: OrderItem     // If editing existing order item
  onConfirm: (pizzaConfig: PizzaOrderConfig) => void
  onCancel: () => void
}

interface PizzaOrderConfig {
  sizeId: string
  crustId: string
  sauceId: string | null
  cheeseId: string | null
  sauceAmount: 'none' | 'light' | 'regular' | 'extra'
  cheeseAmount: 'none' | 'light' | 'regular' | 'extra'
  toppings: PizzaToppingSelection[]
  cookingInstructions?: string
  cutStyle?: string
  specialNotes?: string
  totalPrice: number
}

interface PizzaToppingSelection {
  toppingId: string
  name: string
  sections: number[]  // [0-7] for which sections
  amount: 'regular' | 'extra' | 'light'
  price: number       // Calculated price for this coverage
}
```

### PizzaVisualBuilder.tsx

```typescript
interface PizzaVisualBuilderProps {
  sections: number           // 1, 2, 4, or 8
  toppings: PizzaToppingSelection[]
  selectedSections: number[]  // Currently selected for adding
  onSectionClick: (section: number) => void
  onSectionLongPress: (section: number) => void
  size: 'sm' | 'md' | 'lg'
}

// Visual uses SVG with animated sections
// Each section is a pie slice that can:
// - Highlight on hover
// - Show topping indicators (colored dots or icons)
// - Animate when selected
```

### PizzaToppingGrid.tsx

```typescript
interface PizzaToppingGridProps {
  toppings: PizzaTopping[]
  selectedToppings: PizzaToppingSelection[]
  activeSections: number[]    // Sections being targeted
  onToppingSelect: (topping: PizzaTopping) => void
  onToppingRemove: (toppingId: string) => void
  onToppingModify: (toppingId: string, modification: ToppingModification) => void
  sizeMultiplier: number
}

// Grid organized by category:
// MEATS | VEGGIES | PREMIUM | CHEESE
// Each button shows:
// - Name
// - Price (adjusted for size)
// - Selection indicator (whole/half/quarter/custom)
```

---

## API Endpoints

### Pizza Configuration

```
GET    /api/pizza/config                    # Get location pizza config
PATCH  /api/pizza/config                    # Update pizza config

GET    /api/pizza/sizes                     # Get all sizes
POST   /api/pizza/sizes                     # Create size
PATCH  /api/pizza/sizes/[id]                # Update size
DELETE /api/pizza/sizes/[id]                # Delete size

GET    /api/pizza/crusts                    # Get all crusts
POST   /api/pizza/crusts                    # Create crust
PATCH  /api/pizza/crusts/[id]               # Update crust
DELETE /api/pizza/crusts/[id]               # Delete crust

GET    /api/pizza/sauces                    # Get all sauces
POST   /api/pizza/sauces                    # Create sauce
...

GET    /api/pizza/cheeses                   # Get all cheeses
POST   /api/pizza/cheeses                   # Create cheese
...

GET    /api/pizza/toppings                  # Get all toppings
POST   /api/pizza/toppings                  # Create topping
PATCH  /api/pizza/toppings/[id]             # Update topping
DELETE /api/pizza/toppings/[id]             # Delete topping
POST   /api/pizza/toppings/reorder          # Bulk reorder

GET    /api/pizza/specialties               # Get specialty pizzas
POST   /api/pizza/specialties               # Create specialty
PATCH  /api/pizza/specialties/[id]          # Update specialty
DELETE /api/pizza/specialties/[id]          # Delete specialty
```

### Order Integration

The pizza configuration is stored in `OrderItemPizza` and linked to the standard `OrderItem`. The order flow:

1. Add pizza via PizzaBuilderModal
2. Create `OrderItem` with standard fields (menuItemId, price, quantity)
3. Create linked `OrderItemPizza` with pizza-specific data
4. Store topping selections in JSON for flexibility

---

## Admin Interface

### Pizza Menu Builder Page (`/admin/menu/pizza`)

Tabbed interface:
1. **Sizes** - Manage size options with price multipliers
2. **Crusts** - Manage crust types with upcharges
3. **Sauces** - Manage sauce options
4. **Cheeses** - Manage cheese options
5. **Toppings** - Full topping management with categories
6. **Specialties** - Pre-built pizza configurations

### Topping Management

```
┌─────────────────────────────────────────────────────────────────┐
│  PIZZA TOPPINGS                                    [+ Add New]  │
│  ───────────────────────────────────────────────────────────────│
│                                                                 │
│  MEATS                                                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ☰ Pepperoni        $2.00    Extra: $3.00    [Edit] [×]   │  │
│  │ ☰ Italian Sausage  $2.00    Extra: $3.00    [Edit] [×]   │  │
│  │ ☰ Bacon            $2.50    Extra: $3.75    [Edit] [×]   │  │
│  │ ☰ Ham              $2.00    Extra: $3.00    [Edit] [×]   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  VEGETABLES                                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ☰ Mushrooms        $1.50    Extra: $2.25    [Edit] [×]   │  │
│  │ ☰ Green Peppers    $1.50    Extra: $2.25    [Edit] [×]   │  │
│  │ ☰ Onions           $1.50    Extra: $2.25    [Edit] [×]   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  PREMIUM                                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ☰ Grilled Chicken  $3.50    Extra: $5.25    [Edit] [×]   │  │
│  │ ☰ Steak            $4.00    Extra: $6.00    [Edit] [×]   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Specialty Pizza Builder

```
┌─────────────────────────────────────────────────────────────────┐
│  CREATE SPECIALTY PIZZA                                         │
│  ───────────────────────────────────────────────────────────────│
│                                                                 │
│  Name: [Supreme Pizza_________________]                         │
│  Base Price (Medium): [$18.99_________]                         │
│                                                                 │
│  DEFAULT CRUST:    [Hand Tossed ▼]                              │
│  DEFAULT SAUCE:    [Marinara ▼]  Amount: [Regular ▼]            │
│  DEFAULT CHEESE:   [Mozzarella ▼] Amount: [Regular ▼]           │
│                                                                 │
│  INCLUDED TOPPINGS:                                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Pepperoni      [Whole ▼]  [Regular ▼]           [Remove] │  │
│  │ Sausage        [Whole ▼]  [Regular ▼]           [Remove] │  │
│  │ Mushrooms      [Whole ▼]  [Regular ▼]           [Remove] │  │
│  │ Green Peppers  [Whole ▼]  [Regular ▼]           [Remove] │  │
│  │ Onions         [Whole ▼]  [Regular ▼]           [Remove] │  │
│  │ Black Olives   [Whole ▼]  [Regular ▼]           [Remove] │  │
│  │                                      [+ Add Topping]     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  MODIFICATION OPTIONS:                                          │
│  ☑ Allow size changes                                          │
│  ☑ Allow crust changes                                         │
│  ☑ Allow sauce changes                                         │
│  ☑ Allow cheese changes                                        │
│  ☑ Allow topping modifications                                 │
│                                                                 │
│  [Cancel]                                            [Save]     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Kitchen Display Integration

Pizza orders display with clear section breakdowns:

```
┌─────────────────────────────────────────────────────┐
│  #42 - Table 7                           12:34 PM  │
│  ───────────────────────────────────────────────────│
│                                                     │
│  🍕 LARGE PIZZA (14") - Thin Crust                 │
│     Marinara, Regular Cheese                        │
│     ─────────────────────────────────               │
│     LEFT HALF:                                      │
│       • Pepperoni                                   │
│       • Mushrooms                                   │
│     ─────────────────────────────────               │
│     RIGHT HALF:                                     │
│       • Sausage                                     │
│       • Green Peppers                               │
│     ─────────────────────────────────               │
│     ⚡ WELL DONE                                    │
│                                                     │
│  ───────────────────────────────────────────────────│
│  [Start]                              [Complete]   │
└─────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation (Database + API)
- [ ] Add pizza models to Prisma schema
- [ ] Create database migration
- [ ] Implement pizza CRUD APIs
- [ ] Add `pizza` category type

### Phase 2: Admin Interface
- [ ] Pizza menu builder page
- [ ] Size/crust/sauce/cheese management
- [ ] Topping management with categories
- [ ] Specialty pizza builder

### Phase 3: POS Pizza Builder
- [ ] PizzaBuilderModal component
- [ ] PizzaVisualBuilder (SVG interactive pizza)
- [ ] PizzaToppingGrid component
- [ ] Section selection logic
- [ ] Pricing calculations

### Phase 4: Order Integration
- [ ] OrderItemPizza model
- [ ] Order store updates
- [ ] Order display updates
- [ ] KDS pizza display

### Phase 5: Polish & Optimization
- [ ] Animation refinements
- [ ] Performance optimization
- [ ] Accessibility
- [ ] Mobile touch optimization

---

## Success Metrics

| Metric | Target | Industry Average |
|--------|--------|------------------|
| Specialty pizza order time | < 10 seconds | 30-60 seconds |
| Custom pizza order time | < 30 seconds | 2-3 minutes |
| Half-and-half order time | < 15 seconds | 1-2 minutes |
| Order accuracy | > 99% | ~95% |
| Staff training time | < 15 minutes | 1-2 hours |

---

## Technical Notes

### State Management

Use Zustand for pizza builder state:

```typescript
interface PizzaBuilderStore {
  // Current selections
  size: PizzaSize | null
  crust: PizzaCrust | null
  sauce: PizzaSauce | null
  cheese: PizzaCheese | null
  sauceAmount: string
  cheeseAmount: string
  toppings: PizzaToppingSelection[]

  // UI state
  sectionMode: 1 | 2 | 4 | 8
  activeSections: number[]

  // Actions
  setSize: (size: PizzaSize) => void
  setCrust: (crust: PizzaCrust) => void
  addTopping: (topping: PizzaTopping, sections?: number[]) => void
  removeTopping: (toppingId: string) => void
  modifyTopping: (toppingId: string, modification: ToppingMod) => void
  setSectionMode: (mode: 1 | 2 | 4 | 8) => void
  toggleSection: (section: number) => void
  calculateTotal: () => number
  reset: () => void
}
```

### Performance Considerations

1. **Lazy load pizza data** - Only fetch pizza config when pizza category selected
2. **Memoize price calculations** - Expensive fractional math should be cached
3. **Debounce visual updates** - Rapid section toggles should batch visual updates
4. **Optimistic UI** - Show selections immediately, sync to store async

### Accessibility

1. **Keyboard navigation** - Tab through toppings, Enter to select
2. **Screen reader** - Announce topping selections and coverage
3. **High contrast** - Ensure selected states are clearly visible
4. **Touch targets** - Minimum 44px tap targets on mobile

---

## Design Decisions (Confirmed)

| Question | Decision |
|----------|----------|
| **Section options** | All variations: Whole (1), Halves (2), Quarters (4), Eighths (8) |
| **Topping limit** | Unlimited, but configurable "X free toppings" then charge per extra |
| **Free toppings** | Configurable per location or per size (e.g., "2-topping Large special") |
| **Pricing mode** | **Fractional** (default) - half topping = 50% price, quarter = 25%, etc. |
| **Visual builder** | Toggle available - staff can switch between visual and list-only |
| **Default view** | Configurable per location (visual or list) |

### Fractional Pricing Examples

| Coverage | Sections | Price Calculation | $2 Topping on Large (1.25x) |
|----------|----------|-------------------|----------------------------|
| Whole | 8/8 (100%) | Base × 1.00 × Size | $2.50 |
| Half | 4/8 (50%) | Base × 0.50 × Size | $1.25 |
| Quarter | 2/8 (25%) | Base × 0.25 × Size | $0.63 |
| Eighth | 1/8 (12.5%) | Base × 0.125 × Size | $0.31 |
| Custom (3/8) | 3/8 (37.5%) | Base × 0.375 × Size | $0.94 |

This pricing is intuitive: "Want pepperoni on just one side? That's half price!"

## Open Questions for Implementation

1. **Combo support?** - Pizza + sides + drink combo handling - integrate with existing combo system?
2. **Online ordering?** - Should pizza builder work differently for online vs POS?
3. **Receipt format?** - How detailed should pizza specs be on receipts?

---

## Sources

- [Best Pizza POS Systems 2026 - Owner.com](https://www.owner.com/blog/pizza-pos-system)
- [LINGA Pizza POS](https://www.lingapos.com/restaurant/pizzeria)
- [Quantic Pizza Builder](https://getquantic.com/pizza-builder/)
- [VouchPOS Half-and-Half](https://vouchpos.com/pizza-pos-system/)
- [Lavu Pizza POS](https://lavu.com/the-1-pos-system-for-pizza-restaurants-in-city-name/)
- [HungerRush Features](https://pos.hungerrush.com/pizza-point-of-sale-system)
- [POS Interface Design Principles](https://agentestudio.com/blog/design-principles-pos-interface)
- [UX Pizza App Case Study](https://medium.com/@joshmarston/ux-project-pizza-app-9bd57d04687)
