# Suite 05: Voids, Comps & Discounts

**Domain:** Voids, Comps, Order Discounts, Item Discounts, Coupons
**Total Tests:** 30
**P0 Tests:** 10 | **P1 Tests:** 13 | **P2 Tests:** 7
**Last Updated:** 2026-02-28

---

## Section A: VOID ITEMS (8 tests)

### VCD-01: Void single item before send
**Priority:** P0
**Prereqs:**
- Open order with at least 2 items (one to void, one to keep)
- Item has NOT been sent to kitchen (`kitchenStatus: null`)
- Manager with `manager.void_orders` permission

**Steps:**
1. `POST /api/orders/{orderId}/comp-void`
   ```json
   {
     "itemIds": ["{itemId}"],
     "action": "void",
     "reason": "customer_changed_mind",
     "managerId": "{managerId}"
   }
   ```
2. `GET /api/orders/{orderId}` to verify state.
3. `GET /api/reports/voids?orderId={orderId}` to verify void log.

**Verify:**
- [ ] Response status `200`
- [ ] Voided item `status` = `"voided"`
- [ ] Voided item `voidReason` = `"customer_changed_mind"`
- [ ] Order `subtotal` recalculated (excludes voided item price)
- [ ] Order `taxAmount` recalculated on reduced subtotal
- [ ] Order `total` = new subtotal + new tax
- [ ] Remaining items unchanged (`status: "active"`)
- [ ] DB: `VoidLog` entry created with `action: "void"`, `itemId`, `managerId`, `reason`
- [ ] Socket: `orders:list-changed` fires
- [ ] Socket: `order:totals-updated` fires with new totals
- [ ] OrderEvent: `COMP_VOID_APPLIED` emitted with `action: "void"`
- [ ] No inventory deduction for unsent voided item (`wasMade: false`)

**Timing:** < 200ms response time

---

### VCD-02: Void item after kitchen send
**Priority:** P0
**Prereqs:**
- Open order with item already sent to kitchen (`kitchenStatus: "pending"` or `"cooking"`)
- Manager with void permission

**Steps:**
1. Confirm item has `kitchenStatus` != null (sent to kitchen).
2. `POST /api/orders/{orderId}/comp-void`
   ```json
   {
     "itemIds": ["{sentItemId}"],
     "action": "void",
     "reason": "wrong_item",
     "managerId": "{managerId}",
     "wasMade": true
   }
   ```
3. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Item `status` = `"voided"`
- [ ] Item `wasMade` = `true` (item was prepared before void)
- [ ] Order totals recalculated (excludes voided item)
- [ ] DB: `VoidLog` entry with `wasMade: true`
- [ ] Inventory: waste deduction triggered for voided item (`deductInventoryForVoidedItem`)
  - Transaction type = `"waste"` (not `"sale"`)
  - Recipe ingredients deducted based on item recipe
- [ ] Socket: `kds:item-voided` fires (KDS removes item from screen)
- [ ] OrderEvent: `COMP_VOID_APPLIED` emitted
- [ ] Kitchen ticket reprint triggered (void ticket / 86 ticket)

**Timing:** < 300ms response time

---

### VCD-03: Void item with specific reason codes
**Priority:** P0
**Prereqs:**
- Open order with active items
- Manager

**Steps:**
1. Void with reason `"customer_changed_mind"`:
   ```
   POST /api/orders/{orderId}/comp-void
   { "itemIds": ["{item1}"], "action": "void", "reason": "customer_changed_mind", "managerId": "{managerId}" }
   ```
2. Void with reason `"wrong_item"`:
   ```
   POST /api/orders/{orderId}/comp-void
   { "itemIds": ["{item2}"], "action": "void", "reason": "wrong_item", "managerId": "{managerId}" }
   ```
3. Void with reason `"quality"`:
   ```
   POST /api/orders/{orderId}/comp-void
   { "itemIds": ["{item3}"], "action": "void", "reason": "quality", "managerId": "{managerId}" }
   ```

