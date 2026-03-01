# Suite 12: Menu, Modifiers & Entertainment

**Domain:** Menu Cache, Menu CRUD, Modifier Groups, Modifier Pricing, Entertainment Sessions
**Total Tests:** 24
**P0 Tests:** 7 | **P1 Tests:** 12 | **P2 Tests:** 5
**Last Updated:** 2026-02-28

---

## Section A: MENU CACHE (4 tests)

### MNU-01: First menu load hits DB (cache miss)
**Priority:** P0
**Prereqs:**
- Fresh server start OR menu cache invalidated via `invalidateMenuCache(locationId)`
- Server-Timing header enabled on menu endpoint

**Steps:**
1. Invalidate the menu cache (restart server or call invalidation).
2. `GET /api/menu` with timing measurement.
3. Read `Server-Timing` response header.

**Verify:**
- [ ] Response status `200`
- [ ] `Server-Timing` header indicates DB query was executed (cache miss)
- [ ] Response includes categories, items, modifier groups, and modifiers
- [ ] Response time > 5ms (DB query was required)
- [ ] Cache is now populated for subsequent requests
- [ ] Menu data is complete and matches DB state

**Timing:** Response time < 200ms (cache miss with parallel DB queries)

---

### MNU-02: Second menu load within 60s hits cache (< 5ms)
**Priority:** P0
**Prereqs:**
- Menu already loaded once (cache populated from MNU-01)
- Less than 60 seconds since last load (within TTL)

**Steps:**
1. `GET /api/menu` (second request, cache should be warm).
2. Read `Server-Timing` header.
3. Measure response time.

**Verify:**
- [ ] Response status `200`
- [ ] `Server-Timing` header indicates cache hit (no DB query)
- [ ] Response time < 5ms
- [ ] Response body identical to MNU-01 response
- [ ] No database query executed
- [ ] `X-Cache: HIT` or equivalent indicator present

**Timing:** Response time < 5ms

---

### MNU-03: Menu CRUD invalidates cache
**Priority:** P1
**Prereqs:**
- Warm menu cache (from MNU-02)
- Manager with menu editing permissions

**Steps:**
1. Verify cache is warm: `GET /api/menu` returns in < 5ms.
2. Create a new menu item:
   ```
   POST /api/menu/items
   {
     "name": "Test Cache Invalidation",
     "price": 9.99,
     "categoryId": "{categoryId}",
     "locationId": "{locationId}"
   }
   ```
3. `GET /api/menu` again.
4. Check if new item appears and if cache was invalidated.

**Verify:**
- [ ] After menu item create: `invalidateMenuCache(locationId)` was called
- [ ] Next `GET /api/menu` reflects the new item
- [ ] `Server-Timing` on the next GET shows cache miss (DB query re-executed)
- [ ] Cache repopulated with updated data
- [ ] Same invalidation happens on update and delete operations
- [ ] Socket: `menu:updated` fires to notify other terminals

---

### MNU-04: Cache stats endpoint returns hit/miss counts
**Priority:** P2
**Prereqs:**
- Multiple menu requests made (some hits, some misses)

**Steps:**
1. Make several menu requests to generate cache activity.
2. Check cache stats (if available):
   ```
   GET /api/menu/cache-stats
   ```
   OR inspect `Server-Timing` headers from recent requests.

**Verify:**
- [ ] Stats show total hits and total misses
- [ ] Hit count matches expected number of cached responses
- [ ] Miss count matches expected number of DB-queried responses
- [ ] Hit ratio calculable from stats
- [ ] Stats are per-locationId (multi-tenant safe)

---

## Section B: MENU CRUD (5 tests)

### MNU-05: Create menu item with category, price, and tax rule
**Priority:** P0
**Prereqs:**
- Existing category (e.g., "Appetizers")
- Known tax rule ID
- Manager with menu permissions

**Steps:**
1. `POST /api/menu/items`
   ```json
   {
     "name": "Loaded Nachos",
     "price": 13.99,
     "categoryId": "{appetizersId}",
     "locationId": "{locationId}",
     "taxRuleId": "{taxRuleId}",
     "description": "Tortilla chips with cheese, jalape\u00f1os, and salsa",
     "isActive": true,
     "sortOrder": 10
   }
   ```
