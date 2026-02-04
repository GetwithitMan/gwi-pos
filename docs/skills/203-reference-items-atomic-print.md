# Skill 203: Reference Items & Atomic Print Configuration

## Overview

Two complementary features that enhance kitchen ticket usability:

1. **Reference Items** - Shows other items in an order that go to different stations
2. **Atomic Print Configuration** - Per-element print formatting for complete control

## Reference Items

### Problem
When a grill station receives a burger ticket, the cook has no idea if there's also a pizza in the order. This leads to poor timing coordination.

### Solution
Show "reference items" - other items in the order that go to different stations.

```
┌──────────────────────────────────┐
│       *** GRILL STATION ***      │
│            Order #1234           │
│══════════════════════════════════│
│ 1x  Bacon Cheeseburger           │
│     - No Onions                  │
│     - Extra Pickles              │
│                                  │
│ 1x  Grilled Chicken Sandwich     │
│     - Side Salad                 │
│──────────────────────────────────│
│ --- OTHER ITEMS IN ORDER ---     │
│ 1x  Large Pepperoni (Pizza)      │
│ 2x  Mozzarella Sticks (Fryer)    │
└──────────────────────────────────┘
```

### Implementation

**Schema:**
```prisma
model Station {
  // ...
  showReferenceItems Boolean @default(true)
}
```

**RoutingManifest:**
```typescript
interface RoutingManifest {
  // Items that matched this station's tags
  primaryItems: RoutedItem[]

  // Other items in the order (for context)
  referenceItems: RoutedItem[]

  // Whether to display reference items
  showReferenceItems: boolean

  // Legacy (for backwards compatibility)
  items: RoutedItem[]
}
```

**OrderRouter Logic:**
```typescript
// In routeItemsToStations()
for (const [stationId, manifest] of manifestMap) {
  const station = stations.find(s => s.id === stationId)
  const showReferenceItems = station?.showReferenceItems ?? true

  if (showReferenceItems && !manifest.isExpo) {
    // Find items NOT in this station's primary items
    const primaryItemIds = new Set(manifest.primaryItems.map(i => i.id))
    manifest.referenceItems = items.filter(item => !primaryItemIds.has(item.id))
  }
}
```

### When to Disable

- **Expo stations** - Already see all items, don't need reference
- **High-volume stations** - Reference items might clutter tickets
- **Single-station setups** - No other stations to reference

---

## Atomic Print Configuration

### Problem
Print settings are currently all-or-nothing. Want to:
- Make station name extra large and reversed (white on black)
- Keep order number large but not reversed
- Show server name small and right-aligned
- Use different divider styles between sections

### Solution
Per-element configuration with full control over each component.

### Configuration Structure

```typescript
interface AtomicPrintConfig {
  // Header elements
  headers: {
    stationName?: PrintElementConfig    // "GRILL STATION"
    orderNumber?: PrintElementConfig    // "Order #1234"
    tabName?: PrintElementConfig        // "Tab: Smith Party"
    tableName?: PrintElementConfig      // "Table 5"
    serverName?: PrintElementConfig     // "Server: Jane"
    timestamp?: PrintElementConfig      // "1:45 PM"
    orderType?: PrintElementConfig      // "DINE IN" / "TAKEOUT"
  }

  // Divider styles between sections
  dividers: {
    afterHeader?: DividerStyle
    betweenItems?: DividerStyle
    beforeFooter?: DividerStyle
    afterReferenceHeader?: DividerStyle
  }

  // Item display settings
  items: {
    quantity?: PrintElementConfig       // "2x"
    name?: PrintElementConfig           // "Burger"
    modifiers?: PrintElementConfig      // "  - No Onions"
    specialNotes?: PrintElementConfig   // "** Allergy: Nuts **"
    seatNumber?: PrintElementConfig     // "Seat 3"
    sourceTable?: PrintElementConfig    // "T4-S2" (T-S notation)
  }

  // Reference items section
  referenceItems: {
    headerText?: string                 // "--- OTHER ITEMS ---"
    headerConfig?: PrintElementConfig
    itemConfig?: PrintElementConfig     // Typically smaller/lighter
  }

  // Footer elements
  footer: {
    itemCount?: PrintElementConfig      // "Items: 5"
    virtualGroupInfo?: PrintElementConfig // "Linked: T5, T6"
    resendIndicator?: PrintElementConfig  // "*** RESEND #2 ***"
  }
}
```

