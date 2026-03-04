# GWI POS Architecture

*Last Updated: March 4, 2026*

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CLOUD LAYER                                    │
│                                                                       │
│  ┌─────────────────────┐      ┌──────────────────────────────────┐   │
│  │  Vercel (Next.js)   │      │  Neon PostgreSQL (Cloud DB)       │   │
│  │  Admin Console +    │◄────►│  Primary source of truth          │   │
│  │  Back-office API    │      │  3-layer backup (30-day restore)  │   │
│  └─────────────────────┘      └──────────────────────────────────┘   │
│           ▲                            ▲                              │
│           │ HTTPS sync                 │ Logical replication          │
└───────────┼────────────────────────────┼──────────────────────────────┘
            │                            │
┌───────────┼────────────────────────────┼──────────────────────────────┐
│           │    LOCAL SERVER (Per Venue)                                │
│           ▼                            ▼                              │
│  ┌──────────────────┐      ┌─────────────────────┐                   │
│  │  NUC (Mini PC)   │      │  Local PostgreSQL    │                   │
│  │  Node.js + PM2   │◄────►│  Primary ops DB      │                   │
│  │  Socket.IO       │      │  All transactions    │                   │
│  │  Port 3005       │      └─────────────────────┘                   │
│  └──────────────────┘                                                 │
│           ▲                                                           │
│           │ Local Network (< 10ms)                                    │
│   ┌───────┼────────────────────────────────┐                         │
│   ▼       ▼                ▼               ▼                         │
│ ┌──────┐ ┌──────────┐ ┌────────┐  ┌──────────────┐                  │
│ │ KDS  │ │ Android  │ │ PAX    │  │ PAX A3700    │                  │
│ │(Web) │ │ Register │ │ A6650  │  │ CFD Display  │                  │
│ └──────┘ └──────────┘ └────────┘  └──────────────┘                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Deployment Architecture

### NUC (Local Server — Per Venue)

Each venue runs a dedicated mini PC (Intel NUC or equivalent) on-site:

| Component | Details |
|-----------|---------|
| **Runtime** | Node.js 20 LTS |
| **Process manager** | PM2 (`ecosystem.config.js`) — auto-restart on crash, memory limit 500MB, JSON logs |
| **App** | Next.js custom server (`server.ts`) on port 3005 |
| **Database** | PostgreSQL 16 (local) — all live transaction data |
| **Real-time** | Socket.IO embedded in custom server |
| **External access** | Cloudflare Tunnel (no open ports, no VPN required) |
| **Startup** | PM2 configured as system service (`pm2 startup`) — survives reboots |

**PM2 config** (`ecosystem.config.js`):
```js
module.exports = {
  apps: [{
    name: 'gwi-pos',
    script: 'server.js',
    env: { PORT: 3005, NODE_ENV: 'production' },
    max_memory_restart: '500M',
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
  }]
}
```

### Cloud (Vercel + Neon)

| Component | Details |
|-----------|---------|
| **Hosting** | Vercel (Next.js) — admin console + back-office API |
| **Database** | Neon PostgreSQL — cloud sync, reporting, merchant settings |
| **Deploys** | Automatic on push to `main` |
| **Env vars** | Managed in Vercel dashboard |

---

## Data Backup & Restore Policy

### Three-Layer Backup Strategy

Merchant data is protected by three independent backup layers. Any single layer alone is sufficient for full recovery.

#### Layer 1 — Neon Point-in-Time Recovery (PITR)
- **What:** Continuous WAL streaming backup of the cloud Neon database
- **Retention:** 30 days
- **RPO:** < 5 minutes (any 5-minute window is recoverable)
- **Restore SLA:** Neon restores to any timestamp within the 30-day window
- **Trigger:** Neon handles this automatically — no manual action required
- **Merchant promise:** *"We can restore your data to any point in the last 30 days"*

#### Layer 2 — Neon Branch Snapshots (Weekly)
- **What:** GitHub Actions creates a point-in-time Neon branch every Sunday at 3 AM
- **Retention:** 28 days (4 weekly snapshots kept)
- **Restore:** Promote the branch to primary, or use it for point-in-time reads
- **Config:** `.github/workflows/backup.yml`

```
Sunday 3 AM → pg_dump NUC → restore to neon-backup-YYYY-MM-DD branch
```

#### Layer 3 — Local PostgreSQL on NUC
- **What:** The NUC's local PostgreSQL is the live operational database
- **Protection:** All transactions write locally first — the NUC is never dependent on cloud connectivity
- **Recovery:** If cloud is unavailable, the NUC continues operating indefinitely; re-sync resumes when connectivity returns

