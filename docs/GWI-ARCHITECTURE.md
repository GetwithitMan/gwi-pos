# GWI POS - System Architecture

**Version:** 2.0
**Updated:** February 14, 2026
**Model:** SaaS with Local Servers

---

## Overview

GWI POS is a hybrid SaaS point-of-sale system designed for bars and restaurants. Each location runs a local server for speed and offline capability, while a cloud admin console manages all locations centrally.

```
┌─────────────────────────────────────────────────────────────────┐
│                    GWI ADMIN CONSOLE (Cloud)                     │
│  • Onboard new locations        • Push updates                  │
│  • Manage subscriptions         • Aggregate reporting           │
│  • Monitor all locations        • License enforcement           │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Sync when online
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                LOCAL SERVER (Ubuntu Mini PC)                     │
│  Docker Compose:                                                │
│  ├── GWI POS (Next.js)           ├── PostgreSQL (local data)   │
│  ├── Socket.io (real-time)       └── Watchtower (auto-updates) │
│                                                                 │
│  • Manages all terminals + devices                              │
│  • Works 100% offline                                           │
│  • Sub-10ms response times                                      │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Local network (WiFi/Ethernet)
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         ┌─────────┐    ┌─────────┐    ┌─────────┐
         │Terminal │    │Terminal │    │ Phone/  │
         │   #1    │    │   #2    │    │  iPad   │
         │(browser)│    │(browser)│    │  (PWA)  │
         └─────────┘    └─────────┘    └─────────┘
```

---

## Build Phases

### Phase 1: Build the POS (Current)
Build the complete POS application before anything else.

**Focus:** Feature-complete local POS system
- All 60 skills functional
- Real-time via Socket.io
- Full audit trail
- Device registration system
- PWA support for mobile devices

### Phase 2: Build the Admin Console
Only after the POS is production-ready.

**Focus:** Multi-location management
- License key generation
- Fleet monitoring (online/offline status)
- Version tracking per location
- Aggregated reporting
- Customer billing/subscriptions

### Phase 3: Deployment Infrastructure
**Focus:** Remote deployment and updates
- Docker image registry
- Watchtower auto-updates
- Local server provisioning scripts
- Backup and sync services

---

## Tech Stack

### Local Server (Per Location)

| Component | Technology | Purpose |
|-----------|------------|---------|
| Application | Next.js 16.x | POS frontend + API |
| Database | PostgreSQL 15 | Local data storage (fast) |
| Real-time | Socket.io | Instant KDS/terminal updates |
| Container | Docker Compose | Deployment + auto-restart |
| Updates | Watchtower | Pull new images automatically |
| OS | Ubuntu 24 LTS | Headless Linux server |

### Cloud (Admin Console)

| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | Next.js | Admin dashboard |
| Hosting | Vercel | Serverless deployment |
| Database | PostgreSQL (Neon) | Aggregated data + licensing |
| Storage | S3/Backblaze | Backup storage |

---

## Database Strategy

### Schema Requirements

Every table must have:

```prisma
model ExampleTable {
  id         String    @id @default(cuid())  // ✅ Already done
  locationId String                           // ✅ Already done

  // Timestamps
  createdAt  DateTime  @default(now())        // ✅ Already done
  updatedAt  DateTime  @updatedAt             // ✅ Already done

  // Sync fields (NEED TO ADD)
  deletedAt  DateTime?                        // ❌ Soft delete flag
  syncedAt   DateTime?                        // ❌ Cloud sync tracking
}
```

### Why This Matters

| Field | Purpose |
|-------|---------|
| `cuid()` IDs | Prevents collision when syncing multiple locations |
| `locationId` | Multi-tenancy - isolate data per location |
| `deletedAt` | Soft deletes - sync can handle "deleted" records |
| `syncedAt` | Track what's been pushed to cloud |

### Current Status

| Requirement | Status |
|-------------|--------|
| `cuid()` IDs | ✅ All tables use cuid() |
| `locationId` on all tables | ✅ Done (57 tables) |
| `deletedAt` (soft deletes) | ❌ Need to add |
| `syncedAt` (sync tracking) | ❌ Need to add |

