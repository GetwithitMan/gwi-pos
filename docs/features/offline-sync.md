# Feature: Offline Sync

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Cloud-primary sync architecture (since Phase 6, March 2026). **Neon cloud is the canonical source of truth** for all POS data in normal operation. The NUC (local PostgreSQL) serves as the local execution and continuity layer — it runs all POS operations locally for speed and resilience, replicating mutations upstream to Neon. During connectivity outages, the NUC temporarily becomes write authority, queueing writes in `OutageQueueEntry` for FIFO replay on recovery (neon-wins conflict resolution; cloud-originated data takes precedence on timestamp ties per INV-12). Android syncs TO NUC, not directly to Neon. All mutations work offline via queue-based sync with exponential backoff retry and dead-letter handling.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Sync workers, outbox, offline manager, all API routes | Full |
| `gwi-android-register` | Bootstrap, delta sync, outbox, dead-letter queue | Full |
| `gwi-cfd` | N/A (reads from POS via socket) | None |
| `gwi-backoffice` | Cloud event ingestion | Partial |
| `gwi-mission-control` | Fleet heartbeat, terminal status | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | Offline indicator (toast/banner) | All staff |
| Admin | `/admin/sync-audit` | Managers |
| Admin | Terminal status page | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/sync/sync-config.ts` | Registry of 170+ models with direction, owner, FK priority, batch size |
| `src/lib/sync/upstream-sync-worker.ts` | NUC → Neon: pushes orders, payments, shifts (5s interval) |
| `src/lib/sync/downstream-sync-worker.ts` | Neon → NUC: pulls menu, employees, settings (5s interval) |
| `src/lib/cloud-event-queue.ts` | Queue event batching, retry logic, dead-letter handling |
| `src/lib/offline-manager.ts` | Client-side offline queue (IndexedDB via Dexie) |
| `src/lib/offline-db.ts` | IndexedDB schema: PendingOrder, PendingPrintJob, PendingPayment |
| `src/lib/neon-client.ts` | Secondary PrismaClient for Neon cloud (sync workers ONLY) |
| `src/lib/socket-server.ts` | Terminal connectivity tracking, stale heartbeat sweep |
| `src/app/api/sync/bootstrap/route.ts` | Full sync payload for Android bootstrap |
| `src/app/api/sync/delta/route.ts` | Incremental delta updates |
| `src/app/api/sync/events/route.ts` | Event replay for single order (cursor-based) |
| `src/app/api/sync/outbox/route.ts` | Sync offline-created orders to server |
| `src/app/api/sync/floor-plan/route.ts` | Bootstrap floor plan data |
| `src/app/api/payments/sync/route.ts` | Offline payment sync (store-and-forward) |
| `src/app/api/hardware/terminals/heartbeat-native/route.ts` | Native heartbeat |
| `src/app/api/hardware/terminals/heartbeat/route.ts` | Web terminal heartbeat |
| `src/app/api/monitoring/health-check/route.ts` | Health check logging |
| `src/lib/cloud-relay-client.ts` | Outbound WebSocket to cloud relay for instant downstream wake-up |
| `src/lib/socket-event-buffer.ts` | Persistent L2 socket event buffer (PG-backed, 30min TTL) |
| `src/app/api/system/outage-queue/route.ts` | Outage queue reconciliation (status counts + last 50 entries) |
| `src/app/api/health/sockets/route.ts` | Socket health monitoring (metrics, relay status, sync status) |
| `src/app/api/reports/outage-payments/route.ts` | Outage payment reconciliation report |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/sync/bootstrap` | Bearer (deviceToken) | Full sync payload (menu, employees, tables, orders) |
| `GET` | `/api/sync/delta` | Bearer (deviceToken) | Incremental delta since last sync |
| `GET` | `/api/sync/events` | Bearer (deviceToken) | Event replay for single order (by serverSequence) |
| `POST` | `/api/sync/outbox` | Bearer (deviceToken) | Sync offline-created orders with deduplication |
| `GET` | `/api/sync/floor-plan` | Bearer (deviceToken) | Floor plan bootstrap |
| `POST` | `/api/payments/sync` | Bearer (deviceToken) | Offline payment sync (store-and-forward) |
| `POST` | `/api/hardware/terminals/heartbeat-native` | Bearer (deviceToken) | Native heartbeat (updates isOnline, lastSeenAt) |
| `POST` | `/api/hardware/terminals/heartbeat` | Cookie | Web terminal heartbeat |
| `GET/POST` | `/api/monitoring/health-check` | Employee PIN | Health check logging |
| `GET` | `/api/system/outage-queue` | Manager | Outage queue reconciliation (status counts + last 50 entries) |
| `GET` | `/api/reports/outage-payments` | Manager | Payments flagged during outage (summary + detail) |
| `GET` | `/api/health/sockets` | Internal | Socket health, relay status, sync worker metrics |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `terminal:status_changed` | `{ terminalId, isOnline, lastSeenAt, source }` | Socket connect/disconnect, heartbeat timeout |

