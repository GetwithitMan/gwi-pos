# Suite 04: Splits & Transfers

**Domain:** Split Tickets, Item Transfers, Order Merges
**Total Tests:** 20
**P0 Tests:** 6 | **P1 Tests:** 11 | **P2 Tests:** 3
**Last Updated:** 2026-02-28

---

## Section A: EVEN SPLIT (5 tests)

### SPL-01: Split order into 2 even checks
**Priority:** P0
**Prereqs:**
- Open order with 4 items:
  - Item A: $10.00
  - Item B: $15.00
  - Item C: $10.00
  - Item D: $15.00
- Total before tax: $50.00

**Steps:**
1. `POST /api/orders/{orderId}/split-tickets`
   ```json
   {
     "assignments": [
       { "ticketIndex": 1, "itemIds": ["{itemAId}", "{itemBId}"] },
       { "ticketIndex": 2, "itemIds": ["{itemCId}", "{itemDId}"] }
     ]
   }
   ```
2. `GET /api/orders/{orderId}/split-tickets` to verify split structure.
3. `GET /api/orders/{orderId}` to verify parent state.

**Verify:**
- [ ] Response status `200`
- [ ] 2 child orders (split tickets) created
- [ ] Each child has `parentOrderId` = original order ID
- [ ] Child 1 items: A + B, subtotal = $25.00
- [ ] Child 2 items: C + D, subtotal = $25.00
- [ ] Parent order `status` = `"split"`
- [ ] Each child has its own `splitIndex` (1 and 2)
- [ ] Each child has its own `orderNumber` displayed as "N-1" and "N-2" (parent number + dash + split index)
- [ ] Tax calculated independently on each child
- [ ] Socket: `orders:list-changed` fires
- [ ] Socket: `floorplan:updated` fires
- [ ] OrderEvent: events emitted for split operation

---

### SPL-02: Split into 3 checks
**Priority:** P1
**Prereqs:**
- Order with 6 items

**Steps:**
1. `POST /api/orders/{orderId}/split-tickets`
   ```json
   {
     "assignments": [
       { "ticketIndex": 1, "itemIds": ["{item1}", "{item2}"] },
       { "ticketIndex": 2, "itemIds": ["{item3}", "{item4}"] },
       { "ticketIndex": 3, "itemIds": ["{item5}", "{item6}"] }
     ]
   }
   ```

**Verify:**
- [ ] 3 child orders created
- [ ] Each child has correct items
- [ ] `splitIndex` values are 1, 2, 3
- [ ] Displayed as "N-1", "N-2", "N-3"
- [ ] Total of all child subtotals = parent subtotal

---

### SPL-03: Split order with odd number of items (uneven distribution)
**Priority:** P1
**Prereqs:**
- Order with 3 items:
  - Item A: $20.00
  - Item B: $15.00
  - Item C: $10.00

**Steps:**
1. `POST /api/orders/{orderId}/split-tickets`
   ```json
   {
     "assignments": [
       { "ticketIndex": 1, "itemIds": ["{itemAId}"] },
       { "ticketIndex": 2, "itemIds": ["{itemBId}", "{itemCId}"] }
     ]
   }
   ```

**Verify:**
- [ ] Child 1: 1 item, subtotal = $20.00
- [ ] Child 2: 2 items, subtotal = $25.00
- [ ] Uneven amounts are acceptable (split by items, not by amount)
- [ ] Both children independently valid for payment

---

### SPL-04: Each split has correct subtotal + tax
**Priority:** P0
**Prereqs:**
- Split order from SPL-01

**Steps:**
1. `GET /api/orders/{childOrder1Id}`
2. `GET /api/orders/{childOrder2Id}`

**Verify:**
- [ ] Child 1 `subtotal` = $25.00
- [ ] Child 1 `taxAmount` = $25.00 * tax rate
- [ ] Child 1 `total` = subtotal + tax
- [ ] Child 2 `subtotal` = $25.00
- [ ] Child 2 `taxAmount` = $25.00 * tax rate
- [ ] Child 2 `total` = subtotal + tax
- [ ] Sum of child totals = parent total (within rounding tolerance of $0.01)
- [ ] No rounding discrepancy > $0.01 across all children
- [ ] If discounts exist on parent, they are proportionally allocated

---