**Verify:**
- [ ] Each voided item stores its specific `voidReason`
- [ ] Each creates a `VoidLog` entry with the matching reason
- [ ] `GET /api/reports/voids` shows all 3 entries with correct reasons
- [ ] Void by reason breakdown report distinguishes each type

---

### VCD-04: Void requires manager approval (remote approval workflow)
**Priority:** P1
**Prereqs:**
- Location setting: `requireManagerApprovalForVoids: true`
- Non-manager employee (PIN 2345, serverId)
- Manager available to approve (PIN 1234, managerId)

**Steps:**
1. Server requests void:
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{itemId}"],
     "action": "void",
     "reason": "wrong_item",
     "employeeId": "{serverId}"
   }
   ```
2. Verify void is in `"pending_approval"` state.
3. Manager approves:
   ```
   POST /api/orders/{orderId}/comp-void/approve
   {
     "approvalId": "{approvalId}",
     "managerId": "{managerId}"
   }
   ```
4. `GET /api/orders/{orderId}` to confirm item voided.

**Verify:**
- [ ] Step 1: Response status `202` (accepted, pending approval)
- [ ] Step 1: Item NOT voided yet (still `status: "active"`)
- [ ] Step 1: Approval request created in DB
- [ ] Socket: `void:approval-requested` fires (manager terminals notified)
- [ ] Step 3: Manager approval succeeds
- [ ] Step 4: Item `status` = `"voided"` after approval
- [ ] Socket: `void:approval-update` fires with `approved: true`
- [ ] VoidLog created with both `employeeId` (requester) and `managerId` (approver)

---

### VCD-05: Void approval rejected -- item stays active
**Priority:** P1
**Prereqs:**
- Pending void approval from VCD-04 (or recreated)

**Steps:**
1. Manager rejects:
   ```
   POST /api/orders/{orderId}/comp-void/reject
   {
     "approvalId": "{approvalId}",
     "managerId": "{managerId}",
     "rejectReason": "Item was correct"
   }
   ```
2. `GET /api/orders/{orderId}` to confirm.

**Verify:**
- [ ] Item remains `status: "active"` (NOT voided)
- [ ] Order totals unchanged
- [ ] Socket: `void:approval-update` fires with `approved: false`
- [ ] Approval record marked as rejected with reason
- [ ] No VoidLog created for rejected voids
- [ ] No inventory deduction triggered

---

### VCD-06: Void approval expires after timeout
**Priority:** P2
**Prereqs:**
- Pending void approval
- Location setting: `voidApprovalTimeoutMinutes: 5` (or similar)

**Steps:**
1. Create void approval request (from VCD-04 step 1).
2. Wait for timeout to elapse (or simulate via direct DB update of `createdAt`).
3. Attempt to approve the expired request.

**Verify:**
- [ ] Expired approval cannot be approved (returns `400` or `410`)
- [ ] Item remains `status: "active"`
- [ ] Approval record marked as `"expired"`
- [ ] Employee must re-request the void if still needed

---

### VCD-07: Void last item on order -- order auto-cancelled
**Priority:** P0
**Prereqs:**
- Order with exactly 1 active item (no other active items)
- Manager

**Steps:**
1. `POST /api/orders/{orderId}/comp-void`
   ```json
   {
     "itemIds": ["{onlyItemId}"],
     "action": "void",
     "reason": "customer_changed_mind",
     "managerId": "{managerId}"
   }
   ```
2. `GET /api/orders/{orderId}` to check state.

**Verify:**
- [ ] Item `status` = `"voided"`
- [ ] Order `status` = `"cancelled"` (auto-closed, zero active items)
- [ ] Response includes `orderAutoClosed: true`
- [ ] Order no longer appears in `GET /api/orders/open`
- [ ] Table released to `available` (if order had tableId)
- [ ] Socket: `orders:list-changed` fires with `trigger: "cancelled"`
- [ ] Socket: `floorplan:updated` fires (table released)
- [ ] No payment required for $0 order

---

### VCD-08: Void item AFTER payment -- Datacap reversal attempted
**Priority:** P0
**Prereqs:**
- Fully paid order (`status: "paid"`) with card payment
- Manager with void permission
- Order must first be reopened (via `POST /api/orders/{id}/reopen`)

**Steps:**
1. Reopen the paid order:
   ```
   POST /api/orders/{orderId}/reopen
   { "reason": "Item was wrong", "managerId": "{managerId}" }
   ```
2. Void item on reopened order:
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{itemId}"],
     "action": "void",
     "reason": "wrong_item",
     "managerId": "{managerId}"
   }
   ```