---

## Data Model

```
CloudEventQueue {
  id              String
  locationId      String
  eventType       String
  body            Json
  status          String            // pending | processing | completed | failed | dead_letter
  nextRetryAt     DateTime
  attempts        Int               // default 0
  maxAttempts     Int               // default 5
  lastError       String?
  deletedAt       DateTime?
}

SyncAuditEntry {
  id              String
  locationId      String
  orderId         String
  terminalId      String
  terminalName    String
  employeeId      String?
  amount          Decimal
  idempotencyKey  String
  status          String            // SUCCESS | DUPLICATE_BLOCKED | OFFLINE_SYNC | VOIDED | FAILED
  statusNote      String?
}

Terminal {
  id              String
  locationId      String
  name            String
  isOnline        Boolean
  lastSeenAt      DateTime?
  deviceToken     String?           // unique, for Bearer auth
  isPaired        Boolean
  category        Enum              // FIXED_STATION | HANDHELD
  platform        Enum              // BROWSER | ANDROID | IOS
}
```

---

## Business Logic

### Sync Architecture
```
                    ┌──────────────────────────────────────────────┐
                    │        Neon Cloud (canonical SOR)            │
                    └──────────┬───────────────┬───────────────────┘
                               │               │
                 upstream (5s) ↑               ↓ downstream (5s) + cloud relay WS (instant)
                               │               │
                    ┌──────────┴───────────────┴───────────────────┐
                    │   NUC (local execution + outage continuity)  │
                    └──────────┬───────────────┬───────────────────┘
                               │               │
              bootstrap/delta  ↓               ↑ outbox sync
                               │               │
                    ┌──────────┴───────────────┴───────────────────┐
                    │              Android Devices                  │
                    └──────────────────────────────────────────────┘

Normal operation:  Neon is SOR → NUC executes locally → replicates upstream
Outage mode:       NUC queues writes in OutageQueueEntry → FIFO replay on recovery
Conflict rule:     neon-wins (cloud-originated data wins on timestamp ties)
```

### Upstream Sync (NUC → Neon, every 5s)
Replicates local mutations to the canonical cloud SOR.
1. Query local PG for records where `syncedAt IS NULL` or `updatedAt > syncedAt`
2. Batch 50 rows per cycle
3. Upsert to Neon via raw SQL
4. Update `syncedAt` on success
5. Priority order: Orders/Payments (10) → Shifts (35) → Tips (45) → Inventory (50)

### Downstream Sync (Neon → NUC, every 5s)
Pulls authoritative cloud data into the local execution layer.
1. Use high-water mark (last `syncedAt` timestamp)
2. Pull changed records from Neon
3. Batch 100 rows
4. Neon-wins conflict resolution based on `updatedAt` (cloud data takes precedence on ties)
5. Priority order: Organization (1) → Location (2) → Employee (5) → Menu (6-9)
6. Cloud relay WebSocket accelerates delivery — `DATA_CHANGED` event triggers immediate sync cycle

