# Suite 10: Sockets, Sync & Performance

**Domain:** Socket.io Real-Time Events, Android Sync, API Performance
**Total Tests:** 32
**P0 Tests:** 13 | **P1 Tests:** 13 | **P2 Tests:** 6
**Last Updated:** 2026-02-28

---

## Section A: SOCKET CONNECTION (4 tests)

### SOC-01: Socket.io connects on page load via getSharedSocket singleton
**Priority:** P0
**Prereqs:**
- POS running on NUC (or dev server on localhost:3000)
- Browser tab open to any POS page (e.g., `/orders`)
- `NEXT_PUBLIC_EVENT_PROVIDER="socket"` set in env

**Steps:**
1. Open browser dev tools, Network tab, filter by WS (WebSocket).
2. Navigate to `/orders` page.
3. Observe WebSocket connection.
4. Check browser console for socket connection log.

**Verify:**
- [ ] WebSocket connection established to server (upgrade from HTTP)
- [ ] Socket.io handshake completes (engine.io polling → WebSocket upgrade)
- [ ] `getSharedSocket()` returns a connected socket instance
- [ ] `socket.connected` = `true`
- [ ] Only ONE WebSocket connection exists (singleton pattern)
- [ ] Connection URL includes socket.io path (`/socket.io/`)
- [ ] No duplicate connections on page navigation within SPA

**Timing:** Connection established within 1000ms of page load

---

### SOC-02: Socket joins location room on connect
**Priority:** P0
**Prereqs:**
- Authenticated employee with known `locationId`
- Socket connected (from SOC-01)

**Steps:**
1. On the server, inspect socket rooms for the connected client:
   ```
   // Server-side check (or via debug endpoint)
   io.sockets.adapter.rooms.get(`location:${locationId}`)
   ```
2. Alternatively, emit a test event to the location room and verify client receives it.

**Verify:**
- [ ] Socket has joined the room `location:{locationId}`
- [ ] Events emitted to `location:{locationId}` are received by this client
- [ ] Events emitted to a DIFFERENT location room are NOT received
- [ ] Room membership persists across reconnections
- [ ] `connectedTerminals` map on server includes this terminal's entry

---

### SOC-03: Socket reconnects after disconnection
**Priority:** P0
**Prereqs:**
- Active socket connection (from SOC-01)

**Steps:**
1. Record current socket ID.
2. Simulate disconnection (disable network adapter briefly, or kill server process for 3 seconds).
3. Re-enable network / restart server.
4. Wait for reconnection (socket.io auto-reconnect with exponential backoff).
5. Check new socket state.

**Verify:**
- [ ] Socket reconnects automatically (no manual intervention)
- [ ] New socket ID assigned (may differ from original)
- [ ] Socket re-joins location room after reconnection
- [ ] `reconnect` event fires on client
- [ ] UI shows "Connection lost" banner during disconnection
- [ ] UI hides banner after successful reconnection
- [ ] No duplicate event listeners after reconnect (event handler count unchanged)
- [ ] Reconnection happens within 5 seconds (default backoff)

---

### SOC-04: Socket ref counting -- multiple consumers share ONE connection
**Priority:** P1
**Prereqs:**
- POS page with multiple socket consumers (e.g., `/orders` page has OrderPanel, FloorPlanHome, OpenOrdersPanel)

**Steps:**
1. Navigate to `/orders` page.
2. Open multiple panels/components that use `getSharedSocket()`.
3. Count WebSocket connections in dev tools Network tab.
4. Close one panel (triggers `releaseSharedSocket()`).
5. Verify connection still active.
6. Close all panels.
7. Verify connection behavior.

**Verify:**
- [ ] Only ONE WebSocket connection exists regardless of consumer count
- [ ] `getSharedSocket()` returns the same socket instance to all consumers
- [ ] Ref count increments on each `getSharedSocket()` call
- [ ] Ref count decrements on each `releaseSharedSocket()` call
- [ ] Connection stays open while ref count > 0
- [ ] Connection disconnects when ref count reaches 0 (or stays for reuse)
- [ ] No memory leaks from orphaned event listeners

---

## Section B: SOCKET EVENTS -- ORDER DOMAIN (6 tests)

