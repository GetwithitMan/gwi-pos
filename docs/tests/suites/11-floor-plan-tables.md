# Suite 11: Floor Plan & Tables

**Domain:** Floor Plan, Tables, Sections, Seats
**Total Tests:** 16
**P0 Tests:** 4 | **P1 Tests:** 10 | **P2 Tests:** 2
**Last Updated:** 2026-02-28

---

## Section A: TABLE STATUS (5 tests)

### FLR-01: Table status=available when no active order
**Priority:** P0
**Prereqs:**
- Known table with no active order assigned to it
- Table exists in DB with `deletedAt: null`

**Steps:**
1. Verify no open order on this table:
   ```
   GET /api/orders/open?tableId={tableId}
   ```
   Confirm empty or no matching orders.
2. Fetch table status:
   ```
   GET /api/tables/{tableId}
   ```
3. Fetch floorplan snapshot to cross-check:
   ```
   GET /api/floorplan/snapshot
   ```

**Verify:**
- [ ] Table `status` = `"available"` (or equivalent)
- [ ] No `activeOrderId` associated with the table
- [ ] Floorplan snapshot shows this table as available
- [ ] Table color/indicator on floor plan reflects available state
- [ ] Table is selectable for new order creation

---

### FLR-02: Table status=occupied after order created on it
**Priority:** P0
**Prereqs:**
- Available table (from FLR-01)
- Authenticated employee

**Steps:**
1. Create an order on the table:
   ```
   POST /api/orders
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "tableId": "{tableId}",
     "orderType": "dine_in",
     "items": []
   }
   ```
2. Fetch table status:
   ```
   GET /api/tables/{tableId}
   ```
3. Fetch floorplan snapshot:
   ```
   GET /api/floorplan/snapshot
   ```

**Verify:**
- [ ] Table `status` = `"occupied"` (or `"seated"`)
- [ ] Table has an `activeOrderId` or order is linked via `tableId`
- [ ] Floorplan snapshot shows this table as occupied
- [ ] Table color/indicator on floor plan reflects occupied state
- [ ] Tapping table on floor plan opens the existing order (not creates a new one)
- [ ] Socket: `floorplan:updated` fired after order creation
- [ ] Socket: `table:status-changed` fired with new status

---

### FLR-03: Table status=available after order paid
**Priority:** P0
**Prereqs:**
- Occupied table with an open order (from FLR-02)
- Order has at least 1 item and is ready to pay

**Steps:**
1. Add an item and pay the order:
   ```
   POST /api/orders/{orderId}/items
   { "items": [{ "menuItemId": "{id}", "name": "Beer", "price": 6.00, "quantity": 1, "modifiers": [] }] }
   ```
   ```
   POST /api/orders/{orderId}/pay
   { "amount": {total}, "paymentMethod": "cash", "employeeId": "{id}" }
   ```
2. Fetch table status:
   ```
   GET /api/tables/{tableId}
   ```
3. Fetch floorplan snapshot.

**Verify:**
- [ ] Table `status` = `"available"` (released after payment)
- [ ] No active order linked to this table
- [ ] Floorplan snapshot shows table as available
- [ ] Table is selectable for a new order
- [ ] Socket: `floorplan:updated` fired after payment
- [ ] Socket: `table:status-changed` fired with `"available"`
- [ ] Paid order no longer appears in open orders list

---

### FLR-04: Floorplan snapshot includes correct open order counts
**Priority:** P0
**Prereqs:**
- Floor plan with at least 5 tables
- 3 tables have active orders, 2 are available

**Steps:**
1. Create orders on 3 different tables (if not already created).
2. Fetch floorplan snapshot:
   ```
   GET /api/floorplan/snapshot
   ```
3. Count tables with active orders in response.

**Verify:**
- [ ] Snapshot returns all tables (occupied and available)
- [ ] Exactly 3 tables show as occupied with order data
- [ ] Exactly 2 tables show as available (no order data)
- [ ] Each occupied table includes: `orderNumber`, `orderTotal`, `itemCount`, `openedAt`
- [ ] Available tables have null/empty order info
- [ ] Table positions (x, y) included for floor plan rendering
- [ ] Table shapes and sizes included
- [ ] Section assignments included
- [ ] Response is a single API call (replaces multiple fetches)

**Timing:** < 150ms response time

---

### FLR-05: Socket table:status-changed fires on status transitions
**Priority:** P1
**Prereqs:**
- Socket connected to location room
- Available table

**Steps:**
1. Listen for `table:status-changed` events:
   ```javascript
   const events = []
   socket.on('table:status-changed', (data) => { events.push(data) })
   ```
2. Create order on table (available -> occupied).
3. Pay the order (occupied -> available).
4. Check captured events.

