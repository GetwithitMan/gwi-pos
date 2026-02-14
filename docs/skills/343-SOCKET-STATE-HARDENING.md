# Skill 343: Socket & State Hardening (Performance Phase 5)

**Status:** DONE (6/7 items; 5.1 deferred)
**Date:** February 14, 2026
**Commits:** `b29fd73` (debouncing + leak fix + pooling), `6281424` (delta open orders)
**Domain:** Global / Socket.io / Orders
**Impact:** Eliminated fetch storms, memory leaks, unnecessary polling; delta updates for lists

---

## Items Completed

### 5.2 Client-Side Socket Event Debouncing (150ms)
`SocketEventProvider` debounces all events via `onAny()` with 150ms window. Prevents fetch storms when server emits rapid events (e.g., multiple items added in quick succession).

```typescript
// socket-provider.ts
private readonly DEBOUNCE_MS = 150
private pendingEvents: Map<string, { data: unknown; timer: ReturnType<typeof setTimeout> }> = new Map()

// onAny handler debounces before forwarding to subscribers
```

### 5.3 Conditional Polling (Socket Disconnected Only)
All screens poll at 30s ONLY when socket is disconnected. When connected, updates come exclusively via socket events.

```typescript
useEffect(() => {
  if (!isConnected) {
    const fallback = setInterval(loadOrders, 30000)
    return () => clearInterval(fallback)
  }
}, [isConnected])
```

### 5.4 Delta-Based Open Orders Updates
Instead of refetching all open orders on every change:
- `"paid"` / `"voided"` events → remove from local state (zero network)
- Other events → full refresh (new order, items changed)

```typescript
socket.on('orders:list-changed', (data) => {
  if (data?.status === 'paid' || data?.status === 'voided') {
    // Remove locally — no fetch needed
    setOpenOrders(prev => prev.filter(o => o.id !== data.orderId))
  } else {
    // Full refresh for new/changed orders
    debouncedRefresh()
  }
})
```

### 5.5 Cache Tax Rules & Categories
- `src/lib/location-cache.ts`: Location settings cached with TTL
- `src/lib/menu-cache.ts`: Menu data cached 60s per locationId
- Cache hit = ~0ms vs ~50-200ms DB query

### 5.6 PrismaClient Connection Pooling
```typescript
// src/lib/db.ts
datasources: {
  db: {
    url: process.env.DATABASE_URL
  }
},
connection_limit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || '5'),
pool_timeout: parseInt(process.env.DATABASE_POOL_TIMEOUT || '10'),
```

### 5.7 connectedTerminals Memory Leak Fix
- `connectedTerminals` Map cleaned every 5 minutes (periodic sweep)
- Duplicate socketId on join → old entry removed
- Disconnect handler removes entry
- Prevents server OOM over days of uptime

### 5.1 locationId in findUnique (DEFERRED)
304 API routes would need updating. DB-per-venue already isolates data. Deferred as defense-in-depth with 8hr estimated effort.

## Key Files

| File | Changes |
|------|---------|
| `src/lib/events/socket-provider.ts` | 150ms event debouncing via `onAny` |
| `src/hooks/useOrderSockets.ts` | Conditional 30s polling |
| `src/app/(kds)/kds/page.tsx` | Conditional 30s polling |
| `src/components/kds/ExpoScreen.tsx` | Conditional 30s polling |
| `src/lib/location-cache.ts` | Location settings cache |
| `src/lib/menu-cache.ts` | Menu data cache (60s TTL) |
| `src/lib/db.ts` | Connection pooling config |
| `src/lib/socket-server.ts` | connectedTerminals cleanup |

## Mandatory Pattern Going Forward

- **Delta updates for lists**: When an item is removed (paid/voided/deleted), remove locally. Only refetch for additions/changes.
- **Debounce socket-driven refreshes**: Never fire raw fetch on every socket event. Use 150ms debounce minimum.
- **Conditional polling only**: Poll at 30s ONLY when socket disconnected. Never constant-poll when connected.
- **Use caches**: `location-cache.ts` for settings, `menu-cache.ts` for menu data. Never fresh-query for cached data.
- See `CLAUDE.md` Performance Rules section.
