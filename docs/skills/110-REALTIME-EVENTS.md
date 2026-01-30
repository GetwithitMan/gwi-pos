---
skill: 110
title: Real-time Events (Socket.io/Pusher)
status: PARTIAL
depends_on: []
---

# Skill 110: Real-time Events

> **Status:** PARTIAL
> **Dependencies:** None
> **Last Updated:** 2026-01-30

## Overview

Provider-agnostic real-time events system. Currently supports local (in-memory) and Socket.io providers. Designed for easy swap to Pusher/Ably for production serverless deployment.

## Status

### Completed

- [x] Event type definitions (EventMap, 15+ event types)
- [x] Provider interface (EventProvider)
- [x] Local provider (in-memory, development)
- [x] Socket.io provider (requires socket.io-client)
- [x] React hooks (useEvents, useEventSubscription, useConnectionStatus)
- [x] Channel-based subscriptions (location, table, kds, employee, order)
- [x] Connection state management
- [x] Documentation

### Remaining

- [ ] Pusher provider implementation
- [ ] Ably provider implementation
- [ ] Socket.io server endpoint for Next.js
- [ ] Server-side event emission (API routes)
- [ ] Integration with existing polling code
- [ ] Replace polling in KDS, Orders, Tables pages

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

## Event Types

### Orders
| Event | Payload | Description |
|-------|---------|-------------|
| `order:created` | orderId, tableId, employeeId, total | New order created |
| `order:updated` | orderId, status, total | Order status/total changed |
| `order:item-added` | orderId, itemId, name, price | Item added to order |
| `order:item-updated` | orderId, itemId, status | Item status changed |

### Tables
| Event | Payload | Description |
|-------|---------|-------------|
| `table:status-changed` | tableId, previousStatus, newStatus | Status toggle |
| `table:combined` | primaryId, secondaryId, combinedName | Tables merged |
| `table:split` | tableId, restoredTableIds | Combined table split |

### KDS
| Event | Payload | Description |
|-------|---------|-------------|
| `kds:ticket-new` | ticketId, station, items | New ticket |
| `kds:ticket-bumped` | ticketId, station, bumpedBy | Ticket completed |
| `kds:item-bumped` | ticketId, itemId, station | Single item done |

### Sync
| Event | Payload | Description |
|-------|---------|-------------|
| `sync:conflict` | entityType, entityId, versions | Conflict detected |
| `sync:completed` | pushed, pulled, conflicts | Batch complete |

## Channels

Events are scoped to channels for efficient routing:

| Channel | Format | Use Case |
|---------|--------|----------|
| location | `location:{id}` | All location events |
| table | `table:{id}` | Table-specific |
| kds | `kds:{station}` | Kitchen station |
| employee | `employee:{id}` | Personal notifications |
| order | `order:{id}` | Order-specific |

## Usage

### React Component

```typescript
import { useEvents } from '@/lib/events'

function OrdersPage() {
  const { subscribe, emit, isConnected } = useEvents({
    locationId: 'loc_123',
  })

  useEffect(() => {
    const unsub = subscribe('order:created', (data) => {
      console.log('New order:', data.orderId)
    })
    return unsub
  }, [subscribe])
}
```

### API Route (Server-side)

```typescript
import { emitServerEvent } from '@/lib/events'

export async function POST(req: Request) {
  const order = await createOrder(data)

  await emitServerEvent('order:created', {
    orderId: order.id,
    ...
  }, { type: 'location', id: locationId })

  return Response.json({ data: order })
}
```

## Provider Selection

Set via environment variable:

```bash
# Local (default) - in-memory, single-tab
NEXT_PUBLIC_EVENT_PROVIDER=local

# Socket.io - requires server
NEXT_PUBLIC_EVENT_PROVIDER=socket

# Pusher (coming soon)
NEXT_PUBLIC_EVENT_PROVIDER=pusher

# Ably (coming soon)
NEXT_PUBLIC_EVENT_PROVIDER=ably
```

## Files

| File | Purpose |
|------|---------|
| `src/lib/events/index.ts` | Main exports, provider factory |
| `src/lib/events/types.ts` | Event type definitions |
| `src/lib/events/provider.ts` | Provider interface |
| `src/lib/events/local-provider.ts` | In-memory provider |
| `src/lib/events/socket-provider.ts` | Socket.io provider |
| `src/lib/events/use-events.ts` | React hooks |
| `src/lib/events/README.md` | Full documentation |

## Dependencies

```bash
# For Socket.io provider
npm install socket.io-client

# For Pusher provider (future)
npm install pusher-js

# For Ably provider (future)
npm install ably
```

## Related Skills

| Skill | Relation |
|-------|----------|
| 23 | KDS Display - Will use kds:* events |
| 16 | Table Layout - Will use table:* events |
| 02 | Order Entry - Will use order:* events |
| 60 | Offline Mode - sync:* events for conflict resolution |

## Testing

```typescript
import { setProvider, LocalEventProvider } from '@/lib/events'

beforeEach(() => {
  const testProvider = new LocalEventProvider({ debug: false })
  setProvider(testProvider)
})

test('emits order created event', async () => {
  const handler = jest.fn()
  provider.subscribe('order:created', handler)

  await provider.emit('order:created', { orderId: '123', ... })

  expect(handler).toHaveBeenCalledWith({ orderId: '123', ... })
})
```

## Migration Path

1. **Phase 1 (Current):** Local provider for development
2. **Phase 2:** Socket.io for local server deployments
3. **Phase 3:** Pusher/Ably for Vercel/serverless production

## Why Provider Pattern?

| Scenario | Provider | Reason |
|----------|----------|--------|
| Development | Local | No external deps |
| Local server | Socket.io | Full control, fast |
| Vercel | Pusher | Serverless-compatible |
| Enterprise | Ably | Compliance features |
