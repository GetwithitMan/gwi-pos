# Order API Contract

**Last Updated:** February 7, 2026
**Fix:** FIX-005 - Eliminate PUT vs POST Append Confusion

## Problem Statement

Before FIX-005, the order API had mixed semantics that caused race conditions:

- Some flows used `PUT /api/orders/[id]` with full items array (replace ALL items)
- Some flows used `POST /api/orders/[id]/items` (append items atomically)
- Mixed usage caused:
  - Race conditions when multiple terminals update same order
  - Lost items when PUT overwrites concurrent changes
  - Confusion about which endpoint to use

## Solution: Clear API Boundaries

**New Standard:**
- `PUT /api/orders/[id]` = Update order **METADATA only** (table, orderType, customer, notes)
- `POST /api/orders/[id]/items` = Add/update items (append or modify existing)
- **NEVER send items in PUT requests**

---

## Endpoints and Usage

### POST /api/orders
**Purpose:** Create new order
**Body:**
```json
{
  "employeeId": "emp-123",
  "locationId": "loc-456",
  "orderType": "dine_in",
  "tableId": "table-789",
  "items": [...]
}
```
**Use:** Initial order creation only

---

### GET /api/orders/[id]
**Purpose:** Fetch complete order
**Response:**
```json
{
  "id": "order-123",
  "orderType": "dine_in",
  "tableId": "table-789",
  "items": [...],
  "subtotal": 25.50,
  "taxTotal": 2.04,
  "total": 27.54
}
```
**Use:** Reload order data

---

### PUT /api/orders/[id]
**Purpose:** Update order **METADATA only**
**Body:**
```json
{
  "tableId": "table-new",
  "orderTypeId": "ot-456",
  "customerId": "cust-789",
  "tabName": "John's Tab",
  "guestCount": 4,
  "notes": "Special instructions",
  "status": "open"
}
```
**NEVER include:** `items` array
**Use:** Change table, order type, customer, status, notes

**Error if items included:**
```json
{
  "error": "DEPRECATED: Cannot update items via PUT. Use POST /api/orders/[id]/items instead.",
  "code": "PUT_WITH_ITEMS_DEPRECATED",
  "hint": "Switch to POST /api/orders/[id]/items for item updates to prevent race conditions",
  "migration": {
    "old": "PUT /api/orders/[id] with { items: [...] }",
    "new": "POST /api/orders/[id]/items with { items: [...] }"
  }
}
```

---

### POST /api/orders/[id]/items
**Purpose:** Add or update items atomically
**Body:**
```json
{
  "items": [
    {
      "menuItemId": "item-123",
      "name": "Burger",
      "price": 12.99,
      "quantity": 1,
      "modifiers": [
        {
          "modifierId": "mod-456",
          "name": "Extra Cheese",
          "price": 1.50
        }
      ],
      "specialNotes": "No pickles"
    }
  ]
}
```
**Response:**
```json
{
  "id": "order-123",
  "items": [...],  // All items (existing + new)
  "addedItems": [  // Newly added items
    {
      "id": "oi-789",
      "name": "Burger",
      "correlationId": "client-id-123"  // Optional client-provided ID
    }
  ],
  "subtotal": 38.49,
  "taxTotal": 3.08,
  "total": 41.57
}
```
**Use:** Add new items, update existing items
**Safe for:** Concurrent updates (no race conditions)

**Key Features:**
- Atomic transaction (all-or-nothing)
- Totals recalculated from current DB state
- Safe for multiple terminals adding items simultaneously
- Optional `correlationId` for client-side matching

---

## Migration Guide

### OLD Pattern (Race Condition Risk):
```typescript
// ❌ DANGEROUS - Can cause lost items
await fetch(`/api/orders/${orderId}`, {
  method: 'PUT',
  body: JSON.stringify({
    tableId: "table-456",
    items: [...allItems]  // Replaces everything!
  })
})
```

**Problem:** If Terminal A and Terminal B both read the order, add different items, and PUT simultaneously, one terminal's items will be lost.

---

### NEW Pattern (Safe):
```typescript
// ✅ SAFE - Separate metadata from items

// 1. Update metadata via PUT
await fetch(`/api/orders/${orderId}`, {
  method: 'PUT',
  body: JSON.stringify({
    tableId: "table-456"
    // NO items
  })
})

// 2. Add/update items via POST append
if (newItems.length > 0) {
  await fetch(`/api/orders/${orderId}/items`, {
    method: 'POST',
    body: JSON.stringify({
      items: newItems
    })
  })
}
```