**Verify:**
- [ ] 2 events captured (one for each transition)
- [ ] First event: `tableId` + `status: "occupied"`
- [ ] Second event: `tableId` + `status: "available"`
- [ ] Events include `tableId` for targeted UI updates
- [ ] No spurious events for tables that did not change

---

## Section B: TABLE CRUD (4 tests)

### FLR-06: Create table with position, shape, and capacity
**Priority:** P1
**Prereqs:**
- Existing section to assign the table to
- Manager with floor plan editing permissions

**Steps:**
1. `POST /api/tables`
   ```json
   {
     "name": "T25",
     "sectionId": "{sectionId}",
     "locationId": "{locationId}",
     "x": 250,
     "y": 300,
     "width": 80,
     "height": 80,
     "shape": "round",
     "capacity": 4,
     "sortOrder": 25
   }
   ```
2. `GET /api/tables/{newTableId}` to verify.

**Verify:**
- [ ] Response status `200` (or `201`)
- [ ] Table created with correct `name`, `sectionId`, `x`, `y`, `width`, `height`
- [ ] `shape` = `"round"`
- [ ] `capacity` = 4
- [ ] `sortOrder` = 25
- [ ] `locationId` matches
- [ ] `deletedAt` = null
- [ ] Table appears in floorplan snapshot
- [ ] Socket: `floorplan:updated` fires

---

### FLR-07: Update table position and size
**Priority:** P1
**Prereqs:**
- Existing table (from FLR-06 or seed data)

**Steps:**
1. `PUT /api/tables/{tableId}`
   ```json
   {
     "x": 400,
     "y": 500,
     "width": 120,
     "height": 60,
     "shape": "rectangle",
     "name": "T25-Updated"
   }
   ```
2. `GET /api/tables/{tableId}` to verify.

**Verify:**
- [ ] Table `x` = 400, `y` = 500
- [ ] Table `width` = 120, `height` = 60
- [ ] `shape` = `"rectangle"`
- [ ] `name` = `"T25-Updated"`
- [ ] `updatedAt` timestamp updated
- [ ] Socket: `floorplan:updated` fires
- [ ] Other fields unchanged (capacity, sectionId, etc.)

---

### FLR-08: Delete table (soft delete with deletedAt)
**Priority:** P1
**Prereqs:**
- Existing table with NO active order on it
- Manager with floor plan editing permissions

**Steps:**
1. `DELETE /api/tables/{tableId}`
2. `GET /api/tables/{tableId}` to check.
3. `GET /api/floorplan/snapshot` to verify removal from floor plan.

**Verify:**
- [ ] Response status `200`
- [ ] Table `deletedAt` set to current timestamp (soft deleted)
- [ ] Table no longer appears in floorplan snapshot
- [ ] Table no longer appears in `GET /api/tables` list
- [ ] Table record still exists in DB (not hard deleted)
- [ ] Socket: `floorplan:updated` fires
- [ ] Attempting to create an order on a deleted table returns error

---

### FLR-09: Tables are standalone (no combine functionality)
**Priority:** P1
**Prereqs:**
- Multiple tables in the system

**Steps:**
1. Inspect any table in the database:
   ```
   GET /api/tables/{tableId}
   ```
2. Attempt to access deprecated combine endpoints:
   ```
   POST /api/tables/combine
   { "tableIds": ["{t1}", "{t2}"] }
   ```
3. Attempt to access deprecated virtual group endpoint:
   ```
   POST /api/tables/virtual-group
   { "tableIds": ["{t1}", "{t2}"] }
   ```

**Verify:**
- [ ] No table has `combinedWithId` set (always null)
- [ ] No table has `combinedTableIds` populated (always null/empty)
- [ ] `POST /api/tables/combine` returns `410 Gone`
- [ ] `POST /api/tables/virtual-group` returns `410 Gone`
- [ ] Each table operates independently
- [ ] Floor plan renders each table as a standalone entity

---

## Section C: SECTIONS (3 tests)

### FLR-10: Create section
**Priority:** P1
**Prereqs:**
- Manager with floor plan editing permissions
- Known locationId

**Steps:**
1. `POST /api/sections`
   ```json
   {
     "name": "Patio",
     "locationId": "{locationId}",
     "sortOrder": 3,
     "color": "#4CAF50"
   }
   ```
2. `GET /api/sections/{sectionId}` to verify.

**Verify:**
- [ ] Response status `200` (or `201`)
- [ ] Section created with `name: "Patio"`
- [ ] `sortOrder` = 3
- [ ] `locationId` matches
- [ ] `deletedAt` = null
- [ ] Section appears in floorplan data
- [ ] Socket: `floorplan:updated` fires

