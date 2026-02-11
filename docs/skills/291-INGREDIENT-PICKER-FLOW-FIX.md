# Skill 291: Ingredient Picker Flow Fix

**Domain:** Menu
**Status:** DONE
**Date:** February 11, 2026
**Dependencies:** Skill 211 (Hierarchical Ingredient Picker), Skill 213 (Real-Time Ingredient Library)

## Problem

When creating a new inventory item via the "+" button on a category in the Menu Builder's ingredient picker, the item would appear under "Uncategorized" instead of the correct category. This broke the entire downstream flow:

1. **Wrong placement**: New inventory items showed in "Uncategorized" despite having correct `categoryId`
2. **Prep form invisible**: The auto-opened prep creation form rendered under the misplaced item (in a collapsed "Uncategorized" section), making it invisible to the user
3. **Auto-add broken**: Since the prep creation flow was disrupted, users couldn't seamlessly create and link prep items

## Root Cause

Two contributing issues:

### 1. Data Shape Mismatch (handleIngredientCreated)

The POST `/api/ingredients` response returns raw Prisma data with nested relations:
```json
{
  "categoryId": "cat-123",
  "categoryRelation": { "id": "cat-123", "name": "Meat", ... },
  "parentIngredient": null
}
```

But the GET endpoint mapping in `loadMenu()` flattens these into the `IngredientLibraryItem` interface shape:
```json
{
  "categoryId": "cat-123",
  "categoryName": "Meat",
  "parentName": null
}
```

The `handleIngredientCreated` callback was adding the raw POST data directly to `ingredientsLibrary` without normalization, creating a shape mismatch.

### 2. Race Condition (loadMenu vs Optimistic Update)

After creating an inventory item, `onItemUpdated()` immediately triggered `loadMenu()`. On localhost with SQLite, this fetch could resolve very quickly and replace the optimistic data before React committed the render showing the expanded category tree with the prep creation form.

## Solution

### Fix 1: Normalize POST response data

In `handleIngredientCreated` (menu/page.tsx), the raw POST response is now transformed to match the exact GET mapping shape before adding to the library:

```typescript
const handleIngredientCreated = useCallback((ingredient: any) => {
  const normalized: IngredientLibraryItem = {
    ...ingredient,
    categoryName: ingredient.categoryRelation?.name || ingredient.category || null,
    categoryId: ingredient.categoryId || null,
    parentName: ingredient.parentIngredient?.name || null,
    parentIngredientId: ingredient.parentIngredientId || null,
    needsVerification: ingredient.needsVerification ?? true,
    // ... all other fields with safe defaults
  }
  setIngredientsLibrary(prev => [...prev, normalized])
}, [])
```

### Fix 2: Defer loadMenu() after creation

In both `createInventoryItem()` and `createPrepItem()`, the `onItemUpdated()` call (which triggers `loadMenu()`) is deferred with a 100ms timeout. This ensures:
1. The optimistic update renders first (item in correct category)
2. Expanded category + expanded parent + prep form are visible
3. THEN `loadMenu()` replaces with fresh data (also correctly placed)

```typescript
// Set all local state first
setExpandedCategories(prev => { ... })
setExpandedParents(prev => { ... })
setCreatingPrepUnderParent(data.id)

// Defer full refresh so optimistic update renders first
setTimeout(() => onItemUpdated(), 100)
```

### Verification: needsVerification propagation

Confirmed that both creation paths already pass `needsVerification: true`:
- `createInventoryItem()` (line 1118): `needsVerification: true`
- `createPrepItem()` (line 1196): `needsVerification: true`
- Normalization defaults: `needsVerification: ingredient.needsVerification ?? true`

## Files Modified

| File | Changes |
|------|---------|
| `src/app/(admin)/menu/page.tsx` | `handleIngredientCreated` now normalizes raw POST data to match GET shape |
| `src/components/menu/ItemEditor.tsx` | Deferred `onItemUpdated()` in `createInventoryItem()` and `createPrepItem()` to prevent race |

## Complete Flow (After Fix)

1. User opens green ingredient picker (`showIngredientPicker = true`)
2. Clicks "+" on a category (e.g., "Meat") → inline creation form appears
3. Types name, clicks Create → `createInventoryItem("cat-meat-id")` fires
4. POST `/api/ingredients` creates with `categoryId: "cat-meat-id"`
5. `handleIngredientCreated` normalizes response → adds to library with correct `categoryId`
6. Category "Meat" is expanded, new item is expanded, prep form appears ✅
7. User types prep name, clicks "Create & Add" → `createPrepItem()` fires
8. POST creates prep with `parentIngredientId`, `categoryId`, `needsVerification: true`
9. `showIngredientPicker` is still true → auto-add branch fires
10. Prep item is added to menu item's ingredients ✅
11. Picker closes, toast confirms "Created X and added - pending verification"
12. Deferred `loadMenu()` refreshes all data with correct placement ✅
