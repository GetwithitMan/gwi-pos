# GWI POS — Complete System Architecture, Hardware & Technology Reference

A comprehensive inventory of the GWI POS system — its architecture, hardware, offline-first strategy, multi-tenancy, cloud communication, and full technology stack. Compiled from reading the actual codebase across all layers.

---

## 1. THREE-REPO ARCHITECTURE

| | GWI POS | GWI Mission Control | GWI Backoffice |
|---|---------|-------------------|----------------|
| **Purpose** | POS app (ordering, payments, KDS, menu, reports) | Fleet management, NUC provisioning, onboarding | Event ingestion, cloud reporting, admin dashboard |
| **Domain** | `barpos.restaurant`, `*.ordercontrolcenter.com` | `app.thepasspos.com` | `api.ordercontrolcenter.com` (API), `{slug}.ordercontrolcenter.com/admin` (UI) |
| **Database** | Neon PostgreSQL (one DB per venue: `gwi_pos_{slug}`) | Neon PostgreSQL (single master) | Neon PostgreSQL (shared cloud) |
| **Auth** | PIN-based (local) + JWT cloud sessions | Clerk B2B (org-level) | HMAC-SHA256 (NUC events), API key (reports) |
| **Deployment** | Vercel (cloud) + NUC installer (local) | Vercel | TBD (Java 25 + Spring Boot) |

### Communication Flow
```
Mission Control ←→ NUC: Heartbeat (60s HTTPS POST) + Sync Agent (SSE)
NUC → Backoffice:       Cloud Event Queue (HMAC-signed HTTPS POST, 30s retry)
Cloud Admin → POS:      JWT cookie (HMAC-SHA256 signed, 8hr expiry)
Terminals → NUC:        Socket.io WebSocket (local network only)
```

---

## 2. MULTI-TENANT DATABASE ROUTING

### Three-Tier Client Resolution (`src/lib/db.ts`)
```
Priority 1: AsyncLocalStorage (NUC custom server — server.ts wraps every request)
Priority 2: Next.js headers — x-venue-slug (Vercel cloud mode)
Priority 3: Master client fallback (local dev, no slug)
```

### Key Files
| File | Purpose |
|------|---------|
| `server.ts` | Custom Node.js server — Socket.io + multi-tenant request wrapping |
| `src/lib/db.ts` | Prisma Proxy client — routes to correct venue DB, soft-delete middleware |
| `src/lib/with-venue.ts` | Wraps all 348 API routes for tenant isolation |
| `src/lib/request-context.ts` | AsyncLocalStorage<RequestContext> — per-request tenant context |
| `preload.js` | Polyfills `globalThis.AsyncLocalStorage` for Node 20 compatibility |
| `src/middleware.ts` | Three modes: Online Ordering (public), Cloud (JWT), Local (PIN) |

### Request Flow (Cloud)
```
Browser → slug.ordercontrolcenter.com/settings
  → middleware.ts: extract slug, validate JWT cookie
  → Set x-venue-slug + x-cloud-mode headers
  → withVenue(): read header, getDbForVenue(slug)
  → API route: db.order.findMany() → routes to gwi_pos_{slug}
```

### Request Flow (NUC Local)
```
Terminal → 192.168.1.100:3005/orders
  → server.ts: read x-venue-slug header
  → requestStore.run({ slug, prisma }) wraps handler
  → withVenue(): context exists → fast-path (skips await headers())
  → API route: db.order.findMany() → routes to venue DB
```

### Isolation Rules
- Every table has `locationId` (except Organization, Location)
- All queries filter by `locationId` + `deletedAt: null` (auto-applied by middleware)
- Soft deletes only (`deletedAt: new Date()`)
- Cloud sync tracked via `syncedAt` field

---

## 3. HARDWARE INVENTORY

### 3A. Printers (Thermal + Impact)

| Field | Details |
|-------|---------|
| **Prisma Model** | `Printer` |
| **Supported Hardware** | Epson TM-T88VII (80mm thermal), Epson TM-U220 (impact, dual-color) |
| **Paper Widths** | 80mm (48 char), 58mm (32 char), 40mm (20 char) |
| **Communication** | TCP/IP raw socket, port 9100 |
| **Protocol** | ESC/POS binary commands |
| **Roles** | receipt, kitchen, bar |
| **Health Tracking** | `lastPingAt`, `lastPingOk` |

