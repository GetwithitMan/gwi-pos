# KDS Domain

**Domain ID:** 6
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Kitchen Display System domain manages real-time order display for kitchen staff, ticket routing, and order fulfillment tracking. It handles:
- KDS screen rendering with station filtering
- Item bump and order completion tracking
- Tag-based routing engine for ticket distribution
- Socket.io real-time updates (<50ms latency)
- Device pairing and security
- Entertainment KDS dashboard

## Domain Trigger

```
PM Mode: KDS
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Display | KDS screen rendering | `src/app/(kds)/kds/` |
| Tickets | Kitchen ticket management | `src/app/api/kds/`, `src/app/api/tickets/` |
| Stations | Station configuration | Tag-based routing via Station model |
| Device Auth | KDS device pairing | `src/app/api/hardware/kds-screens/` |
| Entertainment KDS | Entertainment dashboard | `src/app/(kds)/kds/entertainment/` |
| Real-time | Socket.io integration | `src/hooks/useKDSSockets.ts`, `src/lib/realtime/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(kds)/kds/page.tsx` | Main KDS display with auth flow |
| `src/app/(kds)/kds/pair/page.tsx` | Device pairing code entry |
| `src/app/(kds)/kds/entertainment/page.tsx` | Entertainment KDS dashboard |
| `src/hooks/useKDSSockets.ts` | KDS socket hook for real-time updates |
| `src/lib/realtime/` | Socket providers and event types |
| `src/components/kds/` | KDS UI components |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/kds/tickets` | GET | Active kitchen tickets |
| `/api/hardware/kds-screens` | GET/POST | KDS screen management |
| `/api/hardware/kds-screens/[id]/generate-code` | POST | Generate pairing code |
| `/api/hardware/kds-screens/pair` | POST | Complete device pairing |
| `/api/hardware/kds-screens/auth` | GET | Verify device token |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 23 | KDS Display | DONE |
| 25 | Expo Station | PARTIAL |
| 67 | Prep Stations | DONE |
| 98 | Entertainment KDS | DONE |
| 102 | KDS Device Security | DONE |
| 201 | Tag-Based Routing Engine | DONE |
| 202 | Socket.io Real-Time KDS | DONE |
| 203 | Reference Items & Atomic Print | DONE |

## Integration Points

- **Orders Domain**: Receives orders via send-to-kitchen, bumps items back
- **Hardware Domain**: Device pairing, printer routing
- **Entertainment Domain**: Entertainment KDS dashboard
- **Floor Plan Domain**: Table/seat info on tickets
