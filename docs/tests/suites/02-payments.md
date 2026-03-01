# Suite 02: Payments

**Domain:** Payments
**Total Tests:** 35
**P0 Tests:** 12 | **P1 Tests:** 14 | **P2 Tests:** 9
**Last Updated:** 2026-02-28

---

## Section A: CASH (6 tests)

### PAY-01: Exact cash payment
**Priority:** P0
**Prereqs:**
- Open order with at least 1 active item, total > $0
- Employee with POS access
- Order already sent to kitchen (status = open/in_progress)

**Steps:**
1. `GET /api/orders/{orderId}` to read current `total`.
2. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "cash",
     "amount": {orderTotal},
     "tipAmount": 0,
     "terminalId": "{terminalId}"
   }
   ```
3. `GET /api/orders/{orderId}` to confirm final state.

**Verify:**
- [ ] Response status `200`
- [ ] `data.order.status` = `"paid"`
- [ ] `data.order.paidAt` is set (ISO timestamp)
- [ ] `data.payment.method` = `"cash"`
- [ ] `data.payment.amount` = order total
- [ ] `data.payment.status` = `"completed"`
- [ ] `data.payment.tipAmount` = 0
- [ ] `data.changeAmount` = 0 (exact payment)
- [ ] DB: Payment record created with correct `orderId` and `locationId`
- [ ] DB: Order.isClosed = true
- [ ] Socket: `payment:processed` fires with `{ orderId, method: "cash" }`
- [ ] Socket: `orders:list-changed` fires
- [ ] OrderEvent: `PAYMENT_APPLIED` + `ORDER_CLOSED` emitted

**Timing:** < 200ms response time (no Datacap call for cash)

---

### PAY-02: Cash overpayment with change due
**Priority:** P0
**Prereqs:**
- Open order with total = $18.97

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "cash",
     "amount": 20.00,
     "tipAmount": 0,
     "terminalId": "{terminalId}"
   }
   ```

**Verify:**
- [ ] Response status `200`
- [ ] `data.changeAmount` = 1.03 (20.00 - 18.97)
- [ ] `data.payment.amount` = 18.97 (order total, not tendered amount)
- [ ] Order `status` = `"paid"`
- [ ] No negative values anywhere in response
- [ ] DB: Payment.amount = order total (not the overpayment)

---

### PAY-03: Cash with tip
**Priority:** P1
**Prereqs:**
- Open order with total = $25.00

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "cash",
     "amount": 30.00,
     "tipAmount": 5.00,
     "terminalId": "{terminalId}"
   }
   ```

**Verify:**
- [ ] `data.payment.tipAmount` = 5.00
- [ ] `data.payment.amount` = 25.00 (order total)
- [ ] `data.changeAmount` = 0.00 (30.00 - 25.00 - 5.00)
- [ ] DB: TipLedger entry created (or tip stored on Payment)
- [ ] Tip allocated to serving employee via `allocateTipsForPayment`

---

### PAY-04: Cash with rounding adjustment (priceRounding enabled)
**Priority:** P1
**Prereqs:**
- Location settings: `priceRounding.enabled = true`, `priceRounding.increment = 0.05`
- Order with total = $18.97

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "cash",
     "amount": 18.95,
     "tipAmount": 0,
     "terminalId": "{terminalId}"
   }
   ```

**Verify:**
- [ ] Response status `200`
- [ ] Order paid despite $0.02 difference (within rounding tolerance)
- [ ] `data.payment.roundingAdjustment` = -0.02 (or appropriate direction)
- [ ] DB: Payment has `roundingAdjustment` stored
- [ ] Rounding tolerance = half of increment = $0.025

---

### PAY-05: Cash payment on $0 order (all items voided = auto-cancel)
**Priority:** P0
**Prereqs:**
- Order where all items have been voided (`status: "voided"`)

**Steps:**
1. Void all items via `POST /api/orders/{orderId}/comp-void`
2. Observe auto-cancel behavior.

