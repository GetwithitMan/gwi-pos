# Feature: Purchase Orders & Receiving

> **Status: ACTIVE** — Built 2026-03-04.

## Summary
Full purchase order lifecycle: draft a PO against a vendor, submit it, receive inventory (partial or full), and auto-cascade ingredient costs through recipes and menu items. Works for food, liquor, beer, wine, and supplies — all tracked as `InventoryItem`. Ties into Reorder Suggestions ("Create PO" shortcut) and Invoices (auto-create invoice from a receipt for COGS).

---

## Workflow

```
Reorder Suggestions ──► New PO (draft)
                              │
                         Submit to vendor
                              │
                         Goods arrive
                              │
                        Receive PO ──────────────────────────────────────────────┐
                              │                                                   │
                    ┌─────────┴──────────┐                                        │
             Partial receive        Full receive                                  │
             (status: partially_received)  (status: received)                    │
                              │                                                   │
                       [Create Invoice]                                            │
                              │                                                   │
                        Post Invoice ─► Cost Cascade ─► Recipe Cost ─► Menu Cost │
                                                                                  │
                        InventoryItem.currentStock += receivedQty ◄───────────────┘
                        InventoryItemTransaction (type: 'purchase') written
```

---

## Schema

### VendorOrder (already in schema)
| Field | Type | Notes |
|-------|------|-------|
| `id` | String | CUID |
| `locationId` | String | |
| `vendorId` | String | FK → Vendor |
| `orderNumber` | String? | PO number (auto-generated or manual) |
| `status` | VendorOrderStatus | draft → sent → partially_received → received → cancelled |
| `orderDate` | DateTime | |
| `expectedDelivery` | DateTime? | |
| `receivedAt` | DateTime? | When fully received |
| `totalEstimated` | Decimal? | Sum of (qty × estimatedCost) |
| `totalActual` | Decimal? | Sum of (receivedQty × actualCost) |
| `notes` | String? | |
| `createdById` | String? | Employee who created it |
| `receivedById` | String? | Employee who received it |
| `linkedInvoiceId` | String? | Invoice created from this receipt |
| `deletedAt` | DateTime? | Soft delete |

### VendorOrderLineItem (already in schema)
| Field | Type | Notes |
|-------|------|-------|
| `inventoryItemId` | String | FK → InventoryItem (required) |
| `quantity` | Decimal | Ordered quantity |
| `unit` | String | "case", "lb", "bottle", "each", etc. |
| `estimatedCost` | Decimal? | Per purchase unit (e.g., per case) |
| `actualCost` | Decimal? | Actual per-unit cost at receiving |
| `receivedQty` | Decimal? | Running total received (accumulates on partial receives) |
| `notes` | String? | |

### VendorOrderStatus enum
`draft | sent | partially_received | received | cancelled`

> **Note:** `partially_received` may need to be added if not present in schema — check before building.

---

## Code Locations

| Purpose | Path |
|---------|------|
| List + Create API | `src/app/api/inventory/orders/route.ts` |
| Detail / Edit / Cancel API | `src/app/api/inventory/orders/[id]/route.ts` |
| Submit (draft→sent) | `src/app/api/inventory/orders/[id]/submit/route.ts` |
| Receive | `src/app/api/inventory/orders/[id]/receive/route.ts` |
| List UI | `src/app/(admin)/inventory/orders/page.tsx` |
| New PO UI | `src/app/(admin)/inventory/orders/new/page.tsx` |
| Detail + Receive UI | `src/app/(admin)/inventory/orders/[id]/page.tsx` |
| Nav | `src/components/inventory/InventoryNav.tsx` |
| Reorder "Create PO" | `src/app/(admin)/inventory/reorder/page.tsx` |

---

## API Design

### `GET /api/inventory/orders`
Returns paginated list of VendorOrders for the location.
- Query params: `locationId`, `employeeId`, `status` (filter), `vendorId` (filter), `limit`, `cursor`
- Returns: orders with vendor name, line item count, totals, status

### `POST /api/inventory/orders`
Create a new PO (status: `draft`).
- Body: `{ vendorId, orderNumber?, expectedDelivery?, notes?, lineItems: [{ inventoryItemId, quantity, unit, estimatedCost? }] }`
- Auto-calculates `totalEstimated`
- Permission: `INVENTORY_MANAGE`

### `GET /api/inventory/orders/[id]`
Returns full PO with line items, inventory item details (name, unit, currentStock), and vendor info.

