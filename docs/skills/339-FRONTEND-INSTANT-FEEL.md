# Skill 339: Frontend Instant Feel (Performance Phase 1)

**Status:** DONE
**Date:** February 14, 2026
**Commit:** `e948f13`
**Domain:** Orders / Floor Plan / Global
**Impact:** Button tap 500-800ms → 100-200ms (60-75% improvement)

---

## Problem

Every button tap on the POS took 500-800ms to produce visual feedback. Three root causes:

1. **Zustand full-store subscriptions**: Components destructured the entire store (`const { currentOrder } = useOrderStore()`), causing every store change to re-render everything.
2. **Double `set()` per mutation**: Store mutations called `set()` for data, then `calculateTotals()` which did a second `set()` — two render passes per action.
3. **Monolithic components**: `FloorPlanHome.tsx` (~3,400 lines, 41+ useState) re-rendered the entire POS screen on any state change. `OrderPanelItem` was not wrapped in `React.memo`.

## Solution

### 1.1 Zustand Atomic Selectors

All `useOrderStore()` calls migrated from full destructuring to atomic selectors:

```typescript
// BEFORE — subscribes to ALL store changes
const { currentOrder } = useOrderStore()

// AFTER — subscribes only to what this component reads
const itemCount = useOrderStore(s => s.currentOrder?.items?.length ?? 0)
const subtotal  = useOrderStore(s => s.currentOrder?.subtotal ?? 0)
const total     = useOrderStore(s => s.currentOrder?.total ?? 0)
```

**Rule:** One selector call per field (or small group of primitives) actually needed. Never grab an entire object when you only read 1-2 fields.

### 1.2 One `set()` Per Interaction

All store mutations now compute totals inline and call `set()` once:

```typescript
// BEFORE — two set() calls = two render passes
updateItem: (itemId, updates) => {
  set({ currentOrder: updatedOrder })   // render #1
  get().calculateTotals()               // render #2
}

// AFTER — single set() with computed totals
updateItem: (itemId, updates) => {
  const newOrder = { ...prevOrder, items: updatedItems }
  const totals = calculateTotalsFromOrder(newOrder)
  set({ currentOrder: { ...newOrder, ...totals } })  // single render
}
```

**Applied to:** `addItem`, `removeItem`, `updateItem`, `changeQuantity`, `applyDiscount`, and every other mutation that called `calculateTotals()` separately.

### 1.3 React.memo on OrderPanelItem

`OrderPanelItem` wrapped in `React.memo` so adding 1 item no longer re-renders all 10+ existing items. All callbacks passed to it are memoized with `useCallback`.

## Key Files

| File | Changes |
|------|---------|
| `src/stores/order-store.ts` | Batch `set()`, inline totals calculation |
| `src/components/orders/OrderPanelItem.tsx` | `React.memo` wrapper |
| `src/components/orders/OrderPanel.tsx` | Memoized callbacks |
| All files calling `useOrderStore()` | Atomic selectors |

## Results

| Interaction | Before | After |
|-------------|--------|-------|
| Button tap to visual feedback | 500-800ms | 100-200ms |
| Item add to panel update | 300-600ms | 50-100ms |
| Quantity +1 to display update | 200-400ms | 30-50ms |

## Mandatory Pattern Going Forward

**Every new component that reads from Zustand MUST use atomic selectors.** Full-store destructuring is banned. See `CLAUDE.md` Performance Rules section.
