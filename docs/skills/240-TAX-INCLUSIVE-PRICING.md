# Skill 240: Tax-Inclusive Pricing

**Status:** DONE (fully implemented across 3 repos)
**Domain:** Settings / Orders / Reports / Receipts
**Date:** 2026-02-08 (initial), 2026-03-15 (full-stack), 2026-03-16 (report/receipt fixes)
**Dependencies:** 36 (Tax Calculations), 239 (Pricing Engine Refactor)

## Overview

Tax-inclusive pricing allows certain categories (liquor, food) to include tax in the displayed price rather than adding it on top. This is common for bar pricing where "$8 beer" means $8 out the door.

**Full-stack implementation:** gwi-pos server, gwi-android-register, gwi-pax-a6650. All three repos must ship together for inclusive locations.

## Core Concepts

### Two-Rate Tax Model
- **`exclusiveTaxRate`**: Added on top of price (`tax = price × rate`)
- **`inclusiveTaxRate`**: Backed out of price (`tax = price - price / (1 + rate)`)
- When only one type of rule exists, both rates default to the same value
- When `inclusiveTaxRate` is 0 or undefined, falls back to `taxRate` (backward compat)

### Order Total Formula
```
total = subtotal + taxFromExclusive - discount + tip
```
**Inclusive tax is NEVER added to total.** It's already embedded in the item prices.

### Item Stamping
- `isTaxInclusive` is stamped on each OrderItem at creation time
- Once stamped, it NEVER changes — survives splits, transfers, comps, voids
- Items with no `categoryType` (manual charges, open items) default to `false` (exclusive)

### Category-Based Rules
| Setting | Category Types |
|---------|---------------|
| `taxInclusiveLiquor` | `liquor`, `drinks` |
| `taxInclusiveFood` | `food`, `pizza`, `combos` |
| (always exclusive) | `entertainment`, `retail` |

### Order.inclusiveTaxRate Snapshot
- `Order.inclusiveTaxRate` (Decimal, nullable) is snapshotted at order creation
- Captures the location's inclusive tax rate at time of sale
- Survives setting changes mid-service — the rate that was active when the order was created is used for all subsequent recalculations
- Passed as 8th parameter to `calculateOrderTotals()` to override location settings
- Guards: if 0, treated as undefined (falls back to taxRate) to prevent phantom tax bugs

## Split Tax Calculation

`calculateSplitTax(inclusiveSubtotal, exclusiveSubtotal, taxRate, inclusiveTaxRate?)`:
- **Inclusive items**: `tax = price - (price / (1 + inclRate))` — tax backed out
- **Exclusive items**: `tax = price × exclRate` — tax added on top
- Both tax amounts rounded to 2 decimals for compliance
- `inclusiveTaxRate` defaults to `taxRate` when not provided (backward compat)

## Server Files (gwi-pos)

| File | Role |
|------|------|
| `src/lib/order-calculations.ts` | `calculateSplitTax()`, `calculateOrderTotals()`, `isItemTaxInclusive()`, `splitSubtotalsByTaxInclusion()` |
| `src/lib/item-calculations.ts` | `prepareItemData()` — stamps `isTaxInclusive` at item creation |
| `src/hooks/usePricing.ts` | Client-side tax split + dual pricing with inclusive support |
| `src/hooks/useOrderSettings.ts` | Exposes `taxInclusiveLiquor`/`taxInclusiveFood` from API |
| `src/app/api/orders/route.ts` | Order creation — stamps `isTaxInclusive`, snapshots `inclusiveTaxRate` |
| `src/app/api/orders/[id]/items/route.ts` | Item append — stamps `isTaxInclusive` |
| `src/app/api/orders/[id]/items/[itemId]/route.ts` | Item modify — preserves `isTaxInclusive` |
| `src/app/api/orders/[id]/items/[itemId]/discount/route.ts` | Item discount — uses `calculateOrderTotals()` |
| `src/app/api/orders/[id]/discount/route.ts` | Order discount — uses `calculateOrderTotals()` |
| `src/app/api/orders/[id]/apply-coupon/route.ts` | Coupon — uses `calculateOrderTotals()` |
| `src/app/api/orders/[id]/merge/route.ts` | Merge — uses `calculateOrderTotals()` |
| `src/app/api/orders/[id]/transfer-items/route.ts` | Transfer — uses `calculateOrderTotals()` |
| `src/app/api/orders/[id]/split-tickets/route.ts` | Split tickets — uses `calculateSplitTax()` per split |
| `src/app/api/orders/[id]/split-tickets/[splitId]/route.ts` | Split payment — uses `calculateSplitTax()` |
| `src/app/api/orders/[id]/pay/route.ts` | Payment — uses stored `taxFromInclusive`/`taxFromExclusive` for refunds |
| `src/lib/domain/split-order/item-split.ts` | Item split — uses `calculateSplitTax()` |
| `src/lib/domain/split-order/seat-split.ts` | Seat split — uses `calculateSplitTax()` |
| `src/lib/domain/split-order/table-split.ts` | Table split — uses `calculateSplitTax()` |
| `src/lib/domain/comp-void/comp-void-operations.ts` | Comp/void — recalculates with inclusive support |
| `src/app/api/online/checkout/route.ts` | Online checkout — splits items by category for tax |
| `src/app/api/settings/route.ts` | Derives `taxInclusiveLiquor`/`taxInclusiveFood` from TaxRule records |
| `src/app/api/bootstrap/route.ts` | Sends `inclusiveTaxRate` + inclusive flags to Android |
| `prisma/schema.prisma` | `Order.taxFromInclusive`, `Order.taxFromExclusive`, `Order.inclusiveTaxRate`, `OrderItem.isTaxInclusive` |

