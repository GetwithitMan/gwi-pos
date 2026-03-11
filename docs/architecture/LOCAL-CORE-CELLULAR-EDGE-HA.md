# Local-Core / Cellular-Edge HA Architecture

**Version:** 2.0
**Updated:** March 9, 2026
**Status:** Implementation in progress (Phases 1–6)
**Scope:** Cloud-primary HA with local NUC execution layer, cellular edge for roaming devices, fulfillment routing

---

## Executive Summary

GWI POS is a cloud-primary architecture: Neon is the canonical source of truth in normal operation, with an on-site NUC as the local execution and continuity layer. The NUC serves LAN devices, drives all hardware, and temporarily becomes the write authority during internet outages. This design extends the architecture with these capabilities:

1. **Backup NUC + HA Failover (Phase 1):** A second NUC at each venue runs as a hot standby via PostgreSQL streaming replication. keepalived manages a Virtual IP (VIP). If the primary NUC goes down, the backup promotes in ≤10 seconds with zero data loss for committed transactions.

2. **Cellular Edge Path (Phase 2):** Roaming Android devices (poolside servers, event floors) connect via cellular data through the cloud, which relays operations to the venue NUC. These devices have restricted permissions (no refunds, no tip adjustments) and are authenticated with a dedicated 6-gate model.

3. **Fulfillment Routing (Phase 3):** Item-level routing engine that resolves each menu item to its correct kitchen/bar/prep station at send time. Supports cloud-originated orders arriving via the cellular path. Uses send-time snapshots so menu edits never retroactively change routing.

**Phases 4–5** formalize disaster recovery (automated backups, Neon-assisted recovery) and observability (Mission Control dashboard, on-device health indicators, alerting).

4. **Cloud-Primary Architecture Transition (Phase 6):** Unified migration system, durable fulfillment queue (FulfillmentEvent), outage detection and replay (OutageQueueEntry), bridge checkpoint failover (BridgeCheckpoint), and ID unification across cloud and local systems.

---

## Architecture Decisions

| # | Decision | Rationale | Alternative Rejected |
|---|----------|-----------|---------------------|
| AD-1 | **PostgreSQL streaming replication** for HA, not application-level sync | Sub-second lag, zero-effort schema compat, proven technology | Bi-directional app sync (conflict resolution nightmare) |
| AD-2 | **keepalived + VIP** for automatic failover | No external dependencies, works on LAN, sub-10s failover | Patroni (overkill for 2-node), manual failover (too slow) |
| AD-3 | **Fencing check before promotion** | Prevents split-brain — backup queries old primary before promoting | Timer-only (risk of two primaries) |
| AD-4 | **Cloud-relayed cellular**, not direct NUC-to-device over cellular | NUC has no public IP; cloud relay is the only viable path | VPN tunnel (complex, fragile), port forwarding (security risk) |
| AD-5 | **Allowlist-only proxy.ts gate** for cellular routes | Explicit security surface, deny-by-default for roaming devices | Deny list (too easy to miss new routes) |
| AD-6 | **`lastMutatedBy` column** for ownership tracking | Cheap, queryable, sync-friendly. Prevents upstream/downstream loops. | Separate origin tables (over-engineering) |
| AD-7 | **Event-sourced cart outbox** for cellular orders | Durable delivery from cloud to NUC; SSE wake-up + periodic sync | Direct HTTP relay (lost if NUC offline), WebSocket tunnel (stateful) |
| AD-8 | **Send-time snapshot** for fulfillment routing | Menu changes don't retroactively reroute in-flight orders | Dynamic resolution (race conditions, phantom re-prints) |
| AD-9 | **FulfillmentEvent as sole async queue** | One model for all hardware side effects; no queue proliferation | Per-station queues (operational complexity) |
| AD-10 | **6-gate device registration** for cellular auth | Defense in depth — no single token compromises system | Simple API key (revocation is all-or-nothing) |

---

## Critical Invariants

These MUST hold at all times. Violation of any invariant is a P0 bug.

> **INV-1 — Single Writer:** At any instant, exactly one NUC holds the VIP and accepts writes. The backup's PostgreSQL is in recovery mode and rejects all write attempts. There is never a window where two NUCs accept writes simultaneously.

> **INV-2 — Neon Warm Recovery:** If both NUCs are destroyed, a replacement NUC can restore from Neon (cloud PostgreSQL) within the RPO window. Neon is never stale by more than the upstream sync interval (currently 5 seconds).

> **INV-3 — Cloud-Originated Ownership:** Orders created via the cellular path carry `lastMutatedBy = 'cloud'`. Once a LAN device mutates the order, ownership flips to `'local'` and the order stops syncing downstream. The cloud never overwrites a locally-mutated order.

> **INV-4 — Event-Sourced Carts:** Cellular cart mutations are written to Neon as an outbox. The sync agent delivers them to the NUC via durable downstream sync. SSE wake-up provides low-latency delivery; periodic sync (15s) provides guaranteed delivery. Missed SSE events cause latency, never data loss.

> **INV-5 — Proxy Gate:** `proxy.ts` is the sole gating dependency for cellular features. Every cellular request passes through the proxy's allowlist. Routes not on the allowlist return 403. There is no bypass path.

> **INV-6 — Standby Sync Prohibition:** The standby NUC NEVER runs sync workers (upstream or downstream). It receives data solely via PostgreSQL streaming replication from the primary. Running sync on the standby would create write conflicts.

> **INV-7 — Fulfillment Non-Blocking:** Fulfillment routing NEVER blocks order writes. The router runs AFTER the order write succeeds. A fulfillment failure (printer offline, station unreachable) does not roll back the order.

> **INV-8 — Fulfillment Cache Usage:** The fulfillment router uses existing menu caches for MenuItem lookup. It NEVER issues fresh database queries on the send path. Cache misses fall back to the venue's primary kitchen station.

> **INV-9 — FulfillmentEvent Sole Queue:** FulfillmentEvent is the only asynchronous hardware queue in the system. No second queueing model may be created for kitchen tickets, bar prints, or KDS updates. All hardware side effects flow through FulfillmentEvent.

> **INV-10 — Cellular Allowlist-Only:** Cellular-authenticated devices may ONLY access routes on the explicit allowlist. All admin routes, settings, reports, shift operations, refunds, and tip adjustments are permanently blocked for `CELLULAR_ROAMING` terminals.

> **INV-11 — VIP Connectivity:** Android devices connect to the Virtual IP, not to individual NUC IPs. Failover is transparent to the device — the VIP simply starts responding from the backup NUC. Direct backup IP is used only as a fallback when VIP is unreachable.

> **INV-12 — Neon is Canonical SOR:** In normal operation, Neon is the source of truth. NUC writes replicate upstream via the 5-second sync interval. During an internet outage, the NUC temporarily becomes the write authority, queueing writes in `OutageQueueEntry`. On recovery, the outage queue replays FIFO with `neon-wins` conflict resolution. Cloud-originated data always takes precedence on timestamp ties.

> **INV-13 — FulfillmentEvent is the Durable Hardware Queue:** All hardware dispatch (kitchen prints, bar prints, KDS updates, drawer kicks) goes through the `FulfillmentEvent` model. The bridge worker claims and executes events via optimistic locking. Fire-and-forget dispatch via Socket.IO is preserved for backward compatibility only — `FulfillmentEvent` is the durable, retryable, dead-letterable path.

