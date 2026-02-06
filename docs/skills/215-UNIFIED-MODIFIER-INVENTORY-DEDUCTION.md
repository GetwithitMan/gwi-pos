# Skill 215: Unified Modifier Inventory Deduction

## Status: Implemented (Feb 2026)

## Problem
Modifiers linked to ingredients via the Menu Builder UI (`Modifier.ingredientId`) were not
triggering inventory deductions at payment time. The deduction engine only checked
`ModifierInventoryLink` records, which the Menu Builder never creates.

This created a silent inventory discrepancy: servers would add modifiers like "Extra Bacon"
or "Add Avocado" through the Menu Builder interface, but the system never deducted those
ingredients from inventory when orders were paid. This led to:
- Inaccurate inventory levels
- Flawed variance reports (Actual vs Theoretical)
- Incorrect food cost calculations in PMIX reports
- Loss prevention blind spots

## Solution
Extended the deduction engine with a fallback path: when a modifier has no `ModifierInventoryLink`,
the engine now checks `Modifier.ingredientId → Ingredient.inventoryItemId → InventoryItem`.

### Two Deduction Paths

| Path | Source | Quantity | Unit | Precedence |
|------|--------|----------|------|------------|
| ModifierInventoryLink | Legacy admin link | `link.usageQuantity` | `link.usageUnit` | Primary (checked first) |
| Modifier.ingredientId | Menu Builder UI | `ingredient.standardQuantity` (default: 1) | `ingredient.standardUnit` | Fallback |

**Path A (ModifierInventoryLink)** is the legacy approach where admins manually create
inventory links in the modifiers admin UI. This path has explicit usage quantity and unit
on the link record itself.

**Path B (Modifier.ingredientId)** is the modern approach where the Menu Builder UI links
modifiers to ingredients. The ingredient's `standardQuantity` and `standardUnit` define
how much to deduct per modifier selection.

**Precedence**: Path A (inventoryLink) takes precedence when both exist. This preserves
backward compatibility for any manually-configured links.

### How It Works
1. Order is paid → `deductInventoryForOrder()` fires
2. For each modifier on each order item:
   - **a.** Check `modifier.inventoryLink.inventoryItem` — if found, use it (existing behavior)
   - **b.** If no inventoryLink, check `modifier.ingredient.inventoryItem` — use `standardQuantity` and `standardUnit`
3. Apply pre-modifier multipliers (NO=0, LITE=0.5, EXTRA=2.0)
4. Apply unit conversion if needed (e.g., "each" → grams)
5. Aggregate by inventoryItemId, deduct stock, create transaction records

**Code Example:**
```typescript
// Check both paths for inventory deduction
if (mod.modifier?.inventoryLink?.inventoryItem) {
  // Path A: ModifierInventoryLink (legacy)
  const invItem = mod.modifier.inventoryLink.inventoryItem
  const quantity = mod.modifier.inventoryLink.usageQuantity ?? 1
  const unit = mod.modifier.inventoryLink.usageUnit ?? invItem.storageUnit
  // ... deduct logic
} else if (mod.modifier?.ingredient?.inventoryItem) {
  // Path B: Modifier.ingredientId (Menu Builder)
  const invItem = mod.modifier.ingredient.inventoryItem
  const quantity = mod.modifier.ingredient.standardQuantity ?? 1
  const unit = mod.modifier.ingredient.standardUnit ?? invItem.storageUnit
  // ... deduct logic
}
```

### "NO" Modifier Intelligence
When a customer says "No Ranch" on a burger that has ranch in its base recipe, the system:
1. Detects the "NO" modifier on the ranch modifier
2. Resolves the ranch modifier's inventoryItemId (via EITHER path)
3. Adds that inventoryItemId to `removedIngredientIds`
4. Skips deducting ranch from the base recipe ingredients

Both paths are checked for "NO" detection:
- `mod.modifier?.inventoryLink?.inventoryItemId` (Path A)
- `mod.modifier?.ingredient?.inventoryItem?.id` (Path B)

**Example:**
```
Menu Item: Classic Burger (has Ranch in base recipe)
Modifier: "No Ranch" (preModifier = "no")

Base recipe wants to deduct: 1 oz Ranch
Modifier path resolves: Ranch → inventoryItemId = "ranch-123"
System behavior: Skip deducting "ranch-123" from base recipe
Result: 0 oz Ranch deducted (correct!)
```

