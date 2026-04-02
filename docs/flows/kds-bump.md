# Flow: KDS Bump

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches KDS ticket display, item bump, order routing, screen links, or kitchen socket events, read this doc first.

---

## 1. Purpose

**Trigger:** A kitchen or bar staff member taps the "Bump" button on a Kitchen Display System screen to mark items (or an entire ticket) as prepared.

**Why it matters:** Kitchen integrity — the KDS bump is how the kitchen communicates completion back to the floor. Missed or duplicated bumps cause items to be served twice or not at all. The bump is an event, not a direct DB write; the snapshot is the source of truth for item status.

**Scope:** `gwi-kds-android` native Android KDS app (primary), `gwi-pos` web KDS at `/kds` (fallback), `gwi-pos` NUC API + Socket.io (authority), `gwi-android-register` (receives status updates).

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | PrepStation configured with route tags; KDS screen paired with device token |
| Hardware required | Android tablet/screen running `gwi-kds-android` FoodKDS (primary) or web browser device at `/kds` (fallback). Bump bar optional (keyboard-mapped). |
| Permissions required | `KDS_BUMP` — standard; `HARDWARE_MANAGE` to configure screens |
| Online / offline state | KDS requires live socket connection to NUC. Bump is disabled if `!socketConnected`. Fallback polling at 30s when disconnected. |
| Prior state | An `ORDER_SENT` event must have been emitted for the order (`ORDER_SENT` creates the KDS ticket). The KDS screen must be subscribed to at least one route tag matching the item. |

---

## 3. Sequence (Happy Path)

