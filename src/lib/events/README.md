# GWI POS Real-time Events System

Provider-agnostic abstraction for real-time events. Supports Socket.io (dev), Pusher (prod), or Ably (alt).

## Quick Start

```typescript
import { useEvents } from '@/lib/events'

function OrdersPage() {
  const { subscribe, emit, isConnected } = useEvents({
    locationId: 'loc_123',
    autoConnect: true,
  })

  useEffect(() => {
    const unsub = subscribe('order:created', (data) => {
      console.log('New order:', data.orderId)
      // Update UI, play sound, etc.
    })
    return unsub
  }, [subscribe])

  const createOrder = async () => {
    await emit('order:created', {
      orderId: '123',
      orderNumber: 'ORD-001',
      tableId: 'T1',
      employeeId: 'emp_456',
      employeeName: 'Sarah',
      status: 'open',
      total: 45.99,
      itemCount: 3,
    })
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Event Layer                     │
│  emit('order:created', data)                    │
│  subscribe('table:status', callback)            │
├─────────────────────────────────────────────────┤
│              Provider Interface                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  Local   │  │ Socket.io│  │  Pusher  │      │
│  │  (dev)   │  │ (server) │  │  (prod)  │      │
│  └──────────┘  └──────────┘  └──────────┘      │
└─────────────────────────────────────────────────┘
```

## Providers

### Local Provider (Default)

In-memory event bus. Events only work within the same browser tab.

```bash
# No configuration needed - this is the default
```

**Use for:**
- Development without socket server
- Testing event flows
- Single-tab applications

### Socket.io Provider

Real WebSocket communication between clients.

```bash
# Install socket.io-client
npm install socket.io-client

# Set environment variable
NEXT_PUBLIC_EVENT_PROVIDER=socket
```

**Requires:**
- A Socket.io server running (see below)
- NOT compatible with Vercel serverless

### Pusher Provider (Coming Soon)

Battle-tested, serverless-compatible.

```bash
NEXT_PUBLIC_EVENT_PROVIDER=pusher
NEXT_PUBLIC_PUSHER_KEY=your_key
NEXT_PUBLIC_PUSHER_CLUSTER=us2
```

### Ably Provider (Coming Soon)

Alternative serverless provider.

```bash
NEXT_PUBLIC_EVENT_PROVIDER=ably
NEXT_PUBLIC_ABLY_KEY=your_key
```

## Event Types

### Orders

```typescript
'order:created'      // New order created
'order:updated'      // Order status/total changed
'order:item-added'   // Item added to order
'order:item-updated' // Item status changed (sent, ready, voided)
```

### Tables

```typescript
'table:status-changed' // Table status (available, occupied, etc.)
'table:combined'       // Two tables combined
'table:split'          // Combined table split apart
```

### KDS (Kitchen Display)

```typescript
'kds:ticket-new'    // New ticket for station
'kds:ticket-bumped' // Full ticket completed
'kds:item-bumped'   // Single item completed
```

### Sync

```typescript
'sync:conflict'   // Sync conflict detected
'sync:completed'  // Sync batch completed
```

### Employees

```typescript
'employee:clock' // Clock in/out, break start/end
```

### Payments

```typescript
'payment:processed' // Payment approved/declined
```

### Tabs

```typescript
'tab:updated' // Tab status/total changed
```

## Channels

Events are scoped to channels for efficient routing:

| Channel | Format | Use Case |
|---------|--------|----------|
| location | `location:{id}` | All events for a location |
| table | `table:{id}` | Table-specific updates |
| kds | `kds:{station}` | Kitchen station events |
| employee | `employee:{id}` | Personal notifications |
| order | `order:{id}` | Order-specific updates |

```typescript
// Subscribe to specific table
subscribe('order:updated', handleUpdate, { type: 'table', id: 'T5' })

// Subscribe to KDS station
subscribe('kds:ticket-new', handleTicket, { type: 'kds', id: 'grill' })
```

## React Hooks

### useEvents

Main hook for event operations.

```typescript
const {
  subscribe,          // Subscribe to events
  emit,               // Emit events
  isConnected,        // Boolean connection status
  connectionStatus,   // 'connected' | 'connecting' | etc.
  connectionState,    // Full state with retry count
  connect,            // Manual connect
  disconnect,         // Manual disconnect
  subscribeChannel,   // Subscribe to channel
  unsubscribeChannel, // Unsubscribe from channel
} = useEvents({
  locationId: 'loc_123',
  autoConnect: true,
  channels: [{ type: 'kds', id: 'grill' }],
})
```

### useEventSubscription

Convenience hook for single event subscription.

```typescript
useEventSubscription('kds:ticket-new', (data) => {
  playSound()
  setTickets(prev => [...prev, data])
}, { type: 'kds', id: stationId })
```

### useConnectionStatus

Monitor connection state.

```typescript
const { isConnected, status, reconnectAttempts, error } = useConnectionStatus()
```

## Server-side Events

Emit events from API routes:

```typescript
import { emitServerEvent } from '@/lib/events'

export async function POST(req: Request) {
  const order = await createOrder(data)

  await emitServerEvent('order:created', {
    orderId: order.id,
    // ... event payload
  }, { type: 'location', id: locationId })

  return Response.json({ data: order })
}
```

## Socket.io Server Setup

For local development with cross-client communication:

```typescript
// server.ts (run with tsx)
import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: { origin: 'http://localhost:3000' }
})

io.on('connection', (socket) => {
  const { locationId } = socket.handshake.query

  // Auto-join location room
  socket.join(`location:${locationId}`)

  socket.on('subscribe', (channel) => {
    socket.join(channel)
  })

  socket.on('unsubscribe', (channel) => {
    socket.leave(channel)
  })

  socket.on('event', ({ event, data, channel }, callback) => {
    // Broadcast to channel or all
    const target = channel ? io.to(channel) : io.to(`location:${locationId}`)
    target.emit(event, data)
    callback({ success: true })
  })
})

httpServer.listen(3001)
```

## Testing

```typescript
import { setProvider, LocalEventProvider } from '@/lib/events'

beforeEach(() => {
  // Use local provider for tests
  const testProvider = new LocalEventProvider({ debug: false })
  setProvider(testProvider)
})

test('emits order created event', async () => {
  const { emit, subscribe } = useEvents()
  const handler = jest.fn()

  subscribe('order:created', handler)
  await emit('order:created', { orderId: '123', ... })

  expect(handler).toHaveBeenCalledWith({ orderId: '123', ... })
})
```

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Main exports, provider factory |
| `types.ts` | Event type definitions |
| `provider.ts` | Provider interface |
| `local-provider.ts` | In-memory provider |
| `socket-provider.ts` | Socket.io provider |
| `use-events.ts` | React hooks |
