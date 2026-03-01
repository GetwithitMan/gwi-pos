# Suite 06: KDS, Kitchen & Printing

**Domain:** Kitchen Display System, Print Routing, Receipt Generation, Cash Drawer
**Total Tests:** 26
**P0 Tests:** 8 | **P1 Tests:** 12 | **P2 Tests:** 6
**Last Updated:** 2026-02-28

---

## Section A: KDS ORDER ROUTING (6 tests)

### KDS-01: Order sent appears on correct KDS station
**Priority:** P0
**Prereqs:**
- KDS screen configured for "kitchen" station (tag-based routing for `food` category)
- KDS screen configured for "bar" station (tag-based routing for `liquor`/`drinks` category)
- Order with a food item (e.g., "Burger", category: food)

**Steps:**
1. Create order with a food item:
   ```
   POST /api/orders
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "tableId": "{tableId}",
     "orderType": "dine_in",
     "items": [
       { "menuItemId": "{burgerItemId}", "name": "Burger", "price": 12.99, "quantity": 1, "modifiers": [] }
     ]
   }
   ```
2. Send order to kitchen:
   ```
   POST /api/orders/{orderId}/send
   ```
3. Query KDS for kitchen station:
   ```
   GET /api/kds?stationId={kitchenStationId}
   ```

**Verify:**
- [ ] Response status `200`
- [ ] Order appears in kitchen station KDS response
- [ ] Order does NOT appear in bar station KDS response
- [ ] Items show with `kitchenStatus: "pending"` (or `"sent"`)
- [ ] Order includes `orderNumber`, `tableId` (or table name), `employeeId`
- [ ] Each item shows `name`, `quantity`, `modifiers`, `specialNotes`
- [ ] Socket: `kds:order-received` fires with `stationId: "{kitchenStationId}"`
- [ ] OrderEvent: `ORDER_SENT` emitted

**Timing:** Send to KDS visible < 200ms

---

### KDS-02: Order with mixed categories routes items to multiple stations
**Priority:** P0
**Prereqs:**
- Kitchen station (food) and bar station (liquor/drinks) configured
- Order with both food and drink items

**Steps:**
1. Create order with mixed items:
   ```
   POST /api/orders
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "tableId": "{tableId}",
     "orderType": "dine_in",
     "items": [
       { "menuItemId": "{burgerItemId}", "name": "Burger", "price": 12.99, "quantity": 1, "modifiers": [] },
       { "menuItemId": "{beerItemId}", "name": "IPA Draft", "price": 7.00, "quantity": 1, "modifiers": [] }
     ]
   }
   ```
2. `POST /api/orders/{orderId}/send`
3. `GET /api/kds?stationId={kitchenStationId}`
4. `GET /api/kds?stationId={barStationId}`

**Verify:**
- [ ] Kitchen station shows "Burger" item only
- [ ] Bar station shows "IPA Draft" item only
- [ ] Both stations receive `kds:order-received` socket event
- [ ] Each station sees only its relevant items (not the full order)
- [ ] Order number visible on both stations (so kitchen and bar can coordinate)
- [ ] Table number visible on both stations

---

### KDS-03: Expo view shows ALL station orders
**Priority:** P0
**Prereqs:**
- Orders sent to both kitchen and bar stations (from KDS-01 and KDS-02)
- Expo KDS screen configured

**Steps:**
1. `GET /api/kds/expo` (or `GET /api/kds?stationId={expoStationId}`)

**Verify:**
- [ ] Expo view shows ALL open orders across all stations
- [ ] Food items and drink items both visible
- [ ] Items grouped by order (not scattered across stations)
- [ ] Per-item status visible (pending, cooking, ready)
- [ ] Expo can see which station each item is routed to
- [ ] Socket: Expo receives `kds:order-received` for every station event

---

### KDS-04: Resend order appears as resend on KDS (not duplicate)
**Priority:** P1
**Prereqs:**
- Order already sent to KDS (from KDS-01)

**Steps:**
1. `POST /api/orders/{orderId}/send` (resend same order)
2. `GET /api/kds?stationId={kitchenStationId}`

**Verify:**
- [ ] Order does NOT appear as a duplicate on KDS
- [ ] If items were modified since last send: only changes highlighted
- [ ] `lastResentAt` updated on order/items
- [ ] Resend indicator visible on KDS (e.g., "RESEND" tag)
- [ ] Socket: `kds:order-resent` fires (or `kds:order-received` with `isResend: true`)
- [ ] Kitchen ticket reprints with "RESEND" or "FIRE" header

