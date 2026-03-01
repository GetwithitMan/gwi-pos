# Suite 01: Order Lifecycle

**Domain:** Orders
**Total Tests:** 28
**P0 Tests:** 12 | **P1 Tests:** 11 | **P2 Tests:** 5
**Last Updated:** 2026-02-28

---

## Section A: CREATE (7 tests)

### ORD-01: Create draft order on table
**Priority:** P0
**Prereqs:**
- Authenticated employee (PIN 1234, managerId stored)
- Known locationId and tableId with no active order
- Table status is `available`

**Steps:**
1. `POST /api/orders`
   ```json
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "tableId": "{tableId}",
     "orderType": "dine_in",
     "items": []
   }
   ```
2. Capture `orderId` and `orderNumber` from response.
3. `GET /api/orders/{orderId}` to confirm persisted state.

**Verify:**
- [ ] Response status `200`
- [ ] Response contains `data.id` (non-null CUID)
- [ ] `data.status` = `"draft"`
- [ ] `data.tableId` = the requested tableId
- [ ] `data.employeeId` = the requesting employee
- [ ] `data.orderNumber` is a positive integer
- [ ] `data.locationId` matches request
- [ ] `data.baseSeatCount` = 1 (default guest count)
- [ ] DB: `Order` row exists with `deletedAt = null`
- [ ] DB: `Table.status` updated (occupied or seated)
- [ ] Socket: `orders:list-changed` fires with `trigger: "created"`
- [ ] Socket: `floorplan:updated` fires
- [ ] OrderEvent: `ORDER_CREATED` event emitted

**Timing:** < 200ms response time

---

### ORD-02: Create order with items in single request
**Priority:** P0
**Prereqs:**
- Known menuItemId (standard item, e.g., "Burger")
- Known modifierGroupId + modifierId if testing modifiers

**Steps:**
1. `POST /api/orders`
   ```json
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "tableId": "{tableId}",
     "orderType": "dine_in",
     "guestCount": 2,
     "items": [
       {
         "menuItemId": "{menuItemId}",
         "name": "Burger",
         "price": 12.99,
         "quantity": 1,
         "seatNumber": 1,
         "courseNumber": 1,
         "modifiers": []
       },
       {
         "menuItemId": "{drinkItemId}",
         "name": "Coke",
         "price": 2.99,
         "quantity": 2,
         "seatNumber": 2,
         "courseNumber": 1,
         "modifiers": []
       }
     ]
   }
   ```
2. Capture response.

**Verify:**
- [ ] Response status `200`
- [ ] `data.items` array has 2 entries
- [ ] Item prices match request
- [ ] `data.subtotal` = 18.97 (12.99 + 2*2.99)
- [ ] `data.taxAmount` > 0 (tax applied per location settings)
- [ ] `data.total` = subtotal + tax
- [ ] Each item has a unique `id`
- [ ] `data.baseSeatCount` = 2 (from guestCount)
- [ ] OrderEvent: `ORDER_CREATED` and `ITEM_ADDED` events emitted
- [ ] DB: OrderItem rows exist with correct `menuItemId`

**Timing:** < 300ms response time

---

### ORD-03: Create order without table (quick service / bar)
**Priority:** P1
**Prereqs:**
- Authenticated employee

**Steps:**
1. `POST /api/orders`
   ```json
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "orderType": "takeout",
     "items": [
       {
         "menuItemId": "{menuItemId}",
         "name": "Wings",
         "price": 9.99,
         "quantity": 1,
         "modifiers": []
       }
     ]
   }
   ```

**Verify:**
- [ ] Response status `200`
- [ ] `data.tableId` = `null`
- [ ] `data.orderType` = `"takeout"`
- [ ] Order appears in `GET /api/orders/open`
- [ ] No `floorplan:updated` socket event (no table involved)

---

### ORD-04: Create order with specific order type
**Priority:** P1
**Prereqs:**
- At least 3 order types configured (dine_in, takeout, delivery)

**Steps:**
1. `POST /api/orders` with `orderType: "delivery"` and optionally `orderTypeId: "{deliveryTypeId}"`
2. Repeat with `orderType: "takeout"`
3. `GET /api/orders/{id}` for each

**Verify:**
- [ ] Each order has the correct `orderType` value
- [ ] If `orderTypeId` was sent, it is stored on the order
- [ ] Order appears in open orders list filtered by that type

