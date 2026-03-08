# Barcode Scanning — Feature Plan

## Problem Statement

GWI POS serves bars, restaurants, and venues that sell packaged goods (beer, wine, spirits, retail items, food products). The PAX A6650 has a built-in barcode scanner. We want staff to scan a product barcode and have the correct item added to the order at the correct price — whether it's a single can, a 6-pack, a 12-pack, or a case.

### The Multi-Pack Problem

Per GS1 standards, each packaging configuration gets its own unique UPC barcode:

| Package | UPC Example | Price |
|---------|------------|-------|
| Bud Light 12oz single | 018200001234 | $2.50 |
| Bud Light 6-pack | 018200006789 | $12.99 |
| Bud Light 12-pack | 018200012345 | $22.99 |
| Bud Light 24-pack case | 018200024680 | $39.99 |

**Reality check:** individual cans inside a 6-pack still show their own barcode (especially craft beer with plastic ring carriers). The scanner might read the single-can barcode when the staff intended to ring up the whole 6-pack.

This applies to all product types:
- **Beer:** cans, bottles, 6/12/24-packs, kegs
- **Wine:** 375ml, 750ml, 1.5L, cases of 6 or 12
- **Spirits:** 50ml mini, 200ml, 375ml, 750ml, 1L, 1.75L handle
- **Food/Retail:** individual items, multi-packs, bulk boxes

### No Public Database

No free public database reliably maps parent-child pack relationships (e.g., "this 6-pack UPC contains 6 of this single-can UPC"). The venue must manage these relationships themselves.

---

## What Exists Today

| Component | Status |
|-----------|--------|
| `MenuItem.sku` | Optional field, unique per location (`@@unique([locationId, sku])`) |
| `InventoryItem.sku` | Optional field, not unique |
| `GET /api/menu/search?sku=` | Working SKU lookup — exact match, returns MenuItem |
| `POST /api/orders/[id]/items` | Add items to order by `menuItemId` + `price` |
| PAX A6650 scanner hardware | Built-in, accessible via PAX SDK `ScannerManager` |
| PAX scanner integration code | **None** — not wired up yet |

**Current `sku` field limitation:** One barcode per item. Can't map multiple barcodes (single, 6-pack, 12-pack) to the same product concept.

---

## Architecture

### Core Concept: ItemBarcode Join Table

A new `ItemBarcode` model maps multiple barcodes to a single MenuItem, each with its own pack size, price, and label.

```
MenuItem: "Bud Light 12oz Can"
  ├── Barcode 018200001234 → packSize: 1,  label: "Single",  price: $2.50
  ├── Barcode 018200006789 → packSize: 6,  label: "6-Pack",  price: $12.99
  ├── Barcode 018200012345 → packSize: 12, label: "12-Pack", price: $22.99
  └── Barcode 018200024680 → packSize: 24, label: "Case",    price: $39.99

InventoryItem: "Bud Light 12oz (inventory)"
  └── linked to same barcodes for count/receiving lookup
```

### Schema Addition

```prisma
model ItemBarcode {
  id          String   @id @default(cuid())
  barcode     String                          // UPC/EAN/custom code
  label       String?                         // "Single", "6-Pack", "Case", "750ml"
  packSize    Int      @default(1)            // Units per scan (1, 6, 12, 24)
  price       Decimal?                        // Override price for this pack size (null = use base × packSize)

  // Link to one of: MenuItem or InventoryItem (or both)
  menuItemId      String?
  menuItem        MenuItem?      @relation(fields: [menuItemId], references: [id])
  inventoryItemId String?
  inventoryItem   InventoryItem? @relation(fields: [inventoryItemId], references: [id])

  locationId  String
  location    Location @relation(fields: [locationId], references: [id])

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  @@unique([locationId, barcode])  // One barcode per location
  @@index([barcode])               // Fast lookup
  @@index([menuItemId])
  @@index([inventoryItemId])
}
```

**Design decisions:**
- `barcode` is unique per location (same UPC can exist at different venues with different pricing)
- `price` is nullable — if null, the system uses `menuItem.price × packSize`
- `packSize` drives inventory deduction (scan a 6-pack → deduct 6 from stock)
- An ItemBarcode can link to a MenuItem (for ordering), an InventoryItem (for inventory ops), or both
- Keeps the existing `MenuItem.sku` field as-is for backwards compatibility (single-barcode simple case)

---

## Phases

### Phase 1 — Schema + API

**Goal:** Barcode data model + CRUD endpoints.

**Schema changes:**
- Add `ItemBarcode` model to `schema.prisma`
- Add relation fields to `MenuItem` and `InventoryItem`
- Migration + `nuc-pre-migrate.js` entry