---

### KDS-05: Entertainment item does NOT route to kitchen KDS
**Priority:** P1
**Prereqs:**
- Order with an entertainment item (categoryType: `"entertainment"`, e.g., "Pool Table 1hr")
- Kitchen and bar KDS stations configured

**Steps:**
1. Create order with entertainment item:
   ```
   POST /api/orders
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "orderType": "dine_in",
     "items": [
       { "menuItemId": "{poolTableItemId}", "name": "Pool Table 1hr", "price": 15.00, "quantity": 1, "modifiers": [] }
     ]
   }
   ```
2. `POST /api/orders/{orderId}/send`
3. `GET /api/kds?stationId={kitchenStationId}`
4. `GET /api/kds?stationId={barStationId}`

**Verify:**
- [ ] Entertainment item does NOT appear on kitchen KDS
- [ ] Entertainment item does NOT appear on bar KDS
- [ ] Entertainment item routed to entertainment KDS (if configured) or no KDS at all
- [ ] Timer starts on entertainment item (if timed_rental)
- [ ] No kitchen ticket printed for entertainment items

---

### KDS-06: Order with modifier printer routing (follow/also/only)
**Priority:** P1
**Prereqs:**
- Item with modifier that has `printerRouting: "also"` and `printerIds: ["{barPrinterId}"]`
- Item routed to kitchen by default (food item)

**Steps:**
1. Create order with food item and a modifier with `printerRouting: "also"`:
   ```
   POST /api/orders
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "tableId": "{tableId}",
     "orderType": "dine_in",
     "items": [
       {
         "menuItemId": "{burgerItemId}",
         "name": "Burger",
         "price": 12.99,
         "quantity": 1,
         "modifiers": [
           { "modifierId": "{specialSauceModId}", "name": "Special Sauce", "price": 0, "quantity": 1, "depth": 0 }
         ]
       }
     ]
   }
   ```
2. `POST /api/orders/{orderId}/send`

**Verify:**
- [ ] `follow` routing: modifier appears on same station as parent item (default behavior)
- [ ] `also` routing: modifier appears on parent station AND the additional printer(s)
- [ ] `only` routing: modifier appears ONLY on the specified printer, NOT the parent station
- [ ] Kitchen ticket for "also" modifier shows on both kitchen and bar printers
- [ ] KDS reflects correct modifier routing per station

---

## Section B: KDS STATUS FLOW (6 tests)

### KDS-07: Mark item cooking
**Priority:** P0
**Prereqs:**
- Order on KDS with item in `kitchenStatus: "pending"`

**Steps:**
1. `PUT /api/orders/{orderId}/items/{itemId}`
   ```json
   {
     "kitchenStatus": "cooking"
   }
   ```
2. `GET /api/kds?stationId={kitchenStationId}` to verify.

**Verify:**
- [ ] Response status `200`
- [ ] Item `kitchenStatus` = `"cooking"`
- [ ] Socket: `kds:item-status` fires with `{ orderId, itemId, status: "cooking" }`
- [ ] KDS screen updates in real-time (cooking indicator shown)
- [ ] Expo view reflects updated status
- [ ] Timestamp recorded for when cooking started

**Timing:** < 100ms API response

---

### KDS-08: Mark item ready
**Priority:** P0
**Prereqs:**
- Item with `kitchenStatus: "cooking"` (from KDS-07)

**Steps:**
1. `PUT /api/orders/{orderId}/items/{itemId}`
   ```json
   {
     "kitchenStatus": "ready"
   }
   ```

**Verify:**
- [ ] Item `kitchenStatus` = `"ready"`
- [ ] Socket: `kds:item-status` fires with `status: "ready"`
- [ ] KDS screen shows item as ready (visual change, e.g., green highlight)
- [ ] Expo notified — ready items are actionable for runner
- [ ] `completedAt` timestamp set on item (or ready timestamp)

---

### KDS-09: Mark item delivered
**Priority:** P0
**Prereqs:**
- Item with `kitchenStatus: "ready"` (from KDS-08)

**Steps:**
1. `PUT /api/orders/{orderId}/items/{itemId}`
   ```json
   {
     "kitchenStatus": "delivered"
   }
   ```

