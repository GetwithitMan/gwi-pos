# Feature: Tax Rules

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Configurable tax rules per location with support for tax-inclusive pricing, multiple rates, item-level exemptions, compound taxes, and category-based application. Tax rates stored as decimals (0.0825 = 8.25%). Supports mixed inclusive/exclusive items in a single order with separate tracking of `taxFromInclusive` and `taxFromExclusive`.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, tax calculations, order integration, reports | Full |
| `gwi-android-register` | Tax display on orders | Partial |
| `gwi-cfd` | Tax display on customer screen | Partial |
| `gwi-backoffice` | Tax reporting sync | Partial |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | Settings → Tax Rules | Managers (`SETTINGS_TAX`) |
| POS Web | Order totals display (tax line) | All staff |
| Reports | Sales reports (tax breakdown) | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/api/tax-utils.ts` | `computeTaxRuleRate()` — sums active TaxRule rates; `syncTaxRateToSettings()` — persists effective rate to `Location.settings.tax.defaultRate` |
| `src/app/api/tax-rules/route.ts` | GET list (requires `requestingEmployeeId` query param), POST create (requires `requestingEmployeeId` in body) |
| `src/app/api/tax-rules/[id]/route.ts` | GET/PUT/DELETE tax rule (no permission gate on [id] routes) |
| `src/app/(admin)/tax-rules/page.tsx` | Admin UI — list, add, edit, toggle active. Uses `useAdminCRUD` with `requestingEmployeeId` passed for auth |
| `src/hooks/useAdminCRUD.ts` | Shared CRUD hook. Accepts `requestingEmployeeId` in config; appends to GET query params. Use ref-stabilized `extractItems` to prevent render loops |
| `src/lib/order-calculations.ts` | `calculateOrderTotals()`, `calculateSplitTax()`, `isItemTaxInclusive()`, `getEffectiveTaxRate()` |
| `src/lib/pricing.ts` | `roundToCents()`, `calculateCardPrice()` |
| `src/hooks/usePricing.ts` | Client-side tax calculation hook |
| `src/app/api/settings/route.ts` | Derives `taxInclusiveLiquor`/`taxInclusiveFood` from active rules |
| `src/app/api/orders/[id]/items/route.ts` | Stamps `isTaxInclusive` on OrderItem at creation |
| `src/app/api/reports/sales/route.ts` | Tax breakdown in sales reports |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/tax-rules` | `SETTINGS_TAX` | List all rules. Requires `locationId` + `requestingEmployeeId` as query params |
| `POST` | `/api/tax-rules` | `SETTINGS_TAX` | Create rule. Requires `locationId` + `requestingEmployeeId` in request body |
| `GET` | `/api/tax-rules/[id]` | none | Get single tax rule (no permission gate) |
| `PUT` | `/api/tax-rules/[id]` | none | Update tax rule (no permission gate) |
| `DELETE` | `/api/tax-rules/[id]` | none | Soft delete (no permission gate) |

---

## Socket Events

None — tax rule changes take effect on next order creation via `getSettings()`.

---

## Data Model

```
TaxRule {
  id              String
  locationId      String
  name            String            // "State Tax", "City Tax", "Alcohol Tax"
  rate            Decimal           // 0.0825 = 8.25% (stored as decimal)
  appliesTo       String            // "all" | "category" | "item"
  categoryIds     Json?             // if appliesTo is 'category'
  itemIds         Json?             // if appliesTo is 'item'
  isInclusive     Boolean           // price includes this tax
  priority        Int               // ordering for stacking
  isCompounded    Boolean           // calculate on subtotal + previous taxes
  isActive        Boolean
  deletedAt       DateTime?
}

MenuItem (tax fields) {
  taxRate         Decimal?          // override location default (null = use default)
  isTaxExempt     Boolean           // item-level exemption
}

OrderItem (tax snapshot) {
  isTaxInclusive  Boolean           // stamped at creation
  categoryType    String?           // category type snapshot
}

Order (tax totals) {
  taxTotal         Decimal
  taxFromInclusive Decimal?         // tax backed out of inclusive items
  taxFromExclusive Decimal?         // tax added on top of exclusive items
}
```

---

## Business Logic

