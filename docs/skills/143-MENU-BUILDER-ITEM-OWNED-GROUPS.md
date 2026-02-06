# Skill 143: Menu Builder Item-Owned Modifier Groups

## Status: DONE
## Date: Feb 6, 2026
## Domain: Menu
## Dependencies: 142 (Tiered Pricing), 04 (Modifiers)

## Overview

Major overhaul of the Menu Builder's modifier system. Modifier groups are now **item-owned** (each group belongs to exactly one menu item via `menuItemId`). Features include:

- **isLabel field** — Distinguishes "choice" modifiers (navigation nodes) from "item" modifiers (concrete options)
- **Drag-drop reorder** — Modifier rows within groups can be reordered via drag handles
- **Cross-item copy** — Drag a modifier group from one item's button bar to another item to deep-copy it
- **Inline editing** — Double-click modifier names/prices to edit in-place
- **Child group management** — Create, rename, duplicate, delete nested modifier groups
- **Ingredient linking** — Link any modifier to an inventory ingredient via dropdown grouped by category

## Workers

| Worker | Task | Status |
|--------|------|--------|
| W7 | isLabel API + ItemEditor UI (choice vs item modifiers) | DONE |
| W8 | Drag-drop fix + restore +/play button + inline editing | DONE |
| W9 | Complete drag-drop overhaul + modifier row reorder | DONE |
| W10 | Ingredient dropdown grouping by category | DONE |
| W11 | Fix ingredient dropdown to use categoryRelation.name | DONE |
| W12 | Cross-item modifier group copy via drag-drop | DONE |

## isLabel System

Modifiers with `isLabel: true` serve as **navigation nodes** (choices/folders) that lead to child modifier groups. They are visually distinct:

- **Choice modifiers**: Amber/folder styling, click to expand child group
- **Item modifiers**: Standard purple styling, concrete selections with prices

```typescript
// Choice modifier (isLabel: true)
{
  name: "Choose a Side",
  isLabel: true,
  price: 0,
  childModifierGroupId: "grp-sides-123"
}

// Item modifier (isLabel: false)
{
  name: "Extra Cheese",
  isLabel: false,
  price: 1.50,
  ingredientId: "ing-cheese-456"
}
```

## Drag-Drop System

### Within-Group Modifier Reorder
- ⠿ drag handle on each modifier row
- `stopPropagation()` prevents parent group drag interference
- Optimistic UI update + API persist for sort orders
- Works in both top-level and child groups

### Cross-Item Group Copy
- Drag from group header in ItemEditor
- Drop on any item button in the horizontal bar
- `dataTransfer.setData('application/x-modifier-group', ...)` carries group metadata
- Deep copy via API: copies group + all modifiers + all child groups recursively

## Inline Editing

Double-click any modifier to enter edit mode:
- Name field (text input)
- Price field (number input)
- Extra price field (number input)
- ESC to cancel, Enter to save
- Auto-focuses first input

## Ingredient Linking

The 🔗 button on each modifier opens a search dropdown:
- Grouped by `categoryRelation.name` (not legacy `category` string)
- Sticky category headers
- Alphabetically sorted within categories
- Search filters by ingredient name

## Key Files

| File | Purpose |
|------|---------|
| `src/components/menu/ItemEditor.tsx` | Center panel with full CRUD, drag-drop, inline editing |
| `src/app/(admin)/menu/page.tsx` | Cross-item drag-drop handlers, ingredient data mapping |
| `src/app/api/menu/items/[id]/modifier-groups/route.ts` | POST with copyFromItemId for deep copy |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/modifiers/route.ts` | Modifier CRUD with isLabel, sortOrder |

## API Changes

### POST `/api/menu/items/[id]/modifier-groups`
- New field: `copyFromItemId` — triggers deep copy from source item
- New field: `parentModifierId` — links duplicated group as child of a modifier
- 3-phase transaction: create group → create child groups → create modifiers with links

### PUT `/api/menu/items/[id]/modifier-groups/[groupId]/modifiers`
- Supports `isLabel` and `sortOrder` fields

## Related Skills
- 129: Menu Builder Child Modifiers (original child group system)
- 142: Tiered Pricing & Exclusion Rules
- 144: Production Hardening Pass