2. `GET /api/menu/items/{newItemId}` to verify.

**Verify:**
- [ ] Response status `200` (or `201`)
- [ ] Item created with `name: "Loaded Nachos"`
- [ ] `price` = 13.99
- [ ] `categoryId` matches the appetizers category
- [ ] `taxRuleId` assigned
- [ ] `description` stored
- [ ] `isActive` = true
- [ ] `sortOrder` = 10
- [ ] `locationId` matches
- [ ] `deletedAt` = null
- [ ] `createdAt` and `updatedAt` timestamps set
- [ ] Item appears in `GET /api/menu` response under correct category

---

### MNU-06: Update menu item price reflected in next order
**Priority:** P0
**Prereqs:**
- Existing menu item with known `price`
- Manager with menu permissions

**Steps:**
1. Record original price of menu item.
2. Update the price:
   ```
   PUT /api/menu/items/{itemId}
   { "price": 15.99 }
   ```
3. Invalidate menu cache (or wait for next cache miss).
4. Create a new order with this item:
   ```
   POST /api/orders
   {
     "employeeId": "{managerId}",
     "locationId": "{locationId}",
     "orderType": "takeout",
     "items": [{
       "menuItemId": "{itemId}",
       "name": "Loaded Nachos",
       "price": 15.99,
       "quantity": 1,
       "modifiers": []
     }]
   }
   ```

**Verify:**
- [ ] Menu item `price` updated to 15.99
- [ ] `updatedAt` timestamp changed
- [ ] New order uses updated price (15.99, not old price)
- [ ] Existing open orders with this item retain their original price (price at time of order)
- [ ] Menu cache reflects updated price after invalidation
- [ ] Socket: `menu:updated` fires

---

### MNU-07: Delete menu item (soft delete) no longer appears in menu
**Priority:** P1
**Prereqs:**
- Existing menu item with no active order items referencing it
- Manager with menu permissions

**Steps:**
1. `DELETE /api/menu/items/{itemId}`
2. `GET /api/menu` to check if item is gone.
3. `GET /api/menu/items/{itemId}` directly.

**Verify:**
- [ ] Response status `200` on delete
- [ ] Item `deletedAt` set to current timestamp (soft deleted)
- [ ] Item does NOT appear in `GET /api/menu` response
- [ ] Direct GET returns the item but with `deletedAt` set (or returns 404)
- [ ] Item cannot be added to new orders
- [ ] Existing orders with this item are unaffected (historical data preserved)
- [ ] Socket: `menu:updated` fires

---

### MNU-08: Menu item with pour sizes (liquor) shows all pour options
**Priority:** P1
**Prereqs:**
- Category with `categoryType: "liquor"`
- Liquor menu item with `pourSizes` configured

**Steps:**
1. Create or verify a liquor item:
   ```
   POST /api/menu/items
   {
     "name": "Patron Silver",
     "price": 12.00,
     "categoryId": "{liquorCategoryId}",
     "locationId": "{locationId}",
     "itemType": "standard",
     "pourSizes": {
       "shot": { "multiplier": 1.0, "label": "Shot" },
       "double": { "multiplier": 2.0, "label": "Double" },
       "tall": { "multiplier": 1.5, "label": "Tall" },
       "short": { "multiplier": 0.75, "label": "Short" }
     }
   }
   ```
2. `GET /api/menu/items/{itemId}` to verify.

**Verify:**
- [ ] `pourSizes` JSON contains all 4 pour options
- [ ] `shot` multiplier = 1.0 (base price)
- [ ] `double` multiplier = 2.0 (2x base price = $24.00)
- [ ] `tall` multiplier = 1.5 (1.5x base price = $18.00)
- [ ] `short` multiplier = 0.75 (0.75x base price = $9.00)
- [ ] POS UI shows pour size selector when this item is tapped
- [ ] Selected pour size stored on OrderItem when ordered

---

### MNU-09: Socket menu:updated fires on menu item change
**Priority:** P1
**Prereqs:**
- Socket connected to location room
- Manager with menu permissions

