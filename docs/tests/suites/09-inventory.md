# Suite 09: Inventory

**Domain:** Inventory, Recipes, Stock Levels, Deduction Engine
**Total Tests:** 18
**P0 Tests:** 6 | **P1 Tests:** 8 | **P2 Tests:** 4
**Last Updated:** 2026-02-28

---

## Section A: SALE DEDUCTION (5 tests)

### INV-01: Pay order creates sale deduction for each recipe ingredient
**Priority:** P0
**Prereqs:**
- Open order with at least 1 item that has a recipe configured (e.g., "Margarita" with tequila, lime, triple sec)
- Each recipe ingredient has an `InventoryItem` with a known `currentStock` value
- Order has been sent to kitchen

**Steps:**
1. Record current stock levels for each recipe ingredient:
   ```
   GET /api/inventory/items?ingredientIds={tequilaId},{limeId},{tripleSecId}
   ```
   Store `currentStock` for each.
2. Pay the order:
   ```
   POST /api/orders/{orderId}/pay
   {
     "amount": {orderTotal},
     "paymentMethod": "cash",
     "employeeId": "{employeeId}"
   }
   ```
3. Wait 500ms (deduction is fire-and-forget).
4. Check inventory transactions:
   ```
   GET /api/inventory/transactions?referenceId={orderId}&referenceType=order
   ```
5. Re-check stock levels for each ingredient.

**Verify:**
- [ ] Response status `200` on pay
- [ ] `InventoryItemTransaction` rows created for each recipe ingredient
- [ ] Each transaction has `type: "sale"`
- [ ] Each transaction has `referenceType: "order"` and `referenceId: {orderId}`
- [ ] Quantity deducted matches recipe quantity x item quantity (e.g., 2oz tequila x 1 item = 2oz deducted)
- [ ] Stock levels updated: `newStock = previousStock - deductedAmount`
- [ ] Deduction runs asynchronously (payment response returned before deduction completes)
- [ ] Transaction timestamps match (within seconds of payment)

**Timing:** Payment response < 300ms (deduction is background)

---

### INV-02: Pay order with modifiers deducts via Path A (ModifierInventoryLink)
**Priority:** P0
**Prereqs:**
- Order with item that has a modifier (e.g., "Burger" + "Cheddar Cheese" modifier)
- Modifier has a `ModifierInventoryLink` record linking it to an `InventoryItem`
- Known stock levels for modifier ingredient

**Steps:**
1. Record current stock for modifier ingredient (e.g., cheddar cheese inventory).
2. Pay the order:
   ```
   POST /api/orders/{orderId}/pay
   {
     "amount": {orderTotal},
     "paymentMethod": "cash",
     "employeeId": "{employeeId}"
   }
   ```
3. Wait 500ms for deduction.
4. Check inventory transactions:
   ```
   GET /api/inventory/transactions?referenceId={orderId}&referenceType=order
   ```

**Verify:**
- [ ] Transaction created for both the base item recipe AND the modifier ingredient
- [ ] Modifier deduction uses `ModifierInventoryLink` quantity (Path A)
- [ ] Path A takes precedence over Path B (Modifier.ingredientId fallback)
- [ ] Modifier ingredient stock level decremented correctly
- [ ] Transaction records include modifier reference info

---

### INV-03: Modifier fallback deduction via Path B (Modifier.ingredientId)
**Priority:** P1
**Prereqs:**
- Order with item that has a modifier WITHOUT a `ModifierInventoryLink`
- Modifier has `ingredientId` set directly (Path B fallback)
- Known stock level for the linked ingredient

**Steps:**
1. Verify modifier has NO `ModifierInventoryLink` row but HAS `ingredientId` set.
2. Record current stock for the fallback ingredient.
3. Pay the order:
   ```
   POST /api/orders/{orderId}/pay
   {
     "amount": {orderTotal},
     "paymentMethod": "cash",
     "employeeId": "{employeeId}"
   }
   ```
