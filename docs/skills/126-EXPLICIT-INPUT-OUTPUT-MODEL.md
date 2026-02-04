# Skill 126: Explicit Input → Output Model for Prep Items

## Overview

Enhanced ingredient editor system with explicit input/output transformation tracking for prep items. Instead of implicit 1:1 relationships, prep items now explicitly define how much of the parent item is consumed and how much output is produced.

## The Problem (Before)

The previous system used a simple "portion size" concept:
- Prep item has `portionSize` and `portionUnit`
- Assumed 1 portion of parent = 1 prep item
- No way to capture bulk-to-bulk transformations (6 oz raw → 2 oz cooked)
- Yield calculations were manual and error-prone
- Cost derivation was limited

## The Solution (After)

Explicit Input → Output model:
```
INPUT: 6 oz of Raw Chicken
           ↓
OUTPUT: 2 oz of Shredded Chicken (33% yield)
```

This captures:
- **Bulk → Bulk**: 6 oz raw chicken → 2 oz shredded chicken
- **Bulk → Count**: 1 lb cheese → 16 slices
- **Count → Count**: 1 dough ball → 1 pizza crust

## Schema Changes

### New Fields on Ingredient Model

```prisma
model Ingredient {
  // ========== EXPLICIT INPUT → OUTPUT ==========
  // How much of parent is consumed to make this prep item
  inputQuantity      Decimal?  // e.g., 6 (oz of raw chicken)
  inputUnit          String?   // e.g., "oz" - matches or convertible to parent's unit

  // How much of this prep item is produced
  outputQuantity     Decimal?  @default(1)   // e.g., 2 (oz shredded) or 1 (crust)
  outputUnit         String?   @default("each")  // e.g., "oz" for bulk, "each" for discrete

  // ========== RECIPE BATCH YIELD ==========
  // For inventory items with recipes: how much one batch makes
  recipeYieldQuantity Decimal?  // e.g., 50
  recipeYieldUnit     String?   // e.g., "lb", "gallons", "batches"

  // DEPRECATED: Legacy fields
  portionSize        Decimal?  // Use inputQuantity
  portionUnit        String?   // Use inputUnit
}
```

## New Library Files

### `src/lib/units.ts` - Unit System

Comprehensive unit definitions with categories and precision hints.

```typescript
export interface UnitDefinition {
  value: string           // "oz", "lb", "each", etc.
  label: string           // Display label
  precision: 'whole' | 'decimal'  // Count in integers or allow decimals
  category: 'count' | 'weight' | 'liquid' | 'cooking' | 'portion' | 'package'
  example: string         // Usage examples
}

// 50+ units organized by category
export const OUTPUT_UNITS: UnitDefinition[] = [
  // Count units (whole numbers)
  { value: 'each', label: 'each', precision: 'whole', category: 'count', ... },
  { value: 'slices', label: 'slices', precision: 'whole', category: 'count', ... },
  { value: 'crusts', label: 'crusts', precision: 'whole', category: 'count', ... },

  // Weight units (decimals)
  { value: 'oz', label: 'oz', precision: 'decimal', category: 'weight', ... },
  { value: 'lb', label: 'lb', precision: 'decimal', category: 'weight', ... },
  { value: 'g', label: 'g (grams)', precision: 'decimal', category: 'weight', ... },

  // Volume units
  { value: 'cups', label: 'cups', precision: 'decimal', category: 'liquid', ... },
  { value: 'gallons', label: 'gallons', precision: 'decimal', category: 'liquid', ... },
  // ... etc
]

// Helper functions
export function getUnitPrecision(unit: string): 'whole' | 'decimal'
export function getUnitsByCategory(category: UnitCategory): UnitDefinition[]
export function isWholeUnit(unit: string): boolean
export function isDecimalUnit(unit: string): boolean
export function areUnitsCompatible(unit1: string, unit2: string): boolean
export function getSuggestedUnits(parentUnit: string): UnitDefinition[]
```

### `src/lib/unit-conversions.ts` - Conversion System

Unit conversion and yield calculation functions.