3. Check if payment adjustment was triggered.

**Verify:**
- [ ] Order reopened successfully (status back to `"open"`)
- [ ] Item voided on reopened order
- [ ] Order totals recalculated
- [ ] If card payment: Datacap `emvReturn` or `voidSale` called for difference
- [ ] Payment adjustment record created in DB (refund amount = voided item total)
- [ ] If refund succeeds: payment status updated
- [ ] If refund fails: error logged, order still reflects void (refund retryable)
- [ ] VoidLog entry includes `afterPayment: true` flag

---

## Section B: COMP ITEMS (5 tests)

### VCD-09: Comp single item
**Priority:** P0
**Prereqs:**
- Open order with at least 2 items
- Manager with comp permission

**Steps:**
1. `POST /api/orders/{orderId}/comp-void`
   ```json
   {
     "itemIds": ["{itemId}"],
     "action": "comp",
     "reason": "manager_decision",
     "managerId": "{managerId}"
   }
   ```
2. `GET /api/orders/{orderId}` to verify state.

**Verify:**
- [ ] Item `status` = `"comped"`
- [ ] Item remains visible on order (not removed) but at $0.00 effective price
- [ ] Order `subtotal` recalculated (excludes comped item value)
- [ ] Order `taxAmount` recalculated on reduced subtotal
- [ ] Order `total` = new subtotal + new tax
- [ ] DB: `VoidLog` entry with `action: "comp"`, `compReason: "manager_decision"`
- [ ] Socket: `orders:list-changed` fires
- [ ] Socket: `order:totals-updated` fires
- [ ] OrderEvent: `COMP_VOID_APPLIED` emitted with `action: "comp"`

**Timing:** < 200ms response time

---

### VCD-10: Comp with specific reason codes
**Priority:** P1
**Prereqs:**
- Open order with items, manager

**Steps:**
1. Comp with `"manager_decision"` reason.
2. Comp with `"regular_customer"` reason.
3. Comp with `"quality_issue"` reason.

**Verify:**
- [ ] Each comp stores its specific `compReason`
- [ ] Each creates a `VoidLog` entry with `action: "comp"` and the matching reason
- [ ] Void/comp report distinguishes comps from voids by `action` field
- [ ] Comp dollar total tracked separately from void dollar total in reports

---

### VCD-11: Comp requires manager PIN
**Priority:** P1
**Prereqs:**
- Non-manager employee attempting comp
- Manager available

**Steps:**
1. Attempt comp without managerId:
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{itemId}"],
     "action": "comp",
     "reason": "quality_issue",
     "employeeId": "{serverId}"
   }
   ```
2. Verify rejection.
3. Retry with manager PIN:
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{itemId}"],
     "action": "comp",
     "reason": "quality_issue",
     "managerId": "{managerId}"
   }
   ```

**Verify:**
- [ ] Step 1: Returns `403` (insufficient permissions for comp without manager)
- [ ] Step 1: Item NOT comped
- [ ] Step 3: Succeeds with manager authorization
- [ ] VoidLog records `managerId` as the authorizer

---

### VCD-12: Comp after payment (forgiveness, not refund)
**Priority:** P1
**Prereqs:**
- Paid order, reopened by manager
- Card payment on file