### SOC-05: order:created fires within 100ms of POST /api/orders
**Priority:** P0
**Prereqs:**
- Socket connected and in location room
- Available table for order creation

**Steps:**
1. Set up socket listener with timestamp capture:
   ```javascript
   const events = []
   socket.on('order:created', (data) => {
     events.push({ ...data, receivedAt: Date.now() })
   })
   ```
2. Record `postSentAt = Date.now()`.
3. `POST /api/orders` to create a new order.
4. Record `responseAt = Date.now()` when response arrives.
5. Check `events` array.

**Verify:**
- [ ] Exactly 1 `order:created` event received
- [ ] Event payload includes `orderId`
- [ ] Event payload includes `tableId` (if table order)
- [ ] `events[0].receivedAt - postSentAt` < 200ms (event arrives quickly)
- [ ] Event arrives before or within 100ms of API response
- [ ] Event is received on OTHER terminals in the same location room

**Timing:** Socket event delta < 200ms from POST initiation

---

### SOC-06: order:item-added fires after POST /api/orders/[id]/items
**Priority:** P0
**Prereqs:**
- Existing open order
- Socket listener active

**Steps:**
1. Set up socket listener:
   ```javascript
   socket.on('order:item-added', (data) => { /* capture */ })
   ```
2. `POST /api/orders/{orderId}/items` with 1 new item.
3. Wait for socket event.

**Verify:**
- [ ] `order:item-added` event received
- [ ] Event payload includes `orderId`
- [ ] Event payload includes item details (or at minimum the item count change)
- [ ] Event fires once per POST request (not once per item in batch)
- [ ] Other terminals displaying this order can update their view

---

### SOC-07: orders:list-changed fires with correct trigger
**Priority:** P0
**Prereqs:**
- Socket connected to location room
- Ability to perform multiple order actions

**Steps:**
1. Set up listener capturing all `orders:list-changed` events:
   ```javascript
   const events = []
   socket.on('orders:list-changed', (data) => { events.push(data) })
   ```
2. Create a new order. Check trigger.
3. Send order to kitchen. Check trigger.
4. Pay the order. Check trigger.
5. Void an item on another order. Check trigger.

**Verify:**
- [ ] Event fires after order creation with `trigger: "created"` (or similar)
- [ ] Event fires after send with `trigger: "sent"` (or similar)
- [ ] Event fires after payment with `trigger: "paid"` (or similar)
- [ ] Event fires after void with `trigger: "voided"` (or similar)
- [ ] Each event includes `orderId` identifying which order changed
- [ ] Trigger string allows clients to handle delta updates (remove vs refresh)

---

### SOC-08: order:totals-updated fires after price-affecting change
**Priority:** P0
**Prereqs:**
- Open order with items
- Socket listener active

**Steps:**
1. Set up listener for `order:totals-updated` (or `orders:list-changed`).
2. Add an item to the order (price change).
3. Apply a discount (price change).
4. Void an item (price change).

**Verify:**
- [ ] Event fires after each price-affecting action
- [ ] Event payload includes `orderId`
- [ ] Event payload includes updated totals (subtotal, tax, total) or signals a refresh
- [ ] Event does NOT fire for non-price changes (e.g., notes update only)
- [ ] All terminals displaying this order update their totals

---

### SOC-09: order:editing fires when terminal opens order
**Priority:** P1
**Prereqs:**
- Two terminals (browser tabs) connected to same location
- Shared open order

**Steps:**
1. Terminal B listens for `order:editing` events.
2. Terminal A opens the order for editing (opens OrderPanel).
3. Check Terminal B's received events.

**Verify:**
- [ ] Terminal B receives `order:editing` event
- [ ] Payload includes `orderId` and `terminalId` of Terminal A
- [ ] Terminal B can display "being edited by Terminal A" indicator
- [ ] Event fires only once when order is opened (not repeatedly)

---

### SOC-10: order:editing-released fires when terminal closes order
**Priority:** P1
**Prereqs:**
- Terminal A has an order open for editing (from SOC-09)
- Terminal B listening for events

**Steps:**
1. Terminal B listens for `order:editing-released` (or `order:editing-done`).
2. Terminal A closes the order panel.
3. Check Terminal B events.

