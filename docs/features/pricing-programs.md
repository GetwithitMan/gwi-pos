# Feature: Pricing Programs

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

Pricing Programs replaces the legacy dual-pricing toggle with a fully configurable six-model payment cost strategy. The six models are: `none`, `cash_discount`, `surcharge`, `flat_rate`, `interchange_plus`, and `tiered`. Customer-facing models (`cash_discount` and `surcharge`) change the amount a customer pays based on their payment method. Merchant-absorbed models (`flat_rate`, `interchange_plus`, `tiered`) leave the customer price unchanged and are used for P&L cost tracking only. The active program is stored as a JSON blob in `Location.settings` (no separate Prisma model), configured from Mission Control, and cached on the client for 5 minutes. The admin menu builder auto-displays calculated card prices across all item-price inputs when a customer-facing program is active.

## Status

`Active`

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Core pricing logic, hooks, payment modal, receipt rendering, ESC/POS print | Full |
| `gwi-android-register` | Dual pricing cash/card price display in payment flow | Partial |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | `PricingProgramCard` — full configuration UI | Full |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web (Admin) | `/settings` | Managers (read-only display) |
| POS Web | Payment modal (checkout) | All staff (surcharge line shown automatically) |
| Mission Control | Locations → [venue] → Pricing Program card | Owner / admin only |

---

## Code Locations

### gwi-pos

| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/settings.ts` | `PricingProgram` interface, `DEFAULT_PRICING_PROGRAM`, `getPricingProgram()` helper, `effectivePricingProgram` alias |
| `src/lib/pricing.ts` | Pure calculation functions: `calculateSurcharge()`, `calculateSurchargeTotal()`, `calculateFlatRateCost()`, `calculateInterchangePlusCost()`, `calculateTieredCost()`, `applyPricingProgram()`, `isSurchargeLegal()` |
| `src/hooks/usePricing.ts` | React hook — computes cash + card totals, exposes `surchargeAmount` and `pricingProgram` |
| `src/hooks/useOrderSettings.ts` | Fetches location settings (5-min client cache), returns `pricingProgram` field |
| `src/components/payment/PaymentModal.tsx` | Renders surcharge line item + disclosure text when model is `surcharge` and payment method is not cash |
| `src/components/receipt/Receipt.tsx` | Renders `surchargeAmount`, `surchargePercent`, `surchargeDisclosure` props on the on-screen receipt |
| `src/lib/print-factory.ts` | ESC/POS receipt builder — adds `CC Surcharge (X%): $Y` line and optional disclosure footer |
| `src/lib/escpos/shift-closeout-receipt.ts` | Adds `Surcharges Collected: $X` to shift closeout printout via `surchargeTotal` param |
| `src/app/(admin)/settings/page.tsx` | Read-only display of the active pricing program (model + key parameters) |

### gwi-mission-control

| File | Purpose |
|------|---------|
| `gwi-mission-control/src/components/admin/PricingProgramCard.tsx` | Full edit UI (six model pills, per-model fields, live example calculations, compliance warning) |
| `gwi-mission-control/src/app/dashboard/locations/[id]/page.tsx` | Mounts `PricingProgramCard` in location detail view |

---

## API Endpoints

Pricing program configuration is saved via the Mission Control admin API, not a dedicated POS route.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `PUT` | `/api/admin/locations/[id]` | Mission Control admin | Saves `settings.pricingProgram` as part of location settings |
| `GET` | `/api/location` (or equivalent) | Employee PIN | Returns location settings including `pricingProgram`; cached 5 min on client |

---

## Socket Events

Pricing program changes do not emit dedicated socket events. The `useOrderSettings` hook re-fetches on the 5-minute TTL. A page refresh will always pick up the latest configuration.

---

## Data Model

The pricing program is stored as a JSON blob in the existing `Location.settings` field. No new Prisma model was added.

```typescript
// Stored at Location.settings.pricingProgram
interface PricingProgram {
  model: 'cash_discount' | 'surcharge' | 'flat_rate' | 'interchange_plus' | 'tiered' | 'none'
  enabled: boolean

