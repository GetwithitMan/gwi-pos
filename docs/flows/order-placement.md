# Flow: Order Placement (Send to Kitchen)

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches this journey, read this doc first.

---

## 1. Purpose

**Trigger:** A server (web POS or Android) taps "Send Order" — selected items on the register screen must reach the kitchen display.

**Why it matters:** Kitchen integrity. If this flow breaks, cooks never see the ticket, food is never prepared, and guests go unserved. Every item sent must appear on the correct KDS station; every send must be recorded as an immutable event.

**Scope:** `gwi-pos` (API, event engine, KDS display, socket server), `gwi-android-register` (primary client), `gwi-cfd` (not involved at this step).

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | None required; KDS routing depends on `MenuItem.routeTags` and `PrepStation` config |
| Hardware required | KDS screen(s) paired and subscribed to matching tag rooms; kitchen ticket printer (optional, fire-and-forget) |
| Permissions required | `pos.access` (send to kitchen is standard employee action) |
| Online / offline state | Happy path: Android connected to NUC. Offline path: outbox queues the send event, replays on reconnect |
| Prior state | An open `Order` must exist with at least one unsent item (`kitchenStatus: 'pending'`); `Order.isClosed` must be `false` |

---

## 3. Sequence (Happy Path)

### Web POS Path

```
1.  [CLIENT]      Server selects items on /orders screen, taps "Send Order"
2.  [API]         POST /api/orders/[id]/send
                  → requirePermission('pos.access')
                  → load Order + items via db.orderSnapshot
                  → validate order is open (not isClosed)
                  → collect unsent items (kitchenStatus: 'pending')
3.  [DB]          db.order.update { status: 'sent' if not already }
                  db.orderItem.updateMany { kitchenStatus: 'sent', sentAt: NOW() }
4.  [EVENTS]      void emitOrderEvent(locationId, orderId, 'ORDER_SENT', {
                    itemIds: [...], courseNumber, employeeId
                  }).catch(console.error)
5.  [SNAPSHOT]    emitter.ts: persist OrderEvent to db → assign serverSequence
                  (via PG SEQUENCE order_event_server_seq) →
                  reducer.ts applies ORDER_SENT → projector.ts writes
                  OrderSnapshot { status: 'sent', hasHeldItems: false/true,
                  lastEventSequence: N }
6.  [BROADCAST]   emitToLocation(locationId, 'order:event', { eventId,
                    orderId, serverSequence, type: 'ORDER_SENT', payload })
                  emitToLocation(locationId, 'order:created', { orderId,
                    orderNumber, orderType, tableName, employeeName })
                  emitToTags(locationId, matchedTags, 'kds:ticket-new', {
                    orderId, stationId, items, modifiers, orderNumber,
                    tableName, employeeName, sentAt })
7.  [SIDE EFFECTS] void printKitchenTicket(orderId).catch(() => {})
                   (TCP to printer — MUST be fire-and-forget, 7s timeout)
```

### Android Path

Android owns the event client counter and generates a `deviceId`-scoped event.

