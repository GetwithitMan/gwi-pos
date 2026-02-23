---
skill: 110
title: Real-time Events (Socket.io)
status: DONE
depends_on: []
---

# Skill 110: Real-time Events

> **Status:** DONE
> **Dependencies:** None
> **Last Updated:** 2026-02-23

## Overview

Real-time events system using Socket.io via custom Node.js server (`server.ts`). All cross-terminal updates flow through `emitToLocation()` / `emitToTags()` on the server side, and `getSharedSocket()` / `useEvents()` on the client side. Fallback polling (20-30s) activates only when the socket is disconnected.

The centralized dispatch layer (`src/lib/socket-dispatch.ts`) provides typed helper functions for every event, ensuring consistency across all 348+ API routes.

## Status

### Completed

- [x] Socket.io server integrated in `server.ts` (custom Node.js server)
- [x] Server-side emission helpers (`emitToLocation`, `emitToTags` from `src/lib/socket-server.ts`)
- [x] Centralized dispatch layer (`src/lib/socket-dispatch.ts`) with typed helpers for all events
- [x] Client-side shared socket singleton (`getSharedSocket` / `releaseSharedSocket` from `src/lib/shared-socket.ts`)
- [x] React hooks (`useEvents`, `useEventSubscription`, `useConnectionStatus` from `src/lib/events/`)
- [x] Dedicated hooks: `useOrderSockets`, `useMenuSocket`, `useOrderEditing`
- [x] Provider interface (EventProvider) with Local + Socket.io providers
- [x] Channel-based subscriptions (location, table, kds, employee, order)
- [x] Connection state management with `isConnected` gating
- [x] Fallback polling (20-30s) only when socket is disconnected
- [x] Socket reconnect → automatic data refresh (KDS, FloorPlan, Orders, Entertainment KDS)
- [x] Visibility change → instant refresh on tab switch
- [x] Delta updates for removals (paid/voided/bumped → local state patch, zero network)
- [x] Debounced full refresh for additions/changes (150-300ms)
- [x] Tag-based routing via `emitToTags()` (KDS stations, entertainment)
- [x] Multi-surface events (CFD, Pay-at-Table, Mobile Bartender)
- [x] Order editing conflict detection (peer-to-peer via server relay)
- [x] System reload broadcast for remote terminal management
- [x] Cache invalidation events (menu, floor plan, settings, employees, order types)
- [x] 40+ working event types across all domains
- [x] Documentation (this file)

### Remaining (Future)

- [ ] Pusher/Ably provider for serverless deployments

## Complete Event Reference

### KDS Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `kds:order-received` | `dispatchKdsOrderReceived` (socket-dispatch) | KDS page (`kds/page.tsx`) | New ticket sent to kitchen. Uses `emitToTags()` to route to matched KDS stations. |
| `kds:item-status` | `dispatchKdsItemStatus` (socket-dispatch) | KDS page (`kds/page.tsx`) | Item completed/uncompleted. Emitted to `['expo']` tag. |
| `kds:order-bumped` | `dispatchKdsOrderBumped` (socket-dispatch) | KDS page (`kds/page.tsx`) | Entire order bumped. Emitted to `['expo']` tag. |

### Entertainment Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `entertainment:session-update` | `dispatchEntertainmentSessionUpdate` | Entertainment KDS (`entertainment/page.tsx`) | Session started/stopped/extended. Uses `emitToTags(['entertainment'])`. |
| `entertainment:status-changed` | `dispatchEntertainmentStatusChanged` | Entertainment KDS, Menu page, `useOrderSockets` | Status change (active/paused/ended). Emitted to location. |

