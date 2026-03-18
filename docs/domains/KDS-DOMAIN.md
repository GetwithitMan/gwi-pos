# KDS Domain

**Domain ID:** 6
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Kitchen Display System domain manages real-time order display for kitchen staff, ticket routing, and order fulfillment tracking. The **primary KDS client is a native Android app** (`gwi-kds-android`) — the web-based KDS pages in gwi-pos remain as a fallback.

It handles:
- Native Android KDS app (FoodKDS + PitBoss flavors)
- KDS screen rendering with station filtering and display modes
- Item bump and order completion tracking with screen link chains
- Tag-based routing engine for ticket distribution
- Socket.io real-time updates (<50ms latency)
- Device pairing and security
- Per-order-type timing, all-day counts, order tracker
- Print on bump, SMS on ready
- Keyboard/bump bar navigation
- Entertainment KDS dashboard (PitBoss)

## Architecture

```
┌─────────────────────────────────────────┐
│          gwi-kds-android                │
│  ┌───────────┐  ┌──────────────────┐    │
│  │   :app    │  │    :core         │    │
│  │ (flavors) │  │ Retrofit+Socket  │    │
│  └───────────┘  │ Room DB, Moshi   │    │
│  ┌───────────────┐ ┌──────────────┐│    │
│  │:feature-foodkds│ │:feature-pitboss│   │
│  │ Ticket display │ │ Entertainment │    │
│  │ Bump, links   │ │ Sessions      │    │
│  └───────────────┘ └──────────────┘│    │
└──────────────┬──────────────────────┘
               │ REST + WebSocket
               ▼
┌─────────────────────────────────────────┐
│          gwi-pos (NUC Server)           │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ API Routes  │  │ Socket Dispatch  │  │
│  │ /api/kds/*  │  │ socket-dispatch  │  │
│  │ /api/hardware│  │ socket-server   │  │
│  └─────────────┘  └──────────────────┘  │
│  ┌─────────────────────────────────────┐│
│  │ Web KDS Fallback (src/app/(kds)/)  ││
│  │ Browser-based, same API endpoints  ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

The Android KDS app connects to the NUC server via:
- **REST API** (Retrofit 2) — ticket fetch, bump commands, device pairing
- **WebSocket** (Socket.IO) — real-time ticket updates, bump broadcasts, screen link events

## Domain Trigger

```
PM Mode: KDS
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Android KDS (primary) | Native KDS app | `gwi-kds-android/` (`:app`, `:core`, `:feature-foodkds`, `:feature-pitboss`) |
| Web KDS (fallback) | Browser-based KDS display | `src/app/(kds)/kds/` |
| Server API | Ticket management, bump processing | `src/app/api/kds/`, `src/app/api/tickets/` |
| Stations | Station configuration | Tag-based routing via Station model |
| Device Auth | KDS device pairing | `src/app/api/hardware/kds-screens/` |
| Entertainment KDS | PitBoss flavor / web fallback | `gwi-kds-android/feature-pitboss/`, `src/app/(kds)/kds/entertainment/` |
| Real-time | Socket.io integration | `src/lib/socket-dispatch.ts`, `src/lib/realtime/`, `src/hooks/useKDSSockets.ts` |

## Key Files

### gwi-kds-android (PRIMARY)
| Module | Purpose |
|--------|---------|
| `app/` | Main application, Hilt DI, build flavors (foodkds, pitboss) |
| `core/` | Retrofit API client, Socket.IO client, Room DB, Moshi, domain models, shared Compose UI |
| `feature-foodkds/` | FoodKDS ticket display, bump, screen links, all-day counts, order tracker, keyboard nav |
| `feature-pitboss/` | PitBoss entertainment dashboard, session management |

### gwi-pos (NUC Server + Web Fallback)
| File | Purpose |
|------|---------|
| `src/app/(kds)/kds/page.tsx` | Web KDS display with auth flow (fallback) |
| `src/app/(kds)/kds/pair/page.tsx` | Web device pairing code entry (fallback) |
| `src/app/(kds)/kds/entertainment/page.tsx` | Web entertainment KDS dashboard (fallback) |
| `src/hooks/useKDSSockets.ts` | KDS socket hook for real-time updates (web fallback) |
| `src/lib/realtime/` | Socket providers and event types |
| `src/components/kds/` | KDS UI components (web fallback) |
| `src/lib/socket-dispatch.ts` | Server-side KDS event dispatch |

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
- **Entertainment Domain**: PitBoss flavor for entertainment KDS dashboard
- **Floor Plan Domain**: Table/seat info on tickets
- **Delivery Domain**: Delivery orders with delivery-specific timing
- **Android Register**: Receives KDS status events for order detail display