```typescript
// Weight conversions (base: grams)
export const WEIGHT_TO_GRAMS: Record<string, number> = {
  g: 1, kg: 1000, oz: 28.3495, lb: 453.592
}

// Volume conversions (base: milliliters)
export const VOLUME_TO_ML: Record<string, number> = {
  ml: 1, liters: 1000, tsp: 4.92892, tbsp: 14.7868,
  fl_oz: 29.5735, cups: 236.588, pints: 473.176,
  quarts: 946.353, gallons: 3785.41
}

// Convert between compatible units
export function convert(value: number, fromUnit: string, toUnit: string): number | null

// Check if conversion is possible
export function canConvert(fromUnit: string, toUnit: string): boolean

// Calculate yield from input/output
export function calculateYield(
  inputValue: number, inputUnit: string,
  outputValue: number, outputUnit: string
): number | null  // Returns percentage or null if incompatible

// Calculate cost per output unit
export function calculateCostPerOutputUnit(
  parentCostPerUnit: number, parentUnit: string,
  inputQuantity: number, inputUnit: string,
  outputQuantity: number, outputUnit: string
): number | null

// Format transformation for display
export function formatTransformation(
  inputQty: number, inputUnit: string,
  outputQty: number, outputUnit: string
): string  // "6 oz → 2 oz"
```

## New Components

### Split Modal Architecture

The ingredient editor is now split into focused components:

```
IngredientEditorModal (wrapper)
    ├── Type Selection (new items)
    ├── PrepItemEditor (prep items)
    └── InventoryItemEditor (inventory items)
```

### `PrepItemEditor.tsx`

Focused editor for prep items with explicit input/output.

**Features:**
- Parent selection for new items
- Input → Output fields with unit dropdowns
- Auto-derived yield when units are compatible
- Live cost preview from parent
- Validation with warnings
- Daily count settings

**Key UI:**
```
┌─────────────────────────────────────────────────┐
│  How much of [Parent Name] makes this prep item? │
├─────────────────────────────────────────────────┤
│  [6] [oz ▼] of Raw Chicken makes [2] [oz ▼]     │
│                                                  │
│  💡 Estimated cost: $0.75 per oz (33% yield)    │
└─────────────────────────────────────────────────┘
```

### `InventoryItemEditor.tsx`

Focused editor for inventory (purchased) items.

**Features:**
- Delivery size configuration
- Recipe management with components
- Recipe batch yield setting
- Recipe cost calculation preview
- Inventory system linking

### `HierarchyView.tsx`

Tree view component showing inventory item with recipe ingredients above and prep items below.

**Features:**
- Left panel: Collapsible tree structure
- Right panel: Detailed information for selected node
- Recipe ingredients shown above prep items
- Prep items with stock status badges (green/yellow/red)
- Add prep item button
- Generate usage report action (future)

**Structure:**
```
┌─────────────────────┬────────────────────────────────┐
│ Hierarchy           │ Details                        │
├─────────────────────┤                                │
│ ▼ [INV] Raw Chicken │ ┌──────────────────────────┐   │
│   Recipe (2)        │ │ PREP ITEM                │   │
│     [R] Flour       │ │ Shredded Chicken         │   │
│     [R] Salt        │ │                          │   │
│   Prep Items (3)    │ │ Transformation:          │   │
│     [P] Shredded    │ │ 6 oz Raw Chicken → 2 oz  │   │
│     [P] Grilled     │ │ Yield: 33%               │   │
│     [P] Diced       │ │                          │   │
│                     │ │ [Generate Usage Report]  │   │
│     [+ Add]         │ └──────────────────────────┘   │
└─────────────────────┴────────────────────────────────┘
```

**Props:**
```typescript
interface HierarchyViewProps {
  inventoryItemId: string        // Required: inventory item to show
  onClose?: () => void           // Optional: close button handler
  onEditItem?: (id: string, type: 'inventory' | 'prep') => void  // Edit callback
  onAddPrepItem?: (parentId: string) => void  // Add prep item callback
}
```

**Usage:**
```tsx
<HierarchyView
  inventoryItemId={selectedItem.id}
  onClose={() => setShowHierarchy(false)}
  onEditItem={(id, type) => openEditor(id, type)}
  onAddPrepItem={(parentId) => openPrepEditor(parentId)}
/>

## API Endpoints

### Cost Calculation

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ingredients/[id]/cost` | Get cost per unit for an ingredient |
| GET | `/api/ingredients/[id]/hierarchy` | Get full hierarchy for an inventory item |

**Response:**
```json
{
  "costPerUnit": 0.75,
  "costUnit": "oz",
  "costSource": "parent"  // or "recipe", "purchase", "unknown"
}
```

**Cost Sources:**
- `parent`: Derived from parent ingredient using input/output transformation
- `recipe`: Calculated from recipe component costs
- `purchase`: From linked inventory item's purchase price
- `unknown`: No cost data available

### Hierarchy View