---

## System Topology

```
                        ┌──────────────────────────────────────────────────┐
                        │              CLOUD (Neon + MC + Vercel)          │
                        │                                                  │
                        │  ┌─────────────┐    ┌────────────────────────┐  │
                        │  │ Neon PG     │    │ Mission Control        │  │
                        │  │ (cloud      │    │ - Fleet management     │  │
                        │  │  replica)   │    │ - Failover events      │  │
                        │  └──────┬──────┘    │ - Cellular device reg  │  │
                        │         │           │ - SSE → sync-agent     │  │
                        │         │           └───────────┬────────────┘  │
                        │         │                       │               │
                        │    ┌────┴───────────────────────┴────┐          │
                        │    │     Cellular Relay (proxy.ts)    │          │
                        │    │  - JWT auth (cellular tokens)    │          │
                        │    │  - Route allowlist gate          │          │
                        │    │  - Rate limiting (10 req/s)      │          │
                        │    └────────────────┬────────────────┘          │
                        └─────────────────────┼───────────────────────────┘
                              ▲               │               ▲
                   upstream   │    cellular    │    SSE        │  heartbeat
                   sync (5s)  │    orders ↓   │    wake-up    │  (30s)
                              │               ▼               │
                 ┌────────────┴───────────────────────────────┴──────────┐
                 │                    VENUE LAN                          │
                 │                                                       │
                 │    ┌─────────────────────────────────────┐            │
                 │    │         VIP: 10.10.10.50            │            │
                 │    │    (keepalived virtual IP)           │            │
                 │    └──────────────┬──────────────────────┘            │
                 │                   │                                    │
                 │       ┌───────────┴───────────┐                       │
                 │       │                       │                       │
                 │  ┌────┴──────────┐   ┌───────┴───────────┐           │
                 │  │ PRIMARY NUC   │   │ BACKUP NUC        │           │
                 │  │ (10.10.10.11) │   │ (10.10.10.12)     │           │
                 │  │               │   │                    │           │
                 │  │ PG primary    │──▶│ PG standby         │           │
                 │  │ POS app ✓     │WAL│ POS app (idle)     │           │
                 │  │ Sync workers ✓│   │ No sync workers    │           │
                 │  │ keepalived    │   │ keepalived          │           │
                 │  │ priority=101  │   │ priority=100        │           │
                 │  └───────────────┘   └────────────────────┘           │
                 │           ▲                                            │
                 │           │ LAN (WiFi/Ethernet)                       │
                 │  ┌────────┼──────────┬───────────────┐                │
                 │  ▼        ▼          ▼               ▼                │
                 │ ┌─────┐ ┌─────┐ ┌────────┐ ┌─────────────┐           │
                 │ │Term │ │Term │ │Android │ │ KDS / CFD   │           │
                 │ │ 1   │ │ 2   │ │Register│ │ Displays    │           │
                 │ └─────┘ └─────┘ └────────┘ └─────────────┘           │
                 │                                                       │
                 └───────────────────────────────────────────────────────┘
                                          ▲
                                          │ Cellular (4G/5G)
                                          │
                                  ┌───────┴────────┐
                                  │ Roaming Android │
                                  │ (poolside,      │
                                  │  event floor)   │
                                  └────────────────┘
```

---

## Phase 1 — Backup NUC + HA Failover

### Goal
Zero-downtime POS operation when the primary NUC fails. Automatic failover with ≤10 second detection and promotion.

### PostgreSQL Streaming Replication

The backup NUC runs PostgreSQL in hot standby mode, receiving WAL (Write-Ahead Log) records from the primary in real time.

**Primary configuration (`postgresql.conf`):**
```
wal_level = replica
max_wal_senders = 3
wal_keep_size = 1GB
```

**Primary `pg_hba.conf`:**
```
host replication replicator <backup_ip>/32 md5
```

**Backup setup:**
```bash
pg_basebackup -h $PRIMARY_NUC_IP -D /var/lib/postgresql/16/main -U replicator -P -R
```
This creates `standby.signal` and configures `primary_conninfo` automatically.

**Clock sync:** Both NUCs run `timedatectl set-ntp true` — clock skew breaks replication monitoring.

### keepalived + Virtual IP

keepalived runs on both NUCs and manages a shared Virtual IP (VIP). All devices connect to the VIP, not to individual NUC IPs.

| Parameter | Primary | Backup |
|-----------|---------|--------|
| `vrrp_instance` | GWI_POS | GWI_POS |
| `state` | MASTER | BACKUP |
| `priority` | 101 | 100 |
| `virtual_ipaddress` | VIP (e.g., 10.10.10.50) | same |
| `track_script` | ha-check.sh (2s interval, fall 3) | ha-check.sh |

**Interface auto-detection:** `ip route get 1 | awk '{print $5}'` — works on any NUC network config.

### Health Check Script (`ha-check.sh`)

Runs every 2 seconds. keepalived triggers failover after 3 consecutive failures (~6s).

**On PRIMARY:**
1. PG writable: `SELECT 1` succeeds
2. PG is primary: `pg_is_in_recovery()` returns false
3. POS app healthy: `curl -sf http://localhost:3005/api/health` returns 200
4. ALL must pass → exit 0, ANY fails → exit 1

**On STANDBY:**
1. PG running and in recovery mode
2. Replication lag: `SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))`
3. Lag > 30s for 3 consecutive checks → log WARNING to MC (warn only — no auto-failover on lag)

### Split-Brain Prevention (Fencing)

Before promotion, the backup MUST verify the old primary is truly down.

**Fence-check sequence:**
1. Backup's `promote.sh` sends HTTP to old primary's `/api/fence-check` (2s timeout, shared secret header)
2. If old primary responds 200 with `role="primary"` → **ABORT promotion** (primary is alive, keepalived was wrong)
3. If timeout, unreachable, or non-200 → safe to proceed with promotion
4. The `/api/fence-check` endpoint is infrastructure-only (no `withVenue()` wrapper), requires `x-ha-secret` header matching `HA_SHARED_SECRET` env var, and is restricted to RFC-1918 source IPs.

### Failover Sequence

```
Timeline:
  T+0s     Primary NUC fails (PG crash, app crash, power loss)
  T+2s     ha-check.sh fails on primary (exit 1)
  T+4s     Second failure (fall count = 2)
  T+6s     Third failure (fall count = 3) → keepalived transitions VIP to backup
  T+6.5s   promote.sh fires:
           a. Stop sync workers (pm2 stop sync-upstream)
           b. Fence check → old primary unreachable → proceed
           c. pg_ctl promote → PG becomes read-write
           d. Wait for pg_is_in_recovery() = false (max 10s)
           e. Start POS app (pm2 start ecosystem.config.js)
           f. Gratuitous ARP (arping -U) → LAN devices re-resolve VIP
           g. Hardware test (curl /api/hardware/test-all)
           h. Start upstream sync
           i. Report failover event to Mission Control
           j. Update STATION_ROLE=server in .env
  T+10s    Service restored on backup NUC (now promoted to primary)
```

**Exit codes:** 0 = success, 1 = fencing abort (primary alive), 2 = PG promote failed, 3 = app start failed.

### Recovery (Old Primary Rejoins as Standby)

When the old primary comes back online, it detects it no longer owns the VIP and runs `rejoin-as-standby.sh`:

1. Stop all POS services and sync workers
2. Stop PostgreSQL
3. Wipe PG data directory
4. `pg_basebackup` from current primary (the formerly-backup NUC)
5. Create `standby.signal`, configure `primary_conninfo`
6. Start PostgreSQL in standby mode
7. Verify replication streaming
8. Update `STATION_ROLE=backup` in `.env`
9. Report standby status to Mission Control

### Installer Changes

The installer (`public/installer.run`) gains a new `backup` station role (option 3 in the interactive menu):

- Prompts for `PRIMARY_NUC_IP` and `VIRTUAL_IP`
- Registers with Mission Control as `role=backup` with `pairedNodeId` pointing to the primary
- Configures PG streaming replication (pg_basebackup from primary)
- Installs and configures keepalived on both primary and backup
- Sets `.env`: `STATION_ROLE=backup`, `PRIMARY_NUC_IP`, `VIRTUAL_IP` (all unquoted per convention)

---

## Phase 2 — Cellular Edge Path

### Goal
Roaming Android devices (poolside, event floor, outdoor patio) can take orders and process payments over cellular data, relayed through the cloud to the venue NUC.

### Architecture

Cellular devices cannot reach the NUC directly (NUC has no public IP). The cloud acts as a relay:

1. Device sends request to cloud (Vercel) with cellular JWT token
2. `proxy.ts` (Next.js middleware) validates token, checks route allowlist
3. Cloud writes order to Neon with `lastMutatedBy = 'cloud'`
4. Sync agent on NUC receives SSE wake-up from Mission Control
5. Downstream sync worker pulls cloud-originated order to local PG
6. Fulfillment router fires on the NUC (prints tickets, updates KDS)

### proxy.ts Gate (INV-5)

`proxy.ts` is the sole gating dependency for all cellular features. It adds a new auth path before existing cloud/local checks:

**Detection:** `x-cellular-terminal: true` header + `Authorization: Bearer <token>` header.

**Allowlisted routes (cellular tokens may access):**
| Route Pattern | Access |
|---------------|--------|
| `/api/orders/*` | Create, update, send, close |
| `/api/orders/*/pay` | Payment recording |
| `/api/orders/*/record-card-auth` | SoftPOS auth recording |
| `/api/auth/refresh-cellular` | Token refresh |
| `/api/menu/*` | Read-only |
| `/api/barcode/lookup` | Barcode scanning |

**Hard-blocked routes (403 Forbidden, audit logged):**
| Route Pattern | Reason |
|---------------|--------|
| `/api/orders/*/refund` | **Refunds permanently blocked for CELLULAR_ROAMING** |
| `/api/orders/*/tip-adjust` | Tip adjustments blocked |
| `/api/shifts/*/close` | Shift operations blocked |
| All `/api/admin/*`, `/api/settings/*`, `/api/reports/*` | Admin/settings/reports blocked |

**Re-auth required routes** (pass through with `x-requires-reauth: true` header):
- `/api/orders/*/void` — requires manager PIN re-authentication
- `/api/orders/*/comp` — requires manager PIN re-authentication

**Everything else:** blocked (403) for cellular tokens.

**Rate limiting:** 10 requests/second per terminalId (in-memory counter, 1s sliding window).

**Audit logging:** All 403 rejections logged with terminalId, employeeId, timestamp, attempted route, `authDecisionSource='proxy'`.

### Sync Changes for Cloud-Originated Orders

**Bidirectional sync:** Order, OrderItem, OrderDiscount, OrderCard, OrderItemModifier, Payment models change from `upstream` to `bidirectional` in `sync-config.ts`:

- **Upstream:** sync rows WHERE `lastMutatedBy != 'cloud'` (NUC-originated)
- **Downstream:** sync rows WHERE `lastMutatedBy = 'cloud'` AND `updatedAt > highWaterMark`

**SSE wake-up:** When a cellular order is written to Neon, Mission Control sends a DATA_CHANGED SSE event to the venue's sync-agent. The sync-agent triggers immediate downstream sync (bypasses 15s periodic wait). If SSE is missed, periodic sync catches up — SSE affects latency, never correctness.

### Device Registration — 6-Gate Authentication Model

Cellular devices undergo a 6-gate registration process before receiving tokens:

| Gate | Check | Enforced By |
|------|-------|-------------|
| **Gate 1** — Pairing Nonce | Time-limited one-time code generated by venue manager in MC dashboard | Mission Control |
| **Gate 2** — Device Fingerprint | Hardware/software fingerprint (Android ID + app signature hash) must be unique | MC CellularDevice model |
| **Gate 3** — Manager Approval | Venue manager explicitly approves device in MC UI | MC `CellularDeviceStatus.APPROVED` |
| **Gate 4** — Location Binding | Token is scoped to a single locationId — cannot access other venues | `cellular-auth.ts` JWT payload |
| **Gate 5** — Terminal Role Binding | Token encodes `CELLULAR_ROAMING` role — proxy.ts enforces restrictions | proxy.ts allowlist |
| **Gate 6** — Idle Timeout | 2-hour inactivity → token expires | In-memory last-request tracker |

**Token lifecycle:**
- `issueCellularToken()` — signed JWT, 24h expiry, `canRefund: false` for CELLULAR_ROAMING
- `refreshCellularToken()` — verify old token, check revocation, issue fresh token
- `checkIdleTimeout()` — in-memory per-terminalId, >2 hours since last request → expired
- **Revocation:** in-memory deny list (Map<terminalId, revokedAt>) with 60s TTL refresh from DB

### Device Count Limits (Subscription Gating)

Cellular device registration is subject to subscription-tier limits enforced at `cellular-exchange`. The shared `checkDeviceLimit()` utility (`src/lib/device-limits.ts`) gates device creation at 4 enforcement points: terminal creation, terminal pairing, cellular exchange, and printer creation. Limits are settings-driven (`maxCellularDevices`, `maxPOSTerminals`, `maxHandhelds`, `maxKDSScreens`, `maxPrinters`) with MC tier defaults: STARTER (2/0/2/2/1), PRO (8/4/4/6/4), ENTERPRISE (unlimited). Returns 403 `DEVICE_LIMIT_EXCEEDED` when a venue exceeds its tier allocation.

**Venue-side cellular device management:** Venues can view and revoke cellular devices directly from the POS admin (Settings > Hardware > Cellular Devices) via `GET/POST /api/cellular-devices`. In-memory `activeSessions` Map in `cellular-auth.ts` tracks all active sessions. The `cellular:device-revoked` socket event provides real-time device disconnection.

### Event-Sourced Cart Outbox (INV-4)

Cellular cart mutations follow a durable outbox pattern:

```
Android Device → Cloud API → Write to Neon (lastMutatedBy='cloud')
                                    │
                    ┌────────────────┴────────────────┐
                    │ SSE wake-up via MC               │
                    │ (low-latency, best-effort)       │
                    ▼                                  │
              sync-agent.js                            │
                    │                                  │
                    ▼                                  │
          downstream-sync-worker.ts                    │
          (durable, guaranteed delivery)               │
                    │                                  │
                    ▼                                  │
              Local PG (NUC)                           │
                    │                                  │
                    ▼                                  │
          Fulfillment Router fires                     │
          (prints tickets, KDS update)                 │
                                                       │
              ┌────────────────────────────────────────┘
              │ Periodic sync (15s) catches anything
              │ SSE missed — guaranteed delivery
              └─────────────────────────────────────────
```