### Restore Procedures

| Scenario | Recovery Path | Time to Restore |
|----------|--------------|-----------------|
| Accidental data deletion | Neon PITR → restore to timestamp before deletion | < 30 min |
| Corrupt cloud data | Neon PITR or weekly branch → promote branch | < 1 hour |
| NUC hardware failure | Replace NUC → re-pair terminals → cloud sync restores data | < 2 hours |
| Full site outage | Replace NUC + restore from Neon backup | < 4 hours |
| Data loss > 30 days ago | Not recoverable from automated backups — contact support | N/A |

### Merchant Data Rights
- Merchants own their data
- Full data export available on request (CSV/JSON)
- Data is retained for 30 days after account cancellation before deletion
- No data is shared across locations or merchants (strict `locationId` isolation)

---

## Error Tracking & Monitoring

### Sentry (gwi-pos)

| Setting | Value |
|---------|-------|
| **SDK** | `@sentry/nextjs` |
| **Config files** | `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` |
| **Trace sample rate** | 20% in production |
| **Session replay** | 10% sessions, 100% on error |
| **DSN** | Set via `SENTRY_DSN` environment variable |
| **Organization** | `gwi-ao` |
| **Project** | `javascript-nextjs` |

Sentry captures:
- Unhandled exceptions in API routes
- Client-side React errors
- Edge runtime errors
- Performance traces for slow operations

### UptimeRobot (External Availability)

- Monitors `https://[venue-domain]/api/health` every 5 minutes
- Alerts via email + SMS when the NUC or Vercel deployment goes down
- Dashboard: uptimerobot.com (GWI account)

### PM2 Process Monitoring

```bash
pm2 status          # View all running processes
pm2 logs gwi-pos    # Tail live logs
pm2 monit           # Real-time CPU/memory dashboard
```

---

## Android Ecosystem

### Apps

| App | Repo | Purpose | GitHub Actions |
|-----|------|---------|----------------|
| **GWI Register** | `gwi-android-register` | Full POS terminal (VP3350, scale, printer) | ✅ Signed APK on tag |
| **GWI Handheld** | `gwi-pax-a6650` | PAX A6650 handheld POS | ✅ Signed APK on tag |
| **GWI Softies** | `gwi-softies` (SoftPOS) | Datacap SureTap NFC tap-to-pay | ✅ Signed APK on tag |
| **GWI CFD** | `gwi-cfd` | PAX A3700 customer display | Manual build |

### APK Build & Release Pipeline

All Android apps use the same GitHub Actions pattern:

```
Developer pushes tag v*.*.* to GitHub
         │
         ▼
GitHub Actions runner (ubuntu-latest)
         │
         ├── Checkout code
         ├── Set up JDK 17 (Temurin)
         ├── Decode keystore from KEYSTORE_BASE64 secret
         ├── ./gradlew assembleRelease (signed)
         └── Upload APK as GitHub Release asset
```

**Keystore:** `gwi-pos-release.jks` — alias `gwi-pos`, backed up at `/Users/brianlewis/.android/`

**Required GitHub Secrets (all 3 repos):**

| Secret | Purpose |
|--------|---------|
| `KEYSTORE_BASE64` | Base64-encoded release keystore |
| `KEY_ALIAS` | Keystore alias (`gwi-pos`) |
| `KEY_PASSWORD` | Key password |
| `STORE_PASSWORD` | Keystore password |
| `SENTRY_DSN` | Sentry DSN for this app |
| `SENTRY_ORG` | `gwi-ao` |
| `SENTRY_PROJECT` | Per-app project name |

### Android Auto-Update

`UpdateChecker.kt` polls GitHub Releases API on every app launch and compares `versionCode`. If a newer APK is available, it downloads and installs silently using `ApkInstaller.kt` + `FileProvider`. No Google Play account required.

### Android Error Tracking

| Layer | Tool | What It Catches |
|-------|------|----------------|
| **Crashes** | Firebase Crashlytics | ANRs, native crashes, fatal exceptions |
| **Errors** | Sentry Android SDK | Handled exceptions, breadcrumbs, performance |
| **Anti-crash** | `io.sentry.auto-init = false` in AndroidManifest | Prevents Sentry from crashing before `Application.onCreate()` when DSN is missing |

