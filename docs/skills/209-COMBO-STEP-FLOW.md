# Skill 209: Combo Step Flow

## Status: DONE
## Date: Feb 5, 2026
## Domain: Menu / Orders
## Dependencies: 41 (Combo Meals), 208 (Modifier Modal Redesign)

## Overview

A step-by-step wizard component for configuring combo meals in the POS. When a customer orders a combo, they are guided through each component slot (entree, side, drink) with the modifier modal showing relevant options at each step.

## Key Features

- Step-by-step wizard for combo component selection
- Shows each combo component as a step
- Modifier groups shown for each component's selected item
- Price adjustments for upgrades/upsizes
- Comprehensive demo seed data for testing

## Worker

| Worker | Task | Status |
|--------|------|--------|
| B7 | ComboStepFlow component + robust demo seed data | DONE |

## Key Files

| File | Purpose |
|------|---------|
| `src/components/modifiers/ComboStepFlow.tsx` | Step-by-step combo wizard |
| `prisma/seed.ts` | Demo combo data (burgers, sides, drinks) |

## Related Skills
- 41: Combo Meals (base system)
- 84: Combo Price Overrides
- 86: Combo Selection Modal
- 208: POS Modifier Modal Redesign
