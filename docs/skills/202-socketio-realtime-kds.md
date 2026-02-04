# Skill 202: Socket.io Real-Time KDS

## Overview

Replaced 3-5 second polling with WebSocket-based real-time updates. KDS screens now receive instant notifications when orders are fired, items are bumped, or entertainment timers change.

## Performance Benefits

| Metric | Before (Polling) | After (Socket.io) |
|--------|------------------|-------------------|
| Latency | 3-5 seconds | <50ms |
| DB Load | ~200-300 hits/min | Near zero |
| Network | 2,880 requests/hour | On-demand only |
| Battery | Constant polling | Idle until events |
| Ghost Bumps | Common | Eliminated |

## Room Architecture

Instead of broadcasting to everyone, three types of rooms:

```
location:{id}   - Global venue alerts (sync status, hardware failures)
tag:{tagName}   - Prep stations (pizza KDS only hears tag:pizza)
terminal:{id}   - Direct messages to specific handheld
```

## Core Files

| File | Purpose |
|------|---------|
| `src/lib/socket-server.ts` | Socket.io server with room management |
| `src/lib/socket-dispatch.ts` | Helper to dispatch events from API routes |
| `src/hooks/useKDSSockets.ts` | React hook for real-time KDS |
| `src/lib/events/types.ts` | Event type definitions |
| `src/app/api/internal/socket/broadcast/route.ts` | Internal broadcast API |

## Server Setup

```typescript
// src/lib/socket-server.ts
io.on('connection', (socket) => {
  // Join rooms based on terminal identity
  socket.on('join_station', ({ locationId, tags, terminalId }) => {
    socket.join(`location:${locationId}`)
    socket.join(`terminal:${terminalId}`)
    tags.forEach((tag) => socket.join(`tag:${tag}`))
  })

  // Order "fired" - dispatch to tag rooms
  socket.on('new_order', (manifest) => {
    manifest.destinations.forEach((dest) => {
      io.to(`tag:${dest.tag}`).emit('kds:order-received', dest.orderData)
    })
  })

  // Item status change - notify expo + location
  socket.on('item_status', (payload) => {
    io.to('tag:expo').emit('kds:item-status', payload)
    io.to(`location:${locationId}`).emit('kds:item-status', payload)
  })
})
```

## API Dispatch

```typescript
// In /api/orders/[id]/send/route.ts
import { OrderRouter } from '@/lib/order-router'
import { dispatchNewOrder } from '@/lib/socket-dispatch'

// After saving to DB
const routingResult = await OrderRouter.resolveRouting(orderId, itemIds)

// Fire-and-forget socket dispatch
dispatchNewOrder(locationId, routingResult, { async: true })
```

## Dispatch Functions

```typescript
import {
  dispatchNewOrder,
  dispatchItemStatus,
  dispatchOrderBumped,
  dispatchEntertainmentUpdate,
  dispatchLocationAlert,
} from '@/lib/socket-dispatch'

// New order to KDS screens
await dispatchNewOrder(locationId, routingResult)

// Item status change (cooking/ready/served)
await dispatchItemStatus(locationId, {
  orderId, itemId, status, stationId, updatedBy
})

// Order bumped from station
await dispatchOrderBumped(locationId, {
  orderId, stationId, bumpedBy, allItemsServed
})

// Entertainment timer update
await dispatchEntertainmentUpdate(locationId, {
  sessionId, tableId, tableName, action, expiresAt
})

// Location-wide alert
await dispatchLocationAlert(locationId, {
  type: 'warning', title: 'Printer Offline', message: '...'
})
```

## React Hook Usage

```typescript
// src/hooks/useKDSSockets.ts
import { useKDSSockets } from '@/hooks/useKDSSockets'

function KDSScreen({ locationId, stationId }) {
  const {
    orders,
    isConnected,
    connectionError,
    updateItemStatus,
    bumpOrder,
    refreshOrders,
  } = useKDSSockets({
    locationId,
    tags: ['pizza', 'made-to-order'],
    terminalId: 'kds-pizza-1',
    stationId,
    onNewOrder: (order) => playChime(),
    playSound: true,
    flashOnNew: true,
  })

  return (
    <div>
      {orders.map(order => (
        <OrderCard
          key={order.orderId}
          order={order}
          onBump={() => bumpOrder(order.orderId)}
          onItemClick={(itemId) => updateItemStatus(order.orderId, itemId, 'ready')}
        />
      ))}
    </div>
  )
}
```

## Event Types

```typescript
// KDSOrderReceivedEvent - New order arrived
{
  orderId: string
  orderNumber: number
  tableName: string | null
  employeeName: string
  primaryItems: Array<{
    id, name, quantity, modifiers, isPizza, pizzaData
  }>
  referenceItems: Array<{
    id, name, quantity, stationName
  }>
  matchedTags: string[]
  stationId: string
  stationName: string
}

// KDSItemStatusUpdateEvent - Item status changed
{
  orderId: string
  itemId: string
  status: 'pending' | 'cooking' | 'ready' | 'served' | 'bumped'
  updatedBy: string
  stationId: string
}

// KDSOrderBumpedEvent - Order removed from station
{
  orderId: string
  stationId: string
  bumpedBy: string
  allItemsServed: boolean
}

// EntertainmentSessionUpdateEvent - Timer update
{
  sessionId: string
  tableId: string
  tableName: string
  action: 'started' | 'extended' | 'stopped' | 'warning'
  expiresAt: string | null
  addedMinutes?: number
}
```

## Dependencies

```bash
npm install socket.io socket.io-client
```

## Deployment Notes

### Local Server (Recommended)
Socket.io runs on the same server as Next.js. Initialize in custom server:

```typescript
// server.ts
import { createServer } from 'http'
import { initializeSocketServer, setSocketServer } from './src/lib/socket-server'

const httpServer = createServer(app)
const io = await initializeSocketServer(httpServer)
setSocketServer(io)
```

### Serverless (Vercel, etc.)
Socket.io doesn't work with serverless. Options:
1. Use Pusher or Ably (see `src/lib/events/` for provider abstraction)
2. Fall back to polling (hook handles this automatically)

## Related Skills

- **Skill 201:** Tag-Based Routing Engine
- **Skill 203:** Reference Items & Atomic Print Configuration

## See Also

- CHANGELOG: Session 25 (2026-01-31)
- Plan file: `~/.claude/plans/shiny-wondering-eagle.md` (Phase 8)
