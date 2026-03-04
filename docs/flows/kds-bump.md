# Flow: KDS Bump

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches KDS ticket display, item bump, order routing, or kitchen socket events, read this doc first.

---

## 1. Purpose

**Trigger:** A kitchen or bar staff member taps the "Bump" button on a Kitchen Display System screen to mark items (or an entire ticket) as prepared.

**Why it matters:** Kitchen integrity — the KDS bump is how the kitchen communicates completion back to the floor. Missed or duplicated bumps cause items to be served twice or not at all. The bump is an event, not a direct DB write; the snapshot is the source of truth for item status.

**Scope:** `gwi-pos` KDS web UI at `/kds` (primary), `gwi-pos` NUC API + Socket.io (authority), `gwi-android-register` (receives status updates).

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | PrepStation configured with route tags; KDS screen paired with device token |
| Hardware required | KDS screen device (dedicated web tablet) paired via 6-digit code; bump bar optional |
| Permissions required | `KDS_BUMP` — standard; `HARDWARE_MANAGE` to configure screens |
| Online / offline state | KDS requires live socket connection to NUC. Bump is disabled if `!socketConnected`. Fallback polling at 30s when disconnected. |
| Prior state | An `ORDER_SENT` event must have been emitted for the order (`ORDER_SENT` creates the KDS ticket). The KDS screen must be subscribed to at least one route tag matching the item. |

---

## 3. Sequence (Happy Path)

