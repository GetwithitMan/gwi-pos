# Menu Domain

**Domain ID:** 4
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Menu domain manages categories, menu items, modifier groups, modifiers, and the Menu Builder interface. It handles:
- Category CRUD with types (food, drinks, liquor, entertainment, combos, retail)
- Menu item management with pour sizes, combo templates, timed rentals
- Item-owned modifier groups with unlimited nesting depth
- Tiered pricing, exclusion rules, and modifier stacking
- Online ordering modifier overrides
- Per-modifier print routing configuration
- Real-time menu updates via Socket.io

## Domain Trigger

```
PM Mode: Menu
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Categories | Menu categories | `src/app/api/menu/categories/` |
| Items | Menu items | `src/app/api/menu/items/`, `src/app/api/menu/items/[id]/` |
| Modifiers | Modifier groups and modifiers | `src/app/api/menu/modifiers/` |
| Item Modifiers | Item-to-modifier links | `src/app/api/menu/items/[id]/modifier-groups/` |
| UI | Menu builder components | `src/app/(admin)/menu/`, `src/components/menu/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/menu/page.tsx` | Menu admin page |
| `src/components/menu/ItemEditor.tsx` | Item editor with ingredient pickers |
| `src/components/menu/ModifierFlowEditor.tsx` | Modifier flow editor with tiered pricing |
| `src/components/menu/ItemTreeView.tsx` | Item hierarchy tree |
| `src/components/menu/RecipeBuilder.tsx` | Recipe component editor |
| `src/types/public-menu.ts` | Public menu API contracts |
| `src/lib/socket-dispatch.ts` | Menu change socket dispatches |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/menu` | GET | Full menu with categories and items |
| `/api/menu/categories` | GET/POST | Category CRUD |
| `/api/menu/categories/[id]` | PUT/DELETE | Single category |
| `/api/menu/items` | POST | Create item |
| `/api/menu/items/[id]` | GET/PUT/DELETE | Single item CRUD |
| `/api/menu/items/[id]/modifier-groups` | GET/POST | Item modifier groups (nested) |
| `/api/menu/items/[id]/modifier-groups/[groupId]` | DELETE | Cascade delete with preview |
| `/api/menu/items/[id]/modifiers` | GET/POST | Modifier links with online visibility |
| `/api/menu/items/[id]/ingredients` | GET | Item ingredients with verification status |
| `/api/menu/items/[id]/recipe` | GET/POST | Recipe components |
| `/api/menu/modifiers` | GET/POST | Modifier group CRUD |
| `/api/menu/modifiers/[id]` | PUT/DELETE | Single modifier group |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 03 | Menu Display | DONE |
| 04 | Modifiers | DONE |
| 41 | Combo Meals | DONE |
| 99 | Online Ordering Modifier Override | DONE |
| 100 | Modifier Stacking UI | DONE |
| 109 | Visual Pizza Builder | DONE |
| 129 | Menu Builder Child Modifiers | DONE |
| 142 | Tiered Pricing & Exclusion Rules | DONE |
| 143 | Item-Owned Modifier Groups | DONE |
| 144 | Production Hardening Pass | DONE |
| 208 | POS Modifier Modal Redesign | DONE |
| 210 | Modifier Cascade Delete | DONE |
| 212 | Per-Modifier Print Routing | DONE |
| 217 | Menu Socket Real-Time Updates | DONE |
| 233 | Modifier Depth Indentation | DONE |

## Integration Points

- **Inventory Domain**: Ingredient linking, recipe components, deduction on sale
- **Orders Domain**: Item selection, modifier modal, order creation
- **Hardware Domain**: Per-modifier print routing (dispatch pending)
- **KDS Domain**: Modifier depth display on tickets
