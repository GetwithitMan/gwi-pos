# Suite 14: Customers, Loyalty & Online

**Domain:** Customer Management, Loyalty Program, Gift Cards, Online Orders
**Total Tests:** 15
**P0 Tests:** 0 | **P1 Tests:** 11 | **P2 Tests:** 4
**Last Updated:** 2026-02-28

---

## Section A: CUSTOMER MANAGEMENT (4 tests)

### CUS-01: Create customer with name, phone, and email
**Priority:** P1
**Prereqs:**
- Authenticated employee (manager or server)
- Known locationId

**Steps:**
1. `POST /api/customers`
   ```json
   {
     "firstName": "Jane",
     "lastName": "Doe",
     "phone": "+15551234567",
     "email": "jane.doe@example.com",
     "locationId": "{locationId}"
   }
   ```
2. `GET /api/customers/{customerId}` to verify.

**Verify:**
- [ ] Response status `200` (or `201`)
- [ ] Customer created with `firstName: "Jane"`, `lastName: "Doe"`
- [ ] `phone` stored and formatted correctly
- [ ] `email` stored correctly
- [ ] `locationId` matches
- [ ] `deletedAt` = null
- [ ] `createdAt` timestamp set
- [ ] Customer appears in customer list: `GET /api/customers`

---

### CUS-02: Link customer to order
**Priority:** P1
**Prereqs:**
- Existing customer (from CUS-01)
- Open order

**Steps:**
1. Link customer to order:
   ```
   PUT /api/orders/{orderId}/customer
   {
     "customerId": "{customerId}"
   }
   ```
   OR include `customerId` in order creation.
2. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Response status `200`
- [ ] `data.customerId` = the linked customer ID
- [ ] Customer info accessible from order (name displayed on order)
- [ ] Customer's order history updated (this order appears in their history)
- [ ] Unlinking: setting `customerId: null` removes the association
- [ ] Order totals unaffected by customer linkage

---

### CUS-03: Customer lifetime spend tracked
**Priority:** P2
**Prereqs:**
- Customer linked to multiple paid orders (at least 2)
- Orders have been paid

**Steps:**
1. Create and pay 2 orders linked to the same customer:
   - Order A: $25.00
   - Order B: $40.00
2. Fetch customer profile:
   ```
   GET /api/customers/{customerId}
   ```
3. Check lifetime spend.

**Verify:**
- [ ] `lifetimeSpend` = $65.00 (or calculated from order history)
- [ ] `orderCount` = 2 (or visit count)
- [ ] Spend only includes paid orders (not cancelled/voided)
- [ ] Spend calculated across all orders linked to this customer
- [ ] Refunded amounts deducted from lifetime spend (if applicable)

---

### CUS-04: Customer search by name, phone, and email
**Priority:** P1
**Prereqs:**
- Multiple customers in the system (at least 3)
- Customer "Jane Doe" from CUS-01

**Steps:**
1. Search by name:
   ```
   GET /api/customers?search=Jane
   ```
2. Search by phone:
   ```
   GET /api/customers?search=5551234567
   ```
3. Search by email:
   ```
   GET /api/customers?search=jane.doe
   ```

**Verify:**
- [ ] Name search: returns customer "Jane Doe"
- [ ] Phone search: returns customer with matching phone
- [ ] Email search: returns customer with matching email
- [ ] Search is case-insensitive
- [ ] Partial matches work (searching "Jan" finds "Jane")
- [ ] Results include customer ID, name, phone, email
- [ ] Results filtered by `locationId` and `deletedAt: null`

---

## Section B: LOYALTY PROGRAM (4 tests)

### CUS-05: Loyalty points awarded on payment
**Priority:** P1
**Prereqs:**
- Loyalty program enabled for this location
- Loyalty configuration: 1 point per $1 spent (or similar rule)
- Customer linked to the order

**Steps:**
1. Create order linked to customer with items totaling $50.00.
2. Pay the order:
   ```
   POST /api/orders/{orderId}/pay
   {
     "amount": 50.00,
     "paymentMethod": "card",
     "employeeId": "{employeeId}"
   }
   ```
3. Check customer loyalty points:
   ```
   GET /api/customers/{customerId}/loyalty
   ```

**Verify:**
- [ ] Loyalty points awarded after payment
- [ ] Points amount matches rule (50 points for $50 at 1pt/$1)
- [ ] Points transaction recorded with order reference
- [ ] Customer `loyaltyBalance` updated
- [ ] Points awarded only on paid orders (not on void/cancel)
- [ ] Points awarded based on pre-tax subtotal (or post-tax, per configuration)

