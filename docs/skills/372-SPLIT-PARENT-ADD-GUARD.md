# Skill 372: Split Parent Item Add Guard

**Status:** DONE
**Domain:** Orders
**Created:** 2026-02-17
**Commit:** c1155d5
**Dependencies:** Skill 352 (Single Live Split Board), Skill 370 (Split Order Combined View)

## Summary

Blocks adding items when viewing a split parent order (status === 'split'). Shows a toast message directing the server to select a split check or create a new one, and flashes the split chips row with a purple pulse animation to draw visual attention.

## Problem

1. **Items added to void**: If a server tapped a menu item while viewing the combined split parent view, the item would be added to the parent order — which has `status: 'split'` and $0 totals. These items would be orphaned.
2. **No visual guidance**: Nothing told the server they needed to select a specific split check first.
3. **Two entry points**: Items can be added from both the menu grid (`handleAddItem` in `orders/page.tsx`) and the quick bar (`handleMenuItemTap` in `useOrderingEngine.ts`), so both paths needed guarding.

## Solution

### Guard Logic

Added a check at the top of both item-add handlers:

```typescript
if (currentOrder?.status === 'split') {
  toast.error('Select a split check or add a new one')
  setSplitChipsFlashing(true)
  setTimeout(() => setSplitChipsFlashing(false), 1500)
  return
}
```

### Flash Animation

When the guard triggers:
1. `splitChipsFlashing` state set to `true`
2. Split chips row in OrderPanel receives a CSS animation class
3. Purple pulse animation plays 3 times (500ms each, 1500ms total)
4. State resets to `false` after animation completes

### Two Guard Locations

| Location | Handler | File |
|----------|---------|------|
| Menu grid tap | `handleAddItem` | `src/app/(pos)/orders/page.tsx` |
| Quick bar tap | `handleMenuItemTap` | `src/hooks/useOrderingEngine.ts` |

Both check `currentOrder?.status === 'split'` and show the same toast + flash behavior.

## Files Modified

| File | Changes |
|------|---------|
| `src/app/(pos)/orders/page.tsx` | Guard in `handleAddItem`, `splitChipsFlashing` state, flash trigger |
| `src/hooks/useOrderingEngine.ts` | Guard in `handleMenuItemTap` |
| `src/components/orders/OrderPanel.tsx` | Flash animation CSS class on split chips row |

## Key Decisions

1. **Toast + animation** rather than just disabling the menu — keeps the menu interactive (server might want to browse) while clearly communicating why items aren't being added
2. **Flash the chips** to direct attention to exactly where the server needs to tap
3. **Guard both entry points** — menu grid and quick bar are both active simultaneously, so both must be protected
