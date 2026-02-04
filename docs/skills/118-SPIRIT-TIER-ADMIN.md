# Skill 118: Spirit Tier Admin Management

## Overview

Admin UI for managing spirit upgrade groups in the Modifiers page. Allows admins to mark modifier groups as "spirit groups" and assign tier levels (Well, Call, Premium, Top Shelf) to each modifier.

## Problem Solved

Previously, spirit tiers could only be configured via seed data. Admins had no way to:
1. Create new spirit upgrade groups
2. Mark existing modifier groups as spirit groups
3. Assign spirit tiers to individual modifiers
4. View which modifiers belong to which tier

## Implementation

### UI Changes (`/modifiers` Page)

**Spirit Group Toggle**
```
[x] Spirit Upgrade Group
    Enable tier-based spirit selection (Well, Call, Premium, Top Shelf)
```

When enabled, shows:
- Amber banner explaining how spirit groups work
- Tier preview badges: Well | Call | Premium | Top Shelf

**Modifier Tier Selection**
Each modifier in a spirit group shows 4 tier buttons:
- **Well** (gray #71717a) - House/default option
- **Call** (sky blue #0ea5e9) - Mid-tier brands
- **Premium** (violet #8b5cf6) - Premium brands
- **Top Shelf** (amber #f59e0b) - Top shelf brands

### Visual Indicators

**Sidebar Listing**
- Spirit groups show 🥃 emoji indicator
- Info shows "Spirit Group: Yes/No"

**Selected Group Detail**
- Spirit group banner with explanation
- Each modifier displays tier badge with color

### API Updates

**GET `/api/menu/modifiers`**
Returns `isSpiritGroup` and `spiritTier` for each modifier.

**GET `/api/menu/modifiers/[id]`**
Now includes:
```typescript
{
  isSpiritGroup: boolean,
  spiritConfig: {
    spiritCategoryId: string,
    spiritCategoryName: string,
    upsellEnabled: boolean,
    upsellPromptText: string,
    defaultTier: string,
  } | null,
  modifiers: [{
    spiritTier: 'well' | 'call' | 'premium' | 'top_shelf' | null,
    linkedBottleProductId: string | null,
    linkedBottleProduct: {...} | null,
  }]
}
```

**POST `/api/menu/modifiers`**
Accepts `isSpiritGroup` and `spiritTier` for modifiers.

**PUT `/api/menu/modifiers/[id]`**
Updates `isSpiritGroup` and `spiritTier` fields.

### Database Fields

**ModifierGroup**
- `isSpiritGroup: Boolean` - Marks group as spirit upgrade group

**Modifier**
- `spiritTier: String` - 'well', 'call', 'premium', 'top_shelf'

## Usage

### Creating a Spirit Group

1. Go to `/modifiers` admin page
2. Click "+ New Modifier Group" or edit existing
3. Check "Spirit Upgrade Group" checkbox
4. For each modifier:
   - Enter name (e.g., "Patron Silver")
   - Enter upcharge price
   - Click the appropriate tier button (Well/Call/Premium/Top)
5. Save

### How It Works in POS

1. Cocktail item has spirit upgrade group linked
2. Bartender adds cocktail to order
3. ModifierModal shows tier buttons: Call | Premium | Top
4. Clicking tier shows all options in that tier
5. Bartender taps desired spirit
6. Item added with spirit modifier and upcharge

## Files Modified

| File | Changes |
|------|---------|
| `src/app/(admin)/modifiers/page.tsx` | Spirit group toggle, tier selection UI, visual indicators |
| `src/app/api/menu/modifiers/route.ts` | POST accepts isSpiritGroup, spiritTier |
| `src/app/api/menu/modifiers/[id]/route.ts` | GET/PUT return and save spirit fields |

## Dependencies

- Skill 04: Modifiers (base modifier system)
- Schema: `isSpiritGroup` on ModifierGroup, `spiritTier` on Modifier

## Status: DONE

Implemented 2026-01-31