---

## Phase 3 — Fulfillment Routing

### Goal
Item-level routing that determines where each menu item in an order should be fulfilled, supporting both LAN-originated and cloud-originated orders.

### FulfillmentType Model

New enum on MenuItem:

| Type | Behavior |
|------|----------|
| `KITCHEN_STATION` (default) | Routes to venue's default kitchen station or `fulfillmentStationId` if set |
| `BAR_STATION` | Routes to venue's default bar station or `fulfillmentStationId` if set |
| `PREP_STATION` | Routes to venue's default prep station or `fulfillmentStationId` if set |
| `SELF_FULFILL` | No hardware action — item is fulfilled by the ordering device (e.g., retail item) |
| `NO_ACTION` | Skip entirely — no ticket, no KDS update |

### Station Resolution

Per-item resolution logic (executed by `fulfillment-router.ts`):

1. Look up MenuItem's `fulfillmentType` and `fulfillmentStationId` from **cached menu data** (INV-8)
2. If `fulfillmentStationId` is set → use that specific station
3. If null → resolve from `fulfillmentType` using venue's PrintRoute configuration:
   - `KITCHEN_STATION` → venue's default kitchen station
   - `BAR_STATION` → venue's default bar station
   - `PREP_STATION` → venue's default prep station
4. **Fallback:** venue's primary kitchen printer — never silently drop a ticket

### Send-Time Snapshot (AD-8)

Routing is frozen at send time:
- The resolved station config is stored in the FulfillmentEvent payload
- Later menu edits do NOT retroactively change routing for already-sent items
- This prevents phantom re-prints and ghost tickets when menu config changes

### Routing Engine

```typescript
async function routeOrderFulfillment(
  order: { id: string; locationId: string },
  items: Array<{ id: string; menuItemId: string; quantity: number; name: string; modifiers?: any[] }>,
  originDevice?: { terminalId?: string; type?: 'lan' | 'cellular' }
): Promise<FulfillmentAction[]>
```

**Per-item flow:**
1. Resolve fulfillment type and station from cache
2. Create FulfillmentAction grouped by target station (one ticket per station, not per item)
3. Mixed orders → multiple FulfillmentActions targeting different stations

**Idempotency:** Before routing, check if FulfillmentEvent with key `{orderId}:{sendTimestamp}` already exists. Skip if so. Prevents double-printing on duplicate sync deliveries.

### Cloud-Originated Fulfillment Flow

For orders arriving via the cellular path:

```
Cloud → Neon → downstream sync → local PG → order status = "sent"
  → fulfillment router fires on NUC
  → FulfillmentEvents created (one per target station)
  → existing print/KDS workers consume events
  → kitchen ticket prints, KDS board updates
```

The fulfillment router is triggered as a hook point in the downstream sync worker when an Order's status transitions to "sent".

---

## Phase 4 — DR Formalization

### Goal
Documented, tested disaster recovery for the worst case: both NUCs destroyed.

### Backup Strategy (3-Layer)

| Layer | Method | RPO | Retention |
|-------|--------|-----|-----------|
| **Layer 1** | Neon PITR (Point-in-Time Recovery) | ~5s (upstream sync interval) | 30 days |
| **Layer 2** | Weekly GitHub Actions branch snapshot | 7 days | 28 days (4 snapshots) |
| **Layer 3** | NUC local PG (streaming replication to backup) | Sub-second (WAL) | Real-time |

### Replacement NUC Restore

If both NUCs are lost:

1. Provision new NUC hardware
2. Run installer with `STATION_ROLE=server`
3. Installer detects no local PG data
4. Restore from Neon: `pg_dump` from cloud → `pg_restore` to local PG
5. Re-register with Mission Control (new `SERVER_NODE_ID`)
6. Devices re-pair to new NUC (VIP address preserved if network config unchanged)
7. Verify: open orders, tab states, shift data intact

**RPO:** Maximum data loss = upstream sync interval (currently 5 seconds) + any in-flight transactions at crash time.

### Automated Backup Verification

Nightly cron validates backup chain integrity:
- Neon reachable and accepting sync writes
- Weekly snapshot branch exists and is fresh
- Backup NUC replication lag < 5s (if backup exists)
- Results reported via MC heartbeat

---

## Phase 5 — Observability

### Mission Control Dashboard

New fleet management views for HA-enabled venues:

| Widget | Data Source |
|--------|------------|
| **HA Pair Status** | ServerNode.pgRole, replicationLag, isVipOwner |
| **Failover Timeline** | FailoverEvent records — who, when, why, duration |
| **Replication Lag Graph** | Time-series from heartbeat (30s intervals) |
| **Cellular Device Registry** | CellularDevice status, last seen, approval state |
| **Cellular Audit Log** | CellularAuditEvent — blocked attempts, active sessions |

### On-Device Health Indicators

**Android (register + PAX):**
- Connection status: `CONNECTED_VIP`, `CONNECTED_BACKUP`, `DISCONNECTED`
- Banner: "Primary server unavailable — using backup" (when on backup direct IP)
- Periodic VIP re-check (30s) to switch back when primary recovers

**/api/health enhancement:**
New fields in health response:
- `pgRole`: "primary" | "standby" | "unknown"
- `stationRole`: from `STATION_ROLE` env var
- `virtualIp`: from `VIRTUAL_IP` env var
- `replicationLag`: seconds (standby only)
- `isVipOwner`: boolean

### Service Level Objectives

| SLO | Target | Measurement |
|-----|--------|-------------|
| **Failover time** | ≤10s from primary failure to service restored on backup | promote.sh timestamps |
| **Replication lag** | <1s (p99), alert at >5s, critical at >30s | pg_stat_wal_receiver |
| **Cellular order delivery** | ≤5s from cloud write to NUC receipt (SSE path) | Neon write timestamp vs NUC insert timestamp |
| **Cellular order delivery (periodic)** | ≤20s worst case (SSE missed, periodic catches up) | Same as above |
| **Fulfillment routing** | <50ms per order (cache-only path) | fulfillment-router.ts timing |
| **Health check** | 100% availability on VIP (across primary + backup) | keepalived + ha-check.sh |

### Test Matrix

| Scenario | Test Method | Expected Outcome |
|----------|-------------|-----------------|
| Primary NUC power loss | Kill primary PG + app | Backup promotes within 10s, devices reconnect to VIP |
| Primary PG crash (app running) | `pg_ctl stop -m immediate` | ha-check.sh detects, keepalived transitions, promote.sh fires |
| Network partition (primary isolated) | `iptables -A OUTPUT -j DROP` on primary | Backup promotes, primary detects VIP loss on recovery and rejoins as standby |
| Split-brain attempt | Both NUCs think they're primary | Fencing check prevents dual-primary — backup aborts if primary responds |
| Backup NUC failure | Kill backup PG + app | No impact — primary continues serving. MC dashboard shows degraded HA |
| Replication lag spike | Throttle WAL receiver | Warning at 30s, no auto-failover (warn only per design) |
| Cellular order while NUC offline | Send order via cellular, NUC down | Order persists in Neon, delivers when NUC recovers |
| Cellular token revocation | Revoke device in MC | Next request returns 401, in-memory deny list updated within 60s |
| Fulfillment double-delivery | Duplicate sync of same order | Idempotency key prevents double-print |
| Both NUCs down | Kill both NUCs | Cellular orders queue in Neon. LAN devices show offline. Staff follows runbook. |

