# Skill 140: Inventory-Level 86 with Cascade

## Overview
Mark inventory items as "86" (out of stock) and automatically disable all menu items and modifiers that depend on them. Includes a quick 86 page for fast access.

## Status: Building

## Problem
When a restaurant runs out of an ingredient:
- Staff must manually 86 every menu item that uses it
- Easy to miss items (chicken on salads, sandwiches, pizzas)
- Modifiers also need updating (remove chicken from protein options)
- BBQ shops and donut shops need this constantly
- Navigating through full inventory to find items is slow

## Solution

### Quick 86 Page (`/86`)
A fast, mobile-friendly page showing all inventory items with toggle switches:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🚫 QUICK 86                               Search: [__________]  │
├─────────────────────────────────────────────────────────────────┤
│ Filter: [Show All ▼]    Sort: [Most Used ▼]                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ PROTEINS                                                        │
│ ├─ Chicken Breast .......................... [🔴 OUT]           │
│ │  └─ 12 items affected: Chicken Salad, Grilled Chicken...     │
│ ├─ Brisket ................................. [✅ IN ]           │
│ ├─ Pulled Pork ............................. [✅ IN ]           │
│ └─ Ribs .................................... [🔴 OUT]           │
│    └─ 3 items affected: Full Rack, Half Rack, Rib Sampler      │
│                                                                 │
│ BAKERY                                                          │
│ ├─ Glazed Donut ............................ [🔴 OUT]           │
│ │  └─ 1 item affected: Glazed Donut                            │
│ ├─ Chocolate Cake Donut .................... [✅ IN ]           │
│ ├─ Boston Cream ............................. [🔴 OUT]           │
│ │  └─ 1 item affected: Boston Cream                            │
│ └─ Apple Fritter ........................... [✅ IN ]           │
│                                                                 │
│ PRODUCE                                                         │
│ ├─ Lettuce ................................. [✅ IN ]           │
│ ├─ Tomatoes ................................ [✅ IN ]           │
│ └─ Avocado ................................. [🔴 OUT]           │
│    └─ 5 items affected: Guac, Avocado Toast, Cali Burger...    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Mobile-Optimized View
```
┌─────────────────────────────────┐
│ 🚫 QUICK 86        [🔍]         │
├─────────────────────────────────┤
│                                 │
│ ┌─────────────────────────────┐ │
│ │ 🍗 Chicken Breast           │ │
│ │ 12 items affected    [OUT🔴]│ │
│ └─────────────────────────────┘ │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ 🥩 Brisket                  │ │
│ │ 8 items affected     [IN ✅]│ │
│ └─────────────────────────────┘ │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ 🍩 Glazed Donut             │ │
│ │ 1 item affected      [OUT🔴]│ │
│ └─────────────────────────────┘ │
│                                 │
│ [Show Only 86'd Items]          │
└─────────────────────────────────┘
```

### Schema Changes

```prisma
// Add to Ingredient model
is86d           Boolean   @default(false)  // Currently out of stock
last86dAt       DateTime?                   // When marked 86
last86dBy       String?                     // Employee who marked it

// Add to InventorySettings (location-level)
autoUnmark86AtMidnight  Boolean @default(false)  // Auto-reset at midnight
show86BadgeOnPOS        Boolean @default(true)   // Show visual indicator
```

### Cascade Logic

When an ingredient is marked 86:

**1. Menu Items Affected:**
```typescript
// Find all menu items using this ingredient
const affectedItems = await db.menuItemIngredient.findMany({
  where: { ingredientId, deletedAt: null },
  include: { menuItem: true }
})

// Also check recipe components
const recipeItems = await db.recipeIngredient.findMany({
  where: { ingredientId, deletedAt: null },
  include: { menuItem: true }
})
```