**Verify:**
- [ ] Item `kitchenStatus` = `"delivered"`
- [ ] Socket: `kds:item-status` fires with `status: "delivered"`
- [ ] Item removed from active KDS view (or moved to completed section)
- [ ] Delivery timestamp recorded

---

### KDS-10: Status flow must be forward only
**Priority:** P0
**Prereqs:**
- Item with `kitchenStatus: "ready"`

**Steps:**
1. Attempt to set status backward:
   ```
   PUT /api/orders/{orderId}/items/{itemId}
   { "kitchenStatus": "pending" }
   ```
2. Attempt to set status backward:
   ```
   PUT /api/orders/{orderId}/items/{itemId}
   { "kitchenStatus": "cooking" }
   ```

**Verify:**
- [ ] Backward transition `ready` -> `pending` rejected (returns `400`)
- [ ] Backward transition `ready` -> `cooking` rejected (returns `400`)
- [ ] Item remains at `kitchenStatus: "ready"`
- [ ] Error message indicates invalid status transition
- [ ] Valid forward transitions: `pending` -> `cooking` -> `ready` -> `delivered`
- [ ] Direct jumps allowed: `pending` -> `ready` (skip cooking) OK
- [ ] Direct jumps allowed: `pending` -> `delivered` (bump) OK

---

### KDS-11: Bump order from station (all items delivered)
**Priority:** P1
**Prereqs:**
- Order with all items on a single station marked `"ready"` or `"delivered"`

**Steps:**
1. Bump entire order from station:
   ```
   POST /api/kds/{stationId}/bump/{orderId}
   ```
   OR mark all items as delivered.

**Verify:**
- [ ] All items for this order on this station set to `"delivered"`
- [ ] Order removed from station KDS view
- [ ] Socket: `kds:order-bumped` fires with `{ stationId, orderId }`
- [ ] Other stations with items from same order unaffected
- [ ] Expo view updates to show this station's items as delivered
- [ ] Bump timestamp recorded

---

### KDS-12: All items ready -- order completable
**Priority:** P1
**Prereqs:**
- Order with items on multiple stations (kitchen and bar)
- All items across ALL stations marked `"ready"` or `"delivered"`

**Steps:**
1. Mark all kitchen items as `"delivered"`.
2. Mark all bar items as `"delivered"`.
3. `GET /api/orders/{orderId}` to check.

**Verify:**
- [ ] Order shows all items with `kitchenStatus: "delivered"`
- [ ] Order is completable (ready for payment)
- [ ] Expo view shows order as fully completed
- [ ] Speed of service timer stops (total time from send to all-delivered)

---

## Section C: COURSE FIRING (4 tests)

### KDS-13: Fire course 1 -- only course 1 items on KDS
**Priority:** P1
**Prereqs:**
- Order with `courseMode: "on"`, `currentCourse: 1`
- Course 1 items: Appetizer ($8.00)
- Course 2 items: Entree ($24.00)

**Steps:**
1. `POST /api/orders/{orderId}/send`
2. `GET /api/kds?stationId={kitchenStationId}`

**Verify:**
- [ ] Only course 1 items appear on KDS (Appetizer)
- [ ] Course 2 items do NOT appear on KDS
- [ ] Course 2 items have `kitchenStatus: null` (not sent)
- [ ] KDS shows course indicator (e.g., "Course 1")
- [ ] Kitchen ticket printed for course 1 only

---

### KDS-14: Fire course 2 -- course 2 items now appear
**Priority:** P1
**Prereqs:**
- Order from KDS-13 with course 1 sent and delivered

**Steps:**
1. Advance course:
   ```
   POST /api/orders/{orderId}/advance-course
   { "employeeId": "{managerId}" }
   ```
2. `POST /api/orders/{orderId}/send`
3. `GET /api/kds?stationId={kitchenStationId}`

**Verify:**
- [ ] Order `currentCourse` = 2
- [ ] Course 2 items now appear on KDS (Entree)
- [ ] Course 1 items remain delivered (not re-sent)
- [ ] Kitchen ticket printed for course 2 items
- [ ] Socket: `kds:order-received` fires for course 2 items
- [ ] KDS shows "Course 2" indicator

---

### KDS-15: Advance course
**Priority:** P1
**Prereqs:**
- Order with `courseMode: "on"`, `currentCourse: 1`

**Steps:**
1. `POST /api/orders/{orderId}/advance-course`
   ```json
   {
     "employeeId": "{managerId}"
   }
   ```
