# GWI POS - Real-Time & Resilience

**Version:** 1.0
**Updated:** February 23, 2026
**Scope:** Socket.io event map, consistency guarantees, failure modes, coverage gaps

---

## Real-Time Event Map

Every cross-terminal update flows through Socket.io. The table below is the complete event inventory.

| Entity | Event Name | Emitter | Listener | Action |
|--------|------------|---------|----------|--------|
| Orders | `order:created` | `socket-dispatch.ts:80` | `useOrderSockets.ts:107` | Refetch open orders; update floor plan |
| Orders | `orders:list-changed` | `socket-dispatch.ts:654` | Multiple pages | Full refresh of open orders list (debounced 150 ms) |
| Orders | `order:totals-updated` | `socket-dispatch.ts:617` | `useOrderSockets.ts:108` | Update total in local state |
| Orders | `order:editing` | `socket-dispatch.ts:805` | `socket-server.ts:181` | Shows "editing on terminal X" banner |
| Orders | `order:editing-released` | `socket-dispatch.ts:837` | `socket-server.ts:191` | Clears editing banner |
| KDS | `kds:order-received` | `socket-dispatch.ts:76` | `KDS page.tsx:227` | Add order to board; play sound |
| KDS | `kds:item-status` | `socket-dispatch.ts:120-121` | `KDS page.tsx:235` | Update item status (cooking -> ready -> served) |
| KDS | `kds:order-bumped` | `socket-dispatch.ts:155-156` | `KDS page.tsx:243` | Remove order from board |
| Floor Plan | `floor-plan:updated` | `socket-dispatch.ts:293` | `FloorPlanHome.tsx:359` | Full floor plan reload |
| Floor Plan | `table:status-changed` | `socket-dispatch.ts:761` | `FloorPlanHome.tsx` | Table status refresh |
| Menu | `menu:updated` | `socket-dispatch.ts:406` | `cache-invalidate.ts` | Invalidate menu cache |
| Menu | `menu:item-changed` | `socket-dispatch.ts:477` | Online ordering | Update availability/pricing |
| Menu | `menu:stock-changed` | `socket-dispatch.ts:512` | Online ordering | Show "Sold Out" badge |
| Inventory | `inventory:stock-change` | `socket-dispatch.ts:372` | `useMenuSocket.ts` | Update 86'd badges |
| Inventory | `inventory:adjustment` | `socket-dispatch.ts:335` | (Admin) | Stock adjustment log |
| Entertainment | `entertainment:session-update` | `socket-dispatch.ts:193-194` | Entertainment KDS | Timer display update |
| Entertainment | `entertainment:status-changed` | `socket-dispatch.ts:580` | `useOrderSockets.ts:109` | Availability update |
| Void | `void:approval-update` | `socket-dispatch.ts:265` | Modal listener | Approve/reject void |
| Payment | `payment:processed` | `socket-dispatch.ts:689` | Admin dashboard | Audit trail |
| Tab | `tab:updated` | `socket-dispatch.ts:727` | Mobile phone | Tab state sync |
| Tab | `tab:closed` | `socket-dispatch.ts:737` | Mobile phone | Closed toast |
| Tab | `tab:items-updated` | `socket-dispatch.ts:747` | Mobile phone | Item count change |
| CFD | `CFD:show-order` | `socket-dispatch.ts:900` | Customer-Facing Display | Display order |
| CFD | `CFD:payment-started` | `socket-dispatch.ts:915` | Customer-Facing Display | Payment screen |
| CFD | `CFD:tip-prompt` | `socket-dispatch.ts:930` | Customer-Facing Display | Tip selection |
| CFD | `CFD:receipt-sent` | `socket-dispatch.ts:944` | Customer-Facing Display | Receipt/thank-you |
| Tip Group | `tip-group:updated` | `socket-dispatch.ts:867` | Bartender screens | Membership sync |

---

## Consistency Rules

How concurrent writes are resolved when two terminals touch the same data.

