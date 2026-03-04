# SPEC-491: Purchase Orders & Receiving

> **Status: DONE** — Built 2026-03-04.
> **Feature doc:** `docs/features/purchase-orders.md`

## What Was Built
Full PO lifecycle: create → submit → receive (partial or full) → cost cascade → optional invoice creation.
Tied into Reorder Suggestions (Create PO shortcut) and the existing Invoice + cost cascade pipeline.
Works for all item types: food, liquor, beer, wine, supplies — all via unified InventoryItem model.

## Files Created
| File | Purpose |
|------|---------|
| `src/app/api/inventory/orders/route.ts` | GET list + POST create |
| `src/app/api/inventory/orders/[id]/route.ts` | GET detail + PUT edit + DELETE soft-delete |
| `src/app/api/inventory/orders/[id]/submit/route.ts` | POST draft→sent |
| `src/app/api/inventory/orders/[id]/receive/route.ts` | POST receive items + stock increment |
| `src/app/(admin)/inventory/orders/page.tsx` | PO list with status/vendor filters |
| `src/app/(admin)/inventory/orders/new/page.tsx` | Create PO (pre-fill from reorder) |
| `src/app/(admin)/inventory/orders/[id]/page.tsx` | PO detail + receive modal |

## Files Modified
| File | Change |
|------|--------|
| `src/components/inventory/InventoryNav.tsx` | Added "Orders" nav item |
| `src/app/(admin)/inventory/reorder/page.tsx` | Added "Create PO" button |
| `prisma/schema.prisma` | Added `partially_received` to VendorOrderStatus if missing |
| `scripts/nuc-pre-migrate.js` | DDL for `partially_received` enum value if missing |

## Key Decisions
- **Route namespace:** `/api/inventory/orders/` (not `/api/vendor-orders/`) — consistent with other inventory routes
- **No LiquorBottle model** — liquor is InventoryItem with `itemType='liquor'`; same flow as food
- **Unit normalization:** `receivedQty × item.unitsPerPurchase` → storage units before stock increment
- **Cost cascade:** fire-and-forget after receive; uses existing `cascadeCostUpdate()` from `cost-cascade.ts`
- **Invoice creation:** optional on receive; starts as `draft` — user posts it to trigger full invoice cascade
- **Idempotency:** receive endpoint uses `db.$transaction`; referenceType/referenceId on InventoryItemTransaction prevents double-counting
- **Permission:** `INVENTORY_MANAGE` on all write operations

## Receive Flow (inside db.$transaction)
1. Load PO + line items + inventory items (batch fetch)
2. For each `items[]` entry:
   a. `normalizedQty = receivedQty × item.unitsPerPurchase` (purchase→storage unit)
   b. `db.inventoryItem.update({ currentStock: { increment: normalizedQty } })`
   c. `db.inventoryItemTransaction.create({ type: 'purchase', referenceType: 'vendor_order', referenceId: orderId })`
   d. `db.vendorOrderLineItem.update({ receivedQty: { increment: receivedQty } })`
3. Recalculate PO status: all lines complete → `received`; else → `partially_received`
4. If `createInvoice`: `db.invoice.create` + `db.invoiceLineItem.createMany`
5. Fire-and-forget: `cascadeCostUpdate()` for each line where `actualCost` was provided

*Last updated: 2026-03-04*
