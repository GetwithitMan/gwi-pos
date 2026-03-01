# Suite 03: Bar Tabs & Pre-Auth

**Domain:** Bar Tabs, Pre-Authorization, Walkouts, Bottle Service
**Total Tests:** 22
**P0 Tests:** 5 | **P1 Tests:** 10 | **P2 Tests:** 7
**Last Updated:** 2026-02-28

---

## Section A: OPEN TAB (5 tests)

### TAB-01: Open tab with pre-auth
**Priority:** P0
**Prereqs:**
- Draft or open order (created via `POST /api/orders`)
- Payment reader configured (simulated or local)
- Card present at reader

**Steps:**
1. Create a draft order:
   ```
   POST /api/orders
   {
     "employeeId": "{bartenderId}",
     "locationId": "{locationId}",
     "orderType": "bar_tab",
     "items": []
   }
   ```
   Capture `orderId`.
2. Run pre-auth on the card:
   ```
   POST /api/orders/{orderId}/pre-auth
   {
     "readerId": "{readerId}",
     "employeeId": "{bartenderId}",
     "amount": 50.00
   }
   ```
3. `GET /api/orders/{orderId}` to verify tab state.

**Verify:**
- [ ] Pre-auth response: `approved: true`
- [ ] Response contains `orderCardId` (OrderCard record created)
- [ ] Response contains `cardType` (e.g., "Visa")
- [ ] Response contains `cardLast4` (4-digit string)
- [ ] Response contains `cardholderName` (if provided by reader)
- [ ] Response contains `authAmount` = 50.00
- [ ] DB: `OrderCard` created with `status: "authorized"`, `isDefault: true`
- [ ] DB: `OrderCard.recordNo` set (Datacap token for future capture)
- [ ] DB: Order has `tabStatus` = `"open"` or equivalent
- [ ] DB: Order `preAuthId` / `preAuthAmount` fields populated on order
- [ ] Socket: `tab:updated` fires with orderId
- [ ] OrderEvent: `TAB_OPENED` emitted

**Timing:** < 5s (includes card reader interaction)

---

### TAB-02: Open tab without pre-auth (cash tab)
**Priority:** P1
**Prereqs:**
- Employee with bar permissions

**Steps:**
1. Create order:
   ```
   POST /api/orders
   {
     "employeeId": "{bartenderId}",
     "locationId": "{locationId}",
     "orderType": "bar_tab",
     "items": []
   }
   ```
2. Open tab without pre-auth:
   ```
   POST /api/orders/{orderId}/open-tab
   {
     "employeeId": "{bartenderId}",
     "tabName": "Cash - Mike"
   }
   ```

**Verify:**
- [ ] Response status `200`
- [ ] Order `tabStatus` = `"open"`
- [ ] No `OrderCard` records (no card on file)
- [ ] `tabNickname` = "Cash - Mike"
- [ ] Order appears in open tabs list
- [ ] Tab can still accept items and be closed with cash payment

---

### TAB-03: Open tab with tab nickname
**Priority:** P1
**Prereqs:**
- Draft order with pre-auth (from TAB-01)

**Steps:**
1. `PATCH /api/orders/{orderId}`
   ```json
   {
     "tabNickname": "Johnson Party - Table 5"
   }
   ```
2. OR set during open-tab:
   ```
   POST /api/orders/{orderId}/open-tab
   {
     "employeeId": "{bartenderId}",
     "tabName": "Johnson Party - Table 5"
   }
   ```

**Verify:**
- [ ] `tabNickname` = "Johnson Party - Table 5"
- [ ] Tab displays with nickname in open orders panel
- [ ] Nickname persists across page refreshes
- [ ] Nickname appears on receipt when tab is closed

---

### TAB-04: Tab appears in open orders with tabStatus
**Priority:** P0
**Prereqs:**
- At least 2 open tabs and 1 open non-tab order

**Steps:**
1. `GET /api/orders/open`
2. Filter for bar tabs.

**Verify:**
- [ ] All open tabs returned with `tabStatus` field
- [ ] Non-tab orders have `tabStatus: null` or absent
- [ ] Tab orders have `tabStatus: "open"`
- [ ] Tab orders show `preAuthLast4` and `preAuthCardBrand` (for card tabs)
- [ ] Cash tabs show no card info
- [ ] Tabs are sorted by creation time (oldest first)

---

### TAB-05: Socket tab:updated fires on tab open
**Priority:** P1
**Prereqs:**
- WebSocket listener connected