**API endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/barcode/lookup?code=<barcode>` | Scan lookup — returns MenuItem + pack info. Primary endpoint for scan-to-add. |
| GET | `/api/barcode?menuItemId=<id>` | List all barcodes for a menu item |
| GET | `/api/barcode?inventoryItemId=<id>` | List all barcodes for an inventory item |
| POST | `/api/barcode` | Create a barcode mapping |
| PUT | `/api/barcode/[id]` | Update barcode (price, label, packSize) |
| DELETE | `/api/barcode/[id]` | Soft-delete a barcode mapping |

**Lookup response:**

```json
{
  "data": {
    "barcode": "018200006789",
    "label": "6-Pack",
    "packSize": 6,
    "price": 12.99,
    "menuItem": {
      "id": "clxyz...",
      "name": "Bud Light 12oz Can",
      "basePrice": 2.50,
      "categoryId": "...",
      "isAvailable": true
    },
    "inventoryItem": {
      "id": "clxyz...",
      "name": "Bud Light 12oz",
      "currentStock": 48
    }
  }
}
```

**Fallback:** If the scanned barcode isn't in `ItemBarcode`, fall back to `MenuItem.sku` exact match (backwards compat).

**Files touched:**
- `prisma/schema.prisma` — new model
- `scripts/nuc-pre-migrate.js` + `scripts/vercel-build.js` — migration
- `src/app/api/barcode/route.ts` — CRUD
- `src/app/api/barcode/[id]/route.ts` — update/delete
- `src/app/api/barcode/lookup/route.ts` — scan lookup

---

### Phase 2 — Admin UI (Barcode Management)

**Goal:** Venue staff can assign barcodes to items from the menu and inventory settings pages.

**Menu Item Edit (existing form):**
- New "Barcodes" section below price fields
- Table of assigned barcodes: barcode, label, pack size, price
- "Add Barcode" button → inline row or modal
- "Scan to Add" button — opens camera/scanner to capture barcode value
- Delete button per row

**Inventory Item Edit (existing form):**
- Same "Barcodes" section
- Links to the same `ItemBarcode` records
- Useful for receiving: scan a case barcode during PO receiving to auto-find the inventory item

**Bulk Import (optional, Phase 2b):**
- CSV upload: `barcode, menuItemName, packSize, price, label`
- Matches by menu item name (fuzzy) or existing SKU
- Preview + confirm before committing
- For venues setting up 100+ products at once

**Files touched:**
- `src/components/menu/ItemSettingsModal.tsx` — barcode section
- `src/app/(admin)/inventory/items/page.tsx` — barcode section on item edit
- New: `src/components/admin/BarcodeManager.tsx` — reusable barcode CRUD component
- Optional: `src/app/api/barcode/import/route.ts` — CSV bulk import

---

### Phase 3 — PAX A6650 Scanner Integration

**Goal:** Scan a barcode on the PAX → item added to current order.

**Android side (gwi-pax-a6650):**

1. **ScannerManager integration:**
   - PAX SDK provides `ScannerManager` for the built-in barcode reader
   - Register a global scan listener in `MainActivity` or a dedicated `ScannerService`
   - On scan result → emit to `HandheldOrderViewModel`

2. **Scan flow:**
   ```
   Physical scan → ScannerManager callback
     → ViewModel receives barcode string
     → POST to POS: /api/barcode/lookup?code=<barcode>
     → Response: menuItem + packSize + price
     → If single match: auto-add to current order
     → If no match: show "Unknown barcode" toast + option to assign it
     → If item is 86'd: show "Item unavailable" toast
   ```

3. **Pack size confirmation (optional setting):**
   - If a single-can barcode is scanned but the venue sells mostly 6-packs, prompt:
     "Bud Light — Single ($2.50) or 6-Pack ($12.99)?"
   - Configurable per venue: `settings.barcode.alwaysConfirmPackSize` (default: false)

4. **Quick-assign flow:**
   - Scan an unknown barcode → "Not found — assign to item?"
   - Opens a menu item picker → creates the `ItemBarcode` record on the spot
   - Staff don't need to go to admin settings for every new product

**POS API side:**

- `POST /api/orders/[id]/items` already accepts `menuItemId` + `price` + `quantity`
- Scanner adds item with: `menuItemId` from lookup, `price` from ItemBarcode (or base × pack), `quantity: 1`
- The `packSize` is reflected in the price, not quantity (a 6-pack is 1 order item at $12.99, not 6 items at $2.50)
- Inventory deduction uses `packSize` to deduct the correct number of units

**Files touched (Android):**
- New: `scanner/ScannerService.kt` — PAX ScannerManager wrapper
- `ui/order/HandheldOrderViewModel.kt` — handle scan events, call lookup API, add to order
- `ui/order/components/` — pack size confirmation dialog, unknown barcode dialog
- `ui/MainActivity.kt` — register scanner listener

**Files touched (POS):**
- `src/app/api/barcode/lookup/route.ts` — already built in Phase 1

---

### Phase 4 — Inventory Integration

**Goal:** Use barcode scanning during inventory operations.

**4a — Scan During Inventory Counts:**
- Count sheet page: scan a barcode → auto-find the inventory item → focus the count input field
- Saves time vs. scrolling through 200+ items to find the right one
- Works on PAX (scanner) and web (manual barcode entry field)

**4b — Scan During Receiving (PO):**
- Receiving page: scan a case barcode → auto-find the PO line item → enter quantity received
- `packSize` determines unit conversion (scan case barcode → `unitsReceived = packSize`)

**4c — Scan During Waste Logging:**
- Waste log page: scan barcode → auto-find item → enter waste quantity + reason

**4d — Case-Break Logic:**
- When selling a single unit and `currentStock` for singles = 0:
  - Check if a case-level inventory exists with stock > 0
  - Auto-break: deduct 1 case, add `packSize` singles to stock, then sell 1
  - Requires linking barcodes across pack sizes to the same InventoryItem
- This is the most complex part — defer to Phase 4 unless explicitly needed earlier

**Files touched:**
- `src/app/(admin)/inventory/counts/page.tsx` — barcode scan field
- `src/app/(admin)/inventory/orders/[id]/page.tsx` — receiving scan
- `src/app/(admin)/inventory/waste/page.tsx` — waste scan
- `src/lib/inventory-calculations.ts` — case-break deduction logic

---

### Phase 5 — Web POS Scanner Support

**Goal:** Support USB/Bluetooth barcode scanners on the web POS (NUC kiosk).

**How USB scanners work on web:**
- USB barcode scanners act as keyboard input — they "type" the barcode digits followed by Enter
- No special driver or API needed
- Detect rapid keystroke input (< 50ms between chars) as a scan vs. manual typing

**Implementation:**
- Global keypress listener on the POS order page
- Accumulate rapid keystrokes into a barcode buffer
- On Enter (or timeout), call `/api/barcode/lookup`
- Same add-to-order flow as PAX

**Files touched:**
- New: `src/hooks/useBarcodeScanner.ts` — keyboard-based scanner detection hook
- `src/app/(pos)/order/page.tsx` — wire up scanner hook
- Reuses same API endpoint as PAX

---

## Settings

New settings under `settings.barcode`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | false | Master toggle for barcode scanning |
| `alwaysConfirmPackSize` | boolean | false | Prompt for pack size on every scan |
| `allowQuickAssign` | boolean | true | Let staff assign unknown barcodes on the fly |
| `autoDeductInventory` | boolean | true | Deduct inventory by packSize on sale |
| `caseBreakEnabled` | boolean | false | Auto-break cases when singles run out |
| `scanSound` | boolean | true | Play confirmation beep on successful scan |

---

## Migration Path

1. **Existing `MenuItem.sku` field stays.** It continues to work for venues that only need one barcode per item. The lookup endpoint checks `ItemBarcode` first, then falls back to `MenuItem.sku`.

2. **Optional adoption.** Venues that don't sell packaged goods never need to touch this. The barcode management UI only appears if `settings.barcode.enabled` is true.

3. **No breaking changes.** All new tables/endpoints. Nothing existing is modified.

---

## Scope Estimate

| Phase | Complexity | Dependencies |
|-------|-----------|--------------|
| Phase 1 — Schema + API | Medium | None |
| Phase 2 — Admin UI | Medium | Phase 1 |
| Phase 3 — PAX Scanner | Medium-High | Phase 1, PAX SDK docs |
| Phase 4 — Inventory Integration | High (case-break) | Phase 1 |
| Phase 5 — Web POS Scanner | Low | Phase 1 |

**Recommended build order:** Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 4

Phase 5 (web scanner) is trivially simple once Phase 1 exists — USB scanners are just keyboard input. Phase 4 (case-break) is the most complex and can be deferred until a venue specifically needs it.

---

## Open Questions

1. **Should the PAX camera also work as a scanner?** The A6650 may have a dedicated laser scanner AND a camera. Camera-based scanning is slower but works for damaged barcodes. Decision: start with dedicated scanner only, add camera fallback later if needed.

2. **Print barcode labels?** Some venues print their own barcode stickers for items that don't have one (house-made food, repackaged items). Could integrate with the existing ESC/POS printer system. Defer unless requested.

3. **UPC database lookup?** When scanning an unknown barcode, should we auto-query UPCitemdb.com to pre-fill the product name? Nice-to-have but adds an external dependency. Defer.

4. **Android register app support?** The gwi-android-register doesn't have a built-in scanner, but some tablets have one. Same socket event pattern would work. Defer unless requested.

5. **Quantity multiplier vs. separate item?** When scanning a 6-pack, is it 1 order item at $12.99, or 6 items at $2.17 each? Recommendation: **1 item at the pack price.** This matches how customers think about it ("I bought a 6-pack") and simplifies the receipt. Inventory deduction still tracks 6 units internally.