**Steps:**
1. Reopen order.
2. Comp an item:
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{itemId}"],
     "action": "comp",
     "reason": "manager_decision",
     "managerId": "{managerId}"
   }
   ```

**Verify:**
- [ ] Item `status` = `"comped"`
- [ ] NO Datacap reversal triggered (comp is forgiveness, NOT a refund)
- [ ] Order totals recalculated but existing payment stands
- [ ] Overpayment tracked (paid > new total) or balance adjusted
- [ ] VoidLog records comp after payment
- [ ] Comp report includes this item at original price (cost to venue)

---

### VCD-13: Inventory waste deducted on comp (if wasMade=true)
**Priority:** P1
**Prereqs:**
- Open order with item sent to kitchen (kitchenStatus != null)
- Manager

**Steps:**
1. Comp the sent item with `wasMade: true`:
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{sentItemId}"],
     "action": "comp",
     "reason": "quality_issue",
     "managerId": "{managerId}",
     "wasMade": true
   }
   ```
2. Check inventory transaction log.

**Verify:**
- [ ] Item `status` = `"comped"`, `wasMade` = `true`
- [ ] `deductInventoryForVoidedItem()` called (fire-and-forget)
- [ ] InventoryTransaction created with `type: "waste"`
- [ ] Ingredient quantities deducted based on item recipe
- [ ] Modifier ingredients also deducted (if modifiers have linked ingredients)
- [ ] If `wasMade: false`, NO inventory deduction occurs

---

## Section C: ORDER-LEVEL DISCOUNTS (6 tests)

### VCD-14: Apply percentage discount to order
**Priority:** P0
**Prereqs:**
- Open order with items, subtotal = $50.00
- Manager or employee with discount permission

**Steps:**
1. `POST /api/orders/{orderId}/discount`
   ```json
   {
     "type": "percentage",
     "value": 10,
     "reason": "Happy hour",
     "employeeId": "{employeeId}"
   }
   ```
2. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Response status `200`
- [ ] `OrderDiscount` record created with `type: "percentage"`, `value: 10`
- [ ] Discount amount = $5.00 (10% of $50.00)
- [ ] Order `discountTotal` = $5.00
- [ ] Order `subtotal` remains $50.00 (discount shown separately)
- [ ] Order `taxAmount` recalculated on discounted amount ($45.00)
- [ ] Order `total` = $45.00 + tax on $45.00
- [ ] Socket: `orders:list-changed` fires
- [ ] Socket: `order:totals-updated` fires
- [ ] OrderEvent: `DISCOUNT_APPLIED` emitted

**Timing:** < 200ms response time

---

### VCD-15: Apply fixed amount discount to order
**Priority:** P0
**Prereqs:**
- Open order with items, subtotal = $50.00

**Steps:**
1. `POST /api/orders/{orderId}/discount`
   ```json
   {
     "type": "fixed",
     "value": 15.00,
     "reason": "Manager override",
     "employeeId": "{managerId}"
   }
   ```
2. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] `OrderDiscount` record created with `type: "fixed"`, `value: 15.00`
- [ ] Discount amount = $15.00
- [ ] Order `discountTotal` = $15.00
- [ ] Order `taxAmount` recalculated on $35.00 (50 - 15)
- [ ] Order `total` = $35.00 + tax on $35.00
- [ ] OrderEvent: `DISCOUNT_APPLIED` emitted

---

### VCD-16: Remove discount from order
**Priority:** P0
**Prereqs:**
- Order with an active discount (from VCD-14 or VCD-15)

**Steps:**
1. `DELETE /api/orders/{orderId}/discount/{discountId}`
   OR
   ```
   POST /api/orders/{orderId}/discount
   { "action": "remove", "discountId": "{discountId}" }
   ```
2. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Discount record removed (soft-deleted or marked inactive)
- [ ] Order `discountTotal` = $0.00
- [ ] Order `subtotal` unchanged
- [ ] Order `taxAmount` recalculated on full subtotal
- [ ] Order `total` = full subtotal + tax (back to original)
- [ ] Socket: `orders:list-changed` fires
- [ ] Socket: `order:totals-updated` fires
- [ ] OrderEvent: `DISCOUNT_REMOVED` emitted

---

### VCD-17: Discount requires manager approval
**Priority:** P1
**Prereqs:**
- Location setting: `requireManagerApprovalForDiscounts: true` (or discount `requiresApproval: true`)
- Non-manager employee

**Steps:**
1. Server attempts discount:
   ```
   POST /api/orders/{orderId}/discount
   {
     "type": "percentage",
     "value": 20,
     "reason": "Regular customer",
     "employeeId": "{serverId}"
   }
   ```
2. Verify requires manager override.
3. Retry with manager authorization:
   ```
   POST /api/orders/{orderId}/discount
   {
     "type": "percentage",
     "value": 20,
     "reason": "Regular customer",
     "employeeId": "{serverId}",
     "managerId": "{managerId}"
   }
   ```

**Verify:**
- [ ] Step 1: Returns `403` or requires additional manager PIN
- [ ] Step 1: Discount NOT applied
- [ ] Step 3: Discount applied with manager authorization
- [ ] Discount record stores both `employeeId` (requester) and `managerId` (authorizer)

---

### VCD-18: Discount cannot exceed order total
**Priority:** P1
**Prereqs:**
- Open order with subtotal = $25.00

**Steps:**
1. Attempt fixed discount exceeding total:
   ```
   POST /api/orders/{orderId}/discount
   {
     "type": "fixed",
     "value": 30.00,
     "reason": "Test",
     "employeeId": "{managerId}"
   }
   ```
2. Attempt 100% percentage discount:
   ```
   POST /api/orders/{orderId}/discount
   {
     "type": "percentage",
     "value": 100,
     "reason": "Full comp via discount",
     "employeeId": "{managerId}"
   }
   ```

**Verify:**
- [ ] Step 1: Returns `400` (discount exceeds order subtotal)
- [ ] OR discount capped at $25.00 (implementation-dependent)
- [ ] Step 2: Either rejected or capped at subtotal (100% discount = $0 total)
- [ ] Order total never goes negative
- [ ] Tax on negative base = $0.00

---

### VCD-19: Multiple discounts on same order
**Priority:** P2
**Prereqs:**
- Open order with subtotal = $100.00

**Steps:**
1. Apply 10% discount:
   ```
   POST /api/orders/{orderId}/discount
   { "type": "percentage", "value": 10, "reason": "Loyalty", "employeeId": "{managerId}" }
   ```
2. Apply $5.00 fixed discount:
   ```
   POST /api/orders/{orderId}/discount
   { "type": "fixed", "value": 5.00, "reason": "Promo", "employeeId": "{managerId}" }
   ```
3. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Both discounts applied (if multiple discounts allowed)
- [ ] OR second discount rejected with "only one discount per order" error
- [ ] If stacked: total discount = $10.00 + $5.00 = $15.00 (or $10.00 then 5 off $90 = $14.50 if sequential)
- [ ] Order `discountTotal` reflects combined discounts
- [ ] Tax calculated on final discounted amount
- [ ] Both discounts visible in order detail

---

## Section D: ITEM-LEVEL DISCOUNTS (5 tests)

### VCD-20: Apply percentage discount to single item
**Priority:** P0
**Prereqs:**
- Open order with item priced at $20.00

**Steps:**
1. `POST /api/orders/{orderId}/items/{itemId}/discount`
   ```json
   {
     "type": "percentage",
     "value": 25,
     "reason": "Manager comp",
     "employeeId": "{managerId}"
   }
   ```
2. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Item discount record created
- [ ] Item effective price = $15.00 (25% off $20.00)
- [ ] Item `discountAmount` = $5.00
- [ ] Order `subtotal` reduced by $5.00
- [ ] Order `taxAmount` recalculated on reduced subtotal
- [ ] Order `total` reflects discounted item
- [ ] Other items on order unaffected
- [ ] Socket: `order:totals-updated` fires
- [ ] OrderEvent: `DISCOUNT_APPLIED` emitted (item-level)

**Timing:** < 200ms response time

---

### VCD-21: Apply fixed amount discount to single item
**Priority:** P1
**Prereqs:**
- Open order with item priced at $30.00

**Steps:**
1. `POST /api/orders/{orderId}/items/{itemId}/discount`
   ```json
   {
     "type": "fixed",
     "value": 8.00,
     "reason": "Birthday special",
     "employeeId": "{managerId}"
   }
   ```

**Verify:**
- [ ] Item effective price = $22.00 ($30.00 - $8.00)
- [ ] Item `discountAmount` = $8.00
- [ ] Order totals recalculated
- [ ] Fixed discount cannot exceed item price (returns `400` if $8 > item price)

---

### VCD-22: Remove item discount
**Priority:** P1
**Prereqs:**
- Order with item that has a discount applied (from VCD-20 or VCD-21)

**Steps:**
1. `DELETE /api/orders/{orderId}/items/{itemId}/discount/{discountId}`
   OR
   ```
   POST /api/orders/{orderId}/items/{itemId}/discount
   { "action": "remove", "discountId": "{discountId}" }
   ```
2. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Item discount removed
- [ ] Item reverts to full price
- [ ] Order `subtotal` recalculated upward
- [ ] Order `taxAmount` recalculated on full subtotal
- [ ] Order `total` reflects full item price
- [ ] OrderEvent: `DISCOUNT_REMOVED` emitted (item-level)

---

### VCD-23: Item discount affects order total correctly
**Priority:** P0
**Prereqs:**
- Order with 3 items: A ($10.00), B ($20.00), C ($15.00) — subtotal = $45.00

**Steps:**
1. Apply 50% discount to item B:
   ```
   POST /api/orders/{orderId}/items/{itemBId}/discount
   { "type": "percentage", "value": 50, "reason": "Half off special", "employeeId": "{managerId}" }
   ```
2. `GET /api/orders/{orderId}` to verify totals.

**Verify:**
- [ ] Item B effective price = $10.00 (50% off $20.00)
- [ ] Order `subtotal` = $35.00 ($10 + $10 + $15)
- [ ] Tax calculated on $35.00
- [ ] Items A and C remain at full price
- [ ] `discountTotal` on order = $10.00

---

### VCD-24: Item discount + order discount stack correctly
**Priority:** P2
**Prereqs:**
- Order with 2 items: A ($40.00) and B ($60.00) — subtotal = $100.00

**Steps:**
1. Apply 20% item discount to item A:
   ```
   POST /api/orders/{orderId}/items/{itemAId}/discount
   { "type": "percentage", "value": 20, "reason": "Item promo", "employeeId": "{managerId}" }
   ```
2. Apply 10% order discount:
   ```
   POST /api/orders/{orderId}/discount
   { "type": "percentage", "value": 10, "reason": "Loyalty", "employeeId": "{managerId}" }
   ```
3. `GET /api/orders/{orderId}` to verify final totals.

**Verify:**
- [ ] Item A discount: $8.00 (20% of $40), effective = $32.00
- [ ] Subtotal after item discounts: $92.00 ($32 + $60)
- [ ] Order discount applied to remaining: $9.20 (10% of $92) OR applied to original subtotal (implementation-dependent)
- [ ] Total discount = $8.00 + $9.20 = $17.20
- [ ] Tax calculated on final discounted amount
- [ ] Both discount records visible on order
- [ ] Neither discount causes negative totals

---

## Section E: COUPONS (3 tests)

### VCD-25: Apply coupon code
**Priority:** P1
**Prereqs:**
- Active coupon in system (e.g., code `"SUMMER10"`, 10% off, not expired)
- Open order with items