**Steps:**
1. Open a new tab (TAB-01 or TAB-02 flow).
2. Listen for socket events.

**Verify:**
- [ ] `tab:updated` fires with `{ orderId, tabStatus: "open" }`
- [ ] `orders:list-changed` fires
- [ ] Events arrive on all connected terminals
- [ ] Events arrive within 200ms of API response

---

## Section B: ADD TO TAB (4 tests)

### TAB-06: Add items to existing tab
**Priority:** P0
**Prereqs:**
- Open tab (from TAB-01)

**Steps:**
1. `POST /api/orders/{orderId}/items`
   ```json
   {
     "items": [
       {
         "menuItemId": "{beerItemId}",
         "name": "IPA Draft",
         "price": 7.00,
         "quantity": 1,
         "modifiers": []
       }
     ]
   }
   ```
2. Wait 30 seconds (simulating bar service).
3. `POST /api/orders/{orderId}/items`
   ```json
   {
     "items": [
       {
         "menuItemId": "{shotItemId}",
         "name": "Jameson",
         "price": 9.00,
         "quantity": 1,
         "pourSize": "shot",
         "pourMultiplier": 1.0,
         "modifiers": []
       }
     ]
   }
   ```

**Verify:**
- [ ] Both items added successfully
- [ ] Order total updates after each add (first: $7.00, then: $16.00 + tax)
- [ ] Tab remains open (`tabStatus: "open"`)
- [ ] Items appear in order detail when fetched
- [ ] Both items have correct `seatNumber` assignment (default 1 if not specified)

---

### TAB-07: Tab totals update after adding items
**Priority:** P0
**Prereqs:**
- Tab with items added (from TAB-06)

**Steps:**
1. `GET /api/orders/{orderId}`
2. Check totals.

**Verify:**
- [ ] `subtotal` = sum of all item prices (including quantity * price)
- [ ] `taxAmount` calculated based on location tax rate
- [ ] `total` = subtotal + taxAmount - discounts
- [ ] Totals are consistent with item-level `itemTotal` fields
- [ ] If dual pricing enabled: `cardTotal` may differ from `cashTotal`

---

### TAB-08: Multiple add-to-tab calls over time
**Priority:** P1
**Prereqs:**
- Open tab

**Steps:**
1. Add 1 item at T+0.
2. Add 2 items at T+2min.
3. Add 1 item at T+5min.
4. `GET /api/orders/{orderId}` after all adds.

**Verify:**
- [ ] All 4 items present
- [ ] Items ordered by `createdAt` (oldest first)
- [ ] No items lost between requests
- [ ] Order version incremented with each add
- [ ] Tab nickname and card info unchanged

---

### TAB-09: Socket order:item-added fires after each add
**Priority:** P1
**Prereqs:**
- WebSocket listener on a second terminal

**Steps:**
1. Add item to tab from Terminal A.
2. Listen on Terminal B.

**Verify:**
- [ ] `order:item-added` fires with `{ orderId, itemId, itemName }`
- [ ] `orders:list-changed` fires (for open orders panel refresh)
- [ ] If tab is displayed on Terminal B, totals update
- [ ] Events arrive within 200ms

---

## Section C: CLOSE TAB (5 tests)

### TAB-10: Close tab with tip
**Priority:** P0
**Prereqs:**
- Open tab with pre-auth card and items totaling $35.00
- `OrderCard` with `status: "authorized"` and valid `recordNo`

**Steps:**
1. `POST /api/orders/{orderId}/close-tab`
   ```json
   {
     "employeeId": "{bartenderId}",
     "tipMode": "included",
     "tipAmount": 7.00
   }
   ```

**Verify:**
- [ ] Response status `200`
- [ ] Pre-auth captured for $42.00 (35.00 + 7.00 tip)
- [ ] DB: Payment created with `amount: 35.00`, `tipAmount: 7.00`
- [ ] DB: Payment `status: "completed"`
- [ ] DB: Payment `method: "card"`
- [ ] DB: `OrderCard.status` changed to `"captured"` (no longer "authorized")
- [ ] DB: Order `status` = `"paid"`, `paidAt` set
- [ ] DB: Order `tabStatus` = `"closed"`
- [ ] Tip allocated to bartender via `allocateTipsForPayment`
- [ ] Inventory deducted (fire-and-forget)
- [ ] Temporary seats cleaned up
- [ ] Socket: `payment:processed` fires
- [ ] Socket: `orders:list-changed` fires with trigger "paid"
- [ ] Socket: `tab:closed` fires
- [ ] OrderEvent: `TAB_CLOSED` + `PAYMENT_APPLIED` + `ORDER_CLOSED` emitted