### Order Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `order:created` | `dispatchOrderCreated` (socket-dispatch) | KDS page | New order created (KDS routing via tags). |
| `orders:list-changed` | `dispatchOrdersListChanged` + multiple API routes | `useOrderSockets`, `useActiveOrder`, FloorPlanHome, Entertainment KDS, Orders Manager, SplitCheckScreen | Order list changed (create/send/pay/void/split). Includes `trigger` and `tableId` for delta updates. |
| `order:totals-updated` | `dispatchOrderTotalsUpdated` | `useOrderSockets` | Order total changed (delta patch for floor plan badges). |
| `order:updated` | `dispatchOrderUpdated` (socket-dispatch) | UnifiedFloorPlan, TabsPanel, BottleServiceBanner, mobile tabs | Order metadata changed (items, notes, tableId). |
| `order:item-added` | `dispatchOrderItemAdded` (socket-dispatch) | BottleServiceBanner | Item added to order (bottle service progress tracking). |
| `order:editing` | Client → server relay (`socket-server.ts`) | ConflictBanner | Terminal editing an order — broadcast to location for conflict detection. Peer-to-peer via server relay. |
| `order:editing-released` | Client → server relay (`socket-server.ts`) | ConflictBanner | Terminal stopped editing — clears conflict banner. |

### Floor Plan Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `floor-plan:updated` | `dispatchFloorPlanUpdated` + cache-invalidate API | FloorPlanHome (via provider) | Layout/structure changed (full reload). |
| `table:status-changed` | `dispatchTableStatusChanged` (socket-dispatch) | FloorPlanHome (via provider) | Table status changed (delta patch). |
| `floorplan:changed` | Tables API (`/api/tables/[id]`) | *Emitted, no dedicated listener* | Table CRUD change. Covered by `floor-plan:updated`. |

### Menu Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `menu:updated` | `dispatchMenuUpdated` + cache-invalidate API | Liquor builder page, menu cache invalidation | Menu data changed (broad invalidation). |
| `menu:item-changed` | `dispatchMenuItemChanged` (socket-dispatch) | `useMenuSocket` | Specific item changed (targeted cache invalidation). |
| `menu:stock-changed` | `dispatchMenuStockChanged` (socket-dispatch) | `useMenuSocket` | Item stock/86 status changed. |
| `menu:structure-changed` | `dispatchMenuStructureChanged` + cache-invalidate API | `useMenuSocket` | Category/structure changed (full menu reload). |
| `menu:changed` | Menu categories/items API routes | Online ordering menu page | Menu CRUD from admin (category/item create/update/delete). |
| `ingredient:library-update` | `dispatchIngredientLibraryUpdate` (socket-dispatch) | Menu builder (`menu/page.tsx`) | Ingredient created inline → updates library across terminals. |

### Payment & Tab Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `payment:processed` | `dispatchPaymentProcessed` (socket-dispatch) | SplitCheckScreen, TabsPanel, BottleServiceBanner, mobile tabs | Payment completed — updates split screen, tab lists. |
| `tab:updated` | `dispatchTabUpdated` (socket-dispatch) | PaymentModal, TabsPanel, BottleServiceBanner, mobile tabs | Tab metadata changed (pre-auth, items, status). |

### Tip Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `tip-group:updated` | `dispatchTipGroupUpdated` (socket-dispatch) | *Emitted, routed via provider onAny* | Tip group membership or segment changed. |

### EOD Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `eod:reset-complete` | EOD reset API (`/api/eod/reset`) | FloorPlanHome | End of day reset complete — shows summary overlay with paid/voided/stale counts. |

### Void/Comp Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `void:approval-update` | `dispatchVoidApprovalUpdate` (socket-dispatch) | Orders page (via provider) | Void request approved/denied by manager (remote approval flow). |

### Location Alert Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `location:alert` | `dispatchLocationAlert` (socket-dispatch) | `LocationAlertListener` (root layout) | System alert → toast on all terminals. |

### System Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `system:reload` | Reload terminal/terminals API | `SystemReloadListener` (root layout) | Remote terminal reload command from MC. |

### Employee & Shift Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `employees:changed` | Employee CRUD API routes | *Emitted, no dedicated listener yet* | Employee created/updated/deleted. |
| `employee:clock-changed` | Time clock API (`/api/time-clock`) | *Emitted, no dedicated listener yet* | Employee clocked in/out. |
| `shifts:changed` | Shifts API routes | *Emitted, no dedicated listener yet* | Shift started/closed/updated. |
| `employees:updated` | Cache-invalidate API | *Emitted, cache invalidation only* | Employee data changed (cloud sync). |

