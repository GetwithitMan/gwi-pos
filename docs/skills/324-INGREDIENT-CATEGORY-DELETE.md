# Skill 324: Ingredient Category Edit & Delete

**Status:** DONE
**Domain:** Inventory
**Date:** 2026-02-11

## Summary

Added delete functionality to ingredient categories in the `/ingredients` page. Categories can now be deleted from both List and Hierarchy views, with cascade soft-delete protection.

## Behavior

### Empty Category
- Click "Delete" on category header → category is soft-deleted immediately
- No confirmation needed

### Category with Items
- Click "Delete" → warning modal appears showing:
  - Count of inventory items in the category
  - Count of prep items (children of those inventory items)
- User must type "DELETE" to confirm
- On confirm: all inventory items + prep items are soft-deleted (moved to Deleted section), then the category itself is soft-deleted
- Items can be restored from the Deleted section using the existing restore workflow

## Files Modified

| File | Changes |
|------|---------|
| `src/app/api/ingredient-categories/[id]/route.ts` | DELETE now accepts `confirmDelete: "DELETE"` body param. If category has items and no confirmation, returns `{ requiresConfirmation: true, ingredientCount, childCount, totalCount }`. With confirmation, cascade soft-deletes all ingredients + children. |
| `src/components/ingredients/IngredientLibrary.tsx` | Added delete confirmation modal with typed "DELETE" input. `handleDeleteCategory` probes API first — if empty, deletes directly; if items exist, shows modal. `handleConfirmDeleteCategory` sends confirmed DELETE. |
| `src/components/ingredients/CategorySection.tsx` | Added red "Delete" button in category header (next to Edit). Button only shows for non-uncategorized categories. |
| `src/components/ingredients/IngredientHierarchy.tsx` | Added `onDeleteCategory` prop to both `GroupedIngredientHierarchy` and `CategoryHierarchySection`. Added red "Delete" button next to Edit in hierarchy view headers. |

## API Changes

### DELETE /api/ingredient-categories/[id]

**Request body (optional):**
```json
{ "confirmDelete": "DELETE" }
```

**Response when category is empty (200):**
```json
{ "data": { "message": "Category \"Dairy\" deleted", "deletedIngredients": 0, "deletedChildren": 0 } }
```

**Response when category has items and no confirmation (400):**
```json
{
  "error": "Category \"Dairy\" has 3 inventory items and 5 prep items. Type DELETE to confirm.",
  "ingredientCount": 3,
  "childCount": 5,
  "totalCount": 8,
  "requiresConfirmation": true
}
```

**Response when confirmed with items (200):**
```json
{ "data": { "message": "Category \"Dairy\" deleted with 8 items", "deletedIngredients": 3, "deletedChildren": 5 } }
```

## UI Details

- Delete button uses red text (`text-red-600`) with red hover background
- Confirmation modal has amber warning box listing item counts
- Red-bordered text input for typing "DELETE"
- Submit button disabled until exact "DELETE" match
- Loading state shows "Deleting..." during API call
- Toast notification on success/failure
