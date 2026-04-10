# Flow: Android Order Event Sync

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches Android-to-NUC order event flow, read this doc first.

---

## 1. Purpose

**Trigger:** An Android register user performs an order mutation (add item, send order, apply discount, void item, process payment, etc.) and the device emits an order event to the NUC.

**Why it matters:** Sync integrity — the Android device is the PRIMARY POS client. Every mutation it makes must be reliably received by the NUC, assigned a canonical `serverSequence`, projected into `OrderSnapshot`, and broadcast to all connected clients. Loss or reordering of events corrupts order state and financial data.

**Scope:** `gwi-android-register` (initiator), `gwi-pos` NUC API + Socket.io (authority), KDS screens (downstream receiver).

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | None required for baseline sync; `dualPricingEnabled` affects price fields in payloads |
| Hardware required | NUC reachable on local WiFi (`http://{NUC_IP}:3005`) |
| Permissions required | `pos.access` minimum; per-mutation permissions checked server-side via `requirePermission()` |
| Online / offline state | Happy path: Android is Green (NUC reachable, socket connected). Offline path covered in §6. |
| Prior state | An `OrderSnapshot` record must exist for the target `orderId` (created by `ORDER_CREATED` event) |

---

## 3. Sequence (Happy Path)

```
1. [CLIENT]     Android user taps action (e.g., "Add Item" button in OrderScreen.kt)
                → AddItemUseCase.kt invoked
                → OrderEventEntity written to Room DB with status=PENDING, clientSequence=N

2. [CLIENT]     UI optimistically updates via Room Flow observation
                → OrderReducer.reduce() applied locally on Android Room event log
                → OrderProjector.project() → CachedOrderEntity updated

3. [CLIENT]     EventSyncWorker collects PENDING events
                → Batches into POST /api/order-events/batch
                → Payload: [{ eventId, orderId, locationId, deviceId, deviceCounter,
                              type: "ITEM_ADDED", payloadJson, schemaVersion }]
                → Auth: Bearer deviceToken in Authorization header

4. [API]        src/app/api/order-events/batch/route.ts receives batch
                → withVenue() extracts locationId from device token
                → requirePermission() checks employee has pos.access (and per-type gates)
                → For each event: idempotency check on eventId (reject duplicates)
                → DB: INSERT INTO OrderEvent with PG SEQUENCE nextval('order_event_server_seq')
                      assigns serverSequence (monotonic, DB-generated, never client-supplied)

5. [DB]         OrderEvent record persisted with serverSequence assigned
                → Record: { eventId, orderId, locationId, deviceId, deviceCounter,
                            serverSequence, type, payloadJson, schemaVersion }

6. [EVENTS]     emitter.ts: emitOrderEvent(locationId, orderId, type, payload)
                → ingester.ts: loads all OrderEvents for orderId ordered by serverSequence
                → reducer.ts (pure state machine): replays events → OrderState
                → projector.ts: OrderState → OrderSnapshot (50+ fields rebuilt)
                → db.orderSnapshot.upsert({ where: { id: orderId }, ... })
                  lastEventSequence updated to highest serverSequence processed

7. [SNAPSHOT]   OrderSnapshot record updated in local PG
                → subtotalCents, taxTotalCents, totalCents, itemCount, status, isClosed
                  all recalculated from full event replay

8. [BROADCAST]  socket-dispatch.ts: emitToLocation(locationId, 'order:event', {
                  eventId, orderId, serverSequence, type, payload, deviceId
                })
                → All clients in location:{locationId} room receive event
                → Sending Android device also receives it (confirms server accepted)
                → KDS receives if type is ORDER_SENT (routes kds:order-received)

9. [CLIENT]     Android socket receives order:event back from NUC
                → ingestRemoteEvent(): INSERT IGNORE (dedup by eventId)
                → Already projected locally — no redundant recompute unless sequence gap detected

10. [SIDE EFFECTS] If type = ORDER_SENT:
                → emitToLocation: kds:order-received (tag-routed to PrepStation screens)
                → printKitchenTicket(orderId) — fire-and-forget, 7s TCP timeout
                   void printKitchenTicket(id).catch(() => {})
                If type = PAYMENT_APPLIED:
                → emitToLocation: order:paid
                → Inventory deduction (fire-and-forget)
                → Cloud event enqueued (upstream sync to Neon, 5s interval)
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `order:event` | `{ eventId, orderId, serverSequence, type, payload, deviceId }` | POS API (`emitter.ts`) | All clients at location, Android, KDS | Must follow OrderEvent DB write (step 5) |
| `order:created` | `{ orderId, orderNumber, orderType, tableName, employeeName }` | POS API | All clients, KDS | On ORDER_CREATED event type only |
| `kds:order-received` | Full order event, tag-routed | POS API (`socket-dispatch.ts`) | KDS screens matching route tags | On ORDER_SENT event type only |
| `kds:item-status` | `{ orderId, itemId, kitchenStatus }` | POS API | Android, KDS | On COMP_VOID_APPLIED |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `OrderEvent` | INSERT (new row, serverSequence assigned) | Step 4–5 |
| `OrderSnapshot` | All financial totals, `lastEventSequence`, `itemCount`, `status`, `isClosed` | Step 6–7 (full replay) |
| `OrderItemSnapshot` | INSERT/UPDATE/DELETE per item change | Step 7 |
| Room `OrderEventEntity` (Android) | `status`: PENDING → SYNCED | After NUC confirms batch |
| Room `CachedOrderEntity` (Android) | Optimistic update at step 2; confirmed at step 9 | Steps 2 and 9 |

**Snapshot rebuild points:** Step 6–7 (full event replay from `OrderEvent` log ordered by `serverSequence`). The reducer is pure — identical events always produce identical state.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Android offline to NUC** | `OrderEventEntity` stays PENDING in Room DB. `EventSyncWorker` retries with exponential backoff. UI shows Red/Amber connectivity state. All taps remain functional locally; mutations queue in outbox. On reconnect: drain outbox FIFO via `POST /api/sync/outbox` before new events. |
| **Duplicate event (retry)** | Server checks `eventId` uniqueness before INSERT. Duplicate returns 200 (idempotent) without reprocessing. Android marks event SYNCED. |
| **NUC unreachable >10s** | `isUnavailablePhase = true` in `ConnectivityState`. `UnavailableOverlay` composable blocks all taps. `PinLoginViewModel` blocks login. |
| **NUC unreachable 3–10s** | Amber warning banner shown via `ConnectivityWatcherImpl`. Normal operation continues; mutations queue. |
| **Reconnect during active order** | Android `BootstrapWorker` or `catchUpOrderEvents` (paginated) calls `GET /api/sync/delta?lastEventId=N` → receives all missed events → applies via `ingestRemoteEvent()` → snapshot rebuilt from full event log. |
| **Sequence gap detected** | Android sees `serverSequence` jump → triggers `catchUpOrderEvents` paginated replay from last known sequence. |
| **Permission denied on batch** | POS returns 403 for the specific event type. Android surfaces error to user. Other events in batch may succeed (per-event permission check). |
| **Closed order mutation** | 12 of 17 event types are blocked on closed orders by the reducer. POS returns 409. Android `OrderViewModel` prevents most of these at the UI layer. |
| **Bootstrap flow (first connect)** | Android `BootstrapWorker` → `GET /api/sync/bootstrap` → full snapshot + all pending events + menu + employees + settings → Room DB populated → socket registers with `deviceToken` in `socket.handshake.auth`. |
| **Delta sync (subsequent connect)** | Android → `GET /api/sync/delta?lastEventId=N` → missed events since `lastEventId` → applied in serverSequence order. |

---

## 7. Invariants (Never Break These)

- **[INVARIANT-1] commandClient for mutations, never socket.** Android MUST use `commandClient` (HTTP) for all order mutations (POST to `/api/order-events/batch`). The `socketClient` (Socket.IO) is receive-only. Emitting mutations over socket bypasses `serverSequence` assignment and breaks conflict resolution.

- **[INVARIANT-2] serverSequence is assigned by PG SEQUENCE only.** The NUC's Postgres SEQUENCE `order_event_server_seq` assigns `serverSequence`. Android NEVER generates `serverSequence`. Client-generated sequences cause ordering corruption across multi-device deployments.

- **[INVARIANT-3] Outbox drain MUST be FIFO.** When draining the Room DB outbox after a reconnect, events MUST be sent in `deviceCounter` order per order. Out-of-order drain produces incorrect `OrderState`.

- **[INVARIANT-4] NEVER write to OrderSnapshot without serverSequence.** Every `OrderSnapshot` write is the result of replaying events that all have server-assigned sequences. Direct snapshot writes without event sourcing corrupt the audit trail.

- **[INVARIANT-5] DB-generated timestamps only.** All `createdAt`, `updatedAt`, `syncedAt` fields use Prisma `@default(now())` / `@updatedAt`. Client timestamps are rejected.

- **[INVARIANT-6] Reducer is pure.** `reducer.ts` has no side effects. It must produce identical output for identical input. Never add DB calls, socket emissions, or HTTP calls inside the reducer.

- **[INVARIANT-7] Socket events scoped by locationId.** `emitToLocation(locationId, ...)` is always called with the validated `locationId` from `withVenue()`. Global broadcasts are forbidden.

If any invariant is broken, the fix is: trace the mutation path back through `emitter.ts` → `ingester.ts` → `reducer.ts` → `projector.ts` and verify the event log is complete and ordered.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/offline-sync.md` | Outbox, bootstrap, delta sync, dead-letter queue patterns |
| `docs/features/orders.md` | 17 event types, OrderEvent/OrderSnapshot models, business rules |
| `docs/guides/ANDROID-INTEGRATION.md` | commandClient-first invariant, dual pricing, touch rules |
| `docs/guides/SOCKET-REALTIME.md` | emitToLocation() usage, fire-and-forget, dedup rules |
| `docs/guides/ARCHITECTURE-RULES.md` | Offline-first rules, DB ownership, clock discipline |
| `docs/guides/ORDER-LIFECYCLE.md` | Event emission pattern, reducer purity, snapshot rebuild |

### Features Involved
- **Orders** — event log, reducer, projector, snapshot are the core of this flow
- **Offline Sync** — bootstrap, delta, outbox drain, dead-letter queue wrap the transport layer
- **Hardware** — terminal `deviceToken` authenticates the Android device; heartbeat-native tracks connectivity
- **KDS** — ORDER_SENT events route downstream to KDS screens via tag-based socket rooms

---

*Last updated: 2026-03-03*