4. Wait 500ms for deduction.
5. Check inventory transactions.

**Verify:**
- [ ] Transaction created for modifier ingredient via Path B
- [ ] Deduction quantity = 1 unit (default) or as specified by `Modifier.ingredientId` link
- [ ] Stock level decremented for the fallback ingredient
- [ ] No `ModifierInventoryLink` was used (Path B only)

---

### INV-04: Pre-modifier multipliers applied correctly
**Priority:** P0
**Prereqs:**
- Order with item that has modifiers using different pre-modifier instructions:
  - Modifier A with instruction `"NO"` (0x multiplier)
  - Modifier B with instruction `"LITE"` (0.5x multiplier)
  - Modifier C with instruction `"EXTRA"` (2x multiplier)
  - Modifier D with instruction `"TRIPLE"` (3x multiplier)
- Each modifier has an ingredient with a known stock level
- Recipe base quantity for each modifier = 1.0oz

**Steps:**
1. Record stock levels for all 4 modifier ingredients.
2. Pay the order:
   ```
   POST /api/orders/{orderId}/pay
   {
     "amount": {orderTotal},
     "paymentMethod": "cash",
     "employeeId": "{employeeId}"
   }
   ```
3. Wait 500ms for deduction.
4. Check inventory transactions for each modifier ingredient.

**Verify:**
- [ ] Modifier A (`NO`): 0.0oz deducted (skipped entirely, multiplier = 0)
- [ ] Modifier B (`LITE`): 0.5oz deducted (0.5x multiplier)
- [ ] Modifier C (`EXTRA`): 2.0oz deducted (2x multiplier)
- [ ] Modifier D (`TRIPLE`): 3.0oz deducted (3x multiplier)
- [ ] `NO`/`HOLD`/`REMOVE` instructions skip base recipe deduction entirely
- [ ] Multiplier values match location `InventorySettings` configuration
- [ ] Stock levels updated accordingly for each ingredient

---

### INV-05: Deduction is fire-and-forget (payment succeeds even if deduction fails)
**Priority:** P0
**Prereqs:**
- Order with an item whose recipe references a non-existent or deleted `InventoryItem`
- OR simulate deduction failure by corrupting inventory data temporarily

**Steps:**
1. Create order with item that will cause deduction to throw an error.
2. Pay the order:
   ```
   POST /api/orders/{orderId}/pay
   {
     "amount": {orderTotal},
     "paymentMethod": "cash",
     "employeeId": "{employeeId}"
   }
   ```
3. Check payment result.
4. Check server logs for deduction error.

**Verify:**
- [ ] Payment response status `200` (payment succeeds)
- [ ] Order `status` = `"paid"` (not blocked by deduction failure)
- [ ] `paidAt` timestamp set
- [ ] Payment record created in DB
- [ ] Server logs contain deduction error (caught by `.catch(console.error)`)
- [ ] No inventory transaction created for the failed deduction
- [ ] Other items on the order (with valid recipes) still deducted correctly

---

## Section B: VOID WASTE (4 tests)

### INV-06: Void item with wasMade=true creates waste transaction
**Priority:** P0
**Prereqs:**
- Open order with item sent to kitchen (`kitchenStatus != null`)
- Item has a recipe with known ingredient stock levels
- Manager with void permission

**Steps:**
1. Record current stock levels for item recipe ingredients.
2. Void the item with `wasMade: true`:
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{itemId}"],
     "action": "void",
     "reason": "wrong_item",
     "managerId": "{managerId}",
     "wasMade": true
   }
   ```
3. Wait 500ms for deduction.
4. Check inventory transactions:
   ```
   GET /api/inventory/transactions?referenceId={orderId}&type=waste
   ```

**Verify:**
- [ ] `InventoryItemTransaction` created with `type: "waste"` (not `"sale"`)
- [ ] Transaction `referenceType` = `"order"` and `referenceId` = orderId
- [ ] Recipe ingredients deducted based on item recipe quantities
- [ ] Stock levels decremented by waste amounts
- [ ] Waste deduction is fire-and-forget (void response returned before deduction completes)
- [ ] VoidLog entry created with `wasMade: true`

---

### INV-07: Void item with wasMade=false creates NO waste transaction
**Priority:** P1
**Prereqs:**
- Open order with item NOT yet sent to kitchen (`kitchenStatus: null`)
- Manager with void permission

**Steps:**
1. Record current stock levels for item recipe ingredients.
2. Void the item (wasMade defaults to false for unsent items):
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{itemId}"],
     "action": "void",
     "reason": "customer_changed_mind",
     "managerId": "{managerId}"
   }
   ```