Sentry is initialized manually in each `Application` class with a DSN guard:
```kotlin
if (BuildConfig.SENTRY_DSN.isNotEmpty()) {
    SentryAndroid.init(this) { options ->
        options.dsn = BuildConfig.SENTRY_DSN
        options.tracesSampleRate = 1.0
    }
}
```

---

## Database Architecture

### Multi-Tenancy

Every table (except `Organization` and `Location`) has:

| Field | Purpose |
|-------|---------|
| `locationId` | Tenant isolation — all queries filter by this |
| `deletedAt` | Soft delete — never hard delete operational data |
| `syncedAt` | Cloud sync tracking — `null` means pending sync |

### Key Models

```
Organization (root)
  └── Location
        ├── Employee → Role → Permission
        ├── Category → MenuItem → ModifierGroup → Modifier
        ├── Order → OrderItem → OrderItemModifier → OrderEvent
        ├── Table → Seat
        ├── Shift → Drawer → PaidInOut
        ├── Tab → TabPayment
        ├── Payment → TipAdjustment
        ├── TipOutRule → TipShare
        └── [75+ more models...]
```

### Schema Rules

```prisma
model ExampleTable {
  id         String    @id @default(cuid())
  locationId String                           // Multi-tenancy (required)
  // ... fields ...
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  deletedAt  DateTime?                        // Soft delete
  syncedAt   DateTime?                        // Sync tracking
  @@index([locationId])
}
```

---

## API Architecture

### Route Structure

```
/api
├── /auth/login              POST - Employee PIN login (server-side only, no local PIN)
├── /sync                    Bootstrap + delta sync for Android terminals
├── /menu
│   ├── /categories          CRUD
│   ├── /items               CRUD
│   └── /modifiers           CRUD
├── /orders
│   ├── /                    GET/POST
│   ├── /[id]                GET/PATCH/DELETE
│   ├── /[id]/items          POST - Add items (event-sourced)
│   ├── /[id]/payment        POST - Record payment
│   └── /[id]/events         GET - Order event stream
├── /shifts                  CRUD + close
├── /employees               CRUD
├── /tables                  CRUD + floor plan
├── /terminals               Pair, bootstrap, status
├── /tips                    Pending tips, adjustments
├── /reports                 Daily, sales, tips, voids, etc.
└── /hardware
    ├── /printers
    ├── /kds-screens
    └── /cfd                 Customer-facing display
```

### Auth Pattern

Every route uses `requirePermission()` — never `{ soft: true }`:

```typescript
const { locationId, employee } = await requirePermission(req, 'PERMISSION_KEY')
```

---

## Security Architecture

### Device Authentication
- **Android terminals**: Bootstrap token (JWT) stored in `EncryptedSharedPreferences`
- **KDS screens**: 256-bit token + httpOnly cookie
- **No local PIN storage**: All PIN verification is server-side only

### Data Protection
- All data isolated by `locationId` — no cross-tenant data leakage possible
- Soft deletes preserve full audit trail
- Payments processed exclusively through Datacap (PCI scope minimized)
- No card data stored anywhere in the system

### Rate Limiting
- API routes rate-limited to prevent brute-force attacks
- Socket connections authenticated before any data flows

---

## Offline Strategy

### Local-First Design

The NUC's local PostgreSQL is the operational database. The venue continues operating during:
- Internet outages
- Neon cloud outages
- Vercel outages

Operations that require cloud: none (all POS operations are local-first).

Operations that degrade gracefully during cloud outage:
- Cloud sync pauses (queued with `syncedAt: null`)
- Reports may show slightly stale cloud data
- Admin console (Vercel) unavailable — use NUC directly

### Android Connectivity States

| State | Condition | POS Operations |
|-------|-----------|----------------|
| **Green** | NUC reachable + Internet up | Full — all operations fast |
| **Amber** | NUC reachable, Internet down | Full — card payments use SAF |
| **Red** | NUC unreachable | Limited — local-only, outbox queues |

---

## Performance Targets

| Action | Target | How Achieved |
|--------|--------|-------------|
| Button tap | < 50ms | Local server, optimistic UI |
| Add item | < 100ms | Local DB, Zustand state |
| Send to kitchen | < 50ms | Socket.IO push |
| Print ticket | < 500ms | Direct printer IP |
| Android order load | < 200ms | Room + event replay cache |

---

## Build Phases

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 1** | Core POS (orders, payments, kitchen, shifts, tabs) | ✅ Complete |
| **Phase 2** | Admin Console (back-office, reporting, multi-location) | 🔄 In progress |
| **Phase 3** | Fleet Management (Mission Control, remote deploy) | ⏳ Planned |
