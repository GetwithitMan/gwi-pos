---
skill: 210
title: Modifier Cascade Delete & Orphan Cleanup
status: DONE
depends_on: [143]
---

# Skill 210: Modifier Cascade Delete & Orphan Cleanup

> **Status:** DONE
> **Dependencies:** Skill 143 (Item-Owned Modifier Groups)
> **Last Updated:** 2026-02-06

## Overview

Cascade delete for modifier groups with preview mode and orphaned reference auto-cleanup.

## Features

### Cascade Delete with Preview
- `DELETE /api/menu/items/[id]/modifier-groups/[groupId]?preview=true` returns counts before deletion
- `collectDescendants()` recursive function collects all nested groups + modifiers
- Double confirmation in ItemEditor UI:
  1. First confirm: "Delete X? This will also delete N modifiers and M child groups"
  2. Second confirm (if child groups exist): "Are you SURE?"
- Transaction-based: all-or-nothing deletion

### Orphaned childModifierGroupId Auto-Cleanup
- `formatModifierGroup()` in GET API detects when `childModifierGroupId` points to deleted/missing groups
- Returns `null` to UI instead of stale IDs
- Auto-cleans database in background (fire-and-forget `db.modifier.updateMany`)
- Fixes: hidden +▶ buttons, blocked drop targets, false 🍂 icons

### Fluid Group Nesting
- `nestGroupInGroup()` — auto-creates modifier in target group, reparents dragged group as child
- Drop zones in both top-level and child group expanded sections
- Swap/replace when dropping on modifier with existing child group
- Duplicate group stays within parent (doesn't promote to top level)

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts` | DELETE with preview + cascade |
| `src/app/api/menu/items/[id]/modifier-groups/route.ts` | Orphan detection + auto-cleanup in GET |
| `src/components/menu/ItemEditor.tsx` | Double confirmation UI, nesting, drop zones |

## Related Skills

| Skill | Relation |
|-------|----------|
| 143 | Item-Owned Modifier Groups (foundation) |
| 123 | Menu Builder Child Modifiers |