### `PUT /api/inventory/orders/[id]`
Edit a draft PO (status must be `draft`).
- Body: `{ notes?, expectedDelivery?, lineItems? }` (replaces line items)

### `DELETE /api/inventory/orders/[id]`
Soft-delete (sets `deletedAt`). Only allowed on `draft` or `cancelled` status.

### `POST /api/inventory/orders/[id]/submit`
Mark PO as sent to vendor (draft → sent).

### `POST /api/inventory/orders/[id]/receive`
**The critical endpoint.** Receives inventory against a PO.

```json
{
  "employeeId": "...",
  "items": [
    {
      "lineItemId": "...",
      "receivedQty": 2,
      "unit": "case",
      "actualCost": 65.00
    }
  ],
  "notes": "Short 1 case of chicken",
  "createInvoice": true
}
```

**What it does (inside `db.$transaction`):**
1. For each received item:
   - Normalize `receivedQty` from order unit → storage unit using `unitsPerPurchase`
   - `InventoryItem.currentStock += normalizedQty`
   - Write `InventoryItemTransaction` (`type: 'purchase'`, `referenceType: 'vendor_order'`, `referenceId: orderId`)
   - Update `VendorOrderLineItem.receivedQty`
   - If `actualCost` provided: run `cascadeCostUpdate()` → updates recipes + menu costs
2. Recalculate PO status:
   - All lines fully received → `received`; else → `partially_received`
3. Update `VendorOrder.receivedById`, `receivedAt` (on full receive)
4. If `createInvoice: true`: create Invoice + InvoiceLineItems from received quantities (status: `draft`)

---

## Receiving + Unit Conversion

Orders are placed in purchase units (case, lb). Stock is tracked in storage units (oz, each).

```
receivedQty (cases) × item.unitsPerPurchase → qtyInStorageUnits → increment currentStock
```

Example:
- Ordered 2 cases of chicken
- `unitsPerPurchase = 240` (each = oz; 15lb case = 240 oz)
- Received 2 cases → currentStock += 480 oz

If purchase unit matches storage unit, multiplier = 1.

---

## Menu & Liquor Tie-In

All inventory — food, liquor, beer, wine — is `InventoryItem`. Receiving any item:
1. Increments `currentStock`
2. If `actualCost` provided → triggers `cascadeCostUpdate()`:
   - Updates `InventoryItem.costPerUnit`
   - Finds all recipes using this ingredient (`MenuItemRecipeIngredient`)
   - Recalculates recipe total cost
   - Updates `MenuItem.cost` and `foodCostPct`
3. **Liquor specifically:** same flow. Spirit items have `spiritCategoryId`, `pourSizeOz` — the cost cascade updates pour cost through linked recipes.

---

## Reorder Suggestions Integration

Reorder Suggestions page (`/inventory/reorder`) shows items below par/reorder point, grouped by vendor.

**"Create PO" flow:**
- User clicks "Create PO from suggestions" (whole vendor group)
- Pre-fills new PO with: `vendorId`, all suggested items, their `reorderQty` as quantity, `lastInvoiceCost` as estimated cost
- Navigates to `/inventory/orders/new?vendor=[id]&fromReorder=1` (pre-populated)

---

## Business Rules
1. Only `draft` POs can be edited or cancelled
2. `sent` and `partially_received` POs can be received against
3. Receiving is cumulative: multiple partial receives add to `receivedQty`
4. `receivedQty` cannot exceed `quantity` (ordered) — enforce on receive
5. Stock increment always uses storage-unit-normalized quantity
6. `actualCost` on receive is per-purchase-unit (same scale as `purchaseCost`)
7. Cost cascade is fire-and-forget on receive (non-blocking)
8. Auto-created invoice starts in `draft` status — user must post it to trigger invoice cascade

---

## Known Constraints
- No vendor EDI or email integration — PO is tracked internally only
- No barcode receiving (scan items in)
- No minimum order quantity (MOQ) enforcement per vendor
- Receiving does not block if `receivedQty` > `quantity` (warning only in UI)

---

## Dependencies
- **Inventory** — `InventoryItem`, `InventoryItemTransaction`, `cascadeCostUpdate`
- **Vendors** — `Vendor` model; vendor select on PO create
- **Reorder Suggestions** — pre-fill PO from suggested items
- **Invoices** — auto-create invoice from receipt for COGS
- **Menu** — cost cascade updates `MenuItem.cost` + `foodCostPct`
- **Roles** — `INVENTORY_MANAGE` permission required on all write endpoints

*Last updated: 2026-03-04*
