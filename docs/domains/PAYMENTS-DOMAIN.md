# Payments Domain

**Domain ID:** 7
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Payments domain handles all monetary transactions including payment processing, tips, receipts, dual pricing, gift cards, house accounts, and Datacap card reader integration. It handles:
- Cash and card payment processing
- Datacap XML-over-HTTP protocol (TStream/RStream)
- Bar tab pre-auth, capture, and auto-increment
- Dual pricing (cash discount program)
- Price rounding (cent-safe, last-step)
- Tax-inclusive pricing with split calculations
- Gift card purchase, redeem, reload
- House account charge and payment
- Tip management and tip-out rules
- Bottle service tiers
- Split payments (even, by item, custom)

## Domain Trigger

```
PM Mode: Payments
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Processing | Payment execution | `src/app/api/payments/`, `src/app/api/orders/[id]/pay/` |
| Datacap | Card reader integration | `src/lib/datacap/`, `src/app/api/datacap/` |
| Tips | Tip management | `src/app/api/tip-out-rules/`, `src/lib/domain/payment/tip-calculations.ts` |
| Receipts | Receipt generation | `src/app/api/receipts/`, `src/components/receipt/` |
| Pricing Engine | Calculations | `src/lib/pricing.ts`, `src/lib/order-calculations.ts`, `src/hooks/usePricing.ts` |
| Gift Cards | Gift card lifecycle | `src/app/api/gift-cards/` |
| House Accounts | Account charging | `src/app/api/house-accounts/` |
| UI | Payment modal | `src/components/payment/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/pricing.ts` | `roundToCents()`, `roundPrice()`, `calculateCardPrice()`, `formatSavingsMessage()` |
| `src/lib/order-calculations.ts` | `calculateOrderTotals()`, `calculateSplitTax()`, `getLocationTaxRate()` |
| `src/hooks/usePricing.ts` | Thin adapter: calls `calculateOrderTotals` twice (cash/card) |
| `src/hooks/useOrderSettings.ts` | Tax rate, dual pricing, rounding settings from API |
| `src/lib/datacap/client.ts` | DatacapClient with 17 methods (sale, preAuth, capture, etc.) |
| `src/lib/datacap/use-cases.ts` | `processSale()`, `openBarTab()`, `closeBarTab()`, `voidPayment()` |
| `src/lib/services/payment-service.ts` | Type-safe API client with `ServiceResult<T>` pattern |
| `src/lib/domain/payment/` | Pure business logic (tips, loyalty, dual-pricing, validators) |
| `src/components/payment/steps/` | 6 payment modal step components |
| `src/hooks/useDatacap.ts` | Datacap hook with failover |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 30 | Payment Processing | DONE |
| 31 | Dual Pricing | DONE |
| 32 | Gift Cards | DONE |
| 33 | House Accounts | DONE |
| 52 | Loyalty Program | DONE |
| 88 | Price Rounding | DONE |
| 120 | Datacap Direct Integration | DONE |
| 221-227 | Payment System Lockdown | DONE |
| 239 | Pricing Engine Refactor | DONE |
| 240 | Tax-Inclusive Pricing | DONE |
| 245 | Bottle Service Tiers | DONE |

## Integration Points

- **Orders Domain**: Payment on order close, void/comp recalculations
- **Employees Domain**: Tip tracking, tip-out rules
- **Reports Domain**: Payment reports, tip share reports
- **Hardware Domain**: Card reader management, receipt printing
- **Guest Domain**: Pay-at-table, CFD tip screen
