---
skill: 409
title: Modifier Group Direct Ownership Migration
status: DONE
depends_on: [143, 210]
---

# Skill 409: Modifier Group Direct Ownership Migration

> **Status:** DONE
> **Dependencies:** Skill 143 (Item-Owned Modifier Groups), Skill 210 (Modifier Cascade Delete)
> **Last Updated:** 2026-02-21

## Overview

Eliminated the `MenuItemModifierGroup` junction table and migrated all modifier group ownership to direct `menuItemId` on the `ModifierGroup` record. This fixed a critical bug where online ordering showed menu items but no modifier groups.

---

## Problem

The POS had two competing systems for linking modifier groups to menu items, and they disagreed about which groups existed.

### System 1: Direct Ownership (new, used by menu builder)

`ModifierGroup.menuItemId` — a modifier group is owned by exactly one item. The menu builder (`ItemEditor`) created all new groups this way.

### System 2: Junction Table (legacy, used by read paths)

`MenuItemModifierGroup` — a many-to-many join table with `menuItemId` and `modifierGroupId` columns. The online ordering API and the general menu API both queried this table to find modifier groups for an item.

### How This Broke Online Ordering

Because the menu builder created groups via `menuItemId` (direct ownership) but never created a `MenuItemModifierGroup` row, any group created after the menu builder was introduced had **no junction row**. The online ordering API queried the junction table, found nothing, and returned items with empty modifier group arrays.

Customers saw items on the online menu but could not make any modifier selections — the groups were silently invisible.

### The showOnline Mismatch

`showOnline` (whether a modifier group appears on the online menu) was stored on the junction row (`MenuItemModifierGroup.showOnline`), not on `ModifierGroup` itself. This meant:

- Toggling online visibility only worked through the junction row
- Groups created via the menu builder (no junction row) had no `showOnline` flag at all
- Any attempt to set `showOnline` for a directly-owned group updated nowhere

---

## Before / After Architecture

### Before

```
MenuItem
  │
  ├── MenuItemModifierGroup (junction)  ← read paths queried here
  │     ├── menuItemId
  │     ├── modifierGroupId
  │     └── showOnline                 ← visibility lived on junction row
  │
  └── ownedModifierGroups (via menuItemId on ModifierGroup)
        └── ModifierGroup              ← menu builder wrote here
              ├── id
              ├── name
              └── menuItemId           ← set by menu builder, ignored by read paths
```

Two write paths in, two read paths out. Junction rows accumulated only for groups
created before the menu builder. Newer groups existed only in ModifierGroup.menuItemId
and were invisible to online ordering.

### After

```
MenuItem
  │
  └── ownedModifierGroups (via menuItemId on ModifierGroup)
        └── ModifierGroup              ← single source of truth
              ├── id
              ├── name
              ├── menuItemId           ← ownership (cascade deletes with item)
              └── showOnline           ← visibility lives here now
```

One write path. One read path. No junction to maintain.

---

## Schema Changes

**File:** `prisma/schema.prisma`

### Added `showOnline` to `ModifierGroup`

```prisma
model ModifierGroup {
  // ...existing fields...
  showOnline  Boolean  @default(true)   // NEW — was on junction row
  menuItemId  String?
  menuItem    MenuItem? @relation("OwnedModifierGroups", fields: [menuItemId], references: [id], onDelete: Cascade)
}
```

### Removed junction relations from `MenuItem` and `ModifierGroup`

```prisma
// REMOVED from MenuItem:
modifierGroups  MenuItemModifierGroup[]

// REMOVED from ModifierGroup:
menuItems  MenuItemModifierGroup[]
```

### Deleted `MenuItemModifierGroup` model entirely

The entire model was removed:

```prisma
// DELETED:
model MenuItemModifierGroup {
  id              String    @id @default(cuid())
  menuItemId      String
  modifierGroupId String
  showOnline      Boolean   @default(true)
  menuItem        MenuItem       @relation(...)
  modifierGroup   ModifierGroup  @relation(...)
  @@unique([menuItemId, modifierGroupId])
}
```

