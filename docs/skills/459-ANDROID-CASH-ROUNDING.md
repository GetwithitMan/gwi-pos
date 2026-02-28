# Skill 459: Android Cash Rounding

**Date:** 2026-02-27
**Status:** DONE
**Domain:** Android / Payments
**Dependencies:** Skill 327 (Cash Rounding Pipeline), Skill 458 (Dual Pricing Fix)

## Summary

Implemented cash rounding on Android to match the web POS rounding pipeline (Skill 327). When the venue owner enables cash rounding (nickel/dime/quarter/dollar with nearest/up/down direction), cash payment totals are rounded accordingly. Rounding delta is displayed in both the order panel and payment sheet.

## Architecture

```
Server Bootstrap Response
  └── locationSettings.payments.cashRounding ("none"|"nickel"|"dime"|"quarter"|"dollar")
  └── locationSettings.payments.roundingDirection ("nearest"|"up"|"down")
      │
      ▼
BootstrapWorker → SyncMeta("cashRounding"), SyncMeta("roundingDirection")
      │
      ▼
OrderViewModel.loadCashRoundingSettings() → UiState.cashRounding, UiState.roundingDirection
      │
      ▼
OrderViewModel.applyCashRounding(amountCents) → rounded cents
OrderViewModel.calcCashRoundingDelta(cashTotalCents) → delta (positive = customer pays more)
      │
      ▼
refreshTotals() → UiState.cashRoundingAmount (Long cents)
      │
      ├── OrderPanel: "Rounding +/-$X.XX" line in totals
      ├── PaymentSheet: rounding applied to displayed cash total + "Rounding: +/-$X.XX" line
      └── payCash(): rounded amount sent to server
```

## Rounding Logic (matches web POS `rounding.ts`)

```kotlin
private fun applyCashRounding(amountCents: Long): Long {
    val incrementCents = when (cashRounding) {
        "nickel" -> 5L; "dime" -> 10L; "quarter" -> 25L; "dollar" -> 100L
        else -> return amountCents  // "none" = no rounding
    }
    return when (roundingDirection) {
        "up"   -> ceil to next increment
        "down" -> floor to previous increment
        else   -> nearest increment (half-up)
    }
}
```

### Rounding Examples

| Amount | Mode | Direction | Result | Delta |
|--------|------|-----------|--------|-------|
| $12.37 | nickel | nearest | $12.35 | -$0.02 |
| $12.37 | nickel | up | $12.40 | +$0.03 |
| $12.37 | dime | nearest | $12.40 | +$0.03 |
| $12.37 | quarter | up | $12.50 | +$0.13 |
| $12.37 | dollar | nearest | $12.00 | -$0.37 |

## Key Design Decisions

1. **Cash only** — Rounding applies only to cash payments. Card payments use exact total (no rounding).
2. **Applied after cash discount** — Order: base total → subtract cash discount → apply rounding. Rounding is on the discounted cash price.
3. **Integer arithmetic** — All rounding done in cents (Long) to avoid floating-point errors. No `Math.round()` on doubles.
4. **Server is final authority** — The server's pay route also applies rounding. Android's client-side rounding is for display accuracy and ensuring the correct amount is sent.
5. **Sign-safe display** — `kotlin.math.abs()` used for display formatting to avoid `$-0.03` (shows `-$0.03` instead).

## Files Changed

| File | Lines | What |
|------|-------|------|
| `BootstrapWorker.kt` | +7 | Extract `cashRounding` + `roundingDirection` from `locationSettings.payments` → SyncMeta |
| `OrderViewModel.kt` | +50 | `cashRounding`/`roundingDirection`/`cashRoundingAmount` on UiState, `loadCashRoundingSettings()`, `applyCashRounding()`, `calcCashRoundingDelta()`, wired into `refreshTotals()` + `loadDualPricingSettings()` + `payCash()` |
| `PaymentSheet.kt` | +12 | Accept `cashRoundingAmount` param, apply to cash total, display rounding line |
| `OrderPanel.kt` | +5 | Fixed sign formatting for rounding display (was `$-0.03`, now `-$0.03`) |
| `OrderScreen.kt` | +2 | Wire `cashRoundingAmount` to OrderPanel + PaymentSheet |

**5 files changed, +76 lines**

## Dependencies on Web POS

- **Skill 327** — Cash rounding pipeline on web POS (server-side validation, daily report tracking)
- **Skill 88** — Price rounding (the `priceRounding` settings path). Android currently uses the legacy `cashRounding` path, which is sufficient since both produce the same result.
- **Bootstrap API** — `locationSettings.payments.cashRounding` and `roundingDirection` must be included in the bootstrap response (already present)
