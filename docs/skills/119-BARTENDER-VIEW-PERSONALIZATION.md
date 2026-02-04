# Skill 119: BartenderView Personalization

## Overview

Enhanced personalization options for the BartenderView POS interface, including spirit tier quick selection, pour size buttons, item customization effects, and per-employee settings persistence.

## Features Implemented

### 1. Spirit Tier Quick Selection

Quick buttons on cocktail items for upgrading spirits without opening the full modifier modal.

**UI Components:**
- 3 tier buttons on items with spirit modifiers: Call | Prem | Top
- Clicking tier opens popup with all spirits in that tier
- Each spirit shows name, total price, and upcharge
- Selecting spirit adds item + modifier to order

**Configuration:**
```typescript
const SPIRIT_TIER_CONFIG = {
  call: { label: 'Call', color: 'bg-sky-600' },
  premium: { label: 'Prem', color: 'bg-violet-600' },
  top_shelf: { label: 'Top', color: 'bg-amber-500' },
}
```

**Note:** Well tier excluded as it's the default (no upcharge).

### 2. Pour Size Buttons

Quick pour selection for liquor items with cohesive teal color gradient.

**Configuration:**
```typescript
const POUR_SIZE_CONFIG = {
  shot: { label: 'Shot', short: '1x', color: 'bg-teal-700' },
  double: { label: 'Dbl', short: '2x', color: 'bg-teal-600' },
  tall: { label: 'Tall', short: '1.5x', color: 'bg-teal-500' },
  short: { label: 'Shrt', short: '.75x', color: 'bg-teal-800' },
}
```

### 3. Scrolling vs Pagination Toggle

User preference for how menu items display in the items grid.

**Settings Location:** Items Edit Panel → "Item Display" section

**Options:**
- `useScrolling: false` - Traditional pagination with page numbers
- `useScrolling: true` - Continuous scrolling with hidden scrollbars

### 4. Hidden Scrollbars

CSS utility for clean appearance on tabs list and items grid.

**CSS Classes:**
```css
.scrollbar-hide {
  -ms-overflow-style: none;  /* IE and Edge */
  scrollbar-width: none;     /* Firefox */
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;  /* Chrome, Safari, Opera */
}
```

### 5. Subtle Items Button

Long-press activation for accessing item customization settings.

**Behavior:**
- Button appears minimal/transparent until hover
- Requires 500ms press-and-hold to activate
- Prevents accidental opens during busy service

### 6. Item Customization Effects

Per-item visual customization stored per employee.

**Available Options:**
```typescript
interface ItemCustomization {
  backgroundColor?: string
  textColor?: string
  highlight?: 'none' | 'glow' | 'border' | 'larger'
  fontStyle?: 'normal' | 'bold' | 'italic' | 'boldItalic'
  fontFamily?: 'default' | 'rounded' | 'mono' | 'serif' | 'handwritten'
  glowColor?: string
  borderColor?: string
  effect?: 'none' | 'pulse' | 'shimmer' | 'rainbow' | 'neon'
}
```

**CSS Animations:**
- `effect-pulse` - Gentle size/opacity pulsing
- `effect-shimmer` - Horizontal light sweep
- `effect-rainbow` - Cycling border colors
- `effect-neon` - Flickering neon sign effect

### 7. Per-Employee Settings Persistence

All BartenderView settings stored per employee in localStorage.

**Storage Key:** `bartender_item_settings_${employeeId}`

**Persisted Data:**
- Item display settings (pagination/scrolling, items per page)
- Per-item customizations (colors, effects, fonts)
- Category order preferences
- Category color customizations

## API Changes

**`GET /api/menu/items`** now returns:
```typescript
{
  spiritTiers: {
    well: [{ id, name, price }],
    call: [{ id, name, price }],
    premium: [{ id, name, price }],
    top_shelf: [{ id, name, price }],
  } | null
}
```

## Files Modified

| File | Changes |
|------|---------|
| `src/components/bartender/BartenderView.tsx` | Spirit tier buttons, pour buttons, scrolling toggle, item effects |
| `src/app/globals.css` | Animation keyframes, scrollbar-hide utility |
| `src/app/api/menu/items/route.ts` | Returns spiritTiers grouped by tier |

## Dependencies

- Skill 118: Spirit Tier Admin (for configuring spirit groups)
- Employee authentication (for per-employee storage key)

## Status: DONE

Implemented 2026-01-31