**Steps:**
1. Listen for `menu:updated` events:
   ```javascript
   socket.on('menu:updated', (data) => { /* capture */ })
   ```
2. Update a menu item:
   ```
   PUT /api/menu/items/{itemId}
   { "name": "Updated Nachos Supreme" }
   ```
3. Check socket events.

**Verify:**
- [ ] `menu:updated` event received
- [ ] Event includes `menuItemId` or category reference
- [ ] All connected POS terminals receive the event
- [ ] Terminals can refresh their menu cache in response
- [ ] Event fires within 200ms of API response

---

## Section C: MODIFIER GROUPS (5 tests)

### MNU-10: Add modifier group to item (required vs optional)
**Priority:** P0
**Prereqs:**
- Existing menu item
- Manager with menu permissions

**Steps:**
1. Create a required modifier group:
   ```
   POST /api/menu/items/{itemId}/modifier-groups
   {
     "name": "Temperature",
     "isRequired": true,
     "minSelections": 1,
     "maxSelections": 1,
     "modifiers": [
       { "name": "Rare", "price": 0, "sortOrder": 1 },
       { "name": "Medium", "price": 0, "sortOrder": 2 },
       { "name": "Well Done", "price": 0, "sortOrder": 3 }
     ]
   }
   ```
2. Create an optional modifier group:
   ```
   POST /api/menu/items/{itemId}/modifier-groups
   {
     "name": "Add-Ons",
     "isRequired": false,
     "minSelections": 0,
     "maxSelections": 5,
     "modifiers": [
       { "name": "Bacon", "price": 2.50, "sortOrder": 1 },
       { "name": "Avocado", "price": 1.99, "sortOrder": 2 }
     ]
   }
   ```
3. `GET /api/menu/items/{itemId}` with modifier groups included.

**Verify:**
- [ ] Item has 2 modifier groups
- [ ] "Temperature" group: `isRequired: true`, `minSelections: 1`, `maxSelections: 1`
- [ ] "Add-Ons" group: `isRequired: false`, `minSelections: 0`, `maxSelections: 5`
- [ ] Each group contains its modifiers with correct names, prices, sort orders
- [ ] Required group enforces selection when ordering (API rejects order without selection)
- [ ] Optional group allows zero selections

---

### MNU-11: Modifier with stacking (allowStacking=true)
**Priority:** P0
**Prereqs:**
- Modifier group with `allowStacking: true`
- Modifier "Extra Cheese" at $1.50

**Steps:**
1. Verify modifier group has `allowStacking: true`.
2. Add item to order with stacked modifier (quantity=3):
   ```
   POST /api/orders/{orderId}/items
   {
     "items": [{
       "menuItemId": "{itemId}",
       "name": "Pizza",
       "price": 14.99,
       "quantity": 1,
       "modifiers": [{
         "modifierId": "{cheeseModId}",
         "modifierGroupId": "{toppingsGroupId}",
         "name": "Extra Cheese",
         "price": 1.50,
         "quantity": 3,
         "depth": 0
       }]
     }]
   }
   ```
3. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Modifier `quantity` = 3
- [ ] Modifier total = $4.50 (1.50 x 3)
- [ ] Item `modifierTotal` = $4.50
- [ ] Item total = $14.99 + $4.50 = $19.49
- [ ] Kitchen ticket shows "3x Extra Cheese" (or "Extra Cheese x3")
- [ ] Tapping modifier again in POS UI increments quantity (stacking behavior)

---

### MNU-12: Nested modifier groups (child group, depth=1)
**Priority:** P1
**Prereqs:**
- Menu item with a modifier group that has a child modifier group
- e.g., "Cheese" modifier opens child group "Cheese Type" (Cheddar, Swiss, Provolone)

**Steps:**
1. Create parent modifier group with a child:
   ```
   POST /api/menu/items/{itemId}/modifier-groups
   {
     "name": "Toppings",
     "modifiers": [
       {
         "name": "Cheese",
         "price": 1.50,
         "childModifierGroup": {
           "name": "Cheese Type",
           "modifiers": [
             { "name": "Cheddar", "price": 0, "sortOrder": 1 },
             { "name": "Swiss", "price": 0.50, "sortOrder": 2 },
             { "name": "Provolone", "price": 0, "sortOrder": 3 }
           ]
         }
       }
     ]
   }
   ```
