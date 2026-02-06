# Skill 123: Menu Builder - Item-Owned Modifier Groups with Child Modifiers

## Overview

The Menu Builder uses a single-screen interface where all modifier groups are **item-owned** (not shared between items). Each modifier group belongs to exactly one menu item via `menuItemId`. Modifiers can have nested child modifier groups to unlimited depth.

## Architecture

### Three-Panel Layout
```
┌──────────────────┬──────────────────┬──────────────────┐
│   Hierarchy      │    ItemEditor    │  ModifiersPanel  │
│   (Left)         │    (Center)      │    (Right)       │
├──────────────────┼──────────────────┼──────────────────┤
│ • Categories     │ Name, Price,     │ Selected group   │
│   └─ Items       │ Description      │ editing:         │
│     └─ Groups    │                  │ • Group settings │
│       └─ Mods    │ Modifier Groups: │ • Modifiers list │
│         └─ Child │ [Protein Choice] │ • Child groups   │
│                  │ [Cooking Style]  │ • Ingredients    │
└──────────────────┴──────────────────┴──────────────────┘
```

### Data Model

```
MenuItem
  └─ ModifierGroup (menuItemId = item.id)
       └─ Modifier
            └─ childModifierGroupId → ModifierGroup (also menuItemId = item.id)
                 └─ Modifier
                      └─ childModifierGroupId → ModifierGroup (...)
```

**Key Fields:**
- `ModifierGroup.menuItemId` - Links group to specific item (item-owned)
- `Modifier.childModifierGroupId` - Points to nested child group
- `Modifier.ingredientId` - Links to ingredient for inventory

## UI Components

### ItemEditor (Compact Group Display)
Shows modifier groups as clickable cards:
```
┌─────────────────────────────────────┐
│ Protein Choice (3 modifiers) [x]   │
│ Cooking Style (5 modifiers)  [x]   │
│ [+ Add Group]                      │
└─────────────────────────────────────┘
```
- Click group → Opens in ModifiersPanel
- Click [x] → Delete group (with confirmation)
- Click [+ Add Group] → Create new group

### ModifiersPanel (Full Editor)
When a group is selected, shows full editing interface:

```
┌─────────────────────────────────────────┐
│ Protein Choice                    [Edit]│
│ Required: Yes   Min: 1   Max: 1         │
├─────────────────────────────────────────┤
│ ○ Chicken        $0.00  [No][Lt][Ex][+] │
│   └─ ▼ Chicken Style                    │
│        ○ Grilled     $0.00  [...] [+]   │
│        ○ Fried       $2.00  [...] [+]   │
│        ○ Blackened   $1.00  [...] [+]   │
│        [+ Add Modifier]                 │
│                                         │
│ ○ Steak          $4.00  [No][Lt][Ex][+] │
│   └─ ▼ Steak Temp                       │
│        ○ Rare        $0.00  [...] [+]   │
│        ○ Medium      $0.00  [...] [+]   │
│        ○ Well Done   $0.00  [...] [+]   │
│        [+ Add Modifier]                 │
│                                         │
│ ○ Shrimp         $3.00  [No][Lt][Ex][+] │
│                                         │
│ [+ Add Modifier]                        │
└─────────────────────────────────────────┘

[+] = Add Child Modifier Group button
[No][Lt][Ex] = Pre-modifier toggles (allowNo, allowLite, allowExtra)
```

### Creating Child Groups

1. Click [+] button on any modifier
2. Enter child group name in prompt
3. Group created with same `menuItemId` as parent
4. Modifier's `childModifierGroupId` set to new group
5. Child group appears nested under the modifier
6. Can add modifiers to child group
7. Those modifiers can have their own child groups (unlimited depth)

### Legacy Group Cleanup

At bottom of ModifiersPanel, shows "Legacy Groups" section:
- Lists old shared groups (where `menuItemId = NULL`)
- Two-step deletion confirmation
- Disappears once all legacy groups are deleted