---

### ORD-05: Create order with guest count and notes
**Priority:** P2
**Prereqs:**
- Available table

**Steps:**
1. `POST /api/orders`
   ```json
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "tableId": "{tableId}",
     "orderType": "dine_in",
     "guestCount": 4,
     "notes": "Birthday party - bring candle with dessert",
     "items": []
   }
   ```

**Verify:**
- [ ] `data.baseSeatCount` = 4
- [ ] `data.notes` = "Birthday party - bring candle with dessert"
- [ ] `data.seatTimestamps` contains entries for seats 1-4

---

### ORD-06: Duplicate order creation (same idempotency key) returns existing
**Priority:** P0
**Prereqs:**
- Available table

**Steps:**
1. `POST /api/orders` with a `tableId` that has no active order. Record `orderId`.
2. `POST /api/orders` again with the exact same `tableId`.

**Verify:**
- [ ] Second request returns the existing order (same `id` as first)
- [ ] OR second request returns `400` / `409` with error indicating table is occupied
- [ ] No duplicate Order rows in DB
- [ ] `orderNumber` is NOT consumed by the duplicate request

---

### ORD-07: Create order assigns sequential orderNumber per location
**Priority:** P0
**Prereqs:**
- Two available tables

**Steps:**
1. `POST /api/orders` on table A. Record `orderNumber` as N.
2. `POST /api/orders` on table B. Record `orderNumber` as M.

**Verify:**
- [ ] M = N + 1 (strictly sequential)
- [ ] No gaps in sequence
- [ ] `orderNumber` is location-scoped (not global)
- [ ] Concurrent creation (fire both POSTs simultaneously) does not produce duplicate numbers

---

## Section B: ADD ITEMS (6 tests)

### ORD-08: Add single item to existing order
**Priority:** P0
**Prereqs:**
- Existing draft/open order (from ORD-01)

**Steps:**
1. `POST /api/orders/{orderId}/items`
   ```json
   {
     "items": [
       {
         "menuItemId": "{menuItemId}",
         "name": "Fries",
         "price": 4.99,
         "quantity": 1,
         "modifiers": []
       }
     ]
   }
   ```
2. `GET /api/orders/{orderId}` to confirm.

**Verify:**
- [ ] Response status `200`
- [ ] New item appears in `data.items` with correct `name`, `price`, `quantity`
- [ ] Order `subtotal` recalculated to include new item
- [ ] Order `taxAmount` recalculated
- [ ] Order `total` recalculated
- [ ] Socket: `order:item-added` fires with orderId
- [ ] Socket: `orders:list-changed` fires
- [ ] OrderEvent: `ITEM_ADDED` emitted

**Timing:** < 200ms response time

---

### ORD-09: Add multiple items in one request
**Priority:** P0
**Prereqs:**
- Existing draft/open order

**Steps:**
1. `POST /api/orders/{orderId}/items`
   ```json
   {
     "items": [
       { "menuItemId": "{item1}", "name": "Nachos", "price": 10.99, "quantity": 1, "modifiers": [] },
       { "menuItemId": "{item2}", "name": "Beer", "price": 6.00, "quantity": 2, "modifiers": [] },
       { "menuItemId": "{item3}", "name": "Shot", "price": 8.00, "quantity": 1, "modifiers": [] }
     ]
   }
   ```

**Verify:**
- [ ] All 3 items created in DB
- [ ] Order totals reflect all items (10.99 + 12.00 + 8.00 = 30.99 + existing)
- [ ] Each item has unique `id`
- [ ] Items are in correct sort order
- [ ] Single `ITEM_ADDED` event per item (3 events total)

---

### ORD-10: Add item with modifiers (depth 0 and depth 1)
**Priority:** P0
**Prereqs:**
- MenuItem with modifier groups configured
- Modifier group with child modifier group (depth 1)

**Steps:**
1. `POST /api/orders/{orderId}/items`
   ```json
   {
     "items": [
       {
         "menuItemId": "{burgerItemId}",
         "name": "Burger",
         "price": 12.99,
         "quantity": 1,
         "modifiers": [
           {
             "modifierId": "{cheeseModId}",
             "modifierGroupId": "{toppingsGroupId}",
             "name": "Cheddar Cheese",
             "price": 1.50,
             "quantity": 1,
             "depth": 0
           },
           {
             "modifierId": "{subModId}",
             "modifierGroupId": "{cheeseTypeGroupId}",
             "name": "Smoked Gouda",
             "price": 0.75,
             "quantity": 1,
             "depth": 1,
             "parentModifierId": "{cheeseModId}"
           }
         ]
       }
     ]
   }
   ```

