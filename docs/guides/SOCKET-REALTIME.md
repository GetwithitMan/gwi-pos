# Socket & Real-Time Events — GWI POS

Reference doc for AI agents working on real-time features. All socket emissions follow strict patterns — deviating causes bugs, duplicate events, or connection leaks.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/socket-server.ts` | Socket.io server init + `emitToLocation()` / `emitToTags()` |
| `src/lib/shared-socket.ts` | Client-side singleton socket connection |
| `src/lib/socket-dispatch.ts` | Server-side dispatch helpers |
| `server.ts` | Socket middleware, room management, auth |

---

## Server-Side Dispatch

All socket emissions happen from **API routes after DB writes**. Never emit from middleware, hooks, or client-side code.

- `emitToLocation(locationId, eventName, payload)` — broadcasts to all clients at a location
- `emitToTags(locationId, tags, eventName, payload)` — targets specific screens/devices

Import from `@/lib/socket-server`. **Always fire-and-forget — never await.**

```typescript
// In API route after DB write:
import { emitToLocation } from '@/lib/socket-server'

void emitToLocation(locationId, 'orders:list-changed', { orderId, status }).catch(console.error)
// Don't await — fire and forget
```

### Why fire-and-forget?
Awaiting socket emissions blocks the HTTP response. If the socket server is slow or overloaded, the API call will time out. Failures are logged but never allowed to fail the request.

---

## Client-Side Consumer

**Always** use the shared socket singleton. Never call `io()` directly — it creates duplicate connections that are never cleaned up.

```typescript
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

useEffect(() => {
  const socket = getSharedSocket()

  const onEvent = (data) => {
    // handle event
  }

  socket.on('my:event', onEvent)

  // Join rooms if already connected (reconnect handled separately)
  if (socket.connected) {
    socket.emit('join:location', { locationId })
  }

  return () => {
    socket.off('my:event', onEvent)
    releaseSharedSocket()
  }
}, [deps])
```

**Never** add `setInterval` polling for data that can arrive via socket.

---

## Tag-Based Routing

Tags allow targeted delivery to specific screen types or devices within a location.

```typescript
// Server: only KDS bar screens receive this event
void emitToTags(locationId, ['kds', 'bar'], 'order:bumped', { orderId }).catch(console.error)
```

Tags are set when clients join rooms. Common tags: `kds`, `bar`, `expo`, `register`.

---

## Delta Update Rules

Efficient state management for socket-driven lists:

| Event Type | Action | Network |
|---|---|---|
| Removal (paid, voided, deleted, bumped) | Remove item from local state | Zero |
| Addition / change | Debounced full refresh (≥150ms) | One fetch |

**Never refetch an entire list on every socket event.** Removal events are fully handled client-side.

```typescript
socket.on('order:paid', ({ orderId }) => {
  // Remove from local state — no network call
  setOrders(prev => prev.filter(o => o.id !== orderId))
})

socket.on('orders:list-changed', debounce(() => {
  // Single refresh, debounced 150ms
  fetchOrders()
}, 150))
```

---

## Reconnect Behavior

Socket.io handles reconnection automatically. Client responsibilities:

1. **On reconnect** — rejoin rooms and refresh data
2. **Fallback polling** — 30s interval, **only** when `isConnected === false`
3. **Socket dedup** — 500ms window + 60s TTL prevents duplicate event processing

```typescript
socket.on('connect', () => {
  socket.emit('join:location', { locationId })
  fetchOrders() // refresh after reconnect
})
```

---

## Room Joining Pattern

Clients join location-specific rooms for multi-tenant isolation.

- Room name includes `locationId`
- Join on **initial connect** and on **every reconnect**
- Server validates `locationId` before admitting to room

---

## Socket Auth

| Client Type | Auth Method |
|---|---|
| Browser | Session-based (cookie/header) validated in socket middleware |
| Android device | `deviceToken` in `socket.handshake.auth`, validated in `server.ts` |

Android example:
```kotlin
val options = IO.Options().apply {
    auth = mapOf("deviceToken" to deviceToken)
}
val socket = IO.socket(baseUrl, options)
```

---

## Rules Summary

1. **Server dispatches** via `emitToLocation()` / `emitToTags()` — never client-side relay
2. **Client consumes** via `getSharedSocket()` — never raw `io()`
3. **Delta updates** for lists — never full refetch per event
4. **Fire-and-forget** on server — never await socket emissions
5. **Fallback polling** at 30s only when disconnected
6. **Socket dedup**: 500ms + 60s TTL on all events
