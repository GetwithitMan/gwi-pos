# Skill 142: Menu Builder Tiered Pricing & Exclusion Rules

## Status: DONE
## Date: Feb 5, 2026
## Domain: Menu
## Dependencies: 04 (Modifiers)

## Overview

Added tiered pricing and exclusion rules to modifier groups in the Menu Builder. This allows admins to configure complex pricing structures (e.g., "first 2 toppings free, then $1.50 each") and prevent duplicate selections across modifier groups (e.g., can't pick the same side dish twice).

## Workers

| Worker | Task | Status |
|--------|------|--------|
| W1 | Schema migration + API updates | DONE |
| W2 | Fix infinite re-render bug in menu page | DONE |
| W3 | Make ItemEditor fully editable | DONE |
| W4 | Create ModifierFlowEditor (new right panel) | DONE |
| W5 | POS-side tiered pricing + exclusion logic | DONE |
| W6 | ItemTreeView refresh sync | DONE |

## Schema Changes

Added to `ModifierGroup` model:
- `tieredPricingConfig Json?` — Stores pricing tiers, modes, thresholds
- `exclusionGroupKey String?` — Groups sharing same key prevent duplicate selections

## Tiered Pricing Modes

### Flat Tiers
```json
{
  "mode": "flat_tiers",
  "tiers": [
    { "upTo": 3, "pricePerItem": 0 },
    { "upTo": 6, "pricePerItem": 1.50 },
    { "upTo": null, "pricePerItem": 2.00 }
  ]
}
```

### Free Threshold
```json
{
  "mode": "free_threshold",
  "freeCount": 2,
  "overflowPrice": 1.50
}
```

### Combined (Both Modes)
Both modes can be enabled simultaneously for complex pricing.

## Exclusion Rules

When multiple modifier groups share the same `exclusionGroupKey`:
- Selecting a modifier in one group greys it out in all other groups with the same key
- Toast warning shown when user taps excluded modifier
- Visual: `opacity-30 cursor-not-allowed` on excluded items

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Added tieredPricingConfig, exclusionGroupKey |
| `src/components/menu/ModifierFlowEditor.tsx` | New right panel component (427 lines) |
| `src/components/menu/ItemEditor.tsx` | Full CRUD for groups + modifiers |
| `src/components/modifiers/useModifierSelections.ts` | `getTieredPrice()`, `getExcludedModifierIds()` |
| `src/components/modifiers/ModifierGroupSection.tsx` | Excluded modifier visual treatment |
| `src/types/index.ts` | tieredPricingConfig, exclusionGroupKey on ModifierGroup |

## Architectural Decisions

1. **refreshKey pattern** — Child components reload via incrementing key, not prop changes
2. **loadMenuRef pattern** — Avoids stale closures in useEffect dependencies
3. **Auto-save on blur** — ModifierFlowEditor saves changes when input loses focus
4. **Additive POS logic** — Tiered pricing/exclusion are fully optional; existing behavior unchanged when not configured
5. **Prisma.JsonNull** — Required for SQLite when setting JSON fields to null

## Related Skills
- 04: Modifiers (base system)
- 100: Modifier Stacking UI
- 101: Modifier Hierarchy Display
- 143: Item-Owned Modifier Groups
