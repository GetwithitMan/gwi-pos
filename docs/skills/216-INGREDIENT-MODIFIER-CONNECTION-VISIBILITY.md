---
skill: 216
title: Ingredient-Modifier Connection Visibility
status: DONE
depends_on: [143, 204, 211, 214]
---

# Skill 216: Ingredient-Modifier Connection Visibility

> **Status:** DONE
> **Dependencies:** Skill 143 (Item-Owned Modifier Groups), Skill 204 (Ingredient Library Refactor), Skill 211 (Hierarchical Ingredient Picker), Skill 214 (Ingredient Verification Visibility)
> **Last Updated:** 2026-02-06

## Overview

Bidirectional visibility between ingredients and the modifiers that reference them. When a modifier is linked to an ingredient via `Modifier.ingredientId` (set in the Menu Builder), the ingredient library now shows exactly which modifiers (and which menu items) use that ingredient — through a "Connected" badge, expandable details panel, and count indicators.

## Problem

Ingredients could be linked to modifiers (via `Modifier.ingredientId`), but the ingredient library had no way to show this connection. Inventory managers couldn't see:
- Which modifiers reference a given ingredient
- Which menu items those modifiers appear on
- Whether an ingredient was "in use" via the modifier system

This made it hard to assess the impact of changing an ingredient's cost, stock level, or standard quantity.

## Solution

### Dual-Path Menu Item Resolution

Modifiers belong to modifier groups, which connect to menu items through **two different paths** (legacy vs modern):

| Path | Relation | When Used |
|------|----------|-----------|
| **Item-owned** | `ModifierGroup.menuItemId → MenuItem` | Modern: Menu Builder creates groups directly on items |
| **Legacy junction** | `ModifierGroup → MenuItemModifierGroup → MenuItem` | Legacy: Shared groups linked via junction table |

Both paths are queried and merged into a deduplicated `menuItems[]` array using a `Map<id, {id, name}>`.

### API Changes

**`GET /api/ingredients/[id]`** (single ingredient detail):
- Added `linkedModifiers` include with `where: { deletedAt: null }`
- Each modifier includes `modifierGroup` with both `menuItem` (item-owned) and `menuItems` (junction table)
- Response maps both sources into a flat `menuItems[]` per modifier

**`GET /api/ingredients`** (list view):
- Added `_count.linkedModifiers` to each ingredient (with `deletedAt: null` filter)
- Exposes `linkedModifierCount` in formatted response for badge display

### UI Changes

**IngredientHierarchy.tsx:**
- New `LinkedModifier` interface: `{ id, name, modifierGroup: { id, name }, menuItems: [{ id, name }] }`
- "Connected" badge (purple) on prep items with `linkedModifierCount > 0` OR `usedByCount > 0`
- Expandable panel (indigo background) showing:
  - **"Connected via Modifiers"** section: modifier name + group name + arrow + menu item pills
  - **"Direct Ingredient Links"** section: menu items from `MenuItemIngredient` records
- Uses `useCachedFetch` hook (5-min TTL) for linked data

**IngredientLibrary.tsx:**
- Added `linkedModifierCount?: number` to `Ingredient` interface
- Passed through to hierarchy view for badge rendering

## Data Flow

```
Ingredient (e.g., "Ranch (side)")
    ↑
Modifier.ingredientId = ingredient.id  (e.g., Modifier "Ranch")
    ↑
ModifierGroup (e.g., "Sides" group on Classic Burger)
    ↑
MenuItem (e.g., "Classic Burger")

UI Display:
"Ranch (side)" → 🔗 Connected → click → "Ranch (Sides) → Classic Burger"
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/ingredients/[id]/route.ts` | Dual-path linkedModifiers query + menu item dedup |
| `src/app/api/ingredients/route.ts` | `_count.linkedModifiers` for badge count |
| `src/components/ingredients/IngredientHierarchy.tsx` | Connected badge, expandable linked panel, LinkedModifier type |
| `src/components/ingredients/IngredientLibrary.tsx` | `linkedModifierCount` in Ingredient interface |

## Edge Cases

| Case | Behavior |
|------|----------|
| Modifier in item-owned group AND junction table | Deduplicated via Map — each menu item appears once |
| Soft-deleted modifiers | Filtered out by `where: { deletedAt: null }` |
| Modifier with no group (orphan) | `modifierGroup` is required relation — cannot happen |
| Group with no menu items | Modifier shows in panel but with no menu item pills |
| Ingredient used by both modifiers AND direct recipes | Both sections show — "Connected via Modifiers" + "Direct Ingredient Links" |

## Related Skills

| Skill | Relation |
|-------|----------|
| 143 | Item-Owned Modifier Groups (provides `menuItemId` path) |
| 204 | Ingredient Library Refactor (component architecture) |
| 211 | Hierarchical Ingredient Picker (ingredient linking UI) |
| 214 | Ingredient Verification Visibility (badge system) |
| 215 | Unified Modifier Inventory Deduction (uses same `ingredientId` path for deductions) |