**Key Files:**
- `src/lib/printer-connection.ts` — TCP socket to printer
- `src/lib/escpos/commands.ts` — 88 ESC/POS commands (bold, underline, size, cut, color, barcode)
- `src/app/api/print/kitchen/route.ts` — Kitchen ticket routing with failover
- `src/app/api/print/direct/route.ts` — Direct IP bypass
- `src/app/api/print/daily-report/route.ts` — EOD reports
- `src/app/api/print/shift-closeout/route.ts` — Shift close receipts

**Routing Models:**
- `PrintRoute` — Named routes with backup printer failover
- `PrintRule` — Per-item/category routing (cascade: modifier > item > category)
- `Station` — Unified routing engine (PRINTER or KDS type), tag-based pub/sub
- `PrintJob` — Job tracking (pending/sent/failed, ESC/POS buffer for reprint)

### 3B. Payment Readers (Datacap)

| Field | Details |
|-------|---------|
| **Prisma Model** | `PaymentReader` |
| **Supported Hardware** | PAX (port 8080), INGENICO (port 80) |
| **Connection Types** | IP, USB, BLUETOOTH, WIFI |
| **Protocol** | Datacap XML over HTTP/HTTPS |
| **Communication Modes** | local, cloud, local_with_cloud_fallback, simulated |
| **Health Tracking** | `lastSeenAt`, `isOnline`, `avgResponseTime`, `successRate`, `lastError` |

**Transaction Types:**
- EMV Card-Present: EMVSale, EMVReturn, EMVPreAuth, EMVPreAuthCompletion, EMVForceAuth
- Record-Based: SaleByRecordNo, VoidSaleByRecordNo, PreAuthCaptureByRecordNo
- Device Prompts: GetSuggestiveTip, GetSignature, GetYesNo
- Admin: BatchSummary, BatchClose, EMVParamDownload, EMVPadReset
- SAF (Store-and-Forward): Offline certification

**Card Types:** Visa, Mastercard, Amex, Discover, Diners, JCB, UnionPay, Debit, EBT
**Entry Methods:** Chip, Tap (contactless), Swipe, Manual (keyed), Fallback
**CVM:** PIN, Signature, None, Online PIN, Device CVM

**Key Files:**
- `src/lib/datacap/client.ts` — Full XML request/response (41KB)
- `src/lib/datacap/types.ts` — 40+ transaction types, enums
- `src/lib/datacap/constants.ts` — Error codes, timeouts, card mappings
- `src/lib/datacap/xml-builder.ts` — XML request construction
- `src/lib/datacap/xml-parser.ts` — XML response parsing
- `src/lib/datacap/simulator.ts` — Simulated payment responses
- `src/lib/datacap/discovery.ts` — Reader network discovery (port 9001)
- `src/lib/datacap/use-cases.ts` — High-level workflows (sale, pre-auth, void, bar tab)

**API Routes:** `/api/hardware/payment-readers/*` (list, create, ping, verify, cloud process, scan)

### 3C. KDS (Kitchen Display System)

| Field | Details |
|-------|---------|
| **Prisma Models** | `KDSScreen`, `KDSScreenStation`, `Station` (type: KDS) |
| **Supported Hardware** | Any Chromium browser (desktop, tablet, wall-mounted) |
| **Security** | 256-bit deviceToken + 6-digit pairing code (5-min expiry) + optional static IP binding |
| **Display Config** | 1-6 columns, font size (S/M/L), dark/light scheme, aging warnings (yellow 8m, red 15m) |
| **Health Tracking** | `lastSeenAt`, `isOnline` |

**Pairing Flow:**
1. Admin generates 6-digit code (5-min expiry)
2. Device enters code on pairing page
3. Server validates → generates 256-bit deviceToken
4. Token stored in httpOnly cookie

**Key Files:**
- `src/app/(kds)/kds/page.tsx` — Main KDS display
- `src/app/(kds)/kds/pair/page.tsx` — Pairing flow
- `src/app/(kds)/entertainment/page.tsx` — Entertainment KDS
- `src/app/api/hardware/kds-screens/*` — Auth, pair, heartbeat, unpair

### 3D. Terminals (Fixed Stations + Handhelds)

| Field | Details |
|-------|---------|
| **Prisma Model** | `Terminal` |
| **Categories** | FIXED_STATION (desktop/kiosk), HANDHELD (iPad/tablet/phone) |
| **Security** | 256-bit deviceToken + 6-digit pairing code |
| **Bindings** | Receipt printer, primary + backup payment reader, failover terminal |
| **Health Tracking** | `lastSeenAt`, `isOnline` |

**API Routes:** `/api/hardware/terminals/*` (list, create, pair, heartbeat, unpair)

### 3E. Cash Drawer

