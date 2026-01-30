---
skill: 103
title: Print Routing
status: DONE
depends_on: [67]
---

# Skill 103: Print Routing

> **Status:** DONE
> **Dependencies:** Skill 67
> **Last Updated:** 2026-01-30

## Overview

Advanced print routing with named routes, printer-specific settings, and multi-destination support. Enables different ticket formatting for pizza stations vs bar printers, failover support, and cascading routing rules.

## Architecture

### Routing Priority (Highest Wins)

```
1. PrintRoute (by priority) - Named routes with specific settings
2. Item printerIds - Per-item printer override
3. Category printerIds - Category-level routing
4. Default kitchen printer - Fallback
```

### Route Types

| Type | Description | Use Case |
|------|-------------|----------|
| `pizza` | Pizza items | Route to pizza make line |
| `bar` | Bar/drinks | Route to bar printer |
| `category` | Specific categories | Route appetizers to expo |
| `item_type` | Item types | Route combos differently |

---

## Database Schema (To Be Added)

```prisma
model PrintRoute {
  id            String   @id @default(cuid())
  locationId    String
  location      Location @relation(fields: [locationId], references: [id])

  name          String   // "Pizza Station 1", "Bar Printer"
  description   String?

  // Routing
  routeType     String   // "pizza" | "bar" | "category" | "item_type"
  targetIds     Json?    // Category/item IDs when routeType is "category" or "item_type"

  // Destination
  printerId     String
  printer       Printer  @relation(fields: [printerId], references: [id])
  backupPrinterId String?
  backupPrinter Printer? @relation("BackupPrinter", fields: [backupPrinterId], references: [id])

  // Settings
  printSettings Json?    // RouteSpecificSettings
  printCopies   Int      @default(1)

  // Failover
  failoverEnabled Boolean @default(false)
  failoverDelayMs Int     @default(5000)

  // Status
  priority      Int      @default(0)  // Higher = checked first
  isActive      Boolean  @default(true)

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([locationId, name])
  @@index([locationId])
  @@index([routeType])
}
```

---

## Types

### RouteSpecificSettings

```typescript
interface RouteSpecificSettings {
  base: BasePrintSettings
  impact?: ImpactPrinterSettings  // For TM-U220
  thermal?: ThermalPrinterSettings // For TM-T88
  pizza?: PizzaPrintSettings
  bar?: BarPrintSettings
}

interface BasePrintSettings {
  textSizing: TextSizing
  printQuantityOnLine: boolean
  printModifiersIndented: boolean
  separatorStyle: 'none' | 'dashed' | 'solid' | 'double'
}

interface TextSizing {
  headerSize: 'normal' | 'double_height' | 'double_width' | 'double_both'
  itemSize: 'normal' | 'double_height' | 'double_width' | 'double_both'
  modifierSize: 'normal' | 'double_height' | 'double_width' | 'double_both'
  footerSize: 'normal' | 'double_height' | 'double_width' | 'double_both'
}

interface ImpactPrinterSettings {
  useRedForHeaders: boolean    // Red ribbon for TM-U220
  useRedForModifiers: boolean
  useRedForQuantity: boolean
  useRedForAlerts: boolean
}

interface ThermalPrinterSettings {
  printLogo: boolean
  logoAlignment: 'left' | 'center' | 'right'
  useInverseForHeaders: boolean
}

interface PizzaPrintSettings {
  printSectionLabels: boolean   // "LEFT HALF", "WHOLE", etc.
  groupBySection: boolean
  highlightWholeChanges: boolean
  printSizeProminent: boolean
  printCrustFirst: boolean
}

interface BarPrintSettings {
  printGarnish: boolean
  printIcePreference: boolean
  highlightModifiers: boolean
  separateMixerLine: boolean
}
```

---

## API Endpoints

### Print Routes CRUD

```
GET    /api/hardware/print-routes              - List all routes
POST   /api/hardware/print-routes              - Create route
GET    /api/hardware/print-routes/[id]         - Get single route
PUT    /api/hardware/print-routes/[id]         - Update route
DELETE /api/hardware/print-routes/[id]         - Delete route
POST   /api/hardware/print-routes/[id]/test    - Test print route
```

### Route Resolution

```
POST   /api/hardware/print-routes/resolve
Body: { itemIds: string[], categoryIds: string[] }
Returns: { [itemId]: { printerId, settings } }
```

---

## Admin UI

### Location

`/settings/hardware/routing`

### Features