---

## Helper Functions

Use the centralized helper functions in `/src/lib/api/order-api.ts`:

### Update Metadata Only
```typescript
import { updateOrderMetadata } from '@/lib/api/order-api'

await updateOrderMetadata('order-123', {
  tableId: 'table-456',
  guestCount: 4
})
```

### Add/Update Items
```typescript
import { appendOrderItems } from '@/lib/api/order-api'

await appendOrderItems('order-123', [
  {
    menuItemId: 'item-1',
    name: 'Burger',
    price: 12.99,
    quantity: 1,
    modifiers: []
  }
])
```

### Update Both (Convenience)
```typescript
import { updateOrderComplete } from '@/lib/api/order-api'

await updateOrderComplete('order-123', {
  metadata: { tableId: 'table-456' },
  items: [{ menuItemId: 'item-1', name: 'Burger', price: 12.99, quantity: 1, modifiers: [] }]
})
```

---

## Special Operations

These endpoints should use their dedicated routes (NOT PUT with items):

| Operation | Endpoint | Method |
|-----------|----------|--------|
| Apply Discount | `/api/orders/[id]/discount` | POST |
| Comp/Void Items | `/api/orders/[id]/comp-void` | POST |
| Transfer Items | `/api/orders/[id]/transfer-items` | POST |
| Split Order | `/api/orders/[id]/split` | POST |
| Send to Kitchen | `/api/orders/[id]/send` | POST |
| Process Payment | `/api/orders/[id]/pay` | POST |

---

## Breaking Changes

### What Changed
- `PUT /api/orders/[id]` now **rejects** requests with `items` array
- Returns `400 Bad Request` with clear migration instructions
- All client code must use `POST /api/orders/[id]/items` for item updates

### Backward Compatibility
- `POST /api/orders` (create) unchanged
- `GET /api/orders/[id]` (fetch) unchanged
- `PUT /api/orders/[id]` metadata updates unchanged
- Only affected: PUT requests that included `items`

### Migration Checklist
- [ ] Update all `PUT /api/orders/[id]` calls to exclude `items`
- [ ] Use `POST /api/orders/[id]/items` for item additions
- [ ] Replace direct fetch calls with helper functions from `order-api.ts`
- [ ] Test concurrent item additions on same order
- [ ] Verify no race conditions in multi-terminal scenarios

---

## Testing

### Race Condition Test
1. Open order in 2 terminals
2. Terminal 1: Add item A
3. Terminal 2: Add item B (simultaneously)
4. **Expected:** Both items appear (no loss) ✅
5. **Old behavior:** One item lost ❌

### Metadata Update Test
1. Open order
2. Change table via PUT metadata
3. **Expected:** Items unchanged ✅

### Backward Compatibility Test
1. Try old PUT with items
2. **Expected:** 400 error with clear migration message ✅

---

## FAQ

### Q: Why can't I use PUT for items anymore?
**A:** PUT semantics mean "replace entire resource". When multiple terminals try to replace items simultaneously, they overwrite each other, causing data loss. POST append is atomic and safe.

### Q: Will my old code break?
**A:** Yes, if you're sending `items` in PUT requests. The endpoint will return a 400 error with clear instructions. Update to use POST for items.

### Q: What if I need to update one field on an item?
**A:** Use `PUT /api/orders/[id]/items/[itemId]` to update a single item's fields (quantity, notes, hold status, etc.). This is still supported.

### Q: Can I still replace ALL items?
**A:** No. The old "delete all and recreate" pattern is deprecated. Use individual item updates or delete + POST new items separately.

### Q: What about performance?
**A:** POST append is faster! It's a single transaction vs the old delete-all-then-recreate pattern.

---

## Related Documentation
- `/src/lib/api/order-api.ts` - Helper functions
- `/src/app/api/orders/[id]/route.ts` - PUT endpoint implementation
- `/src/app/api/orders/[id]/items/route.ts` - POST append implementation
- `FIX-005-SUMMARY.md` - Implementation summary

---

**Questions?** See CLAUDE.md "Order API Conventions" section or check the skill docs.
