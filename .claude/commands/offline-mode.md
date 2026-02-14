# Offline Mode

Continue operations when internet connection is unavailable.

## Overview

Offline mode allows the POS to continue taking orders and processing cash payments when the network is down, syncing when connection is restored.

## Current Status

**Note:** Full offline mode is planned but not yet implemented. Current capabilities:

### What Works Offline
- PostgreSQL database is local (on NUC server)
- App runs on local network
- Basic operations if server running locally

### What Requires Network
- Cloud payment processing
- External integrations
- Remote reporting
- Multi-device sync

## Planned Features

### Offline Order Taking
- Queue orders locally
- Store in IndexedDB
- Sync when online

### Offline Payments
- Cash payments work
- Card payments queued
- Process when online

### Local Data Cache
- Menu cached locally
- Employee data cached
- Settings cached

## Detection

### Connection Status
```typescript
// Check online status
const isOnline = navigator.onLine

// Listen for changes
window.addEventListener('online', handleOnline)
window.addEventListener('offline', handleOffline)
```

### Status Indicator
- Green dot: Online
- Yellow dot: Degraded
- Red dot: Offline

## Offline Queue

### Order Queue
When offline, orders saved to local queue:
```typescript
interface OfflineOrder {
  id: string
  order: Order
  createdAt: Date
  synced: boolean
}
```

### Sync Process
1. Connection restored
2. Queue processed in order
3. Conflicts resolved
4. Queue cleared

## Cash-Only Mode

When offline:
- Cash payments only
- No card processing
- No gift cards
- No house account charges

### Enable Cash-Only
Automatically activates when:
- Payment processor unreachable
- Network down
- Explicitly enabled

## Data Storage

### Local Storage
- Employee session
- Current order
- UI preferences

### IndexedDB
- Offline order queue
- Cached menu
- Cached settings

### PostgreSQL (Server)
- Full database on local NUC
- Requires local server running

## Sync Strategy

### Priority Queue
1. Payments (highest)
2. Orders
3. Inventory updates
4. Settings changes

### Conflict Resolution
- Server data wins (usually)
- Notify of conflicts
- Manual review if needed

## Best Practices

### Prepare for Offline
1. Test offline scenarios
2. Train staff on cash-only
3. Keep backup payment method
4. Regular local backups

### During Outage
1. Switch to cash-only
2. Write receipts by hand (backup)
3. Note card payments for later
4. Keep running total

### After Restoration
1. Let system sync
2. Verify order counts
3. Process pending cards
4. Reconcile cash

## Configuration

### Offline Settings
```typescript
{
  offlineMode: {
    enabled: true,
    cashOnlyWhenOffline: true,
    maxQueueSize: 100,
    syncInterval: 30000
  }
}
```

## Limitations

### Not Available Offline
- Real-time inventory sync
- Multi-device updates
- Cloud reporting
- Card payments
- External integrations

### Data Freshness
- Menu may be stale
- Prices from last sync
- Inventory counts approximate

## Implementation Notes

### Progressive Web App (PWA)
Future enhancement:
- Service worker caching
- Offline-first design
- Background sync API

### Local Server
Current best practice:
- Run server locally
- PostgreSQL on same machine
- Network for devices

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useOnlineStatus.ts` | Connection detection |
| `src/lib/offline-queue.ts` | Order queue (planned) |
| `src/lib/sync.ts` | Sync logic (planned) |
| `public/sw.js` | Service worker (planned) |