### Report Files
| File | Tax-Inclusive Handling |
|------|----------------------|
| `src/app/api/reports/daily/route.ts` | Reads stored `taxFromInclusive`/`taxFromExclusive`; backs out inclusive tax from category breakdowns using `inclusive_gross` SQL column |
| `src/app/api/reports/employee-shift/route.ts` | Tracks `totalTaxFromInclusive`/`totalTaxFromExclusive` separately; computes `preTaxGrossSales = adjustedGrossSales - totalTaxFromInclusive` |
| `src/app/api/reports/order-history/route.ts` | Uses stored `taxFromInclusive`/`taxFromExclusive` (not recomputed) |
| `src/app/api/reports/sales/route.ts` | Tax breakdown from stored values |

### Receipt Files
| File | Tax-Inclusive Handling |
|------|----------------------|
| `src/components/receipt/Receipt.tsx` | Shows "Tax (included):" for all-inclusive orders; passes `taxFromInclusive`/`taxFromExclusive` in ReceiptData |
| `src/lib/domain/payment/receipt-builder.ts` | Threads `taxFromInclusive`/`taxFromExclusive` from order to receipt data |
| `src/lib/domain/payment/types.ts` | `ReceiptData` includes `taxFromInclusive?` and `taxFromExclusive?` |
| `src/lib/escpos/receipt-commands.ts` | ESC/POS receipt shows "Tax (included)" label |

## Android Files

### Register (gwi-android-register)
| File | Role |
|------|------|
| `domain/TaxSplitHelper.kt` | Pure function — identical math to server `calculateSplitTax()` |
| `domain/TaxInclusionResolver.kt` | Derives `isTaxInclusive` from category type + flags |
| `domain/OrderState.kt` | `isTaxInclusive` on `OrderLineItem`; `inclusiveTaxRate`/`taxInclusiveLiquor`/`taxInclusiveFood` on state; `recomputeTotals()` uses `TaxSplitHelper` |
| `domain/OrderEventPayload.kt` | `isTaxInclusive` on `ItemAdded` payload |
| `domain/OrderReducer.kt` | Copies `isTaxInclusive` from payload (no menu lookups) |
| `domain/usecase/AddItemUseCase.kt` | Resolves `isTaxInclusive` at creation via `TaxInclusionResolver` |
| `sync/BootstrapWorker.kt` | Stores `inclusiveTaxRate`, `taxInclusiveLiquor`, `taxInclusiveFood` in SyncMeta; triggers projection rebuild when flags change |
| `checkout/engine/DefaultCheckoutEvaluationEngine.kt` | Split tax using `TaxSplitHelper` for Steps 6+7 |
| `data/local/entity/CachedOrderItemEntity.kt` | `isTaxInclusive` column (DB v49) |
| `ui/pos/components/OrderTotalsSection.kt` | Tax label: "Tax (included)" / "Tax" / "Tax (X%)" |
| `printer/ReceiptFormatter.kt` | Receipt tax label |

### PAX A6650 (gwi-pax-a6650)
Same ~17 files mirrored. DB v47→v48.

## Invariants

1. **`isTaxInclusive` locked at creation** — never re-resolved after stamping
2. **Items with no category → exclusive** — manual charges default to `false`
3. **`calculateSplitTax()` no-op for exclusive-only** — `inclusiveSubtotal = 0` → `taxFromInclusive = 0`
4. **Every DB write of `taxTotal` must also write `taxFromInclusive` + `taxFromExclusive`**
5. **`total = subtotal + taxFromExclusive - discount + tip`** — inclusive tax NOT added to total
6. **`taxInclusiveLiquor`/`taxInclusiveFood` derived from TaxRule records** — not stored as user settings
7. **Changing rules does NOT retroactively update existing items** — only new items get new treatment
8. **`inclusiveTaxRate = undefined` falls back to `taxRate`** — backward compat
9. **Android `TaxSplitHelper` must match server `calculateSplitTax`** — golden parity tests
10. **`Order.inclusiveTaxRate` snapshots the rate at order creation** — survives setting changes
11. **Reports must use stored `taxFromInclusive`/`taxFromExclusive`** — never recompute from rate
12. **Receipt shows "Tax (included):" when all items are inclusive** — "Tax:" for mixed/exclusive

## Bugs Fixed

| Bug | Date | Commit | Details |
|-----|------|--------|---------|
| Server: 12+ call sites using single-rate tax math | 2026-03-15 | `f5c8e5b7` | Split tickets, pay route, reports, online checkout all fixed |
| Employee-shift report double-counting inclusive tax in grossSales | 2026-03-16 | `f9b1a83c` | `preTaxGrossSales = adjustedGrossSales - totalTaxFromInclusive` |
| Daily report category breakdown not backing out inclusive tax | 2026-03-16 | `f9b1a83c` | Added `inclusive_gross` SQL column, JS backs out tax per category |
| Receipt.tsx not showing "Tax (included):" label | 2026-03-16 | `f9b1a83c` | Threaded `taxFromInclusive`/`taxFromExclusive` through receipt pipeline |
| Phantom tax bug when `inclusiveTaxRate=0` | 2026-03-15 | `f5c8e5b7` | Guard treats 0 as undefined, falls back to taxRate |

## UI

- "Tax (included):" shown on receipt when all items are inclusive
- "Tax:" shown when mixed inclusive/exclusive
- "Tax (X%):" shown when all items are exclusive
- Android order totals section mirrors these labels
- "Included in item prices" note in expanded total breakdown on web POS

## Related Docs
- `docs/features/tax-rules.md` — full feature doc
- `docs/skills/SPEC-36-TAX-MANAGEMENT.md` — aspirational spec
- `docs/planning/AUDIT_REGRESSION.md` — TAX1-TAX9 invariants