  // cash_discount
  cashDiscountPercent?: number       // 0–10%
  applyToCredit?: boolean
  applyToDebit?: boolean
  showSavingsMessage?: boolean

  // surcharge
  surchargePercent?: number          // 0–3% (Visa/MC cap enforced)
  surchargeApplyToCredit?: boolean
  surchargeApplyToDebit?: boolean    // defaults false (most states prohibit)
  surchargeDisclosure?: string       // shown on receipt / checkout

  // flat_rate
  flatRatePercent?: number
  flatRatePerTxn?: number

  // interchange_plus
  markupPercent?: number
  markupPerTxn?: number

  // tiered
  qualifiedRate?: number
  midQualifiedRate?: number
  nonQualifiedRate?: number
  tieredPerTxn?: number

  // state compliance
  venueState?: string
}
```

The `getPricingProgram(settings)` helper reads `settings.pricingProgram` first. If not present it falls back to the legacy `settings.dualPricing` field for backward compatibility with venues configured before this feature was built.

---

## Business Logic

### Settings Storage and Retrieval

`useOrderSettings()` fetches location settings and caches them on the client for 5 minutes. All pricing code must call `getPricingProgram(settings)` — never read `dualPricing` or `pricingProgram` directly. Precedence order: `pricingProgram.enabled` > `dualPricing.enabled` > `none`.

### Pricing Calculation

All math lives in `src/lib/pricing.ts`. Key functions:

- **`calculateSurcharge(basePrice, pct)`** — integer-cent arithmetic: `Math.round(base * pct / 100 * 100) / 100`.
- **`applyPricingProgram(basePrice, program, paymentMethod)`** — strategy router. Returns a `PricingResult` with `finalPrice`, `surchargeAmount`, and `merchantCost`.
  - `cash_discount` — raises the card price; cash price is unchanged.
  - `surcharge` — adds surcharge on top of cash price for card payments (credit by default; debit off by default).
  - `flat_rate`, `interchange_plus`, `tiered` — populate `merchantCost` only; `finalPrice === basePrice` (no customer-facing change).
- **`isSurchargeLegal(state)`** — returns `false` for CT, MA, PR.

### Six Models

| Model | Customer Sees | Use Case |
|-------|--------------|----------|
| `none` | Standard price | No program active |
| `cash_discount` | Lower price for cash, standard for card | Advertise cash savings |
| `surcharge` | Standard price + surcharge for card | Pass card fee to customer |
| `flat_rate` | Standard price (no change) | P&L cost tracking only |
| `interchange_plus` | Standard price (no change) | B2B / P&L cost tracking |
| `tiered` | Standard price (no change) | Differentiated rate tracking |

### usePricing Hook Flow

1. Gets `pricingProgram` from `useOrderSettings()`.
2. Calls `calculateOrderTotals()` twice — once for cash, once for card — to power the cash/card toggle buttons in `PaymentModal`.
3. If `pricingProgram.model === 'surcharge'` and `paymentMethod !== 'cash'`, calls `calculateSurcharge()` to populate `surchargeAmount`.
4. Returns the full pricing shape including `surchargeAmount` and `pricingProgram` for downstream use.

### Payment Modal Surcharge Line

When `surchargeAmount > 0` and the selected payment method is not cash, `PaymentModal` renders:

```tsx
<span>Credit Card Surcharge ({pricingProgram?.surchargePercent ?? 0}%)</span>
<span>+{formatCurrency(surchargeAmount)}</span>
// Below total:
<p>{pricingProgram?.surchargeDisclosure || 'A credit card surcharge is applied to card payments.'}</p>
```

### Receipt and ESC/POS Print

- **On-screen receipt:** `surchargeAmount` renders as a line between tax and total; optional disclosure line at bottom.
- **ESC/POS print:** `print-factory.ts` inserts `CC Surcharge (X%): $Y.YY` and a Visa/MC compliance disclaimer line.
- **Shift closeout:** `shift-closeout-receipt.ts` adds a `Surcharges Collected: $X` summary line.

### Admin Menu Builder Auto-Display

All admin menu builder price inputs auto-calculate and display the corresponding card price when a customer-facing program is active. This covers `ItemSettingsModal`, `PricingOptionRow`, `ItemEditor`, `liquor-builder/page.tsx`, `combos/page.tsx`, and `timed-rentals/page.tsx`. Pattern: `useOrderSettings()` → `calculateCardPrice(price, cashDiscountPct)` → read-only display.

### Mission Control Configuration Flow

1. Open Mission Control → **Locations** → select venue → scroll to **Pricing Program** card.
2. Click the desired model pill.
3. Fill in model-specific parameters (live example calculations update in real time).
4. For `surcharge` model in CT, MA, or PR: a compliance warning banner is shown (save is not hard-blocked).
5. Click **Save Pricing Program**. Settings are pushed to `Location.settings.pricingProgram` immediately; clients pick up the change within 5 minutes.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Payments | Adds surcharge amount to card payment totals; affects `Payment.totalAmount` for card transactions |
| Reports | Surcharge collected appears on shift closeout receipts and daily revenue reports |
| Menu | Admin menu builder price inputs display auto-calculated card prices |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Settings | Pricing program is stored in `Location.settings`; settings changes propagate to the pricing hook |
| Roles & Permissions | Only Mission Control admins can change the pricing program; POS managers see read-only display |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Payments** — surcharge amount must be added to `Payment.totalAmount` when model is `surcharge`; never double-apply
- [ ] **Reports** — `surchargeTotal` field on shift closeout must accumulate correctly across all card transactions in the shift
- [ ] **Menu builder** — card price auto-display must update when `pricingProgram` changes (check `useOrderSettings` cache TTL)
- [ ] **Offline** — the 5-minute client cache means a pricing change is not reflected immediately; this is acceptable
- [ ] **Backward compatibility** — `getPricingProgram()` fallback to legacy `dualPricing` must not be removed while any venue may still have only `dualPricing` set
- [ ] **State compliance** — surcharge model in CT, MA, PR must always show a warning in Mission Control

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View active pricing program (POS) | Any manager | Standard |
| Configure pricing program | Mission Control admin only | Critical |

---

## Known Constraints & Limits

- Visa/MC rules cap surcharges at 3%. The UI enforces `Math.min(val, 3)` on input.
- Surcharge is prohibited in CT, MA, and PR. The Mission Control UI shows a warning but does not hard-block the save — the operator is responsible for compliance.
- Debit card surcharging defaults to `false` (`surchargeApplyToDebit: false`). Most state laws prohibit surcharging debit.
- Merchant-absorbed models (`flat_rate`, `interchange_plus`, `tiered`) do not show any surcharge line on receipts or in the payment modal. They are for internal cost tracking only.
- No new Prisma model: the program is a JSON blob inside `Location.settings`, so no migration file is needed and existing data is not at risk.
- Client-side cache TTL is 5 minutes. A pricing program change from Mission Control takes up to 5 minutes to appear on a POS terminal without a page refresh.

---

## Android-Specific Notes

The Android register implements the legacy `dualPricing` (cash discount) model, showing cash and card price totals in the payment flow. The full six-model `PricingProgram` interface is not yet implemented in Android — the register reads `cashDiscountPercent` from the bootstrap settings and applies it as a cash discount. When `model === 'surcharge'` is configured from Mission Control, the Android register will display standard pricing (no surcharge line). A full Android implementation of all six models is a future task.

---

## Related Docs

- **Feature doc:** `docs/features/payments.md`
- **Feature doc:** `docs/features/settings.md`
- **Feature doc:** `docs/features/hardware.md`
- **Architecture guide:** `docs/guides/PAYMENTS-RULES.md`
- **Skills:** Skill 392 (see `docs/skills/392-PRICING-PROGRAMS.md`), Spec 31 (see `docs/skills/SPEC-31-DUAL-PRICING.md`)

---

*Last updated: 2026-03-03*