### Tax Calculation Flow
1. At order creation, each item stamped with `isTaxInclusive` based on category type
2. `splitSubtotalsByTaxInclusion()` separates items into inclusive vs exclusive subtotals
3. `calculateSplitTax()` computes separate tax amounts:
   - **Inclusive**: `tax = price - (price / (1 + rate))` — tax backed out
   - **Exclusive**: `tax = price × rate` — tax added on top
4. Both rounded to 2 decimals for compliance
5. Price rounding applied as final step

### Tax-Inclusive Category Mapping
| Setting | Category Types |
|---------|---------------|
| `taxInclusiveLiquor` | `liquor`, `drinks` |
| `taxInclusiveFood` | `food`, `pizza`, `combos` |

### Effective Tax Rate Resolution
```
getEffectiveTaxRate(itemTaxRate, itemTaxExempt, locationTaxRate):
  if itemTaxExempt → return 0
  if itemTaxRate not null → return itemTaxRate
  return locationTaxRate
```

### Settings Sync (Order Calculation Source of Truth)
`Location.settings.tax.defaultRate` is the value all `calculateOrderTotals()` calls read. It must stay in sync with TaxRule records:
- **POST/PUT/DELETE** on any TaxRule → `syncTaxRateToSettings(locationId)` updates `settings.tax.defaultRate` automatically
- **`getLocationSettings()`** fallback: if `defaultRate` is missing, queries TaxRules live and returns enriched settings
- **`nuc-pre-migrate.js`**: one-time backfill sets `defaultRate` for all locations on next deploy
- **Android bootstrap**: reads `taxRate` from `settings.tax.defaultRate` via `SyncMeta` — works correctly because of the above sync

### API Rate Conversion
- Input (from UI): percentage (8.25) → stored as decimal (0.0825): `rate / 100`
- Output (to UI): decimal (0.0825) → displayed as percentage (8.25): `rate * 100`

### Edge Cases & Business Rules
- Tax-inclusive pricing: price displayed to customer includes tax
- Multiple tax rules can apply (ordered by `priority`)
- Compound taxes (`isCompounded: true`): calculated on subtotal + previous taxes
- Item-level tax exempt: `MenuItem.isTaxExempt = true` → rate returns 0
- Item-level tax override: `MenuItem.taxRate` overrides location default
- Mixed orders: some items inclusive, some exclusive — tracked separately
- All tax amounts use `roundToCents()` for compliance (2 decimal precision)
- Business day boundaries used for tax reports (not calendar midnight)

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Payments | Tax applied at checkout affects payment total |
| Orders | Tax calculated on subtotal per item |
| Reports | Tax collected reporting with business day boundaries |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Settings | Tax configuration stored per location |
| Menu | Per-item tax rate override and exemption |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — tax total affects payment amount
- [ ] **Reports** — tax breakdown in sales reports uses `taxFromInclusive`/`taxFromExclusive`
- [ ] **Orders** — `isTaxInclusive` stamped at item creation time
- [ ] **Dual Pricing** — tax calculated on cash price, not card price

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View tax rules | `settings.tax` | High |
| Create/Edit/Delete rules | `settings.tax` | High |
| Tax exempt override | `manager.tax_exempt` | Critical |

---

## Known Constraints & Limits
- Tax rate stored with 4-place decimal precision
- All amounts rounded to 2 decimals at each calculation step
- No order-level tax exemption UI yet (planned in Skill 36)
- Tax holidays not yet implemented (planned in Skill 36)
- Exemption certificates not yet implemented

---

## Android-Specific Notes
- Tax displayed in order totals
- Tax-inclusive items show price with tax already included

---

## Related Docs
- **Spec:** `docs/skills/SPEC-36-TAX-MANAGEMENT.md`
- **Tax-inclusive spec:** `docs/skills/240-TAX-INCLUSIVE-PRICING.md`
- **Dual pricing:** `docs/guides/PAYMENTS-RULES.md` + `docs/skills/SPEC-31-DUAL-PRICING.md`
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Tax Rules row

---

## Related Bugs Fixed

See `docs/skills/479-TAX-RULES-PAGE-BUG-FIXES.md` for full details on:
- `requestingEmployeeId` missing from GET/POST → 401 errors (fixed)
- Service worker v1 intercepting `/api/*` calls → `TypeError: Failed to fetch` (fixed)
- `useAdminCRUD` infinite render loop via unstable `parseResponse` ref (fixed)
- `useAuthenticationGuard` Zustand hydration race condition (fixed)

---

*Last updated: 2026-03-03*