---

## Phase 6 — Cloud-Primary Architecture Transition

**Status:** Implemented (2026-03-09)

### The Rule

> GWI cloud-primary venues use Neon as the canonical source of truth in normal operation. The on-site NUC remains mandatory as the local execution and continuity layer: it serves LAN devices, drives all hardware, and temporarily becomes the write authority during internet outages, replaying reconciled changes upstream when connectivity returns.

### 6.1 — Unified Migration Architecture

**Problem:** Two migration scripts (`vercel-build.js` at 641 lines, `nuc-pre-migrate.js` at 1823 lines) with 85% duplicate logic in incompatible SQL dialects.

**Solution:** Single migration runner using PrismaClient (works against both local PG and Neon).

- **Migration files:** `scripts/migrations/001-*.js` through `012-*.js` — each exports `async function up(prisma)`
- **Tracking table:** `_gwi_migrations` — records applied migrations (no more relying on IF NOT EXISTS guards alone)
- **`nuc-pre-migrate.js`** — reduced to ~100 lines: PrismaClient init + migration runner + bootstrap
- **`vercel-build.js`** — reduced to ~110 lines: orchestrator calling nuc-pre-migrate.js against master + venue DBs
- **Shared helpers:** `scripts/migration-helpers.js` — `columnExists`, `tableExists`, `enumValueExists`, `indexExists`

### 6.2 — New Schema Models

Three new models added to `prisma/schema.prisma`:

**FulfillmentEvent** — Durable hardware dispatch queue
- Fields: locationId, orderId, stationId, type (print_kitchen/print_bar/kds_update/drawer_kick), status (pending/claimed/completed/failed/dead_letter), payload, claimedBy, claimedAt, completedAt, failedAt, retryCount
- Indexes: [locationId, status], [claimedBy, status]
- Lifecycle: pending → claimed (by NUC node) → completed/failed → dead_letter (after 3 retries)

**BridgeCheckpoint** — NUC bridge lease/failover tracking
- Fields: locationId, nodeId, role (primary/backup), leaseExpiresAt, lastHeartbeat, lastFulfillmentAt, fulfillmentLag
- Unique: [locationId, nodeId]
- Lease: 90s duration, 30s heartbeat renewal

**OutageQueueEntry** — Outage write queue for NUC→Neon replay
- Fields: locationId, tableName, recordId, operation (INSERT/UPDATE/DELETE), payload, localSeq (monotonic), idempotencyKey (unique), status (pending/replayed/conflict/failed)
- Index: [locationId, status]

### 6.3 — Fulfillment Bridge Worker

**File:** `src/lib/fulfillment-bridge-worker.ts`

- Polls FulfillmentEvent every 2s for pending events
- Claims via optimistic locking (`updateMany WHERE status='pending'`)
- Dispatches via Socket.IO (print-ticket, kds:order-received, drawer-kick)
- Reclaims stale events after 60s (processing timeout)
- Dead-letters after 3 retries
- Uses `POS_LOCATION_ID` and `NUC_NODE_ID` env vars

### 6.4 — Bridge Checkpoint (Lease Failover)

**File:** `src/lib/bridge-checkpoint.ts`

- Each NUC node heartbeats every 30s with 90s lease
- Uses BridgeCheckpoint upsert with compound key [locationId, nodeId]
- Exports `isLeaseActive()` and `shouldClaimBridge()` for bridge worker
- Backup NUC claims bridge when primary lease expires

### 6.5 — Outage Replay Worker

**File:** `src/lib/sync/outage-replay-worker.ts`

- Polls every 10s for pending OutageQueueEntry records
- Checks Neon connectivity before processing (SELECT 1 probe)
- FIFO replay by localSeq order
- Handles conflicts (PG unique violation 23505) — marks as 'conflict'
- Exports `getOutageReplayMetrics()` for monitoring

### 6.6 — Upstream Sync Outage Detection

**File:** `src/lib/sync/upstream-sync-worker.ts` (enhanced)

- Tracks consecutive sync failures (threshold: 3)
- Sets `isInOutage = true` when threshold reached
- Clears on successful sync
- Exports `isInOutageMode()` and `queueOutageWrite()` for API routes

### 6.7 — Downstream Sync Enhancements

**File:** `src/lib/sync/downstream-sync-worker.ts` (enhanced)

- **Conflict detection:** For bidirectional models, compares `updatedAt` + `lastMutatedBy` with configurable strategy (neon-wins default)
- **Deny list sync:** Calls `syncDenyList()` fire-and-forget at end of each downstream cycle

### 6.8 — Conflict Resolution Strategy

**File:** `src/lib/sync/sync-config.ts` (enhanced)

- New type: `ConflictStrategy = 'neon-wins' | 'local-wins' | 'latest-wins'`
- All 6 bidirectional models default to `'neon-wins'`
- Helper: `getConflictStrategy(model)` — returns model's strategy

### 6.9 — ID Unification (In Progress)

**Goal:** One canonical `locationId` everywhere. Kill `posLocationId` bridge field.

- MC `CloudLocation.canonicalLocationId` added — stores Neon Location.id
- `posLocationId` deprecated (kept for backward compat)
- Fleet endpoints prefer `canonicalLocationId` when available
- Heartbeat backfills `canonicalLocationId` from `posLocationId`
- **POS endpoint:** `POST /api/internal/migrate-location-id` — transactional FK migration across all 143 tables with locationId

### 6.10 — FulfillmentEvent Persistence

- `send/route.ts` now persists FulfillmentAction[] as FulfillmentEvent rows after routing
- Existing fire-and-forget dispatch preserved for backward compat
- Bridge worker processes the durable queue

### 6.11 — MC Monitoring Dashboard

- **Sync Health Widget** — heartbeat age, sync lag, status per venue
- **Bridge Health Widget** — HA primary/backup, pgRole, replication lag, VIP
- **Outage Queue Widget** — pending/failed counts per venue
- **ID Drift Alert** — flags venues where posLocationId != canonicalLocationId
- Dashboard page at `/dashboard/monitoring`

### Write Path (Cloud-Primary)

**Normal operation (internet up):**
1. LAN terminals → NUC local API → write to local PG (for speed) → upstream sync to Neon (5s)
2. Cellular → Vercel → Neon (direct)
3. NUC downstream sync pulls Neon changes (15s)

**Outage (internet down):**
1. Upstream sync detects 3 consecutive failures → outage mode
2. LAN terminals → NUC local API → write to local PG + append OutageQueueEntry
3. Cellular → local outbox on device → retry on reconnect
4. Hardware continues locally (printers, KDS, drawers)

**Recovery (internet returns):**
1. Outage replay worker processes queue FIFO
2. Each entry has idempotencyKey: `{locationId}:{tableName}:{recordId}:{localSeq}`
3. Neon-wins on timestamp ties (cloud is canonical)
4. Conflicts logged, visible in MC monitoring dashboard

---

## Payment Reconciliation

### Problem
Android devices process payments locally (SoftPOS / card reader). If a payment is captured but the NUC is unreachable, the payment must eventually be reconciled.

### Android Payment Outbox

Android devices maintain a local outbox for payments processed while disconnected from the NUC:

1. Payment captured on device (Datacap auth successful)
2. Attempt to POST to NUC `/api/orders/{id}/pay`
3. If NUC unreachable → store in local outbox (Room database)
4. Retry on reconnection (exponential backoff)
5. Outbox entries include full payment details + Datacap auth code

### Shift-Close Guard

A shift CANNOT be closed while the payment outbox has unreconciled entries:
- Shift close checks local outbox count
- If count > 0 → block close, show "N payments pending sync"
- Staff must wait for NUC reconnection before closing shift

### Reconciliation Dashboard

MC provides a view of unreconciled payments across all devices at a venue:
- Source: heartbeat reports outbox count per device
- Alert: any outbox entry older than 1 hour triggers MC notification
- Resolution: automatic on reconnect, manual re-entry as last resort

---

## Security Model

### Cellular Token Lifecycle

```
┌──────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│ Device Registration│     │ Token Issuance     │     │ Active Session   │
│                    │     │                    │     │                  │
│ 1. Pairing nonce  │────▶│ verifyCellularToken│────▶│ Proxy gate       │
│ 2. Fingerprint    │     │ issueCellularToken │     │ Route allowlist   │
│ 3. Manager approve│     │ - 24h expiry       │     │ Rate limit 10/s  │
│ 4. Location bind  │     │ - canRefund: false │     │ Idle timeout 2h  │
│ 5. Role bind      │     │ - JWT signed       │     │ Refresh endpoint │
│ 6. Idle timeout   │     │                    │     │                  │
└──────────────────┘     └───────────────────┘     └──────────────────┘
                                                            │
                                                            ▼
                                                    ┌──────────────────┐
                                                    │ Revocation        │
                                                    │                   │
                                                    │ MC marks device   │
                                                    │ as REVOKED        │
                                                    │ → deny list syncs │
                                                    │   within 60s      │
                                                    │ → next request 401│
                                                    └──────────────────┘
```

### Token Binding

- **Location binding:** JWT payload includes `locationId` — token cannot access other venues
- **Device binding:** JWT payload includes `deviceFingerprint` — request must include matching `x-device-fingerprint` header
- **Role binding:** JWT payload includes `terminalRole: 'CELLULAR_ROAMING'` — proxy.ts enforces restrictions based on role
- **Signing:** separate `CELLULAR_TOKEN_SECRET` (not shared with cloud-session secret)

### proxy.ts Route Table

The proxy maintains the complete route table as a compile-time allowlist (not configurable at runtime). Changes to the route table require a code deploy. This is intentional — the allowlist is a security boundary, not a configuration option.

### Audit Trail

All cellular operations are logged to `CellularAuditEvent` in Mission Control:
- `action`: order_create, payment, void_attempt, refund_blocked, comp, pairing_request
- `authDecisionSource`: "proxy" (blocked at gate), "route" (blocked at handler), "service-token" (token-level block)
- `success`: boolean
- `managerReauthByUserId`: if a re-auth-required operation was approved by a manager

---

## Both-NUCs-Down Runbook

### Severity Classification

| Level | Condition | Impact | Staff Action |
|-------|-----------|--------|-------------|
| **SEV-1** | Primary down, backup active | Transparent. No staff action needed. | None — automatic failover |
| **SEV-2** | Both NUCs down, cellular available | LAN devices offline. Roaming devices still work via cloud. | Use cellular devices for orders. Manual kitchen tickets. |
| **SEV-3** | Both NUCs down, no cellular | All digital POS offline. | Switch to manual operations (paper tickets, cash register). |

### SEV-2 Procedure (Both NUCs Down, Cellular Available)

1. **Immediate (0–5 min):**
   - Roaming devices continue taking orders via cellular path
   - Orders queue in Neon — they WILL be delivered when NUC recovers
   - Kitchen: verbal orders or printed from roaming device (if device has local printer)
   - Bar: verbal orders

2. **Short-term (5–30 min):**
   - Manager checks MC dashboard for NUC status
   - If power issue → check UPS, power cycle NUC
   - If network issue → check switch, router, cables
   - Contact GWI support if not resolved

3. **Recovery:**
   - When primary NUC comes online → queued orders sync from Neon
   - Fulfillment router fires for all queued orders → kitchen tickets print
   - Verify: all cellular orders present, payments reconciled

### SEV-3 Procedure (Total POS Outage)

1. Switch to paper guest checks and manual kitchen tickets
2. Accept cash only (or use standalone card terminal if available)
3. Log all transactions manually for later entry
4. Contact GWI support immediately
5. On recovery: manual entry of paper transactions into POS

---

## Key Files

### New Files (this project)

| File | Repo | Phase | Purpose |
|------|------|-------|---------|
| `src/lib/cellular-auth.ts` | gwi-pos | 2 | Cellular JWT issuance, verification, revocation, idle timeout |
| `src/lib/fulfillment-router.ts` | gwi-pos | 3 | Item-level fulfillment routing engine |
| `src/app/api/fence-check/route.ts` | gwi-pos | 1 | Fencing endpoint for split-brain prevention |
| `src/app/api/auth/refresh-cellular/route.ts` | gwi-pos | 2 | Cellular token refresh endpoint |
| `src/app/api/internal/sync-trigger/route.ts` | gwi-pos | 2 | SSE wake-up → immediate downstream sync |
| `src/lib/fulfillment-bridge-worker.ts` | gwi-pos | 6 | Durable FulfillmentEvent poll + claim + execute |
| `src/lib/bridge-checkpoint.ts` | gwi-pos | 6 | NUC bridge lease renewal + failover |
| `src/lib/sync/outage-replay-worker.ts` | gwi-pos | 6 | FIFO outage queue replay to Neon |
| `src/app/api/internal/migrate-location-id/route.ts` | gwi-pos | 6 | Transactional locationId FK migration |
| `scripts/migrations/*.js` | gwi-pos | 6 | Individual migration files (12 files) |
| `scripts/migration-helpers.js` | gwi-pos | 6 | Shared helpers (columnExists, tableExists, etc.) |
| `src/app/api/fleet/failover-event/route.ts` | gwi-mission-control | 1 | Failover event recording |
| `src/components/monitoring/*.tsx` | gwi-mission-control | 6 | Dashboard monitoring widgets |
| `src/app/api/admin/monitoring/*.ts` | gwi-mission-control | 6 | Monitoring API routes |
| `public/ha-check.sh` | gwi-pos | 1 | keepalived health check script + MC lease renewal |
| `public/promote.sh` | gwi-pos | 1 | Backup → primary promotion script + MC arbiter claim |
| `public/rejoin-as-standby.sh` | gwi-pos | 1 | Old primary → standby rejoin script |
| `src/app/api/internal/ha-lease/route.ts` | gwi-pos | 1 | Internal API: update/read in-memory MC lease state |

### Modified Files

