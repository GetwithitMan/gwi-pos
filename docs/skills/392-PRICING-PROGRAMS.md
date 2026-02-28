# Skill 392 — Pricing Programs / Surcharge Engine (T-080)

## Overview

The Pricing Programs engine (task T-080) replaces the legacy dual-pricing toggle with a fully configurable six-model payment cost strategy. The six models are: `none`, `cash_discount`, `surcharge`, `flat_rate`, `interchange_plus`, and `tiered`. Customer-facing models (`cash_discount` and `surcharge`) change the amount the customer pays; merchant-absorbed models (`flat_rate`, `interchange_plus`, `tiered`) leave the customer price unchanged and are used for P&L cost tracking only. The entire engine is built in phases across the POS, receipts, ESC/POS print layer, and Mission Control admin UI.

## Schema Changes

The pricing program is stored as a JSON blob inside the existing `Location.settings` field — no new Prisma model was required. The relevant TypeScript interface lives in `src/lib/settings.ts`:

```typescript
export interface PricingProgram {
  model: 'cash_discount' | 'surcharge' | 'flat_rate' | 'interchange_plus' | 'tiered' | 'none'
  enabled: boolean

  // Cash Discount (model === 'cash_discount')
  cashDiscountPercent?: number       // 0–10 %
  applyToCredit?: boolean
  applyToDebit?: boolean
  showSavingsMessage?: boolean

  // Surcharge (model === 'surcharge')
  surchargePercent?: number          // 0–3 % (Visa/MC cap)
  surchargeApplyToCredit?: boolean
  surchargeApplyToDebit?: boolean
  surchargeDisclosure?: string       // Shown on receipt / checkout

  // Flat Rate (model === 'flat_rate')
  flatRatePercent?: number
  flatRatePerTxn?: number

  // Interchange Plus (model === 'interchange_plus')
  markupPercent?: number
  markupPerTxn?: number

  // Tiered (model === 'tiered')
  qualifiedRate?: number
  midQualifiedRate?: number
  nonQualifiedRate?: number
  tieredPerTxn?: number

  // State compliance
  venueState?: string
}
```

The `getPricingProgram()` helper in `src/lib/settings.ts` reads `settings.pricingProgram` first, then falls back to the legacy `settings.dualPricing` field for backward compatibility.

## Key Files

| File | Description |
|------|-------------|
| `src/lib/settings.ts` | `PricingProgram` interface, `DEFAULT_PRICING_PROGRAM`, `getPricingProgram()` helper |
| `src/lib/pricing.ts` | Pure calculation functions: `calculateSurcharge()`, `calculateSurchargeTotal()`, `calculateFlatRateCost()`, `calculateInterchangePlusCost()`, `calculateTieredCost()`, `applyPricingProgram()`, `isSurchargeLegal()` |
| `src/hooks/usePricing.ts` | React hook — calls `useOrderSettings()`, computes cash + card totals, exposes `surchargeAmount` and `pricingProgram` |
| `src/hooks/useOrderSettings.ts` | Fetches location settings (with 5-min client cache), returns `pricingProgram` field |
| `src/components/payment/PaymentModal.tsx` | Shows `surchargeAmount` line item + disclosure text when model is `surcharge` and payment is not cash |
| `src/components/receipt/Receipt.tsx` | Renders `surchargeAmount`, `surchargePercent`, `surchargeDisclosure` props in the on-screen receipt |
| `src/lib/print-factory.ts` | ESC/POS receipt builder — adds `CC Surcharge (X%): $Y` line and optional disclosure footer line |
| `src/lib/escpos/shift-closeout-receipt.ts` | Adds `Surcharges Collected: $X` to shift closeout printout via `surchargeTotal` param |
| `src/app/(admin)/settings/page.tsx` | POS admin settings page — read-only display of the active pricing program |
| `gwi-mission-control/src/components/admin/PricingProgramCard.tsx` | Full edit UI (750 lines) in Mission Control; saves via `PUT /api/admin/locations/[id]` |
| `gwi-mission-control/src/app/dashboard/locations/[id]/page.tsx` | Mounts `PricingProgramCard` in location detail view |

## How It Works

### 1. Settings Storage and Retrieval

The `pricingProgram` object is stored as part of the `Location.settings` JSON column. `useOrderSettings()` fetches `/api/location` (or equivalent) and caches the result on the client for 5 minutes. The `getPricingProgram(settings)` function handles the migration path: if `settings.pricingProgram` is present it returns it directly; otherwise it synthesizes a `cash_discount` program from the legacy `settings.dualPricing` shape.

### 2. Pricing Calculation

All math lives in `src/lib/pricing.ts`:

- **`calculateSurcharge(basePrice, pct)`** — integer-cent arithmetic: `Math.round(base * pct / 100 * 100) / 100`.
- **`applyPricingProgram(basePrice, program, paymentMethod)`** — strategy router. Returns a `PricingResult` with `finalPrice`, `surchargeAmount`, and `merchantCost`.
  - `cash_discount` — raises the card price; cash price is unchanged.
  - `surcharge` — adds surcharge ON TOP of cash price for card payments (only credit by default, debit off by default).
  - `flat_rate`, `interchange_plus`, `tiered` — populate `merchantCost` only; `finalPrice === basePrice`.