2. Order item with parent + child modifier:
   ```
   POST /api/orders/{orderId}/items
   {
     "items": [{
       "menuItemId": "{itemId}",
       "name": "Burger",
       "price": 12.99,
       "quantity": 1,
       "modifiers": [
         { "modifierId": "{cheeseMod}", "modifierGroupId": "{toppingsGroup}", "name": "Cheese", "price": 1.50, "quantity": 1, "depth": 0 },
         { "modifierId": "{swissMod}", "modifierGroupId": "{cheeseTypeGroup}", "name": "Swiss", "price": 0.50, "quantity": 1, "depth": 1, "parentModifierId": "{cheeseMod}" }
       ]
     }]
   }
   ```

**Verify:**
- [ ] Parent modifier stored at `depth: 0`
- [ ] Child modifier stored at `depth: 1` with `parentModifierId` reference
- [ ] Both modifier prices contribute to item total (12.99 + 1.50 + 0.50 = 14.99)
- [ ] `OrderItemModifier.depth` correctly set
- [ ] Kitchen ticket shows nested hierarchy: "Cheese > Swiss"
- [ ] Child modifier cannot exist without parent modifier selected

---

### MNU-13: Pre-modifiers applied to modifier (No, Lite, Extra)
**Priority:** P0
**Prereqs:**
- Modifier group on a menu item
- Modifier "Onions" with pre-modifier support

**Steps:**
1. Order item with modifier using "NO" pre-modifier:
   ```
   POST /api/orders/{orderId}/items
   {
     "items": [{
       "menuItemId": "{itemId}",
       "name": "Burger",
       "price": 12.99,
       "quantity": 1,
       "modifiers": [{
         "modifierId": "{onionsMod}",
         "modifierGroupId": "{toppingsGroup}",
         "name": "Onions",
         "price": 0,
         "quantity": 1,
         "depth": 0,
         "instruction": "NO"
       }]
     }]
   }
   ```
2. Order another item with "EXTRA" pre-modifier:
   ```
   (same structure but instruction: "EXTRA")
   ```
3. Order another with "LITE" pre-modifier.

**Verify:**
- [ ] "NO" instruction: modifier stored with `instruction: "NO"`
- [ ] "LITE" instruction: modifier stored with `instruction: "LITE"`
- [ ] "EXTRA" instruction: modifier stored with `instruction: "EXTRA"`
- [ ] Kitchen ticket shows: "NO Onions", "LITE Onions", "EXTRA Onions"
- [ ] Pre-modifier affects inventory deduction multiplier (NO=0x, LITE=0.5x, EXTRA=2x)
- [ ] "NO" modifier does not add price (even if modifier has a base price)

---

### MNU-14: Linked item modifier (spirit upgrade via linkedMenuItemId)
**Priority:** P1
**Prereqs:**
- Spirit modifier group with `isSpiritGroup: true`
- Modifier "Patron Silver" with `linkedMenuItemId` pointing to the Patron Silver MenuItem
- Base cocktail item (e.g., "Margarita")

**Steps:**
1. Verify modifier has `linkedMenuItemId` set.
2. Order Margarita with Patron upgrade:
   ```
   POST /api/orders/{orderId}/items
   {
     "items": [{
       "menuItemId": "{margaritaId}",
       "name": "Margarita",
       "price": 10.00,
       "quantity": 1,
       "modifiers": [{
         "modifierId": "{patronMod}",
         "modifierGroupId": "{spiritGroup}",
         "name": "Patron Silver",
         "price": 4.00,
         "quantity": 1,
         "depth": 0,
         "linkedMenuItemId": "{patronItemId}"
       }]
     }]
   }
   ```

**Verify:**
- [ ] Modifier references the linked MenuItem via `linkedMenuItemId`
- [ ] Modifier price reflects the upgrade charge ($4.00)
- [ ] Item total = $10.00 + $4.00 = $14.00
- [ ] Linked MenuItem's sales count includes this as an "upgrade" sale
- [ ] Inventory deduction uses the linked MenuItem's recipe (Patron Silver recipe, not Margarita well spirit)
- [ ] PMIX report can show: "Patron Silver sold 47x: 30 standalone, 17 as upgrades"

