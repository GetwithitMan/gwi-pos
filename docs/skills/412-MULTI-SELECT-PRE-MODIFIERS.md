# Skill 412 — Multi-Select Pre-Modifiers (T-042)

## Overview

Skill 412 (T-042) extends the pre-modifier system from single-token strings (`"no"`, `"lite"`, `"extra"`, `"side"`) to compound comma-separated strings (`"side,extra"`, `"lite,side"`) stored in the `OrderItemModifier.preModifier` field. This allows a single modifier to carry multiple simultaneous pre-modifier instructions — for example "Side Extra Ranch" — without a schema change. All helper functions are backward-compatible: existing single-token strings continue to work unchanged.

## Schema Changes

No schema change was required. The existing `preModifier String?` field on `OrderItemModifier` (line 1818 in `prisma/schema.prisma`) already accepts an arbitrary string. T-042 changes only how that string is written and read.

```prisma
model OrderItemModifier {
  ...
  preModifier String?  // "no", "lite", "extra", "side" — or compound: "side,extra"
  ...
}
```

## Key Files

| File | Description |
|------|-------------|
| `src/components/modifiers/useModifierSelections.ts` | All compound-string helpers + `toggleModifier` logic that builds compound strings |
| `src/components/modifiers/ModifierGroupSection.tsx` | Renders pre-modifier buttons under each selected modifier; uses `hasPreModifier()` to light each button independently |
| `src/components/orders/OrderPanelItem.tsx` | Order panel line item display; uses `parsePreModifiers()` to render each token with its own color-coded label |
| `src/lib/inventory/helpers.ts` | `getModifierMultiplier()` — parses compound strings, returns max multiplier (or 0 if any removal token present) |
| `src/lib/inventory/order-deduction.ts` | Inventory deduction engine; calls `getModifierMultiplier()` with the compound string for each modifier |

## How It Works

### Compound String Format

The `preModifier` field stores tokens as a comma-separated string with no spaces:

```
"side"           → single token (backward compatible)
"side,extra"     → two tokens: on the side AND extra
"lite,side"      → two tokens: lite AND on the side
"no"             → always exclusive; cannot be combined
```

### Helper Functions

All helpers live in `src/components/modifiers/useModifierSelections.ts`:

**`parsePreModifiers(preModifier: string | null | undefined): string[]`**

Splits the string on commas and trims whitespace. Returns `[]` for null/undefined.

```typescript
parsePreModifiers("side,extra")  // → ["side", "extra"]
parsePreModifiers("lite")        // → ["lite"]
parsePreModifiers(null)          // → []
```

**`joinPreModifiers(tokens: string[]): string | undefined`**

De-duplicates tokens, joins with comma, returns `undefined` when the result is empty (so the field is cleared instead of set to an empty string).

**`hasPreModifier(preModifier: string | null | undefined, token: string): boolean`**

Returns true if the compound string contains the specific token. Used by `ModifierGroupSection` to determine whether each individual pre-modifier button should render as "lit".

```typescript
hasPreModifier("side,extra", "extra")  // → true
hasPreModifier("side,extra", "lite")   // → false
```

**`togglePreModifierToken(current: string | null | undefined, token: string): string | undefined`**

Core toggle logic. Rules:
- `"no"` is **exclusive**: selecting it clears all other tokens; selecting any other token clears `"no"`.
- If the token is already in the compound string, it is removed.
- If the token is absent, it is added to the compound string.
- Returns `undefined` when the result would be empty.

```typescript
togglePreModifierToken(undefined, "side")        // → "side"
togglePreModifierToken("side", "extra")          // → "side,extra"
togglePreModifierToken("side,extra", "side")     // → "extra"
togglePreModifierToken("side,extra", "no")       // → "no"
togglePreModifierToken("no", "no")               // → undefined
```

**`formatPreModifierLabel(preModifier: string | null | undefined): string`**

Produces a human-readable display label from the compound string. Each token is mapped through `PRE_MODIFIER_CONFIG` to its display label.

```typescript
formatPreModifierLabel("side,extra")  // → "Side Extra"
formatPreModifierLabel("lite")        // → "Lite"
```

### UI Behavior

In `ModifierGroupSection.tsx`, the pre-modifier buttons appear inline beneath the selected modifier button:

