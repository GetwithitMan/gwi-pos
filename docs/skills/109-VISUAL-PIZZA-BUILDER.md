---
skill: 109
title: Visual Pizza Builder
status: DONE
depends_on: []
---

# Skill 109: Visual Pizza Builder

> **Status:** DONE
> **Dependencies:** None
> **Last Updated:** 2026-01-30

## Overview

Two-mode pizza ordering system that balances speed and visual appeal:

1. **Quick Mode** (default) - Fast, simple interface for 80% of orders
2. **Visual Mode** - Full visual builder with SVG pizza canvas for specialty shops

## Mode Comparison

| Feature | Quick Mode | Visual Mode |
|---------|------------|-------------|
| Speed | 3-tap minimum | More deliberate |
| Layout | Single screen | 3-column with visual |
| Half & Half | Toggle + left/right buttons | Tap sections on pizza |
| Sections | Whole or Half | Whole/Half/Quarter/Sixth/Eighth |
| Target | High-volume, fast service | Pizza specialists, WOW factor |

## Configuration

### PizzaConfig Settings

```typescript
{
  builderMode: 'quick' | 'visual' | 'both',  // Which modes available
  defaultBuilderMode: 'quick' | 'visual',     // Which opens by default
  allowModeSwitch: boolean                     // Can servers switch?
}
```

### Location Examples

| Location Type | builderMode | defaultBuilderMode | allowModeSwitch |
|---------------|-------------|-------------------|-----------------|
| Fast casual pizza | quick | quick | false |
| Premium pizzeria | visual | visual | false |
| Hybrid restaurant | both | quick | true |

## Quick Mode Features

### Single-Screen Layout

```
┌─────────────────────────────────────────────────┐
│  SIZE:  [S] [M] [L] [XL]                        │
│  CRUST: [Thin] [Hand] [Deep] [Stuffed]          │
├─────────────────────────────────────────────────┤
│  [ ] Half & Half    [Left Half] [Right Half]    │
├─────────────────────────────────────────────────┤
│  TOPPINGS: [Meats] [Veggies] [Cheese] [Premium] │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐               │
│  │Pepp │ │Saus │ │Bacon│ │Ham  │ ...           │
│  └─────┘ └─────┘ └─────┘ └─────┘               │
├─────────────────────────────────────────────────┤
│  Large Hand-Tossed - Pepperoni, Mushroom        │
│  Total: $18.99                    [ADD TO ORDER]│
└─────────────────────────────────────────────────┘
```

### Key UX Principles

1. **Size/Crust always visible** at top
2. **Topping categories** as tabs for organization
3. **Big tap targets** (44px+ minimum)
4. **Half & Half toggle** - not a mode switch
5. **Real-time price updates**
6. **3-tap minimum** for simple pizza (Size → Topping → Add)

### Half & Half Flow

```
1. Check "Half & Half" checkbox
2. Select active half (Left/Right buttons)
3. Tap toppings - applied to active half
4. Switch halves, tap more toppings
5. Toppings show L/R badges when split
```

## Visual Mode Features

### 3-Column Layout

```
┌─────────────────────────────────────────────────┐
│  [Quick Mode]                    $22.99         │
├───────────────────┬─────────────────────────────┤
│ SIZE              │         SVG PIZZA           │
│ [S] [M] [L]       │      ┌─────────┐            │
│                   │     /   LEFT   \            │
│ CRUST             │    │    🍕    │             │
│ [Thin] [Thick]    │     \  RIGHT  /             │
│                   │      └───────┘              │
│ SAUCE             │  Sections: [1] [2] [4] [8]  │
│ [Marinara]        │                             │
│                   │  Section summary boxes...   │
│ CHEESE            ├─────────────────────────────┤
│ [Mozzarella]      │ TOPPINGS                    │
│                   │ [Meats] [Veggies] [Premium] │
│                   │ ┌────┐ ┌────┐ ┌────┐       │
│                   │ │Pepp│ │Mush│ │Onion│      │
│                   │ └────┘ └────┘ └────┘       │
└───────────────────┴─────────────────────────────┘
```

### Section Modes

| Mode | Sections | Use Case |
|------|----------|----------|
| Whole | 1 | Default, simple |
| Half | 2 | Half & half |
| Quarter | 4 | Different quadrants |
| Sixth | 6 | By-the-slice shops |
| Eighth | 8 | Maximum customization |

### Visual Pizza Canvas

- SVG-based interactive pizza graphic
- Tappable section areas
- Topping names displayed on pizza
- Section highlighting when selected
- Color-coded by topping category