**Print Routes Section:**
- Add/Edit/Delete named routes
- Route type badges (color-coded)
- Printer assignment with backup
- Settings configuration (text size, red ribbon, etc.)
- Test print button
- Priority ordering

**Category & Item Routing Section:**
- Expandable category list
- Per-category printer dropdown
- Per-item printer override dropdown
- Inherits from category when not set

---

## Component Files

| File | Purpose |
|------|---------|
| `src/types/print-route-settings.ts` | Type definitions |
| `src/components/hardware/PrintRouteEditor.tsx` | Route editor modal |
| `src/app/(admin)/settings/hardware/routing/page.tsx` | Admin page |
| `src/app/api/hardware/print-routes/route.ts` | List/Create API |
| `src/app/api/hardware/print-routes/[id]/route.ts` | Get/Update/Delete API |
| `src/app/api/hardware/print-routes/[id]/test/route.ts` | Test print API |

---

## Integration Points

### Kitchen Print Flow

When printing to kitchen (`/api/print/kitchen`):

1. Get items to print
2. For each item, resolve routing:
   - Check PrintRoute by priority (if model exists)
   - Check item.printerIds
   - Check item.category.printerIds
   - Fall back to default kitchen printer
3. Group items by target printer
4. Apply route-specific settings
5. Build ESC/POS document
6. Send to printer(s)

### Current Implementation

`src/app/api/print/kitchen/route.ts` already handles:
- Pizza items → pizzaConfig.printerIds
- Item printerIds (array)
- Category printerIds (array)
- Default kitchen printer fallback

---

## Multi-Printer Support

Both Category and MenuItem support `printerIds` (JSON array) for multi-destination:

```typescript
// Category with multiple printers
category.printerIds = ["printer-kitchen-1", "printer-expo"]

// Item with multiple printers (overrides category)
item.printerIds = ["printer-grill", "printer-expo"]
```

Items print to ALL specified printers (e.g., grill station AND expo).

---

## Implementation Checklist

### Phase 1: Foundation (DONE)
- [x] Create RouteSpecificSettings types
- [x] Create PrintRouteEditor component
- [x] Create admin routing page
- [x] Add stub API routes
- [x] Fix printerId → printerIds mismatches

### Phase 2: Database & API (TODO)
- [ ] Add PrintRoute model to schema
- [ ] Run migration
- [ ] Implement full CRUD in API routes
- [ ] Add route resolution endpoint

### Phase 3: Integration (TODO)
- [ ] Update kitchen print to check PrintRoutes first
- [ ] Apply RouteSpecificSettings to ticket builder
- [ ] Add print job logging
- [ ] Implement failover logic

### Phase 4: Polish (TODO)
- [ ] Live preview in editor
- [ ] Drag-drop priority ordering
- [ ] Route testing with sample ticket
- [ ] Print job history view

---

## Related Skills

| Skill | Relation |
|-------|----------|
| 55 | Receipt Printer - Hardware integration |
| 67 | Prep Stations - KDS routing (complementary) |
| 102 | KDS Device Security - Device authentication |
| 08 | Receipt Printing - Print formatting |

---

## Example Usage

### Create Pizza Route

```typescript
// POST /api/hardware/print-routes
{
  name: "Pizza Station 1",
  routeType: "pizza",
  printerId: "printer-pizza-line",
  backupPrinterId: "printer-kitchen-main",
  failoverEnabled: true,
  failoverDelayMs: 3000,
  printCopies: 1,
  priority: 100,
  printSettings: {
    base: {
      textSizing: {
        headerSize: "double_both",
        itemSize: "double_height",
        modifierSize: "normal",
        footerSize: "normal"
      },
      printQuantityOnLine: true,
      printModifiersIndented: true,
      separatorStyle: "dashed"
    },
    impact: {
      useRedForHeaders: true,
      useRedForAlerts: true,
      useRedForModifiers: false,
      useRedForQuantity: true
    },
    pizza: {
      printSectionLabels: true,
      groupBySection: true,
      highlightWholeChanges: true,
      printSizeProminent: true,
      printCrustFirst: true
    }
  }
}
```

### Routing Resolution Example

```
Item: "Large Pepperoni Pizza"
1. Check PrintRoutes where routeType='pizza' → Pizza Station 1 (priority 100)
2. Result: Print to printer-pizza-line with pizza-specific settings

Item: "Margherita"
1. Check PrintRoutes → Bar Printer (priority 50, routeType='bar')
2. No match, check item.printerIds → null
3. Check category.printerIds → ["printer-bar"]
4. Result: Print to printer-bar with default settings
```