**Verify:**
- [ ] Order auto-cancels (`status: "cancelled"`) when last item voided
- [ ] No payment creation needed
- [ ] Table released
- [ ] `orderAutoClosed: true` in comp-void response
- [ ] Attempting `POST /pay` on cancelled order returns error

---

### PAY-06: Cash drawer kick fires on cash payment
**Priority:** P1
**Prereqs:**
- Cash drawer configured for the terminal
- Open order

**Steps:**
1. `POST /api/orders/{orderId}/pay` with `paymentMethod: "cash"`
2. Check drawer kick trigger.

**Verify:**
- [ ] `triggerCashDrawer()` called (fire-and-forget)
- [ ] Drawer kick command sent to configured printer/device
- [ ] Drawer does NOT kick for card payments
- [ ] Payment response is not delayed by drawer kick (async)

---

## Section B: CARD (6 tests)

### PAY-07: Card payment full amount (simulated Datacap)
**Priority:** P0
**Prereqs:**
- Open order with total > $0
- Payment reader configured (or simulated mode)
- `processor: "simulated"` in dev environment

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "card",
     "amount": {orderTotal},
     "tipAmount": 0,
     "readerId": "{readerId}"
   }
   ```

**Verify:**
- [ ] Response status `200`
- [ ] `data.payment.method` = `"card"`
- [ ] `data.payment.status` = `"completed"`
- [ ] `data.payment.authCode` is set (simulated: 6-digit code)
- [ ] `data.payment.transactionId` is set
- [ ] Order `status` = `"paid"`
- [ ] DB: Payment.cardBrand and Payment.cardLast4 populated
- [ ] OrderEvent: `PAYMENT_APPLIED` + `ORDER_CLOSED` emitted
- [ ] Socket: `payment:processed` fires with method "card"

**Timing:** < 3s (includes simulated reader interaction)

---

### PAY-08: Card payment with tip (tip added post-approval)
**Priority:** P0
**Prereqs:**
- Open order with total = $40.00

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "card",
     "amount": 40.00,
     "tipAmount": 8.00,
     "readerId": "{readerId}"
   }
   ```

**Verify:**
- [ ] `data.payment.amount` = 40.00
- [ ] `data.payment.tipAmount` = 8.00
- [ ] Total charge to card = 48.00
- [ ] DB: Payment.tipAmount = 8.00
- [ ] Tip allocation runs for the serving employee

---

### PAY-09: Card declined handling
**Priority:** P0
**Prereqs:**
- Order with known total
- Simulated Datacap configured to decline (or use test card scenario)

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "card",
     "amount": {orderTotal},
     "readerId": "{readerId}"
   }
   ```
   (With simulated decline scenario)

**Verify:**
- [ ] Response status `400` or `402`
- [ ] `data.error` contains decline reason
- [ ] Order `status` remains `"open"` (NOT paid)
- [ ] No Payment record created (or Payment with status "declined")
- [ ] Table remains occupied
- [ ] Customer can retry with different card or pay cash

---

### PAY-10: Card timeout handling (reader unreachable)
**Priority:** P1
**Prereqs:**
- `readerId` pointing to non-existent or offline reader

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "card",
     "amount": {orderTotal},
     "readerId": "{offlineReaderId}"
   }
   ```

**Verify:**
- [ ] Response within `readerTimeoutSeconds` (default 30s)
- [ ] Error message indicates reader connection failure
- [ ] Order remains open
- [ ] No orphaned transaction on Datacap side
- [ ] Employee can retry or switch to cash

**Timing:** Response within configured timeout + 2s grace

---

### PAY-11: Card entry methods recorded correctly
**Priority:** P2
**Prereqs:**
- Successful card payment

**Steps:**
1. Complete a card payment.
2. `GET /api/orders/{orderId}` or inspect Payment record.

**Verify:**
- [ ] `Payment.entryMethod` recorded (e.g., "emv_contact", "emv_contactless", "swipe")
- [ ] Entry method matches the actual card presentation type
- [ ] Entry method is stored for reporting/reconciliation

---

### PAY-12: Card brand and last4 stored in Payment record
**Priority:** P1
**Prereqs:**
- Successful card payment