## Files

| File | Purpose |
|------|---------|
| `src/components/pizza/PizzaBuilderModal.tsx` | Container that switches modes |
| `src/components/pizza/PizzaQuickBuilder.tsx` | Quick mode component |
| `src/components/pizza/PizzaVisualBuilder.tsx` | Visual mode component |
| `src/components/pizza/use-pizza-order.ts` | Shared state hook |
| `src/components/pizza/index.ts` | Barrel exports |
| `src/app/api/pizza/config/route.ts` | Config API |

## Data Structure

### PizzaOrderConfig

```typescript
interface PizzaOrderConfig {
  sizeId: string
  crustId: string
  sauceId: string | null
  cheeseId: string | null
  sauceAmount: 'none' | 'light' | 'regular' | 'extra'
  cheeseAmount: 'none' | 'light' | 'regular' | 'extra'
  sauces: SauceSelection[]      // Sectional sauce data
  cheeses: CheeseSelection[]    // Sectional cheese data
  toppings: PizzaToppingSelection[]
  specialNotes?: string
  totalPrice: number
  priceBreakdown: PriceBreakdown
}
```

### Topping Selection

```typescript
interface PizzaToppingSelection {
  toppingId: string
  name: string
  sections: number[]           // Which sections have this topping
  amount: 'light' | 'regular' | 'extra'
  price: number               // Calculated price
  basePrice: number           // Original topping price
}
```

## API Updates

### GET/PATCH /api/pizza/config

New fields added:

```json
{
  "builderMode": "both",
  "defaultBuilderMode": "quick",
  "allowModeSwitch": true
}
```

## Admin Configuration

In `/admin/pizza` (or `/pizza` settings):

```
Builder Mode Settings
─────────────────────
Builder Mode:     ( ) Quick Only  ( ) Visual Only  (•) Both
Default Mode:     (•) Quick       ( ) Visual
Allow Switching:  [✓] Servers can switch between modes
```

## Pricing Modes

Both builders support three pricing modes:

| Mode | Description | Example |
|------|-------------|---------|
| `fractional` | Coverage % = price % | Half pizza = 50% topping price |
| `flat` | Any coverage = full price | Half pizza = 100% topping price |
| `hybrid` | Custom percentages | Half = 60%, quarter = 35%, etc. |

## Topping Categories

```typescript
const CATEGORY_CONFIG = {
  meat: { color: '#dc2626', icon: '🥩', label: 'Meats' },
  veggie: { color: '#16a34a', icon: '🥬', label: 'Veggies' },
  cheese: { color: '#ca8a04', icon: '🧀', label: 'Cheese' },
  premium: { color: '#7c3aed', icon: '⭐', label: 'Premium' },
  seafood: { color: '#0891b2', icon: '🦐', label: 'Seafood' },
  standard: { color: '#525252', icon: '🍕', label: 'Other' },
}
```

## Database Schema

```prisma
model PizzaConfig {
  // ... existing fields ...

  // Builder mode settings (Skill 109)
  builderMode        String  @default("both")
  defaultBuilderMode String  @default("quick")
  allowModeSwitch    Boolean @default(true)
}
```

## Related Skills

| Skill | Relation |
|-------|----------|
| 108 | Pizza Print Settings - Kitchen ticket formatting |
| 14 | Order Splitting - Split pizzas by item |

## Testing Checklist

### Quick Mode

- [ ] Size selection updates price
- [ ] Crust selection works
- [ ] Half & Half toggle works
- [ ] Left/Right half selection works
- [ ] Toppings add to correct half
- [ ] Topping badges show L/R correctly
- [ ] Category tabs filter toppings
- [ ] Price calculates correctly
- [ ] Special notes save
- [ ] Add to Order creates correct config

### Visual Mode

- [ ] Section mode buttons (1/2/4/6/8) work
- [ ] Pizza canvas responds to taps
- [ ] Toppings appear on pizza visual
- [ ] Section highlighting works
- [ ] Summary boxes update correctly
- [ ] Price calculates correctly

### Mode Switching

- [ ] Mode switch button appears when allowed
- [ ] Switch preserves selections (size, crust)
- [ ] Switch to Quick mode converts toppings
- [ ] Config controls available modes
- [ ] Config controls default mode
- [ ] Config controls switch permission

### Integration

- [ ] PizzaBuilderModal loads correct default mode
- [ ] Editing existing pizza loads correctly
- [ ] Specialty pizzas apply their toppings
- [ ] OrderItemPizza created correctly
- [ ] KDS displays pizza details correctly
