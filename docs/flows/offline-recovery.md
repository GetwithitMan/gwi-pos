# Flow: Offline Recovery

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches connectivity state, outbox drain, delta sync, terminal status, or NUC heartbeat, read this doc first.

---

## 1. Purpose

**Trigger:** An Android register or PAX device reconnects to the NUC after a period of being offline (NUC unreachable, network disruption, or device sleep/wake cycle).

**Why it matters:** Sync integrity — mutations queued during the offline period must reach the NUC in the correct order, get server-assigned `serverSequence` values, and project into `OrderSnapshot`. The POS must never lose a mutation, reorder events, or block staff operations while recovery runs in the background.

**Scope:** `gwi-android-register` (primary offline client), `gwi-pos` NUC API + Socket.io (recovery authority), Neon cloud sync (separate concern — does NOT block recovery). The web POS register was removed in April 2026.

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | None required; `SYNC_UPSTREAM_INTERVAL_MS` (5s) and `SYNC_DOWNSTREAM_INTERVAL_MS` (5s) control background Neon sync (separate). `CLOUD_RELAY_URL` enables instant cloud→NUC push. |
| Hardware required | NUC reachable on local network at `http://{NUC_IP}:3005`; Android or web client with stored `deviceToken` or session |
| Permissions required | Bearer `deviceToken` (Android) or session cookie (web) — same credentials from original login |
| Online / offline state | Terminal was in Red/Unavailable state (10s+ no heartbeat). This flow begins when heartbeat resumes. |
| Prior state | Android Room DB has `OrderEventEntity` records with `status = PENDING` (mutations queued during offline period). Web POS has `PendingOrder` / `PendingPayment` in IndexedDB via Dexie. |

---

## 3. Sequence (Happy Path)

**"Offline" in this system means:** Android (or PAX device) cannot reach the NUC at `http://{NUC_IP}:3005`. This is distinct from the NUC losing its Neon cloud connection — NUC-to-Neon is a background sync concern and NEVER blocks POS operations.