This prevents "negative deductions" where the system would deduct the base amount, then
try to add it back due to the "NO" modifier. Instead, it simply skips the base deduction.

## Functions Updated

| Function | File | Purpose |
|----------|------|---------|
| `ORDER_INVENTORY_INCLUDE` | `inventory-calculations.ts` | Shared Prisma include constant — added `ingredient` select |
| `deductInventoryForOrder()` | `inventory-calculations.ts` | Payment-time deduction — added ingredient fallback + NO detection |
| `deductInventoryForVoidedItem()` | `inventory-calculations.ts` | Void waste deduction — same pattern |
| `calculateTheoreticalUsage()` | `inventory-calculations.ts` | AvT report theoretical calc — same pattern (no currentStock) |
| PMIX GET handler | `reports/pmix/route.ts` | Product mix report — added ingredient fallback for food cost |

### ORDER_INVENTORY_INCLUDE Constant
This shared Prisma include was extended to fetch both paths:
```typescript
const ORDER_INVENTORY_INCLUDE = {
  items: {
    include: {
      modifiers: {
        include: {
          modifier: {
            include: {
              inventoryLink: { include: { inventoryItem: true } },  // Path A
              ingredient: { include: { inventoryItem: true } },      // Path B (NEW)
            },
          },
        },
      },
      menuItem: { include: { recipe: { include: { ingredient: { include: { inventoryItem: true } } } } } },
    },
  },
}
```

All functions that need to check modifier inventory now use this constant to ensure
consistent data fetching.

## Edge Cases

| Case | Behavior |
|------|----------|
| Both `inventoryLink` AND `ingredientId` exist | `inventoryLink` takes precedence (checked first, continues loop) |
| Ingredient has no `inventoryItemId` (prep-only) | Skipped for InventoryItem deduction; handled by `deductPrepStockForOrder()` at send-to-kitchen |
| `standardQuantity` is null | Defaults to 1 (one unit per modifier selection) |
| `standardUnit` is null | No conversion — uses InventoryItem's `storageUnit` |
| Multiple modifiers → same ingredient | `addUsage()` aggregates by inventoryItemId (Map) — works correctly |
| Pre-modifiers (no/lite/extra) | Same `getModifierMultiplier()` function applies to both paths |
| Modifier stacked (2x, 3x) | Multiplier applies: 2x "Extra Bacon" = 2 × 2.0 × standardQuantity = 4x deduction |
| Ingredient → InventoryItem link broken | Silently skipped (no deduction, no error) — intentional for prep-only ingredients |
| Unit conversion fails | Falls back to `storageUnit` — deducts in base unit without conversion |

### Prep-Only Ingredients
If `Ingredient.inventoryItemId` is null (common for prep items like "Shredded Chicken"),
the system skips InventoryItem deduction for that modifier. However, `deductPrepStockForOrder()`
(triggered at send-to-kitchen, not payment) will handle `Ingredient.currentPrepStock`
deduction for items marked with `isDailyCountItem: true`.

**Separation of Concerns:**
- `deductInventoryForOrder()` → InventoryItem.currentStock (raw goods)
- `deductPrepStockForOrder()` → Ingredient.currentPrepStock (prepared items)

## Deduction Timing

| Event | Function | Transaction Type | What Gets Deducted |
|-------|----------|------------------|-------------------|
| Order Paid | `deductInventoryForOrder()` | `sale` | InventoryItem.currentStock via recipe + modifier paths |
| Order Sent to Kitchen | `deductPrepStockForOrder()` | (prep stock) | Ingredient.currentPrepStock for `isDailyCountItem` items |
| Item Voided (food made) | `deductInventoryForVoidedItem()` | `waste` | Same as paid + creates WasteLogEntry |

**Why Payment Time?**
Payment = point of sale. At this moment, the food has left the building and can't be
returned to inventory. This aligns with restaurant accounting standards where revenue
recognition and COGS deduction happen simultaneously.

**Why Send-to-Kitchen for Prep?**
Prep items (like shredded chicken) are counted daily and deducted as they're used in
orders. Deducting at send-to-kitchen (not payment) provides real-time prep stock levels
for the day, enabling accurate morning counts and restock decisions.

