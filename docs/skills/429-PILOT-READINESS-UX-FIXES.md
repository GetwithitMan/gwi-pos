# Skill 429: Pilot Readiness -- Bar Tab, Duplicate Adds, Seat Fixes + Checklist

**Status:** Done
**Date:** Feb 24, 2026
**Commit:** `743e618`

## Problem

Three user-reported UX bugs were blocking pilot readiness:

1. **Bar tab cancellation on card decline** left stale `savedOrderId` in Zustand, causing subsequent operations to target a dead order.
2. **Duplicate item adds in BartenderView** -- `sendItemsToTab` used `!sentToKitchen` filter instead of `isTempId`, causing already-POSTed items to be re-sent. Additionally, missing `lastMutationRef` stamp on autosave and uncached modifier defaults caused race conditions.
3. **Seats disappearing in FloorPlanHome** -- missing `baseSeatCount: true` in panel view select query caused ternary to return 0.

Additionally, a comprehensive pilot readiness checklist was needed for go-live verification.

## Solution

### Fix 1: Bar Tab Cancel on Card Decline

**File:** `src/app/(pos)/orders/page.tsx`

- `onCardTabCancel`: clears `savedOrderId`, reverts store to `temp_${Date.now()}`
- `onCardTabComplete` decline branch: same cleanup logic
- `onStartTab`: guard with `const existingOrderId = rawOrderId && !isTempId(rawOrderId) ? rawOrderId : null` -- prevents creating tabs against temp/stale IDs

### Fix 2: Duplicate Item Adds in BartenderView

**Files:** `src/components/bartender/BartenderView.tsx`, `src/hooks/useActiveOrder.ts`, `src/hooks/useOrderingEngine.ts`

- **BartenderView**: Imported `isTempId`, rewrote `sendItemsToTab` to only POST items with temp IDs (items that have not been saved yet). Added `correlationId: item.id` to payload.
- **useActiveOrder**: Added `lastMutationRef.current = Date.now()` before autosave POST to prevent race conditions between autosave and explicit sends.
- **useOrderingEngine**: Added 30s TTL modifier-defaults cache (`modifierDefaultsCacheRef`) to prevent redundant API calls that caused re-renders.

### Fix 3: Seats Disappearing

**File:** `src/app/api/orders/[id]/route.ts`

- Added `baseSeatCount: true` to panel view select query. Without this field, the FloorPlanHome ternary evaluated `undefined` as falsy and returned 0 seats.

### Task 4: Pilot Readiness Checklist

**File:** `docs/planning/PILOT-READINESS-CHECKLIST.md`

- ~200 testable items organized by: Pre-Shift Setup, Opening, Core Service Flows, Edge Cases, End of Shift, End of Day Reports
- Includes go/no-go criteria table with pass/fail thresholds
- Sign-off lines for manager, owner, and tech lead
- Code audit appendix: 146+ API routes verified as real implementations, 4 gaps identified

### Task 5: API Route Audit

**File:** `API_CALLS_AUDIT.csv`

- Comprehensive audit of all API routes confirming real implementations vs stubs
- 146+ routes verified as real

## Files Changed

| File | Change |
|------|--------|
| `src/app/(pos)/orders/page.tsx` | Bar tab cancel cleanup (clear savedOrderId, revert to temp ID) |
| `src/components/bartender/BartenderView.tsx` | isTempId filter in sendItemsToTab + correlationId |
| `src/hooks/useActiveOrder.ts` | lastMutationRef stamp before autosave |
| `src/hooks/useOrderingEngine.ts` | 30s TTL modifier-defaults cache |
| `src/app/api/orders/[id]/route.ts` | baseSeatCount: true in panel select |
| `docs/planning/PILOT-READINESS-CHECKLIST.md` | Comprehensive pilot checklist (~200 items) |
| `API_CALLS_AUDIT.csv` | Full route audit (146+ routes verified) |

## Key Patterns

- **isTempId guard**: Distinguishes client-side temp IDs (format `temp_*`) from DB-persisted IDs to prevent duplicate API calls
- **lastMutationRef**: Ref-based timestamp prevents autosave from racing with explicit send operations
- **Modifier defaults cache**: 30s TTL prevents redundant modifier-defaults fetches that cause unnecessary re-renders
- **Panel view select completeness**: All fields needed by downstream ternaries must be explicitly selected in Prisma queries

## Testing

### Fix 1: Bar Tab Cancel
1. Start a bar tab. Simulate card decline. Verify `savedOrderId` is cleared and store reverts to a fresh temp ID.
2. After decline, start a new tab. Verify it creates a new order (not targeting the dead order).
3. Call `onStartTab` with a temp ID in store. Verify `existingOrderId` resolves to `null`, not the temp ID.

### Fix 2: Duplicate Items
1. Open BartenderView. Add items to a tab. Send to kitchen. Add more items. Send again. Verify only the new (temp ID) items are POSTed.
2. Trigger autosave while a manual send is in flight. Verify `lastMutationRef` prevents the autosave from racing.
3. Open modifier modal multiple times in quick succession. Verify modifier defaults are served from cache (no redundant API calls within 30s).

### Fix 3: Seats
1. Open FloorPlanHome panel view. Verify tables show correct seat counts (not 0).
2. Inspect API response from `GET /api/orders/[id]`. Verify `baseSeatCount` field is present.
