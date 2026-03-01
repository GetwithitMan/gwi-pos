# Suite 13: Auth, Roles & Permissions

**Domain:** PIN Login, Role-Based Access Control, Session Management
**Total Tests:** 20
**P0 Tests:** 12 | **P1 Tests:** 6 | **P2 Tests:** 2
**Last Updated:** 2026-02-28

---

## Section A: PIN LOGIN (5 tests)

### AUT-01: Manager PIN 1234 logs in successfully
**Priority:** P0
**Prereqs:**
- Seed data loaded with Manager employee (PIN: 1234)
- POS running and accessible

**Steps:**
1. `POST /api/auth/login`
   ```json
   {
     "pin": "1234",
     "locationId": "{locationId}"
   }
   ```
2. Capture response with employee data and session token.

**Verify:**
- [ ] Response status `200`
- [ ] Response includes `employee.id` (manager employee ID)
- [ ] Response includes `employee.name` (manager name)
- [ ] Response includes `employee.role` or `employee.roleId` with manager role
- [ ] Session token or cookie set for subsequent requests
- [ ] `employee.permissions` includes manager-level permissions
- [ ] `locationId` matches the request
- [ ] Login timestamp recorded (optional audit log)

**Timing:** < 200ms response time

---

### AUT-02: Server PIN 2345 logs in successfully
**Priority:** P0
**Prereqs:**
- Seed data loaded with Server employee (PIN: 2345)

**Steps:**
1. `POST /api/auth/login`
   ```json
   {
     "pin": "2345",
     "locationId": "{locationId}"
   }
   ```
2. Capture response.

**Verify:**
- [ ] Response status `200`
- [ ] Response includes server employee data
- [ ] Role is "Server" (or equivalent)
- [ ] Permissions reflect server-level access (limited compared to manager)
- [ ] Session established

---

### AUT-03: Bartender PIN 3456 logs in successfully
**Priority:** P0
**Prereqs:**
- Seed data loaded with Bartender employee (PIN: 3456)

**Steps:**
1. `POST /api/auth/login`
   ```json
   {
     "pin": "3456",
     "locationId": "{locationId}"
   }
   ```
2. Capture response.

**Verify:**
- [ ] Response status `200`
- [ ] Response includes bartender employee data
- [ ] Role is "Bartender" (or equivalent)
- [ ] Permissions reflect bartender-level access
- [ ] Session established

---

### AUT-04: Invalid PIN returns 401
**Priority:** P0
**Prereqs:**
- No employee with PIN "9999" exists

**Steps:**
1. `POST /api/auth/login`
   ```json
   {
     "pin": "9999",
     "locationId": "{locationId}"
   }
   ```

**Verify:**
- [ ] Response status `401` (Unauthorized)
- [ ] Error message: "Invalid PIN" or similar (does NOT reveal whether PIN format is wrong vs not found)
- [ ] No session token returned
- [ ] No cookie set
- [ ] Failed login attempt may be logged (audit trail)
- [ ] Rate limiting applied after repeated failures (if configured)

---

### AUT-05: Session persists across page navigation
**Priority:** P0
**Prereqs:**
- Successful login (from AUT-01)
- Session token or cookie active

**Steps:**
1. Login with manager PIN. Capture session.
2. Navigate to `/orders` page.
3. Navigate to `/menu` page.
4. Navigate to `/settings` page.
5. At each page, check session validity:
   ```
   POST /api/auth/session-check
   ```

**Verify:**
- [ ] Session valid after navigating to `/orders`
- [ ] Session valid after navigating to `/menu`
- [ ] Session valid after navigating to `/settings`
- [ ] Employee data available on each page (from session, not re-login)
- [ ] No re-authentication required during normal navigation
- [ ] Session token included in all API requests automatically

---

## Section B: ROLE PERMISSIONS -- MANAGER (5 tests)

### AUT-06: Manager can access all POS features
**Priority:** P0
**Prereqs:**
- Logged in as Manager (PIN 1234)

**Steps:**
1. Access order creation: `POST /api/orders` with items.
2. Access menu management: `GET /api/menu/items`.
3. Access employee list: `GET /api/employees`.
4. Access settings: `GET /api/settings`.
5. Access reports: `GET /api/reports/daily`.

**Verify:**
- [ ] Order creation succeeds (status 200)
- [ ] Menu items accessible (status 200)
- [ ] Employee list accessible (status 200)
- [ ] Settings accessible (status 200)
- [ ] Reports accessible (status 200)
- [ ] No `403 Forbidden` responses for any endpoint
- [ ] Manager has unrestricted access to all POS functionality

---

### AUT-07: Manager can void items without approval
**Priority:** P0
**Prereqs:**
- Logged in as Manager (PIN 1234)
- Open order with at least 1 item

