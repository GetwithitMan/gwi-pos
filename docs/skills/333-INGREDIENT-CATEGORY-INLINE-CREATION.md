# Skill 333: Ingredient Category Inline Creation

**Status:** DONE
**Domain:** Menu, Inventory
**Dependencies:** 145 (Ingredient Verification), 211 (Hierarchical Ingredient Picker)
**Date:** February 12, 2026

## Problem

When building menu items on a new venue, the ingredient picker in ItemEditor only shows existing categories. If the category you need doesn't exist, you have to leave the Menu Builder, go to `/ingredients`, create the category there, then come back. This breaks the flow of building out a menu from scratch.

## Solution

Added inline category creation directly in the ItemEditor ingredient picker (both green picker for item ingredients and purple picker for modifier ingredient linking). New categories are flagged `needsVerification` so the inventory team can review them on the `/ingredients` page.

## Schema Changes

### IngredientCategory (POS `prisma/schema.prisma`)

```prisma
model IngredientCategory {
  // ... existing fields
  needsVerification Boolean @default(false)  // NEW
}
```

## API Changes

### POST `/api/ingredient-categories`
- Accepts `needsVerification` in body (defaults to `false`)
- When created from ItemEditor, sent as `true`

### PUT `/api/ingredient-categories/[id]`
- Accepts `needsVerification` in body
- Used by "Verify" button on `/ingredients` page to clear the flag

## UI Changes

### ItemEditor (`src/components/menu/ItemEditor.tsx`)

Both green (item ingredients) and purple (modifier ingredients) pickers get:
- **"New Category" button** at the top of the picker dropdown
- **Inline form** with name input + Save/Cancel buttons
- On save: POST to API with `needsVerification: true`, optimistic add to local state

**Props added:**
- `onCategoryCreated?: (category: IngredientCategory) => void` — callback to parent

### Menu Page (`src/app/(admin)/menu/page.tsx`)

- Added `handleCategoryCreated` callback for optimistic state update
- Passes `onCategoryCreated` to ItemEditor
- New categories appear immediately in the picker without a full menu reload

### IngredientHierarchy (`src/components/ingredients/IngredientHierarchy.tsx`)

- **"New Category" badge** (red, pulsing) on categories where `needsVerification === true`
- **"Verify" button** (green) appears next to Edit button on unverified categories
- Empty unverified categories are shown (normally empty categories are hidden)
- `onVerifyCategory` prop threaded through GroupedIngredientHierarchy → CategoryHierarchySection

### IngredientLibrary (`src/components/ingredients/IngredientLibrary.tsx`)

- Added `needsVerification` to IngredientCategory interface
- Added `handleVerifyCategory` function (PUT with `needsVerification: false`)
- Passes `onVerifyCategory` to GroupedIngredientHierarchy

## Workflow

### Creating a Category (Menu Builder)
1. Open ItemEditor → expand ingredient picker (green or purple)
2. Click "New Category" button
3. Type category name → Save
4. Category appears immediately in picker dropdown
5. Continue adding ingredients under the new category

### Verifying a Category (Inventory Page)
1. Navigate to `/ingredients`
2. Unverified categories show red "New Category" badge
3. Click green "Verify" button on the category header
4. Badge disappears, category is now verified

## Key Files

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Added `needsVerification` to IngredientCategory |
| `src/components/menu/ItemEditor.tsx` | Inline category creation form in both pickers |
| `src/app/(admin)/menu/page.tsx` | `handleCategoryCreated` optimistic callback |
| `src/components/ingredients/IngredientHierarchy.tsx` | Badge + verify button |
| `src/components/ingredients/IngredientLibrary.tsx` | `handleVerifyCategory` function |
| `src/app/api/ingredient-categories/route.ts` | POST accepts `needsVerification` |
| `src/app/api/ingredient-categories/[id]/route.ts` | PUT accepts `needsVerification` |

## Connection to Existing Verification System

This extends the pattern established in **Skill 145** (Ingredient Verification):
- **Skill 145**: `needsVerification` on individual ingredients created from Menu Builder
- **Skill 333**: `needsVerification` on categories created from Menu Builder

Both use the same red visual treatment and green verify button pattern, maintaining UI consistency across the inventory verification workflow.