---

## Performance Targets

Everything stays on the local network = instant.

| Action | Target | Why It's Fast |
|--------|--------|---------------|
| Button tap feedback | < 50ms | Local server, no internet |
| Add item to order | < 100ms | PostgreSQL on same machine |
| Send to kitchen | < 50ms | Socket.io push, local network |
| KDS update | < 10ms | WebSocket, no polling |
| Print ticket | < 500ms | Direct to printer IP |

**Comparison:**

| Architecture | Latency |
|--------------|---------|
| Cloud-only (Square) | 100-500ms per action |
| GWI (local server) | < 50ms per action |

---

## Real-Time Architecture (Socket.io)

### Non-Negotiable Principles

1. **Socket-first.** Every cross-terminal update uses Socket.io. No polling for core screens.
2. **One socket per tab.** All consumers share `src/lib/shared-socket.ts` singleton. Never call `io()` directly.
3. **Direct emit.** Server-side dispatch uses `emitToLocation()` / `emitToTags()`. Never HTTP broadcast hop.
4. **Delta updates for lists.** Remove items locally on paid/voided/deleted events. Only refetch for additions/changes.
5. **30s fallback only.** Polling at 30s ONLY when socket is disconnected. Never constant-poll when connected.

### Socket Server (`src/lib/socket-server.ts`)

Custom `server.ts` wraps Next.js and injects Socket.io. The server instance lives on `globalThis.socketServer` (survives HMR in dev).

```
┌─────────────────────────────────────────────────┐
│                 Node.js Process                   │
│                                                   │
│  server.ts                                       │
│  ├── Next.js (HTTP)                              │
│  └── Socket.io Server (WebSocket)                │
│       ├── Room: location:{locationId}            │
│       ├── Room: tag:{tagName}                    │
│       └── Room: terminal:{terminalId}            │
│                                                   │
│  globalThis.socketServer (survives HMR)          │
└─────────────────────────────────────────────────┘
```

**Room types:**
- `location:{id}` — All terminals at a location (open orders, floor plan updates)
- `tag:{name}` — KDS stations (pizza, bar, expo) receive tagged tickets
- `terminal:{id}` — Direct messages to a specific terminal

### Shared Socket Singleton (`src/lib/shared-socket.ts`)

ONE `io()` connection per browser tab with ref-counted lifecycle:

```typescript
import { getSharedSocket, releaseSharedSocket, getTerminalId } from '@/lib/shared-socket'

// In useEffect:
const socket = getSharedSocket()    // lazily creates, increments refCount
// ... register handlers ...
return () => {
  // ... remove handlers ...
  releaseSharedSocket()             // decrements refCount, disconnects at 0
}
```

**All consumers use this pattern:**
- `useOrderSockets` — floor plan + open orders
- `useKDSSockets` — KDS screens
- `SocketEventProvider` — debounced event forwarding
- `menu/page.tsx` — ingredient + entertainment events
- `kds/page.tsx`, `entertainment/page.tsx`, `ExpoScreen.tsx`
- `liquor-builder/page.tsx`

### Server-Side Dispatch (`src/lib/socket-dispatch.ts`)

API routes emit events directly via `emitToLocation()` / `emitToTags()`. Fire-and-forget (never blocks response):

```typescript
// In any API route handler:
import { emitToLocation } from '@/lib/socket-server'

// After saving to DB:
emitToLocation(locationId, 'orders:list-changed', { orderId, status: 'paid' })
// Don't await — fire and forget
```

**Available dispatch functions:**
| Function | Event | Used By |
|----------|-------|---------|
| `dispatchOpenOrdersChanged` | `orders:list-changed` | Pay, send, void, create |
| `dispatchOrderTotalsUpdate` | `order:totals-updated` | Add items, discount, tip |
| `dispatchMenuItemChanged` | `menu:item-changed` | Item CRUD |
| `dispatchMenuStockChanged` | `menu:stock-changed` | 86'd items |
| `dispatchMenuStructureChanged` | `menu:structure-changed` | Category/modifier CRUD |
| `dispatchEntertainmentStatusChanged` | `entertainment:status-changed` | Session start/stop/extend |
| `dispatchIngredientLibraryUpdate` | `ingredient:updated` | Ingredient CRUD |
| `dispatchFloorPlanUpdate` | `floor-plan:updated` | Table move/resize |
| `dispatchVoidApprovalUpdate` | `void:approval-update` | Remote void SMS |