---

### CUS-06: Loyalty points redeemable for discount
**Priority:** P1
**Prereqs:**
- Customer with loyalty points balance >= redemption threshold
- Redemption rule: 100 points = $10 discount (or similar)

**Steps:**
1. Verify customer has sufficient points (e.g., 150 points).
2. Redeem points on a new order:
   ```
   POST /api/orders/{orderId}/loyalty-redeem
   {
     "customerId": "{customerId}",
     "pointsToRedeem": 100,
     "employeeId": "{employeeId}"
   }
   ```
3. Check order and customer loyalty balance.

**Verify:**
- [ ] Response status `200`
- [ ] Discount of $10.00 applied to order (100 points redeemed)
- [ ] Customer `loyaltyBalance` reduced by 100 points (150 - 100 = 50 remaining)
- [ ] Redemption transaction recorded
- [ ] Order total reduced by discount amount
- [ ] Cannot redeem more points than available balance (returns error)
- [ ] Points deducted even if order is later voided (or reversed, per policy)

---

### CUS-07: Points balance tracks correctly across multiple orders
**Priority:** P1
**Prereqs:**
- Customer with known starting point balance (e.g., 50 points)

**Steps:**
1. Pay order A ($30) linked to customer. (Earns 30 points.)
2. Pay order B ($20) linked to customer. (Earns 20 points.)
3. Redeem 40 points on order C.
4. Check final balance.

**Verify:**
- [ ] After order A: balance = 50 + 30 = 80 points
- [ ] After order B: balance = 80 + 20 = 100 points
- [ ] After redemption: balance = 100 - 40 = 60 points
- [ ] Transaction history shows all 3 entries (2 earned, 1 redeemed)
- [ ] No rounding errors in point calculations
- [ ] Balance never goes negative

---

### CUS-08: Loyalty report matches point transactions
**Priority:** P2
**Prereqs:**
- Multiple loyalty transactions from CUS-05 through CUS-07

**Steps:**
1. Fetch loyalty report:
   ```
   GET /api/reports/loyalty?startDate={today}&endDate={today}
   ```
2. Cross-reference with customer loyalty transaction log.

**Verify:**
- [ ] Report total points awarded matches sum of earned transactions
- [ ] Report total points redeemed matches sum of redemption transactions
- [ ] Net points = awarded - redeemed
- [ ] Report can filter by date range
- [ ] Report includes customer name for each transaction
- [ ] Report totals are consistent with individual customer balances

---

## Section C: GIFT CARDS (4 tests)

### CUS-09: Issue gift card
**Priority:** P1
**Prereqs:**
- Authenticated employee
- Gift card feature enabled

**Steps:**
1. Issue a new gift card:
   ```
   POST /api/gift-cards
   {
     "amount": 50.00,
     "locationId": "{locationId}",
     "issuedBy": "{employeeId}"
   }
   ```
2. Capture gift card number/code from response.
3. `GET /api/gift-cards/{giftCardId}` to verify.

**Verify:**
- [ ] Response status `200` (or `201`)
- [ ] Gift card created with unique code/number
- [ ] `balance` = $50.00
- [ ] `originalAmount` = $50.00
- [ ] `isActive` = true
- [ ] `issuedBy` = employee ID
- [ ] `locationId` matches
- [ ] `createdAt` timestamp set

---

### CUS-10: Check gift card balance
**Priority:** P1
**Prereqs:**
- Existing gift card (from CUS-09) with known code

**Steps:**
1. Check balance by code:
   ```
   GET /api/gift-cards/balance?code={giftCardCode}
   ```
2. Verify response.

**Verify:**
- [ ] Response status `200`
- [ ] `balance` = $50.00 (or current balance)
- [ ] `originalAmount` = $50.00
- [ ] `isActive` = true
- [ ] Invalid code returns `404` or `400`
- [ ] Expired/deactivated card shows `isActive: false`

---

### CUS-11: Redeem gift card as payment method
**Priority:** P1
**Prereqs:**
- Gift card with balance >= order total (from CUS-09)
- Open order with items totaling $30.00
- Cross-reference: see PAY-18 in Suite 02 for payment-side validation

**Steps:**
1. Pay with gift card:
   ```
   POST /api/orders/{orderId}/pay
   {
     "amount": 30.00,
     "paymentMethod": "gift_card",
     "giftCardCode": "{giftCardCode}",
     "employeeId": "{employeeId}"
   }
   ```