**Verify:**
- [ ] Terminal B receives `order:editing-released` event
- [ ] Payload includes `orderId`
- [ ] Terminal B clears the "being edited" indicator
- [ ] Event fires on panel close, navigation away, or disconnect

---

## Section C: SOCKET EVENTS -- KDS DOMAIN (3 tests)

### SOC-11: kds:order-received fires on send-to-kitchen with station tags
**Priority:** P0
**Prereqs:**
- KDS screen configured with tag-based routing (e.g., tag "kitchen" for food, "bar" for drinks)
- Order with food and drink items
- KDS screen listening on its tag room

**Steps:**
1. Set up KDS socket listener:
   ```javascript
   socket.on('kds:order-received', (data) => { /* capture */ })
   ```
2. `POST /api/orders/{orderId}/send` to send order to kitchen.
3. Check received events.

**Verify:**
- [ ] `kds:order-received` event fires
- [ ] Event includes `orderId`, `items`, and routing info
- [ ] Food items routed to kitchen station tag
- [ ] Drink items routed to bar station tag
- [ ] KDS screens only receive items matching their configured tags
- [ ] Event arrives within 200ms of send API response

---

### SOC-12: kds:item-status fires on item status change
**Priority:** P0
**Prereqs:**
- Order sent to kitchen (items visible on KDS)
- Socket listener on KDS event channel

**Steps:**
1. Listen for `kds:item-status` events.
2. Change item status on KDS (e.g., mark as "cooking"):
   ```
   PUT /api/kds/items/{orderItemId}/status
   { "status": "cooking" }
   ```
3. Check event.

**Verify:**
- [ ] `kds:item-status` event fires with `orderItemId` and new `status`
- [ ] All KDS screens showing this item update in real-time
- [ ] POS terminals can display updated kitchen status
- [ ] Status transitions: pending -> cooking -> ready -> delivered

---

### SOC-13: kds:order-bumped fires on bump
**Priority:** P1
**Prereqs:**
- Order visible on KDS with all items ready
- Socket listener active

**Steps:**
1. Listen for `kds:order-bumped` events.
2. Bump the order on KDS:
   ```
   POST /api/kds/orders/{orderId}/bump
   ```
3. Check event.

**Verify:**
- [ ] `kds:order-bumped` event fires with `orderId`
- [ ] KDS screen removes the bumped order from active display
- [ ] Other KDS screens showing this order also remove it
- [ ] Bump timestamp recorded on order items

---

## Section D: SOCKET EVENTS -- PAYMENT/TAB DOMAIN (3 tests)

### SOC-14: payment:processed fires after successful payment
**Priority:** P0
**Prereqs:**
- Open order with items
- Socket listener active on location room

**Steps:**
1. Listen for `payment:processed` (or `orders:list-changed` with payment trigger).
2. Pay the order:
   ```
   POST /api/orders/{orderId}/pay
   { "amount": {total}, "paymentMethod": "cash", "employeeId": "{id}" }
   ```
3. Check events.

**Verify:**
- [ ] Payment-related socket event fires
- [ ] Event includes `orderId` and `paymentMethod`
- [ ] Event indicates order is now paid
- [ ] All terminals update their open orders list (remove paid order)
- [ ] Floor plan updates (table released if applicable)

---

### SOC-15: tab:updated fires on tab status change
**Priority:** P1
**Prereqs:**
- Open bar tab order
- Socket listener active

**Steps:**
1. Listen for `tab:updated` events.
2. Open a tab:
   ```
   POST /api/orders/{orderId}/open-tab
   { "preAuthId": "...", ... }
   ```
3. Close the tab:
   ```
   POST /api/orders/{orderId}/close-tab
   { ... }
   ```
4. Check events.

**Verify:**
- [ ] `tab:updated` (or `orders:list-changed`) fires on tab open
- [ ] Event fires again on tab close
- [ ] Event payload includes `tabStatus` (open/closed)
- [ ] Other terminals see tab status change in real-time

---

### SOC-16: void:approval-update fires on void approval/rejection
**Priority:** P1
**Prereqs:**
- Location setting: `requireManagerApprovalForVoids: true`
- Pending void approval request