---

## Migration Strategy

The schema change alone would leave data in an inconsistent state. Two classes of records needed repair before the junction table could be dropped.

### Problem 1: Lost `showOnline = false` settings

Some groups had `showOnline = false` set on their junction row. Dropping the junction table would silently reset those groups to the default (`true`), making hidden groups visible online again.

### Problem 2: Orphaned `ModifierGroup` records with no `menuItemId`

Groups created before the menu builder (legacy path) had junction rows but `menuItemId = NULL`. Direct ownership with a null `menuItemId` means the group belongs to no item.

### Data Migration SQL

Added inside the generated migration file after the `ALTER TABLE` statements:

```sql
-- Propagate showOnline=false from junction to ModifierGroup
-- Must run BEFORE dropping the junction table.
UPDATE "ModifierGroup" mg
SET "showOnline" = false
FROM "MenuItemModifierGroup" mimig
WHERE mg.id = mimig."modifierGroupId"
  AND mimig."showOnline" = false;

-- Heal orphaned ModifierGroup records that have junction rows but no menuItemId.
-- Gives them a real owner so they survive the junction table drop.
UPDATE "ModifierGroup" mg
SET "menuItemId" = mimig."menuItemId"
FROM "MenuItemModifierGroup" mimig
WHERE mg.id = mimig."modifierGroupId"
  AND mg."menuItemId" IS NULL;
```

**Order matters:** The `showOnline` propagation must run before the junction table is dropped. Both UPDATEs reference `MenuItemModifierGroup`, so they must execute while that table still exists.

---

## Read / Write Path Changes

### Write Path: `showOnline` Toggle

**File:** `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts`

Changed the `showOnline` update target from the junction table to `ModifierGroup` directly.

```typescript
// BEFORE — updated junction row
await db.menuItemModifierGroup.updateMany({
  where: { menuItemId, modifierGroupId: groupId },
  data: { showOnline },
})

// AFTER — updates the group record itself
await db.modifierGroup.update({
  where: { id: groupId },
  data: { showOnline },
})
```

### Read Path 1: General Menu API

**File:** `src/app/api/menu/route.ts`

Switched from querying `modifierGroups` (junction relation) to `ownedModifierGroups` (direct relation).

```typescript
// BEFORE
modifierGroups: {
  where: { deletedAt: null, modifierGroup: { deletedAt: null } },
  include: {
    modifierGroup: {
      include: { modifiers: { where: { deletedAt: null, isActive: true } } }
    }
  }
}
// mapping:
item.modifierGroups.map(mg => ({
  id: mg.modifierGroup.id,
  name: mg.modifierGroup.name,
  showOnline: mg.showOnline,   // came from junction row
}))

// AFTER
ownedModifierGroups: {
  where: { deletedAt: null },
  orderBy: { sortOrder: 'asc' },
  include: {
    modifiers: { where: { deletedAt: null, isActive: true } }
  }
}
// mapping:
item.ownedModifierGroups.map(mg => ({
  id: mg.id,
  name: mg.name,
  showOnline: mg.showOnline,   // comes from ModifierGroup directly
}))
```

### Read Path 2: Item Detail API

**File:** `src/app/api/menu/items/[id]/route.ts`

Switched the modifier group ID list from junction select to direct select. Response shape is preserved so callers are unaffected.

```typescript
// BEFORE
modifierGroups: {
  where: { modifierGroup: { deletedAt: null } },
  select: { modifierGroupId: true },
}
// Response used: item.modifierGroups.map(mg => ({ modifierGroupId: mg.modifierGroupId }))

// AFTER
ownedModifierGroups: {
  where: { deletedAt: null },
  select: { id: true },
}
// Response preserved: item.ownedModifierGroups.map(mg => ({ modifierGroupId: mg.id }))
```