### Client-Side Debouncing (`SocketEventProvider`)

All socket events flow through `SocketEventProvider` which debounces at 150ms via `onAny()`. This prevents fetch storms when the server emits rapid events (e.g., multiple items added in quick succession).

### Delta Update Pattern (Lists)

When a list item is removed (paid, voided, deleted), remove from local state without refetching:

```typescript
socket.on('orders:list-changed', (data) => {
  if (data?.status === 'paid' || data?.status === 'voided') {
    // Remove locally — zero network
    setOpenOrders(prev => prev.filter(o => o.id !== data.orderId))
  } else {
    // Full refresh only for new/changed orders
    debouncedRefresh()
  }
})
```

### Conditional Polling (Fallback Only)

Poll at 30s ONLY when socket is disconnected:

```typescript
useEffect(() => {
  if (!isConnected) {
    const fallback = setInterval(loadOrders, 30000) // 30s, not 3-5s
    return () => clearInterval(fallback)
  }
}, [isConnected])
```

---

## Caching Architecture

### Menu Cache (`src/lib/menu-cache.ts`)

In-memory cache with 60s TTL per locationId. Cache hit = ~0ms vs ~50-200ms DB query.

```typescript
import { getCachedMenu, invalidateMenuCache } from '@/lib/menu-cache'

// Read (auto-caches on miss)
const menu = await getCachedMenu(locationId)

// Invalidate after CRUD
invalidateMenuCache(locationId)
```

### Location Cache (`src/lib/location-cache.ts`)

Location settings (tax rules, categories, rounding config) cached with TTL. Prevents N queries on rapid order creation.

### Snapshot APIs

Composite views use single-query snapshot APIs instead of multiple fetches:

| Endpoint | Replaces | Savings |
|----------|----------|---------|
| `GET /api/floorplan/snapshot` | tables + sections + open orders + counts | 4 → 1 fetch |
| `GET /api/orders/open?summary=true` | full items/modifiers for sidebar | 90% less data |
| `POST /api/menu/items/bulk` | N individual item GETs | 12 → 1 fetch |

### Request Coalescing

Rapid refresh requests are coalesced so only one network call fires:

```typescript
const snapshotInFlightRef = useRef(false)
const snapshotPendingRef = useRef(false)

async function refreshSnapshot() {
  if (snapshotInFlightRef.current) {
    snapshotPendingRef.current = true  // queue trailing refresh
    return
  }
  snapshotInFlightRef.current = true
  // ... fetch ...
  snapshotInFlightRef.current = false
  if (snapshotPendingRef.current) {
    snapshotPendingRef.current = false
    setTimeout(refreshSnapshot, 150)   // trailing refresh
  }
}
```

---

## Mandatory Performance Rules

**These rules apply to ALL new features on POS, KDS, and Expo screens.**

### Rule 1: Socket-First Updates

Any feature that updates data visible on other terminals MUST:
- Emit a socket event from the API route via `emitToLocation()` or `emitToTags()`
- Listen for that event on the client via `getSharedSocket()`
- **NEVER** add polling to get cross-terminal updates

### Rule 2: Delta Updates for Lists

Any feature that adds/removes items from a list (orders, tickets, tables) MUST:
- Remove items locally on removal events (paid, voided, deleted, bumped)
- Only refetch the full list for additions or complex changes
- **NEVER** refetch the entire list on every event

### Rule 3: Use Existing Caches

Any feature that reads menu items, categories, tax rules, or location settings MUST:
- Use `src/lib/menu-cache.ts` for menu data
- Use `src/lib/location-cache.ts` for location settings
- **NEVER** write fresh DB queries for data that's already cached

### Rule 4: Zustand Atomic Selectors