## Key Files
- `src/lib/inventory-calculations.ts` — Core deduction engine (all 3 functions + include constant)
- `src/app/api/reports/pmix/route.ts` — PMIX report with food cost calculation
- `src/app/api/orders/[id]/pay/route.ts` — Triggers `deductInventoryForOrder()` at line ~477
- `src/app/api/orders/[id]/comp-void/route.ts` — Triggers `deductInventoryForVoidedItem()`
- `src/app/api/orders/[id]/send/route.ts` — Triggers `deductPrepStockForOrder()` (prep items)

## Reporting Implications

### PMIX (Product Mix) Report
Food cost calculations now include modifier ingredients linked via Menu Builder:
```typescript
// Before: Only checked inventoryLink
const modCost = modifier.inventoryLink?.inventoryItem
  ? calculateCost(...)
  : 0

// After: Checks both paths
const modCost = modifier.inventoryLink?.inventoryItem
  ? calculateCost(...)
  : modifier.ingredient?.inventoryItem
    ? calculateCost(...)
    : 0
```

This makes food cost % more accurate for items with frequent modifier usage (e.g.,
burgers with add-ons, salads with protein upgrades).

### Theoretical vs Actual (AvT) Reports
Theoretical usage calculations now include both paths, making variance reports more
accurate. Previously, modifiers linked via Menu Builder were invisible to theoretical
calculations, causing false "positive variance" (looked like theft when it was just
missing data).

### Inventory Transactions
All deductions create `InventoryItemTransaction` records with full audit trail:
- `type: 'sale'` for paid orders
- `type: 'waste'` for voided items (if food was made)
- Links to `orderId`, `orderItemId`, `employeeId`
- Includes `quantity`, `unit`, `notes`

Managers can drill into any inventory discrepancy and see which orders contributed to it.

### Future Reporting Opportunities
When building detailed modifier-level sales reports, query `OrderItemModifier` joined to
`Modifier.ingredient` for per-item breakdown:

**Example Query:**
```sql
SELECT
  m.name AS modifier_name,
  i.name AS ingredient_name,
  COUNT(*) AS times_sold,
  SUM(i.standardQuantity * oim.quantity) AS total_quantity_used
FROM "OrderItemModifier" oim
JOIN "Modifier" m ON oim.modifierId = m.id
JOIN "Ingredient" i ON m.ingredientId = i.id
WHERE oim.createdAt BETWEEN '2026-02-01' AND '2026-02-28'
GROUP BY m.name, i.name
ORDER BY total_quantity_used DESC
```

This enables reports like:
- "Top 10 modifiers by ingredient usage this month"
- "Bacon usage: 30% from burgers, 45% from salads, 25% from breakfast items"
- "Which menu items drive the most avocado consumption?"

## Testing Recommendations

### Manual Testing Checklist
- [ ] Create modifier with `ingredientId` (no inventoryLink)
- [ ] Sell item with that modifier → verify stock deducted
- [ ] Sell item with "No [ingredient]" modifier → verify NO deduction (or reduced)
- [ ] Sell item with "Extra [ingredient]" modifier → verify 2x deduction
- [ ] Create modifier with BOTH `ingredientId` AND `inventoryLink` → verify inventoryLink takes precedence
- [ ] Void order with modifier (food made) → verify waste transaction created
- [ ] Check PMIX report → verify food cost includes modifier ingredients

### Edge Case Testing
- [ ] Modifier with `ingredientId` pointing to prep-only ingredient (no inventoryItemId) → should skip gracefully
- [ ] Modifier with `standardQuantity: null` → should default to 1
- [ ] Modifier with `standardUnit: null` → should use InventoryItem.storageUnit
- [ ] Stacked modifier (2x) with "Extra" pre-modifier → verify 4x deduction (2 × 2.0)

## Industry Reference
Inspired by R365's "Menu Item Concatenation" — each modifier+menu item combo resolves to
a deductible inventory item. Our approach uses the existing Ingredient model as the single
source of truth rather than creating per-combo records.

**R365 Approach:**
- Creates separate inventory records for "Burger" vs "Burger+Bacon" vs "Burger+Bacon+Cheese"
- Explosion of SKUs for complex items
- Easier to track but harder to maintain

**GWI Approach:**
- Single "Burger" recipe + dynamic modifier resolution
- Modifiers resolve to Ingredients → InventoryItems at deduction time
- Fewer records to maintain
- Same accuracy as R365 without the SKU explosion

This design scales better for menus with high customization (e.g., build-your-own bowls,
extensive topping lists).

