# Offline & Sync Domain

**Domain ID:** 20
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Offline & Sync domain manages the local-first architecture, offline operation, and cloud synchronization. It handles:
- Offline queue management for orders, payments, and print jobs
- IndexedDB local storage for offline operation
- Connection health monitoring and degraded mode detection
- Sync queue with conflict resolution
- Cloud sync when connectivity is restored
- Sync audit logging for troubleshooting

## Domain Trigger

```
PM Mode: Offline & Sync
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Offline Manager | Queue management and offline operation | `src/lib/offline-manager.ts` |
| Local DB | IndexedDB for offline storage | `src/lib/offline-db.ts` |
| Sync Hook | React hook for sync state | `src/hooks/useOfflineSync.ts` |
| Health Check | Connection monitoring | `src/app/api/monitoring/health-check/` |
| Audit | Sync audit logging | `src/components/admin/SyncAuditLog.tsx` |

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/offline-manager.ts` | Offline queue management, retry logic |
| `src/lib/offline-db.ts` | IndexedDB local database for offline ops |
| `src/hooks/useOfflineSync.ts` | React hook for offline/sync state |
| `src/components/admin/SyncAuditLog.tsx` | Sync audit log viewer |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/monitoring/health-check` | GET | System health status |
| `/api/orders/sync` | POST | Sync offline orders to server |
| `/api/payments/sync` | POST | Sync offline payments |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 60 | Offline Mode | TODO |
| 59 | Location Multi-tenancy | TODO |

## Integration Points

- **All Domains**: Every domain must handle offline gracefully
- **Orders Domain**: Offline order creation and queuing
- **Payments Domain**: Offline payment queuing and sync
- **Hardware Domain**: Offline print job queuing
- **Error Reporting Domain**: Health monitoring and connectivity alerts
