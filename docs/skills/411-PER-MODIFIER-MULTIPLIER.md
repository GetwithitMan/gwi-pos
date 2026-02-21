# Skill 411 — Per-Modifier Multiplier Configuration (T-013)

## Overview

Skill 411 (T-013) adds `liteMultiplier` and `extraMultiplier` fields directly on the `Modifier` model, enabling per-modifier overrides of the location-wide Lite/Extra inventory deduction multipliers. Without this feature, every modifier that is ordered "Lite" deducts at the location's global Lite multiplier (default 0.5x) and every "Extra" deducts at the global Extra multiplier (default 2.0x). With this feature, an individual modifier can declare its own rates — for example "LITE sauce = 0.25x" or "EXTRA cheese = 1.5x" — while all other modifiers continue to use location defaults.

## Schema Changes

Two nullable `Decimal` fields were added to the `Modifier` model in `prisma/schema.prisma`:

```prisma
model Modifier {
  ...
  // Per-modifier deduction multipliers (override location-level defaults)
  // null = fall back to location MultiplierSettings (0.5 for lite, 2.0 for extra)
  liteMultiplier  Decimal?  // Multiplier applied when "Lite" selected (default 0.5x)
  extraMultiplier Decimal?  // Multiplier applied when "Extra" selected (default 2.0x)
  ...
}
```

Both fields are nullable. `null` means "use the location's global setting." A stored `Decimal` value overrides the global setting for that modifier only.

Note: The `InventorySettings` model also carries non-nullable `liteMultiplier Decimal @default(0.5)` and `extraMultiplier Decimal @default(2.0)` fields (at line 4420-4421 of the schema). These are the location-level defaults that per-modifier overrides supersede.

## Key Files

| File | Description |
|------|-------------|
| `prisma/schema.prisma` | `liteMultiplier Decimal?` and `extraMultiplier Decimal?` on `Modifier` model (lines 1068-1069) |
| `src/components/menu/ItemEditor.tsx` | Admin UI — inline `×` number inputs beside each Lite/Extra toggle button in the modifier row |
| `src/lib/inventory/helpers.ts` | `getModifierMultiplier()` — accepts optional `MultiplierSettings`; per-mod overrides are injected by the deduction layer |
| `src/lib/inventory/order-deduction.ts` | Builds `perModSettings` per modifier and passes it to `getModifierMultiplier()` |

## How It Works

### Admin UI: Inline × Inputs in ItemEditor

When a modifier has `allowLite: true` or `allowExtra: true`, a small numeric `×` input appears inline beside the toggle button in the menu builder (`src/components/menu/ItemEditor.tsx`):

**Lite multiplier input (shown when `allowLite` is toggled on):**

```tsx
<span className="text-[9px] font-bold text-yellow-600">×</span>
<input
  type="number"
  defaultValue={mod.liteMultiplier ?? 0.5}
  key={`lite-${mod.id}-${mod.liteMultiplier ?? 0.5}`}
  onBlur={(e) => {
    const val = Number.isFinite(parsed) ? parsed : 0.5
    if (val !== (mod.liteMultiplier ?? 0.5)) {
      updateModifier(groupId, mod.id, { liteMultiplier: val })
    }
  }}
  step="0.1" min="0" max="10"
/>
```

**Extra multiplier input (shown when `allowExtra` is toggled on):**

```tsx
<span className="text-[9px] font-bold text-green-600">×</span>
<input
  type="number"
  defaultValue={mod.extraMultiplier ?? 2.0}
  key={`extra-mult-${mod.id}-${mod.extraMultiplier ?? 2.0}`}
  onBlur={(e) => {
    const val = Number.isFinite(parsed) ? parsed : 2.0
    if (val !== (mod.extraMultiplier ?? 2.0)) {
      updateModifier(groupId, mod.id, { extraMultiplier: val })
    }
  }}
  step="0.1" min="0" max="10"
/>
```

Both inputs use `onBlur` (not `onChange`) and only call `updateModifier` when the value actually changes — preventing spurious saves. The `key` prop includes the current value so that switching to a different modifier row correctly re-initializes the input.

### Deduction Engine: perModSettings

The `deductInventoryForOrder()` function in `src/lib/inventory/order-deduction.ts` fetches each modifier's `liteMultiplier` and `extraMultiplier` via the `ORDER_INVENTORY_INCLUDE` query tree:

```typescript
modifiers: {
  include: {
    modifier: {
      select: {
        liteMultiplier: true,
        extraMultiplier: true,
        inventoryLink: { ... },
        ingredient: { ... },
      },
    },
  },
},
```

For each modifier in each order item, it builds a `perModSettings` object that merges the location-level defaults with the per-modifier overrides:

```typescript
const perModSettings: typeof multiplierSettings = { ...multiplierSettings }

if (modRecord?.liteMultiplier !== null && modRecord?.liteMultiplier !== undefined) {
  perModSettings.multiplierLite = Number(modRecord.liteMultiplier)
}
if (modRecord?.extraMultiplier !== null && modRecord?.extraMultiplier !== undefined) {
  // 'extra' and 'double' both map to multiplierExtra in getModifierMultiplier
  perModSettings.multiplierExtra = Number(modRecord.extraMultiplier)
}

const multiplier = getModifierMultiplier(preModifier, perModSettings || undefined)
```

The `perModSettings` object is built fresh for every modifier in the loop, so modifiers with no overrides use the location defaults and modifiers with overrides use their own values.

### getModifierMultiplier with Per-Mod Settings

`getModifierMultiplier()` in `src/lib/inventory/helpers.ts` accepts an optional `MultiplierSettings` argument. When `perModSettings` is passed, the override logic uses explicit null/undefined checks (not `||`) to correctly handle an intentional `0` value:

```typescript
case 'LITE':
case 'LIGHT':
case 'EASY':
case 'HALF': {
  const lite = settings?.multiplierLite
  return (lite !== null && lite !== undefined && !isNaN(Number(lite)))
    ? Number(lite)
    : Number(DEFAULT_MULTIPLIERS.multiplierLite)
}
```

This means a location or per-modifier setting of `0` (meaning "Lite = no deduction") is correctly interpreted as zero rather than falling back to the default 0.5x.

### Use Case Example

**Scenario:** A pizza shop wants:
- Global default: Lite sauce = 0.5x, Extra sauce = 2.0x.
- "LITE Arrabbiata" (a specific hot sauce modifier) = 0.25x because it's a concentrated sauce.
- "EXTRA Cheese" = 1.5x because the kitchen only adds half a portion when ordered extra.

Configuration:
1. Open the menu builder, navigate to the sauce modifier group on the pizza item.
2. Enable `Lite` on the Arrabbiata modifier. The `×` input appears with default `0.5`.
3. Change the `×` input to `0.25` and tab away. The modifier saves `liteMultiplier: 0.25`.
4. Navigate to the cheese modifier group. Enable `Extra` on the Cheese modifier.
5. Change the `×` input for Extra to `1.5` and tab away. The modifier saves `extraMultiplier: 1.5`.

When a pizza is ordered with "Lite Arrabbiata" and "Extra Cheese":
- Arrabbiata deducts at 0.25x instead of the location default 0.5x.
- Cheese deducts at 1.5x instead of the location default 2.0x.
- All other modifiers continue using the location defaults.

## Configuration

1. In the POS menu builder (`/menu`), open an item and navigate to its modifier group.
2. Toggle on `Lite` or `Extra` for a specific modifier row.
3. The `×` input appears inline. The placeholder shows the current value (defaulting to `0.5` for Lite, `2.0` for Extra).
4. Edit the value and click away (blur). The value is saved to `Modifier.liteMultiplier` or `Modifier.extraMultiplier`.
5. To revert to the location default, there is no explicit "clear" button — set the input back to the location's global value (e.g., `0.5` for Lite). The database stores the explicit value, but since it matches the default, the net effect is identical to null.

The location-wide defaults are configured under **Settings → Inventory → Multipliers** (via `InventorySettings.liteMultiplier` and `extraMultiplier`).

## Notes

- **Null vs. set**: `null` in the database means the modifier inherits the location default. A stored value of `0.5` (same as the default) is functionally identical to `null` — but is treated as an explicit override and will not update automatically if the location default is later changed.
- **Only Lite and Extra are overridable**: The Triple/3x multiplier does not have a per-modifier override field. Only `liteMultiplier` and `extraMultiplier` exist on `Modifier`.
- **Compound pre-modifiers (T-042)**: `getModifierMultiplier()` supports compound strings (e.g., `"side,extra"`). The per-modifier override applies to whichever token is the "winner" in the compound evaluation (max-multiplier logic). If `"extra"` wins in a `"side,extra"` compound, the `extraMultiplier` override is what gets used.
- **Fire-and-forget**: Inventory deduction runs fire-and-forget after order payment and does not block the payment response. Per-modifier multiplier errors are logged but do not surface to the user.
- **`perModSettings` is per-iteration**: A fresh object is built for every modifier in the deduction loop, so per-modifier overrides never bleed across modifiers.
- **Input validation**: The `×` inputs use `step="0.1"`, `min="0"`, `max="10"`. Values outside this range are allowed by HTML but the UI does not enforce a hard cap. Negative values would be stored and would produce a negative deduction (i.e., a stock increase), which is almost certainly unintended.
