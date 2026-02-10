# Skill 248: Socket Layer + Fetch Consolidation

**Status:** DONE
**Domain:** Orders
**Date:** 2026-02-09
**Dependencies:** Skill 217 (Menu Socket Infrastructure), Skill 120 (Datacap Direct)

## Overview

The orders page had a "slow feel" caused by excessive HTTP polling and redundant refetching after mutations. Two 3-second polling loops ran simultaneously (entertainment menu + open orders panel), and every item-level mutation (hold, note, course, seat, resend) triggered a full order refetch even though shared handlers already updated the Zustand store. This skill eliminates ~40 req/min of unnecessary network traffic.

## Phase 1: Quick Wins (No New Socket Infrastructure)

### 1A. Removed 5 Redundant Post-Mutation Refetches

The shared handlers in `useActiveOrder.ts` already call `PUT /api/orders/{id}/items/{itemId}` AND update the Zustand store via `updateItem()`. The wrapper handlers in orders/page.tsx then did ANOTHER `GET /api/orders/{id}` + `loadOrder()` — completely redundant.

Simplified: `handleHoldToggle`, `handleNoteEdit`, `handleCourseChange`, `handleSeatChange`, `handleResend`

### 1B. Fixed startEntertainmentTimers

Reads from `useOrderStore.getState().currentOrder?.items` instead of fetching `GET /api/orders/{orderId}`.

### 1C. Debounced loadOpenOrdersCount

`tabsRefreshTrigger` is incremented from 11 call sites. Added 300ms debounce so rapid mutations collapse to 1 fetch.

### 1D. Throttled loadMenu

Leading-edge throttle for post-mutation loadMenu calls. Reduced entertainment polling from 3s to 10s (later replaced by sockets in 2F).

## Phase 2: Socket Layer

### 2A. Broadcast Route Additions

Added `ORDER_TOTALS_UPDATE` and `OPEN_ORDERS_CHANGED` cases to `/api/internal/socket/broadcast/route.ts`. The `ORDER_TOTALS_UPDATE` case was being dispatched from 4 API routes but silently returned 400 because the case was missing.

### 2B. dispatchOpenOrdersChanged

New function in `socket-dispatch.ts`:
```ts
dispatchOpenOrdersChanged(locationId, { trigger: 'created'|'paid'|'voided'|'transferred', orderId? })
```

### 2C. Wired Into API Routes

- `POST /api/orders` (create) — trigger: `'created'`
- `POST /api/orders/[id]/pay` (pay) — trigger: `'paid'`

### 2D. Wired dispatchEntertainmentStatusChanged

Function existed but was never called from any API route. Added to:
- `POST /api/entertainment/block-time` (start session)
- `PATCH /api/entertainment/block-time` (extend)
- `DELETE /api/entertainment/block-time` (stop)
- `PATCH /api/entertainment/status` (status change)
- `POST /api/orders/[id]/send` (entertainment items on send)

### 2E. useOrderSockets Client Hook

**New file:** `src/hooks/useOrderSockets.ts`

Lightweight hook following `useKDSSockets` pattern:
- Connects via `join_station` to `location:{locationId}` room
- Listens for: `orders:list-changed`, `order:totals-updated`, `entertainment:status-changed`
- Uses `callbacksRef` pattern to avoid reconnecting when callbacks change
- Named handlers with explicit `socket.off()` cleanup
- Returns `{ isConnected: boolean }`
- 3 reconnection attempts (not 10) with 2s delay — quiet in dev

### 2F. Replaced Entertainment Polling

Deleted the `setInterval(() => loadMenu(), 10000)` in orders/page.tsx. Replaced with:
- `useOrderSockets.onEntertainmentStatusChanged` patches specific menu item in local state
- Visibility-change listener as fallback for tab refocus

### 2G. Replaced Open Orders Polling

Deleted `setInterval(() => loadOrders(), 3000)` in OpenOrdersPanel.tsx. Replaced with:
- `useOrderSockets({ onOpenOrdersChanged: () => loadOrders() })`
- Visibility-change listener as fallback
- `refreshTrigger` prop still works as additional trigger

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/hooks/useOrderSockets.ts` | 160 | Client socket hook |

## Files Modified

| File | Changes |
|------|---------|
| `src/app/(pos)/orders/page.tsx` | Remove 5 refetches, fix entertainment timers, debounce, throttle, wire useOrderSockets, remove polling |
| `src/components/orders/OpenOrdersPanel.tsx` | Replace 3s polling with socket |
| `src/app/api/internal/socket/broadcast/route.ts` | Add ORDER_TOTALS_UPDATE + OPEN_ORDERS_CHANGED cases |
| `src/lib/socket-dispatch.ts` | Add dispatchOpenOrdersChanged |
| `src/app/api/orders/route.ts` | Fire dispatchOpenOrdersChanged on create |
| `src/app/api/orders/[id]/pay/route.ts` | Fire dispatchOpenOrdersChanged on pay |
| `src/app/api/entertainment/block-time/route.ts` | Fire dispatchEntertainmentStatusChanged |
| `src/app/api/entertainment/status/route.ts` | Fire dispatchEntertainmentStatusChanged |
| `src/app/api/orders/[id]/send/route.ts` | Fire dispatchEntertainmentStatusChanged |

## Estimated Savings

| Change | Before | After |
|--------|--------|-------|
| Entertainment polling | ~20 req/min (3s) | 0 (socket events) |
| Open orders polling | ~20 req/min (3s) | 0 (socket events) |
| Post-mutation refetches | 5 per action | 0 (store already updated) |
| Tabs refresh bursts | 3-4 per burst | 1 (debounced) |
| **Total steady-state** | **~40 req/min** | **~0 req/min** |

## Verification

1. Hold/note/course/seat/resend actions should feel instant (no loading flash)
2. Send order with entertainment items — no double fetch visible in Network tab
3. Open browser Network tab — verify no 3-second polling requests
4. Open two browser tabs — create order in tab A — verify tab B's open orders panel updates within 1s
5. Start entertainment session — verify other terminals see status change without polling
6. Socket server not running (dev) — verify graceful fallback to visibility-change refresh, no console spam