```
1.  [CLIENT]      Employee taps "Send" in OrderScreen (Android)
                  SendToKitchenUseCase calls OrderMutationRepository
2.  [API]         POST /api/order-events/batch  (batch event endpoint)
                  Body: [{ eventId (ULID), orderId, deviceId, deviceCounter,
                           type: 'ORDER_SENT', payloadJson, schemaVersion }]
                  → server validates locationId, checks order is open
                  → assigns serverSequence (PG SEQUENCE)
3.  [DB]          OrderEvent persisted with serverSequence assigned
4.  [EVENTS]      emitOrderEvent() called internally — same as web path step 4
5.  [SNAPSHOT]    Reducer + projector rebuild OrderSnapshot (identical to web path)
6.  [BROADCAST]   order:event broadcast to ALL clients in location room
                  (including the originating Android device — it reconciles
                   its local snapshot against serverSequence)
                  kds:ticket-new dispatched to matching tag rooms
7.  [SIDE EFFECTS] Kitchen ticket print (fire-and-forget); KDS display updated
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `ORDER_SENT` (OrderEvent) | `{ itemIds[], courseNumber, employeeId, serverSequence }` | `emitter.ts` | Android (snapshot reconcile), KDS, POS UI | Assigned after `db.orderEvent` insert — strictly monotonic |
| `order:event` (socket) | `{ eventId, orderId, serverSequence, type, payload, deviceId }` | `emitter.ts` → `socket-server.ts` | All POS + Android clients in location room | Emitted after DB persist |
| `order:created` (socket) | `{ orderId, orderNumber, orderType, tableName, employeeName }` | `socket-dispatch.ts` | POS orders list, Android order list | Follows `order:event` |
| `kds:ticket-new` (socket) | `{ orderId, stationId, items[], modifiers, orderNumber, tableName }` | `socket-dispatch.ts` → `emitToTags()` | KDS screens subscribed to matching `tag:{tagName}` rooms | After snapshot rebuild |
| `ITEM_ADDED` (OrderEvent) | `{ itemId, menuItemId, quantity, modifiers[], priceCents }` | `emitter.ts` | Same as ORDER_SENT | Must precede ORDER_SENT in serverSequence |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `OrderEvent` | New row appended: `type: 'ORDER_SENT'`, `serverSequence` assigned | Step 4 |
| `Order` (legacy) | `status: 'sent'` | Step 3 (legacy write, bridges to snapshot) |
| `OrderItem` (legacy) | `kitchenStatus: 'sent'`, `sentAt: NOW()` | Step 3 |
| `OrderSnapshot` | `status: 'sent'`, `hasHeldItems`, `lastEventSequence: N` | Step 5, after event persisted |
| `OrderItemSnapshot` | `kitchenStatus: 'sent'`, `sentAt` | Step 5, same projection pass |

**Snapshot rebuild points:** Step 5 — every call to `emitOrderEvent()` triggers the full reducer + projector cycle. The snapshot is rebuilt from the full event log or applied incrementally from `lastEventSequence`.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Android offline to NUC** | `SendToKitchenUseCase` detects no connectivity; event queued in Android outbox (local DB). On reconnect, `POST /api/sync/outbox` replays. Server deduplicates on `offlineId`. KDS receives ticket after reconnect. |
| **Duplicate send (double-tap)** | `serverSequence` is unique per PG SEQUENCE — second call with same `eventId` (ULID) is rejected by `OrderEvent.eventId @unique` constraint. `deviceCounter` also guards against Android re-send. |
| **Order already closed** | `ORDER_SENT` is in the blocked-on-closed set (12 blocked types). Reducer's `guardClosed()` returns an error; API returns 400 "Order is closed". |
| **No unsent items** | API returns 400 "No unsent items to send". No event emitted, no snapshot rebuild. |
| **KDS disconnected** | `kds:ticket-new` is emitted to the tag room; if no KDS screen is subscribed, the event is dropped. KDS has a 30s polling fallback via `GET /api/kds` — the ticket will appear on next poll. |
| **Printer offline** | `printKitchenTicket()` is fire-and-forget with a `.catch(() => {})`. Print failure does not block the send response. TCP SYN timeout is up to 7–10s but runs out-of-band. |
| **Socket reconnect mid-send** | On reconnect, Android calls `GET /api/sync/events?orderId=xxx&afterSequence=N`. Server replays missed events by `serverSequence` cursor. Snapshot reconciled client-side. |
| **Permission denied** | `requirePermission('pos.access')` throws 403 before any DB write. Client shows permission error. |
| **Partial send (coursing)** | `courseMode: true` fires only items in `currentCourse`. Remaining items stay `kitchenStatus: 'pending'`. `OrderSnapshot.hasHeldItems: true`. |

---

## 7. Invariants (Never Break These)

- **[INVARIANT-1]** NEVER write to `db.order` or `db.orderItem` for a send operation without calling `emitOrderEvent()`. The `OrderSnapshot` is the source of truth; silent DB writes create divergence.
- **[INVARIANT-2]** `serverSequence` is always assigned by the PG SEQUENCE on the NUC, never by the client. Android's `deviceCounter` is for ordering within a single device's offline batch only.
- **[INVARIANT-3]** `kds:ticket-new` MUST be derived from the `OrderSnapshot` / event payload — never from a transient client-side state object. KDS reflects what the snapshot says, not what the client thinks it sent.
- **[INVARIANT-4]** `printKitchenTicket()` MUST be fire-and-forget. NEVER await it before returning the API response. A 7s TCP timeout must never block a server's "Send" tap.
- **[INVARIANT-5]** The closed-order guard must run BEFORE any DB write. If `OrderSnapshot.isClosed === true`, return 400 immediately — do not emit any event.
- **[INVARIANT-6]** Every `ORDER_SENT` event must be preceded in the event log by all `ITEM_ADDED` events for the items being sent (lower `serverSequence`). The reducer depends on this ordering.

If you break an invariant, the fix is: revert the offending DB write, replay the event log to rebuild the snapshot, and re-emit the correct event sequence.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/orders.md` | Data model, 17 event types, atomic item append pattern |
| `docs/features/kds.md` | Tag-based routing, socket rooms, KDS ticket structure |
| `docs/features/offline-sync.md` | Android outbox, `offlineId` deduplication, event replay |
| `docs/features/hardware.md` | Kitchen printer fire-and-forget, TCP timeout, print routing |
| `docs/guides/ORDER-LIFECYCLE.md` | Event-sourced mandate, closed-order guard, 17 event types |
| `docs/guides/SOCKET-REALTIME.md` | `emitToLocation()` / `emitToTags()` patterns, delta update rules |
| `docs/guides/ANDROID-INTEGRATION.md` | Batch event endpoint, `deviceId`/`deviceCounter`, outbox sync |

### Features Involved
- **Orders** — event engine, snapshot, closed-order guard, atomic item append
- **KDS** — tag-based routing, socket room dispatch, `kds:ticket-new` event
- **Offline Sync** — Android outbox queue, reconnect replay, `offlineId` dedup
- **Hardware** — kitchen ticket print (fire-and-forget), TCP timeout handling

---

*Last updated: 2026-03-03*
