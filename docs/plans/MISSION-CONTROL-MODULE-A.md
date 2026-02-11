# Plan: Mission Control Center — Core Module A: Tenant & Fleet Management

## Context

GWI POS is a hybrid SaaS system where each restaurant location runs a local Ubuntu server (Docker + PostgreSQL) for sub-50ms latency and 100% offline capability. **Phase 2** is the cloud Admin Console ("The Mothership") — a multi-tenant dashboard that manages the fleet of local servers with full control and maximum security.

The local POS already has excellent foundations:
- Organization → Location → 80+ tables with `locationId`, `deletedAt`, `syncedAt`
- Docker Compose with Watchtower auto-updates
- KDS/Terminal 256-bit device tokens with httpOnly cookies (pairing pattern)
- Socket.io real-time infrastructure
- Offline sync algorithm fully designed (not yet implemented)
- Health check API, internal API secret pattern

**What's missing**: The cloud side — server registration, fleet monitoring, secure communication, license enforcement, and controlled updates.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    MISSION CONTROL CENTER (Cloud - Vercel)                │
│                                                                          │
│  Next.js App + Neon PostgreSQL + S3 Backups                             │
│                                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────────┐  │
│  │ Fleet Dash  │  │ Sync Engine  │  │ Licensing  │  │ Update Mgr   │  │
│  │ (real-time) │  │ (ingest)     │  │ (enforce)  │  │ (rollout)    │  │
│  └─────────────┘  └──────────────┘  └────────────┘  └──────────────┘  │
│                                                                          │
│  AdminUser auth via Clerk B2B (org-scoped sessions + MFA)               │
│  Super Admin / Org Admin / Location Manager RBAC                       │
│                                                                          │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
               All connections initiated OUTBOUND by local servers
               (servers never expose ports to the internet)
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  LOCAL SERVER A  │  │  LOCAL SERVER B  │  │  LOCAL SERVER C  │
│  (Ubuntu+Docker) │  │  (Ubuntu+Docker) │  │  (Ubuntu+Docker) │
│                  │  │                  │  │                  │
│ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │
│ │ Sync Agent   │ │  │ │ Sync Agent   │ │  │ │ Sync Agent   │ │
│ │ (sidecar)    │ │  │ │ (sidecar)    │ │  │ │ (sidecar)    │ │
│ │ - heartbeat  │ │  │ │ - heartbeat  │ │  │ │ - heartbeat  │ │
│ │ - sync       │ │  │ │ - sync       │ │  │ │ - sync       │ │
│ │ - SSE listen │ │  │ │ - SSE listen │ │  │ │ - SSE listen │ │
│ │ - license    │ │  │ │ - license    │ │  │ │ - license    │ │
│ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │
│ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │
│ │ GWI POS App  │ │  │ │ GWI POS App  │ │  │ │ GWI POS App  │ │
│ │ (unchanged)  │ │  │ │ (unchanged)  │ │  │ │ (unchanged)  │ │
│ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Key principles**:
- The **Sync Agent is the ONLY process allowed to talk to the cloud**. The POS app only talks to the local database and local HTTP APIs (including the Sync Agent's internal API). The POS app NEVER calls the Mothership directly.
- The POS app treats license state, kill state, and cloud-pushed config as **read-only inputs** consumed via the Sync Agent's local API.
- The Sync Agent is a separate Docker sidecar container. The POS application requires zero code changes for Module A.

---

## 1. Server Registration & Identity ("Provision, Then Phone Home")

### Phase 1: Admin creates location in Mothership
- Creates `CloudLocation` record with status `PROVISIONING`
- Generates one-time `ServerRegistrationToken` (UUID, 24-hour expiry)
- Downloads provisioning bundle (JSON file for USB stick or secure transfer)

### Phase 2: Provisioning script runs on Ubuntu server (HOST, not Docker)
**Important**: The provisioning script runs directly on the Ubuntu host OS, **never inside a Docker container**. It writes to `/etc/gwi-pos/` and generates the `.env` file consumed by Docker Compose.

- Loads the provisioning bundle (registrationToken, SYNC_API_URL, locationId, orgId)
- Collects **hardware fingerprint**: SHA-256 of SMBIOS UUID + MAC + CPU + RAM + disk serial
- Includes a `fingerprintVersion: 1` field so the formula can be updated later without breaking existing installs
- Generates **4096-bit RSA keypair** locally (private key stays on server, chmod 0600, owned by root)
- Sends `POST /api/fleet/register` with token + fingerprint + fingerprintVersion + public key

### Phase 3: Cloud validates and responds
- Validates token (exists? not expired? not already used?)
- **Checks hardware fingerprint uniqueness**: If fingerprint already belongs to another active `CloudLocation`, returns error `hardware_already_registered` (detects mis-deploys or cloned images)
- Stores hardware fingerprint + `fingerprintVersion` + public key in `ServerNode` record
- Generates `serverApiKey` (64-char hex — mirrors KDS `deviceToken` pattern)
- Encrypts `serverApiKey` with server's RSA public key (only that server can decrypt)
- Returns encrypted key + marks token as USED (one-time, never valid again)

### Phase 4: Server stores credentials
- Decrypts `serverApiKey` with private key
- Stores in `/etc/gwi-pos/credentials.json` (on LUKS-encrypted disk)
- Writes Docker `.env` with `SYNC_ENABLED=true`, `SYNC_API_KEY`, `SERVER_NODE_ID`
- Starts containers, sends first heartbeat

### Why this is secure
| Decision | Rationale |
|----------|-----------|
| One-time token (24h expiry) | Mirrors KDS `pairingCode` pattern. Prevents replay attacks. |
| Hardware fingerprint | Binds credential to physical hardware. Cloned disk images fail fingerprint check. |
| RSA key exchange | Even if HTTPS is compromised via rogue CA, only the server's private key decrypts the API key. |
| Private key never leaves server | Stored on LUKS disk, root-only access. Docker mounts as read-only secret. |

### Re-provisioning (hardware replacement)
Admin clicks "Re-provision" → old `serverApiKey` revoked immediately → new token generated → new server follows same flow → old `ServerNode` set to `decommissioned` status (NOT deleted — remains in DB for full audit trail via FleetAuditLog history).

---

## 2. Secure Communication Model

### Zero inbound ports — server only calls OUT

The local server **never** accepts inbound connections from the internet. All communication is outbound-initiated.

### Server → Cloud (HTTPS POST with HMAC)

Every request includes:
```
Authorization: Bearer {serverApiKey}
X-Server-Node-Id: {serverNodeId}
X-Hardware-Fingerprint: {SHA-256 hash}
X-Request-Signature: {HMAC-SHA256(body, serverApiKey)}
```

| Channel | Frequency | Data |
|---------|-----------|------|
| Heartbeat | Every 60s | status, uptime, version, CPU, RAM, disk, active orders |
| Health Report | Every 5min | Full `/api/health` response + monitoring aggregation |
| Data Sync | Every 5min | Batched records using existing `syncedAt` watermark |
| Error Reports | Real-time | Fire-and-forget error log forwarding |

### Cloud → Server (SSE — Server-Sent Events)

The Sync Agent maintains a persistent SSE connection (outbound from server):
```
GET https://api.gwipos.com/api/fleet/commands/stream
Authorization: Bearer {serverApiKey}
Last-Event-ID: {lastProcessedCommandId}
```

SSE chosen over WebSocket because:
- Works through any HTTP proxy/firewall (standard HTTPS)
- Built-in automatic reconnect with `Last-Event-ID` replay
- Re-authenticates on every reconnect
- Simpler for one-way command push

Command types delivered via SSE:
- `force_sync` — trigger immediate sync with priority
- `update_config` — push setting changes
- `kill_switch` — suspend or lock the location
- `force_update` — push Docker image update with rollback
- `request_diagnostic` — request health/debug snapshot
- `revoke_credential` — rotate server API key

Every command is ACK'd by the server: `POST /api/fleet/commands/{id}/ack`

### SSE Reconnect Policy
- Exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s → **60s max** with random jitter (±30%)
- On reconnect, Sync Agent **always revalidates license** if last check is >5 minutes old
- `Last-Event-ID` sent on every reconnect to replay missed commands

### Command Execution Guarantees
- Sync Agent processes commands **serially, in-order per ServerNode** — a `force_update` cannot run in parallel with `force_sync`
- Every `FleetCommand` has an `expiresAt` field. If a command arrives after expiry, Sync Agent **ACKs it as `expired`** and skips execution (prevents stale commands applying after long outages)
- Sync Agent remembers `lastProcessedCommandId` and ignores duplicates (idempotent)
- Commands are processed from a single-threaded worker queue

### HMAC Request Signing
Mirrors the existing Twilio webhook signature pattern (`src/lib/twilio.ts`). Provides:
- **Integrity**: Body wasn't tampered with
- **Authentication**: Only the server with the correct key can sign
- **Non-repudiation**: Cloud can verify which server sent the request

---

## 3. Cloud Database Schema (New — Neon PostgreSQL)

### Strict Tenant Isolation ("Shared Nothing")

Do NOT rely solely on `WHERE org_id = x` in application code — that is error-prone and one missed filter leaks data. We use **structural isolation** at the database level.

**Strategy: Postgres Schemas + Row-Level Security (RLS)**

| Schema | Purpose | Access |
|--------|---------|--------|
| `public` | Routing map: tenants, domains, subscription_status, global admin users | Mothership app user (read/write) |
| `tenant_{orgId}` | Org-specific data: locations, servers, heartbeats, sync sessions, commands | Scoped DB role per org (read/write own schema only) |

**The Guard Rail**: Each tenant's DB role is only granted `USAGE` + `SELECT/INSERT/UPDATE` on their own schema. Even if the application tries `SELECT * FROM tenant_other.server_nodes`, the database **rejects it at the connection level**.

**RLS as Defense-in-Depth** (on top of schemas):
```sql
ALTER TABLE server_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON server_nodes
  USING (org_id = current_setting('app.current_org_id')::uuid);
```

**Application middleware sets context on every request:**
```sql
SET LOCAL app.current_org_id = '{orgId}';
```

This gives us **two independent layers**: schema isolation (structural) + RLS (policy). Both must fail for a cross-tenant leak.

### Key Models

```
CloudOrganization
├── stripeCustomerId, subscriptionTier (starter|pro|enterprise)
├── subscriptionStatus (active|past_due|suspended|cancelled)
├── maxLocations (limit enforcement)
├── AdminUser[] (email + passwordHash + TOTP MFA)
└── CloudLocation[]
    ├── licenseKey (unique), licenseExpiresAt, licenseStatus
    ├── gracePeriodDays (default 14)
    ├── SubscriptionLimits (JSON — see Section 14)
    │   ├── maxPOSTerminals, maxHandhelds, maxKDSScreens
    │   ├── maxPrinters, maxPaymentReaders
    │   └── featuresEnabled[] (online_ordering, bottle_service, scheduling, etc.)
    ├── PaymentConfig (JSON — see Section 13, ENCRYPTED AT REST)
    │   ├── datacapMerchantId, datacapOperatorId
    │   ├── processingRatePercent, perTransactionFeeCents
    │   ├── monthlyPlatformFeeCents
    │   └── readerConfigs[] (secureDeviceId per reader)
    ├── BillingConfig (JSON — see Section 15)
    │   ├── monthlySubscriptionCents, billingCycleDay
    │   ├── processingRatePercent (GWI's cut)
    │   └── revenueSharePercent (optional)
    ├── ServerNode[]
    │   ├── serverApiKey (64-char hex, unique — like KDS deviceToken)
    │   ├── hardwareFingerprint (SHA-256), fingerprintVersion (Int, default 1)
    │   ├── publicKey (RSA PEM)
    │   ├── status (registered|online|offline|degraded|decommissioned)
    │   ├── currentVersion, targetVersion, schemaVersion (tracks Prisma migration state)
    │   ├── healthStatus, healthDetails (JSON)
    │   ├── isKilled, killedAt, killedReason, killBanner (JSON: {code, message, supportContact})
    │   └── ServerHeartbeat[] (cpuPercent, memoryUsedMb, diskUsedGb, activeOrders...)
    ├── ServerRegistrationToken[]
    │   ├── token (unique UUID, one-time use)
    │   ├── status (pending|used|expired|revoked)
    │   └── expiresAt (24 hours from creation)
    ├── SyncSession[] → SyncBatch[]
    │   ├── direction (upload|download), status, recordsTotal/Success/Failed
    │   └── conflictsDetected, conflictsResolved, conflictDetails
    └── FleetCommand[]
        ├── commandType, payload, priority
        ├── status (pending|delivered|acknowledged|completed|failed|expired)
        └── createdBy (AdminUser who issued it)

FleetAuditLog (organization-level)
├── actorType (admin_user|system|server_node)
├── action (server.registered|command.issued|license.suspended|sync.completed...)
├── resource, resourceId, details (JSON)
└── ipAddress, userAgent
```

---

## 4. License Enforcement

### Boot-time check flow
```
Server Boot → SYNC_ENABLED=true?
  ├── false → Standalone mode (dev/pre-registration)
  └── true → POST /api/fleet/license/validate
      ├── 200 active → Cache license locally, start POS
      ├── 200 grace_period → Start with warning banner, retry hourly
      ├── 200 suspended → Check local cache grace period
      │   ├── Grace remaining → Run with warning
      │   └── Grace expired → Read-only mode
      ├── 200 killed → Immediate lockout
      └── Network error → Check local license cache
          ├── Cache valid + within grace → Run normally
          ├── Cache expired → Read-only mode
          └── No cache → Limited standalone (orders work, no sync)
```

### Local license cache
Stored at `/etc/gwi-pos/license-cache.json`, HMAC-signed by cloud using `serverApiKey`. Prevents tampering — if signature doesn't match, cache is treated as missing.

**In-memory caching**: The POS app caches the last known good license state **in memory** and only re-reads from the Sync Agent status API on a timer (every 60s). This prevents a transient filesystem glitch from flipping the store into read-only mode mid-rush.

### Kill switch
Delivered via SSE `kill_switch` command. Server ACKs and sets local flag. POS checks flag on next request. **Kill requires active delivery** — if server goes offline, it uses cached license (dead man's switch pattern).

**Kill banner schema**: The kill command includes a structured `killBanner` payload:
```json
{
  "code": "ACCOUNT_SUSPENDED",
  "title": "Service Suspended",
  "message": "Your GWI POS subscription has been suspended. Please contact support.",
  "supportPhone": "1-800-GWI-HELP",
  "supportEmail": "support@gwipos.com"
}
```
The POS UI displays this branded banner instead of a generic lockout screen.

### Emergency Unlock Code (playbook, not in initial code)
If the cloud is down AND a bug has triggered a false kill/suspension, an owner-level admin can generate a time-limited **Emergency Unlock Code** via a pre-shared offline recovery process (e.g., call support → verify identity → receive 8-digit code → enter on server CLI). This is a last-resort recovery path, documented in the operational runbook but not built in Phase 2A.

---

## 5. Fleet Monitoring Dashboard

### Real-time status cards per location
```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│Location 1│  │Location 2│  │Location 3│  │Location 4│
│  ✅ OK   │  │ ⚠️ DEGRAD│  │  ✅ OK   │  │  ❌ DOWN │
│ v2.1.0   │  │ v2.0.5   │  │ v2.1.0   │  │ v2.0.5   │
│ 47 orders│  │ 12 orders│  │ 83 orders│  │ Last: 5m │
│ Sync: ✅ │  │ Sync: ⚠️ │  │ Sync: ✅ │  │ Sync: ❌ │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

### Status Thresholds

| Status | Definition |
|--------|-----------|
| **Online** | Last heartbeat < 2 minutes ago |
| **Degraded** | 2-4 missed heartbeats (2-4 minutes since last) — usually indicates high CPU, network blip, or Docker restart |
| **Offline** | 5+ missed heartbeats (5+ minutes since last) — server is down or unreachable |

### Alerting rules
| Condition | Severity | Action |
|-----------|----------|--------|
| No heartbeat 2min (degraded) | Warning | Dashboard yellow |
| No heartbeat 5min (offline) | Critical | Dashboard red + email |
| No heartbeat 15min | Emergency | SMS to admin |
| Sync failed 3x | Warning | Dashboard yellow |
| Sync gap > 30min | Critical | Email |
| Disk > 85% | Warning | Dashboard yellow |
| Disk > 95% | Critical | Email + SMS |
| License expiring < 30 days | Warning | Email |
| Error spike > 10/min | Critical | Dashboard red + email |
| Version >1 release behind for >7 days | Warning | Dashboard yellow + email |
| Schema migration pending >24h | Warning | Email |

---

## 6. Secure Update Pipeline

### Build flow (GitHub Actions)
1. `git push main` → Run tests → Build Docker image (same multi-stage Dockerfile)
2. Sign image with **Cosign** (keyless OIDC)
3. Push to GitHub Container Registry (`ghcr.io/gwipos/pos:{version}`)
4. Generate SBOM → Notify Mothership API

### Mothership-controlled rollout (replaces Watchtower auto-pull)
1. Admin sees new version on dashboard
2. Selects rollout strategy: **Canary** (1 location, monitor 24h) / **Rolling** (sequential with gaps) / **Immediate**
3. Mothership issues `force_update` command via SSE with `imageTag`, `imageDigest`, `signatureRef`, `rollbackVersion`
4. Local Sync Agent: verify Cosign signature → pull image → graceful stop → start new → health check
5. If health check fails within rollback window → auto-rollback to previous version
6. ACK result to cloud

### Watchtower in production
`WATCHTOWER_POLL_INTERVAL=0` (disabled). Sync Agent triggers Watchtower via local HTTP API (`127.0.0.1:8080`) only when Mothership commands it.

---

## 7. Threat Model

| # | Attack | Mitigation |
|---|--------|-----------|
| T1 | Stolen/cloned disk image | Hardware fingerprint bound to physical hardware. Clone fails fingerprint check on heartbeat. |
| T2 | Man-in-the-middle on sync | HTTPS + HMAC body signing. Even with compromised CA, HMAC prevents tampering. RSA key exchange at registration. |
| T3 | Compromised serverApiKey | Rotatable from Mothership via `revoke_credential` command. New key encrypted with server's RSA public key. |
| T4 | Unauthorized server registration | One-time tokens, 24h expiry, admin-generated, audit logged. |
| T5 | Insider admin abuse | All actions in `FleetAuditLog`. MFA required. Role-based access. Kill switch requires owner role. |
| T6 | Command replay attack | Unique command IDs + `Last-Event-ID` tracking + `expiresAt` on stale commands. |
| T7 | License cache tampering | HMAC-signed by cloud. Invalid signature = treated as missing. |
| T8 | Malicious Docker image push | Cosign-signed images. Sync Agent verifies signature before applying. Auto-rollback on failed health check. |
| T9 | Cross-tenant data leak | Postgres Schema isolation + RLS policy (two-layer defense). Server API keys scoped to single location. Clerk org-scoped sessions. |
| T10 | SSE connection hijacking | Bearer token auth on every reconnect. HTTPS only. Outbound-initiated by server. |
| T11 | Merchant swaps payment processor | POS has no processor settings UI. Credentials are cloud-pushed, read-only locally. Sync Agent overwrites tampering on 60s heartbeat. |
| T12 | Merchant edits DB to change Datacap creds | Sync Agent detects mismatch on heartbeat, re-pushes cloud values. Hardware fingerprint prevents running modified POS on cloned disk. |
| T13 | Merchant brings own card reader | Reader requires `secureDeviceId` registered in cloud config. Unregistered readers can't process. |
| T14 | Merchant requests Datacap creds directly | Credentials are under GWI's master Datacap account. Datacap won't issue to sub-merchants directly. |

---

## 8. API Surface

### Fleet API (server-to-cloud, authenticated by serverApiKey + HMAC)
```
POST /api/fleet/register            — One-time server registration
POST /api/fleet/heartbeat           — 60-second heartbeat
POST /api/fleet/health-report       — 5-minute health data
POST /api/fleet/sync/upload         — Batch data sync (local → cloud)
POST /api/fleet/sync/download       — Batch data pull (cloud → local)
POST /api/fleet/license/validate    — License check (boot + periodic)
POST /api/fleet/errors/report       — Error log forwarding
GET  /api/fleet/commands/stream     — SSE command stream (long-lived)
POST /api/fleet/commands/{id}/ack   — Command acknowledgment
```

### Wildcard Subdomain Routing (Online Ordering)

Every location gets an automatic vanity URL for online ordering:

**DNS**: Wildcard CNAME `*.gwipos.com` → Vercel

**Next.js Edge Middleware flow:**
1. Customer visits `downtown-burger.gwipos.com`
2. Middleware extracts subdomain `downtown-burger`
3. Looks up `CloudLocation` in global schema by slug → gets `locationId: 105`
4. Rewrites request to `/stores/105/home` (customer still sees `downtown-burger.gwipos.com`)
5. Injects `X-Tenant-Id: 105` header into request context
6. All subsequent API calls scoped to that location

Custom domains also supported: `order.downtownburger.com` → CNAME to `downtown-burger.gwipos.com`

### Admin Authentication (Clerk B2B Organizations)

Instead of rolling custom auth, the Mothership uses **Clerk B2B** for admin authentication:

**Role-Based Access Control:**
| Role | Scope | Examples |
|------|-------|---------|
| **Super Admin** | All organizations | You (GWI owner) |
| **Org Admin** | Their organization(s) only | Franchisee managing 5 locations |
| **Location Manager** | Specific location(s) only | GM of one restaurant |

**Enforcement**: API middleware validates `User.orgId == Resource.orgId` on every request. Clerk's Organizations feature handles org membership, invitations, and session scoping natively.

**Why Clerk over custom auth:**
- TOTP/MFA built-in (no custom implementation)
- Organization-scoped sessions (native multi-tenancy)
- Passwordless options (magic link, SSO)
- Audit log of all auth events
- SOC 2 compliant

### Admin API (admin console, authenticated by Clerk B2B + org-scoped JWT)
```
CRUD /api/admin/organizations       — Org management
CRUD /api/admin/locations           — Location management
POST /api/admin/locations/{id}/provision    — Generate registration token
POST /api/admin/locations/{id}/commands     — Issue command to server
GET  /api/admin/locations/{id}/sync-status  — Sync health
GET  /api/admin/locations/{id}/heartbeats   — Recent heartbeats
GET  /api/admin/servers/fleet-status        — All servers overview
POST /api/admin/servers/{id}/kill           — Kill switch
POST /api/admin/servers/{id}/revive         — Revive killed server
POST /api/admin/updates/push               — Push update to servers
GET  /api/admin/audit-log                  — Filtered audit log
POST /api/admin/auth/login                 — Email + password
POST /api/admin/auth/mfa/verify            — TOTP verification
```

---

## 9. Local Server Changes (Minimal)

Module A requires **zero changes to the POS application code**. All cloud communication is handled by the new Sync Agent sidecar:

1. **New Docker sidecar container**: `sync-agent` — lightweight Node.js service
   - Handles heartbeat, sync, SSE command listening, license validation
   - Reads POS database directly (read-only for sync queries)
   - Communicates with POS via internal Docker network only

2. **Enhanced `/api/health`** — Add fields for the Sync Agent to forward:
   - `activeOrderCount` — open orders right now
   - `dbSizeMb` — database file/tablespace size
   - `diskUsage` — percent used on data partition
   - `schemaVersion` — current Prisma migration hash (e.g., `20260211_add_tip_bank`)
   - `migrationPending` — boolean, true if the running schema is behind the deployed code's migrations

3. **New env vars in `docker-compose.yml`** (extending existing lines 30-40):
   ```
   SERVER_NODE_ID=${SERVER_NODE_ID}
   ```

4. **License check middleware** (optional, Phase 2B) — Checks local license cache file on boot. If expired + grace exhausted → read-only mode.

---

## 10. Implementation Phases

### Phase 2A: Foundation (Weeks 1-3)
- Create separate cloud Next.js project with Neon PostgreSQL
- Cloud Prisma schema (all models above)
- `POST /api/fleet/register` — server registration endpoint
- `POST /api/fleet/heartbeat` — heartbeat ingestion
- `POST /api/fleet/license/validate` — license validation
- Provisioning script for Ubuntu servers
- Basic fleet dashboard (status cards, online/offline)

### Phase 2B: Communication (Weeks 4-6)
- SSE command stream (`GET /api/fleet/commands/stream`)
- Sync Agent Docker sidecar (heartbeat client, SSE listener, command ACK)
- Command issuance from admin UI (force sync, kill switch, diagnostics)
- License cache + grace period logic on local server
- Alerting rules + email/SMS notifications

### Phase 2C: Data Sync (Weeks 7-10)
- `POST /api/fleet/sync/upload` with batch processing + conflict resolution
- Implement `syncedAt` watermark tracking in Sync Agent
- Sync Agent enforces `maxRecordsPerBatch` (default 500) — chunks large backlogs locally before upload
- LWW conflict resolution with field-level merge
- Sync health monitoring on dashboard
- Error report forwarding

### Phase 2D: Updates & Licensing (Weeks 11-13)
- GitHub Actions CI/CD with Cosign image signing
- Mothership-controlled update pipeline (canary/rolling/immediate)
- Rollback mechanism
- License management admin UI
- Stripe billing integration

---

## Verification

1. **Registration**: Generate token in Mothership → run provisioning script on fresh Ubuntu → verify server appears on dashboard as "online"
2. **Heartbeat**: Stop POS container on a server → verify dashboard shows "offline" within 2 minutes
3. **Commands**: Issue `request_diagnostic` from dashboard → verify response arrives within 10 seconds
4. **License**: Suspend a location's license → verify POS shows warning banner → expire grace → verify read-only mode
5. **Kill switch**: Kill a server from dashboard → verify POS locks out → revive → verify POS resumes
6. **Update**: Push a version update to one location (canary) → verify it pulls, restarts, health checks, and ACKs
7. **Sync**: Create orders on local POS offline → reconnect → verify data syncs to cloud within 5 minutes
8. **Security**: Clone a server's disk to new hardware → verify registration fails (hardware fingerprint mismatch)

---

## 11. Standard Hardware Kit (Per Location)

Every location ships with a standard kit. The Mothership must support and monitor these specific devices.

### The Server (The Brain)
- **Intel NUC** (or equivalent mini PC) running Ubuntu 22.04 LTS
- LUKS full-disk encryption
- Docker + Docker Compose pre-installed
- Connected to Ubiquiti network

### The Stations (The Interface)
- Touch-screen POS terminals (browser-based, connect to NUC via LAN)
- iPads/tablets via PWA (WiFi)
- KDS screens (browser-based, device-paired)

### The Printers
- **Thermal receipt printers** (Epson TM-T88 or compatible) — ESC/POS protocol over TCP
- **Impact kitchen printers** (Epson TM-U220) — two-color (red ribbon) support
- Connected via Ethernet to local network

### The Network (The Backbone)
- **Ubiquiti** managed network (UniFi gateway + switches + APs)
- VLANs for POS traffic isolation
- Static IPs for printers and KDS devices (optional IP binding for security)

### Payment Terminals
- **Datacap** integrated card readers
- EMV chip + contactless (tap) support
- Local-first communication (reader ↔ NUC ↔ Datacap cloud)
- Secure Device IDs managed in Mothership hardware UI

---

## 12. Deliverables Checklist

Sign-off items before Module A is considered complete:

| # | Deliverable | Status |
|---|------------|--------|
| 1 | **Multi-Tenant DB**: Proof of strict data isolation (Schemas + RLS) | ⬜ |
| 2 | **Server Registration**: Provisioning script + one-time token flow + hardware fingerprint | ⬜ |
| 3 | **Fleet Dashboard**: Live view of all NUCs (Online/Degraded/Offline status) | ⬜ |
| 4 | **Heartbeat Ingestion**: 60-second heartbeats with CPU/RAM/disk/orders | ⬜ |
| 5 | **License Enforcement**: Validate → cache → grace period → read-only degradation | ⬜ |
| 6 | **Kill Switch**: Remote kill + branded banner + revive from dashboard | ⬜ |
| 7 | **SSE Command Stream**: Bidirectional communication with ACK pipeline | ⬜ |
| 8 | **Sync Agent Sidecar**: Docker container with heartbeat/sync/SSE/license | ⬜ |
| 9 | **Wildcard Routing**: `demo.gwipos.com` automatically loads Demo Store | ⬜ |
| 10 | **Hardware Mgmt UI**: Screen to input Secure Device IDs for Datacap readers | ⬜ |
| 11 | **Deployment Script**: Bash script to provision a blank NUC from USB stick | ⬜ |
| 12 | **Update Pipeline**: Cosign-signed images + canary/rolling rollout + auto-rollback | ⬜ |
| 13 | **Audit Log**: Every admin action logged with actor, resource, timestamp, IP | ⬜ |
| 14 | **Alerting**: Email + SMS for critical conditions (offline, disk, license) | ⬜ |
| 15 | **Payment Processing Lockdown**: Cloud-only Datacap credentials, no local override | ⬜ |
| 16 | **Hardware Limits**: Subscription tier enforcement for terminals/readers/KDS | ⬜ |
| 17 | **Billing & Fee Structure**: Processing rates, platform fees, revenue tracking | ⬜ |

---

## 13. Payment Processing Control (PayFac Model)

### Core Principle: GWI Owns the Processing Relationship

**Merchants CANNOT use outside payment processors or bring their own Datacap credentials.** All payment processing flows through GWI's master Datacap account. Each location is a sub-merchant under GWI's umbrella.

This is the same model as Toast, Square, and Clover — the POS company controls the processing relationship.

### Why This Matters

| Benefit | Details |
|---------|---------|
| **Revenue lock-in** | Processing fees are your primary recurring revenue stream |
| **No circumvention** | Merchant can't swap in a cheaper processor and keep using the POS |
| **Unified reporting** | All transaction data flows through your systems |
| **Chargeback control** | You manage disputes centrally |
| **Compliance** | PCI scope is yours, not fragmented across merchants |

### How It Works

#### Cloud Side (Mission Control)

1. **GWI Super Admin** creates location and enters Datacap sub-merchant credentials:
   - `datacapMerchantId` — assigned by Datacap under GWI's master account
   - `datacapOperatorId` — GWI-controlled
   - Per-reader `secureDeviceId` — one per physical card reader at the location
   - `processingRatePercent` — the rate this location pays (e.g., 4.0%)
   - `perTransactionFeeCents` — per-swipe fee (e.g., 10 cents)

2. These credentials are **encrypted at rest** in the cloud database (AES-256-GCM, key in environment variable, never in code).

3. On provisioning or credential update, the cloud sends an `update_payment_config` SSE command to the Sync Agent.

#### Sync Agent Side

4. Sync Agent receives the encrypted credential payload.
5. Decrypts using the server's RSA private key (same key exchange pattern as registration).
6. Writes to `/etc/gwi-pos/payment-config.json` (root-only, 0600 permissions, LUKS disk).
7. POS application reads this file at boot and on config change events.

#### POS Side (Enforcement)

8. **The POS has NO settings UI for Datacap credentials.** The `merchantId`, `operatorId`, and `secureDeviceId` fields are **read-only** in the local settings — they come from the cloud and cannot be changed locally.

9. **Hardcoded processor check**: The POS validates on boot that `settings.payments.processor === 'datacap'` and that credentials match the cloud-provided values. If tampered with (e.g., someone edits the DB directly), the Sync Agent detects the mismatch on next heartbeat and re-pushes the correct values.

10. **No "simulated" mode in production**: The `SIMULATED_DEFAULTS` code path is completely removed in production builds. There is no fallback to simulated processing.

### Credential Rotation

When Datacap issues new credentials (e.g., after a security incident):
1. Super Admin updates credentials in Mission Control
2. `update_payment_config` command pushed to all affected locations via SSE
3. Each Sync Agent decrypts, writes new config, notifies POS
4. POS hot-reloads credentials — no restart needed
5. Audit log records the rotation with timestamp and admin who initiated

### Per-Reader Management

Each physical card reader at a location is registered in Mission Control:

```
CloudLocation.PaymentConfig.readerConfigs[]
├── readerId (matches local PaymentReader.id)
├── secureDeviceId (Datacap device identifier)
├── readerModel (e.g., "Ingenico Lane 3000")
├── serialNumber (physical device serial)
├── status (active|disabled|replaced)
├── assignedTerminal (which POS terminal this reader is bound to)
└── lastTransactionAt (from heartbeat data)
```

**Adding a new reader**: Admin adds reader in Mission Control → credentials pushed to location → reader is immediately available on the assigned terminal.

**Disabling a reader**: Admin disables in Mission Control → `disable_reader` command pushed → POS removes reader from available list. The reader physically can't process because the `secureDeviceId` is revoked cloud-side.

### Threat: Merchant Tries to Bypass

| Bypass Attempt | Prevention |
|----------------|------------|
| Edit DB to change merchantId | Sync Agent overwrites on next heartbeat (60s) |
| Use a different POS | They can't — the NUC runs our Docker image, no other POS installed |
| Clone the disk, run modified POS | Hardware fingerprint check fails |
| Intercept Datacap traffic | Credentials are never in POS source code, only in encrypted config file |
| Install their own card reader | Reader won't process without a matching `secureDeviceId` in cloud config |
| Ask Datacap directly for credentials | Datacap credentials are under GWI's master account, not the merchant's |

---

## 14. Hardware Limits & Subscription Tiers

### Subscription Tiers

Each location has a subscription tier that controls what hardware and features are available:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SUBSCRIPTION TIERS                             │
├─────────────┬──────────────┬──────────────┬─────────────────────┤
│             │   STARTER    │     PRO      │    ENTERPRISE       │
├─────────────┼──────────────┼──────────────┼─────────────────────┤
│ POS Terms   │      2       │      5       │    Unlimited        │
│ Handhelds   │      0       │      3       │    Unlimited        │
│ KDS Screens │      1       │      4       │    Unlimited        │
│ Printers    │      2       │      6       │    Unlimited        │
│ Card Readers│      1       │      3       │    Unlimited        │
├─────────────┼──────────────┼──────────────┼─────────────────────┤
│ Online Order│      ❌       │      ✅       │       ✅             │
│ Bottle Svc  │      ❌       │      ✅       │       ✅             │
│ Scheduling  │      ❌       │      ✅       │       ✅             │
│ Multi-Floor │      ❌       │      ❌       │       ✅             │
│ API Access  │      ❌       │      ❌       │       ✅             │
│ White Label │      ❌       │      ❌       │       ✅             │
└─────────────┴──────────────┴──────────────┴─────────────────────┘
```

### Enforcement Model

Limits are enforced at **two levels**:

#### Level 1: Cloud-Side (Hard Block)
When a venue tries to pair a new device (KDS, reader, terminal), the pairing API checks the cloud license:
```
POST /api/fleet/license/check-device-limit
{
  "locationId": "loc-123",
  "deviceType": "kds_screen",
  "currentCount": 4
}

Response (over limit):
{
  "allowed": false,
  "limit": 4,
  "current": 4,
  "tier": "pro",
  "upgradeUrl": "https://gwipos.com/upgrade"
}
```

#### Level 2: Local Enforcement (Sync Agent Cache)
The Sync Agent caches the subscription limits locally so enforcement works offline:
```json
{
  "tier": "pro",
  "limits": {
    "maxPOSTerminals": 5,
    "maxHandhelds": 3,
    "maxKDSScreens": 4,
    "maxPrinters": 6,
    "maxPaymentReaders": 3
  },
  "features": {
    "onlineOrdering": true,
    "bottleService": true,
    "scheduling": true,
    "multiFloor": false,
    "apiAccess": false,
    "whiteLabel": false
  }
}
```

POS checks this cache before allowing device pairing. If the cache is stale (>24h), pairing is **still allowed** but flagged for cloud verification on next sync (grace — don't block a venue mid-rush because the internet is down).

#### Feature Gating

Features not included in the tier are **hidden from the UI entirely** (not grayed out):
- Starter tier: No "Online Ordering" in settings nav, no "Bottle Service" in tab creation, no "Scheduling" in admin
- Pro tier: No "Multi-Floor" option in floor plan editor, no "API Access" in settings
- Enterprise: Everything visible

The POS reads `features` from the Sync Agent status API and conditionally renders UI sections.

### Tier Changes

**Upgrade**: Immediate. Cloud pushes new limits via `update_config` SSE command. Sync Agent updates cache. New devices can be paired instantly.

**Downgrade**: Graceful. If a Pro location (5 terminals) downgrades to Starter (2 terminals), existing devices **continue working** but no new ones can be added. A warning banner shows: "Your plan supports 2 terminals. You have 5 active. Please remove 3 or upgrade." After 30-day grace, excess devices are soft-disabled.

---

## 15. Revenue & Fee Structure

### How GWI Makes Money

Three revenue streams per location:

#### 1. Monthly Platform Subscription
Fixed monthly fee based on tier:

| Tier | Monthly Fee | Notes |
|------|------------|-------|
| Starter | $99/mo | Small bars, food trucks |
| Pro | $199/mo | Full-service restaurants |
| Enterprise | $399/mo | Multi-floor, high volume |

Billed via Stripe. Cancellation = 30-day grace → license suspension → read-only mode → kill switch.

#### 2. Payment Processing Fee
GWI takes a percentage of every card transaction:

```
Customer pays $100 on card
├── Interchange + Datacap fee: ~2.6% + $0.10 = $2.70 (goes to card network/Datacap)
├── GWI processing markup: 1.4% = $1.40 (goes to GWI)
├── Total merchant rate: 4.0% + $0.10 = $4.10
└── Merchant receives: $95.90
```

**Per-location rate is configurable** in Mission Control:
- `processingRatePercent` — total rate the merchant sees (e.g., 4.0%)
- `perTransactionFeeCents` — flat per-swipe fee (e.g., 10 cents)
- GWI's margin = `processingRatePercent` minus interchange/Datacap pass-through costs

**Volume discounts**: Enterprise locations or multi-location orgs can negotiate lower rates. Set per-location in Mission Control.

#### 3. Revenue Share (Optional)
For locations where GWI provides additional services (menu consulting, marketing):
- `revenueSharePercent` — % of gross sales (e.g., 1-2%)
- Calculated from synced order data
- Billed monthly alongside subscription

### Transaction Tracking

Every payment processed locally is synced to the cloud with:
```
TransactionSummary (synced per batch)
├── transactionId, orderId
├── grossAmount, tipAmount, taxAmount
├── processingFee (merchant's rate applied)
├── gwiMargin (GWI's cut of processing fee)
├── interchangeEstimate (pass-through cost estimate)
├── paymentMethod (card_present, card_not_present, contactless)
├── cardBrand (visa, mastercard, amex, discover)
├── readerSerialNumber
├── processedAt
└── settledAt (from Datacap batch close)
```

### Billing Dashboard (Mission Control)

Super Admin sees:
```
┌──────────────────────────────────────────────────────────────┐
│  REVENUE DASHBOARD — February 2026                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Subscriptions:     $14,850/mo  (75 locations)               │
│  Processing Margin: $47,230     (1.4% avg on $3.37M volume)  │
│  Revenue Share:     $2,140      (2 locations w/ rev share)   │
│  ─────────────────────────────────────────────────────────   │
│  Total MRR:         $64,220                                  │
│                                                              │
│  Per Location Avg:  $856/mo                                  │
│  Processing Volume: $3,373,571                               │
│  Transactions:      89,247                                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Location owner sees (in their limited dashboard):
```
┌──────────────────────────────────────────────────────────────┐
│  YOUR PROCESSING — February 2026                              │
├──────────────────────────────────────────────────────────────┤
│  Card Sales:        $44,980                                  │
│  Processing Fees:   $1,809.20  (4.0% + $0.10/txn)           │
│  Net Deposits:      $43,170.80                               │
│  Transactions:      1,192                                    │
│  Avg Ticket:        $37.73                                   │
└──────────────────────────────────────────────────────────────┘
```

### Late Payment / Suspension Flow

```
Day 1:  Stripe charge fails → Retry automatically (3 attempts over 5 days)
Day 5:  All retries failed → Email: "Payment failed, update card"
Day 14: Grace period → Warning banner on POS: "Payment past due"
Day 30: License suspended → POS enters read-only mode
Day 45: Kill switch → POS locked out, branded support banner
```

Processing fees are deducted daily from the merchant's Datacap settlement (not billed separately). This means GWI always gets paid on processing — it comes off the top before the merchant sees their deposit.

---

## Appendix A: POS ↔ Sync Agent Local Contract

The POS application **never** calls the Mothership directly. It reads cloud-pushed state from the Sync Agent's internal HTTP API on the Docker bridge network.

### Sync Agent Internal API (port 8081, Docker-internal only)

```
GET http://sync-agent:8081/status
```

**Response:**
```json
{
  "licenseStatus": "active",
  "licenseExpiresAt": "2027-01-15T00:00:00Z",
  "gracePeriodDays": 14,
  "isKilled": false,
  "killBanner": null,
  "lastSyncAt": "2026-02-11T14:32:00Z",
  "syncStatus": "ok",
  "cloudReachable": true,
  "currentVersion": "2.1.0",
  "targetVersion": "2.1.0",
  "pendingCommands": 0,
  "paymentConfig": {
    "processor": "datacap",
    "merchantId": "GWI_SUB_00105",
    "operatorId": "OPR_105_001",
    "secureDeviceIds": ["DID_AAA111", "DID_BBB222"],
    "processingRate": 4.0,
    "lastRotatedAt": "2026-02-01T00:00:00Z"
  },
  "subscriptionLimits": {
    "tier": "pro",
    "maxTerminals": 8,
    "maxHandhelds": 4,
    "maxKdsScreens": 4,
    "maxPrinters": 6,
    "maxReaders": 4,
    "features": ["online_ordering", "bottle_service", "scheduling", "multi_floor"]
  }
}
```

**POS consumption pattern:**
- POS caches this response **in memory** (Zustand or module-level variable)
- Re-fetches on a **60-second timer** (not on every request)
- If fetch fails (Sync Agent down), POS uses last known good state — does NOT flip to read-only on a single failure
- License middleware (Phase 2B) reads from this in-memory cache, never hits filesystem or network on the hot path

### Port exposure

| Port | Exposed to | Purpose |
|------|-----------|---------|
| 8081 | Docker bridge only (`gwi-network`) | Sync Agent status API for POS |
| 3000 | Host + LAN | POS web application |
| None inbound from internet | — | Zero attack surface |

---

## Appendix B: Command Execution Guarantees (Expanded)

### Processing model

The Sync Agent runs a **single-threaded command worker** — one command at a time, in delivery order.

```
SSE Stream → Command Queue (FIFO) → Worker → Execute → ACK → Next
```

### Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| **At-most-once execution** | `lastProcessedCommandId` persisted to disk. Duplicates ignored on SSE replay. |
| **In-order delivery** | SSE `Last-Event-ID` + server-side ordering by `createdAt`. Worker processes FIFO. |
| **Expiry protection** | Every `FleetCommand` has `expiresAt`. Stale commands ACK'd as `expired`, not executed. |
| **No parallel execution** | Worker dequeues one command, executes fully, ACKs, then dequeues next. |
| **Crash recovery** | On restart, Sync Agent reconnects SSE with `Last-Event-ID`, replays from last ACK'd command. |

### ACK statuses

| Status | Meaning |
|--------|---------|
| `acknowledged` | Command received, starting execution |
| `completed` | Execution succeeded |
| `failed` | Execution failed (includes error details in payload) |
| `expired` | Command arrived after `expiresAt` — skipped |

### Command priority

Commands execute in FIFO order, but `kill_switch` and `revoke_credential` are **always inserted at the front** of the queue (preemptive priority).

---

## Appendix C: Operational Defaults

Reference table of all configurable intervals, limits, and thresholds with their default values.

### Heartbeat & Health

| Parameter | Default | Configurable? | Notes |
|-----------|---------|--------------|-------|
| Heartbeat interval | 60s | Yes (env var) | `HEARTBEAT_INTERVAL_MS=60000` |
| Health report interval | 5min | Yes (env var) | `HEALTH_REPORT_INTERVAL_MS=300000` |
| Degraded threshold | 2 missed heartbeats | Cloud-side config | Dashboard turns yellow |
| Offline threshold | 5 missed heartbeats | Cloud-side config | Dashboard turns red, email fires |
| Emergency threshold | 15 missed heartbeats | Cloud-side config | SMS fires |

### SSE & Reconnect

| Parameter | Default | Notes |
|-----------|---------|-------|
| Initial backoff | 1s | After first disconnect |
| Max backoff | 60s | Cap for exponential growth |
| Backoff multiplier | 2x | Doubles each attempt |
| Jitter | ±30% | Random offset to prevent thundering herd |
| License revalidation on reconnect | If last check >5min | Ensures license state is fresh |

### Sync

| Parameter | Default | Notes |
|-----------|---------|-------|
| Sync interval (online) | 5min | Normal operating cadence |
| Sync interval (recovery) | 30s | After reconnect, until backlog cleared |
| Max records per batch | 500 | Sync Agent chunks locally before upload |
| Sync priority | Orders P1 → TimeClock P2 → Customers P3 → Inventory P4 → Menu P5 → Settings P6 | Matches existing OFFLINE-SYNC-ALGORITHM.md |
| Conflict resolution | LWW with field-level merge | Financial records: local wins. Reference data: cloud wins. |

### License & Grace

| Parameter | Default | Notes |
|-----------|---------|-------|
| Grace period | 14 days | Per-location, configurable in Mothership |
| License check (boot) | Immediate | Blocks startup until response or cache checked |
| License check (periodic) | 60s timer | POS re-reads from Sync Agent status API |
| Cache location | `/etc/gwi-pos/license-cache.json` | HMAC-signed by cloud |
| In-memory TTL | 60s | POS module-level cache, re-fetched on timer |

### Registration & Security

| Parameter | Default | Notes |
|-----------|---------|-------|
| Registration token expiry | 24 hours | One-time use |
| RSA key size | 4096 bits | Generated on server during provisioning |
| Server API key length | 64-char hex (256 bits) | Mirrors KDS `deviceToken` pattern |
| Hardware fingerprint version | 1 | `fingerprintVersion` field for future formula updates |

### Updates

| Parameter | Default | Notes |
|-----------|---------|-------|
| Rollback window | 5min | Auto-rollback if health check fails within window |
| Health check after update | 3 attempts, 10s apart | Must pass all 3 to confirm successful update |
| Watchtower poll interval | 0 (disabled) | Sync Agent triggers via local API on command |

### Alerting

| Parameter | Default | Notes |
|-----------|---------|-------|
| Version drift alert | >1 release behind for >7 days | Warning severity |
| Schema migration pending | >24 hours | Warning severity |
| Disk warning | >85% | Dashboard yellow |
| Disk critical | >95% | Email + SMS |
| Error spike | >10 errors/min | Dashboard red + email |
| License expiry warning | <30 days remaining | Email |

### Payment Processing (PayFac)

| Parameter | Default | Notes |
|-----------|---------|-------|
| Credential encryption | AES-256-GCM | At rest in cloud DB |
| Credential delivery | RSA-encrypted via SSE | `update_payment_config` command |
| Credential rotation | Manual (admin-initiated) | Mothership → SSE push → Sync Agent decrypts |
| Tamper check interval | 60s (heartbeat) | Sync Agent overwrites local DB if mismatch |
| Unregistered reader block | Immediate | POS rejects any reader not in `secureDeviceIds` |
| Processing rate field | Per-location | Set in Mothership, read-only on POS |

### Subscription & Hardware Limits

| Parameter | Default (Starter) | Default (Pro) | Default (Enterprise) | Notes |
|-----------|-------------------|---------------|---------------------|-------|
| Max terminals | 2 | 8 | Unlimited | Cloud-enforced on pairing API |
| Max handhelds | 0 | 4 | Unlimited | Cloud-enforced on pairing API |
| Max KDS screens | 2 | 4 | Unlimited | Cloud-enforced on pairing API |
| Max printers | 2 | 6 | Unlimited | Cloud-enforced on pairing API |
| Max payment readers | 1 | 4 | Unlimited | Cloud-enforced on pairing API |
| Limit cache TTL | 24h | 24h | 24h | Sync Agent local cache for offline grace |
| Downgrade grace period | 30 days | 30 days | 30 days | Soft-disable excess devices |
| Upgrade activation | Immediate | Immediate | Immediate | New limits pushed via SSE |

### Billing & Late Payment

| Parameter | Default | Notes |
|-----------|---------|-------|
| Stripe retry (failed payment) | Day 1, 3, 5 | Automatic retry |
| Email warning | Day 5 | "Payment failed" notification |
| Dashboard warning banner | Day 14 | Yellow banner on POS |
| Read-only mode | Day 30 | Orders blocked, viewing only |
| Kill switch | Day 45 | Full lockout with support banner |
| Processing fee deduction | From settlement | GWI paid off the top, not billed separately |