```
1. [CLIENT]     ORDER_SENT event arrives at NUC (from Android Register or PAX device)
                → socket-dispatch.ts: emitToTags(locationId, item.routeTags, 'kds:order-received', ticket)
                → KDS screens subscribed to matching tag:{tagName} rooms receive kds:order-received
                → Android KDS app (or web fallback) renders ticket in active queue

2. [CLIENT]     Kitchen staff reviews ticket on KDS screen
                → Items displayed with modifier depth indentation
                → Ticket timer counting up from receipt time (per-order-type timing thresholds)
                → All-day counts update in real time
                → Staff prepares item(s)

3. [CLIENT]     Staff taps "Bump" on a single item (item-level bump)
                → Android KDS sends POST /api/kds/bump
                → Payload: { orderId, itemId, stationId, bumpType: "item" }
                → Auth: KDS device token in Authorization header

                OR: Staff taps "Bump" on full ticket (order-level bump)
                → Payload: { orderId, stationId, bumpType: "order" }

                OR: Staff presses bump bar key / keyboard shortcut
                → Mapped to same bump action via keyboard navigation handler

4. [API]        src/app/api/kds/route.ts receives bump request
                → withVenue() extracts locationId from KDS device token
                → Validates device token via /api/hardware/kds-screens/auth
                → Checks item/order is not already bumped (idempotency)

                ** SCREEN LINK CHECK **
                → If this screen has a linked "next" screen (screen chain):
                  → This is an INTERMEDIATE BUMP (send_to_next)
                  → Sets kdsForwardedToScreenId = nextScreenId on the ticket
                  → Emits kds:order-forwarded to the next screen's tag room
                  → Ticket disappears from current screen, appears on next screen
                  → Skip to step 8 (no OrderEvent for intermediate bumps)

                → If this is the FINAL screen in the chain (or no screen links):
                  → This is a FINAL BUMP
                  → Sets kdsFinalCompleted = true
                  → Proceeds to emit OrderEvent (step 5)

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

                For intermediate bump (send_to_next):
                → emitToTags(locationId, [nextScreenTag], 'kds:order-forwarded',
                    { orderId, fromScreenId, toScreenId })
                → Ticket appears on next screen in chain

                For item-level final bump:
                → emitToTags(locationId, [stationId], 'kds:item-bumped',
                    { orderId, itemId, stationId })
                → Item disappears from active queue on subscribed KDS screens

                For order/ticket complete (final bump):
                → dispatchOrderBumped(): emitToTags(locationId, ['expo'], 'kds:order-bumped',
                    { orderId, stationId, bumpedBy, allItemsServed })
                → emitToLocation(locationId, 'kds:order-bumped', { orderId, allItemsServed })
                → Expo station sees ticket move to "done" column
                → All terminals (including Android Register) receive order status update

                For multi-clear:
                → emitToTags(locationId, [screenTag], 'kds:multi-clear',
                    { screenId, orderIds })
                → Bulk removal of completed tickets from screen

9. [SIDE EFFECTS]
                → Android Register receives kds:item-bumped / kds:order-bumped via socketClient
                → OrderScreen item row updates kitchenStatus indicator
                → If autoComplete configured on PrepStation (X seconds): server auto-bumps
                  remaining items after timer elapses
                → Expo station (showAllItems = true) receives all kds:order-bumped events
                  regardless of route tag subscription
                → Recall: manager can un-bump by emitting ITEM_UPDATED with
                  kitchenStatus: 'PENDING' — reverses snapshot state

                ** PRINT ON BUMP **
                → If print-on-bump is enabled for this screen:
                  → printKitchenTicket() called fire-and-forget
                  → Prints to configured printer for the station

                ** SMS ON READY **
                → If SMS-on-ready is enabled and this is a FINAL bump:
                  → Customer phone number looked up from order/tab
                  → SMS sent via Twilio: "Your order is ready for pickup"
                  → Fire-and-forget (delivery failure logged, does not block bump)
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `kds:order-received` | `{ orderId, stationId, items, orderNumber, tableName }` | POS API (ORDER_SENT path) | Android KDS + web KDS in `tag:{tagName}` rooms | Must follow ORDER_SENT event |
| `kds:item-bumped` | `{ orderId, itemId, stationId }` | POS API (`socket-dispatch.ts`) | KDS screens in `tag:{stationId}` room | Must follow OrderEvent write (step 5) |
| `kds:ticket-bumped` | `{ orderId, stationId }` | POS API | KDS screens at that station | When all station items bumped |
| `kds:order-bumped` | `{ orderId, stationId, bumpedBy, allItemsServed }` | POS API (`dispatchOrderBumped()`) | Expo screens (`tag:expo`), all location clients | Must follow snapshot rebuild (step 7) |
| `kds:order-forwarded` | `{ orderId, fromScreenId, toScreenId }` | POS API | Next screen in link chain | Intermediate bump only |
| `kds:multi-clear` | `{ screenId, orderIds }` | POS API | Target screen | Bulk clear operation |
| `order:event` | `{ eventId, orderId, serverSequence, type, payload }` | POS API (`emitter.ts`) | All clients including Android Register | Always emitted for every OrderEvent write |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `OrderEvent` | INSERT (type: ITEM_UPDATED or ORDER_SENT) | Step 5 (final bump only) |
| `OrderSnapshot` | `lastEventSequence`; `hasHeldItems` if all bumped | Step 6-7 |
| `OrderItemSnapshot` | `kitchenStatus`: PENDING → BUMPED | Step 6-7 |
| Ticket forward state | `kdsForwardedToScreenId` set to next screen ID | Step 4 (intermediate bump) |
| Ticket completion state | `kdsFinalCompleted` set to true | Step 4 (final bump) |
| KDS client state | Item removed from active queue, or ticket moved to done / forwarded | Step 8 (socket-driven) |
| Android Register `CachedOrderItemEntity` | `kitchenStatus` updated | Step 8 (socket-driven) |

**Snapshot rebuild points:** Step 6-7 — full event replay on every final bump. The KDS display state is derived from `OrderSnapshot`, never from local KDS client state alone.

**Forward state persistence:** `kdsForwardedToScreenId` and `kdsFinalCompleted` are persisted server-side so that screen link chains survive KDS app restarts. When an Android KDS device reconnects, it fetches current ticket state including forward position.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **KDS socket disconnects** | Android KDS shows connection status indicator. Bump button is disabled when socket is disconnected. Fallback polling at 30s fetches current ticket state from `GET /api/kds`. |
| **Item already bumped (duplicate tap)** | Server checks `OrderItemSnapshot.kitchenStatus === 'BUMPED'` before writing event. Returns 200 idempotently — no duplicate event emitted. |
| **Order modified after sent to KDS** | If employee adds items after ORDER_SENT (via `POST /api/orders/[id]/items`), a new `ITEM_ADDED` event fires. KDS receives `order:event` → re-renders ticket with new items. Bumped items retain BUMPED status; new items appear as PENDING. |
| **Partial bump (some items done, some not)** | `kds:item-bumped` emitted per item. `kds:ticket-bumped` only when ALL items at that station are bumped. `kds:order-bumped` only when ALL items across ALL stations are bumped. |
| **Expo station** | `PrepStation.showAllItems = true` means expo station receives ALL tickets regardless of tag subscription. Expo sees `kds:order-bumped` for every completed order. |
| **Recall (un-bump)** | Manager taps "Recall" on KDS → POST /api/kds/recall → emitOrderEvent with `kitchenStatus: 'PENDING'` → snapshot rebuilt → `kds:order-received` re-emitted to relevant tag rooms. Requires `HARDWARE_MANAGE` or manager role. |
| **Auto-complete station** | `PrepStation.autoComplete` (seconds) — server schedules auto-bump after elapsed time. This is a server-side timer, not a client-side timer. |
| **Tag-based routing** | Item routes to ALL stations whose tags intersect item's `routeTags`. An item with `["grill", "expo"]` appears on both grill KDS and expo screens. Both must bump for `allItemsServed = true`. |
| **Screen link chain** | Intermediate bump forwards ticket to next screen. Only the final screen's bump writes an OrderEvent and updates the snapshot. If a screen in the middle of the chain goes offline, tickets queue until it reconnects (no skip-ahead). |
| **Multi-clear** | Bulk operation that clears all completed (bumped) tickets from a screen. Used to clean up the display after a rush. Emits `kds:multi-clear` to all KDS clients subscribed to that screen. |
| **Bump bar / keyboard** | Physical bump bar mapped to keyboard events. Android KDS handles `KeyEvent` for bump (Enter/Space), navigate (arrows), recall (Backspace). Web fallback uses `onKeyDown` handlers. |
| **Print on bump fails** | Print is fire-and-forget. If printer is offline, bump still succeeds. Print failure is logged but does not block the bump flow. |
| **SMS on ready fails** | SMS delivery failure is logged but does not block the bump. Customer is not notified but order status still updates. |

---

## 7. Invariants (Never Break These)

- **[INVARIANT-1] KDS MUST reflect snapshot state, not transient client state.** KDS UI derives from `OrderSnapshot` (via socket events that trigger server-side snapshot reads). Never store bump state in local-only state that isn't backed by an `OrderEvent`.

- **[INVARIANT-2] NEVER bump without NUC confirmation.** Bump must always go through `POST /api/kds/bump` → `emitOrderEvent()` → snapshot rebuild → socket broadcast. Optimistic bumping without server confirmation causes KDS and POS to diverge.

- **[INVARIANT-3] Bump is an event, not a direct DB write.** The ITEM_UPDATED / ORDER_SENT event is the record of the bump. Never `db.orderItem.update({ kitchenStatus: 'BUMPED' })` directly — this bypasses the event log and breaks replay.

- **[INVARIANT-4] KDS socket connection loss disables bump.** When socket is disconnected, the bump button MUST be disabled on both Android KDS and web fallback. This prevents bumps that cannot receive the server confirmation broadcast.

- **[INVARIANT-5] Print is fire-and-forget.** `printKitchenTicket()` called during ORDER_SENT or bump MUST be fire-and-forget. Never await. TCP timeout is 7+ seconds if printer is offline — awaiting blocks the entire request.

- **[INVARIANT-6] Socket emissions are server-side only.** `emitToTags()` and `emitToLocation()` are called from API routes in `socket-dispatch.ts`. Never relay KDS events client-side.

- **[INVARIANT-7] Intermediate bumps do NOT write OrderEvents.** Only the final bump in a screen link chain writes to the event log. Intermediate bumps only update forward state (`kdsForwardedToScreenId`) and emit `kds:order-forwarded`.

- **[INVARIANT-8] Forward state must persist across restarts.** `kdsForwardedToScreenId` and `kdsFinalCompleted` are stored server-side. An Android KDS restart must recover the ticket's current position in the screen chain.

If an invariant is broken, the fix is: check that the bump route emits via `emitOrderEvent()` in `emitter.ts`, not via a direct model update, and that the socket broadcast fires after the snapshot write completes.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/kds.md` | KDS data model, device pairing, routing tags, PrepStation config, Android KDS app details |
| `docs/features/orders.md` | 17 event types, ITEM_UPDATED payload spec, OrderSnapshot model |
| `docs/features/hardware.md` | KDS screen pairing, deviceToken auth, heartbeat, HardwareCommand |
| `docs/guides/SOCKET-REALTIME.md` | emitToTags() usage, fire-and-forget rule, dedup pattern, reconnect |
| `docs/guides/ANDROID-INTEGRATION.md` | Android KDS app section, device pairing, socket auth |
| `docs/flows/order-placement.md` | How tickets arrive at KDS — ORDER_SENT path that precedes this flow |
| `docs/guides/ORDER-LIFECYCLE.md` | Event emission pattern, reducer purity, snapshot rebuild |

### Features Involved
- **KDS (Android)** — native ticket display, bump, screen links, all-day counts, order tracker, keyboard nav
- **KDS (Web fallback)** — browser-based ticket display at `/kds`, same API endpoints
- **Orders** — ITEM_UPDATED and ORDER_SENT events are the bump mechanism; OrderSnapshot is the read model
- **Hardware** — KDS screens are hardware devices paired with deviceTokens; heartbeat tracks connectivity
- **Offline Sync** — KDS is socket-only; reconnect fallback polling is the offline mitigation

---

*Last updated: 2026-03-18*
