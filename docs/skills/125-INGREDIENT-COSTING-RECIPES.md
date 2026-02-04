# Skill 125: Ingredient Costing & Recipe System

## Overview

Complete ingredient tracking system that enables full cost calculation from raw materials through menu items, including prep yields, portion sizes, and modifier adjustments.

## The Complete Tracking Flow

```
RAW MATERIALS (Flour, Yeast, Oil, Water)
    ↓ Recipe (IngredientRecipe model)
INVENTORY ITEM (Pizza Dough - 5 lb batch)
    ↓ Batch Yield + Yield %
PREP ITEMS (Personal Crust 8", Large Crust 14")
    ↓ Portion Size + Modifiers (Lite/Extra/No)
MENU ITEMS (Personal Pizza, Large Supreme)
```

## Schema Changes

### New Model: IngredientRecipe

Links inventory items to their component raw materials.

```prisma
model IngredientRecipe {
  id          String   @id @default(cuid())
  locationId  String
  location    Location @relation(fields: [locationId], references: [id])

  // The output item (what gets made) - e.g., Pizza Dough
  outputId    String
  output      Ingredient @relation("RecipeOutput", fields: [outputId], references: [id], onDelete: Cascade)

  // The component/raw material used - e.g., Flour
  componentId String
  component   Ingredient @relation("RecipeComponent", fields: [componentId], references: [id])

  // How much of the component is needed
  quantity    Decimal   // e.g., 2
  unit        String    // e.g., "lb"

  // For batch recipes - this makes X units of output
  batchSize   Decimal?
  batchUnit   String?

  sortOrder   Int       @default(0)

  // Standard fields
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?
  syncedAt    DateTime?

  @@unique([outputId, componentId])
  @@index([locationId])
  @@index([outputId])
  @@index([componentId])
}
```

### New Fields on Ingredient Model

```prisma
// For prep items - portion and costing
portionSize        Decimal?  // e.g., 3 oz per serving
portionUnit        String?   // e.g., "oz", "slices", "each"

// Recipe relations
recipeComponents   IngredientRecipe[] @relation("RecipeOutput")
usedInRecipes      IngredientRecipe[] @relation("RecipeComponent")
```

## API Endpoints

### Recipe Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ingredients/[id]/recipe` | Get recipe components for an ingredient |
| POST | `/api/ingredients/[id]/recipe` | Add a component to the recipe |
| PUT | `/api/ingredients/[id]/recipe` | Update a recipe component |
| DELETE | `/api/ingredients/[id]/recipe?recipeId=X` | Remove a component |

### Request/Response Examples

**Add Recipe Component:**
```json
POST /api/ingredients/{pizzaDoughId}/recipe
{
  "componentId": "flour-id",
  "quantity": 2,
  "unit": "lb"
}
```

**Response:**
```json
{
  "data": {
    "id": "recipe-123",
    "componentId": "flour-id",
    "component": {
      "id": "flour-id",
      "name": "All-Purpose Flour",
      "standardQuantity": 25,
      "standardUnit": "lb"
    },
    "quantity": 2,
    "unit": "lb",
    "sortOrder": 0
  }
}
```

## UI Components

### Inventory Item Editor

New "🧪 Recipe - What makes this item?" collapsible section:
- Shows current recipe components with quantity/unit
- Dropdown to add new components from available ingredients
- Remove button for each component
- Cost calculation preview

### Prep Item Editor

Complete costing fields:

1. **Batch Yield** (green box)
   - "From 1 lb of Chicken, you get → [14] [oz]"
   - Quick presets: 8, 10, 12, 16, 20, 24

2. **Yield %** (amber box)
   - Cooking/prep loss percentage
   - Quick buttons: 85%, 90%, 94%, 100%
   - Shows loss calculation

3. **Portion Size** (blue box)
   - How much per serving
   - Calculates servings per batch

4. **Modifier Amounts** (purple box)
   - Lite multiplier (default 0.5×)
   - Extra multiplier (default 2.0×)
   - Shows calculated amounts for Normal/Lite/Extra/No

### Daily Count Badge

Prep items marked for daily counting show "📋 Daily" badge in hierarchy view.

## Cost Calculation Logic

### Example: Grilled Chicken on a Sandwich

```
Raw Chicken: $5.00/lb (16 oz)
├── Yield: 94% (16 oz × 0.94 = 15.04 oz usable after grilling)
├── Cost per oz grilled: $5.00 ÷ 15.04 = $0.332/oz
├── Portion: 3 oz per serving
├── Cost per portion: $0.332 × 3 = $0.996
└── Modifiers:
    ├── Normal (1.0×): 3 oz × $0.332 = $0.996
    ├── Lite (0.5×): 1.5 oz × $0.332 = $0.498
    ├── Extra (2.0×): 6 oz × $0.332 = $1.992
    └── No (0×): $0.00
```

### Example: Pizza Dough Recipe

```
Pizza Dough Recipe (makes 5 lb batch):
├── Flour: 3 lb × $0.50/lb = $1.50
├── Yeast: 0.5 oz × $0.10/oz = $0.05
├── Oil: 4 oz × $0.08/oz = $0.32
├── Water: 1 lb × $0.00/lb = $0.00
└── Total batch cost: $1.87

Batch Yield: 5 lb dough = 80 oz
├── Personal Crust (8"): 6 oz → $1.87 ÷ 80 × 6 = $0.14/crust
├── Medium Crust (12"): 12 oz → $1.87 ÷ 80 × 12 = $0.28/crust
└── Large Crust (14"): 16 oz → $1.87 ÷ 80 × 16 = $0.37/crust
```

## Files Modified

### Schema
- `prisma/schema.prisma` - Added IngredientRecipe model, portionSize/portionUnit fields

### API Routes
- `src/app/api/ingredients/[id]/recipe/route.ts` - NEW: Recipe CRUD
- `src/app/api/ingredients/[id]/route.ts` - Added portionSize, portionUnit support
- `src/app/api/ingredients/route.ts` - Added portionSize, portionUnit, multipliers to responses

### Components
- `src/components/ingredients/IngredientEditorModal.tsx` - Complete rewrite with:
  - Recipe components section for inventory items
  - Batch yield, yield %, portion size, modifier multipliers for prep items
  - Daily count checkbox
  - Improved UX with collapsible sections

- `src/components/ingredients/IngredientHierarchy.tsx`
  - Added "📋 Daily" badge for daily count items
  - Alphabetical sorting for categories and prep items

## Integration Points

### For PMX (Product Mix) Reports
- Track ingredient usage per menu item
- Apply modifier multipliers (Lite/Extra/No)
- Roll up to raw material consumption

### For Inventory Deduction
- On order paid: deduct based on portion size × modifier
- Apply yield % to calculate raw usage
- Cascade through recipe components

### For Cost Reports
- Calculate theoretical food cost from recipes
- Compare to actual (via invoices/counts)
- Identify variance by ingredient

## Future Enhancements

1. **Invoice Integration**: Link recipe components to vendor invoices for automatic cost updates
2. **Waste Tracking**: Track cooking loss separately from trim waste
3. **Batch Production**: Record when batches are made, track inventory of made items
4. **Alerts**: Low stock alerts based on recipe component usage
5. **Suggested Orders**: Calculate order quantities based on projected sales
