# Skill 364: EOD Auto-Close Stale Orders & Stale Orders Manager (T-077, T-078)

**Date:** February 17, 2026
**Domain:** Orders / Operations
**Status:** PLANNED (tasks added to PM-TASK-BOARD.md)

## Context

During split ticket testing, discovered 63 orphaned orders in the database:

- **54 empty $0 draft orders** — created by the draft pre-creation feature (Skill 344: tapping a table creates a shell order in the background). When users tap a table, look at it, then leave without adding items, the empty draft persists indefinitely.
- **9 orphaned split children** — their parent orders were already paid or cancelled, but the children remained in `open` status with no path to resolution.

### Manual Cleanup Performed

- Cancelled all 63 stale orders (set `status='cancelled'`, `closedAt=now()`)
- Reset 11 tables from `occupied` back to `available` (their only order was a stale draft)

## Planned Work

### T-077: EOD Auto-Close Stale Orders (Priority: P1)

Automatic cleanup at end-of-day / shift close:

1. **Auto-cancel all $0 drafts** — orders with `status='draft'`, `total=0`, no active items
2. **Reset associated tables** — any table whose only order was an auto-cancelled draft returns to `available`
3. **Roll forward real orders** — orders with actual balances (items added, partial payments) carry forward to the next business day instead of being cancelled
4. **Manager summary** — show a summary dialog: "Closed 54 empty drafts, rolled forward 3 orders with balances, reset 11 tables"
5. **Orphaned split cleanup** — find split children whose parent is `paid`/`cancelled`/`closed` and auto-cancel them

### T-078: Open/Stale Orders Manager UI (Priority: P2)

Admin screen for viewing and managing open orders across multiple days:

1. **Order list view** — all open/draft orders, sortable by date, table, amount, status
2. **Date filter** — view orders from specific days or date ranges
3. **Status filter** — filter by draft, open, split, partially paid
4. **Amount filter** — separate $0 drafts from orders with real balances
5. **Bulk actions** — select multiple orders and: cancel, void, reassign to different table
6. **Table reset** — when cancelling an order, automatically reset the table if no other active orders remain
7. **Audit trail** — log who cancelled/voided and when (existing `closedBy` field)

## Files Changed

| # | File | Change |
|---|------|--------|
| 1 | `docs/PM-TASK-BOARD.md` | Added T-077 and T-078 task entries |

## Implementation Notes

- T-077 should integrate with the existing EOD/shift close flow (daily report generation)
- Draft pre-creation (Skill 344) is the primary source of empty drafts — consider adding a TTL (e.g., auto-cancel drafts older than 4 hours with no items)
- The orphaned split detection query: `SELECT * FROM "Order" WHERE "splitFromId" IS NOT NULL AND status = 'open' AND "splitFromId" IN (SELECT id FROM "Order" WHERE status IN ('paid', 'cancelled', 'closed'))`
- T-078 should be accessible from the admin hamburger menu under a new "Order Management" or "Open Orders" entry

## Verification (When Implemented)

1. EOD close with stale drafts — all $0 drafts auto-cancelled, summary shown
2. EOD close with real-balance orders — rolled forward, not cancelled
3. Tables with only stale drafts — reset to available
4. Tables with both stale drafts and active orders — drafts cancelled, table stays occupied
5. Orphaned split children — auto-cancelled at EOD
6. Manager UI — filter by date shows correct orders
7. Bulk cancel — selected orders cancelled, tables reset appropriately
8. `npx tsc --noEmit` — clean

## Related Skills

- **Skill 344**: Order Flow Performance (draft pre-creation is the source of empty drafts)
- **Skill 350**: Split Check Screen (split ticket system)
- **Skill 356**: Split Payment Bug Fix (parent zeroing prevents some orphans, but not all)
