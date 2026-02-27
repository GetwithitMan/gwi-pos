# Skill 455: Quick Pick Labels for Food Items

**Date:** 2026-02-27
**Status:** DONE

## Overview

Added label-only quick pick buttons for food items (Mild/Medium/Hot/No Spice). Quick picks are non-pricing labels that appear as sub-buttons on POS item cards for kitchen speed. They optionally link to prep items for inventory tracking (e.g., hot sauce usage). Reuses the PricingOptionGroup model with `showAsQuickPick=true` as the discriminator.

## How It Works

Quick picks use the same `PricingOptionGroup` + `PricingOption` models as size variants, differentiated by:

| Field | Size Variant | Quick Pick |
|-------|-------------|------------|
| `showAsQuickPick` | `false` | `true` |
| `price` | Set (e.g., $5.99) | `null` (label only) |
| Location in menu builder | Basics tab toggle | Quick Pick tab |
| POS behavior | Replaces base price | Keeps base price, adds label |
| Kitchen chit | Shows size in name | Prints `** HOT **` |
| Inventory | Required (prep item link) | Optional (can link to spice prep) |

## Menu Builder — Quick Pick Tab

The "Pricing Options" tab was renamed to **"Quick Pick"** in ItemSettingsModal.

### QuickPickTab.tsx (new)
- Filters groups to `showAsQuickPick === true` only
- Creates new groups with `showAsQuickPick: true` automatically
- Uses existing PricingOptionGroupEditor + PricingOptionRow components
- Empty state: "No quick pick labels yet"
- Footer: "Quick pick labels appear as buttons on POS item cards"
- Max 4 options per group (enforced in UI + API)

### Tab Configuration
```
ItemSettingsModal Tabs:
  1. Basics (+ size options toggle)
  2. Quick Pick  ← renamed from "Pricing Options"
  3. Display
  4. Kitchen
  5. Availability
  6. Pricing
```

## POS Integration

### Quick Pick Sub-Buttons
- FloorPlanMenuItem renders up to 4 quick pick buttons at bottom of item card
- Each button shows the label text (Mild, Medium, Hot, No Spice)
- Tapping a quick pick button adds the item directly with `pricingOptionLabel` set
- Base price is NOT hidden when quick picks are shown (unlike size variants)

### Kitchen Printing
- Quick pick labels print as `** LABEL **` on kitchen chits
- Example: `** HOT **` or `** MILD **`

### BartenderView
- Quick pick button row rendered after hot modifiers section
- Same tap behavior as FloorPlanMenuItem

## Inventory (Optional)

Quick picks can optionally link to prep items via PricingOptionInventoryLink:
- Example: "Hot" → links to "Hot Sauce Prep" with usage quantity
- When customer orders "Hot Wings (Hot)", hot sauce is deducted from inventory
- If no inventory link, the label is purely informational (kitchen only)

## Files

### New
- `src/components/menu/QuickPickTab.tsx` — Tab content component

### Modified
- `src/components/menu/ItemSettingsModal.tsx` — Tab renamed, imports updated
- `src/components/menu/usePricingOptions.ts` — `addGroup()` accepts `showAsQuickPick` param
- `src/components/menu/PricingOptionGroupEditor.tsx` — Max 4 enforcement on "Add Option" button

### Deleted
- `src/components/menu/PricingOptionsTab.tsx` — Replaced by QuickPickTab

## Dependencies
- Skill 454 (Pricing Options — Size Variants) — shared models and infrastructure
- Skill 289 (Edit Item Modal) — ItemSettingsModal tab structure