## API Endpoints

### GET /api/menu/items/[id]/modifier-groups
Returns nested structure with recursive child groups:

```json
{
  "data": [{
    "id": "grp-1",
    "name": "Protein Choice",
    "minSelections": 1,
    "maxSelections": 1,
    "isRequired": true,
    "modifiers": [{
      "id": "mod-1",
      "name": "Chicken",
      "price": 0,
      "allowNo": false,
      "allowLite": false,
      "allowExtra": true,
      "ingredientId": "ing-chicken",
      "ingredientName": "Chicken Breast",
      "childModifierGroupId": "grp-2",
      "childModifierGroup": {
        "id": "grp-2",
        "name": "Chicken Style",
        "modifiers": [{
          "id": "mod-3",
          "name": "Grilled",
          "price": 0,
          "childModifierGroup": null
        }]
      }
    }]
  }]
}
```

### POST /api/menu/items/[id]/modifier-groups
Create new modifier group. If `parentModifierId` provided, creates as child group:

**Request:**
```json
{
  "name": "Chicken Style",
  "minSelections": 1,
  "maxSelections": 1,
  "isRequired": false,
  "parentModifierId": "mod-1"  // Links new group to this modifier
}
```

**Response:**
```json
{
  "data": {
    "id": "grp-2",
    "name": "Chicken Style",
    "minSelections": 1,
    "maxSelections": 1,
    "isRequired": false,
    "modifiers": []
  }
}
```

### DELETE /api/menu/modifiers/[groupId]
Deletes legacy shared modifier group (for cleanup).

## Key Files

| File | Purpose |
|------|---------|
| `src/components/menu-builder/ModifiersPanel.tsx` | Full group editor with recursive modifiers |
| `src/components/menu-builder/ItemEditor.tsx` | Compact group display, click to open panel |
| `src/app/(admin)/menu-builder/page.tsx` | State management, handlers for all operations |
| `src/app/api/menu/items/[id]/modifier-groups/route.ts` | GET (nested) and POST (with parentModifierId) |

## TypeScript Interfaces

```typescript
// From page.tsx - exported for use in components
export interface OwnedModifier {
  id: string
  name: string
  price: number
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  extraPrice: number
  isDefault: boolean
  sortOrder: number
  ingredientId?: string | null
  ingredientName?: string | null
  childModifierGroupId?: string | null
  childModifierGroup?: OwnedModifierGroup | null
}

export interface OwnedModifierGroup {
  id: string
  name: string
  displayName?: string | null
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking: boolean
  sortOrder: number
  modifiers: OwnedModifier[]
}
```

## Usage Examples

### Creating Nested Modifier Structure

**Example: Burger with Protein → Style choices**

1. Create "Protein Choice" group on Burger item
2. Add modifiers: Beef, Chicken, Veggie
3. Click [+] on "Chicken" → Create "Chicken Style" child group
4. Add modifiers to child: Grilled, Fried, Blackened
5. Click [+] on "Fried" → Create "Breading" child group
6. Add modifiers: Panko, Buttermilk, Cajun

Result: Unlimited depth nesting all owned by the Burger item.

### Linking Modifier to Ingredient

1. In ModifiersPanel, click ingredient badge area on modifier
2. Search and select ingredient (e.g., "Chicken Breast")
3. Modifier now linked via `ingredientId`
4. Inventory deductions happen when ordered

## Migration from Shared Groups

Legacy shared modifier groups (where `menuItemId = NULL`) appear in the "Legacy Groups" section at the bottom of ModifiersPanel. To clean up:

1. Open ModifiersPanel
2. Scroll to "Legacy Groups" section
3. Click delete button on each legacy group
4. Confirm deletion (two-step confirmation)
5. Section disappears when all legacy groups deleted

**Note:** Deleting legacy groups does NOT affect item-owned groups. Items that previously used shared groups should have their own copies created through the new item-owned system.