**Timing:** < 5s (includes Datacap capture call)

---

### TAB-11: Close tab with no tip
**Priority:** P1
**Prereqs:**
- Open tab with card and items totaling $20.00

**Steps:**
1. `POST /api/orders/{orderId}/close-tab`
   ```json
   {
     "employeeId": "{bartenderId}",
     "tipMode": "included",
     "tipAmount": 0
   }
   ```

**Verify:**
- [ ] Capture amount = $20.00 (no tip)
- [ ] Payment `tipAmount` = 0
- [ ] Order paid and closed
- [ ] All other close-tab verifications pass (same as TAB-10 minus tip)

---

### TAB-12: Close tab where final amount > pre-auth amount (incremental auth)
**Priority:** P1
**Prereqs:**
- Tab opened with pre-auth of $50.00
- Items added totaling $75.00 (exceeds pre-auth)

**Steps:**
1. `POST /api/orders/{orderId}/close-tab`
   ```json
   {
     "employeeId": "{bartenderId}",
     "tipMode": "included",
     "tipAmount": 15.00
   }
   ```

**Verify:**
- [ ] Capture for $90.00 (75.00 + 15.00 tip) succeeds
- [ ] Even though pre-auth was only $50.00, Datacap processes the full capture
- [ ] Payment amount = 75.00, tipAmount = 15.00
- [ ] Order fully paid
- [ ] No second auth call needed (EMVPreAuthComplete handles the difference)

---

### TAB-13: Close tab where final amount < pre-auth amount (partial capture)
**Priority:** P1
**Prereqs:**
- Tab opened with pre-auth of $100.00
- Items totaling only $30.00

**Steps:**
1. `POST /api/orders/{orderId}/close-tab`
   ```json
   {
     "employeeId": "{bartenderId}",
     "tipMode": "included",
     "tipAmount": 5.00
   }
   ```

**Verify:**
- [ ] Capture for $35.00 (30.00 + 5.00 tip)
- [ ] Remaining $65.00 of pre-auth released back to customer
- [ ] Payment amount = 30.00
- [ ] Customer sees full $100 hold released, $35 charge applied
- [ ] Order fully paid

---

### TAB-14: Socket events fire on close
**Priority:** P0
**Prereqs:**
- WebSocket listener active

**Steps:**
1. Close any tab via close-tab endpoint.
2. Monitor socket events.

**Verify:**
- [ ] `payment:processed` fires with `{ orderId, method: "card", amount }`
- [ ] `orders:list-changed` fires with `{ trigger: "paid" }`
- [ ] `tab:closed` fires with `{ orderId }`
- [ ] `floorplan:updated` fires (if tab had tableId)
- [ ] All events arrive within 500ms of API response

---

## Section D: VOID TAB (3 tests)

### TAB-15: Void entire tab
**Priority:** P1
**Prereqs:**
- Open tab with pre-auth card (`OrderCard.status: "authorized"`)
- Items on the tab

**Steps:**
1. `POST /api/orders/{orderId}/void-tab`
   ```json
   {
     "employeeId": "{managerId}",
     "reason": "Customer left without ordering"
   }
   ```

**Verify:**
- [ ] Response status `200`
- [ ] DB: Each `OrderCard` with `status: "authorized"` voided on Datacap (`VoidSaleByRecordNo`)
- [ ] DB: `OrderCard.status` = `"voided"`
- [ ] DB: Order `status` = `"cancelled"`
- [ ] DB: Pre-auth hold released (customer sees pending charge disappear)
- [ ] Socket: `orders:list-changed` fires
- [ ] Socket: `tab:updated` fires
- [ ] Table released (if applicable)

---

### TAB-16: Void tab with items already sent to kitchen
**Priority:** P1
**Prereqs:**
- Tab with items sent to kitchen (`kitchenStatus: "pending"` or `"in_progress"`)

**Steps:**
1. `POST /api/orders/{orderId}/void-tab`
   ```json
   {
     "employeeId": "{managerId}",
     "reason": "Tab void - items made but not consumed"
   }
   ```

**Verify:**
- [ ] Tab voided successfully
- [ ] Kitchen items marked appropriately (void notification to KDS)
- [ ] If items were already made: `wasMade: true` recorded for waste tracking
- [ ] Inventory: waste transaction created for made items (type = "waste")
- [ ] Pre-auth released on card