2. `GET /api/orders/{orderId}`

**Verify:**
- [ ] `currentCourse` incremented to 2
- [ ] Socket: `order:course-advanced` fires (or `orders:list-changed`)
- [ ] Course 2 items become sendable
- [ ] Cannot advance beyond max course number (returns `400` if no course 3 items)

---

### KDS-16: Hold items until course fires
**Priority:** P2
**Prereqs:**
- Order with `courseMode: "on"`, items on course 2 with `holdUntil` logic

**Steps:**
1. Send order (only course 1 fires).
2. Verify course 2 items are held.
3. Advance course.
4. Verify course 2 items now fire.

**Verify:**
- [ ] Course 2 items have `kitchenStatus: null` while held
- [ ] Course 2 items are NOT printed until course fires
- [ ] `holdUntil` field reflects course-based hold
- [ ] Advancing course releases the hold
- [ ] KDS shows "held" indicator for unfired courses

---

## Section D: PRINT ROUTING (5 tests)

### KDS-17: Kitchen ticket prints to correct printer based on PrintRoute
**Priority:** P0
**Prereqs:**
- Named PrintRoute configured (e.g., "Main Kitchen" routing food to printer A)
- Order with food items matching the route

**Steps:**
1. Create and send order with food item.
2. `POST /api/print/kitchen`
   ```json
   {
     "orderId": "{orderId}"
   }
   ```
3. Verify print job routing (via print queue or mock).

**Verify:**
- [ ] Print job sent to correct printer based on PrintRoute rules
- [ ] Ticket contains: order number, table, items, modifiers, special notes, time
- [ ] Priority-based routing respected: PrintRoute > Item printer > Category printer > Default
- [ ] ESC/POS formatting applied (bold headers, item names, modifier indentation)
- [ ] Fire-and-forget: API returns before printer confirms receipt

**Timing:** API response < 50ms (print is async)

---

### KDS-18: Category-based printer fallback (no PrintRoute)
**Priority:** P1
**Prereqs:**
- No PrintRoute configured for item's category
- Category has a `printerId` assigned (fallback printer)

**Steps:**
1. Create and send order with item whose category has `printerId` but no PrintRoute.
2. Verify print routing.

**Verify:**
- [ ] Print job routed to category's assigned printer
- [ ] PrintRoute lookup returns null -> falls back to category printer
- [ ] Ticket prints correctly on category printer
- [ ] Items from different categories can route to different printers in same order

---

### KDS-19: Default printer fallback (no category printer)
**Priority:** P1
**Prereqs:**
- Item with no PrintRoute and no category printer
- Default printer configured for location

**Steps:**
1. Create and send order with item that has no specific routing.
2. Verify print routing.

**Verify:**
- [ ] Print job routed to location's default printer
- [ ] Fallback chain: PrintRoute (null) -> Category printer (null) -> Default printer
- [ ] Ticket prints on default printer
- [ ] If no default printer configured: print silently skipped (no error thrown)

---

### KDS-20: Backup printer failover (primary down)
**Priority:** P2
**Prereqs:**
- Primary printer configured (unreachable / offline)
- Backup printer configured for the same route
- Failover timeout configured (e.g., 3 seconds)

**Steps:**
1. Ensure primary printer is offline (simulated via unreachable IP).
2. Create and send order.
3. Observe failover behavior.

**Verify:**
- [ ] Primary printer connection attempt times out
- [ ] Backup printer receives the print job
- [ ] Failover happens within configured timeout
- [ ] Ticket content identical on backup printer
- [ ] Log entry created noting failover event
- [ ] Subsequent prints continue to backup until primary recovered

---

### KDS-21: Per-modifier print routing -- 'also' sends to additional printer
**Priority:** P2
**Prereqs:**
- Modifier with `printerRouting: "also"` and `printerIds: ["{additionalPrinterId}"]`
- Parent item routes to kitchen printer

**Steps:**
1. Create order with item and "also" modifier.
2. Send order.
3. Check both printers.

**Verify:**
- [ ] Kitchen printer receives full ticket (item + modifier)
- [ ] Additional printer ALSO receives ticket with the modifier info
- [ ] "also" modifier prints on BOTH printers
- [ ] "follow" modifier prints ONLY on parent item's printer
- [ ] "only" modifier prints ONLY on the specified printer (not parent)

---