**Steps:**
1. Void an item directly (no approval flow):
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{itemId}"],
     "action": "void",
     "reason": "wrong_item",
     "managerId": "{managerId}"
   }
   ```

**Verify:**
- [ ] Response status `200` (immediate void, no pending approval)
- [ ] Item `status` = `"voided"` immediately
- [ ] No approval request created
- [ ] Manager acts as both requester and authorizer
- [ ] VoidLog entry created with managerId

---

### AUT-08: Manager can apply discounts
**Priority:** P0
**Prereqs:**
- Logged in as Manager
- Open order with items

**Steps:**
1. Apply a discount:
   ```
   POST /api/orders/{orderId}/discount
   {
     "type": "percentage",
     "value": 20,
     "reason": "VIP customer",
     "employeeId": "{managerId}"
   }
   ```

**Verify:**
- [ ] Response status `200`
- [ ] Discount applied immediately
- [ ] No manager approval step needed (already a manager)
- [ ] Order totals recalculated with discount

---

### AUT-09: Manager can access all reports
**Priority:** P0
**Prereqs:**
- Logged in as Manager

**Steps:**
1. `GET /api/reports/daily` (daily store report)
2. `GET /api/reports/shift` (shift report)
3. `GET /api/reports/voids` (void report)
4. `GET /api/reports/discounts` (discount report)
5. `GET /api/reports/pmix` (product mix report)

**Verify:**
- [ ] All report endpoints return `200`
- [ ] Each report contains data (not empty or restricted)
- [ ] Manager can view all employee's data (not filtered to own)
- [ ] Date range filters work on all reports
- [ ] No `403` on any report endpoint

---

### AUT-10: Manager can access settings
**Priority:** P0
**Prereqs:**
- Logged in as Manager

**Steps:**
1. `GET /api/settings` (location settings)
2. `PUT /api/settings` with a minor change:
   ```json
   {
     "locationName": "Test Venue Updated"
   }
   ```
3. Access order type settings: `GET /api/settings/order-types`
4. Access tip-out settings: `GET /api/settings/tip-outs`

**Verify:**
- [ ] Settings readable (GET returns 200)
- [ ] Settings writable (PUT returns 200)
- [ ] Order type settings accessible
- [ ] Tip-out settings accessible
- [ ] Changes persist after read-back

---

## Section C: ROLE PERMISSIONS -- SERVER (5 tests)

### AUT-11: Server can create orders and add items
**Priority:** P0
**Prereqs:**
- Logged in as Server (PIN 2345)
- Available table

**Steps:**
1. Create order:
   ```
   POST /api/orders
   {
     "employeeId": "{serverId}",
     "locationId": "{locationId}",
     "tableId": "{tableId}",
     "orderType": "dine_in",
     "items": [{
       "menuItemId": "{menuItemId}",
       "name": "Burger",
       "price": 12.99,
       "quantity": 1,
       "modifiers": []
     }]
   }
   ```
2. Add additional items:
   ```
   POST /api/orders/{orderId}/items
   { "items": [{ "menuItemId": "{id2}", "name": "Fries", "price": 4.99, "quantity": 1, "modifiers": [] }] }
   ```

**Verify:**
- [ ] Order creation succeeds (status 200)
- [ ] Item addition succeeds (status 200)
- [ ] Order assigned to server's employee ID
- [ ] Server can view the order: `GET /api/orders/{orderId}` returns 200
- [ ] Server can send to kitchen: `POST /api/orders/{orderId}/send` returns 200

---

### AUT-12: Server can process payments
**Priority:** P0
**Prereqs:**
- Logged in as Server
- Open order with items, sent to kitchen

**Steps:**
1. Process cash payment:
   ```
   POST /api/orders/{orderId}/pay
   {
     "amount": {total},
     "paymentMethod": "cash",
     "employeeId": "{serverId}"
   }
   ```

**Verify:**
- [ ] Payment succeeds (status 200)
- [ ] Order marked as paid
- [ ] Server's employee ID recorded on payment
- [ ] Server can handle both cash and card payments

---

### AUT-13: Server CANNOT void without manager approval (if configured)
**Priority:** P0
**Prereqs:**
- Logged in as Server (PIN 2345)
- Location setting: `requireManagerApprovalForVoids: true` (or role does not include void permission)
- Open order with active item

**Steps:**
1. Attempt void without manager authorization:
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{itemId}"],
     "action": "void",
     "reason": "wrong_item",
     "employeeId": "{serverId}"
   }
   ```
2. Check response.

**Verify:**
- [ ] Response status `403` (Forbidden) OR `202` (pending approval)
- [ ] Item NOT immediately voided
- [ ] If approval workflow: approval request created, manager notified via socket
- [ ] If flat rejection: error message indicates manager authorization required
- [ ] Server cannot bypass void restriction
- [ ] After manager approval (separate request), void completes

---

### AUT-14: Server CANNOT access reports (if restricted by role)
**Priority:** P1
**Prereqs:**
- Logged in as Server
- Server role does NOT include `view_reports` permission