**Steps:**
1. Complete card payment.
2. `GET /api/orders/{orderId}/payments` or inspect order.

**Verify:**
- [ ] `Payment.cardBrand` is set (e.g., "Visa", "Mastercard", "Amex", "Discover")
- [ ] `Payment.cardLast4` is a 4-digit string
- [ ] Values match what Datacap returned
- [ ] `cardholderName` stored if provided by reader

---

## Section C: SPLIT PAYMENT (5 tests)

### PAY-13: Half cash, half card on same order
**Priority:** P0
**Prereqs:**
- Open order with total = $50.00

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "cash",
     "amount": 25.00,
     "tipAmount": 0,
     "terminalId": "{terminalId}"
   }
   ```
2. Verify order is still open with remaining balance.
3. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "card",
     "amount": 25.00,
     "tipAmount": 5.00,
     "readerId": "{readerId}"
   }
   ```

**Verify:**
- [ ] After step 1: order `status` = `"open"` (partially paid)
- [ ] After step 1: `paidAmount` = 25.00, `remainingBalance` = 25.00
- [ ] After step 3: order `status` = `"paid"` (fully paid)
- [ ] DB: 2 Payment records on this order (one cash, one card)
- [ ] `data.payment.tipAmount` = 5.00 on card payment only
- [ ] Total paid = 50.00 + 5.00 tip
- [ ] Socket fires after each payment

---

### PAY-14: Three-way split (cash + card + gift card)
**Priority:** P1
**Prereqs:**
- Order total = $60.00
- Gift card with balance >= $20.00

**Steps:**
1. Pay $20.00 cash.
2. Pay $20.00 gift card.
3. Pay $20.00 card.

**Verify:**
- [ ] After payment 1: remaining = $40.00
- [ ] After payment 2: remaining = $20.00
- [ ] After payment 3: order status = `"paid"`
- [ ] DB: 3 Payment records with different methods
- [ ] All payments reference the same orderId

---

### PAY-15: Partial payment leaves order open with remaining balance
**Priority:** P0
**Prereqs:**
- Order total = $100.00

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "cash",
     "amount": 30.00,
     "tipAmount": 0
   }
   ```

**Verify:**
- [ ] Response status `200`
- [ ] Order `status` = `"open"` (NOT paid)
- [ ] `paidAmount` = 30.00
- [ ] Remaining balance = 70.00
- [ ] Table remains occupied
- [ ] Order still appears in open orders list
- [ ] Socket: `payment:processed` fires but `orders:list-changed` does NOT fire with trigger "paid"

---

### PAY-16: Second payment for remaining balance closes order
**Priority:** P0
**Prereqs:**
- Order from PAY-15 with $70.00 remaining

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "card",
     "amount": 70.00,
     "tipAmount": 0,
     "readerId": "{readerId}"
   }
   ```

**Verify:**
- [ ] Order `status` = `"paid"`
- [ ] `paidAt` is set
- [ ] Total paid across all payments = $100.00
- [ ] Table released to available
- [ ] Socket: `orders:list-changed` fires with trigger "paid"
- [ ] Inventory deduction runs (fire-and-forget)

---

### PAY-17: Split payment with tip on card portion only
**Priority:** P1
**Prereqs:**
- Order total = $80.00

**Steps:**
1. Pay $40.00 cash, `tipAmount: 0`.
2. Pay $40.00 card, `tipAmount: 10.00`.

**Verify:**
- [ ] Cash payment: tipAmount = 0
- [ ] Card payment: tipAmount = 10.00
- [ ] Total tip for order = 10.00
- [ ] Tip allocated to correct employee (server/bartender)
- [ ] Card charge = 50.00 (40.00 + 10.00 tip)

---

## Section D: GIFT CARD (4 tests)

