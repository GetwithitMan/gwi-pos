# Skill 414: Order Disappearance Fixes

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Orders disappeared when rapidly clicking between tables. Ghost table state persisted after payment. Cascading version conflicts broke shared tables. Five distinct race conditions were identified across the order lifecycle — from draft creation through payment clearing.

## Solution

### Bug 1 (CRITICAL): Draft Promise Race — `useActiveOrder.ts`

**Problem:** Rapidly clicking between tables triggered multiple `POST /api/orders` draft requests. Stale responses arrived after the user had already moved to a different table, overwriting the current order with the wrong one.

**Fix:** Generation counter (`draftGenRef`) incremented on every table click. When a draft POST response returns, it checks if the generation matches. If the generation has changed (user clicked away), the stale response is discarded — the order is never loaded into state.

### Bug 2 (CRITICAL): Fetch Callback Overwrites Wrong Table — `FloorPlanHome.tsx`

**Problem:** Clicking rapidly between tables triggered overlapping fetch calls. The first table's fetch response arrived after the user had already clicked to a second table, overwriting the second table's order with the first table's data.

**Fix:** `fetchLoadIdRef` counter incremented on every table selection. Each fetch callback checks if its loadId still matches the current ref value. If a newer click has occurred, the stale fetch response is silently discarded.

### Bug 3 (HIGH): Payment Clearing Race — `pay/route.ts`

**Problem:** After payment, the floor plan still showed the table as occupied with ghost order data. The snapshot cache (5s TTL) was not invalidated immediately after payment cleared the table status.

**Fix:** Immediate `invalidateSnapshotCache()` call right after the table status update (setting `tableId: null` on the order), before the deferred cleanup chain (inventory deduction, printing, socket events). This ensures the next floor plan fetch reflects the cleared table.

### Bug 4 (MEDIUM): Version Conflict Loads Wrong Order — `order-version.ts`

**Problem:** A 409 version conflict response triggered a refetch of the "current" order, but if the user had already switched tables, the refetch loaded the wrong order (from the old table) into the new table's panel.

**Fix:** Active-order guard — the 409 handler now checks if the `orderId` in the conflict response matches the currently active order. If the user has switched tables (different active order), the 409 is silently ignored instead of triggering a refetch.

### Bug 5 (MEDIUM): 409 Adoption Missing Version Sync — `useActiveOrder.ts` + `orders/route.ts`

**Problem:** When `POST /api/orders` returned 409 `TABLE_OCCUPIED` and the client adopted the existing order, the client had no version number for that order. Subsequent mutations sent version `undefined`, causing immediate 409 conflicts.

**Fix:** Server-side: the 409 response now includes `existingOrderVersion` alongside `existingOrderId`. Client-side: on adoption, the version is synced from the response, so subsequent mutations send the correct version.

## Files Modified

| File | Change |
|------|--------|
| `src/hooks/useActiveOrder.ts` | Bug 1: `draftGenRef` generation counter for draft race prevention. Bug 5: version sync on 409 adoption |
| `src/components/floor-plan/FloorPlanHome.tsx` | Bug 2: `fetchLoadIdRef` counter to discard stale fetch callbacks |
| `src/app/api/orders/[id]/pay/route.ts` | Bug 3: Immediate `invalidateSnapshotCache()` after table status update |
| `src/lib/order-version.ts` | Bug 4: Active-order guard on 409 refetch — only refetch if orderId matches current |
| `src/app/api/orders/route.ts` | Bug 5: Include `existingOrderVersion` in 409 TABLE_OCCUPIED response |

## Testing

1. **Rapid table clicks** — Click 5+ tables in quick succession. Only the last-clicked table's order should appear. No phantom orders from earlier clicks.
2. **Payment ghost** — Pay an order, immediately check floor plan. Table should show as available (not occupied).
3. **Version conflict on wrong table** — Open order on Table 1, switch to Table 2, trigger a version conflict on Table 1's order. Table 2 should be unaffected.
4. **409 adoption** — Two terminals click the same walk-in table simultaneously. Second terminal should adopt the first's order and have correct version for subsequent edits.