**2. Modifier Options Affected:**
```typescript
// Find modifiers linked to this ingredient
const affectedModifiers = await db.modifier.findMany({
  where: {
    OR: [
      { linkedIngredientId: ingredientId },
      { menuItem: { ingredients: { some: { ingredientId } } } }
    ],
    deletedAt: null
  }
})
```

**3. Update Availability:**
```typescript
// Mark items as unavailable (don't delete, just flag)
// These are computed at query time, not stored
```

### API Response Enhancement

When fetching menu for POS, include 86 status:

```typescript
// GET /api/menu
{
  categories: [{
    items: [{
      id: "item-1",
      name: "Chicken Salad",
      is86d: true,  // Computed from ingredient status
      reasons86d: ["Chicken Breast is 86'd"]
    }]
  }]
}
```

### POS Display

86'd items show with visual indicators:

```
┌──────────────────┐   ┌──────────────────┐
│                  │   │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│  Brisket Plate   │   │  ▓ CHICKEN ▓▓▓  │
│     $14.99       │   │  ▓ SALAD   ▓▓▓  │
│                  │   │  ▓   86    ▓▓▓  │
└──────────────────┘   └──────────────────┘
     Normal Item          86'd Item (grayed, striped)
```

Clicking 86'd item shows toast: "Chicken Salad is unavailable - Chicken Breast is out"

### Modifier Behavior

When ingredient is 86'd but used as a modifier option:

```
Choose Protein:
○ Brisket          (+$0)
○ Pulled Pork      (+$0)
○ ▓▓ Chicken ▓▓    (86)  ← Grayed out, not selectable
○ Ribs             (+$2)
```

### Permission

New permission: `inventory.quick_86`
- Allows access to /86 quick page
- Can toggle 86 status on ingredients
- Separate from full inventory management

### API Endpoints

```typescript
// Quick 86 list with affected items count
GET /api/inventory/86-status
Response: {
  items: [{
    id: string
    name: string
    category: string
    is86d: boolean
    affectedMenuItems: number
    affectedModifiers: number
  }]
}

// Toggle 86 status
POST /api/inventory/86-status
Body: { ingredientId: string, is86d: boolean }
Response: {
  ingredient: { id, name, is86d },
  affectedMenuItems: [{ id, name }],
  affectedModifiers: [{ id, name, groupName }]
}

// Bulk 86 (for donut shops clearing multiple items)
POST /api/inventory/86-status/bulk
Body: { ingredientIds: string[], is86d: boolean }

// Get 86 history for an ingredient
GET /api/ingredients/[id]/86-history
```

### Real-Time Updates (Socket.io)

When 86 status changes, broadcast to all POS terminals:
```typescript
socket.emit('inventory:86-update', {
  ingredientId: string,
  is86d: boolean,
  affectedMenuItemIds: string[],
  affectedModifierIds: string[]
})
```

POS clients listen and update UI immediately without page refresh.

### Route
- `/86` - Quick 86 page (employee access)
- Also accessible from hamburger menu in POS

### Settings
Add to `/settings/inventory`:
- Auto-reset 86 at midnight (for daily prep shops)
- Show 86 badge style (striped, grayed, hidden, overlay)

## Use Cases

### Donut Shop
- Morning: Mark sold-out donuts as 86 from quick page
- Each donut = one ingredient (1:1 mapping)
- Customers see "Sold Out" on online ordering
- Staff sees grayed items on POS

### BBQ Shop
- Brisket runs out at 2pm → Mark 86
- All brisket items automatically unavailable:
  - Brisket Plate
  - Brisket Sandwich
  - 3-Meat Combo (brisket option grayed)
  - Loaded Brisket Fries
- Modifier "Add Brisket" grayed in combos

### Pizza Shop
- Out of pepperoni → Mark 86
- Pepperoni Pizza 86'd
- Meat Lovers 86'd
- "Add Pepperoni" modifier grayed

## Related Skills
- Skill 137: Par Levels (prevent running out)
- Skill 132: Alerts System (low stock warnings)
- Skill 139: Inventory Count
