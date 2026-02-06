---
skill: 213
title: Real-Time Ingredient Library (Socket + Optimistic)
status: DONE
depends_on: [211, 127]
---

# Skill 213: Real-Time Ingredient Library (Socket + Optimistic)

> **Status:** DONE
> **Dependencies:** Skill 211 (Hierarchical Picker), Skill 127 (Quick Stock Adjustment — socket infrastructure)
> **Last Updated:** 2026-02-06

## Overview

When users create new inventory items or prep items inline in the Item Editor, the hierarchy updates instantly via optimistic local state and cross-terminal sync via Socket.io.

## Problem Solved

Before this skill:
1. User creates ingredient inline → API succeeds
2. `onItemUpdated()` triggers `loadMenu()` in parent
3. Race condition: picker UI resets before fresh data arrives
4. User must reopen picker to see new item
5. Other terminals never see the change

## Architecture

### Optimistic Local Update (Instant)
```
User clicks "Create" → POST /api/ingredients
       ↓
API responds with {data: newIngredient}
       ↓
onIngredientCreated(newIngredient)  ← callback to parent
       ↓
Parent: setIngredientsLibrary(prev => [...prev, newIngredient])
       ↓
ItemEditor re-renders with new ingredient in hierarchy ← INSTANT
```

### Socket Cross-Terminal Sync
```
POST /api/ingredients (success)
       ↓
dispatchIngredientLibraryUpdate(locationId, {...})
       ↓
Internal broadcast → emit 'ingredient:updated' to location room
       ↓
Other terminals: socket.on('ingredient:updated') → loadMenu()
```

## New Infrastructure

### Socket Dispatch Function
- `dispatchIngredientLibraryUpdate()` in `src/lib/socket-dispatch.ts`
- Payload: `{ action: 'created'|'updated'|'deleted', ingredientId, name, parentId? }`

### Broadcast Event Type
- `INGREDIENT_LIBRARY_UPDATE` added to broadcast route
- Emits as `ingredient:updated` to location room

### Menu Page Socket Listener
- Connects to socket on mount
- Joins location room
- Listens for `ingredient:updated` → triggers `loadMenu()`

### ItemEditor Callback
- New prop: `onIngredientCreated?: (ingredient: IngredientLibraryItem) => void`
- Called in `createInventoryItem()` and `createPrepItem()` with API response data
- Picker stays open after creation (user can see + interact with new item)

## Key Files

| File | Purpose |
|------|---------|
| `src/components/menu/ItemEditor.tsx` | `onIngredientCreated` callback, optimistic update |
| `src/app/(admin)/menu/page.tsx` | `handleIngredientCreated`, socket listener |
| `src/lib/socket-dispatch.ts` | `dispatchIngredientLibraryUpdate()` |
| `src/app/api/internal/socket/broadcast/route.ts` | `INGREDIENT_LIBRARY_UPDATE` type |
| `src/app/api/ingredients/route.ts` | Fire-and-forget dispatch on POST |

## Related Skills

| Skill | Relation |
|-------|----------|
| 127 | Quick Stock Adjustment (socket dispatch pattern used as template) |
| 211 | Hierarchical Ingredient Picker (UI this feeds into) |
| 214 | Ingredient Verification Visibility (works with same data) |