Any component that reads from a Zustand store MUST:
- Use atomic selectors: `useStore(s => s.field)`
- **NEVER** destructure the entire store: `const { ... } = useStore()`

### Rule 5: Single `set()` Per Interaction

Any Zustand mutation that changes data + needs recalculated totals MUST:
- Compute totals in JS and call `set()` once
- **NEVER** call `set()` then `calculateTotals()` (two render passes)

### Rule 6: No Blocking Background Work

API routes that trigger non-critical side effects (inventory deduction, print jobs, socket dispatch) MUST:
- Use fire-and-forget: `void doWork().catch(console.error)`
- **NEVER** `await` non-critical work before returning the response

### Rule 7: Instant UI Feedback

User-facing modals and panels MUST:
- Open instantly on tap (background work runs after)
- Close instantly on completion (background payment/save runs after)
- **NEVER** block UI on network requests that the user doesn't need to wait for

### Rule 8: Compound Indexes

Any new query pattern that filters on multiple columns MUST:
- Add a compound `@@index` in `schema.prisma`
- **NEVER** rely on single-column indexes for multi-column WHERE clauses

---

## Database Strategy

### PostgreSQL Only

**Database:** Neon PostgreSQL with database-per-venue. SQLite is NOT supported.

- Local NUC: Local PostgreSQL in Docker
- Cloud venues: Neon PostgreSQL (one database per venue)
- Per-venue PrismaClient cached in `globalThis.venueClients`
- `withVenue()` wrapper resolves DB from request context via AsyncLocalStorage
- Connection pooling: `DATABASE_CONNECTION_LIMIT` (default 5), `DATABASE_POOL_TIMEOUT` (default 10s)

### Schema Requirements

Every table must have:

```prisma
model ExampleTable {
  id         String    @id @default(cuid())
  locationId String

  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  deletedAt  DateTime?
  syncedAt   DateTime?

  @@index([locationId])
}
```

---

## Device Security: QR + PIN System

### The Problem
How do you let employees use personal phones without security risks?

### The Solution

**Clock-in Flow:**

```
MANAGER STATION                          EMPLOYEE PHONE
┌─────────────────────────┐
│  Sarah clocking in      │
│                         │
│     ┌─────────┐         │
│     │ QR CODE │ ◄───────┼──── Employee scans
│     └─────────┘         │
│                         │
│  Waiting for scan...    │
└─────────────────────────┘
           │
           ▼ QR scanned
┌─────────────────────────┐              ┌─────────────────┐
│  Sarah clocking in      │              │ Enter PIN from  │
│                         │              │ manager screen  │
│     ┌─────────┐         │              │                 │
│     │  7294   │ ────────┼─────────────►│  [____]         │
│     └─────────┘         │              │                 │
│  Expires: 45 sec        │              │ [1][2][3]       │
└─────────────────────────┘              │ [4][5][6]       │
                                         │ [7][8][9]       │
                                         └─────────────────┘
```

### First-Time Device Registration

```
PIN accepted → New device detected
                    │
                    ▼
┌─────────────────────────────────────────┐
│  New Device Detected                    │
│                                         │
│  Employee: Sarah                        │
│  Device type: iPhone (detected)         │
│                                         │
│  Name this device:                      │
│  ┌─────────────────────────────────┐   │
│  │ Sarah's iPhone                  │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [Register & Start Shift]               │
└─────────────────────────────────────────┘
```

### Why QR + PIN Works

| Attack | Protection |
|--------|------------|
| Screenshot QR | PIN changes every scan |
| Photo QR code | PIN required, expires in 45 sec |
| Session theft | Bound to device fingerprint |
| Ex-employee access | Session ends at clock-out |

### Session Rules

- Session valid until clock-out
- Max 8-hour auto-expiration
- Manager can revoke any session instantly
- Periodic PIN re-entry for voids/discounts

### Database Schema