---

## Section D: MODIFIER PRICING (3 tests)

### MNU-15: Modifier price added to item total
**Priority:** P0
**Prereqs:**
- Order with item ($12.99) and one modifier ($2.50)

**Steps:**
1. Create order with item + modifier (as in MNU-10 or MNU-11 setup).
2. `GET /api/orders/{orderId}` to verify totals.

**Verify:**
- [ ] Item `price` = $12.99 (base price, no modifier)
- [ ] Modifier `price` = $2.50
- [ ] Item `modifierTotal` = $2.50
- [ ] Item effective total = $15.49 ($12.99 + $2.50)
- [ ] Order `subtotal` includes modifier prices
- [ ] Tax calculated on total including modifiers

---

### MNU-16: Stacked modifier price multiplied by quantity
**Priority:** P0
**Prereqs:**
- Order with stacked modifier (quantity > 1)

**Steps:**
1. Add item with modifier stacked 3x at $1.50 each (from MNU-11).
2. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Modifier `price` = $1.50
- [ ] Modifier `quantity` = 3
- [ ] Modifier line total = $4.50 ($1.50 x 3)
- [ ] Item `modifierTotal` reflects stacked total ($4.50)
- [ ] Order totals reflect stacked modifier cost

---

### MNU-17: Pre-modifier 'No' = $0, 'Extra' = modifier price
**Priority:** P1
**Prereqs:**
- Modifier with a base price (e.g., "Bacon" at $2.50)

**Steps:**
1. Order item with "NO Bacon":
   ```
   { "instruction": "NO", "price": 2.50, ... }
   ```
2. Order item with "EXTRA Bacon":
   ```
   { "instruction": "EXTRA", "price": 2.50, ... }
   ```
3. `GET /api/orders/{orderId}` for each.

**Verify:**
- [ ] "NO Bacon": effective modifier price = $0.00 (instruction overrides base price)
- [ ] "EXTRA Bacon": effective modifier price = $2.50 (or $5.00 if EXTRA doubles the price, implementation-dependent)
- [ ] Item totals reflect correct modifier pricing
- [ ] Kitchen ticket shows instruction prefix
- [ ] "LITE" modifier: price may be reduced (implementation-dependent, often same as base)

---

## Section E: ENTERTAINMENT (7 tests)

### MNU-18: Create timed rental item
**Priority:** P1
**Prereqs:**
- Category with `categoryType: "entertainment"`
- Manager with menu permissions

**Steps:**
1. Create a timed rental item:
   ```
   POST /api/menu/items
   {
     "name": "Pool Table",
     "price": 15.00,
     "categoryId": "{entertainmentCatId}",
     "locationId": "{locationId}",
     "itemType": "timed_rental",
     "timedPricing": {
       "type": "block",
       "blockOptions": [
         { "minutes": 30, "price": 15.00 },
         { "minutes": 60, "price": 25.00 },
         { "minutes": 90, "price": 35.00 }
       ]
     }
   }
   ```
2. `GET /api/menu/items/{itemId}` to verify.

**Verify:**
- [ ] `itemType` = `"timed_rental"`
- [ ] `timedPricing` JSON stored with block time options
- [ ] 3 block time options with correct minutes and prices
- [ ] Item appears in entertainment category on POS
- [ ] Item can be added to orders with `blockTimeMinutes` specified

---

### MNU-19: Start block time session -- timer begins
**Priority:** P1
**Prereqs:**
- Order with a timed rental item (Pool Table, 60 min block)
- Item added with `blockTimeMinutes: 60`

**Steps:**
1. Send the order to kitchen (starts the timer):
   ```
   POST /api/orders/{orderId}/send
   ```
2. `GET /api/orders/{orderId}` to check timer fields.

**Verify:**
- [ ] Item `blockTimeStartedAt` set to current timestamp
- [ ] Item `blockTimeExpiresAt` = `blockTimeStartedAt` + 60 minutes
- [ ] Item `blockTimeMinutes` = 60
- [ ] Timer is running (expiresAt is in the future)
- [ ] Socket: `entertainment:session-update` fires with `action: "started"`
- [ ] Entertainment KDS shows the active session with countdown