### SPL-05: Splits visible to both terminals
**Priority:** P0
**Prereqs:**
- Split order from SPL-01
- Two terminals connected

**Steps:**
1. Create split on Terminal A.
2. On Terminal B: `GET /api/orders/open`
3. On Terminal B: check for child orders.

**Verify:**
- [ ] Both child orders appear in open orders list on Terminal B
- [ ] Parent order shows as `status: "split"` (not directly payable)
- [ ] Children are individually payable
- [ ] Socket events delivered to Terminal B within 500ms

---

## Section B: PAY SPLITS (5 tests)

### SPL-06: Pay first split (cash) -- parent stays open
**Priority:** P0
**Prereqs:**
- Split order with 2 children (from SPL-01)

**Steps:**
1. `POST /api/orders/{childOrder1Id}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "cash",
     "amount": {child1Total},
     "tipAmount": 0,
     "terminalId": "{terminalId}"
   }
   ```
2. `GET /api/orders/{parentOrderId}` to check parent state.

**Verify:**
- [ ] Child 1 `status` = `"paid"`, `paidAt` set
- [ ] Parent order `status` = `"split"` (NOT paid -- still has unpaid children)
- [ ] Parent remains in open orders list
- [ ] Child 2 still `status` = `"open"` (available for payment)
- [ ] Table remains occupied
- [ ] Socket: `payment:processed` fires for child 1
- [ ] Socket: `orders:list-changed` fires

---

### SPL-07: Pay second split (card) -- parent auto-closes
**Priority:** P0
**Prereqs:**
- Split order where child 1 is already paid (from SPL-06)

**Steps:**
1. `POST /api/orders/{childOrder2Id}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "card",
     "amount": {child2Total},
     "tipAmount": 5.00,
     "readerId": "{readerId}"
   }
   ```
2. `GET /api/orders/{parentOrderId}` to confirm auto-close.

**Verify:**
- [ ] Child 2 `status` = `"paid"`
- [ ] Parent order `status` = `"paid"` (auto-closed because ALL children paid)
- [ ] Parent `paidAt` set
- [ ] Table released to available
- [ ] Both child payments exist in DB
- [ ] Total paid across all children = original parent total + tips
- [ ] Socket: `orders:list-changed` fires with trigger "paid"
- [ ] Socket: `floorplan:updated` fires (table released)
- [ ] Inventory deduction runs for full order items

---

### SPL-08: Pay split with tip -- tip allocated to correct employee
**Priority:** P1
**Prereqs:**
- Split child order

