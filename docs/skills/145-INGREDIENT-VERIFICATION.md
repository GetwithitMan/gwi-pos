# Skill 145: Ingredient Verification System

## Status: DONE
## Date: Feb 6, 2026
## Domain: Inventory / Menu
## Dependencies: 125 (Ingredient Costing), 204 (Ingredient Library Refactor)

## Overview

Ingredients created from the Menu Builder (via the modifier ingredient linking workflow) are flagged as "needs verification." The Inventory page highlights these items in red until an inventory manager reviews and confirms them. This creates a seamless workflow where menu builders can create ingredients on the fly without worrying about getting all the details right — the inventory team verifies later.

## Schema Changes

Added to `Ingredient` model:
```prisma
needsVerification  Boolean   @default(false)
verifiedAt         DateTime?
verifiedBy         String?   // employeeId who verified
```

## Workflow

```
Menu Builder                    Inventory Page
─────────────                   ──────────────
1. Building item modifiers
2. Click 🔗 on modifier
3. Create new ingredient ───────► Item appears RED
   (needsVerification: true)       "⚠ Needs Verification"
                                4. Inventory manager reviews
                                5. Clicks "✓ Verify"
                                   (needsVerification: false)
                                   Item turns normal color
```

## Visual Treatment (Inventory Page)

Unverified items show:
- Red left border (`border-l-4 border-red-500`)
- Red background tint (`bg-red-50`)
- "⚠ Created from Menu Builder - needs review" subtitle
- Green "✓ Verify" button

After verification:
- Normal styling
- `verifiedAt` and `verifiedBy` recorded for audit trail

## API Changes

### POST `/api/ingredients`
- Accepts `needsVerification` in request body (default: `false`)
- Menu builder passes `needsVerification: true` when creating from dropdown

### PUT `/api/ingredients/[id]`
- Accepts `needsVerification`, `verifiedAt`, `verifiedBy` in update body
- Verify action: `{ needsVerification: false, verifiedAt: new Date().toISOString() }`

### GET `/api/ingredients`
- Returns `needsVerification` field in response

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Added 3 new fields to Ingredient model |
| `src/app/api/ingredients/route.ts` | POST accepts needsVerification, GET returns it |
| `src/app/api/ingredients/[id]/route.ts` | PUT accepts verification fields |
| `src/components/ingredients/IngredientLibrary.tsx` | Red highlight + verify button |
| `src/components/ingredients/IngredientHierarchy.tsx` | Verification badges in hierarchy view |

## Related Skills
- 125: Ingredient Costing & Recipes
- 143: Item-Owned Modifier Groups (creates ingredients from menu builder)
- 204: Ingredient Library Refactor