**Steps:**
1. Listen for `void:approval-update` events on both requesting and manager terminals.
2. Manager approves the void:
   ```
   POST /api/orders/{orderId}/comp-void/approve
   { "approvalId": "{id}", "managerId": "{managerId}" }
   ```
3. Check events on both terminals.

**Verify:**
- [ ] `void:approval-update` event fires
- [ ] Requesting terminal receives approval notification
- [ ] Manager terminal receives confirmation
- [ ] Event payload includes `approved: true` and `orderId`
- [ ] On rejection: `approved: false` with optional `rejectReason`

---

## Section E: SOCKET EVENTS -- MENU/FLOOR PLAN (3 tests)

### SOC-17: menu:updated fires on menu item CRUD
**Priority:** P1
**Prereqs:**
- Socket connected to location room
- Manager with menu editing permissions

**Steps:**
1. Listen for `menu:updated` events.
2. Create a new menu item:
   ```
   POST /api/menu/items
   { "name": "Test Item", "price": 9.99, "categoryId": "{catId}", ... }
   ```
3. Update the item:
   ```
   PUT /api/menu/items/{itemId}
   { "price": 12.99 }
   ```
4. Delete the item:
   ```
   DELETE /api/menu/items/{itemId}
   ```
5. Check events after each operation.

**Verify:**
- [ ] `menu:updated` fires after create
- [ ] `menu:updated` fires after update
- [ ] `menu:updated` fires after delete
- [ ] Event payload includes affected `menuItemId` or category
- [ ] All POS terminals refresh their menu cache on receiving this event
- [ ] `invalidateMenuCache(locationId)` called server-side

---

### SOC-18: floor-plan:updated fires on table/section change
**Priority:** P1
**Prereqs:**
- Socket connected to location room
- Manager with floor plan editing permissions

**Steps:**
1. Listen for `floorplan:updated` (or `floor-plan:updated`) events.
2. Create or move a table:
   ```
   POST /api/tables
   { "name": "T99", "sectionId": "{sectionId}", "x": 100, "y": 200, ... }
   ```
3. Check event.

**Verify:**
- [ ] `floorplan:updated` event fires
- [ ] All terminals refresh their floor plan view
- [ ] New table appears on other terminals without page reload

---

### SOC-19: table:status-changed fires on occupied/available transition
**Priority:** P1
**Prereqs:**
- Available table
- Socket listener active

**Steps:**
1. Listen for `table:status-changed` events.
2. Create order on the table (table becomes occupied).
3. Pay the order (table becomes available).
4. Check events.

**Verify:**
- [ ] Event fires when table goes from `available` to `occupied`
- [ ] Event fires when table goes from `occupied` to `available`
- [ ] Event payload includes `tableId` and new `status`
- [ ] Floor plan on all terminals updates table color/indicator

---

## Section F: NO MISSING/DUPLICATE EVENTS (3 tests)

### SOC-20: 10 rapid order creates produce exactly 10 events
**Priority:** P0
**Prereqs:**
- Socket connected
- 10 available tables (or use tableless orders)

**Steps:**
1. Set up event counter:
   ```javascript
   let count = 0
   socket.on('orders:list-changed', (data) => {
     if (data.trigger === 'created') count++
   })
   ```
2. Fire 10 `POST /api/orders` requests in rapid succession (Promise.all or 50ms intervals).
3. Wait 2 seconds for all events to arrive.
4. Check count.

**Verify:**
- [ ] Exactly 10 `orders:list-changed` events with `trigger: "created"` received
- [ ] No duplicate events (count = 10, not 11+)
- [ ] No dropped events (count = 10, not 9-)
- [ ] Each event has a unique `orderId`
- [ ] All 10 orders exist in DB

**Timing:** All 10 events received within 3 seconds of the batch start

---

### SOC-21: 5 rapid item adds produce 5 events
**Priority:** P0
**Prereqs:**
- Existing open order
- Socket listener

**Steps:**
1. Set up event counter for `order:item-added`.
2. Fire 5 `POST /api/orders/{orderId}/items` requests in rapid succession.
3. Wait 2 seconds.
4. Check count.

**Verify:**
- [ ] Exactly 5 item-added related events received
- [ ] No duplicates
- [ ] No drops
- [ ] All 5 items exist in order when fetched via GET

---