### Settings & Config Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `settings:updated` | Cache-invalidate API | *Emitted, cache invalidation only* | Location settings changed (cloud sync). |
| `order-types:updated` | Cache-invalidate API | *Emitted, cache invalidation only* | Order types changed (cloud sync). |

### Inventory Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `inventory:adjustment` | `dispatchInventoryAdjustment` (socket-dispatch) | *Emitted, no client listener* | Bulk adjustment log for future inventory admin dashboard. |
| `inventory:stock-change` | `dispatchInventoryStockChange` (socket-dispatch) | *Emitted, no client listener* | 86'd badge updates on POS terminals (reserved for future). |
| `inventory:changed` | Ingredient API + liquor sync API | *Emitted, no dedicated listener yet* | Ingredient/inventory data changed. |

### CFD (Customer-Facing Display) Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `cfd:show-order` | `dispatchCfdShowOrder` (socket-dispatch) | CFD page (`cfd/page.tsx`) | POS → CFD: Show order summary on customer display. |
| `cfd:payment-started` | `dispatchCfdPaymentStarted` (socket-dispatch) | CFD page | POS → CFD: Payment flow initiated. |
| `cfd:tip-prompt` | `dispatchCfdTipPrompt` (socket-dispatch) | CFD page | POS → CFD: Show tip selection screen. |
| `cfd:signature-request` | POS payment flow | CFD page | POS → CFD: Request signature. |
| `cfd:processing` | POS payment flow | CFD page | POS → CFD: Payment processing animation. |
| `cfd:approved` | POS payment flow | CFD page | POS → CFD: Payment approved confirmation. |
| `cfd:declined` | POS payment flow | CFD page | POS → CFD: Payment declined message. |
| `cfd:idle` | POS payment flow | CFD page | POS → CFD: Return to idle/welcome screen. |
| `cfd:receipt-sent` | `dispatchCfdReceiptSent` (socket-dispatch) | CFD page | POS → CFD: Receipt delivery confirmation. |
| `cfd:tip-selected` | CFD page (customer interaction) | POS terminal | CFD → POS: Customer selected tip amount. |
| `cfd:signature-done` | CFD page (customer interaction) | POS terminal | CFD → POS: Customer completed signature. |
| `cfd:receipt-choice` | CFD page (customer interaction) | POS terminal | CFD → POS: Customer chose receipt method (email/text/print/none). |

### Pay-at-Table Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `pat:pay-request` | Pay-at-table page (iPad) | POS terminal | iPad → POS: Request to close tab tableside. |
| `pat:pay-result` | POS payment flow | Pay-at-table page | POS → iPad: Payment result (success/failure). |