3. Wait 500ms.
4. Check inventory transactions.

**Verify:**
- [ ] NO `InventoryItemTransaction` created for this void
- [ ] Stock levels unchanged
- [ ] Item `status` = `"voided"` (void itself succeeded)
- [ ] VoidLog entry created with `wasMade: false` (or null)
- [ ] `deductInventoryForVoidedItem` NOT called (or called and returned early)

---

### INV-08: Comp item creates waste deduction if made, skips if not
**Priority:** P1
**Prereqs:**
- Open order with 2 items: one sent to kitchen, one not sent
- Manager with comp permission

**Steps:**
1. Record stock levels.
2. Comp the sent item with `wasMade: true`:
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
3. Comp the unsent item (wasMade defaults false):
   ```
   POST /api/orders/{orderId}/comp-void
   {
     "itemIds": ["{unsentItemId}"],
     "action": "comp",
     "reason": "manager_decision",
     "managerId": "{managerId}"
   }
   ```
4. Check inventory transactions.

**Verify:**
- [ ] Sent item (wasMade=true): waste transaction created, stock decremented
- [ ] Unsent item (wasMade=false): NO waste transaction, stock unchanged
- [ ] Both items `status` = `"comped"`
- [ ] Comp and void use the same `deductInventoryForVoidedItem` function
- [ ] Waste transaction type = `"waste"` for the comped-and-made item

---

### INV-09: Void reason determines waste classification
**Priority:** P1
**Prereqs:**
- Open order with 3 sent items (all wasMade=true scenario)
- Manager with void permission

**Steps:**
1. Void item A with reason `"customer_changed_mind"`:
   ```
   POST /api/orders/{orderId}/comp-void
   { "itemIds": ["{itemA}"], "action": "void", "reason": "customer_changed_mind", "managerId": "{managerId}", "wasMade": false }
   ```
2. Void item B with reason `"quality"`:
   ```
   POST /api/orders/{orderId}/comp-void
   { "itemIds": ["{itemB}"], "action": "void", "reason": "quality", "managerId": "{managerId}", "wasMade": true }
   ```
3. Void item C with reason `"wrong_item"`:
   ```
   POST /api/orders/{orderId}/comp-void
   { "itemIds": ["{itemC}"], "action": "void", "reason": "wrong_item", "managerId": "{managerId}", "wasMade": true }
   ```
4. Check inventory transactions and VoidLog entries.

**Verify:**
- [ ] Item A (`customer_changed_mind`, wasMade=false): NO waste transaction
- [ ] Item B (`quality`, wasMade=true): waste transaction created
- [ ] Item C (`wrong_item`, wasMade=true): waste transaction created
- [ ] VoidLog entries store correct `reason` for each
- [ ] Waste report can group by reason code
- [ ] `wasMade` flag is the primary determinant of waste deduction, not the reason code

---

## Section C: IDEMPOTENCY (3 tests)

### INV-10: Double-deduction prevention (KNOWN BUG)
**Priority:** P0
**Prereqs:**
- Order with items and configured recipes
- Known stock levels

**Steps:**
1. Record stock levels before payment.
2. Pay the order normally.
3. Wait 500ms for deduction to complete.
4. Record stock levels after first deduction.
5. Manually invoke `deductInventoryForOrder(orderId)` a second time (simulate crash recovery replay).
6. Record stock levels after second invocation.

