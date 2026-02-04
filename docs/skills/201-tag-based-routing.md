# Skill 201: Tag-Based Routing Engine

## Overview

The Tag-Based Routing Engine replaces scattered routing logic (`MenuItem.printerIds`, `Category.printerIds`, `PizzaConfig.printerIds`, hardcoded pizza checks) with a unified pub/sub system where items publish to `routeTags` and stations subscribe to tags.

## Key Innovation

One physical printer can act as multiple logical stations with different templates.

**Example:** IP `192.168.1.50` serves two stations:
- Station "Pizza Oven" → `PIZZA_STATION` template, tags: `["pizza"]`
- Station "Main Expo" → `EXPO_SUMMARY` template, isExpo: true

Same printer, different ticket formats based on routing.

## Architecture

```
Order Items (with routeTags)
        |
        v
   OrderRouter.resolveRouting()
        |
        +---> RoutingManifest[]
              |
              +-- Station: "Pizza Oven"
              |   type: PRINTER, template: PIZZA_STATION
              |   tags: ["pizza"]
              |
              +-- Station: "Main Expo"
              |   type: KDS, template: EXPO_SUMMARY
              |   isExpo: true (receives ALL items)
              |
              +-- Station: "Grill KDS"
                  type: KDS, template: STANDARD_KITCHEN
                  tags: ["grill", "made-to-order"]
```

## Core Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Station model (lines 3623+) |
| `src/lib/order-router.ts` | OrderRouter class - the routing brain |
| `src/types/routing.ts` | TypeScript types for routing |
| `scripts/migrate-routing.ts` | Migration from old printerIds system |

## Station Model

```prisma
model Station {
  id           String   @id @default(cuid())
  locationId   String
  name         String      // "Pizza Oven", "Main Expo"
  type         String      // "PRINTER" | "KDS"

  // Tag-based routing (the core of pub/sub)
  tags         Json        // ["pizza", "grill", "bar"]
  isExpo       Boolean     // Receives ALL items regardless of tags

  // Template configuration
  templateType String      // STANDARD_KITCHEN, PIZZA_STATION, EXPO_SUMMARY, etc.

  // Network (PRINTER only)
  ipAddress    String?
  port         Int?

  // Reference items
  showReferenceItems Boolean @default(true)
  atomicPrintConfig  Json?

  // ... printer settings, KDS settings, backup/failover
}
```

## OrderRouter API

```typescript
import { OrderRouter } from '@/lib/order-router'

// Route order items to stations
const result = await OrderRouter.resolveRouting(orderId, itemIds?)

// Returns:
{
  order: OrderContext,
  manifests: RoutingManifest[],  // Grouped by station
  unroutedItems: RoutedItem[],   // Items that matched no station
  routingStats: { totalItems, routedItems, stationsUsed, expoItems }
}
```

## Tag Resolution Priority

1. **MenuItem.routeTags** - Explicit tags on the item
2. **Category.routeTags** - Inherited from category
3. **Auto-detect** - Based on category type or item characteristics
   - Pizza data exists → `["pizza"]`
   - Category type `liquor`/`drinks` → `["bar"]`
   - Category type `food` → `["kitchen"]`
   - Item type `timed_rental` → `["entertainment"]`

## Default Route Tags

```typescript
const DEFAULT_ROUTE_TAGS = [
  { tag: 'kitchen', description: 'General kitchen items', autoAssignTo: ['food'] },
  { tag: 'bar', description: 'Bar/drink items', autoAssignTo: ['liquor', 'drinks'] },
  { tag: 'pizza', description: 'Pizza items', autoAssignTo: ['pizza'] },
  { tag: 'grill', description: 'Grill station items' },
  { tag: 'fryer', description: 'Fryer station items' },
  { tag: 'salad', description: 'Cold prep / salad station' },
  { tag: 'expo', description: 'Expo station (receives all)' },
  { tag: 'entertainment', description: 'Entertainment/rental items' },
  { tag: 'made-to-order', description: 'Items requiring cook attention' },
  { tag: 'rush', description: 'Priority/rush items' },
]
```

## Migration Script

```bash
# Migrate all locations
npx ts-node scripts/migrate-routing.ts

# Migrate specific location
npx ts-node scripts/migrate-routing.ts cloc_abc123
```

The migration:
1. Converts existing Printers → Stations with inferred tags
2. Creates Pizza Station from PizzaConfig.printerIds
3. Creates Expo Station if none exists
4. Generates routeTags for Categories based on categoryType
5. Generates routeTags for MenuItems with explicit printerIds

**Non-destructive:** Old `printerIds` fields remain for backwards compatibility.

## Template Types

| Template | Use Case | Key Features |
|----------|----------|--------------|
| `STANDARD_KITCHEN` | General food prep | Compact, qty + item + modifiers |
| `PIZZA_STATION` | Pizza make line | Large fonts, size/crust prominent |
| `EXPO_SUMMARY` | Expo/expeditor | All items, grouped by table |
| `ENTERTAINMENT_TICKET` | Game rentals | Start time, duration, "Return By" |
| `BAR_TICKET` | Bar drinks | Drink-focused formatting |

## Related Skills

- **Skill 202:** Socket.io Real-Time KDS
- **Skill 203:** Reference Items & Atomic Print Configuration

## See Also

- Plan file: `~/.claude/plans/shiny-wondering-eagle.md`
- CHANGELOG: Session 25 (2026-01-31)