### Cloud Relay
Outbound WebSocket from NUC to cloud (`cloud-relay-client.ts`). Accelerates cloud→NUC data delivery and enables MC real-time dashboard.
- **Inbound events:** `DATA_CHANGED` (triggers immediate downstream sync), `CONFIG_UPDATED`, `COMMAND`
- **Outbound events:** `SYNC_SUMMARY` (after each upstream cycle with rows synced > 0), `OUTAGE_DEAD_LETTER`, `HEALTH`
- **Safety switch:** 5 consecutive failures → 2s polling fallback
- **Env var:** `CLOUD_RELAY_URL` required; relay disabled when unset

### Outage Continuity (OutageQueueEntry)
When the NUC detects loss of Neon connectivity, it enters outage mode and temporarily becomes write authority. All mutations during outage are queued as `OutageQueueEntry` records for deterministic replay:
1. Writes continue locally with zero interruption — POS operates 100% offline
2. Each mutation is captured in OutageQueueEntry with JSONB metadata (retryCount tracking)
3. On recovery, the outage-replay-worker replays entries FIFO (oldest first, 10s interval)
4. Conflict resolution: **neon-wins** — cloud-originated data always takes precedence on timestamp ties (INV-12)
5. Failed replays retry with backoff; persistent failures move to dead letter for manual review

### Outage Payment Flagging
Payments processed during outage mode (`isInOutageMode() === true`) are automatically flagged with `needsReconciliation = true`. This applies to all 4 payment routes: pay, close-tab, refund, void. A reconciliation report is available at `GET /api/reports/outage-payments` (summary + detail of flagged payments) for EOD/shift close review.

### Client-Side Offline (IndexedDB)
1. Connection detection: `navigator.onLine` + 5-second health check to `/api/health`
2. Zombie Wi-Fi detection: 2 consecutive health check failures → "degraded"
3. Queue orders, print jobs, payments in IndexedDB
4. Exponential backoff retry (5s, 10s, 20s, 30s cap)
5. Status tracking: pending → syncing → synced (or failed)

### Terminal Status Tracking
- Connected terminals tracked in `Map<terminalId, { socketId, locationId }>`
- On socket disconnect: mark terminal offline, emit `terminal:status_changed`
- Stale heartbeat sweep every 60s: mark terminals offline if `lastSeenAt > 120s`

### Edge Cases & Business Rules
- **CRITICAL**: Neon is the canonical SOR — NUC is the local execution layer, not the source of truth
- **CRITICAL**: DB-generated `NOW()` only — NEVER client timestamps
- **CRITICAL**: `DATABASE_URL` on NUC MUST point to `localhost:5432/thepasspos`, NEVER neon.tech (NUC executes locally for speed/resilience; sync workers handle replication)
- `NEON_DATABASE_URL` is separate env var for sync workers only
- POS API routes NEVER touch Neon directly — all local reads/writes go through NUC PG
- During outage, NUC queues writes in OutageQueueEntry; on recovery, FIFO replay with neon-wins resolution
- All mutations enqueue to outbox when offline
- Dead-letter queue for events that exceed max retry attempts (5)
- Max 1000 cloud events per location (oldest pruned)
- Android sync: bootstrap on startup, periodic delta, dead-letter queue

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| All features | Every mutation must handle offline gracefully |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| All features | Every feature's mutations feed into sync pipeline |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Clock discipline** — all timestamps use DB-generated NOW()
- [ ] **DATABASE_URL** — never points to Neon on NUC
- [ ] **Sync priority** — new models need entry in sync-config.ts
- [ ] **Idempotency** — offline mutations must be dedup-safe
- [ ] **Android** — bootstrap and delta endpoints return new fields

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View sync audit | Manager role | High |
| Trigger manual sync | Manager role | Critical |

---