```prisma
model RegisteredDevice {
  id                String    @id @default(cuid())
  locationId        String
  deviceFingerprint String    @unique
  name              String              // "Sarah's iPhone"
  type              String?             // phone, tablet, terminal
  lastSeenAt        DateTime
  registeredBy      String
  isActive          Boolean   @default(true)

  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  deletedAt         DateTime?
  syncedAt          DateTime?

  sessions          DeviceSession[]
}

model DeviceSession {
  id           String    @id @default(cuid())
  locationId   String
  employeeId   String
  deviceId     String
  token        String    @unique
  expiresAt    DateTime
  revokedAt    DateTime?

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?
  syncedAt     DateTime?

  device       RegisteredDevice @relation(fields: [deviceId], references: [id])
}
```

---

## GWI Admin Access to Venue POS

Authenticated GWI admins (super_admin, sub_admin) can access any venue's POS admin panel directly from Mission Control without a PIN:

1. MC Location Detail → "Open Admin (authenticated)" button → `/pos-access/{slug}`
2. `getVenueAdminContext()` validates Clerk auth + role-based venue access
3. `generatePosAccessToken()` issues a signed HS256 JWT (8h, `PROVISION_API_KEY`)
4. Redirect → `https://{slug}.ordercontrolcenter.com/auth/cloud?token={JWT}`
5. POS validates JWT, sets `pos-cloud-session` httpOnly cookie, populates auth store
6. Admin lands in `/settings` — full admin permissions, no PIN required

**Session:** `pos-cloud-session` httpOnly cookie, 8 hours, venue-scoped (exact hostname)
**Token secret:** `PROVISION_API_KEY` (shared between MC and POS)
**Client auth:** Zustand `auth-store` (`gwi-pos-auth` in localStorage)

See: Skill 405 (Cloud Auth Client Fix), Skill 406 (MC Admin Venue Access)

---

## Audit Trail

Every action is logged with full context:

```prisma
model ActionLog {
  id           String   @id @default(cuid())
  locationId   String
  employeeId   String
  deviceId     String      // "Sarah's iPhone"
  sessionId    String

  action       String      // "item_added", "void", "discount"
  details      Json        // { itemId, itemName, price, etc }

  timestamp    DateTime @default(now())
  syncedAt     DateTime?
}
```

### What Shows on Orders

```
┌─────────────────────────────────────────────────────────────┐
│ Table 5                                          Check #847 │
├─────────────────────────────────────────────────────────────┤
│ 2x Margarita                              $24.00            │
│    Added: Sarah • Sarah's iPhone • 5:02pm                   │
│                                                             │
│ 1x Fish Tacos                             $16.00            │
│    Added: Sarah • Sarah's iPhone • 5:04pm                   │
│                                                             │
│ 1x Margarita (VOID)                       -$12.00           │
│    Voided: Mike (Manager) • Bar Terminal • 5:15pm           │
│    Reason: Customer changed mind                            │
└─────────────────────────────────────────────────────────────┘
```

---

## PWA (Progressive Web App)

Employees can use personal phones - feels like a native app.

### What Makes It Work

| Feature | Implementation |
|---------|----------------|
| Full-screen, no browser bar | `"display": "standalone"` in manifest |
| App icon on home screen | PWA install prompt |
| Instant response | Local server, not cloud |
| Works offline | Service worker + IndexedDB |
| No App Store needed | Just scan QR to start |

### Lock Down Browser Behaviors

```typescript
// Disable pull-to-refresh
document.body.style.overscrollBehavior = 'none'

// Disable zoom
<meta name="viewport" content="..., maximum-scale=1, user-scalable=no">

// Disable text selection on buttons
.button { user-select: none; -webkit-touch-callout: none; }

// Disable long-press context menu
document.addEventListener('contextmenu', e => e.preventDefault())
```

---

## Deployment Model

### How Updates Work

```
YOUR MAC (Development)
    │
    │ docker build + docker push
    ▼
CONTAINER REGISTRY (GitHub/Docker Hub)
    │
    │ Watchtower pulls automatically
    ▼
LOCAL SERVERS (All Locations)
    │
    │ Container restarts with new code
    ▼
TERMINALS (Just refresh browser)
```

### Initial Server Setup

Two options:

**Option A: Pre-built Image (Recommended)**
1. Set up one server perfectly
2. Create disk image (Clonezilla)
3. Flash to new servers
4. Server boots, phones home, you activate