**Steps:**
1. `POST /api/orders/{orderId}/coupon`
   ```json
   {
     "code": "SUMMER10",
     "employeeId": "{employeeId}"
   }
   ```
2. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Coupon validated and applied
- [ ] Discount created matching coupon rules (10% off)
- [ ] Order totals recalculated
- [ ] Coupon `usageCount` incremented by 1
- [ ] Coupon reference stored on discount record
- [ ] OrderEvent: `DISCOUNT_APPLIED` emitted (coupon-sourced)

---

### VCD-26: Expired coupon rejected
**Priority:** P1
**Prereqs:**
- Coupon with `expiresAt` in the past (e.g., `"EXPIRED20"`)
- Open order

**Steps:**
1. `POST /api/orders/{orderId}/coupon`
   ```json
   {
     "code": "EXPIRED20",
     "employeeId": "{employeeId}"
   }
   ```

**Verify:**
- [ ] Response status `400` or `422`
- [ ] Error message indicates coupon is expired
- [ ] No discount applied to order
- [ ] Order totals unchanged
- [ ] Coupon `usageCount` NOT incremented

---

### VCD-27: Coupon usage limit enforced
**Priority:** P2
**Prereqs:**
- Coupon with `maxUsage: 5` and `usageCount: 5` (already fully used)

**Steps:**
1. `POST /api/orders/{orderId}/coupon`
   ```json
   {
     "code": "LIMITED5",
     "employeeId": "{employeeId}"
   }
   ```

**Verify:**
- [ ] Response status `400` or `422`
- [ ] Error message indicates coupon usage limit reached
- [ ] No discount applied
- [ ] Order totals unchanged
- [ ] Coupon `usageCount` remains at 5 (no increment)

---

## Section F: CROSS-CHECKS (3 tests)

### VCD-28: Socket order:totals-updated fires after any void/comp/discount
**Priority:** P0
**Prereqs:**
- WebSocket listener connected to location room
- Open order

**Steps:**
1. Perform a void → listen for socket event.
2. Perform a comp → listen for socket event.
3. Apply a discount → listen for socket event.
4. Remove a discount → listen for socket event.

**Verify:**
- [ ] `order:totals-updated` (or `orders:list-changed`) fires after EACH operation
- [ ] Event payload includes `orderId` and updated totals
- [ ] All events arrive within 200ms of API response
- [ ] Other terminals displaying this order update their totals in real-time
- [ ] No duplicate socket events per operation (exactly one event per action)

---

### VCD-29: Void report reflects all voids from this suite
**Priority:** P1
**Prereqs:**
- Multiple voids performed during this test suite (VCD-01 through VCD-08)

**Steps:**
1. `GET /api/reports/voids?startDate={today}&endDate={today}`
2. Cross-reference against VoidLog entries.

**Verify:**
- [ ] Report count matches number of `VoidLog` entries with `action: "void"` today
- [ ] Report dollar total matches sum of voided item prices
- [ ] Each void shows: item name, price, reason, employee, manager, timestamp
- [ ] Voids with `wasMade: true` flagged as waste
- [ ] Voids with `wasMade: false` (or null) flagged as no-waste
- [ ] Report can filter by reason code
- [ ] Report can filter by employee

---

### VCD-30: Discount report reflects all discounts from this suite
**Priority:** P1
**Prereqs:**
- Multiple discounts applied during this test suite (VCD-14 through VCD-25)

**Steps:**
1. `GET /api/reports/discounts?startDate={today}&endDate={today}`
2. Cross-reference against OrderDiscount records.

**Verify:**
- [ ] Report count matches number of active discount records today
- [ ] Report dollar total matches sum of discount amounts
- [ ] Order-level discounts and item-level discounts both included
- [ ] Each discount shows: type (percentage/fixed), value, reason, order number, employee
- [ ] Coupon-based discounts flagged with coupon code
- [ ] Report can filter by discount type
- [ ] Removed discounts NOT included in active totals (but may appear in audit log)