## Known Constraints & Limits
- Upstream sync interval: 5 seconds (configurable via `SYNC_UPSTREAM_INTERVAL_MS`)
- Downstream sync interval: 5 seconds (configurable via `SYNC_DOWNSTREAM_INTERVAL_MS`, reduced from 15s in Phase 7)
- Cloud relay auto-reconnect: exponential backoff 1s–30s, 60s heartbeat keepalive
- Socket event buffer TTL: 30 minutes (PG L2), cleanup every 5 minutes
- Cloud event queue: max 5 retry attempts, exponential backoff up to 1 hour
- Max 1000 cloud events per location (auto-pruned)
- Stale heartbeat timeout: 120 seconds
- Health check: 7 check types (ORDER_CREATION, PAYMENT_PROCESSING, PRINTER_CONNECTION, DATABASE_QUERY, API_RESPONSE, KDS_CONNECTION, NETWORK_CONNECTIVITY)

### Sync Safety Invariants (updated 2026-03-11)

These rules were hardened via penetration testing and production debugging:

- **HWM initialization**: When no persisted HWM exists, always use epoch (`1970-01-01`) — NEVER `MAX(updatedAt)` from local PG. The MAX approach creates "HWM gaps" where Neon rows with timestamps before the local max are permanently skipped. Epoch triggers a safe full re-sync (ON CONFLICT handles duplicates).
- **HWM advancement**: Only successful rows advance `maxSyncedAt`. Failed rows retry next cycle.
- **HWM persistence**: HWMs are stored in `_gwi_sync_state` table and survive process restarts.
- **Business-key conflict resolution**: Cloud-owned downstream models can declare a `businessKey` in sync-config (e.g., `['categoryId', 'name']` for MenuItem). Before upserting, the sync worker checks if a local row exists with matching business key but different ID. If so, the local row is deleted (Neon is authoritative). This resolves ID divergence from the dual-DB transition.
- **Business keys configured**: MenuItem (`categoryId, name`), Category (`locationId, name`), Table (`locationId, name`), Section (`locationId, name`), ModifierGroup (`locationId, name`), Modifier (`modifierGroupId, name`).
- **Unique constraints**: MenuItem, ModifierGroup, and Modifier have partial unique indexes on their business keys (`WHERE deletedAt IS NULL`). Migrations 042 + 043 add these with automated dedup.
- **Bidirectional sync marker**: All NUC mutations to Order/Payment/OrderItem MUST set `lastMutatedBy: 'local'`. Missing this causes silent sync data loss.
- **FulfillmentEvent dedup**: `handleCloudFulfillment` checks for existing events by orderId before creating new ones. Prevents duplicate printing when send/route.ts already created events.
- **PendingDeduction idempotency**: Uses `ON CONFLICT ("orderId") DO NOTHING` — no SELECT-before-INSERT pattern.
- **0-item deduction guard**: If a paid/closed order has 0 items (OrderItems not yet synced), deduction returns `success: false` for retry. Prevents false-succeeded deductions.
- **Socket batching**: Downstream sync emits at most one `dispatchOpenOrdersChanged` per location per cycle.
- **Upstream resilience**: Per-row try/catch on `syncedAt` stamps. One failure doesn't block the batch.
- **OutageQueueEntry.metadata**: JSONB field for retryCount tracking. Added in migration 022.
- **CellularDevice guard**: `syncCellularDenyList()` checks table existence via `information_schema` (cached) before querying. Prevents log spam on NUCs without the HA/Cellular feature.
- **Cloud relay is NOT durability**: The cloud WebSocket relay (`cloud-relay-client.ts`) accelerates delivery but provides ZERO durability guarantees. All durable sync remains DB-backed. Relay failure falls back to 5s polling with no data loss.
- **Socket event log survives restart**: Events persist in PG `SocketEventLog` (30min TTL). On restart, reconnecting clients catch up from PG. CFD pairings rehydrate from `Terminal.metadata`.
- **Outage payment flagging**: Payments during outage are flagged `needsReconciliation = true` for EOD reconciliation. Report at `GET /api/reports/outage-payments`.

---

## Bidirectional Sync Protocol — Required Fields

Models with `direction: 'bidirectional'` in `sync-config.ts` sync both ways between Neon and the NUC. The downstream sync worker (Neon to NUC) ONLY pulls rows where `lastMutatedBy = 'cloud'`. This filtering mechanism is what makes bidirectional sync work without infinite loops, but it also means cloud mutations are invisible to downstream sync unless explicitly marked.