**Verify:**
- [ ] Item created with 2 modifiers
- [ ] Depth 0 modifier has `depth: 0`
- [ ] Depth 1 modifier has `depth: 1`
- [ ] Modifier prices included in item total (12.99 + 1.50 + 0.75 = 15.24)
- [ ] `modifierTotal` on item = 2.25
- [ ] DB: `OrderItemModifier` rows reference correct `orderItemId`

---

### ORD-11: Add item with seat number and course number
**Priority:** P1
**Prereqs:**
- Order with `baseSeatCount` >= 2

**Steps:**
1. `POST /api/orders/{orderId}/items`
   ```json
   {
     "items": [
       {
         "menuItemId": "{itemId}",
         "name": "Salad",
         "price": 8.99,
         "quantity": 1,
         "seatNumber": 2,
         "courseNumber": 1,
         "modifiers": []
       }
     ]
   }
   ```

**Verify:**
- [ ] `data.items[].seatNumber` = 2
- [ ] `data.items[].courseNumber` = 1
- [ ] Item appears assigned to seat 2 when order is fetched
- [ ] If `seatNumber` > `baseSeatCount + extraSeatCount`, `extraSeatCount` grows

---

### ORD-12: Add item with pour size (liquor)
**Priority:** P1
**Prereqs:**
- MenuItem with `categoryType: "liquor"` and `pourSizes` configured

**Steps:**
1. `POST /api/orders/{orderId}/items`
   ```json
   {
     "items": [
       {
         "menuItemId": "{liquorItemId}",
         "name": "Patron Silver",
         "price": 12.00,
         "quantity": 1,
         "pourSize": "double",
         "pourMultiplier": 2.0,
         "modifiers": []
       }
     ]
   }
   ```

**Verify:**
- [ ] Item stored with `pourSize: "double"`
- [ ] `pourMultiplier` = 2.0
- [ ] Final price reflects double multiplier (24.00)
- [ ] Inventory deduction (when paid) uses double pour amount

---

### ORD-13: Add item with special notes
**Priority:** P2
**Prereqs:**
- Existing order

**Steps:**
1. `POST /api/orders/{orderId}/items`
   ```json
   {
     "items": [
       {
         "menuItemId": "{itemId}",
         "name": "Steak",
         "price": 24.99,
         "quantity": 1,
         "specialNotes": "Medium rare, no salt",
         "modifiers": []
       }
     ]
   }
   ```

**Verify:**
- [ ] `specialNotes` = "Medium rare, no salt" on the created item
- [ ] Notes print on kitchen ticket when sent

---

## Section C: SEND TO KITCHEN (4 tests)

### ORD-14: Send order to kitchen
**Priority:** P0
**Prereqs:**
- Order with at least 1 unsent item (status = draft or open, items with `kitchenStatus: null`)

**Steps:**
1. `POST /api/orders/{orderId}/send`
   (empty body or `{}`)
2. `GET /api/orders/{orderId}` to verify state change.

**Verify:**
- [ ] Response status `200`
- [ ] Order `status` changes from `draft` to `open` (or `in_progress`)
- [ ] All items have `kitchenStatus: "pending"` (or `"sent"`)
- [ ] `sentAt` timestamp set on order
- [ ] Socket: `kds:order-received` fires (KDS terminals pick it up)
- [ ] Socket: `orders:list-changed` fires
- [ ] OrderEvent: `ORDER_SENT` emitted
- [ ] Print: Kitchen ticket generated (fire-and-forget, verify via print queue or mock)

**Timing:** < 300ms API response (print is async, does not block)

---

### ORD-15: Send fires correct station routing based on category tags
**Priority:** P0
**Prereqs:**
- Order with a food item (routes to kitchen station) and a drink item (routes to bar station)
- KDS screens configured with tag-based routing

**Steps:**
1. Create order with one food item and one drink item.
2. `POST /api/orders/{orderId}/send`
3. Check KDS events for each station.