**Verify:**
- [ ] **EXPECTED TO FAIL (KNOWN BUG):** Second invocation should NOT create duplicate transactions
- [ ] Stock levels after step 6 should equal stock levels after step 4
- [ ] Ideally: deduction checks for existing transactions with same `referenceId` before creating new ones
- [ ] OR: deduction uses an idempotency key to prevent duplicates
- [ ] Transaction count for this orderId should be N (not 2N)

**Notes:** This is a KNOWN BUG. Test documents the expected behavior for when the fix is implemented. Track progress against this test.

---

### INV-11: Inventory transaction has correct reference fields
**Priority:** P1
**Prereqs:**
- Completed order with inventory deductions (from INV-01)

**Steps:**
1. Query inventory transactions for the paid order:
   ```
   GET /api/inventory/transactions?referenceId={orderId}
   ```
2. Inspect each transaction record.

**Verify:**
- [ ] Each transaction has `referenceType` = `"order"`
- [ ] Each transaction has `referenceId` = orderId
- [ ] Each transaction has `type` = `"sale"`
- [ ] Each transaction has `inventoryItemId` pointing to valid `InventoryItem`
- [ ] Each transaction has `quantity` > 0 (positive, representing amount consumed)
- [ ] Each transaction has `locationId` matching order locationId
- [ ] Each transaction has `createdAt` timestamp
- [ ] Each transaction has `employeeId` (or null if system-initiated)

---

### INV-12: No duplicate transactions after crash recovery
**Priority:** P0
**Prereqs:**
- Ability to simulate crash (or manually re-trigger deduction)

**Steps:**
1. Create and pay an order.
2. Wait for deduction to complete.
3. Count inventory transactions for this order: `SELECT COUNT(*) FROM InventoryItemTransaction WHERE referenceId = {orderId}`.
4. Simulate server restart / recovery that might re-trigger deduction.
5. Re-count transactions.

**Verify:**
- [ ] Transaction count after step 5 = transaction count after step 3
- [ ] No new transactions created by recovery process
- [ ] Stock levels unchanged after recovery
- [ ] If crash happened mid-deduction, partial deductions are either completed or rolled back (not duplicated)

---

## Section D: RECIPE & COSTING (3 tests)

### INV-13: Recipe costing matches ingredient costs times quantities
**Priority:** P1
**Prereqs:**
- Menu item with recipe containing 3 ingredients:
  - Ingredient A: 2oz at $0.50/oz = $1.00
  - Ingredient B: 1 unit at $2.00/unit = $2.00
  - Ingredient C: 0.5lb at $4.00/lb = $2.00
- Recipe configured in system

**Steps:**
1. Fetch menu item cost info:
   ```
   GET /api/menu/items/{menuItemId}/recipe
   ```
2. Calculate expected cost: $1.00 + $2.00 + $2.00 = $5.00.

**Verify:**
- [ ] Recipe `totalCost` = $5.00
- [ ] Each ingredient line shows: name, quantity, unit, cost per unit, line total
- [ ] Ingredient A line total = $1.00
- [ ] Ingredient B line total = $2.00
- [ ] Ingredient C line total = $2.00
- [ ] Cost margin = (item price - recipe cost) / item price
- [ ] Recipe cost is used in food cost reports

---

### INV-14: Multi-level recipe explosion
**Priority:** P2
**Prereqs:**
- Menu item "Combo Plate" with a recipe that includes:
  - Sub-recipe "House Sauce" (itself a recipe with ketchup, mayo, spices)
  - Direct ingredient: chicken breast
- All sub-recipe ingredients have stock levels

**Steps:**
1. Pay an order containing "Combo Plate".
2. Wait for deduction.
3. Check inventory transactions.

**Verify:**
- [ ] Transactions created for the leaf-level ingredients (ketchup, mayo, spices, chicken)
- [ ] NO transaction for the sub-recipe itself ("House Sauce" is not an inventory item)
- [ ] Quantities correctly cascaded through recipe levels
- [ ] Sub-recipe quantities multiplied by parent recipe quantity
- [ ] Total cost reflects all leaf ingredients

