# Feature: Barcode Scanning

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Barcode Scanning → read every listed dependency doc.

## Summary
Barcode scanning lets staff scan product barcodes (UPC/EAN) to look up menu items and add them to orders. Supports multi-pack pricing (single, 6-pack, 12-pack, case) via an `ItemBarcode` join table that maps multiple barcodes to a single MenuItem with per-pack pricing. Works on PAX A6650 (built-in scanner) and Android register.

## Status
`Phase 1 — Schema + API + Admin UI`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Schema, API, admin UI, web scanner hook | Active |
| `gwi-pax-a6650` | PAX hardware scanner integration | Planned (Phase 3) |
| `gwi-android-register` | Tablet scanner support | Planned (Phase 5) |
| `gwi-cfd` | N/A | None |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `prisma/schema.prisma` | `ItemBarcode` model |
| `src/hooks/useBarcodeScanner.ts` | USB/keyboard scanner detection hook |
| `src/app/api/barcode/route.ts` | Barcode CRUD (GET list, POST create) — *planned* |
| `src/app/api/barcode/[id]/route.ts` | Barcode update/delete — *planned* |
| `src/app/api/barcode/lookup/route.ts` | Scan lookup endpoint — *planned* |
| `src/components/admin/BarcodeManager.tsx` | Reusable barcode CRUD component — *planned* |

---

## Key Design Decisions

1. **ItemBarcode join table** — Multiple barcodes per MenuItem, each with its own `packSize`, `price`, and `label`. Solves the multi-pack problem (same product sold as single, 6-pack, case).

2. **Pack-size pricing** — `price` on ItemBarcode overrides base price. If null, uses `menuItem.price × packSize`.

3. **SKU fallback** — Lookup checks `ItemBarcode` first, then falls back to `MenuItem.sku` for backwards compatibility.

4. **1 item at pack price** — A 6-pack is 1 order item at $12.99, not 6 items at $2.17. Inventory deduction uses `packSize` internally.

5. **Web scanner detection** — USB scanners type as keyboard input. Distinguished from human typing by keystroke speed (< 50ms gap, 12+ chars).

---

## Cross-Feature Dependencies

| Feature | Relationship |
|---------|-------------|
| Menu | ItemBarcode links to MenuItem — barcode lookup returns menu item for ordering |
| Inventory | ItemBarcode links to InventoryItem — packSize drives deduction quantity |
| Orders | Scan-to-add uses existing `POST /api/orders/[id]/items` |
| Settings | `settings.barcode.*` controls feature toggles |
| Purchase Orders | Scan during receiving to auto-find PO line items (Phase 4) |

---

## Known Constraints

- Barcode is unique per location (`@@unique([locationId, barcode])`) — same UPC can have different pricing at different venues
- No external UPC database dependency — venues manage their own barcode mappings
- Web scanner hook does NOT skip input fields — speed threshold differentiates scanner from human typing
- `MenuItem.sku` field preserved for backwards compatibility (single-barcode simple case)

---

## Detailed Plan
See `docs/planning/BARCODE-SCANNING-PLAN.md` for full phased implementation plan.