**Steps:**
1. `GET /api/reports/daily`
2. `GET /api/reports/shift`
3. `GET /api/reports/voids`

**Verify:**
- [ ] All report endpoints return `403` (Forbidden)
- [ ] Error message indicates insufficient permissions
- [ ] No report data leaked in error response
- [ ] Server can still access own shift summary (if separate endpoint exists)

---

### AUT-15: Server can only see own orders (if view_others_orders restricted)
**Priority:** P1
**Prereqs:**
- Logged in as Server
- Server role has `view_others_orders: false`
- Orders exist from other employees

**Steps:**
1. `GET /api/orders/open` as the server.
2. Check if orders from other employees are visible.

**Verify:**
- [ ] Only orders created by this server (or assigned to this server) are returned
- [ ] Orders from manager or other servers are NOT in the list
- [ ] OR: all open orders visible but restricted actions on others' orders
- [ ] Server can always see orders on tables in their assigned section (if section-based)

---

## Section D: ROLE PERMISSIONS -- BARTENDER (3 tests)

### AUT-16: Bartender can create bar tabs
**Priority:** P0
**Prereqs:**
- Logged in as Bartender (PIN 3456)

**Steps:**
1. Create a bar tab order:
   ```
   POST /api/orders
   {
     "employeeId": "{bartenderId}",
     "locationId": "{locationId}",
     "orderType": "bar_tab",
     "items": [{
       "menuItemId": "{beerItemId}",
       "name": "Draft Beer",
       "price": 6.00,
       "quantity": 1,
       "modifiers": []
     }]
   }
   ```
2. Open a tab on the order:
   ```
   POST /api/orders/{orderId}/open-tab
   {
     "tabNickname": "John B.",
     "employeeId": "{bartenderId}"
   }
   ```

**Verify:**
- [ ] Order creation succeeds (status 200)
- [ ] Tab opened successfully
- [ ] `tabStatus` = `"open"`
- [ ] `tabNickname` stored
- [ ] Bartender can add more items to the tab later

---

### AUT-17: Bartender can process card payments
**Priority:** P0
**Prereqs:**
- Logged in as Bartender
- Open order with items

**Steps:**
1. Process card payment:
   ```
   POST /api/orders/{orderId}/pay
   {
     "amount": {total},
     "paymentMethod": "card",
     "employeeId": "{bartenderId}"
   }
   ```

**Verify:**
- [ ] Payment API call succeeds (status 200)
- [ ] Datacap transaction initiated (or simulated in dev)
- [ ] Order marked as paid
- [ ] Bartender ID recorded on payment

---

### AUT-18: Bartender CANNOT access admin settings
**Priority:** P1
**Prereqs:**
- Logged in as Bartender
- Bartender role does NOT include `access_settings` permission

**Steps:**
1. Attempt to access settings:
   ```
   GET /api/settings
   ```
2. Attempt to modify settings:
   ```
   PUT /api/settings
   { "locationName": "Hacked Venue" }
   ```
3. Attempt to access employee management:
   ```
   GET /api/employees
   ```

**Verify:**
- [ ] `GET /api/settings` returns `403` OR returns read-only subset
- [ ] `PUT /api/settings` returns `403` (cannot modify)
- [ ] Employee management returns `403` (or limited to self)
- [ ] Bartender cannot change menu items, tax rules, or system configuration
- [ ] Bartender CAN access features needed for bar operations (orders, tabs, payments)

---

## Section E: SESSION & SECURITY (2 tests)

### AUT-19: Session check validates active session
**Priority:** P0
**Prereqs:**
- Active session from a recent login

**Steps:**
1. Login as manager:
   ```
   POST /api/auth/login
   { "pin": "1234", "locationId": "{locationId}" }
   ```
2. Immediately check session:
   ```
   POST /api/auth/session-check
   ```
   (Include session token/cookie from login)
3. Wait (session should still be valid within timeout).
4. Check session again.

**Verify:**
- [ ] Session check returns `200` with valid session info
- [ ] Response includes `employee.id` and `employee.role`
- [ ] Response includes `locationId`
- [ ] Session is valid for the configured timeout period
- [ ] Expired session returns `401` on session-check
- [ ] Invalid/tampered token returns `401`

---

### AUT-20: Logout clears session
**Priority:** P0
**Prereqs:**
- Active session from login

**Steps:**
1. Login as manager.
2. Verify session active: `POST /api/auth/session-check` returns 200.
3. Logout:
   ```
   POST /api/auth/logout
   ```
4. Attempt session check:
   ```
   POST /api/auth/session-check
   ```
5. Attempt to access protected endpoint:
   ```
   GET /api/orders/open
   ```

**Verify:**
- [ ] Logout returns `200`
- [ ] Session check after logout returns `401`
- [ ] Protected endpoints return `401` after logout
- [ ] Session token/cookie invalidated
- [ ] No residual session data accessible
- [ ] Login with same PIN creates a new session (not reuses old)