**Option B: Remote Install Script**
```bash
curl -s https://deploy.gwipos.com/install | sudo bash
```

### Docker Compose (Local Server)

```yaml
services:
  pos-app:
    image: ghcr.io/yourorg/gwi-pos:latest
    restart: always
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://pos:password@db:5432/pos
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    restart: always
    volumes:
      - ./pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=pos
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=pos

  updater:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 300 --cleanup
```

---

## Sync Strategy

### What Gets Synced to Cloud

| Data | Direction | Frequency |
|------|-----------|-----------|
| Orders & Payments | Local → Cloud | Every 5 min |
| Menu changes | Cloud → Local | On demand |
| Employee changes | Bidirectional | Real-time when online |
| Reports/Analytics | Local → Cloud | Nightly batch |
| Backups | Local → Cloud | Hourly (pg_dump) |

### Offline Handling

When internet is down:
- POS continues working 100%
- Orders queue locally
- Payments: Cash only OR store-and-forward (processor dependent)
- When back online: auto-sync everything

### Sync Fields

```prisma
// Every record tracks sync state
syncedAt   DateTime?  // null = never synced, timestamp = last sync
deletedAt  DateTime?  // soft delete, synced as "deleted" not missing
```

---

## Security Model

### Physical Server

| Protection | Implementation |
|------------|----------------|
| Headless operation | No keyboard/monitor needed |
| SSH only | Your keys only |
| Firewall | Local network + outbound to cloud only |
| Disk encryption | LUKS full disk |
| UPS | Battery backup for clean shutdown |

### License Enforcement

```
Server boots
    │
    ▼
Check license with cloud
    │
    ├── Valid → Run normally
    │
    ├── Can't reach cloud → Grace period (7-14 days)
    │
    └── Expired/Invalid → Read-only mode or lockout
```

### Data Protection

- Customer never sees your code (it's on their server, but they don't access it)
- Database encrypted at rest
- All sync traffic over HTTPS
- Payment data encrypted, decrypted only cloud-side

---

## Competitive Advantage

| Problem with Others | GWI Solution |
|---------------------|--------------|
| Toast: Expensive hardware | Employees use their phones |
| Square: Cloud latency | Local server = instant |
| Cloud POS: Dies without internet | Works offline indefinitely |
| App Store updates | Watchtower auto-updates |

**Your Pitch:**
> "GWI keeps running when your internet doesn't. Sub-50ms response times. Servers use their own phones. No $500 terminals."

---

## Key Files Reference

### Socket & Real-Time
| File | Purpose |
|------|---------|
| `src/lib/shared-socket.ts` | Shared socket singleton (one per tab) |
| `src/lib/socket-server.ts` | Socket.io server, `emitToLocation()`, `emitToTags()` |
| `src/lib/socket-dispatch.ts` | 17 dispatch functions for API routes |
| `src/lib/events/socket-provider.ts` | 150ms debounced event forwarding |
| `src/hooks/useOrderSockets.ts` | Order + floor plan socket events |
| `src/hooks/useKDSSockets.ts` | KDS socket events |

### Caching
| File | Purpose |
|------|---------|
| `src/lib/menu-cache.ts` | Menu data cache (60s TTL) |
| `src/lib/location-cache.ts` | Location settings cache |
| `src/app/api/floorplan/snapshot/route.ts` | Single-query floor plan snapshot |
| `src/app/api/menu/items/bulk/route.ts` | Bulk menu item fetch |

### State Management
| File | Purpose |
|------|---------|
| `src/stores/order-store.ts` | Order state (atomic selectors, batch set()) |
| `src/components/orders/OrderPanelItem.tsx` | React.memo wrapped item |

### Database
| File | Purpose |
|------|---------|
| `src/lib/db.ts` | PrismaClient with connection pooling, 3-tier Proxy |
| `src/lib/with-venue.ts` | Per-venue DB routing wrapper |
| `src/lib/request-context.ts` | AsyncLocalStorage for tenant context |
| `prisma/schema.prisma` | 7 compound indexes on hot paths |

---

*This document is the architecture source of truth for GWI POS.*
*Last Updated: February 14, 2026*
