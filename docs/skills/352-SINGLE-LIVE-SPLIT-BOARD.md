# Skill 352: Single Live Split Board

**Status:** DONE
**Domain:** Orders, Floor Plan
**Created:** 2026-02-16
**Commits:** `03d5410`, `dd77c56`, `9e14ed7`, `1bbcd75`, `7cd8a53`, `dfbb7e2`
**Dependencies:** Skill 350 (Split Check Screen), Skill 351 (Split Ticket Visibility)

## Summary

Unified the split ticket system from a two-phase wizard (Edit → Manage) into a single real-time split board. After the initial split creation, all subsequent operations (move items, split items, create/delete checks, pay individual checks) happen on one live board with socket-driven updates. Added split chips header to the order panel, in-place payment loop, and "Pay All" capability.

## Problem

1. **Two separate modes**: Edit mode (client-side drag-and-drop) and Manage mode (server-driven view) felt disconnected
2. **No incremental editing**: After initial split, couldn't create new checks or delete empty ones
3. **Payment disruption**: Paying a split kicked user back to floor plan instead of returning to split board
4. **No split visibility in order panel**: Had to open split manager to see/navigate splits

## Solution

### Phase 1: API Additions

**New endpoint: `POST /api/orders/[id]/split-tickets/create-check`**
- Creates empty split order with next `splitIndex`
- Copies `employeeId`, `locationId`, `tableId`, `orderType` from parent
- Safety limit: max 20 splits per parent
- Socket emit on creation

**New endpoint: `DELETE /api/orders/[id]/split-tickets/[splitId]`**
- Validates split has 0 active items and 0 payments
- Hard deletes empty split
- Auto-merge: if only 1 split remains with no payments, moves items back to parent and sets `status: 'open'`
- Socket emit on deletion

### Phase 2: Live Board Enhancements

- **Card-tap-to-move in manage mode**: Removed `!manageMode` guards on card click handlers
- **Delete empty checks**: Enabled delete button for empty unpaid checks in manage mode
- **"+ New Check" card**: Dashed-border card at end of check grid, creates empty check via API
- **Smart new check + move**: If item is selected when tapping "+ New Check", item auto-moves to new check

### Phase 3: Split Chips Header & Payment Loop

- **Split chips in order panel**: When table has splits, shows chip buttons (one per split) instead of seat strip
- Each chip shows label, total, green "PAID" badge if paid
- **"Manage Splits" button**: Opens SplitCheckScreen in manage mode
- **In-place payment loop**: `splitParentToReturnTo` state tracks parent — after paying a split, returns to split board instead of floor plan
- **Auto-exit**: When all splits paid, closes split board automatically
- **"Pay All" button**: Pays parent order directly (all items) when no splits have been paid yet

### Additional Fixes

- **Refresh on close**: Floor plan refreshes immediately when split screen closes (`floorPlanRefreshTrigger`)
- **Lightweight split endpoint**: `?view=split` query param for fast split-only data
- **Bootstrap race condition**: Eliminated duplicate fetches from overlapping bootstrap and socket events
- **Split flow cleanup**: Removed dead code, centralized helpers, added robustness guards

## Key Files

### New Files

| File | Description |
|------|-------------|
| `src/app/api/orders/[id]/split-tickets/create-check/route.ts` | Create empty split check |
| `src/app/api/orders/[id]/split-tickets/[splitId]/route.ts` | Delete specific empty split check |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/orders/SplitCheckScreen.tsx` | handleCreateCheck, handleDeleteCheck, "+ New Check" card, "Pay All" button, action bar hints |
| `src/components/orders/SplitCheckCard.tsx` | Enable card-tap + delete in manage mode |
| `src/components/floor-plan/FloorPlanHome.tsx` | Split chips header, splitParentToReturnTo, payment loop, refresh on close |
| `src/app/(pos)/orders/page.tsx` | splitParentToReturnTo, payment loop, split chips |

## Flow Diagrams

### Live Board Flow
```
Initial split creation (Edit mode)
        ↓
Save → SplitCheckScreen (manage mode = live board)
        ↓
User can: move items, split items, create checks, delete checks, pay checks
        ↓
All operations are API-backed with socket updates
        ↓
Other terminals see changes in real-time
```

### Payment Loop
```
User taps "Pay" on split check
        ↓
splitParentToReturnTo = parentOrderId
        ↓
Close split board → Open PaymentModal for split
        ↓
Payment completes
        ↓
Check splitParentToReturnTo
        ↓
Reopen split board for parent order
        ↓
Repeat until all splits paid → auto-close
```

## Related Skills

- **Skill 350**: Split Check Screen Redesign (initial split creation)
- **Skill 351**: Split Ticket Visibility (floor plan badges, split overview)
- **Skill 348**: Per-Seat Color System
- **Skill 349**: Per-Seat Check Cards
