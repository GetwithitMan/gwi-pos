# Skill 340: Shared Socket Singleton (Performance Phase 2)

**Status:** DONE
**Date:** February 14, 2026
**Commits:** `c2c75f0` (direct emit + kill polling), `bbf29ad` (shared socket singleton)
**Domain:** Global / Socket.io
**Impact:** 5-6 connections per tab → 1; eliminated HTTP broadcast hop; killed all constant polling

---

## Problem

Three separate performance issues in the socket layer:

1. **Multiple connections per tab**: POS tabs opened 2-6 separate `io()` connections (`useOrderSockets`, `SocketEventProvider`, `OpenOrdersPanel`, KDS, Expo, etc.), tripling heartbeats and event handling.
2. **HTTP broadcast hop**: All 17 socket dispatch functions called `fetch('localhost:3000/api/internal/socket/broadcast')` even though the socket server runs in the same Node.js process — adding 2-5ms and JSON serialization for zero benefit.
3. **Constant polling**: KDS polled every 5s, Expo every 3s, entertainment every 3s, open orders every 3s. With 10 terminals: 120+ DB hits/min from KDS alone.

## Solution

### 2.2 Shared Socket Singleton (`src/lib/shared-socket.ts`)

One `io()` connection per browser tab with ref-counted lifecycle:

```typescript
// Module-level singleton
let sharedSocket: Socket | null = null
let refCount = 0

export function getSharedSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(serverUrl, {
      path: '/api/socket',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
    })
  }
  refCount++
  return sharedSocket
}

export function releaseSharedSocket(): void {
  refCount = Math.max(0, refCount - 1)
  if (refCount === 0 && sharedSocket) {
    sharedSocket.disconnect()
    sharedSocket = null
  }
}
```

**All consumers migrated:**
- `useOrderSockets.ts` — shared socket
- `useKDSSockets.ts` — shared socket
- `SocketEventProvider` — shared socket (via dynamic import)
- `menu/page.tsx` — fixed broken sockets + shared
- `kds/page.tsx` — shared socket
- `entertainment/page.tsx` — shared socket
- `ExpoScreen.tsx` — shared socket
- `liquor-builder/page.tsx` — shared socket, fixed event name

**Consumer pattern:**
```typescript
useEffect(() => {
  const socket = getSharedSocket()

  const onConnect = () => { /* join rooms, set state */ }
  const onEvent = (data) => { /* handle event */ }

  socket.on('connect', onConnect)
  socket.on('my:event', onEvent)
  if (socket.connected) onConnect() // already connected case

  return () => {
    socket.off('connect', onConnect)
    socket.off('my:event', onEvent)
    releaseSharedSocket()
  }
}, [deps])
```

### 2.3 Direct Emit (`src/lib/socket-dispatch.ts`)

All 17 dispatch functions now call `emitToLocation()` / `emitToTags()` directly instead of HTTP:

```typescript
// BEFORE — HTTP hop
fetch('http://localhost:3000/api/internal/socket/broadcast', { body: JSON.stringify(...) })

// AFTER — direct emit
import { emitToLocation } from '@/lib/socket-server'
emitToLocation(locationId, 'order:updated', data)
```

### 2.4 Kill Polling → Socket Events + 30s Fallback

All constant polling replaced with socket events. Fallback polling only when socket disconnected (30s, not 3-5s).

| Screen | Before | After |
|--------|--------|-------|
| KDS | 5s polling | Socket events + 30s fallback |
| Expo | 3s polling | Socket events + 30s fallback |
| Entertainment | 3s polling | Socket events + 30s fallback |
| Open Orders | 3s polling | Socket events + 30s fallback |

## Key Files

| File | Role |
|------|------|
| `src/lib/shared-socket.ts` | **NEW** — Shared socket singleton with ref counting |
| `src/lib/socket-dispatch.ts` | Direct emit (no HTTP hop) |
| `src/lib/socket-server.ts` | `emitToLocation()`, `emitToTags()` exports |
| `src/hooks/useOrderSockets.ts` | Shared socket consumer |
| `src/hooks/useKDSSockets.ts` | Shared socket consumer |
| `src/lib/events/socket-provider.ts` | Shared socket + 150ms debouncing |
| `src/app/(kds)/kds/page.tsx` | Socket events, no polling |
| `src/components/kds/ExpoScreen.tsx` | Socket events, no polling |

## Verification

```bash
# Only shared-socket.ts creates io() connections
grep '= io(' src/ -r  # → only src/lib/shared-socket.ts

# Only shared-socket.ts imports io from socket.io-client
grep "from 'socket.io-client'" src/ -r  # → only shared-socket.ts
```

## Stable Terminal ID

`getTerminalId()` in `shared-socket.ts` generates a stable ID per tab (module-level). Used by all consumers for `join_station` events.

## Mandatory Pattern Going Forward

- **NEVER** call `io()` directly. Always use `getSharedSocket()` / `releaseSharedSocket()`.
- **NEVER** use HTTP to dispatch socket events. Use `emitToLocation()` or `emitToTags()`.
- **NEVER** add constant polling. Use socket events with 30s fallback only when disconnected.
- See `CLAUDE.md` Performance Rules section.
