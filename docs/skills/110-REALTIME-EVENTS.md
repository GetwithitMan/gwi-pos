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

## Status

### Completed

- [x] Socket.io server integrated in `server.ts` (custom Node.js server)
- [x] Server-side emission helpers (`emitToLocation`, `emitToTags` from `src/lib/socket-server.ts`)
- [x] Client-side shared socket singleton (`getSharedSocket` / `releaseSharedSocket` from `src/lib/shared-socket.ts`)
- [x] React hooks (`useEvents`, `useEventSubscription`, `useConnectionStatus` from `src/lib/events/`)
- [x] Provider interface (EventProvider) with Local + Socket.io providers
- [x] Channel-based subscriptions (location, table, kds, employee, order)
- [x] Connection state management with `isConnected` gating
- [x] Fallback polling (20-30s) only when socket is disconnected
- [x] Socket reconnect → automatic data refresh (KDS, FloorPlan)
- [x] Visibility change → instant refresh on tab switch
- [x] Delta updates for removals (paid/voided/bumped → local state patch, zero network)
- [x] Debounced full refresh for additions/changes (150-300ms)
- [x] 13+ working event types across all domains
- [x] Documentation

### Remaining (Future)

- [ ] Pusher/Ably provider for serverless deployments (Phase 3)

## Working Events

### KDS Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `kds:order-received` | Kitchen send API | KDS page | New ticket sent to kitchen |
| `kds:item-status` | KDS bump API | KDS page | Item completed/uncompleted |
| `kds:order-bumped` | KDS bump API | KDS page | Entire order bumped |

### Entertainment Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `entertainment:session-update` | Session API routes | FloorPlan, Entertainment KDS | Session started/stopped/extended |
| `entertainment:status-changed` | Session API routes | Entertainment KDS | Status change (active/paused/ended) |

### Order Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `order:created` | Order create API | KDS page | New order created (KDS routing) |
| `orders:list-changed` | Multiple order APIs | FloorPlan, Orders page | Order list changed (create/send/pay/void) — includes `trigger` and `tableId` for delta updates |
| `order:totals-updated` | Order items API | FloorPlan | Order total changed (delta patch) |

### Floor Plan Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `floor-plan:updated` | Floor plan editor API | FloorPlan | Layout/structure changed (full reload) |
| `table:status-changed` | Table status API | FloorPlan | Table status changed (delta patch) |

### Menu Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `menu:updated` | Menu API routes | Menu cache invalidation | Menu data changed |
| `menu:item-changed` | Menu item API | Menu cache invalidation | Specific item changed |

### EOD Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `eod:reset-complete` | EOD reset API | FloorPlan | End of day reset complete — shows summary overlay |

### Void/Comp Events
| Event | Emitted By | Listened By | Description |
|-------|-----------|-------------|-------------|
| `void:approval-update` | Void approval API | Orders page | Void request approved/denied |

### Emitted, Awaiting UI Wiring
| Event | Emitted By | Description |
|-------|-----------|-------------|
| `location:alert` | Various system APIs | Location-wide alert (no client listener yet) |
| `inventory:adjustment` | Inventory API | Stock adjustment made (no client listener yet) |
| `inventory:stock-change` | Payment/void APIs | Inventory deducted on sale/void (no client listener yet) |
| `ingredient:library-update` | Ingredient API | Ingredient library changed (no client listener yet) |

## Architecture

```
┌─────────────────────────────────────────────────┐
│              server.ts (Node.js)                 │
│  Socket.io server on same HTTP port              │
│  emitToLocation(locationId, event, data)         │
│  emitToTags(locationId, tags, event, data)        │
├─────────────────────────────────────────────────┤
│              Client (Browser)                    │
│  ┌──────────────────┐  ┌──────────────────┐     │
│  │ getSharedSocket()│  │ useEvents() hook │     │
│  │ (direct Socket)  │  │ (provider layer) │     │
│  └──────────────────┘  └──────────────────┘     │
│  KDS, Orders, FloorPlan, Entertainment KDS       │
└─────────────────────────────────────────────────┘
```

### Two Client Patterns

1. **Direct socket** (`getSharedSocket`): Used by KDS, entertainment KDS — direct `.on()` listeners
2. **Provider layer** (`useEvents`): Used by FloorPlan, Orders — `subscribe()` abstraction with `isConnected` state

Both share the same underlying Socket.io connection.

## Server-Side Emission Pattern

```typescript
// In API route after DB write:
import { emitToLocation } from '@/lib/socket-server'

// Fire-and-forget (don't await)
emitToLocation(locationId, 'orders:list-changed', {
  orderId, trigger: 'paid', tableId, status: 'available'
})
```

## Client-Side Patterns

### Direct Socket (KDS, Entertainment)
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

## Key Files

| File | Purpose |
|------|---------|
| `server.ts` | Socket.io server initialization |
| `src/lib/socket-server.ts` | `emitToLocation()`, `emitToTags()` helpers |
| `src/lib/shared-socket.ts` | Client-side singleton socket (ref-counted) |
| `src/lib/events/index.ts` | Provider factory |
| `src/lib/events/types.ts` | Event type definitions |
| `src/lib/events/provider.ts` | Provider interface |
| `src/lib/events/use-events.ts` | React hooks (`useEvents`, `useEventSubscription`) |

## Related Skills

| Skill | Relation |
|-------|----------|
| 23 | KDS Display — uses `kds:*` events |
| 16 | Table Layout — uses `floor-plan:*`, `orders:list-changed`, `table:status-changed` |
| 02 | Order Entry — uses `order:*`, `orders:list-changed` events |
| 339-344 | Performance overhaul — delta updates, socket-first architecture |