## Section E: RECEIPT & CASH DRAWER (5 tests)

### KDS-22: Customer receipt includes all required information
**Priority:** P0
**Prereqs:**
- Paid order with multiple items, modifiers, tax, and payment

**Steps:**
1. `POST /api/print/receipt`
   ```json
   {
     "orderId": "{paidOrderId}"
   }
   ```
2. Verify receipt content (via print queue, mock, or receipt preview endpoint).

**Verify:**
- [ ] Receipt header: location name, address, phone
- [ ] Order number and date/time
- [ ] All items listed with name, quantity, price
- [ ] Modifiers indented under their parent item
- [ ] Subtotal correct
- [ ] Discount amount shown (if applicable)
- [ ] Tax amount and rate shown
- [ ] Total correct (subtotal - discounts + tax)
- [ ] Payment method shown (cash/card)
- [ ] Amount tendered and change given (cash payments)
- [ ] Card last 4 digits (card payments)
- [ ] Receipt footer: thank you message, location info
- [ ] ESC/POS formatting: proper alignment, bold totals

---

### KDS-23: Receipt includes tip amount and total with tip
**Priority:** P1
**Prereqs:**
- Paid order with card payment and tip

**Steps:**
1. Pay order with tip:
   ```
   POST /api/orders/{orderId}/pay
   {
     "paymentMethod": "card",
     "amount": 50.00,
     "tipAmount": 8.00,
     "readerId": "{readerId}"
   }
   ```
2. `POST /api/print/receipt`
   ```json
   { "orderId": "{orderId}" }
   ```

**Verify:**
- [ ] Receipt shows subtotal, tax, pre-tip total
- [ ] Tip line shows $8.00
- [ ] Grand total = pre-tip total + $8.00
- [ ] Tip line clearly labeled "Tip" or "Gratuity"
- [ ] If tip is $0, tip line still shown as "$0.00" or omitted (per location setting)

---

### KDS-24: Receipt includes rounding adjustment
**Priority:** P2
**Prereqs:**
- Location with `priceRounding` enabled (e.g., round to nearest $0.05)
- Cash payment with rounding adjustment

**Steps:**
1. Create order where total before rounding = $25.03
2. Pay with cash (rounded to $25.05):
   ```
   POST /api/orders/{orderId}/pay
   {
     "paymentMethod": "cash",
     "amount": 25.05,
     "tipAmount": 0
   }
   ```
3. Print receipt.

**Verify:**
- [ ] Receipt shows "Rounding" or "Adjustment" line: +$0.02
- [ ] Pre-rounding total shown: $25.03
- [ ] Rounded total shown: $25.05
- [ ] Change calculated on rounded amount
- [ ] Rounding adjustment stored in `Payment.roundingAdjustment`

---

### KDS-25: Cash drawer trigger fires on cash payment
**Priority:** P1
**Prereqs:**
- Cash drawer connected to receipt printer
- Order ready for cash payment

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "paymentMethod": "cash",
     "amount": 25.00,
     "tipAmount": 0,
     "terminalId": "{terminalId}"
   }
   ```
2. Observe cash drawer behavior (or check `POST /api/print/cash-drawer` call).

**Verify:**
- [ ] Cash drawer open command sent to printer (`ESC p 0 25 250`)
- [ ] Drawer opens on cash payment
- [ ] Drawer does NOT open on card-only payment
- [ ] `POST /api/print/cash-drawer` can be called manually (e.g., "No Sale" button)
- [ ] Cash drawer trigger is fire-and-forget (does not block payment response)

---

### KDS-26: Print call is fire-and-forget (does not block API response)
**Priority:** P0
**Prereqs:**
- Printer configured but potentially slow or offline (simulated)

**Steps:**
1. `POST /api/print/kitchen`
   ```json
   { "orderId": "{orderId}" }
   ```
2. Measure API response time.
3. Test with printer offline (unreachable IP — TCP timeout ~7s).

**Verify:**
- [ ] API response returns status `200` within 50ms
- [ ] Print job queued/dispatched in background
- [ ] If printer offline: API still returns `200` (print fails silently in background)
- [ ] TCP timeout to unreachable printer does NOT block the API response
- [ ] Error logged in server console (but not returned to client)
- [ ] `printKitchenTicket()` called with `void ... .catch(console.error)` pattern
- [ ] No `await` before returning response for print operations

**Timing:** API response < 50ms regardless of printer state
