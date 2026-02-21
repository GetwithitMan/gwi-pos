# Skill 410 — Pour Size Multiplier in Inventory Deduction (T-006)

## Overview

When a bartender selects a pour size (shot, double, tall, short) on a liquor item, the chosen multiplier is now stored on the `OrderItem` and flows through to inventory deduction. Previously, the pour multiplier was applied to pricing at the POS screen but was silently dropped before the deduction engine ran, causing all liquor items to deduct as a single pour regardless of size selected. This skill closes that gap.

## Schema Changes

Two nullable fields were added to `OrderItem`:

```prisma
model OrderItem {
  // ... existing fields ...

  // Pour size (liquor items) — T-006
  pourSize       String?   // "shot", "double", "tall", "short" (null = no pour selection)
  pourMultiplier Decimal?  // 1.0, 2.0, 1.5, 0.75 (null = no pour multiplier applied)
}
```

Both fields default to `null` for non-liquor items and liquor items where no pour size was selected (e.g., items added before this feature or via the online ordering flow which does not expose pour size).

**NUC deployment note:** Run `npx prisma db push` on each NUC server after deploying this change to apply the schema to the local PostgreSQL database. Do not use `npm run reset`.

## Key Files

| File | Role |
|------|------|
| `prisma/schema.prisma` | Added `pourSize` and `pourMultiplier` to `OrderItem` model |
| `src/app/(pos)/orders/page.tsx` | `handleAddItemWithModifiers` — receives pour selection from `ModifierModal`, builds the item payload with `pourSize` and `pourMultiplier` |
| `src/app/api/orders/[id]/items/route.ts` | `NewItem` type includes `pourSize?: string` and `pourMultiplier?: number`; persists both fields on `OrderItem.create` |
| `src/lib/inventory/order-deduction.ts` | Deduction engine — reads `orderItem.pourMultiplier` and applies it in both recipe paths |

## How It Works

### Data flow

1. **ModifierModal** — The pour size selection UI (shot/double/tall/short buttons) passes the chosen `pourSize` string and its `pourMultiplier` number to the callback:
   ```typescript
   onAddItemWithModifiers(modifiers, specialNotes, pourSize, pourMultiplier, ...)
   ```

2. **`handleAddItemWithModifiers` in `orders/page.tsx`** — Applies the multiplier to the item base price immediately for display, and appends pour size to the item name (`"Titos (Double)"`). Both `pourSize` and `pourMultiplier` are included in the item object pushed to the pending items list.

3. **`POST /api/orders/[id]/items`** — The `NewItem` type accepts the optional fields:
   ```typescript
   pourSize?: string       // T-006: "shot", "double", "tall", "short"
   pourMultiplier?: number // T-006: 1.0, 2.0, 1.5, 0.75
   ```
   Both are written to the `OrderItem` row:
   ```typescript
   pourSize: item.pourSize ?? null,
   pourMultiplier: item.pourMultiplier ?? null,
   ```

4. **`deductInventoryForOrder` in `order-deduction.ts`** — When the order is paid, the deduction engine reads `pourMultiplier` from each order item and applies it in two places:

### Deduction changes

**MenuItemRecipe path (food-style recipes with `MenuItemRecipeIngredient`):**
```typescript
// T-006: apply pour size multiplier once per order item
const pourMult = toNumber((orderItem as any).pourMultiplier) || 1
for (const ing of orderItem.menuItem.recipe.ingredients) {
  const ingQty = toNumber(ing.quantity) * itemQty * pourMult
  // ...
}
```

**Liquor RecipeIngredient path (Liquor Builder — `RecipeIngredient` → `BottleProduct` → `InventoryItem`):**
```typescript
// T-006: apply pour size multiplier once per order item
const pourMult = toNumber((orderItem as any).pourMultiplier) || 1
const totalOz = pourCount * pourSizeOz * itemQty * pourMult
```

In both paths, `pourMult` defaults to `1` when `pourMultiplier` is null or zero, preserving pre-T-006 behavior for items without a pour selection.

### What was NOT changed

- **Modifier pre-modifier multipliers** (NO / LITE / EXTRA) are independent of `pourMultiplier` and are not affected. They are applied per-modifier via `getModifierMultiplier()` on the separate modifier deduction loop.
- `applyPourToModifiers` — when `true` on a `MenuItem`, the pour multiplier is applied to spirit modifier prices at the POS for display and charging, but that logic remains in `orders/page.tsx` and does not affect the deduction engine's modifier loop.
- Online ordering checkout does not pass `pourSize` or `pourMultiplier`; those fields will be `null` for online orders, and the deduction will use `pourMult = 1`.

## Configuration / Usage

No admin configuration is required. Pour size selection is surfaced to bartenders via the existing `ModifierModal` pour size UI on liquor category items that have `pourSizes` configured in the menu builder.

The multipliers for each pour size are:

| Pour Size | Multiplier |
|-----------|------------|
| shot      | 1.0        |
| double    | 2.0        |
| tall      | 1.5        |
| short     | 0.75       |

These values are determined at the time of order and stored on `OrderItem.pourMultiplier`, so a menu change after the order is placed does not retroactively alter deduction.

## Notes

- The `pourMultiplier` column is a `Decimal?` in Prisma but is sent as a plain JavaScript `number` from the API. The deduction engine uses `toNumber()` from `./helpers` to normalize both `Decimal` and `number` values.
- Voided item deduction (in `void-waste.ts`) should be updated separately if pour-size-aware deduction is desired on voids — that path is not covered by this skill.
- Historical `OrderItem` rows (pre-migration) will have `pourMultiplier = null`, and the deduction engine will default to `pourMult = 1` for those records, which matches the pre-T-006 behavior.
- The `(orderItem as any).pourMultiplier` cast is used because the Prisma include type for the nested `items` query in `ORDER_INVENTORY_INCLUDE` is not fully typed — the field exists at runtime.