**Timing:** Timer starts within 1 second of send

---

### MNU-20: Extend entertainment session
**Priority:** P1
**Prereqs:**
- Active entertainment session with running timer (from MNU-19)

**Steps:**
1. Extend the session by 30 minutes:
   ```
   POST /api/orders/{orderId}/items/{itemId}/extend
   {
     "additionalMinutes": 30,
     "additionalPrice": 15.00
   }
   ```
2. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] `blockTimeExpiresAt` extended by 30 minutes from current expiry
- [ ] `blockTimeMinutes` updated to 90 (60 + 30)
- [ ] Additional charge of $15.00 added to order
- [ ] Order total updated
- [ ] Socket: `entertainment:session-update` fires with `action: "extended"`
- [ ] Entertainment KDS updates countdown with new expiry

---

### MNU-21: Session expires -- auto-complete
**Priority:** P1
**Prereqs:**
- Entertainment session near expiry (or simulate by setting `blockTimeExpiresAt` to past)

**Steps:**
1. Wait for session to expire (or fast-forward by updating DB directly).
2. Check session status via poll or server-side cron.
3. `GET /api/orders/{orderId}` to verify item status.

**Verify:**
- [ ] Item status changes to `"delivered"` or `"completed"` on expiry
- [ ] Session marked as expired
- [ ] Socket: `entertainment:session-update` fires with `action: "expired"`
- [ ] Entertainment KDS removes or flags the expired session
- [ ] Order can now be paid (session complete)
- [ ] No additional charges added automatically on expiry

---

### MNU-22: Per-minute pricing settlement before payment
**Priority:** P1
**Prereqs:**
- Timed rental item with `timedPricing.type: "per_minute"`
- e.g., $0.50 per minute, session ran for 45 minutes

**Steps:**
1. Create item with per-minute pricing:
   ```
   POST /api/orders/{orderId}/items
   {
     "items": [{
       "menuItemId": "{perMinItemId}",
       "name": "Karaoke Room",
       "price": 0.50,
       "quantity": 1,
       "modifiers": []
     }]
   }
   ```
2. Start the session (send order).
3. Stop the session after 45 minutes (or simulate).
4. Settle the session:
   ```
   POST /api/orders/{orderId}/items/{itemId}/settle
   ```
5. Check item price.

**Verify:**
- [ ] Item price updated to reflect actual usage: $22.50 ($0.50 x 45 min)
- [ ] Settlement calculates: (stopTime - startTime) x pricePerMinute
- [ ] Order totals recalculated with settled price
- [ ] Session cannot be extended after settlement
- [ ] Payment reflects the settled amount

---

### MNU-23: Entertainment KDS shows active sessions
**Priority:** P1
**Prereqs:**
- 2 or more active entertainment sessions
- Entertainment KDS view available

**Steps:**
1. Start 2 entertainment sessions on different orders.
2. Access Entertainment KDS:
   ```
   GET /api/kds/entertainment
   ```
   OR navigate to `/kds/entertainment` in browser.

**Verify:**
- [ ] Both active sessions displayed
- [ ] Each session shows: item name, table/order number, time remaining
- [ ] Sessions sorted by expiry time (soonest first)
- [ ] Expired sessions highlighted or flagged
- [ ] Real-time countdown updates (via socket or polling)
- [ ] Completed/paid sessions removed from active view

---

### MNU-24: Socket entertainment:status-changed fires on status change
**Priority:** P2
**Prereqs:**
- Socket connected to location room
- Active entertainment session

**Steps:**
1. Listen for `entertainment:status-changed` (or `entertainment:session-update`) events.
2. Start a session.
3. Extend a session.
4. Complete a session.
5. Check captured events.

**Verify:**
- [ ] Event fires on session start
- [ ] Event fires on session extension
- [ ] Event fires on session completion/expiry
- [ ] Event payload includes `orderId`, `orderItemId`, `action`, and time info
- [ ] Entertainment KDS updates without page refresh