```
1. [CLIENT]     Connectivity state during offline period:
                Green  → NUC reachable, socket connected (normal)
                Amber  → 3s without successful NUC response
                         → ConnectivityWatcherImpl shows amber warning banner
                         → Normal operation continues; mutations queue in outbox
                Red    → 10s without successful NUC response
                         → isUnavailablePhase = true in ConnectivityState
                         → UnavailableOverlay composable shown (all taps blocked)
                         → PinLoginViewModel blocks new logins
                         → Mutations continue to queue in Room DB outbox

2. [CLIENT]     During offline: Android mutations queue in Room DB
                → OrderEventEntity: status = PENDING, deviceCounter incremented per order
                → New orders created with offlineId UUID for deduplication
                → SAF payments (if card reader offline): separate queue
                  via POST /api/payments/sync (not covered in this flow)

3. [CLIENT]     NUC heartbeat resumes
                → POST /api/hardware/terminals/heartbeat-native succeeds
                → firstNucFailureAt cleared in ConnectivityState
                → isUnavailablePhase = false
                → UnavailableOverlay dismissed automatically
                → Amber banner clears

4. [CLIENT]     Android: EventSyncWorker begins outbox drain (FIFO)
                → Queries Room DB for OrderEventEntity WHERE status = PENDING
                  ORDER BY deviceCounter ASC (per-order sequence preserved)
                → Batches PENDING events → POST /api/order-events/batch
                → Each batch: [{ eventId, orderId, deviceId, deviceCounter,
                                 type, payloadJson, schemaVersion }]
                → CRITICAL: events sent in deviceCounter order per orderId

5. [API]        src/app/api/order-events/batch/route.ts processes each event:
                → withVenue() validates deviceToken → locationId
                → Per-event idempotency check on eventId
                  → If eventId already in OrderEvent table → skip (return 200)
                → INSERT INTO OrderEvent with PG SEQUENCE nextval('order_event_server_seq')
                  → serverSequence assigned monotonically (never client-generated)
                → emitOrderEvent() → ingester.ts → reducer.ts (full replay)
                → OrderSnapshot rebuilt for each affected orderId

6. [CLIENT]     Android also sends delta sync request:
                → POST /api/sync/delta?lastEventId={lastKnownServerSequence}
                → Receives: all OrderEvents that occurred on NUC since lastEventId
                  (e.g., web POS mutations during the offline period)
                → ingestRemoteEvent(): INSERT IGNORE by eventId (dedup)
                → reducer.ts replays full event log → CachedOrderEntity updated
                → UI reflects any orders modified by other terminals during offline

7. [BROADCAST]  Socket reconnects:
                → Android: socket.connect() with { auth: { deviceToken } }
                → server.ts middleware validates deviceToken
                → socket.join(`location:${locationId}`)
                → connectedTerminals.set(terminalId, { socketId, locationId, lastSeenAt: NOW() })
                → emitToLocation(locationId, 'terminal:status_changed',
                    { terminalId, isOnline: true, lastSeenAt: NOW(), source: 'heartbeat-native' })
                → /terminals page updates; toast.error cleared, terminal shows online

8. [BROADCAST]  Web POS: socket reconnect handler fires:
                → socket.on('connect', () => { socket.emit('join:location', { locationId }); fetchOrders() })
                → Orders list refreshes after reconnect (debounced 150ms)
                → Any missed order:event broadcasts replayed via delta sync

9. [SIDE EFFECTS] Neon upstream sync (SEPARATE — does NOT block steps 3-8):
                → upstream-sync-worker.ts runs every 5s independently
                → Queries local PG: WHERE syncedAt IS NULL OR updatedAt > syncedAt
                → Batches 50 rows → upserts to Neon via neonClient
                → Updates syncedAt on success
                → Neon sync failure does NOT affect NUC operation or Android recovery
                → POS API routes NEVER touch neonClient directly

10. [SIDE EFFECTS] Dead-letter handling (if any queued events fail after retries):
                → After 5 retry attempts (exponential backoff): 5s, 10s, 20s, 30s cap
                → CloudEventQueue.status = 'dead_letter'
                → DeadLetterEvent alert shown to manager
                → Max 1000 cloud events per location (oldest auto-pruned)

11. [SIDE EFFECTS] POS stale sweep (background):
                → socket-server.ts runs stale sweep every 60s
                → Any terminal with lastSeenAt > 120s ago → marked offline
                → emitToLocation: terminal:status_changed { isOnline: false }
                → connectedTerminals map entry removed

12. [SIDE EFFECTS] NUC restart recovery (if NUC itself restarted):
                → Socket events replay from PG (SocketEventLog L2 buffer, 30min TTL)
                → Reconnecting clients catch up from PG without data loss
                → CFD pairings rehydrate from Terminal.metadata (JSONB)
                → Cloud relay (cloud-relay-client.ts) reconnects automatically
                  with exponential backoff (1s–30s)
                → After relay reconnect, DATA_CHANGED events trigger immediate
                  downstream sync (no need to wait for 5s polling interval)
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `terminal:status_changed` | `{ terminalId, isOnline: true, lastSeenAt, source }` | POS socket-server.ts | `/terminals` page, fleet dashboard | On socket reconnect (step 7) |
| `terminal:status_changed` | `{ terminalId, isOnline: false, lastSeenAt }` | POS stale sweep | `/terminals` page | On 120s stale timeout (step 11) |
| `order:event` | `{ eventId, orderId, serverSequence, type, payload }` | POS API (`emitter.ts`) | All location clients | After each OrderEvent write (step 5) |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `Terminal` | `isOnline: true`, `lastSeenAt: NOW()` | Heartbeat resumes (step 3) and every 30s after |
| `Terminal` | `isOnline: false`, `lastSeenAt` (stale) | 120s stale sweep (step 11) |
| `OrderEvent` | INSERT for each drained outbox event (serverSequence assigned) | Step 5 |
| `OrderSnapshot` | Full rebuild from event replay per affected orderId | Step 5 |
| `CloudEventQueue` | `status`: pending → processing → completed / dead_letter | Step 9–10 |
| Room `OrderEventEntity` (Android) | `status`: PENDING → SYNCED | After NUC batch confirms (step 4–5) |
| Room `CachedOrderEntity` (Android) | Updated from delta sync events | Step 6 |
| `connectedTerminals` map (in-memory) | Entry added on reconnect, removed on stale sweep | Steps 7 and 11 |
| `SocketEventLog` (PG) | Events replayed to reconnecting clients after NUC restart | Step 12 |
| `Terminal.metadata` (JSONB) | CFD pairings rehydrated on NUC restart | Step 12 |

**Snapshot rebuild points:** Step 5 — every OrderEvent processed during outbox drain triggers a full `OrderSnapshot` rebuild via `reducer.ts` (pure replay from entire event log ordered by `serverSequence`).

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Outbox has conflicting events from multiple terminals** | `serverSequence` is the conflict resolution mechanism — last event with highest `serverSequence` wins in the reducer. Each terminal's events are processed in the order received at the NUC. Android's FIFO drain ensures per-device ordering is preserved. |
| **Neon cloud sync fails during recovery** | Neon sync failure is completely independent of NUC recovery. Local PG remains fully operational. `NEON_DATABASE_URL` is the sync target only. `DATABASE_URL` on NUC always points to `localhost:5432`. POS operations continue normally. |
| **Multiple terminals reconnect simultaneously** | Each terminal gets its own delta sync (`POST /api/sync/delta?lastEventId=N` with its own `lastEventId`). The NUC processes each independently. No global lock needed — idempotency at `eventId` level prevents duplicates. |
| **SAF payments queued during offline** | Store-and-forward (SAF) card payments use a separate queue via `POST /api/payments/sync`. This is independent of the order event outbox and follows its own retry/drain logic. Do not conflate with order event outbox drain. |
| **Event in outbox references an order that was closed by another terminal** | POS reducer applies the event; if the event type is blocked on closed orders (12 of 17 types are), the event is rejected with 409. Android surfaces an error. The order remains closed. |
| **lastEventId unknown (fresh install or wiped device)** | Android sends `POST /api/sync/bootstrap` instead of delta sync. Full snapshot + all pending events downloaded. No gap possible after bootstrap. |
| **Outbox drain exceeds server capacity** | `EventSyncWorker` batches events. If server returns 429 or 503, backoff and retry. Dead-letter threshold: 5 attempts. |
| **offlineId deduplication (offline-created orders)** | Orders created while offline carry an `offlineId` UUID. `POST /api/sync/outbox` checks `offlineId` before creating. Duplicate submission returns 200 with existing orderId. |
| **Web POS offline (IndexedDB)** | Browser client uses `src/lib/offline-manager.ts` (Dexie IndexedDB). Detection: `navigator.onLine` + 5-second health check to `/api/health`. Zombie Wi-Fi: 2 consecutive failures → "degraded" state. Queue: PendingOrder, PendingPayment in IndexedDB. Recovery: drain via `POST /api/orders/sync` and `POST /api/payments/sync`. |

---

## 7. Invariants (Never Break These)

- **[INVARIANT-1] NEVER block POS operations on Neon sync.** Neon upstream/downstream sync runs in background workers on independent intervals (5s / 15s). No POS operation — order creation, payment, login, order send — may wait on Neon connectivity. If `NEON_DATABASE_URL` is unreachable, sync fails silently and retries. Local PG is always the primary.

- **[INVARIANT-2] NEVER use client timestamps.** All `createdAt`, `updatedAt`, `syncedAt` use DB-generated `NOW()` (Prisma `@default(now())` / `@updatedAt`). Android device clocks can drift. `serverSequence` from PG SEQUENCE is the canonical ordering mechanism, not timestamps.

- **[INVARIANT-3] Outbox drain MUST be FIFO per orderId.** Events in the Android Room DB outbox MUST be sent to the NUC in `deviceCounter` ascending order per `orderId`. Out-of-order drain produces incorrect `OrderState` because the reducer is append-only.

- **[INVARIANT-4] Idempotency is required on all outbox events.** NUC checks `eventId` uniqueness before writing `OrderEvent`. If Android retries a batch (network failure mid-request), duplicate events are silently ignored. The `eventId` is a ULID/UUID generated by Android at mutation time — not regenerated on retry.

- **[INVARIANT-5] NEVER query Neon from API routes.** `db.*` in all API routes points to local PG (`DATABASE_URL=localhost:5432` on NUC). The `neonClient` in `src/lib/neon-client.ts` is used exclusively by background sync workers. API routes that touch `neonClient` are critical bugs.

- **[INVARIANT-6] DATABASE_URL on NUC must point to localhost.** If `DATABASE_URL` on a NUC points to `neon.tech`, the system has no offline capability. This is a critical bug — file it immediately and fix before any other work.

- **[INVARIANT-7] serverSequence is assigned by PG SEQUENCE — never by client.** Android NEVER generates `serverSequence`. The PG SEQUENCE `order_event_server_seq` is the only source of canonical ordering. Client-assigned sequences would break multi-terminal conflict resolution.

If any invariant is broken, the fix is: check `DATABASE_URL` on the NUC, verify `neonClient` is only imported in background workers, and trace the outbox drain through `EventSyncWorker` → `POST /api/order-events/batch` → `emitter.ts`.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/offline-sync.md` | Bootstrap, delta, outbox, dead-letter queue, Neon sync worker details |
| `docs/features/orders.md` | OrderEvent idempotency, serverSequence model, OrderSnapshot rebuild |
| `docs/flows/android-sync.md` | The normal (online) mutation flow that this flow recovers from |
| `docs/guides/ARCHITECTURE-RULES.md` | 7 offline-first NEVER rules, clock discipline, DATABASE_URL rules |
| `docs/guides/ANDROID-INTEGRATION.md` | commandClient-first invariant, BootstrapWorker, delta sync patterns |
| `docs/guides/SOCKET-REALTIME.md` | Socket reconnect behavior, room rejoin pattern, stale sweep |

### Features Involved
- **Offline Sync** — outbox drain, bootstrap, delta sync, dead-letter queue, Neon background workers are all offline-sync concerns
- **Orders** — OrderEvent idempotency and serverSequence assignment are the core of outbox drain
- **Hardware** — Terminal heartbeat-native drives connectivity state; connectedTerminals map tracks recovery
- **Android Sync** — This flow is the recovery path for the normal android-sync.md mutation flow

---

*Last updated: 2026-03-14*