```tsx
{preModifiers.map(preMod => {
  const isPreModSelected = hasPreModifier(selectedPreMod, preMod)
  return (
    <button
      key={preMod}
      onClick={() => onToggle(group, modifier, preMod)}
      className={isPreModSelected ? config.activeClass : config.cssClass}
    >
      {config.label}
    </button>
  )
})}
```

Each button is independently lit based on whether its token is present in the compound string — not whether any pre-modifier is selected. Tapping `"No"` calls `togglePreModifierToken` with `"no"`, which clears all other tokens and sets the string to just `"no"`. Tapping any other button while `"no"` is active replaces `"no"` with the new token.

### toggleModifier Integration

In `useModifierSelections.ts`, the `toggleModifier` function calls `togglePreModifierToken` and then recomputes the price from the resulting compound string:

```typescript
const computePrice = (compoundPreMod: string | undefined): number => {
  const tokens = parsePreModifiers(compoundPreMod)
  if (tokens.includes('no')) return 0
  if (tokens.includes('extra') && modifier.extraPrice) return modifier.extraPrice
  return modifier.price  // (or tiered price)
}

// Pre-modifier button tapped on an already-selected modifier:
const newCompound = togglePreModifierToken(existingMod.preModifier, preModifier)
const updatedMod = { ...existingMod, price: computePrice(newCompound), preModifier: newCompound }
```

### Price Calculation

When a compound string contains `"extra"` and the modifier has `extraPrice > 0`, that price is used. Otherwise the base (or tiered) price applies. `"no"` always produces a price of 0.

### Print / KDS / Receipt Rendering

`OrderPanelItem.tsx` renders each token of the compound string as a separate colored label:

```tsx
const tokens = parsePreModifiers(mod.preModifier)
return tokens.map((token, ti) => {
  const tokenColor = token === 'no' ? 'text-red-400'
    : token === 'extra' ? 'text-amber-400'
    : 'text-blue-400'
  const label = PRE_MODIFIER_CONFIG[token]?.label ?? token
  return <span key={ti} className={`font-semibold uppercase text-[10px] ${tokenColor}`}>{label}</span>
})
```

The kitchen ticket and ESC/POS print paths receive the raw `preModifier` string and render it by splitting on commas in the same way.

### Inventory Deduction: Max Multiplier Wins

`getModifierMultiplier()` in `src/lib/inventory/helpers.ts` handles compound strings:

1. Split on commas to get individual tokens.
2. If **any** token is a removal instruction (`NO`, `NONE`, `REMOVE`, etc.), return `0` — skip the deduction entirely.
3. Otherwise evaluate each token individually and return `Math.max(...multipliers)`.

```typescript
getModifierMultiplier("side,extra")  // max(1.0, 2.0) → 2.0
getModifierMultiplier("lite,side")   // max(0.5, 1.0) → 1.0
getModifierMultiplier("side,no")     // has removal → 0
getModifierMultiplier("lite")        // → 0.5
```

The deduction engine in `order-deduction.ts` passes the full compound string directly to `getModifierMultiplier()`. No special handling is needed in the deduction layer.

## Configuration

No configuration is required. The feature is purely client-side state management. The pre-modifier buttons that appear depend on the modifier's individual `allowNo`, `allowLite`, `allowExtra`, `allowOnSide` boolean flags (set in the menu builder). The compound string behavior is automatic whenever more than one of these flags is enabled.

## Notes

- **Backward compatibility**: Any existing single-token `preModifier` value (`"no"`, `"lite"`, `"extra"`, `"side"`) parses as a one-element array and all downstream functions behave identically to before T-042.
- **"No" is exclusive by design**: A compound string cannot legally contain `"no"` alongside other tokens. `togglePreModifierToken` enforces this on every write. Legacy data with `"no"` stored alongside other tokens would still parse correctly — `isRemovalInstruction()` returns true if any token is a removal token.
- **`joinPreModifiers` de-duplicates**: Duplicate tokens are removed before joining, so tapping `"extra"` twice in rapid succession will not produce `"extra,extra"`.
- **`PRE_MODIFIER_CONFIG`** in `useModifierSelections.ts` defines the four built-in tokens (`no`, `lite`, `extra`, `side`) with their CSS classes and display labels. Custom tokens not in this map will fall back to the raw token string as the label.
- **Price at confirm time**: `getAllSelectedModifiers()` re-evaluates tiered prices at the moment the user taps Confirm, not at selection time, to ensure accuracy after any order edits.