---

### FLR-11: Tables belong to sections
**Priority:** P1
**Prereqs:**
- Section created (from FLR-10)
- Table assigned to section (from FLR-06 or via update)

**Steps:**
1. Fetch tables for the section:
   ```
   GET /api/tables?sectionId={sectionId}
   ```
2. Fetch floorplan snapshot and filter by section.

**Verify:**
- [ ] Tables with `sectionId` matching the section are returned
- [ ] Each table's `sectionId` correctly references the parent section
- [ ] Floorplan snapshot groups tables by section
- [ ] Moving a table to a different section updates `sectionId`
- [ ] Deleting a section does NOT delete its tables (orphan protection or cascade behavior documented)

---

### FLR-12: Section sort order respected in UI
**Priority:** P2
**Prereqs:**
- 3 sections with different `sortOrder` values (e.g., 1, 2, 3)

**Steps:**
1. Fetch all sections:
   ```
   GET /api/sections?locationId={locationId}
   ```
2. Verify ordering.

**Verify:**
- [ ] Sections returned in `sortOrder` ascending order
- [ ] Section with `sortOrder: 1` appears first
- [ ] Section with `sortOrder: 3` appears last
- [ ] UI section tabs/filters follow the same order
- [ ] Reordering sections (updating `sortOrder`) changes display order

---

## Section D: SEATS (4 tests)

### FLR-13: Table has physical seats with positions
**Priority:** P1
**Prereqs:**
- Table with seats configured (Seat records in DB)
- Table capacity = 4

**Steps:**
1. Fetch table with seats:
   ```
   GET /api/tables/{tableId}?include=seats
   ```
2. Inspect seat data.

**Verify:**
- [ ] Table has `seats` array with physical Seat records
- [ ] Each seat has `id`, `position` (or `x`/`y` coordinates), `seatNumber`
- [ ] Seat count matches table `capacity` (or `seats.length`)
- [ ] Seats are positioned around the table (orbital auto-spacing or manual positions)
- [ ] Each seat has a unique `seatNumber` within the table
- [ ] Seats have `deletedAt: null`

---

### FLR-14: Order baseSeatCount matches table seat count
**Priority:** P1
**Prereqs:**
- Table with 4 physical seats
- No active order on the table

**Steps:**
1. Create order on the table with default guest count:
   ```
   POST /api/orders
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "tableId": "{tableId}",
     "orderType": "dine_in",
     "items": []
   }
   ```
2. `GET /api/orders/{orderId}` to check seat count.

**Verify:**
- [ ] `baseSeatCount` = 1 (default guest count, not table capacity)
- [ ] OR `baseSeatCount` matches `guestCount` if provided in request
- [ ] `extraSeatCount` = 0 (no extra seats yet)
- [ ] Total available seats for ordering = `baseSeatCount + extraSeatCount`
- [ ] Order seat count is independent from table physical seat count

---

### FLR-15: Extra seats added via order interaction
**Priority:** P1
**Prereqs:**
- Order with `baseSeatCount: 2` on a table with 2 physical seats

**Steps:**
1. Add an item to seat 3 (beyond baseSeatCount):
   ```
   POST /api/orders/{orderId}/items
   {
     "items": [{
       "menuItemId": "{itemId}",
       "name": "Dessert",
       "price": 8.99,
       "quantity": 1,
       "seatNumber": 3,
       "modifiers": []
     }]
   }
   ```
2. `GET /api/orders/{orderId}` to verify seat counts.

**Verify:**
- [ ] `extraSeatCount` incremented to accommodate seat 3
- [ ] `baseSeatCount` unchanged (still 2)
- [ ] Total seats = `baseSeatCount + extraSeatCount` >= 3
- [ ] Item correctly assigned to `seatNumber: 3`
- [ ] Seat 3 available for additional items
- [ ] No error for adding items to seats beyond base count (grows dynamically)

---

### FLR-16: Temporary seats cleaned up after payment
**Priority:** P1
**Prereqs:**
- Order with extra seats (from FLR-15)
- Order ready to pay

**Steps:**
1. Verify order has `extraSeatCount` > 0 before payment.
2. Pay the order:
   ```
   POST /api/orders/{orderId}/pay
   { "amount": {total}, "paymentMethod": "cash", "employeeId": "{id}" }
   ```
3. Check order and table state after payment.

**Verify:**
- [ ] Order marked as paid
- [ ] Table released to available
- [ ] Extra seats from the order are not persisted as physical Seat records
- [ ] Physical seat count on the table unchanged (still original capacity)
- [ ] New order on same table starts fresh with default seat count
- [ ] `extraSeatCount` on the paid order preserved for historical reference
- [ ] No orphaned seat records in DB
