# Skill 410: Table Tap Performance Optimization

**Status:** Done
**Date:** Feb 23, 2026
**Commits:** `d1f866d`

## Problem

Clicking a table on the floor plan took ~2 seconds before order items appeared in the panel. Forensic trace identified three causes:

1. **Heavy API query** — `GET /api/orders/[id]` loaded full includes: items → modifiers + pizzaData + ingredientModifications + payments. Payments and pizzaData are not needed for the order panel
2. **Sequential split fetch** — Split orders triggered a second sequential API call to `/split-tickets` after the first returned
3. **Blocking await** — `handleTableTap` blocked on `await fetchAndMergeOrder()` before showing any content. Panel opened blank for 500ms+

## Solution

### 1. Lightweight `?view=panel` query mode

**File:** `src/app/api/orders/[id]/route.ts`

Added a `?view=panel` early-return block (following the existing `?view=split` pattern) that uses `select` instead of `include`:
- **Included:** Order fields (id, number, status, guestCount, totals, version, employee, table), items (id, name, price, quantity, specialNotes, seatNumber, courseNumber, courseStatus, isHeld, kitchenStatus, status), modifiers (id, name, price, depth, preModifier, modifierId)
- **Excluded:** payments, pizzaData, ingredientModifications, entertainment fields
- Decimal fields manually converted to `Number()` (can't use `mapOrderForResponse` which expects full includes)

### 2. Parallel split-ticket fetch

**File:** `src/lib/order-utils.ts`

- New signature: `fetchAndMergeOrder(orderId, opts?: { view?, knownStatus? })`
- Default view is now `'panel'` — all callers use the lightweight query
- When `knownStatus === 'split'` (from floor plan snapshot), fires both fetches via `Promise.all` — eliminates sequential round-trip
- Extracted `mergeSplitTickets()` helper to deduplicate merge logic between parallel and sequential paths

### 3. Optimistic panel render from snapshot

**File:** `src/components/floor-plan/FloorPlanHome.tsx`

- `handleTableTap` now calls `store.loadOrder()` immediately with snapshot data (orderNumber, guestCount, total, status) and `items: []`
- Panel header shows instantly; items area shows loading state
- Background fetch runs non-blocking via `.then()/.catch()` and replaces skeleton with real items when complete
- `handleTableTap` is now non-blocking — releases the table-switch-in-flight lock immediately

### 4. Entrance animation skip — NOT APPLICABLE

Investigated: OrderPanel has zero Framer Motion. No entrance animation exists to skip.

## Performance Impact

| Phase | Estimated Savings |
|-------|------------------|
| `?view=panel` (skip payments/pizzaData) | 200-300ms |
| Parallel split fetch | 200-300ms (split orders) |
| Optimistic render from snapshot | 200-400ms perceived |
| **Total** | **~600-1000ms reduction** |

**Target: ~600-800ms from 1500-2000ms**

## Files Modified

| File | Change |
|------|--------|
| `src/app/api/orders/[id]/route.ts` | Added `?view=panel` lightweight query mode |
| `src/lib/order-utils.ts` | Parallel split fetch, default `?view=panel`, extracted `mergeSplitTickets()` |
| `src/components/floor-plan/FloorPlanHome.tsx` | Optimistic panel render, non-blocking fetch, `knownStatus` passthrough |
