# Skill 357: POS Overhaul — Performance Phase 6 (React.memo, Dead Code Removal, Delta Sockets)

**Date:** February 17, 2026
**Commit:** `6a78c89`
**Domain:** Orders / Floor Plan / Performance
**Status:** Complete

---

## Problem

Despite five previous performance phases, the POS still had measurable inefficiencies:

1. **Unnecessary re-renders**: OrderPanel, QuickPickStrip, UnifiedPOSHeader, and OrderPanelActions re-rendered on every parent state change despite unchanged props
2. **Non-atomic Zustand selectors**: 47 selectors across orders/page.tsx, InteractiveFloorPlan, and UnifiedFloorPlan destructured the entire store, triggering re-renders on any state change
3. **Full-refresh socket handlers**: UnifiedFloorPlan refetched entire snapshot on every socket event, even removals (paid/voided/deleted) that could be handled locally
4. **Synchronous split operations**: SplitCheckScreen blocked UI while waiting for API responses on move/pay actions
5. **Dead code accumulation**: 18 unused components, 3 unused hooks, and entire `src/bridges/` and `src/domains/` scaffolding directories remained in the bundle (~13K lines)
6. **Redundant API calls**: OrderSettings, DiscountModal, and OrderTypeSelector fetched on every mount with no caching or deduplication

## Solutions

### React.memo on Hot-Path Components

Wrapped `OrderPanel`, `QuickPickStrip`, `UnifiedPOSHeader`, and `OrderPanelActions` with `React.memo`. These components sit in the critical render path and receive stable props most of the time. Memoization prevents cascading re-renders when sibling state changes.

### Zustand Atomic Selector Fixes (47 selectors)

Converted all destructured store access to atomic selectors:

```typescript
// Before (re-renders on ANY store change)
const { items, total, addItem } = useOrderStore()

// After (re-renders only when specific field changes)
const items = useOrderStore(s => s.items)
const total = useOrderStore(s => s.total)
const addItem = useOrderStore(s => s.addItem)
```

Fixed across orders/page.tsx, InteractiveFloorPlan.tsx, and UnifiedFloorPlan.tsx — 47 selectors total.

### Delta Socket Handlers in UnifiedFloorPlan

Converted 3 socket event handlers from full-refresh to delta updates:

- **`orders:paid`** — remove order from local state (zero network)
- **`orders:voided`** — remove order from local state (zero network)
- **`orders:deleted`** — remove order from local state (zero network)

Addition/change events still trigger debounced full refresh (150ms). Removal events now require zero network traffic.

### Optimistic SplitCheckScreen Operations

Split move and pay operations now update local state immediately with snapshot rollback on failure:

```typescript
// Snapshot current state
const snapshot = [...splits]

// Optimistic update
setSplits(optimisticResult)

// Background API call
try {
  await fetch(...)
} catch {
  setSplits(snapshot)  // Rollback
  toast.error('Operation failed')
}
```

### Dead Code Removal (~13K lines)

| Category | Count | Details |
|----------|-------|---------|
| Unused components | 18 | Stale UI components with zero imports |
| Unused hooks | 3 | Hooks with no consumers |
| `src/bridges/` | entire dir | Scaffolding directory, never used |
| `src/domains/` scaffolding | partial | Empty or placeholder files |
| **Total** | ~13K lines | Removed from bundle and repo |

### Client-Side Caching

- **useOrderSettings**: 5-minute TTL cache with request deduplication. Multiple mounts within TTL share one fetch.
- **DiscountModal**: Caches discount list on first open, reuses on subsequent opens
- **OrderTypeSelector**: Caches order types per location, avoids refetch on every panel open

### BartenderView Prop Drilling Fix

Replaced deep prop drilling through BartenderView with direct store access and ref callbacks, eliminating unnecessary intermediate re-renders.

## Key Files

| File | Changes |
|------|---------|
| `src/app/(pos)/orders/page.tsx` | Atomic selectors (47), React.memo wrappers |
| `src/components/floor-plan/FloorPlanHome.tsx` | Atomic selectors, dead code cleanup |
| `src/components/floor-plan/UnifiedFloorPlan.tsx` | Delta socket handlers, atomic selectors |
| `src/components/floor-plan/InteractiveFloorPlan.tsx` | Atomic selectors |
| `src/components/orders/OrderPanel.tsx` | React.memo wrapper |
| `src/components/orders/SplitCheckScreen.tsx` | Optimistic operations with rollback |
| `src/components/bartender/BartenderView.tsx` | Prop drilling fix |
| `src/stores/order-store.ts` | Selector patterns |
| 18 deleted component files | Dead code removal |
| 3 deleted hook files | Dead code removal |
| `src/bridges/` | Entire directory removed |
| `src/domains/` scaffolding | Placeholder files removed |

## Verification

1. `npx tsc --noEmit` — clean, zero type errors
2. React DevTools Profiler: OrderPanel renders only on prop changes, not sibling state
3. Socket event `orders:paid` on UnifiedFloorPlan — no network request fired (delta removal)
4. SplitCheckScreen move item — UI updates instantly, API in background
5. Open OrderPanel twice — useOrderSettings fires only 1 fetch (cache hit on second)
6. `grep -r "src/bridges" src/` — zero matches
7. Bundle size reduced by ~13K lines of dead code