### Rules

1. **Any cloud/Vercel API route that mutates a bidirectional model MUST set `lastMutatedBy: 'cloud'`** in the Prisma `update()` or `create()` call. Without this, the change will exist in Neon but will never be delivered to the NUC via downstream sync.

2. **NUC-side mutations should set `lastMutatedBy: 'local'`** (or leave it null). This prevents the downstream sync from overwriting locally-made changes. The upstream sync worker picks up rows where `lastMutatedBy != 'cloud'`.

3. **Shared routes** that run on BOTH NUC and Vercel (e.g., Terminal CRUD, unpair, generate-code) MUST use `lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local'` to dynamically set the correct origin. Hardcoding either value causes silent sync loss in the other environment.

4. **The `skipFields` array** in sync-config.ts lists fields that are included in INSERT (new rows) but excluded from ON CONFLICT UPDATE. Use this for fields set locally on the NUC (e.g., `isPaired`, `deviceToken`, `lastSeenAt`) that should not be overwritten by downstream sync even though the model is otherwise cloud-owned.

5. **The bidirectional conflict guard** additionally checks `WHERE lastMutatedBy = 'cloud' OR lastMutatedBy IS NULL` on the ON CONFLICT UPDATE clause. This means locally-mutated rows will not be overwritten by downstream sync even if Neon has newer data for those rows.

### Current Bidirectional Models (as of 2026-03-22)

| Model | Owner | Conflict Strategy | skipFields | Notes |
|-------|-------|-------------------|------------|-------|
| Order, OrderItem, OrderDiscount, OrderCard, OrderItemModifier | both | quarantine | — | Core order data, dual-ingress |
| Payment | both | quarantine | — | Must set `lastMutatedBy: 'local'` on every NUC write |
| Terminal | cloud | neon-wins | isPaired, deviceToken, deviceFingerprint, deviceInfo, platform, appVersion, osVersion, pushToken, lastKnownIp, lastSeenAt, isOnline | Cloud-owned config with NUC-local operational state |
| BottleProduct | both | neon-wins | — | |
| SpiritCategory | both | neon-wins | — | |
| SpiritModifierGroup | both | neon-wins | — | |

### Anti-Pattern That Caused a 3-Day Outage

Cloud API routes that mutate bidirectional models without setting `lastMutatedBy: 'cloud'` will write to Neon successfully, but the downstream sync worker will never pick up the change (it filters on `lastMutatedBy = 'cloud'`). The NUC will never see the mutation.

```typescript
// WRONG — cloud mutation without lastMutatedBy
await db.terminal.update({
  where: { id },
  data: { pairingCode, pairingCodeExpiresAt: expiresAt },
})

// CORRECT — marks as cloud-originated so downstream sync delivers it to the NUC
await db.terminal.update({
  where: { id },
  data: { pairingCode, pairingCodeExpiresAt: expiresAt, lastMutatedBy: 'cloud' },
})
```

This is especially dangerous because:
- The Neon database has the correct data (the write succeeded)
- Cloud admin UI shows the correct state (it reads from Neon)
- But the NUC never receives the update, so the POS terminal never sees the change
- There is no error, no warning, no log entry — it is a silent data divergence

### Checklist for New Bidirectional Models

- [ ] Add `lastMutatedBy String?` column to the Prisma model
- [ ] Add model to `SYNC_MODELS` in `sync-config.ts` with `direction: 'bidirectional'`
- [ ] Audit ALL cloud API routes that write to this model — every one must set `lastMutatedBy: 'cloud'`
- [ ] Audit ALL NUC API routes that write to this model — every one must set `lastMutatedBy: 'local'`
- [ ] If the model has NUC-local operational fields, add them to `skipFields`

---