**Verify:**
- [ ] Food item routed to kitchen KDS screen
- [ ] Drink item routed to bar KDS screen
- [ ] Each item's `printRoute` respected
- [ ] Items with `printRoute: "also"` appear on both assigned station and default
- [ ] Socket: separate `kds:order-received` per affected station

---

### ORD-16: Send with courses -- only active course items sent
**Priority:** P1
**Prereqs:**
- Order with `courseMode: "on"`, `currentCourse: 1`
- Items on course 1 and course 2

**Steps:**
1. `POST /api/orders/{orderId}/send`
2. Verify which items were sent.

**Verify:**
- [ ] Only items with `courseNumber: 1` have `kitchenStatus: "pending"`
- [ ] Items on course 2 remain `kitchenStatus: null`
- [ ] Course 2 items are NOT printed on kitchen ticket
- [ ] After advancing course (`POST /api/orders/{orderId}/advance-course`), course 2 items become sendable

---

### ORD-17: Resend order
**Priority:** P1
**Prereqs:**
- Order already sent (from ORD-14)

**Steps:**
1. `POST /api/orders/{orderId}/send` again (with no new items).

**Verify:**
- [ ] Response `200` (not an error)
- [ ] Already-sent items are NOT duplicated on KDS
- [ ] Only genuinely new/unsent items (if any) are routed
- [ ] `lastResentAt` updated if applicable
- [ ] Kitchen ticket reprints if items were modified since last send

---

## Section D: UPDATE (4 tests)

### ORD-18: Update order metadata
**Priority:** P1
**Prereqs:**
- Existing order
- A second table (for tableId change)

**Steps:**
1. `PUT /api/orders/{orderId}`
   ```json
   {
     "tableId": "{newTableId}",
     "notes": "Updated notes - VIP guest",
     "orderType": "bar_tab"
   }
   ```

**Verify:**
- [ ] `data.tableId` = new table ID
- [ ] `data.notes` = "Updated notes - VIP guest"
- [ ] `data.orderType` = "bar_tab"
- [ ] Old table released (status back to available)
- [ ] New table occupied
- [ ] Socket: `floorplan:updated` fires (both tables changed)

---

### ORD-19: Update single item field
**Priority:** P1
**Prereqs:**
- Order with at least one item

**Steps:**
1. `PUT /api/orders/{orderId}/items/{itemId}`
   ```json
   {
     "quantity": 3,
     "specialNotes": "Extra crispy"
   }
   ```

**Verify:**
- [ ] Item quantity = 3
- [ ] Item `specialNotes` = "Extra crispy"
- [ ] Order totals recalculated for new quantity
- [ ] Socket: `orders:list-changed` fires

---

### ORD-20: PATCH order (lightweight, no items in response)
**Priority:** P1
**Prereqs:**
- Existing order

**Steps:**
1. `PATCH /api/orders/{orderId}`
   ```json
   {
     "notes": "Patched notes"
   }
   ```

**Verify:**
- [ ] Response status `200`
- [ ] Response does NOT contain `items` array (lightweight response)
- [ ] `data.notes` = "Patched notes"
- [ ] Response payload < 1KB (vs 5-20KB for full PUT response)

---

### ORD-21: PUT with items array is REJECTED (FIX-005 enforcement)
**Priority:** P0
**Prereqs:**
- Existing order

**Steps:**
1. `PUT /api/orders/{orderId}`
   ```json
   {
     "items": [
       { "menuItemId": "abc", "name": "Hack", "price": 0.01, "quantity": 1 }
     ]
   }
   ```

**Verify:**
- [ ] Response status `400`
- [ ] Error message indicates items must use `POST /api/orders/{id}/items`
- [ ] No items were added to the order
- [ ] DB: no new OrderItem rows

---

## Section E: REOPEN (3 tests)

### ORD-22: Reopen paid order
**Priority:** P0
**Prereqs:**
- Order that is fully paid (`status: "paid"`)
- Manager with `manager.void_orders` permission

**Steps:**
1. `POST /api/orders/{orderId}/reopen`
   ```json
   {
     "reason": "Customer wants to add dessert",
     "managerId": "{managerId}"
   }
   ```
2. `GET /api/orders/{orderId}` to confirm.