### Read Path 3: Online Ordering API (the fix)

**File:** `src/app/api/online/menu/route.ts`

This was the root cause of the online ordering bug. Replaced the junction query with `ownedModifierGroups`.

```typescript
// BEFORE — queried junction table; missed all menu-builder-created groups
modifierGroups: {
  where: { deletedAt: null, modifierGroup: { deletedAt: null, showOnline: true } },
  include: {
    modifierGroup: {
      include: {
        modifiers: {
          where: { isActive: true, showOnline: true, deletedAt: null }
        }
      }
    }
  }
}

// AFTER — queries ModifierGroup directly; sees all groups
ownedModifierGroups: {
  where: { deletedAt: null, showOnline: true },
  orderBy: { sortOrder: 'asc' },
  select: {
    id: true,
    name: true,
    displayName: true,
    minSelections: true,
    maxSelections: true,
    isRequired: true,
    allowStacking: true,
    sortOrder: true,
    modifiers: {
      where: { isActive: true, showOnline: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, displayName: true, price: true },
    },
  },
},
// mapping:
item.ownedModifierGroups
  .filter(mg => mg.modifiers.length > 0)
  .map(mg => ({
    id: mg.id,
    name: mg.displayName ?? mg.name,
    // ...rest of fields
  }))
```

---

## Seed Update

**File:** `prisma/seed.ts`

All `db.menuItemModifierGroup.create(...)` and `db.menuItemModifierGroup.createMany(...)` calls were removed. Seeded modifier groups now use only `menuItemId` on the `ModifierGroup` record to establish ownership.

---

## Why This Is Better

| Concern | Before (junction table) | After (direct ownership) |
|---------|------------------------|--------------------------|
| Ownership model | Ambiguous — two paths | Single `menuItemId` |
| Read query complexity | Join through junction | Direct relation |
| Cascade delete | Manual cleanup required | `onDelete: Cascade` on `menuItemId` |
| `showOnline` location | Junction row | `ModifierGroup` record itself |
| Online ordering visibility | Only junction-linked groups | All owned groups |
| Write path to toggle visibility | `updateMany` on junction | `update` on the group |
| Groups created by menu builder | Invisible to online ordering | Fully visible |

**No junction to maintain:** Every write path that formerly created or updated `MenuItemModifierGroup` rows is gone. Groups cascade-delete automatically when their parent item is deleted.

**`showOnline` on the record itself:** Visibility is now a property of the group, not a property of the relationship. This is the correct semantic — a group is either online-visible or not, regardless of how it was linked.

**Online ordering fixed:** The online menu API now queries `ownedModifierGroups` directly. Every modifier group created through the menu builder is immediately visible in online ordering without any extra step.

---

## Files Changed

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `showOnline` to `ModifierGroup`; removed `MenuItemModifierGroup` model and its relations |
| `prisma/migrations/[timestamp]_add_showonline_remove_junction/migration.sql` | Data migration SQL: propagate `showOnline=false` and heal orphaned `menuItemId` before dropping junction |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts` | Write `showOnline` to `ModifierGroup` directly instead of junction |
| `src/app/api/menu/route.ts` | Switch to `ownedModifierGroups` for general menu read path |
| `src/app/api/menu/items/[id]/route.ts` | Switch to `ownedModifierGroups` for item detail read path |
| `src/app/api/online/menu/route.ts` | Switch to `ownedModifierGroups` — this is the fix for online ordering |
| `prisma/seed.ts` | Remove all `menuItemModifierGroup.create` / `createMany` calls |

---

## Related Skills

| Skill | Relation |
|-------|----------|
| 143 | Item-Owned Modifier Groups — introduced `menuItemId` on `ModifierGroup` |
| 210 | Modifier Cascade Delete — depends on the cascade relationship this skill formalizes |
| 336 | Online Ordering URL Infrastructure — the online menu pipeline this skill fixes |
