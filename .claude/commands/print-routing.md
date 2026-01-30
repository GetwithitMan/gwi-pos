# Print Routing (Skill 103)

## Overview

Configure which printers and KDS screens receive orders for categories, items, and modifiers. Supports multiple destinations with backup failover.

## Admin Locations

- `/settings/hardware/routing` - Dedicated print routing configuration page
- `/menu` - Edit Item/Category modals include destination selection

## Routing Priority

```
Item destinations → Category destinations → Default kitchen printer
```

Items can override category settings. Empty destinations inherit from parent.

## Database Schema

### Category
```prisma
model Category {
  // ...
  printerIds Json?  // Array of printer/KDS IDs: ["printer-1", "kds-2"]
}
```

### MenuItem
```prisma
model MenuItem {
  // ...
  printerIds       Json?  // Override category destinations
  backupPrinterIds Json?  // Failover if primary fails
}
```

### Modifier
```prisma
model Modifier {
  // ...
  printerRouting String @default("follow")  // "follow" | "also" | "only"
  printerIds     Json?  // Used when routing is "also" or "only"
}
```

## Modifier Routing Modes

| Mode | Behavior |
|------|----------|
| `follow` | Prints with the main item (default) |
| `also` | Prints with main item AND to specified destinations |
| `only` | Prints ONLY to specified destinations, not with main item |

**Use Cases:**
- `follow` - Most modifiers (toppings, cooking temps)
- `also` - Dinner salad modifier also goes to salad station
- `only` - Side item routes only to its prep station

## Print Destinations

Both printers and KDS screens can be destinations:

| Type | Color | Description |
|------|-------|-------------|
| Printer | Blue | Physical receipt/kitchen printers |
| KDS | Green | Kitchen display screens |
| Backup | Orange | Failover destinations |

## API Endpoints

### Categories
```
PUT /api/menu/categories/[id]
Body: { printerIds: ["printer-1", "kds-2"] }
```

### Items
```
PUT /api/menu/items/[id]
Body: {
  printerIds: ["printer-1"],
  backupPrinterIds: ["printer-2"]
}
```

### Modifiers
```
PUT /api/menu/modifiers/[id]
Body: {
  modifiers: [{
    id: "mod-1",
    printerRouting: "also",
    printerIds: ["salad-printer"]
  }]
}
```

## UI Components

### Routing Page (`/settings/hardware/routing`)
- Shows all categories with expandable items
- Toggle buttons for quick destination assignment
- Category-level and item-level overrides
- Backup destination configuration

### Edit Item/Category Modals
- Dropdown with checkboxes for multi-select
- Grouped by type: "Printers" and "KDS Screens"
- Shows role/type badge (kitchen, bar, kds)
- Backup destinations only shown when primary selected

## Key Files

- `src/app/(admin)/settings/hardware/routing/page.tsx` - Routing config page
- `src/app/(admin)/menu/page.tsx` - Item/Category modals with destination select
- `src/app/api/menu/categories/[id]/route.ts` - Category printerIds API
- `src/app/api/menu/items/[id]/route.ts` - Item printerIds API
- `src/app/api/menu/modifiers/[id]/route.ts` - Modifier routing API
- `src/app/api/print/kitchen/route.ts` - Print routing logic

## Kitchen Print Routing Logic

```typescript
// In /api/print/kitchen/route.ts
for (const item of itemsToPrint) {
  let targetPrinterIds: string[] = []

  const itemPrinterIds = item.menuItem?.printerIds as string[] | null
  const categoryPrinterIds = item.menuItem?.category?.printerIds as string[] | null

  if (itemPrinterIds && itemPrinterIds.length > 0) {
    targetPrinterIds = itemPrinterIds
  } else if (categoryPrinterIds && categoryPrinterIds.length > 0) {
    targetPrinterIds = categoryPrinterIds
  } else if (defaultKitchenPrinter) {
    targetPrinterIds = [defaultKitchenPrinter.id]
  }

  // Add item to each target destination
  for (const printerId of targetPrinterIds) {
    itemsByPrinter.get(printerId)?.push(item)
  }
}
```

## Examples

### Category Routing
- Entrees category → Kitchen Printer + Expo KDS
- Drinks category → Bar Printer
- Appetizers category → Kitchen Printer + Salad Station

### Item Override
- Burger → Kitchen Printer (inherits from Entrees)
- Grilled Salmon → Grill Station (override)
- Wings → Fryer Station + Kitchen Printer (multiple)

### Modifier Routing
- Side Salad modifier → `also` → Salad Printer
- Cooking Temp modifier → `follow` (prints with steak)
- Gift Card modifier → `only` → Receipt Printer

## Troubleshooting

### Items Not Printing
1. Check item has destinations or category has destinations
2. Verify at least one default kitchen printer exists
3. Check printer/KDS is active and online

### Wrong Destination
1. Item overrides take priority over category
2. Check if item has explicit destinations set
3. Clear item destinations to inherit from category