### Mobile Bartender Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `tab:close-request` | Mobile phone | POS terminal (server relay) | Phone → Terminal: Request to close tab. Relayed via server to location room. |
| `tab:closed` | `dispatchMobileTabClosed` (socket-dispatch) | MobileTabActions | Terminal → Phone: Tab closed result. |
| `tab:status-update` | `dispatchMobileTabStatusUpdate` (socket-dispatch) | MobileTabActions | Terminal → Phone: Tab status change. |
| `tab:items-updated` | `dispatchMobileTabItemsUpdated` (socket-dispatch) | *Emitted, no dedicated listener yet* | Server → Phone: Tab items changed. |
| `tab:transfer-request` | Mobile phone | POS terminal (server relay) | Phone → Terminal: Request to transfer tab. Relayed via server. |
| `tab:alert-manager` | Mobile phone | POS terminal (server relay) | Phone → Terminal: Alert manager about tab. Relayed via server. |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    server.ts (Node.js)                           │
│  Socket.io server on same HTTP port                              │
│  Rooms: location:{id}, kds:{tag}, terminal:{id}                  │
│  ┌───────────────────────┐  ┌────────────────────────┐          │
│  │ emitToLocation()      │  │ emitToTags()           │          │
│  │ Broadcast to location │  │ Route to KDS stations  │          │
│  └───────────────────────┘  └────────────────────────┘          │
│  Peer relay: order:editing, tab:close-request, etc.              │
├─────────────────────────────────────────────────────────────────┤
│             socket-dispatch.ts (Typed Helpers)                   │
│  dispatchOrdersListChanged(), dispatchKdsOrderReceived(), etc.   │
│  40+ typed dispatch functions — used by all API routes           │
├─────────────────────────────────────────────────────────────────┤
│                    Client (Browser)                              │
│  ┌──────────────────┐  ┌──────────────────────────────┐        │
│  │ getSharedSocket()│  │ useEvents() / subscribe()    │        │
│  │ (direct .on())   │  │ (provider layer + isConnected)│        │
│  └──────────────────┘  └──────────────────────────────┘        │
│  ┌──────────────────┐  ┌──────────────────────────────┐        │
│  │ useOrderSockets()│  │ useMenuSocket()              │        │
│  │ (orders domain)  │  │ (menu domain)                │        │
│  └──────────────────┘  └──────────────────────────────┘        │
│  KDS, Orders, FloorPlan, Entertainment, CFD, Tabs, Mobile       │
└─────────────────────────────────────────────────────────────────┘
```

### Three Client Patterns

1. **Direct socket** (`getSharedSocket`): Used by KDS, entertainment KDS, CFD — direct `.on()` listeners
2. **Provider layer** (`useEvents`): Used by FloorPlan, Orders — `subscribe()` abstraction with `isConnected` state
3. **Domain hooks** (`useOrderSockets`, `useMenuSocket`): Encapsulate multi-event subscriptions for specific domains

All three share the same underlying Socket.io connection via `getSharedSocket()`.

### Server-Side Event Routing

- **`emitToLocation(locationId, event, data)`** — Broadcasts to all terminals in a location room
- **`emitToTags(tags, event, data)`** — Routes to specific KDS station tags (e.g., `['bar']`, `['expo']`, `['entertainment']`)
- **Peer relay** — Some events (e.g., `order:editing`, `tab:close-request`) are received from one client and relayed to the location room via `socket.on()` handlers in `socket-server.ts`

## Server-Side Emission Pattern

```typescript
// In API route after DB write:
import { dispatchOrdersListChanged } from '@/lib/socket-dispatch'

// Typed dispatch (preferred):
void dispatchOrdersListChanged(locationId, {
  orderId, trigger: 'paid', tableId, status: 'available'
}).catch(console.error)

// Or direct emit:
import { emitToLocation } from '@/lib/socket-server'
void emitToLocation(locationId, 'orders:list-changed', {
  orderId, trigger: 'paid', tableId, status: 'available'
}).catch(console.error)
```

## Client-Side Patterns

### Direct Socket (KDS, Entertainment, CFD)
```typescript
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

useEffect(() => {
  const socket = getSharedSocket()
  const onEvent = (data) => { /* handle */ }
  socket.on('kds:order-received', onEvent)
  socket.on('connect', () => { loadOrders() }) // Refresh on reconnect
  if (socket.connected) { /* join rooms */ }
  return () => {
    socket.off('kds:order-received', onEvent)
    releaseSharedSocket()
  }
}, [])
```

### Provider Layer (FloorPlan, Orders)
```typescript
import { useEvents } from '@/lib/events'

const { subscribe, isConnected } = useEvents({ locationId, autoConnect: true })

// Fallback polling only when disconnected
useEffect(() => {
  if (isConnected) return
  const fallback = setInterval(loadData, 20000)
  return () => clearInterval(fallback)
}, [isConnected])

// Subscribe to events
useEffect(() => {
  if (!isConnected) return
  const unsubs = [
    subscribe('orders:list-changed', handleOrderChange),
    subscribe('floor-plan:updated', handleFloorPlanChange),
  ]
  return () => unsubs.forEach(fn => fn())
}, [isConnected, subscribe])
```

### Domain Hook (Orders)
```typescript
import { useOrderSockets } from '@/hooks/useOrderSockets'