| Field | Details |
|-------|---------|
| **Connection** | Attached to receipt printer (triggered via ESC/POS) |
| **Command** | `Buffer.from([0x1b, 0x70, 0x00, 0x19, 0x78])` |
| **API Route** | `POST /api/print/cash-drawer` |
| **Key File** | `src/lib/cash-drawer.ts` |

### 3F. NUC Server

| Field | Details |
|-------|---------|
| **OS** | Ubuntu 22.04+ |
| **Hardware** | Intel NUC mini PCs |
| **Installer** | `public/installer.run` (~1,454 lines) |
| **Services** | `thepasspos` (Node.js), `thepasspos-kiosk` (Chromium), `thepasspos-sync` (SSE agent), `postgresql`, `x11vnc` |
| **Roles** | Server (full stack) or Terminal (kiosk only, points to server IP) |

**Provisioning Steps:**
1. RSA-2048 keypair + hardware fingerprint
2. Register with Mission Control → receive encrypted secrets
3. Install PostgreSQL 16, Node.js (NVM), Chromium
4. Clone repo → `npm ci` → `prisma db push` → `npm run build`
5. Create systemd services + heartbeat cron + sync agent
6. Setup Chromium kiosk + desktop launcher

---

## 4. OFFLINE-FIRST ARCHITECTURE

### Design Principle
All devices talk to the local NUC server over the LAN. The NUC talks to the cloud. If internet goes down, the venue keeps operating — orders, payments, printing, KDS all work locally.

### Offline Manager (`src/lib/offline-manager.ts`)
Three-queue system stored in IndexedDB (via Dexie):

| Queue | What It Stores | Sync Endpoint |
|-------|---------------|---------------|
| **Orders** | Order data + terminal-prefixed local ID (e.g., "BAR1-102") | `POST /api/orders/sync` |
| **Print Jobs** | Printer IP/port + ESC/POS ticket data | Direct TCP to printer |
| **Payments** | Payment capture data + idempotency key | `POST /api/payments/sync` |

**Connection Health Detection (Zombie WiFi):**
- `navigator.onLine` only shows WiFi connected (not internet)
- Health check every 60s via `/api/health`
- 2 consecutive failures → state: `degraded`
- Three states: `online`, `offline`, `degraded`

**Retry Strategy:** Exponential backoff: 5s → 10s → 20s → 30s (max). Reset on success.

### IndexedDB Tables (`src/lib/offline-db.ts`)
```
pendingOrders     — { id, localId, terminalId, data, timestamp, attempts, status, serverOrderId }
pendingPrintJobs  — { id, orderId, printerIp, printerPort, ticketData, timestamp, status }
pendingPayments   — { id, orderId, localOrderId, data, timestamp, status }
paymentIntents    — { id, idempotencyKey, orderId, status, statusHistory, isOfflineCapture }
syncLogs          — { timestamp, action, details, localId, serverId }
```

### Service Worker (`public/sw.js`)
- **Static assets:** Cache-first (cache → fallback to network)
- **API calls:** Network-first (network → fallback to cache)
- Pre-caches: `/`, `/login`, `/orders`
- `skipWaiting()` + `clients.claim()` for immediate activation

### PWA Manifest (`public/manifest.json`)
- `display: "standalone"`, `start_url: "/login"`
- Black theme, 192px + 512px icons
- `orientation: "any"` (portrait + landscape)

### Socket.io Reconnection (`src/lib/shared-socket.ts`)
- Singleton per browser tab (refCount pattern)
- Auto-reconnect: 1-5s exponential backoff, infinite attempts
- On reconnect: Re-subscribe to all rooms
- Transports: `['websocket', 'polling']`

### Fallback Polling
- 20-30s polling ONLY when `isConnected === false`
- Used in: KDS, floor plan, entertainment, tabs
- Never polls when socket connected

### Disconnect UI (`src/components/OfflineDisconnectBanner.tsx`)
- Fixed amber banner (z-9999): "Connection lost — reconnecting..."
- Auto-hides when socket reconnects

### Offline Operation Scenarios

**Internet Down, LAN Up:**
- Terminals → NUC via local WiFi/Ethernet (no cloud needed)
- Kitchen prints via direct TCP on LAN
- Orders/payments queue in IndexedDB
- Cloud event queue accumulates on NUC
- When internet returns → all queues auto-flush

**Zombie WiFi (Connected to router, no internet):**
- Health check detects after 2 failures (120s)
- Same behavior as fully offline

**Complete NUC Failure:**
- Terminals fall back to IndexedDB queue
- PWA serves cached pages
- Print jobs queue for later

---

## 5. CLOUD COMMUNICATION