---

### INV-15: Unit conversion applied in deduction
**Priority:** P2
**Prereqs:**
- Recipe specifies ingredient in ounces (oz)
- Inventory item tracked in milliliters (ml)
- OR recipe in pounds (lb), inventory in ounces (oz)
- Conversion factors configured in system

**Steps:**
1. Create order with item using cross-unit recipe.
2. Pay the order.
3. Wait for deduction.
4. Check that stock was decremented in the inventory item's native unit.

**Verify:**
- [ ] Recipe quantity in oz correctly converted to ml for deduction (1 oz = ~29.57 ml)
- [ ] OR recipe quantity in lb correctly converted to oz (1 lb = 16 oz)
- [ ] Stock level decremented in the inventory item's base unit
- [ ] Transaction records the quantity in the deducted unit
- [ ] No rounding errors that accumulate over multiple deductions (use Decimal precision)

---

## Section E: STOCK LEVELS (3 tests)

### INV-16: Ingredient stock level updates after sale deduction
**Priority:** P0
**Prereqs:**
- Inventory item "Vodka" with `currentStock: 100.0` (oz)
- Menu item "Vodka Soda" with recipe: 1.5oz vodka
- Order with 2x Vodka Soda

**Steps:**
1. Verify initial stock:
   ```
   GET /api/inventory/items/{vodkaId}
   ```
   Confirm `currentStock` = 100.0.
2. Create, send, and pay order with 2x Vodka Soda.
3. Wait 500ms for deduction.
4. Re-check stock:
   ```
   GET /api/inventory/items/{vodkaId}
   ```

**Verify:**
- [ ] `currentStock` = 97.0 (100.0 - 2 * 1.5)
- [ ] Stock change = -3.0oz
- [ ] Transaction records show 2 entries (one per item) at 1.5oz each
- [ ] OR 1 aggregated entry at 3.0oz (implementation-dependent)
- [ ] `lastTransactionAt` updated on inventory item

---

### INV-17: Low stock alert triggers when below threshold
**Priority:** P1
**Prereqs:**
- Inventory item with `lowStockThreshold: 10.0` and `currentStock: 11.0`
- Recipe that will deduct at least 2.0 units

**Steps:**
1. Verify stock is above threshold (11.0 > 10.0).
2. Pay order that deducts 2.0 units.
3. Wait for deduction.
4. Check stock level (should be 9.0, below threshold).
5. Check for low stock alert.

**Verify:**
- [ ] `currentStock` = 9.0 (below threshold of 10.0)
- [ ] Low stock alert created or flag set on inventory item
- [ ] Socket: `inventory:low-stock` fires with `{ inventoryItemId, currentStock, threshold }`
- [ ] Low stock visible on inventory dashboard
- [ ] Alert includes item name and current level

---

### INV-18: 86'd item reflected in menu availability
**Priority:** P1
**Prereqs:**
- Inventory item "Salmon" with `currentStock: 0` (or stock just depleted to 0)
- Menu item "Grilled Salmon" depends on Salmon ingredient
- `autoEightySix: true` in inventory settings (if configurable)

**Steps:**
1. Deplete salmon stock to 0 via a sale deduction (or manual adjustment).
2. Check menu item availability:
   ```
   GET /api/menu/items/{grilledSalmonId}
   ```
3. Listen for socket event.

**Verify:**
- [ ] Menu item shows as unavailable / 86'd
- [ ] `isAvailable: false` or `eightySixed: true` on menu item response
- [ ] Socket: `menu:stock-changed` fires with affected menu item IDs
- [ ] POS terminals update menu to show item as unavailable
- [ ] Item cannot be added to new orders (returns error or warning)
- [ ] When stock is replenished (manual restock), item becomes available again
- [ ] Socket: `menu:stock-changed` fires again on restock