---

### TAB-17: Void tab reversal fails -- warning returned
**Priority:** P1
**Prereqs:**
- Voided tab (from TAB-15)

**Steps:**
1. Attempt to re-void or unvoid:
   ```
   POST /api/orders/{orderId}/void-tab
   { "employeeId": "{managerId}" }
   ```

**Verify:**
- [ ] Response `400` (tab already voided / no authorized cards)
- [ ] Error message: "No authorized cards to void on this tab"
- [ ] Tab remains in voided/cancelled state
- [ ] No additional Datacap calls made

---

## Section E: WALKOUT (3 tests)

### TAB-18: Mark order as walkout
**Priority:** P1
**Prereqs:**
- Open tab with pre-auth card and items
- Tab is open (not yet paid or voided)

**Steps:**
1. `POST /api/orders/{orderId}/mark-walkout`
   ```json
   {
     "employeeId": "{managerId}"
   }
   ```
2. `GET /api/orders/{orderId}` to confirm state.

**Verify:**
- [ ] Response status `200`
- [ ] DB: `isWalkout` = `true`
- [ ] DB: `walkoutAt` = current timestamp
- [ ] DB: `walkoutMarkedBy` = managerId
- [ ] Pre-auth card NOT voided (held for retry capture)
- [ ] Order status remains open (not cancelled -- awaiting capture retry)
- [ ] Socket: `orders:list-changed` fires
- [ ] Order appears in walkout recovery list

---

### TAB-19: Walkout retry capture
**Priority:** P2
**Prereqs:**
- Walkout order (from TAB-18) with authorized card still on file

**Steps:**
1. `POST /api/orders/{orderId}/retry-capture`
   ```json
   {
     "employeeId": "{managerId}"
   }
   ```

**Verify:**
- [ ] Datacap capture attempted for full order amount
- [ ] If capture succeeds: order paid, Payment created
- [ ] If capture fails: `captureDeclinedAt` set, `captureRetryCount` incremented, `lastCaptureError` stored
- [ ] Manager notified of result
- [ ] Maximum retry count enforced (if configured)

---

### TAB-20: Walkout with expired pre-auth
**Priority:** P2
**Prereqs:**
- Walkout order where `preAuthExpiresAt` is in the past

**Steps:**
1. Attempt retry capture on expired pre-auth.

**Verify:**
- [ ] Datacap returns decline/error (auth expired)
- [ ] `captureDeclinedAt` set
- [ ] `lastCaptureError` contains expiration-related message
- [ ] Order remains in walkout state for manual resolution
- [ ] Manager can choose to write off or attempt alternative collection

---

## Section F: BOTTLE SERVICE (2 tests)

### TAB-21: Start bottle service tab with tier and pre-auth
**Priority:** P2
**Prereqs:**
- Bottle service configuration enabled for location
- Bottle service tier defined (e.g., "Gold Tier" - $500 minimum)

**Steps:**
1. Create order:
   ```
   POST /api/orders
   {
     "employeeId": "{bartenderId}",
     "locationId": "{locationId}",
     "orderType": "bar_tab",
     "items": []
   }
   ```
2. Start bottle service:
   ```
   POST /api/orders/{orderId}/bottle-service
   {
     "tierId": "{goldTierId}",
     "employeeId": "{bartenderId}"
   }
   ```
3. Run pre-auth:
   ```
   POST /api/orders/{orderId}/pre-auth
   {
     "readerId": "{readerId}",
     "employeeId": "{bartenderId}",
     "amount": 500.00
   }
   ```

**Verify:**
- [ ] `isBottleService` = `true` on order
- [ ] Pre-auth amount matches tier minimum
- [ ] Bottle service tier info stored on order
- [ ] Tab appears with bottle service indicator in open orders

---

### TAB-22: Bottle service minimum spend enforcement
**Priority:** P2
**Prereqs:**
- Bottle service tab with minimum spend = $500
- Items totaling $300 (below minimum)

**Steps:**
1. Attempt to close tab with only $300 in items.

**Verify:**
- [ ] System enforces minimum: either rejects close or charges minimum amount
- [ ] `bottleServiceCurrentSpend` tracked accurately
- [ ] If under minimum: warning or auto-adjustment to minimum
- [ ] Tip calculated on actual spend (not minimum, unless configured otherwise)
- [ ] `POST /api/orders/{orderId}/bottle-service/re-auth` available if more spend needed
