# Skill 371: Inline Split Creation

**Status:** DONE
**Domain:** Orders, Floor Plan
**Created:** 2026-02-17
**Commit:** c1155d5
**Dependencies:** Skill 352 (Single Live Split Board), Skill 370 (Split Order Combined View)

## Summary

Added a "+ New" button at the end of the split chips row in the order panel. Creates a new empty child split via the API and immediately loads it for item entry — all inline without leaving the order panel or opening the split check screen.

## Problem

1. **No quick split creation**: To add a new split check, servers had to open the full SplitCheckScreen, which was a context switch
2. **Stale context after creation**: After creating a new split, the useEffect that watches for split context changes was checking the `orderSplitChips` array (which hadn't updated yet) instead of the `splitParentId` (which was immediately set)
3. **Workflow friction**: Common scenario — table already has splits, new guest joins, server wants to quickly add a check and start ordering

## Solution

### "+ New" Button

In `OrderPanel.tsx`, added a dashed-border purple button at the end of the split chips row:
- Styled with dashed purple border to visually suggest "add new"
- Calls `onAddSplit` callback passed from `orders/page.tsx`

### Create Flow

In `orders/page.tsx`:
1. `onAddSplit` handler calls `POST /api/orders/{parentId}/split-tickets/create-check`
2. On success, adds the new chip to the local split chips array
3. Sets `orderSplitChips` and `splitParentId` in state
4. Loads the new empty split order for immediate item entry

### Context Preservation Fix

Fixed `useEffect` that watches for split context changes:
- **Before**: Checked `orderSplitChips.length` to determine if in split mode (stale — array not yet updated)
- **After**: Checks `splitParentId` which is set immediately when entering split context

### API Used

**Endpoint:** `POST /api/orders/{parentId}/split-tickets/create-check`

Creates an empty child split order with the next available `splitIndex`. Copies `employeeId`, `locationId`, `tableId`, `orderType` from parent. Returns the new split order object.

## Files Modified

| File | Changes |
|------|---------|
| `src/components/orders/OrderPanel.tsx` | "+ New" button with dashed purple border, `onAddSplit` prop |
| `src/app/(pos)/orders/page.tsx` | `onAddSplit` handler, API call, chip state update, splitParentId context fix |

## Key Decisions

1. **Inline over modal** — the whole point is zero context switching; server taps "+ New" and starts adding items
2. **Reuse existing API** — leveraged the `create-check` endpoint from Skill 352 rather than building new infrastructure
3. **splitParentId as source of truth** — more reliable than checking the chips array length, which may not have re-rendered yet