**Verify:**
- [ ] Response status `200`
- [ ] `data.status` = `"open"`
- [ ] `data.paidAt` = `null` (cleared)
- [ ] `data.reopenedAt` set to current timestamp
- [ ] `data.reopenedBy` = managerId
- [ ] `data.reopenReason` = "Customer wants to add dessert"
- [ ] Payments remain in DB (not deleted) but order balance recalculated
- [ ] Socket: `orders:list-changed` fires with `trigger: "reopened"`
- [ ] Order reappears in open orders list
- [ ] Table status reset to occupied (if order has tableId)
- [ ] OrderEvent: `ORDER_REOPENED` emitted

---

### ORD-23: Reopen with reason field
**Priority:** P2
**Prereqs:**
- Paid order + manager

**Steps:**
1. `POST /api/orders/{orderId}/reopen`
   ```json
   {
     "reason": "Wrong items charged",
     "notes": "Manager override: customer complaint",
     "managerId": "{managerId}"
   }
   ```

**Verify:**
- [ ] `reopenReason` stored correctly
- [ ] `notes` appended or updated (if supported)
- [ ] Audit trail: VoidLog or similar record created

---

### ORD-24: Cannot reopen already-open order (returns 400)
**Priority:** P1
**Prereqs:**
- Order with `status: "open"` (not paid)

**Steps:**
1. `POST /api/orders/{orderId}/reopen`
   ```json
   {
     "reason": "Test",
     "managerId": "{managerId}"
   }
   ```

**Verify:**
- [ ] Response status `400` or `409`
- [ ] Error message: order is not in a paid/closed state
- [ ] Order state unchanged

---

## Section F: CANCEL / DELETE (2 tests)

### ORD-25: Auto-cancel when all items voided
**Priority:** P0
**Prereqs:**
- Order with 1 or 2 items (all active)
- Manager with void permissions

**Steps:**
1. `POST /api/orders/{orderId}/comp-void` to void all items
   ```json
   {
     "itemIds": ["{item1Id}", "{item2Id}"],
     "action": "void",
     "reason": "Customer changed mind",
     "managerId": "{managerId}"
   }
   ```
2. `GET /api/orders/{orderId}`

**Verify:**
- [ ] All items have `status: "voided"`
- [ ] Order `status` = `"cancelled"` (auto-closed)
- [ ] `orderAutoClosed: true` in response (if returned)
- [ ] Table released to available
- [ ] Socket: `orders:list-changed` fires
- [ ] No payment required for $0 order

---

### ORD-26: Delete draft order (has no sent items)
**Priority:** P1
**Prereqs:**
- Draft order (never sent to kitchen, no payments)

**Steps:**
1. `DELETE /api/orders/{orderId}` (or `PUT` with cancel action)

**Verify:**
- [ ] Order soft-deleted (`deletedAt` set) or `status: "cancelled"`
- [ ] Table released
- [ ] Order no longer appears in `GET /api/orders/open`
- [ ] Items soft-deleted alongside order

---

## Section G: CROSS-TERMINAL (2 tests)

### ORD-27: Order created on Terminal A visible on Terminal B
**Priority:** P0
**Prereqs:**
- Two browser sessions connected to same location (simulating two terminals)

**Steps:**
1. On Terminal A: `POST /api/orders` to create a new order.
2. On Terminal B: `GET /api/orders/open` immediately after.
3. Alternatively: verify Terminal B receives `orders:list-changed` socket event.

**Verify:**
- [ ] Terminal B sees the new order in open orders list
- [ ] Total time from POST on A to visibility on B < 500ms
- [ ] Socket event arrives on Terminal B before any polling cycle
- [ ] Order data is consistent between terminals (same totals, items, table)

**Timing:** < 500ms end-to-end

---

### ORD-28: Edit lock -- Terminal A editing, Terminal B sees lock event
**Priority:** P1
**Prereqs:**
- Shared order visible on both terminals

**Steps:**
1. Terminal A opens order for editing (triggers `order:editing` socket event).
2. Terminal B listens for `order:editing` event.

**Verify:**
- [ ] Terminal B receives `order:editing` with `{ orderId, terminalId }` payload
- [ ] Terminal B UI shows visual indicator that order is being edited elsewhere
- [ ] When Terminal A closes the order panel, `order:editing-done` fires
- [ ] Terminal B clears the lock indicator