| File | Repo | Phase | Changes |
|------|------|-------|---------|
| `prisma/schema.prisma` | gwi-pos | 1–3, 6 | FulfillmentType enum, lastMutatedBy, fulfillmentStationId, originTerminalId, FulfillmentEvent, BridgeCheckpoint, OutageQueueEntry |
| `scripts/nuc-pre-migrate.js` | gwi-pos | 1–3 | DDL for new columns and enums |
| `scripts/vercel-build.js` | gwi-pos | 1–3 | Mirror DDL for Neon |
| `src/proxy.ts` | gwi-pos | 2 | Cellular auth path, route allowlist, rate limiting |
| `src/lib/sync/sync-config.ts` | gwi-pos | 2 | Bidirectional direction for Order tables |
| `src/lib/sync/downstream-sync-worker.ts` | gwi-pos | 2 | Order downstream sync, fulfillment hook point |
| `public/sync-agent.js` | gwi-pos | 2 | SSE wake-up handling for DATA_CHANGED |
| `public/installer.run` | gwi-pos | 1 | Backup role, keepalived, PG replication setup |
| `src/app/api/health/route.ts` | gwi-pos | 1 | pgRole, stationRole, replicationLag, VIP fields |
| `prisma/schema.prisma` | gwi-mission-control | 1–2 | ServerNodeRole, FailoverEvent, CellularDevice, CellularAuditEvent |
| `src/app/api/fleet/register/route.ts` | gwi-mission-control | 1 | Backup role + pairedNodeId registration |
| `src/app/api/fleet/heartbeat/route.ts` | gwi-mission-control | 1 | Replication lag, pgRole, VIP fields |
| `ConnectivityWatcherImpl.kt` | gwi-android-register, gwi-pax-a6650 | 1 | VIP failover, backup IP fallback, NucStatus states |
| `TokenProvider.kt` | gwi-android-register, gwi-pax-a6650 | 1 | backupUrl, vipUrl storage |
| `DynamicBaseUrlInterceptor.kt` | gwi-android-register, gwi-pax-a6650 | 1 | URL switching on failover |
| `PairingViewModel.kt` | gwi-android-register, gwi-pax-a6650 | 1 | Store backup/VIP URLs from pairing response |
| `scripts/nuc-pre-migrate.js` | gwi-pos | 6 | Reduced to ~100 lines: PrismaClient init + migration runner |
| `scripts/vercel-build.js` | gwi-pos | 6 | Reduced to ~110 lines: orchestrator calling migration runner |
| `src/lib/sync/sync-config.ts` | gwi-pos | 6 | ConflictStrategy type, neon-wins default for bidirectional models |
| `src/lib/sync/upstream-sync-worker.ts` | gwi-pos | 6 | Outage detection (3 consecutive failures), queueOutageWrite() |
| `src/lib/sync/downstream-sync-worker.ts` | gwi-pos | 6 | Conflict detection with updatedAt + lastMutatedBy comparison |
| `src/app/api/orders/send/route.ts` | gwi-pos | 6 | Persists FulfillmentAction[] as FulfillmentEvent rows |
| `prisma/schema.prisma` | gwi-mission-control | 6 | CloudLocation.canonicalLocationId field |

---

## Appendix A — Cost Estimates

| Item | Per Venue | Notes |
|------|-----------|-------|
| Backup NUC hardware | ~$400 | Same spec as primary (Intel NUC, 16GB RAM, 500GB SSD) |
| Cellular data plan | ~$30/mo | Per roaming device, 5GB sufficient for order data |
| keepalived | $0 | Open source, included in Ubuntu repos |
| PostgreSQL replication | $0 | Built into PostgreSQL, no extensions needed |
| Additional Neon usage | Negligible | Cellular orders are a small fraction of total volume |
| Mission Control hosting | $0 incremental | Existing Vercel deployment handles additional API calls |

**Total incremental per venue:** ~$400 one-time (backup NUC) + ~$30/mo per cellular device.

---

## Appendix B — MC Split-Brain Arbiter (API Contract)

### Problem

Two-node HA with no quorum. During a network partition, both NUCs can reach MC (via internet) but not each other (LAN down). Without an external witness, both may claim the VIP and accept writes, causing permanent data divergence.

### Solution: Lease-Based Primary Claim via Mission Control

MC acts as the external arbiter. The active primary acquires a "primary lease" from MC. The backup must obtain this lease before promoting. If the primary is still renewing its lease, MC denies the backup's claim.

### Protocol Flow

```
NORMAL OPERATION:
  Primary NUC ──(every 10s)──> POST /api/fleet/ha/renew-lease ──> MC
                                MC returns { leaseExpiresAt: T+30s }

FAILOVER (backup detects primary down):
  Backup NUC ──> promote.sh
    Step B.1: Peer fence-check (existing: curl http://peer:3005/api/fence-check)
    Step B.2: POST /api/fleet/ha/claim-primary ──> MC
      MC checks: active lease for this venue?
        YES (not expired) → 409 { currentHolder, remainingSeconds }
        NO (expired/none) → 200 { granted: true, leaseExpiresAt }
    Step B.3: Decision matrix (see promote.sh comments)

SPLIT-BRAIN DETECTION:
  MC receives heartbeats from TWO nodes both claiming primary → P0 alert
  MC can instruct one node to step down via fleet command
```

### MC Endpoints to Implement

#### `POST /api/fleet/ha/claim-primary`

Backup NUC requests to become the new primary. MC grants only if no active lease exists for another node.

**Auth:** `Authorization: Bearer <SERVER_API_KEY>` + `X-Server-Node-Id`

**Request:**
```json
{
  "venueSlug": "fruita-grill",
  "nodeId": "nuc-abc-123",
  "requestedTTL": 30,
  "reason": "promote.sh",
  "peerReachable": false
}
```

**Response (200 — granted):**
```json
{
  "granted": true,
  "leaseExpiresAt": "2026-03-09T12:00:30Z",
  "previousHolder": "nuc-xyz-789",
  "previousLeaseExpired": true
}
```

**Response (409 — denied):**
```json
{
  "granted": false,
  "currentHolder": "nuc-xyz-789",
  "leaseExpiresAt": "2026-03-09T12:00:30Z",
  "remainingSeconds": 18,
  "reason": "Active lease held by another node"
}
```

**Implementation notes:**
- Lookup by venueSlug (via CloudLocation.venueSlug or ServerNode relationship)
- Atomic check-and-set: read lease, verify expired, write new lease — all in one transaction
- If `currentHolder == requestor.nodeId`, grant (idempotent re-claim)
- Log as FailoverEvent with `event: "primary_lease_claimed"`

#### `POST /api/fleet/ha/renew-lease`

Primary NUC renews its lease. Called every 10 seconds from `ha-check.sh`.

**Auth:** `Authorization: Bearer <SERVER_API_KEY>` + `X-Server-Node-Id`

**Request:**
```json
{
  "venueSlug": "fruita-grill",
  "nodeId": "nuc-abc-123",
  "ttl": 30
}
```

**Response (200 — renewed):**
```json
{
  "renewed": true,
  "leaseExpiresAt": "2026-03-09T12:00:30Z"
}
```

**Response (409 — lease held by different node):**
```json
{
  "renewed": false,
  "currentHolder": "nuc-xyz-789",
  "reason": "Lease held by another node — possible split-brain"
}
```

**Implementation notes:**
- Only renew if `nodeId` matches current lease holder
- If a different node holds the lease, return 409 — the caller is a stale primary
- On 409, the stale primary should trigger a P0 alert (split-brain detected)
- Extend `leaseExpiresAt = now() + ttl` on success

#### `GET /api/fleet/ha/lease-status`

Informational endpoint for MC dashboard and debugging.

**Auth:** Admin session or `Authorization: Bearer <SERVER_API_KEY>`

**Query:** `?venueSlug=fruita-grill`