## Android-Specific Notes
- Bootstrap on startup: full payload via `GET /api/sync/bootstrap`
- Periodic delta sync via `GET /api/sync/delta`
- Event replay via `GET /api/sync/events?orderId=xxx&afterSequence=0`
- Outbox sync: `POST /api/sync/outbox` with deduplication via `offlineId`
- Dead-letter queue for failed mutations
- Bearer token auth via `Terminal.deviceToken`
- Native heartbeat every 30 seconds

---

## Instant Sync — pushUpstream() + notifyDataChanged() (added 2026-03-21)

### Instant Upstream Push (NUC → Neon)
Every upstream mutation route calls `pushUpstream()` after the DB write. This triggers an immediate upstream sync cycle instead of waiting for the 5s polling interval.

- **Mechanism:** `pushUpstream()` is a 100ms debounced call to the upstream sync worker's `syncNow()` method
- **Coverage:** 40 upstream mutation routes (orders, payments, tabs, shifts, tips, inventory, time clock, etc.)
- **Debounce:** 100ms — multiple rapid mutations (e.g., adding 5 items quickly) coalesce into a single sync cycle
- **Fallback:** If `pushUpstream()` fails or is unavailable, the 5s polling interval picks up the mutations
- **Pattern:**
```typescript
// In API route after DB write:
import { pushUpstream } from '@/lib/sync/upstream-sync-worker'
// ... mutation logic ...
void pushUpstream().catch(console.error) // fire-and-forget
```

### Instant Downstream Push (Neon → NUC)
All cloud-owned API routes call `notifyDataChanged()` after writing to Neon. This sends a `DATA_CHANGED` event through the cloud relay WebSocket, triggering an immediate downstream sync cycle on the NUC.

- **Coverage:** 99 downstream cloud-owned routes (menu, employees, settings, categories, modifiers, schedules, etc.)
- **Mechanism:** `notifyDataChanged(modelName)` → cloud relay → NUC receives `DATA_CHANGED` → immediate downstream sync
- **Targeted sync:** The `modelName` parameter allows the downstream worker to prioritize the changed model
- **11 downstream notification handlers:** Menu items, categories, modifiers, modifier groups, employees, schedules, settings, pricing rules, tax rules, print routing, reservations
- **Fallback:** If cloud relay is disconnected, the 5s polling interval handles sync

### Readiness Gates (BOOT → SYNC → ORDERS)
The NUC enforces a strict boot sequence before accepting orders:

1. **BOOT:** Local schema verified (`prisma db push`), seed data present, `_venue_schema_state` compatible
2. **SYNC:** First downstream sync cycle complete — menu, employees, settings pulled from Neon
3. **ORDERS:** All critical tables populated — venue can now take orders

Venues cannot take orders or process payments until the readiness gate reaches ORDERS state. The `/api/system/readiness` endpoint exposes the current gate state.

### Auto-Restart Workers After Schema Re-Check
When the NUC detects a schema change (via `_venue_schema_state` or `prisma db push`), sync workers are automatically restarted to pick up new columns/tables. This prevents stale Prisma clients from failing on new schema.

### DATA_CHANGED Event Buffering
`DATA_CHANGED` events from the cloud relay are buffered in the PG-backed socket event buffer (`SocketEventLog`). This provides:
- **Restart recovery:** If the NUC restarts while a `DATA_CHANGED` event is in flight, the event is replayed from PG on restart
- **Dedup:** Duplicate `DATA_CHANGED` events for the same model within 500ms are coalesced
- **TTL:** 30-minute retention in PG, cleanup every 5 minutes
- **Cache clear:** When `DATA_CHANGED` arrives, relevant caches (location settings, menu, employees) are invalidated before the sync cycle runs

---

## Related Docs
- **Domain doc:** `docs/domains/OFFLINE-SYNC-DOMAIN.md`
- **Algorithm spec:** `docs/features/OFFLINE-SYNC-ALGORITHM.md` (1456 lines)
- **Architecture rules:** `docs/guides/ARCHITECTURE-RULES.md`
- **Android integration:** `docs/guides/ANDROID-INTEGRATION.md`
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Offline Sync row

---

*Last updated: 2026-03-22*