- **`isSurchargeLegal(state)`** — returns false for CT, MA, PR.

### 3. usePricing Hook

`src/hooks/usePricing.ts` is the thin adapter that components consume:

1. Gets `pricingProgram` from `useOrderSettings()`.
2. Builds synthetic items from the raw subtotal splits (inclusive vs. exclusive tax subtotals).
3. Calls `calculateOrderTotals()` twice — once for cash, once for card — to power the cash/card toggle buttons in `PaymentModal`.
4. If `pricingProgram.model === 'surcharge'` and `paymentMethod !== 'cash'`, calls `calculateSurcharge()` to populate `surchargeAmount`.
5. Returns the full pricing shape including `surchargeAmount` and `pricingProgram` for downstream use.

### 4. PaymentModal Surcharge Line

In `src/components/payment/PaymentModal.tsx`:

```tsx
// Line item row (only for surcharge model, non-cash)
{surchargeAmount > 0 && selectedMethod !== 'cash' && (
  <div>
    <span>Credit Card Surcharge ({pricingProgram?.surchargePercent ?? 0}%)</span>
    <span>+{formatCurrency(surchargeAmount)}</span>
  </div>
)}

// Disclosure text under the total
{surchargeAmount > 0 && selectedMethod !== 'cash' && (
  <p>{pricingProgram?.surchargeDisclosure || 'A credit card surcharge is applied to card payments.'}</p>
)}
```

### 5. On-Screen Receipt

`src/components/receipt/Receipt.tsx` accepts `surchargeAmount`, `surchargePercent`, and `surchargeDisclosure` props. When `surchargeAmount > 0` it renders a line between the tax row and the total, and optionally a disclosure line at the bottom.

### 6. ESC/POS Print

`src/lib/print-factory.ts` accepts a `totals` object with optional `surchargeAmount`, `surchargePercent`, and `surchargeDisclosure`. If `surchargeAmount > 0` it inserts:

```
CC Surcharge (X%):      $Y.YY
```

and then a disclaimer line:

```
*Credit card surcharge applied per Visa/MC guidelines
```

(or the custom `surchargeDisclosure` string). The shift closeout receipt separately adds a `Surcharges Collected: $X` summary line via the `surchargeTotal` field on `src/lib/escpos/shift-closeout-receipt.ts`.

### 7. Mission Control Admin UI

`PricingProgramCard.tsx` (in `gwi-mission-control`) exposes the full configuration:

- Six pill buttons to select the active model (`none`, `cash_discount`, `surcharge`, `flat_rate`, `interchange_plus`, `tiered`).
- Per-model form fields (see each conditional block in the component).
- A compliance warning banner when `surcharge` is selected and `locationState` is in CT, MA, or PR.
- Live example calculation panels showing real numbers.
- Saves via `PUT /api/admin/locations/[id]` with the entire `pricingProgram` subobject nested under `settings`.

### 8. POS Settings Page (Read-Only)

`src/app/(admin)/settings/page.tsx` calls `getPricingProgram(settings)` and displays the active model and its key parameters in a read-only card. Managers can see the current configuration but changes are made exclusively from Mission Control.

## Configuration

1. Open Mission Control at `app.thepasspos.com`.
2. Navigate to **Locations** → select the venue → scroll to the **Pricing Program** card.
3. Click the desired model pill.
4. Fill in model-specific parameters (example calculations update in real time).
5. Click **Save Pricing Program**. Settings are pushed to the POS immediately and cached on next page load (5-min TTL).

## Notes

- **Visa/MC cap**: Surcharge is capped at 3% by card network rules. The UI enforces `Math.min(val, 3)` on input.
- **Surcharge-prohibited states**: CT, MA, and PR. Selecting `surcharge` for a venue in those states shows a warning in Mission Control but does not hard-block the save.
- **Debit cards**: Surcharge defaults to `surchargeApplyToDebit: false`. Most state laws prohibit surcharging debit.
- **Merchant-absorbed models** (`flat_rate`, `interchange_plus`, `tiered`): No customer-facing price change. These are for P&L cost tracking and do not show a surcharge line on receipts or in the payment modal.
- **Backward compatibility**: Venues that had `dualPricing.enabled = true` before this skill was built continue to work via the `getPricingProgram()` fallback — no migration needed.
- **No new Prisma model**: The program is a JSON blob inside `Location.settings`, so there is no migration file and no risk to existing data.
- **Admin menu builder auto-display (commit `8394777`)**: As of this commit, all admin menu builder price inputs now show auto-calculated card prices based on the configured pricing program rate. This covers: `ItemSettingsModal` (base price, weight-based price), `PricingOptionRow` (size options, quick picks), `ItemEditor` (new modifier form), `liquor-builder/page.tsx` (drink price, pour sizes, modifiers), `combos/page.tsx` (all combo price fields), and `timed-rentals/page.tsx` (rates, packages). Pattern: `useOrderSettings()` → `calculateCardPrice(price, cashDiscountPct)` → read-only display.
