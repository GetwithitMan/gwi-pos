# GWI POS - System Architecture

**Version:** 1.0
**Updated:** January 30, 2026
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

## Immediate Action Items

### Must Do Now (Before More Features)

1. **Add soft delete fields** - Add `deletedAt DateTime?` to all tables
2. **Add sync tracking** - Add `syncedAt DateTime?` to all tables
3. **Never hard delete** - All deletes set `deletedAt` instead

### Can Wait (But Document)

- ~~PostgreSQL migration~~ (DONE -- migrated to Neon PostgreSQL, database-per-venue)
- Docker containerization
- Admin console
- Sync service
- Payment processor integration

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

*This document is the architecture source of truth for GWI POS.*
*Last Updated: January 30, 2026*