```
1. [CLIENT]     ORDER_SENT event arrives at NUC (from Android or web POS)
                → socket-dispatch.ts: emitToTags(locationId, item.routeTags, 'kds:ticket-new', ticket)
                → KDS screens subscribed to matching tag:{tagName} rooms receive kds:ticket-new
                → src/app/(kds)/kds/page.tsx renders ticket in active queue

2. [CLIENT]     Kitchen staff reviews ticket on KDS screen at /kds
                → Items displayed with modifier depth indentation
                → Ticket timer counting up from receipt time
                → Staff prepares item(s)

3. [CLIENT]     Staff taps "Bump" on a single item (item-level bump)
                → useKDSSockets.ts dispatches POST /api/kds/bump
                → Payload: { orderId, itemId, stationId, bumpType: "item" }
                → Auth: KDS device token in Authorization header

                OR: Staff taps "Bump" on full ticket (order-level bump)
                → Payload: { orderId, stationId, bumpType: "order" }

4. [API]        src/app/api/kds/route.ts receives bump request
                → withVenue() extracts locationId from KDS device token
                → Validates device token via /api/hardware/kds-screens/auth
                → Checks item/order is not already bumped (idempotency)
                → Emits order event: emitOrderEvent(locationId, orderId, 'ITEM_UPDATED',
                    { itemId, kitchenStatus: 'BUMPED', bumpedBy: stationId, bumpedAt: NOW() })
                  OR for order-level: emitOrderEvent(locationId, orderId, 'ORDER_SENT',
                    { allItemsServed: true, bumpedBy: stationId })

5. [DB]         OrderEvent written with PG SEQUENCE serverSequence
                → type: ITEM_UPDATED or ORDER_SENT (allItemsServed flag)
                → payloadJson includes kitchenStatus, stationId, timestamp (DB-generated)

6. [EVENTS]     emitter.ts → ingester.ts → reducer.ts (pure replay)
                → OrderState updated: item.kitchenStatus = 'BUMPED'
                → projector.ts → OrderSnapshot rebuilt
                → OrderItemSnapshot.kitchenStatus updated

7. [SNAPSHOT]   OrderSnapshot.lastEventSequence updated
                → If all items across all stations are now BUMPED:
                  hasHeldItems = false, order may auto-close depending on settings

8. [BROADCAST]  socket-dispatch.ts dispatches:

                For item-level bump:
                → emitToTags(locationId, [stationId], 'kds:item-bumped',
                    { orderId, itemId, stationId })
                → Item disappears from active queue on subscribed KDS screens

                For order/ticket complete:
                → dispatchOrderBumped(): emitToTags(locationId, ['expo'], 'kds:order-bumped',
                    { orderId, stationId, bumpedBy, allItemsServed })
                → emitToLocation(locationId, 'kds:order-bumped', { orderId, allItemsServed })
                → Expo station sees ticket move to "done" column
                → All terminals (including Android) receive order status update

9. [SIDE EFFECTS]
                → Android receives kds:item-bumped / kds:order-bumped via socketClient
                → OrderScreen item row updates kitchenStatus indicator
                → If autoComplete configured on PrepStation (X seconds): server auto-bumps
                  remaining items after timer elapses
                → Expo station (showAllItems = true) receives all kds:order-bumped events
                  regardless of route tag subscription
                → Recall: manager can un-bump by emitting ITEM_UPDATED with
                  kitchenStatus: 'PENDING' — reverses snapshot state
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `kds:ticket-new` | `{ orderId, stationId, items, orderNumber, tableName }` | POS API (ORDER_SENT path) | KDS screens in `tag:{tagName}` rooms | Must follow ORDER_SENT event |
| `kds:item-bumped` | `{ orderId, itemId, stationId }` | POS API (`socket-dispatch.ts`) | KDS screens in `tag:{stationId}` room | Must follow OrderEvent write (step 5) |
| `kds:ticket-bumped` | `{ orderId, stationId }` | POS API | KDS screens at that station | When all station items bumped |
| `kds:order-bumped` | `{ orderId, stationId, bumpedBy, allItemsServed }` | POS API (`dispatchOrderBumped()`) | Expo screens (`tag:expo`), all location clients | Must follow snapshot rebuild (step 7) |
| `order:event` | `{ eventId, orderId, serverSequence, type, payload }` | POS API (`emitter.ts`) | All clients including Android | Always emitted for every OrderEvent write |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `OrderEvent` | INSERT (type: ITEM_UPDATED or ORDER_SENT) | Step 5 |
| `OrderSnapshot` | `lastEventSequence`; `hasHeldItems` if all bumped | Step 6–7 |
| `OrderItemSnapshot` | `kitchenStatus`: PENDING → BUMPED | Step 6–7 |
| KDS client state | Item removed from active queue, or ticket moved to done | Step 8 (socket-driven) |
| Android `CachedOrderItemEntity` | `kitchenStatus` updated | Step 8 (socket-driven) |

**Snapshot rebuild points:** Step 6–7 — full event replay on every bump. The KDS display state is derived from `OrderSnapshot`, never from local KDS client state alone.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **KDS socket disconnects** | `src/app/(kds)/kds/page.tsx` shows full-screen overlay. Bump button is disabled (`bump button disabled when !socketConnected`). Fallback polling at 30s fetches current ticket state from `GET /api/kds`. |
| **Item already bumped (duplicate tap)** | Server checks `OrderItemSnapshot.kitchenStatus === 'BUMPED'` before writing event. Returns 200 idempotently — no duplicate event emitted. |
| **Order modified after sent to KDS** | If employee adds items after ORDER_SENT (via `POST /api/orders/[id]/items`), a new `ITEM_ADDED` event fires. KDS receives `order:event` → re-renders ticket with new items. Bumped items retain BUMPED status; new items appear as PENDING. |
| **Partial bump (some items done, some not)** | `kds:item-bumped` emitted per item. `kds:ticket-bumped` only when ALL items at that station are bumped. `kds:order-bumped` only when ALL items across ALL stations are bumped. |
| **Expo station** | `PrepStation.showAllItems = true` means expo station receives ALL tickets regardless of tag subscription. Expo sees `kds:order-bumped` for every completed order. |
| **Recall (un-bump)** | Manager taps "Recall" on KDS → POST /api/kds/recall → emitOrderEvent with `kitchenStatus: 'PENDING'` → snapshot rebuilt → `kds:ticket-new` re-emitted to relevant tag rooms. Requires `HARDWARE_MANAGE` or manager role. |
| **Auto-complete station** | `PrepStation.autoComplete` (seconds) — server schedules auto-bump after elapsed time. This is a server-side timer, not a client-side timer. |
| **Tag-based routing** | Item routes to ALL stations whose tags intersect item's `routeTags`. An item with `["grill", "expo"]` appears on both grill KDS and expo screens. Both must bump for `allItemsServed = true`. |

---

## 7. Invariants (Never Break These)

- **[INVARIANT-1] KDS MUST reflect snapshot state, not transient client state.** KDS UI derives from `OrderSnapshot` (via socket events that trigger server-side snapshot reads). Never store bump state in React/JS-only local state that isn't backed by an `OrderEvent`.

- **[INVARIANT-2] NEVER bump without NUC confirmation.** Bump must always go through `POST /api/kds/bump` → `emitOrderEvent()` → snapshot rebuild → socket broadcast. Optimistic bumping without server confirmation causes KDS and POS to diverge.

- **[INVARIANT-3] Bump is an event, not a direct DB write.** The ITEM_UPDATED / ORDER_SENT event is the record of the bump. Never `db.orderItem.update({ kitchenStatus: 'BUMPED' })` directly — this bypasses the event log and breaks replay.

- **[INVARIANT-4] KDS socket connection loss disables bump.** When `socketConnected === false`, the bump button MUST be disabled. This prevents bumps that cannot receive the server confirmation broadcast.

- **[INVARIANT-5] Print is fire-and-forget.** `printKitchenTicket()` called during ORDER_SENT MUST be fire-and-forget. Never await. TCP timeout is 7+ seconds if printer is offline — awaiting blocks the entire request.

- **[INVARIANT-6] Socket emissions are server-side only.** `emitToTags()` and `emitToLocation()` are called from API routes in `socket-dispatch.ts`. Never relay KDS events client-side.

If an invariant is broken, the fix is: check that the bump route emits via `emitOrderEvent()` in `emitter.ts`, not via a direct model update, and that the socket broadcast fires after the snapshot write completes.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/kds.md` | KDS data model, device pairing, routing tags, PrepStation config |
| `docs/features/orders.md` | 17 event types, ITEM_UPDATED payload spec, OrderSnapshot model |
| `docs/features/hardware.md` | KDS screen pairing, deviceToken auth, heartbeat, HardwareCommand |
| `docs/guides/SOCKET-REALTIME.md` | emitToTags() usage, fire-and-forget rule, dedup pattern, reconnect |
| `docs/flows/order-placement.md` | How tickets arrive at KDS — ORDER_SENT path that precedes this flow |
| `docs/guides/ORDER-LIFECYCLE.md` | Event emission pattern, reducer purity, snapshot rebuild |

### Features Involved
- **KDS** — ticket display, tag subscription, device pairing, bump API, expo station
- **Orders** — ITEM_UPDATED and ORDER_SENT events are the bump mechanism; OrderSnapshot is the read model
- **Hardware** — KDS screens are hardware devices paired with deviceTokens; heartbeat tracks connectivity
- **Offline Sync** — KDS is socket-only; reconnect fallback polling is the offline mitigation

---

*Last updated: 2026-03-03*