### NUC → Backoffice: Cloud Event Queue (`src/lib/cloud-event-queue.ts`)
```
queueCloudEvent(eventId, venueId, locationId, eventType, body)
  → Stores in PostgreSQL cloud_event_queue table
  → Worker runs every 30s
  → Signs body with HMAC-SHA256 (SERVER_API_KEY)
  → POST to BACKOFFICE_API_URL/api/events/ingest
  → Headers: X-Server-Node-Id, X-Request-Signature
  → Success: delete from queue | Failure: exponential backoff (max 1hr)
```

### NUC → Mission Control: Heartbeat (60s cron)
```
HMAC-signed POST → app.thepasspos.com/api/fleet/heartbeat
  { nodeId, hwFingerprint, cpuPercent, memPercent, diskPercent, localIp, posLocationId }
```

### Mission Control → NUC: Sync Agent (`public/sync-agent.js`)
- SSE connection to `MISSION_CONTROL_URL/api/fleet/sync/sse`
- HMAC-SHA256 authenticated
- Commands: `FORCE_UPDATE` (git pull + rebuild), `KILL_SWITCH` (stop services), `RELOAD_SETTINGS`

### Cloud Admin → POS: JWT Authentication (`src/lib/cloud-auth.ts`)
- JWT signed with HMAC-SHA256 (PROVISION_API_KEY)
- 8-hour expiry, stored in `pos-cloud-session` cookie
- Blocks POS routes in cloud mode (ordering, KDS) — admin access only

---

## 6. REAL-TIME ARCHITECTURE (Socket.io)

### Server Side (`src/lib/socket-server.ts`)
**Room Hierarchy:**
```
location:{locationId}  — All terminals at venue
tag:{tagName}          — KDS stations (pizza, bar, expo)
terminal:{terminalId}  — Direct messages to specific device
station:{stationId}    — Station-specific messages
```

**Dispatch Functions (from API routes):**
```typescript
emitToLocation(locationId, event, data)  // All terminals
emitToTags(tags[], event, data)          // Specific KDS stations
emitToRoom(room, event, data)            // Any room
```

### Client Side (`src/lib/shared-socket.ts`)
```typescript
getSharedSocket()       // Get/create singleton (increments refCount)
releaseSharedSocket()   // Decrement refCount (disconnect at 0)
getTerminalId()         // Stable terminal ID per tab
isSharedSocketConnected() // Connection status
```

---

## 7. COMPLETE TECHNOLOGY STACK

### Core Framework
| Package | Version | Purpose |
|---------|---------|---------|
| `next` | 16.1.5 | React framework with App Router |
| `react` | 19.2.3 | UI library |
| `typescript` | 5.9.3 | Type safety |
| `tailwindcss` | 4.x | Utility-first CSS |

### Database & ORM
| Package | Version | Purpose |
|---------|---------|---------|
| `prisma` | 6.19.2 | ORM + schema management |
| `@prisma/client` | 6.19.2 | Prisma client |
| `@neondatabase/serverless` | 1.0.2 | Serverless PostgreSQL (raw SQL in build) |

### Real-Time & State
| Package | Version | Purpose |
|---------|---------|---------|
| `socket.io` | 4.8.3 | Server-side WebSocket |
| `socket.io-client` | 4.8.3 | Client-side WebSocket |
| `zustand` | 5.0.10 | State management |

### Offline Storage
| Package | Version | Purpose |
|---------|---------|---------|
| `dexie` | 4.3.0 | IndexedDB wrapper (offline queues) |

### Validation
| Package | Version | Purpose |
|---------|---------|---------|
| `zod` | 4.3.6 | Runtime validation |

### UI & Animation
| Package | Version | Purpose |
|---------|---------|---------|
| `framer-motion` | 12.29.2 | Animations |
| `@heroicons/react` | 2.2.0 | Icons |
| `lucide-react` | 0.563.0 | Additional icons |
| `clsx` | 2.1.1 | className utility |
| `tailwind-merge` | 3.4.0 | Merge Tailwind classes |
| `react-virtuoso` | 4.18.1 | Virtual list scrolling |

### Drag & Drop / Canvas
| Package | Version | Purpose |
|---------|---------|---------|
| `@dnd-kit/core` | 6.3.1 | Headless drag-and-drop |
| `@dnd-kit/sortable` | 10.0.0 | Sortable plugin |
| `konva` | 10.2.0 | Canvas (floor plan) |
| `react-konva` | 19.2.1 | React canvas wrapper |
| `reactflow` | 11.11.4 | Flow/diagram rendering |