**Response:**
```json
{
  "inventoryItem": {
    "id": "inv-123",
    "name": "Raw Chicken Breast",
    "type": "inventory",
    "standardQuantity": 10,
    "standardUnit": "lb",
    "recipeYieldQuantity": null,
    "recipeYieldUnit": null,
    "category": "Proteins",
    "isActive": true,
    "recipeCount": 0,
    "prepCount": 2
  },
  "recipeIngredients": [
    {
      "id": "rc-1",
      "componentId": "ing-flour",
      "name": "All-Purpose Flour",
      "type": "ingredient",
      "quantity": 5,
      "unit": "lb"
    }
  ],
  "prepItems": [
    {
      "id": "prep-1",
      "name": "Shredded Chicken",
      "type": "prep",
      "inputQuantity": 6,
      "inputUnit": "oz",
      "outputQuantity": 2,
      "outputUnit": "oz",
      "yieldPercent": 0.33,
      "isDailyCountItem": true,
      "currentPrepStock": 15,
      "isActive": true
    }
  ]
}

## Cost Calculation Logic

### For Prep Items (derived from parent)

```typescript
// 1. Get parent's cost per unit
const parentCostPerUnit = fetchParentCost()

// 2. Convert input to parent's unit if needed
const inputInParentUnits = convert(inputQuantity, inputUnit, parentUnit)

// 3. Calculate cost of input
const inputCost = parentCostPerUnit * inputInParentUnits

// 4. Divide by output quantity and adjust for yield
const costPerOutputUnit = inputCost / outputQuantity / yieldPercent
```

**Example:**
- Parent: Raw Chicken at $4.00/lb
- Input: 6 oz (= 0.375 lb)
- Output: 2 oz shredded
- Input cost: $4.00 × 0.375 = $1.50
- Cost per oz: $1.50 / 2 = $0.75/oz

### For Recipe-Based Items

```typescript
// 1. Sum component costs
let totalCost = 0
for (const component of recipeComponents) {
  const componentCost = fetchComponentCost(component.id)
  const qty = convertToComponentUnit(component.quantity, component.unit)
  totalCost += componentCost * qty
}

// 2. Divide by recipe yield
const costPerUnit = totalCost / recipeYieldQuantity
```

## Validation

The PrepItemEditor validates:

| Check | Level | Message |
|-------|-------|---------|
| Negative input/output | Error | "Amount cannot be negative" |
| Yield < 0 or > 200 | Error | "Yield % should be between 0 and 200" |
| Input > parent quantity | Warning | "Uses more than one full parent" |
| Incompatible units | Warning | "Input and output are different unit types" |

## Migration from Legacy Fields

The schema maintains backwards compatibility:

```typescript
// Read: Try new fields first, fall back to legacy
const inputQty = ingredient.inputQuantity ?? ingredient.portionSize ?? 1
const inputUnit = ingredient.inputUnit ?? ingredient.portionUnit ?? 'each'

// Write: Always use new fields
data.inputQuantity = inputQty
data.inputUnit = inputUnit
data.outputQuantity = outputQty
data.outputUnit = outputUnit
```

## Usage Examples

### Bulk to Bulk (Cooking Loss)
```
Item: Grilled Chicken Breast
Parent: Raw Chicken Breast (10 lb at $3.50/lb)
Input: 8 oz raw
Output: 6 oz cooked
Yield: 75%
Cost: ($3.50/16) × 8 / 6 = $0.29/oz
```

### Bulk to Count (Portioning)
```
Item: Cheese Slices
Parent: American Cheese (5 lb block at $12/block)
Input: 1 lb
Output: 20 slices
Yield: 100%
Cost: ($12/5) × 1 / 20 = $0.12/slice
```

### Count to Count (Transformation)
```
Item: Pizza Crust
Parent: Dough Ball (each at $0.50)
Input: 1 each (dough ball)
Output: 1 each (crust)
Yield: 100%
Cost: $0.50/crust
```

## Files Changed/Created

### New Files
| File | Purpose |
|------|---------|
| `src/lib/units.ts` | Unit definitions and helpers |
| `src/lib/unit-conversions.ts` | Conversion and yield functions |
| `src/components/ingredients/PrepItemEditor.tsx` | Prep item editor with input/output |
| `src/components/ingredients/InventoryItemEditor.tsx` | Inventory item editor |
| `src/components/ingredients/HierarchyView.tsx` | Tree view with recipe ingredients + prep items |
| `src/app/api/ingredients/[id]/cost/route.ts` | Cost calculation API |
| `src/app/api/ingredients/[id]/hierarchy/route.ts` | Hierarchy data API |

### Modified Files
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Added input/output and recipe yield fields |
| `src/components/ingredients/IngredientEditorModal.tsx` | Refactored to thin wrapper |
| `src/components/ingredients/IngredientLibrary.tsx` | Updated Ingredient interface |

## Future Enhancements

- [ ] Batch cost import from invoices
- [ ] Historical cost tracking
- [ ] Cost variance alerts
- [ ] Unit conversion preferences per location
- [ ] Automatic yield suggestions based on category