**Steps:**
1. `POST /api/orders/{childOrderId}/pay`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "card",
     "amount": {childTotal},
     "tipAmount": 10.00,
     "readerId": "{readerId}"
   }
   ```

**Verify:**
- [ ] `Payment.tipAmount` = 10.00
- [ ] Tip allocated to the employee who served the order (original order's employee)
- [ ] TipLedger entry references the child order's payment
- [ ] Tip shows in employee's shift tip totals

---

### SPL-09: Void item on split recalculates that split only
**Priority:** P1
**Prereqs:**
- Split order with 2 children, both unpaid
- Child 1 has items A ($10) and B ($15)

**Steps:**
1. Void item A on child 1:
   ```
   POST /api/orders/{childOrder1Id}/comp-void
   {
     "itemIds": ["{itemAId}"],
     "action": "void",
     "reason": "Wrong item",
     "managerId": "{managerId}"
   }
   ```
2. `GET /api/orders/{childOrder1Id}`
3. `GET /api/orders/{childOrder2Id}`

**Verify:**
- [ ] Child 1 `subtotal` recalculated to $15.00 (only item B)
- [ ] Child 1 `taxAmount` recalculated
- [ ] Child 2 totals UNCHANGED
- [ ] Parent total recalculated to reflect void
- [ ] Voided item has `status: "voided"` on child 1

---

### SPL-10: Pay all splits at once
**Priority:** P1
**Prereqs:**
- Split order with 2+ unpaid children

**Steps:**
1. `POST /api/orders/{parentOrderId}/pay-all-splits`
   ```json
   {
     "employeeId": "{employeeId}",
     "paymentMethod": "card",
     "tipAmount": 10.00,
     "readerId": "{readerId}"
   }
   ```

**Verify:**
- [ ] All children paid in single operation
- [ ] One card charge for full remaining balance + tip
- [ ] OR individual charges per child (implementation-dependent)
- [ ] Parent auto-closes to `status: "paid"`
- [ ] All split orders marked paid
- [ ] Table released
- [ ] Single `floorplan:updated` socket event (not N events)

---

## Section C: CUSTOM SPLIT (3 tests)

### SPL-11: Move specific items to new check (item-level split)
**Priority:** P1
**Prereqs:**
- Open order with 5 items (not yet split)

**Steps:**
1. `POST /api/orders/{orderId}/split-tickets`
   ```json
   {
     "assignments": [
       { "ticketIndex": 1, "itemIds": ["{item1}", "{item3}", "{item5}"] },
       { "ticketIndex": 2, "itemIds": ["{item2}", "{item4}"] }
     ]
   }
   ```

**Verify:**
- [ ] Child 1 has items 1, 3, 5
- [ ] Child 2 has items 2, 4
- [ ] All items accounted for (no items lost)
- [ ] Each child totals reflect only their items
- [ ] No duplicate items across children

---

### SPL-12: Split by seat number
**Priority:** P1
**Prereqs:**
- Order with items assigned to different seats:
  - Seat 1: 2 items
  - Seat 2: 3 items

**Steps:**
1. Group items by seat and create split:
   ```
   POST /api/orders/{orderId}/split-tickets
   {
     "assignments": [
       { "ticketIndex": 1, "itemIds": [seat1ItemIds] },
       { "ticketIndex": 2, "itemIds": [seat2ItemIds] }
     ]
   }
   ```

**Verify:**
- [ ] Child 1 contains all seat 1 items
- [ ] Child 2 contains all seat 2 items
- [ ] Seat assignments preserved on transferred items
- [ ] Totals correct per child

---

### SPL-13: Delete a split (merge back into parent)
**Priority:** P1
**Prereqs:**
- Split order with 2 children, neither paid

**Steps:**
1. `DELETE /api/orders/{parentOrderId}/split-tickets/{childOrderId}`
   OR equivalent endpoint to unsplit.

**Verify:**
- [ ] Child order removed (soft-deleted)
- [ ] Items from deleted child moved back to parent
- [ ] Remaining child also dissolved (if only 1 left, split is meaningless)
- [ ] Parent `status` reverts from `"split"` to `"open"`
- [ ] Parent totals recalculated with all items
- [ ] Socket: `orders:list-changed` fires

---

## Section D: TRANSFERS (5 tests)

### SPL-14: Transfer items between orders
**Priority:** P0
**Prereqs:**
- Order A (source) on Table 1 with 3 items
- Order B (destination) on Table 2 with 1 item
- Both orders open

**Steps:**
1. `POST /api/orders/{orderAId}/transfer-items`
   ```json
   {
     "toOrderId": "{orderBId}",
     "itemIds": ["{itemId1}", "{itemId2}"],
     "employeeId": "{employeeId}"
   }
   ```
2. `GET /api/orders/{orderAId}` to check source.
3. `GET /api/orders/{orderBId}` to check destination.

**Verify:**
- [ ] Source order has 1 remaining item
- [ ] Destination order has 3 items (original 1 + 2 transferred)
- [ ] Source order totals recalculated (decreased)
- [ ] Destination order totals recalculated (increased)
- [ ] Transferred items `orderId` updated to destination order
- [ ] `sourceTableId` field set on transferred items (tracking origin)
- [ ] Socket: `orders:list-changed` fires for BOTH orders
- [ ] Both orders remain open

**Timing:** < 300ms response time

---

### SPL-15: Transfer from one table to another
**Priority:** P0
**Prereqs:**
- Two orders on different tables

**Steps:**
1. Transfer 1 item from Table 1 order to Table 2 order.
   ```
   POST /api/orders/{table1OrderId}/transfer-items
   {
     "toOrderId": "{table2OrderId}",
     "itemIds": ["{itemId}"],
     "employeeId": "{employeeId}"
   }
   ```

**Verify:**
- [ ] Item moves to Table 2's order
- [ ] Table 1 order reflects reduced total
- [ ] Table 2 order reflects increased total
- [ ] Both tables' visual state updated
- [ ] Socket: `floorplan:updated` fires (both tables show updated totals)
- [ ] Socket: `order:updated` fires for both orders

---

### SPL-16: Transfer all items (source order becomes empty / cancelled)
**Priority:** P1
**Prereqs:**
- Source order with 2 items
- Destination order

**Steps:**
1. `POST /api/orders/{sourceOrderId}/transfer-items`
   ```json
   {
     "toOrderId": "{destOrderId}",
     "itemIds": ["{item1}", "{item2}"],
     "employeeId": "{employeeId}"
   }
   ```

**Verify:**
- [ ] Source order has 0 items
- [ ] Source order `status` = `"cancelled"` (auto-closed, no items remaining)
- [ ] OR source order remains open with $0.00 total (implementation-dependent)
- [ ] Source table released to available (if order cancelled)
- [ ] Destination order has all transferred items with correct totals
- [ ] Socket: `orders:list-changed` fires for both

---

### SPL-17: Transfer item with modifiers (modifiers follow)
**Priority:** P1
**Prereqs:**
- Source order with item that has 2 modifiers

**Steps:**
1. Transfer the modified item.
   ```
   POST /api/orders/{sourceOrderId}/transfer-items
   {
     "toOrderId": "{destOrderId}",
     "itemIds": ["{modifiedItemId}"],
     "employeeId": "{employeeId}"
   }
   ```
2. `GET /api/orders/{destOrderId}` and inspect the transferred item.

**Verify:**
- [ ] Transferred item appears in destination with all modifiers intact
- [ ] Modifier IDs still reference the correct `OrderItemModifier` records
- [ ] Modifier prices included in item total on destination order
- [ ] `modifierTotal` on item unchanged
- [ ] Destination order total reflects item + modifier prices
- [ ] No orphaned modifier records on source order

---

### SPL-18: Socket fires for BOTH orders on transfer
**Priority:** P0
**Prereqs:**
- WebSocket listener connected, two open orders

**Steps:**
1. Transfer items from order A to order B.
2. Listen for socket events.

**Verify:**
- [ ] `orders:list-changed` fires with source order ID
- [ ] `orders:list-changed` fires with destination order ID
- [ ] `order:updated` fires for both orders (or equivalent)
- [ ] If on different tables: `floorplan:updated` fires showing both tables updated
- [ ] All events arrive within 300ms
- [ ] Terminal displaying source order sees item disappear
- [ ] Terminal displaying destination order sees item appear

---

## Section E: MERGE (2 tests)

### SPL-19: Merge two orders into one
**Priority:** P1
**Prereqs:**
- Order A (target) on Table 1 with 2 items
- Order B (source) on Table 2 with 3 items
- Both orders open, not split, no payments

**Steps:**
1. `POST /api/orders/{orderAId}/merge`
   ```json
   {
     "sourceOrderId": "{orderBId}",
     "employeeId": "{employeeId}"
   }
   ```
2. `GET /api/orders/{orderAId}` to verify merged state.
3. `GET /api/orders/{orderBId}` to verify source closed.

**Verify:**
- [ ] Target order A now has 5 items (2 original + 3 from B)
- [ ] Target order totals recalculated (sum of all items)
- [ ] Source order B `status` = `"cancelled"` or soft-deleted
- [ ] Source order B table released to available
- [ ] All items from B have `orderId` = A's ID
- [ ] Modifiers on transferred items intact
- [ ] Discounts from source: either moved to target or recalculated
- [ ] Socket: `orders:list-changed` fires for both orders
- [ ] Socket: `floorplan:updated` fires (Table 2 released)
- [ ] Cannot merge order with itself (returns 400)

---

### SPL-20: Merge orders from different tables
**Priority:** P2
**Prereqs:**
- Two orders on different tables with items

**Steps:**
1. `POST /api/orders/{targetOrderId}/merge`
   ```json
   {
     "sourceOrderId": "{sourceOrderId}",
     "employeeId": "{employeeId}"
   }
   ```

**Verify:**
- [ ] All items consolidated onto target order
- [ ] Source table freed (status = available)
- [ ] Target table remains occupied with expanded order
- [ ] Guest count on target may need adjustment (if seats from source)
- [ ] Floor plan shows correct state for both tables
- [ ] Merged order can be sent to kitchen, paid, or further split
- [ ] OrderEvents emitted for the merge operation
