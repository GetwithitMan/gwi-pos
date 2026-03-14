# Socket & Real-Time Events — GWI POS

Reference doc for AI agents working on real-time features. All socket emissions follow strict patterns — deviating causes bugs, duplicate events, or connection leaks.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/socket-server.ts` | Socket.io server init + `emitToLocation()` / `emitToTags()` + metrics |
| `src/lib/shared-socket.ts` | Client-side singleton socket connection |
| `src/lib/socket-dispatch.ts` | Server-side dispatch helpers |
| `src/lib/socket-event-buffer.ts` | Persistent L2 buffer (PG-backed) for restart recovery |
| `src/lib/cloud-relay-client.ts` | Outbound WebSocket to cloud relay for real-time push |
| `src/app/api/health/sockets/route.ts` | Socket health monitoring endpoint |
| `server.ts` | Socket middleware, room management, auth, relay wiring |

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
4. **Restart recovery** — after NUC restart, events replay from PG (`SocketEventLog` L2 buffer, 30min TTL). CFD pairings rehydrate from `Terminal.metadata`. No events are lost on restart.

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

## Persistent Event Buffer

Socket events use a two-tier buffer architecture for restart resilience:

- **L1 (in-memory):** Ring buffer with 500ms dedup window and 60s TTL. Fast path for normal operation. All `emitToLocation()` / `emitToTags()` calls write here first.
- **L2 (PostgreSQL):** `SocketEventLog` table — PG write-through from L1. 30min TTL, cleanup runs every 5 minutes.
- **Restart recovery:** On NUC restart, `socket-event-buffer.ts` reads pending events from PG and replays them to reconnecting clients. No events lost within the 30min window.
- **CFD pairing persistence:** CFD→Terminal pairings are stored in `Terminal.metadata` (JSONB) and rehydrated on socket server startup. A restart does not break CFD pairings.

**Key file:** `src/lib/socket-event-buffer.ts`

---

## Cloud Relay

An outbound WebSocket from the NUC to the cloud relay enables real-time bidirectional push without the NUC needing a public IP.

- **NUC → Cloud:** Emits `SYNC_SUMMARY`, `BUSINESS_EVENT`, `HEALTH`, `OUTAGE_DEAD_LETTER` events. Mission Control receives these for live dashboard updates.
- **Cloud → NUC:** `DATA_CHANGED`, `CONFIG_UPDATED`, `COMMAND` events trigger immediate downstream sync, replacing the need to wait for the 5s polling interval.
- **Safety switch:** 5 consecutive connection failures → falls back to 2s polling. Automatic recovery when relay reconnects.
- **Auto-reconnect:** Exponential backoff (1s–30s), 60s heartbeat keepalive.
- **Auth:** `SERVER_API_KEY` in connection handshake headers.
- **Env var:** `CLOUD_RELAY_URL` — relay is disabled when unset (polling-only mode).
- **Invariant:** Relay is an acceleration layer ONLY. All durability guarantees remain in the DB-backed sync workers. Relay failure never causes data loss.

**Key file:** `src/lib/cloud-relay-client.ts`

---

## Socket Monitoring

`GET /api/health/sockets` returns comprehensive socket health metrics:

- **Connected clients:** Count of active socket connections
- **Throughput:** Events per minute (60s sliding window)
- **Reconnection rate:** Reconnections per minute
- **CFD pairings:** Active CFD↔Terminal pairings
- **Ack queue depth:** Pending acknowledgments
- **Relay status:** Cloud relay connection state + uptime
- **Sync metrics:** Current sync worker status

Metrics are collected via an in-memory ring buffer in `socket-server.ts`. `recordMetricEvent()` is called in all 5 emit functions; `recordReconnection()` is called on `join_station`.

**Key file:** `src/app/api/health/sockets/route.ts`

---

## Rules Summary

1. **Server dispatches** via `emitToLocation()` / `emitToTags()` — never client-side relay
2. **Client consumes** via `getSharedSocket()` — never raw `io()`
3. **Delta updates** for lists — never full refetch per event
4. **Fire-and-forget** on server — never await socket emissions
5. **Fallback polling** at 30s only when disconnected
6. **Socket dedup**: 500ms + 60s TTL on all events
7. **Event buffer persists to PG** — restart does not lose buffered events (30min TTL)
8. **Cloud relay accelerates cloud→NUC push** but is not a durability layer
