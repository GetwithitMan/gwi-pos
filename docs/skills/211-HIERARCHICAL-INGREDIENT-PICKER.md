---
skill: 211
title: Hierarchical Ingredient Picker (Unified)
status: DONE
depends_on: [126, 143]
---

# Skill 211: Hierarchical Ingredient Picker (Unified)

> **Status:** DONE
> **Dependencies:** Skill 126 (Input/Output Model), Skill 143 (Item-Owned Groups)
> **Last Updated:** 2026-02-06

## Overview

Unified hierarchical ingredient picker used in both the green "Ingredients" section and the purple modifier ingredient linking dropdown. Replaces the old flat search picker with a full category → parent → prep item tree.

## Features

### Shared `buildHierarchy(searchTerm)` Function
- Accepts search term parameter (reusable for both contexts)
- Organizes prep items by IngredientCategory → Parent Ingredient → Prep Items
- Auto-expand on search (both pickers have their own useEffect)

### Green Ingredient Picker (Item Ingredients)
- Color scheme: green (bg-green-50, text-green-700)
- On click: calls `addIngredient(prepItem.id)`
- Filters out already-added ingredients
- Max height: `max-h-96`
- Inline creation: "+" on categories (new inventory item) and parents (new prep item)
- Auto-adds newly created prep items to the ingredient list

### Purple Modifier Linking Dropdown
- Color scheme: purple (bg-purple-50, text-purple-700)
- On click: calls `linkIngredient(groupId, modId, prepItem.id)`
- Inline creation: "+" on categories and parents with auto-link
- Badge: `🔗 {ingredientName}` on modifier row when linked
- **Bug Fix (W6):** `expandedCategories` and `expandedParents` now reset on all close paths (link, toggle, open new) to prevent stale hierarchy between linking sessions

### Inline Creation
- Create inventory items within categories (POST /api/ingredients)
- Create prep items under parent ingredients with auto-link or auto-add
- `createPrepItem()` detects context (modifier linking vs ingredient picker)

## Key Files

| File | Purpose |
|------|---------|
| `src/components/menu/ItemEditor.tsx` | Both pickers, `buildHierarchy()`, inline creation |

## Related Skills

| Skill | Relation |
|-------|----------|
| 126 | Explicit Input/Output Model (ingredient data structure) |
| 204 | Ingredient Library Refactor |
| 213 | Real-Time Ingredient Library (socket updates) |
