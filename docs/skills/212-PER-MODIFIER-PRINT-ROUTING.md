---
skill: 212
title: Per-Modifier Print Routing
status: DONE
depends_on: [103, 143]
---

# Skill 212: Per-Modifier Print Routing

> **Status:** DONE (UI + API configuration complete; print dispatch integration pending in Hardware domain)
> **Dependencies:** Skill 103 (Print Routing), Skill 143 (Item-Owned Groups)
> **Last Updated:** 2026-02-06

## Overview

Each individual modifier can decide where it prints — following the parent item's printer, printing to additional printers, or printing only to specific printers. This enables fine-grained routing like "Extra Bacon" → Kitchen, "Add Espresso Shot" → Bar.

## Schema (Already Existed in Prisma)

```prisma
model Modifier {
  // ...existing fields...
  printerRouting  String   @default("follow")  // "follow" | "also" | "only"
  printerIds      Json?                         // Array of printer IDs
}
```

## Routing Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `follow` | Prints wherever parent item prints | Default — most modifiers |
| `also` | Prints to parent's printer(s) AND additional printers | "Add Espresso Shot" → item's kitchen + bar printer |
| `only` | Prints ONLY to specified printers, NOT parent's | "Add Wine Pairing" → bar printer only |

## Admin UI (ItemEditor)

- 🖨️ button on each modifier row
- Color-coded: Gray (follow), Blue (also), Orange (only)
- Dropdown with routing mode selection
- Printer checkbox list for "also" and "only" modes
- Printers fetched from `GET /api/hardware/printers`

## API Endpoints Updated

| Endpoint | Method | Changes |
|----------|--------|---------|
| `GET /api/menu/items/[id]/modifier-groups` | GET | Returns `printerRouting` + `printerIds` per modifier |
| `POST .../modifiers` | POST | Accepts `printerRouting` + `printerIds` |
| `PUT .../modifiers` | PUT | Accepts `printerRouting` + `printerIds` |
| `PUT .../[groupId]` | PUT | Response includes `printerRouting` + `printerIds` |

## Key Files

| File | Purpose |
|------|---------|
| `src/components/menu/ItemEditor.tsx` | 🖨️ button, dropdown, printer selection |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/modifiers/route.ts` | POST/PUT accept routing fields |
| `src/app/api/menu/items/[id]/modifier-groups/route.ts` | GET returns routing fields |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts` | PUT response includes routing fields |

## Integration with Hardware Domain (Skill 103)

**⚠️ FOR HARDWARE DOMAIN TEAM:**

When implementing print dispatch (Skill 103 Phase 3):

1. After resolving item-level routing, iterate each `OrderItemModifier`
2. Look up the `Modifier` record's `printerRouting` and `printerIds`
3. Apply routing logic:
   - `"follow"` → No action, modifier prints with item
   - `"also"` → Send modifier to item's printer(s) + `printerIds`
   - `"only"` → Send modifier ONLY to `printerIds`
4. Group by destination printer for efficient ticket generation

### Print Routing Priority (Updated)
```
1. PrintRoute (by priority) — Named routes with specific settings
2. Modifier printerRouting — Per-modifier override ("also"/"only")
3. Item printerIds — Per-item printer override
4. Category printerIds — Category-level routing
5. Default kitchen printer — Fallback
```

## Related Skills

| Skill | Relation |
|-------|----------|
| 103 | Print Routing (foundation, pending Phase 3 integration) |
| 55 | Receipt Printer (hardware integration) |
| 67 | Prep Stations (KDS routing) |
| 143 | Item-Owned Modifier Groups (modifier data structure) |