## Future Enhancements

### 1. Modifier Recipe Support
Currently, modifiers can link to a single ingredient. Future enhancement: allow modifiers
to have multi-component recipes (e.g., "House Sauce" modifier with 3 ingredients).

**Proposed Schema:**
```prisma
model ModifierRecipe {
  id           String
  modifierId   String
  ingredientId String
  quantity     Decimal
  unit         String
}
```

This would enable:
- Complex modifier deductions (e.g., "Loaded Fries" = cheese + bacon + ranch)
- Accurate food cost for house-made modifier items
- Better inventory tracking for multi-component add-ons

### 2. Modifier Portion Sizes
For modifiers that vary by portion (e.g., "Add Chicken" could be 4oz or 6oz depending on
item size), support portion-based deduction multipliers.

**Example:**
```typescript
{
  modifierId: "add-chicken",
  baseQuantity: 4,
  baseUnit: "oz",
  portionMultipliers: {
    "small": 0.75,   // 3 oz
    "regular": 1.0,  // 4 oz
    "large": 1.5     // 6 oz
  }
}
```

### 3. Conditional Modifier Deductions
Some modifiers should only deduct inventory if certain conditions are met:
- "Extra Ice" → no deduction (ice isn't tracked)
- "No Straw" → no deduction (straws aren't in recipe)
- "Gluten-Free Bun" → swap deduction (subtract regular bun, add GF bun)

**Proposed Field:**
```prisma
model Modifier {
  inventoryBehavior String @default("deduct")  // "deduct" | "swap" | "skip"
  swapIngredientId  String?  // If behavior = "swap", this is the replacement
}
```

## Related Skills
- **Skill 126**: Explicit Input → Output Model (prep item transformations)
- **Skill 127**: Quick Stock Adjustment with Cost Tracking (manual adjustments)
- **Skill 204**: Ingredient Library Refactor (UI for managing ingredients)
- **Skill 211**: Hierarchical Ingredient Picker (Menu Builder UI)
- **Skill 213**: Real-Time Ingredient Library (socket sync for cross-terminal updates)
- **Skill 214**: Ingredient Verification Visibility (unverified ingredient warnings)

## Changelog
- **2026-02-06**: Initial implementation
  - Extended `ORDER_INVENTORY_INCLUDE` to fetch `ingredient.inventoryItem`
  - Updated `deductInventoryForOrder()` with Path B fallback
  - Updated `deductInventoryForVoidedItem()` with same pattern
  - Updated `calculateTheoreticalUsage()` for AvT reports
  - Updated PMIX report food cost calculation
  - Documented edge cases and testing recommendations

---

## 11. Known Limitations

### Cross-Category Unit Conversion
The `convertUnits()` function only converts within the same unit category:
- Weight ↔ Weight (oz ↔ lb ↔ g ↔ kg) ✅
- Volume ↔ Volume (ml ↔ cups ↔ gallons ↔ liters) ✅
- Volume ↔ Weight (tablespoons ↔ grams) ❌ — requires density data we don't have

**Risk:** If an operator sets `standardUnit: "tablespoons"` on an Ingredient but the InventoryItem tracks in `kg`, `convertUnits()` returns `null` and the fallback behavior applies the raw number without conversion. This could cause incorrect deductions (e.g., 1.5 tablespoons treated as 1.5 kg).

**Mitigation:** Operators should ensure `standardUnit` and the InventoryItem's `storageUnit` are in the same category. A future enhancement could add a validation warning in the UI.

### Bundle Modifiers (One Modifier → Multiple Inventory Items)
Both Path A (`ModifierInventoryLink`) and Path B (`Modifier.ingredientId`) are 1-to-1 relationships. A single modifier cannot directly deduct from multiple inventory items.

**Workaround:** Model the modifier's ingredient as a prep item (`sourceType: "made"`) with a recipe that lists multiple raw ingredients. However, Path B currently only checks `ingredient.inventoryItem` (direct link). If the ingredient is a prep item with `inventoryItemId: null` and `prepItemId: [something]`, the InventoryItem deduction skips it. The prep stock system handles it at send-to-kitchen, but payment-time deduction misses the raw ingredient breakdown.

**Future fix:** Add `explodePrepItem()` support to the modifier fallback path, similar to how base recipe ingredients already handle prep items.

### Category-Based Removal ("NO MEAT")
The "NO" detection works per-modifier, per-inventoryItemId. A single "NO MEAT" modifier can only remove one inventory item because `Modifier.ingredientId` points to one Ingredient.

**Current design:** Operators create individual modifiers ("No Pepperoni", "No Sausage") rather than category-level removals. This is consistent with how POS pre-modifiers work — the server taps each item and selects "NO."

**Future enhancement:** Modifier tags or ingredient groups could enable category-level removal.

### Path B is 1-to-1 Only
`Modifier.ingredientId` points to exactly one Ingredient. This is the same limitation as `ModifierInventoryLink` (which has `modifierId @unique`). Neither path supports a modifier that deducts from multiple unrelated inventory items without using a prep item recipe.

---

## 12. Additional Verification Tests

Beyond the standard tests in the Verification Plan (Section 10 of this doc), add these edge case tests:

### Unit Conversion Test
1. Set an Ingredient's `standardUnit` to `"g"` (grams) and `standardQuantity` to `500`
2. Set the linked InventoryItem's `storageUnit` to `"kg"` (kilograms)
3. Place an order with that modifier
4. Verify deduction is `0.5 kg` (not 500 kg)

### Multi-Quantity Test
1. Order **3** Classic Burgers with **Extra Ranch** (pre-modifier)
2. Ranch `standardQuantity` = 1.5 oz, Extra multiplier = 2.0
3. Expected deduction: `3 × 1 × 1.5 × 2.0 = 9.0 oz`
4. Verify `InventoryItem.currentStock` decreased by exactly 9.0 oz

### Stacked Modifier Test
1. Order 1 burger with **2x Ranch** (via `allowStacking`, `mod.quantity = 2`)
2. Expected: `1 × 2 × 1.5 × 1.0 = 3.0 oz`
3. Verify correct deduction

### Null StandardQuantity Test
1. Set an Ingredient's `standardQuantity` to `NULL`
2. Place an order with that modifier (normal, no pre-modifier)
3. Verify deduction defaults to `1` unit (the `|| 1` fallback)

### Null StandardUnit Test
1. Set an Ingredient's `standardUnit` to `NULL`
2. InventoryItem `storageUnit` = `"oz"`
3. Place an order — verify no conversion is attempted and deduction uses raw `standardQuantity` value

### Both Paths Exist Test
1. Manually create a `ModifierInventoryLink` for a modifier that also has `ingredientId` set
2. Set different quantities on each path (e.g., link=2.0, ingredient=1.5)
3. Place an order — verify `2.0` is deducted (Path A wins)

---

## 13. Future Enhancements

### Prep Item Explosion for Modifiers
Currently, if a modifier's ingredient is a prep item (no direct `inventoryItemId`), the payment-time deduction skips it. The `explodePrepItem()` function should be called in Path B to break the prep item down to its raw inventory ingredients, just like base recipe ingredients already do.

**Priority:** Medium — affects modifiers linked to made-in-house ingredients (compound sauces, dressings, etc.)

### Modifier-Level Variance Drill-Down
Operators will want reports showing exactly which modifiers drove inventory variance. Example: "Ranch was over-used by 15 oz this week — 60% from Extra Ranch selections, 30% from portioning variance, 10% from waste."

**Data available:** `OrderItemModifier` records already capture which modifier was selected on which order item. Cross-reference with `Modifier.ingredientId` and `Ingredient.standardQuantity` to calculate expected usage per selection.

### Unit Mismatch Warning
Add a validation in the Menu Builder UI that warns when an ingredient's `standardUnit` and its linked InventoryItem's `storageUnit` are in different unit categories (e.g., volume vs weight). This prevents the silent conversion failure described in Known Limitations.

### Modifier Recipe Support
Allow a modifier to link to a "modifier recipe" — a list of ingredient/quantity pairs. This would solve the bundle modifier problem (one modifier → multiple inventory items) without requiring prep item workarounds.

### Conditional Deduction Rules
Support rules like "deduct ingredient X only when modifier is used with menu items in category Y." Example: Ranch on a salad deducts 3 oz but Ranch as a dipping sauce deducts 1.5 oz. Currently, `standardQuantity` is global to the ingredient regardless of context.

### Pour Size Integration for Liquor Modifiers
When a spirit modifier is selected with a specific pour size (shot, double, tall), the deduction should use the pour size's quantity rather than `standardQuantity`. This bridges the liquor builder and the modifier deduction systems.