### PAY-18: Gift card full payment
**Priority:** P1
**Prereqs:**
- Order total = $25.00
- Gift card with balance >= $25.00

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "gift_card",
     "amount": 25.00,
     "giftCardId": "{giftCardId}"
   }
   ```

**Verify:**
- [ ] Order `status` = `"paid"`
- [ ] Payment.method = `"gift_card"`
- [ ] Gift card balance decremented by $25.00
- [ ] DB: GiftCardTransaction record created

---

### PAY-19: Gift card partial payment (card covers rest)
**Priority:** P1
**Prereqs:**
- Order total = $50.00
- Gift card with balance = $30.00

**Steps:**
1. Pay $30.00 with gift card.
2. Pay remaining $20.00 with card.

**Verify:**
- [ ] After step 1: remaining = $20.00
- [ ] After step 2: order paid
- [ ] Gift card balance = $0.00
- [ ] Two payment records

---

### PAY-20: Gift card with insufficient balance
**Priority:** P1
**Prereqs:**
- Order total = $50.00
- Gift card balance = $15.00

**Steps:**
1. Attempt to pay $50.00 with gift card.

**Verify:**
- [ ] System applies available balance ($15.00) only
- [ ] OR returns error indicating insufficient balance
- [ ] Order remains open with $35.00 remaining
- [ ] Gift card balance = $0.00 (if partial application)

---

### PAY-21: Gift card balance check before payment
**Priority:** P2
**Prereqs:**
- Gift card exists

**Steps:**
1. `GET /api/gift-cards/{giftCardId}/balance` (or equivalent endpoint)

**Verify:**
- [ ] Response includes current balance
- [ ] Balance is accurate (reflects recent transactions)
- [ ] Expired gift cards return appropriate status

---

## Section E: HOUSE ACCOUNT (3 tests)

### PAY-22: House account charge
**Priority:** P1
**Prereqs:**
- Customer with house account enabled and credit limit > order total
- Order total = $45.00

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "house_account",
     "amount": 45.00,
     "customerId": "{customerId}"
   }
   ```

**Verify:**
- [ ] Order `status` = `"paid"`
- [ ] Payment.method = `"house_account"`
- [ ] Customer account balance increased by $45.00
- [ ] Order linked to customer

---

### PAY-23: House account at credit limit (rejected)
**Priority:** P1
**Prereqs:**
- Customer with house account, current balance = $950, credit limit = $1000
- Order total = $75.00 (would exceed limit)

**Steps:**
1. Attempt house account payment for $75.00.

**Verify:**
- [ ] Response status `400` or `402`
- [ ] Error indicates credit limit exceeded
- [ ] Order remains open
- [ ] Customer balance unchanged

---

### PAY-24: House account partial + cash for remainder
**Priority:** P2
**Prereqs:**
- Customer near credit limit

**Steps:**
1. Pay partial amount with house account (up to remaining credit).
2. Pay remainder with cash.

**Verify:**
- [ ] Both payments recorded
- [ ] House account balance at limit
- [ ] Order fully paid

---

## Section F: POST-PAYMENT VERIFICATION (6 tests)

### PAY-25: Order status = paid after full payment
**Priority:** P0
**Prereqs:**
- Complete any successful payment from above

**Steps:**
1. `GET /api/orders/{orderId}`

**Verify:**
- [ ] `status` = `"paid"`
- [ ] `isClosed` = `true`
- [ ] `paidAt` is a valid ISO timestamp
- [ ] `closedBy` = employeeId who processed payment
- [ ] Order does NOT appear in `GET /api/orders/open`
- [ ] Order appears in `GET /api/orders/closed`

---

### PAY-26: Payment record created with correct amounts
**Priority:** P0
**Prereqs:**
- Completed payment

**Steps:**
1. Query payments for the order: `GET /api/orders/{orderId}/payments`

**Verify:**
- [ ] Payment `amount` matches what was charged
- [ ] Payment `tipAmount` matches tip
- [ ] Payment `status` = `"completed"`
- [ ] Payment `employeeId` = processing employee
- [ ] Payment `orderId` = the order
- [ ] Payment `locationId` = order's location
- [ ] Payment `createdAt` within 5s of request time

---

### PAY-27: InventoryItemTransaction created (type=sale)
**Priority:** P0
**Prereqs:**
- Paid order with items that have inventory (recipe) data