### SOC-22: Socket debounce coalesces rapid updates
**Priority:** P1
**Prereqs:**
- SocketEventProvider component active (150ms debounce)
- Socket connected

**Steps:**
1. Monitor the refresh function call count in SocketEventProvider.
2. Fire 5 `orders:list-changed` events within 100ms (faster than 150ms debounce).
3. Wait 300ms.
4. Check how many refresh calls were made.

**Verify:**
- [ ] Fewer than 5 refresh calls made (debounce coalescence working)
- [ ] At least 1 refresh call made (not all suppressed)
- [ ] Final state is consistent (last event's data reflected)
- [ ] Debounce window = 150ms (configurable in SocketEventProvider)
- [ ] Events arriving after debounce window trigger a new refresh

---

## Section G: ANDROID SYNC (5 tests)

### SOC-23: Bootstrap sync returns full venue data
**Priority:** P0
**Prereqs:**
- NUC server running with menu, employees, tables, and settings configured
- Android device (or HTTP client simulating bootstrap request)

**Steps:**
1. `GET /api/sync/bootstrap`
   (with appropriate auth headers)
2. Capture response and measure timing.

**Verify:**
- [ ] Response status `200`
- [ ] Response includes `menu` (categories + items + modifiers)
- [ ] Response includes `employees` (with roles)
- [ ] Response includes `tables` (with sections and seats)
- [ ] Response includes `settings` (location settings, order types, tax rules)
- [ ] All data is for the correct `locationId`
- [ ] Deleted records (`deletedAt != null`) are excluded
- [ ] Response is JSON, properly structured

**Timing:** Response time < 3000ms

---

### SOC-24: Delta sync returns only changed entities
**Priority:** P0
**Prereqs:**
- Successful bootstrap sync (from SOC-23)
- Record the `syncedAt` timestamp from bootstrap
- Make a known change (e.g., update one menu item price)

**Steps:**
1. Update a menu item:
   ```
   PUT /api/menu/items/{itemId}
   { "price": 15.99 }
   ```
2. Request delta sync:
   ```
   GET /api/sync/delta?since={syncedAtTimestamp}
   ```
3. Check response.

**Verify:**
- [ ] Response status `200`
- [ ] Response includes ONLY the changed menu item (not all menu items)
- [ ] Changed item has `price: 15.99`
- [ ] Response includes `syncedAt` for next delta request
- [ ] Unchanged entities are NOT in response (minimal payload)
- [ ] If no changes since `since`: response has empty arrays

**Timing:** Response time < 1000ms

---

### SOC-25: Outbox sync creates order on NUC from Android
**Priority:** P0
**Prereqs:**
- Android device (or HTTP client) with a locally-created order
- Order has `offlineId` (UUID) and `offlineLocalId` (terminal-prefixed)

**Steps:**
1. `POST /api/sync/outbox`
   ```json
   {
     "events": [
       {
         "type": "ORDER_CREATED",
         "offlineId": "uuid-from-android",
         "offlineLocalId": "T1-001",
         "employeeId": "{employeeId}",
         "locationId": "{locationId}",
         "orderType": "bar_tab",
         "items": [
           {
             "menuItemId": "{menuItemId}",
             "name": "Beer",
             "price": 6.00,
             "quantity": 1
           }
         ]
       }
     ]
   }
   ```
2. Check response for server-assigned IDs.
3. `GET /api/orders/{serverId}` to verify order exists.

**Verify:**
- [ ] Response status `200`
- [ ] Response includes `serverId` (NUC-assigned order ID)
- [ ] Response includes `serverSequence` (event sequence number)
- [ ] Order exists in local PG with correct data
- [ ] `offlineId` stored on order for dedup
- [ ] `offlineLocalId` stored on order
- [ ] Order appears in open orders list
- [ ] Socket: `orders:list-changed` fires (other terminals see the order)

---

### SOC-26: Outbox idempotency -- same offlineId returns existing serverId
**Priority:** P0
**Prereqs:**
- Order already synced via outbox (from SOC-25) with known `offlineId`

**Steps:**
1. `POST /api/sync/outbox` with the SAME `offlineId` as SOC-25.
2. Check response.
3. Count orders with this `offlineId` in DB.

**Verify:**
- [ ] Response status `200` (not an error)
- [ ] Response returns the SAME `serverId` as the original sync
- [ ] NO duplicate order created in DB
- [ ] Only 1 order exists with this `offlineId`
- [ ] `serverSequence` is the same as original (or updated if events differ)
- [ ] Idempotency works for rapid retries (network flakiness scenario)

---

### SOC-27: Delta sync after payment shows order as paid
**Priority:** P1
**Prereqs:**
- Synced order from SOC-25
- Bootstrap sync timestamp recorded

**Steps:**
1. Pay the synced order on the NUC:
   ```
   POST /api/orders/{serverId}/pay
   { "amount": 6.00, "paymentMethod": "cash", "employeeId": "{id}" }
   ```
2. Android requests delta sync:
   ```
   GET /api/sync/delta?since={previousSyncTimestamp}
   ```
3. Check order status in delta response.

**Verify:**
- [ ] Delta response includes the paid order
- [ ] Order `status` = `"paid"`
- [ ] `paidAt` timestamp present
- [ ] Payment details included in delta
- [ ] Android can update its local Room DB with the paid status

---

## Section H: PERFORMANCE (5 tests)

### SOC-28: Menu cache hit time < 5ms
**Priority:** P0
**Prereqs:**
- Menu already loaded once (cache populated)
- Server-Timing header enabled on menu endpoint

**Steps:**
1. `GET /api/menu` (first request -- cache miss, populates cache).
2. `GET /api/menu` (second request -- cache hit).
3. Read `Server-Timing` response header from second request.
4. Extract `db` or `cache` timing value.

**Verify:**
- [ ] Second request `Server-Timing` shows cache hit
- [ ] Cache hit time < 5ms
- [ ] Response body is identical to first request
- [ ] `X-Cache: HIT` header present (or similar indicator)
- [ ] No database query executed on cache hit

---

### SOC-29: Menu cache miss time < 200ms
**Priority:** P1
**Prereqs:**
- Fresh server start or cache invalidated
- Server-Timing header enabled

**Steps:**
1. Invalidate menu cache (restart server or call `invalidateMenuCache`).
2. `GET /api/menu` (cache miss -- queries DB).
3. Read `Server-Timing` header.

**Verify:**
- [ ] `Server-Timing` shows DB query time
- [ ] Total response time < 200ms
- [ ] Cache populated after this request (next request will be a hit)
- [ ] DB queries used `Promise.all` for parallel execution

---

### SOC-30: Create order API response time < 200ms
**Priority:** P0
**Prereqs:**
- Available table
- Authenticated employee

**Steps:**
1. Record `startTime = Date.now()`.
2. `POST /api/orders` with 2 items.
3. Record `endTime = Date.now()` on response.
4. Calculate `delta = endTime - startTime`.
5. Repeat 5 times, compute average.

**Verify:**
- [ ] Average response time < 200ms
- [ ] No single request exceeds 500ms
- [ ] Response includes complete order data
- [ ] Fire-and-forget side effects (socket emit, event emission) do NOT add to response time

---

### SOC-31: Open orders summary API response time < 100ms
**Priority:** P0
**Prereqs:**
- At least 10 open orders in the system
- Authenticated employee

**Steps:**
1. Record timing.
2. `GET /api/orders/open?summary=true`
3. Measure response time.
4. Repeat 5 times, compute average.

**Verify:**
- [ ] Average response time < 100ms
- [ ] Response is lightweight (summary only, no full items/modifiers)
- [ ] Response payload < 50KB for 10 orders
- [ ] All 10+ open orders included in response
- [ ] Each order has: id, orderNumber, status, tableId, total, itemCount

---

### SOC-32: Floorplan snapshot API response time < 150ms
**Priority:** P1
**Prereqs:**
- Floor plan with 20+ tables across multiple sections
- Some tables have active orders

**Steps:**
1. Record timing.
2. `GET /api/floorplan/snapshot`
3. Measure response time.
4. Repeat 5 times, compute average.

**Verify:**
- [ ] Average response time < 150ms
- [ ] Response includes all tables with positions, sections, and status
- [ ] Response includes open order counts per table
- [ ] Single API call replaces previous 3-fetch pattern
- [ ] Response payload is reasonably sized (< 100KB for 20 tables)