### Element Configuration

```typescript
interface PrintElementConfig {
  enabled: boolean              // Show or hide
  align: 'left' | 'center' | 'right'
  size: 'small' | 'normal' | 'large' | 'xlarge'
  reverse: boolean              // White on black (inverse)
  bold?: boolean
  prefix?: string               // Text before value
  suffix?: string               // Text after value
}
```

### Divider Styles

```typescript
type DividerStyle =
  | 'none'        // No divider
  | 'single-line' // ────────────────
  | 'double-line' // ════════════════
  | 'dashed'      // - - - - - - - -
  | 'dots'        // ................
  | 'stars'       // ****************
  | 'equals'      // ================
```

### Default Configuration

```typescript
const DEFAULT_ATOMIC_PRINT_CONFIG: AtomicPrintConfig = {
  headers: {
    stationName: { enabled: true, align: 'center', size: 'xlarge', reverse: true },
    orderNumber: { enabled: true, align: 'center', size: 'large', reverse: false },
    tabName: { enabled: true, align: 'left', size: 'normal', reverse: false },
    tableName: { enabled: true, align: 'left', size: 'normal', reverse: false },
    serverName: { enabled: true, align: 'left', size: 'small', reverse: false },
    timestamp: { enabled: true, align: 'right', size: 'small', reverse: false },
    orderType: { enabled: false, align: 'center', size: 'normal', reverse: false },
  },
  dividers: {
    afterHeader: 'double-line',
    betweenItems: 'none',
    beforeFooter: 'single-line',
    afterReferenceHeader: 'dashed',
  },
  items: {
    quantity: { enabled: true, align: 'left', size: 'large', reverse: false, bold: true },
    name: { enabled: true, align: 'left', size: 'large', reverse: false, bold: true },
    modifiers: { enabled: true, align: 'left', size: 'normal', reverse: false, prefix: '  - ' },
    specialNotes: { enabled: true, align: 'left', size: 'normal', reverse: true, prefix: '** ', suffix: ' **' },
    seatNumber: { enabled: true, align: 'left', size: 'small', reverse: false, prefix: 'Seat ' },
    sourceTable: { enabled: true, align: 'left', size: 'normal', reverse: false },
  },
  referenceItems: {
    headerText: '--- OTHER ITEMS IN ORDER ---',
    headerConfig: { enabled: true, align: 'center', size: 'small', reverse: false },
    itemConfig: { enabled: true, align: 'left', size: 'small', reverse: false },
  },
  footer: {
    itemCount: { enabled: false, align: 'left', size: 'small', reverse: false },
    virtualGroupInfo: { enabled: true, align: 'center', size: 'small', reverse: false },
    resendIndicator: { enabled: true, align: 'center', size: 'large', reverse: true, prefix: '*** RESEND #', suffix: ' ***' },
  },
}
```

---

## Core Files

| File | Purpose |
|------|---------|
| `src/types/routing.ts` | AtomicPrintConfig types, PrintElementConfig |
| `src/lib/order-router.ts` | primaryItems/referenceItems separation |
| `prisma/schema.prisma` | showReferenceItems, atomicPrintConfig fields |

## Future: Visual Editor

Planned UI for configuring atomic print settings:
- Drag-and-drop element ordering
- Live preview as you adjust settings
- Station-specific configurations
- Import/export configurations

## Related Skills

- **Skill 201:** Tag-Based Routing Engine
- **Skill 202:** Socket.io Real-Time KDS

## See Also

- CHANGELOG: Session 25 (2026-01-31)
- Types: `src/types/routing.ts` (AtomicPrintConfig, PrintElementConfig)