**Steps:**
1. After payment, query inventory transactions for the items.

**Verify:**
- [ ] `InventoryItemTransaction` records exist with `type: "sale"`
- [ ] Transaction quantity matches item quantity and recipe
- [ ] Fire-and-forget: transaction creation does not delay payment response
- [ ] For voided items: `type: "waste"` (not "sale")

---

### PAY-28: Table status reset to available
**Priority:** P0
**Prereqs:**
- Order with tableId, now fully paid

**Steps:**
1. `GET /api/tables/{tableId}` (or check via floorplan snapshot)

**Verify:**
- [ ] Table `status` = `"available"`
- [ ] Table is no longer associated with the order in active state
- [ ] Socket: `floorplan:updated` fires showing table as available
- [ ] New orders can be created on this table

---

### PAY-29: Temporary seats cleaned up
**Priority:** P1
**Prereqs:**
- Order that had extra seats added (`extraSeatCount > 0`)

**Steps:**
1. Pay the order fully.
2. Check table seats.

**Verify:**
- [ ] `cleanupTemporarySeats()` called (fire-and-forget)
- [ ] Temporary extra seats removed from table
- [ ] Table returns to base seat configuration

---

### PAY-30: Socket events fire: payment:processed + orders:list-changed
**Priority:** P0
**Prereqs:**
- WebSocket listener connected to location room

**Steps:**
1. Process any payment on an order.
2. Listen for socket events.

**Verify:**
- [ ] `payment:processed` fires with `{ orderId, paymentId, method, amount }`
- [ ] `orders:list-changed` fires with `{ trigger: "paid" }` (when order fully paid)
- [ ] `floorplan:updated` fires (when order has table)
- [ ] Events arrive within 100ms of API response
- [ ] Events arrive on ALL connected terminals in the location

---

## Section G: IDEMPOTENCY & EDGE CASES (5 tests)

### PAY-31: Duplicate payment request (same idempotencyKey)
**Priority:** P0
**Prereqs:**
- Open order

**Steps:**
1. `POST /api/orders/{orderId}/pay` with a unique `idempotencyKey`.
2. Immediately repeat the exact same request with the same `idempotencyKey`.

**Verify:**
- [ ] First request succeeds (200)
- [ ] Second request returns existing payment (200, same paymentId)
- [ ] Only ONE Payment record in DB
- [ ] Customer NOT double-charged
- [ ] Card NOT processed twice

---

### PAY-32: Payment on closed/paid order returns error
**Priority:** P0
**Prereqs:**
- Fully paid order

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "cash",
     "amount": 10.00
   }
   ```

**Verify:**
- [ ] Response status `400` or `409`
- [ ] Error message: order is already paid / closed
- [ ] No new Payment created
- [ ] No charge to any card

---

### PAY-33: Payment amount > order total returns error
**Priority:** P1
**Prereqs:**
- Open order with total = $25.00

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "paymentMethod": "card",
     "amount": 100.00
   }
   ```

**Verify:**
- [ ] Response status `400`
- [ ] Error indicates overpayment not allowed (for card)
- [ ] For cash: overpayment IS allowed (change returned) -- see PAY-02
- [ ] Order unchanged

---

### PAY-34: Payment on order with held items still processes
**Priority:** P2
**Prereqs:**
- Order with some items `kitchenStatus: "held"` (not yet fired)

**Steps:**
1. `POST /api/orders/{orderId}/pay` for full amount.

**Verify:**
- [ ] Payment succeeds (held items don't block payment)
- [ ] Held items included in total
- [ ] After payment, held items are cancelled in kitchen (or remain as-is)

---

### PAY-35: Loyalty points awarded on payment
**Priority:** P2
**Prereqs:**
- Loyalty program enabled for location
- Customer with loyalty account attached to order

**Steps:**
1. Process payment on order with loyalty customer.
2. Check customer loyalty balance.

**Verify:**
- [ ] Points calculated based on payment amount
- [ ] Points added to customer loyalty balance
- [ ] Loyalty transaction record created
- [ ] Points NOT awarded for voided/comped items