// Encapsulates orders:list-changed, order:totals-updated,
// entertainment:status-changed with proper debouncing
useOrderSockets({
  locationId,
  onListChanged: handleListChanged,
  onTotalsUpdated: handleTotalsUpdated,
})
```

## Key Files

| File | Purpose |
|------|---------|
| `server.ts` | Socket.io server initialization, room management |
| `src/lib/socket-server.ts` | `emitToLocation()`, `emitToTags()`, peer relay handlers |
| `src/lib/socket-dispatch.ts` | 40+ typed dispatch functions for all events |
| `src/lib/shared-socket.ts` | Client-side singleton socket (ref-counted) |
| `src/lib/events/index.ts` | Provider factory |
| `src/lib/events/types.ts` | Event type definitions (TypeScript interfaces) |
| `src/lib/events/provider.ts` | Provider interface |
| `src/lib/events/use-events.ts` | React hooks (`useEvents`, `useEventSubscription`) |
| `src/lib/events/socket-provider.ts` | Socket.io provider implementation |
| `src/hooks/useOrderSockets.ts` | Orders domain socket hook |
| `src/hooks/useMenuSocket.ts` | Menu domain socket hook |
| `src/hooks/useOrderEditing.ts` | Order editing conflict hook |
| `src/hooks/useActiveOrder.ts` | Active order with socket updates |
| `src/types/multi-surface.ts` | CFD, PAT, Mobile event constants |
| `src/components/SystemReloadListener.tsx` | System reload handler |
| `src/components/LocationAlertListener.tsx` | Location alert handler |
| `src/components/orders/ConflictBanner.tsx` | Order editing conflict UI |

## Event Summary by Count

| Domain | Events | With Listeners | Emitted Only |
|--------|--------|----------------|--------------|
| KDS | 3 | 3 | 0 |
| Entertainment | 2 | 2 | 0 |
| Orders | 7 | 6 | 1 (`order:editing-released` is peer relay) |
| Floor Plan | 3 | 2 | 1 (`floorplan:changed`) |
| Menu | 5 | 5 | 0 |
| Payment/Tabs | 2 | 2 | 0 |
| Tips | 1 | 0 | 1 |
| EOD | 1 | 1 | 0 |
| Void/Comp | 1 | 1 | 0 |
| Location | 1 | 1 | 0 |
| System | 1 | 1 | 0 |
| Employees/Shifts | 4 | 0 | 4 |
| Settings/Config | 2 | 0 | 2 |
| Inventory | 3 | 0 | 3 |
| Ingredient | 1 | 1 | 0 |
| CFD | 12 | 12 | 0 |
| Pay-at-Table | 2 | 2 | 0 |
| Mobile Bartender | 6 | 4 | 2 |
| **Total** | **57** | **43** | **14** |

## Related Skills

| Skill | Relation |
|-------|----------|
| 23 | KDS Display — uses `kds:*` events |
| 16 | Table Layout — uses `floor-plan:*`, `orders:list-changed`, `table:status-changed` |
| 02 | Order Entry — uses `order:*`, `orders:list-changed` events |
| 248 | Socket Layer Consolidation — eliminated polling, added `useOrderSockets` |
| 339-344 | Performance overhaul — delta updates, socket-first architecture |
| 340 | Shared Socket Singleton — `getSharedSocket()` with ref counting |
| 389 | CFD Customer-Facing Display — `cfd:*` events |
| 386 | Mobile Bartender Tab Sync — `tab:*` events |
| 387 | Pay-at-Table Socket Sync — `pat:*` events |
| 397 | Stale Orders Manager — uses `orders:list-changed` |
| 398 | EOD Auto-Close — uses `eod:reset-complete` |
| 415 | Cash Drawer Open Signal — cash drawer trigger via pay route |
| 421 | Speed & Reconnect — reconnect auto-refresh, optimistic render, socket-gated polling |