**Response (200):**
```json
{
  "venueSlug": "fruita-grill",
  "currentHolder": "nuc-abc-123",
  "leaseExpiresAt": "2026-03-09T12:00:30Z",
  "remainingSeconds": 22,
  "isExpired": false,
  "lastRenewedAt": "2026-03-09T12:00:08Z",
  "claimHistory": [
    { "nodeId": "nuc-abc-123", "claimedAt": "2026-03-09T11:50:00Z", "reason": "promote.sh" }
  ]
}
```

### Split-Brain Detection Logic (MC-side)

MC should detect split-brain when **both** of these are true simultaneously:
1. A node holds an active (non-expired) primary lease
2. MC receives a heartbeat from a **different** node at the same venue that reports `pgRole: "primary"` AND `stationRole: "server"`

On detection:
- Raise a **P0 alert** (highest severity)
- Record a `FailoverEvent` with `event: "split_brain_detected"`
- Optionally issue a `STEP_DOWN` fleet command to the node that does NOT hold the lease

### MC Schema Additions

```prisma
// Add to ServerNode or create new model
model HaPrimaryLease {
  id              String   @id @default(cuid())
  venueSlug       String   @unique
  holderNodeId    String
  leaseExpiresAt  DateTime
  lastRenewedAt   DateTime @default(now())
  claimedAt       DateTime @default(now())
  claimReason     String?
  @@index([venueSlug])
}
```

### Degradation Behavior

| MC reachable | Peer reachable | Behavior |
|:---:|:---:|---|
| Yes | Yes (alive) | ABORT — both witnesses agree primary is up |
| Yes | Yes (fenced) | MC claim + proceed if granted |
| Yes | No | MC claim + proceed if granted |
| No | Yes (alive) | ABORT — peer is alive, existing behavior |
| No | Yes (fenced) | PROCEED — peer is fenced, degrade to existing behavior |
| No | No | PROCEED — both unreachable, degrade to existing behavior |

The key safety property: **MC can only BLOCK promotion, never enable it**. If MC is unreachable, the system falls back to the existing peer-only fencing, which is the baseline behavior before this feature.

---

## Appendix C — Future Considerations

### Patroni (Deferred)

For venues requiring >2 nodes or automated consensus-based failover, Patroni (etcd-backed PostgreSQL HA) could replace keepalived. Deferred because:
- 2-node keepalived is sufficient for current venue sizes
- Patroni requires etcd cluster (3+ nodes for quorum) — overkill for bar/restaurant
- keepalived is operationally simpler and already proven in the field

### Play Integrity Attestation

The cellular auth module includes a placeholder for Google Play Integrity API verification. When implemented:
- Token refresh will verify device attestation
- Rooted/modified devices will be quarantined
- Adds hardware-backed trust to the 6-gate model

### Socket.IO Over Cellular

Currently cellular devices use HTTP request/response only. Future enhancement:
- WebSocket tunnel from cloud to NUC for real-time events on cellular devices
- Would enable: live KDS updates, table status changes, alert notifications
- Deferred: HTTP polling on 5s interval is acceptable for roaming use cases

### Multi-Region Cloud Relay

Current design uses a single Vercel region for the cloud relay. For venues in different regions:
- Edge functions could reduce cellular request latency
- Neon regional read replicas could serve menu reads locally
- Deferred: all current venues are in the same region

---

## Appendix D — Schema Changes Summary

### gwi-pos (Prisma)

```prisma
// New enum
enum FulfillmentType {
  SELF_FULFILL
  KITCHEN_STATION
  BAR_STATION
  PREP_STATION
  NO_ACTION
}

// MenuItem additions
model MenuItem {
  fulfillmentType      FulfillmentType @default(KITCHEN_STATION)
  fulfillmentStationId String?
}

// Order additions
model Order {
  lastMutatedBy    String?   // 'cloud' | 'local' | null
  originTerminalId String?
}

// OrderItem additions
model OrderItem {
  lastMutatedBy String?
}

// Payment additions
model Payment {
  lastMutatedBy String?
}

// Phase 6 — New models

enum FulfillmentEventType {
  print_kitchen
  print_bar
  kds_update
  drawer_kick
}

enum FulfillmentEventStatus {
  pending
  claimed
  completed
  failed
  dead_letter
}

model FulfillmentEvent {
  id          String                 @id @default(cuid())
  locationId  String
  orderId     String
  stationId   String?
  type        FulfillmentEventType
  status      FulfillmentEventStatus @default(pending)
  payload     Json
  claimedBy   String?
  claimedAt   DateTime?
  completedAt DateTime?
  failedAt    DateTime?
  retryCount  Int                    @default(0)
  createdAt   DateTime               @default(now())
  @@index([locationId, status])
  @@index([claimedBy, status])
}

enum BridgeRole {
  primary
  backup
}

model BridgeCheckpoint {
  id                String    @id @default(cuid())
  locationId        String
  nodeId            String
  role              BridgeRole
  leaseExpiresAt    DateTime
  lastHeartbeat     DateTime
  lastFulfillmentAt DateTime?
  fulfillmentLag    Float?
  @@unique([locationId, nodeId])
}

enum OutageOperation {
  INSERT
  UPDATE
  DELETE
}

enum OutageStatus {
  pending
  replayed
  conflict
  failed
}

model OutageQueueEntry {
  id             String          @id @default(cuid())
  locationId     String
  tableName      String
  recordId       String
  operation      OutageOperation
  payload        Json
  localSeq       Int
  idempotencyKey String          @unique
  status         OutageStatus    @default(pending)
  createdAt      DateTime        @default(now())
  replayedAt     DateTime?
  @@index([locationId, status])
}
```

### gwi-mission-control (Prisma)

```prisma
enum ServerNodeRole {
  PRIMARY
  BACKUP
  STANDBY
}

enum CellularDeviceStatus {
  PENDING_APPROVAL
  APPROVED
  ACTIVE
  REVOKED
  QUARANTINED
  EXPIRED
}

model FailoverEvent {
  id         String   @id @default(cuid())
  locationId String
  fromNodeId String
  toNodeId   String
  reason     String
  duration   Int?
  timestamp  DateTime @default(now())
  metadata   Json?
  // relations + indexes
}

model CellularDevice {
  id                String                @id @default(cuid())
  terminalId        String                @unique
  locationId        String
  deviceFingerprint String
  terminalName      String?
  status            CellularDeviceStatus  @default(PENDING_APPROVAL)
  approvedByUserId  String?
  approvedAt        DateTime?
  pairingNonce      String?               @unique
  pairingExpiresAt  DateTime?
  lastSeenAt        DateTime?
  lastIp            String?
  // timestamps, relations, indexes
}

model CellularAuditEvent {
  id                    String   @id @default(cuid())
  terminalId            String
  employeeId            String?
  action                String
  timestamp             DateTime @default(now())
  managerReauthByUserId String?
  authDecisionSource    String
  success               Boolean
  metadata              Json?
  // relations, indexes
}

// ServerNode additions
model ServerNode {
  role           ServerNodeRole @default(PRIMARY)
  pairedNodeId   String?
  virtualIp      String?
  replicationLag Float?
  pgRole         String?
  isVipOwner     Boolean @default(false)
}

// Phase 6 — CloudLocation additions
model CloudLocation {
  canonicalLocationId String?  // Neon Location.id — kills posLocationId bridge field
  // posLocationId deprecated (kept for backward compat)
}
```
