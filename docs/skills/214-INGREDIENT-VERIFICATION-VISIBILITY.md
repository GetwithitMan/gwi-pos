---
skill: 214
title: Ingredient Verification Visibility
status: DONE
depends_on: [145, 211]
---

# Skill 214: Ingredient Verification Visibility

> **Status:** DONE
> **Dependencies:** Skill 145 (Ingredient Verification), Skill 211 (Hierarchical Picker)
> **Last Updated:** 2026-02-06

## Overview

Full verification visibility across the Item Editor — ingredient rows show ⚠ Unverified badges, category headers warn about unverified items, and reverse ingredient-to-modifier linking works recursively through child groups.

## Features

### 1. Unverified Badge on Ingredient Rows
- Green ingredient section shows ⚠ Unverified badge next to ingredient name
- Data flows from `/api/menu/items/[id]/ingredients` → `needsVerification` field added to response
- Cross-references `ingredientsLibrary` as fallback

### 2. Category Header Warnings
- Both pickers (green ingredients + purple modifier linking) show ⚠ count on category headers
- Counts prep items with `needsVerification: true` within each category
- Visual: `⚠ 3` badge in red on category header row

### 3. Recursive Reverse Linking
- `ingredientToModifiers` useMemo recurses into child modifier groups
- `processModifiers()` helper walks through `mod.childModifierGroup.modifiers` recursively
- Ensures modifiers in nested groups correctly show in reverse link display

## API Changes

### `/api/menu/items/[id]/ingredients` GET
- Added `needsVerification: mi.ingredient.needsVerification || false` to response mapping
- Prisma query updated to include `ingredient.needsVerification` in select

## Key Files

| File | Purpose |
|------|---------|
| `src/components/menu/ItemEditor.tsx` | Badge display, category warnings, recursive useMemo |
| `src/app/api/menu/items/[id]/ingredients/route.ts` | Returns `needsVerification` field |

## Related Skills

| Skill | Relation |
|-------|----------|
| 145 | Ingredient Verification (schema + /ingredients page) |
| 211 | Hierarchical Ingredient Picker (picker UI) |
| 213 | Real-Time Ingredient Library (data freshness) |