### Communications & Documents
| Package | Version | Purpose |
|---------|---------|---------|
| `twilio` | 5.12.0 | SMS (OTP, notifications) |
| `nodemailer` | 8.0.1 | Email |
| `pdfkit` | 0.17.2 | PDF generation (reports) |

### Security
| Package | Version | Purpose |
|---------|---------|---------|
| `bcryptjs` | 3.0.3 | PIN hashing |

### Build & Dev Tools
| Package | Version | Purpose |
|---------|---------|---------|
| `esbuild` | 0.27.3 | Server compilation (server.ts → server.js) |
| `tsx` | 4.21.0 | TypeScript executor (dev mode) |
| `dotenv-cli` | 11.0.0 | Environment loading |
| `eslint` | 9 | Linting |
| `@playwright/test` | 1.58.1 | E2E testing |
| `vitest` | 4.0.18 | Unit testing |

---

## 8. BUILD & DEPLOYMENT

### Build Pipeline
```
npm run build
  → prisma generate                    # Generate Prisma client
  → generate-schema-sql.mjs           # SQL schema export
  → next build                        # Next.js build (standalone output)
  → build-server.mjs                  # esbuild: server.ts → server.js
```

### Vercel Build (`scripts/vercel-build.js`)
```
1. prisma generate
2. Pre-push SQL migrations (backfill NOT NULL columns on existing rows)
3. prisma db push --accept-data-loss
4. next build
```

### Custom Server (`server.ts`)
```
npm run dev   → dotenv -e .env.local -- tsx -r ./preload.js server.ts
npm start     → NODE_ENV=production node -r ./preload.js server.js
```

### Next.js Config
- `output: 'standalone'` — Self-contained for NUC Docker/systemd
- Rewrites: `/admin/:path*` → Backoffice Java service
- `poweredByHeader: false`

---

## 9. NETWORK TOPOLOGY

```
┌─────────────────────────────────────────────────────────────────┐
│          MISSION CONTROL (app.thepasspos.com)                   │
│  Fleet registration, NUC provisioning, monitoring, billing      │
│  Clerk B2B auth | Neon PostgreSQL (single master)               │
└─────────────────────────────────────────────────────────────────┘
        ▲ Heartbeat (60s POST) | Sync Agent (SSE) | HMAC-SHA256 ▼
┌─────────────────────────────────────────────────────────────────┐
│          VENUE BACKOFFICE (api.ordercontrolcenter.com)           │
│  Event ingestion, cloud reporting, admin dashboard              │
│  HMAC-SHA256 auth | Neon PostgreSQL (shared cloud)              │
└─────────────────────────────────────────────────────────────────┘
        ▲ Cloud Event Queue (HMAC-signed POST, 30s retry) ▼
┌─────────────────────────────────────────────────────────────────┐
│          NUC SERVER (Ubuntu 22.04, Intel NUC)                   │
│  Node.js custom server + Socket.io (port 3005)                  │
│  PostgreSQL 16 (gwi_pos_{slug}) | systemd services              │
│  thepasspos | thepasspos-kiosk | thepasspos-sync | heartbeat cron          │
│  Works 100% offline — queues events for cloud                   │
└─────────────────────────────────────────────────────────────────┘
        ▲ Local WiFi/Ethernet (Socket.io + REST) ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Terminal 1   │  │ Terminal 2   │  │ Handheld     │
│ (Kiosk NUC)  │  │ (Chromium)   │  │ (PWA iPad)   │
└──────────────┘  └──────────────┘  └──────────────┘
        ▲ TCP/IP port 9100 (ESC/POS, LAN only) ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Kitchen      │  │ Bar Printer  │  │ Receipt      │
│ Printer      │  │              │  │ Printer      │
└──────────────┘  └──────────────┘  └──────────────┘
        ▲ HTTP XML (Datacap, LAN) ▼
┌──────────────┐
│ PAX/INGENICO │
│ Card Reader  │
└──────────────┘
```

---

## 10. HARDWARE COUNT PER VENUE

| Device | Count per Venue | Communication |
|--------|----------------|---------------|
| NUC Server | 1 | Ethernet to router, HTTPS to cloud |
| Fixed Terminals | 1-10 | WiFi/Ethernet to NUC |
| Handhelds (PWA) | 1-20 | WiFi to NUC |
| Kitchen Printers | 1-5 | TCP 9100 to NUC |
| Receipt Printers | 1-3 | TCP 9100 to NUC |
| KDS Screens | 1-6 | WiFi/Ethernet to NUC |
| Payment Readers | 1-5 | IP/USB to Terminal |
| Cash Drawers | 1-3 | Via receipt printer |