2. Check order status and gift card balance.

**Verify:**
- [ ] Response status `200`
- [ ] Order `status` = `"paid"`
- [ ] Payment record created with `method: "gift_card"`
- [ ] Gift card `balance` reduced to $20.00 ($50.00 - $30.00)
- [ ] Gift card transaction logged (amount, orderId, timestamp)
- [ ] If order total > gift card balance: partial payment, remaining balance due
- [ ] Gift card with $0 balance cannot be used for payment

---

### CUS-12: Gift card balance decremented after use
**Priority:** P1
**Prereqs:**
- Gift card used for payment (from CUS-11) with known remaining balance

**Steps:**
1. Check balance after first redemption:
   ```
   GET /api/gift-cards/balance?code={giftCardCode}
   ```
   Expected: $20.00.
2. Use gift card for another $15.00 order.
3. Check balance again.

**Verify:**
- [ ] Balance after first use = $20.00
- [ ] Balance after second use = $5.00 ($20.00 - $15.00)
- [ ] Transaction history shows both redemptions
- [ ] Cannot redeem more than remaining balance in a single transaction
- [ ] Multiple partial redemptions tracked correctly
- [ ] Balance never goes negative

---

## Section D: ONLINE ORDERS (3 tests)

### CUS-13: Online order created in cloud, dispatched to NUC
**Priority:** P1
**Prereqs:**
- Online ordering enabled for this location
- NUC server running and connected to cloud (sync agent active)
- Cloud endpoint accessible for online order submission

**Steps:**
1. Submit online order via cloud API:
   ```
   POST /api/internal/dispatch-online-order
   {
     "locationId": "{locationId}",
     "orderType": "takeout",
     "customerName": "Web Customer",
     "customerPhone": "+15559876543",
     "items": [
       {
         "menuItemId": "{menuItemId}",
         "name": "Burger",
         "price": 12.99,
         "quantity": 1,
         "modifiers": []
       },
       {
         "menuItemId": "{drinkItemId}",
         "name": "Coke",
         "price": 2.99,
         "quantity": 1,
         "modifiers": []
       }
     ],
     "paymentStatus": "paid_online",
     "source": "online"
   }
   ```
2. Wait for NUC to receive the order (sync interval or push).
3. Check order exists on NUC:
   ```
   GET /api/orders/open?source=online
   ```

**Verify:**
- [ ] Online order created in cloud DB
- [ ] Order dispatched to NUC (via sync or direct push)
- [ ] Order appears in NUC's open orders list
- [ ] `source` = `"online"`
- [ ] Customer info (name, phone) attached to order
- [ ] Items match the submitted order
- [ ] Order totals calculated correctly (with tax)
- [ ] `paymentStatus` reflects online payment (if pre-paid)

**Timing:** Order visible on NUC within 30 seconds of submission (sync interval dependent)

---

### CUS-14: Online order appears in POS open orders list
**Priority:** P1
**Prereqs:**
- Online order dispatched to NUC (from CUS-13)

**Steps:**
1. On POS terminal, fetch open orders:
   ```
   GET /api/orders/open
   ```
2. Look for the online order.
3. Open the online order for viewing.

**Verify:**
- [ ] Online order visible in open orders list
- [ ] Order distinguishable as "online" order (badge, icon, or source label)
- [ ] Order details viewable (items, customer info, totals)
- [ ] POS employee can interact with the order (send to kitchen, mark ready)
- [ ] Online order does not require table assignment
- [ ] Socket: `orders:list-changed` fired when online order arrived on NUC

---

### CUS-15: Online order kitchen routing works same as POS orders
**Priority:** P2
**Prereqs:**
- Online order on NUC (from CUS-13/14)
- KDS screens configured with routing

**Steps:**
1. Send online order to kitchen:
   ```
   POST /api/orders/{onlineOrderId}/send
   ```
2. Check KDS for routed items.
3. Check kitchen printer for tickets.

**Verify:**
- [ ] Online order routes to correct KDS stations (same as POS orders)
- [ ] Food items go to kitchen station, drink items to bar station
- [ ] Kitchen ticket printed with online order indicator (source label)
- [ ] Ticket includes customer name and pickup/delivery info
- [ ] KDS displays online order with correct priority
- [ ] Item status updates work the same as POS orders (pending -> cooking -> ready)
- [ ] Socket events fire normally for KDS updates