| Scenario | Mechanism | Strength | Notes |
|----------|-----------|----------|-------|
| Two terminals add items to same order | `FOR UPDATE` row lock + atomic transaction | **STRONG** | Lock serializes; totals recomputed from DB truth |
| Terminal A sends, Terminal B adds items | Version field + status check | **MODERATE** | Send does not lock order permanently; new items permitted while `in_progress` |
| Terminal A pays, Terminal B voids | `FOR UPDATE` on both routes | **STRONG** | Whichever acquires lock first wins; loser receives 409 |
| Two terminals apply discounts | Last-write-wins | **WEAK** | No merge logic; last update overwrites |
| Split check modified by two people | Row lock on parent order | **STRONG** | Pessimistic lock per split operation |
| Two servers claim same walk-in table | No locking | **WEAK** | Both orders persist; UI-level de-dup needed |

---

## Failure Stories

### Story 1: Network flaps for 30 seconds

1. Items added locally to Zustand store (visible instantly).
2. POST fails -- toast: "Connection lost -- retrying..."
3. `OfflineManager` detects offline, queues mutation to IndexedDB.
4. Retry every 30 s; on reconnect `processOrderQueue()` syncs immediately.
5. Server detects duplicate via `localId` -- returns 409 Conflict -- client marks as synced.
6. **Outcome:** No data loss from the user's perspective.

### Story 2: Frontend crashes mid-order

1. Server-synced items (already POSTed) are safe in the database.
2. Locally-pending items (added but not yet POSTed) are **LOST**.
3. The order store does **not** persist to `localStorage` by default.
4. On reopen: `GET /api/orders/[id]` returns only server-synced items.
5. **Risk:** Unsent items are volatile. Any items added between the last successful POST and the crash are unrecoverable.

### Story 3: Socket drops and reconnects

1. Socket.io auto-reconnects with exponential backoff (infinite attempts).
2. Client re-joins location rooms on `connect`.
3. KDS and Floor Plan auto-refresh on reconnect (Skill 411).
4. Events missed during the disconnect window are **not** replayed (no server-side backfill).
5. 30 s polling fallback activates if the socket stays down.

### Story 4: Payment processor timeout

1. Card reader hangs for 15 s -- server aborts -- transaction rolled back.
2. No `Payment` record is created; order remains open.
3. User can retry or switch to cash.
4. If the card was charged but no POS record was written, manual reconciliation is required.
5. `OfflineManager` queues the payment if the order originated locally.

### Story 5: Two servers claim the same walk-in table

1. Both `POST /api/orders` succeed (no uniqueness constraint on `tableId` + `status`).
2. Floor plan renders two draft orders on the same table.
3. No automatic winner; manual merge or void is required.
4. **Mitigation:** Use the `order:editing` socket event as a UI-level advisory lock to warn the second server.

---

## Real-Time Coverage Summary

| Entity | Socket Events | Polling Fallback | No Real-Time |
|--------|--------------|-----------------|--------------|
| Orders | `orders:list-changed`, `order:created`, `order:totals-updated` | 30 s if disconnected | -- |
| KDS | `kds:order-received`, `kds:item-status`, `kds:order-bumped` | 30 s if disconnected | -- |
| Floor Plan | `floor-plan:updated`, `table:status-changed` | 30 s if disconnected | -- |
| Menu | `menu:updated`, `menu:item-changed`, `menu:stock-changed` | 60 s cache TTL | -- |
| Entertainment | `entertainment:session-update`, `entertainment:status-changed` | 5 s UI polling | -- |
| Inventory | `inventory:stock-change`, `inventory:adjustment` | None | -- |
| CFD | `CFD:show-order`, `CFD:payment-started`, `CFD:tip-prompt`, `CFD:receipt-sent` | None | -- |
| Tabs (Mobile) | `tab:closed`, `tab:items-updated` | None | -- |

**Legend:**

- **Socket Events** -- Primary path. Events emitted by `socket-dispatch.ts`, consumed by client hooks/pages.
- **Polling Fallback** -- Secondary path when the socket is disconnected. Interval listed is approximate.
- **No Real-Time** -- Entities with no polling fallback rely entirely on socket delivery. If the socket is down, the client sees stale data until reconnection triggers a refresh.
