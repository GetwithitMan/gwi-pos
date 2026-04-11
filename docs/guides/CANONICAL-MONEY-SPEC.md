# Canonical Money Specification

**Status:** AUTHORITATIVE — all code must conform to this spec.
**Last updated:** 2026-04-10

---

## 1. Stored Basis

All prices in the database (MenuItem, OrderItem, Order) are stored as **cash prices in dollars** (e.g., `19.99`, not `1999`).

- `order.subtotal` = sum of cash-basis item totals (qty * cashPrice + modifiers)
- `order.taxTotal` = tax computed on cash basis
- `order.tipTotal` = sum of all tips on the order
- `order.total` = subtotal - discountTotal + taxTotal + tipTotal
- `order.discountTotal` = sum of all discount dollar amounts (cash basis)

The server stores cash basis only. Card and debit prices are **derived** at display and validation time.

## 2. Surcharge Rule (Dual Pricing — DP1)

```
surcharge = round(cashSubtotal * creditMarkupPercent / 100, 2)
```

- Surcharge is applied to **subtotal** (pre-tax, pre-tip)
- Surcharge is **NOT taxable** — `cardTax = cashTax`
- Debit uses `debitMarkupPercent` (can be 0, meaning debit = cash price)

**Card total formula:**

```
cardTotal = cashSubtotal + surcharge + cashTax - discountTotal
```

## 3. Tip Rule

- Tips are **NEVER surcharged**
- Tips are post-tax, post-surcharge

```
paymentBasis = cardTotal                  (excludes tip)
paymentTotal = paymentBasis + tipAmount   (what is charged)
```

For cash payments: `paymentBasis = cashTotal`, `paymentTotal = cashTotal + tipAmount`.

## 4. Discount Rule

- Discounts are stored as **cash-basis dollar amounts**
- Fixed-amount discounts: same dollar amount regardless of payment method
- Percent discounts: computed on **cash subtotal**

```
percentDiscount = round(cashSubtotal * discountPercent / 100, 2)
```

- Discounts reduce the **pre-surcharge subtotal**
- Surcharge is computed on `cashSubtotal` (before discount), NOT on `cashSubtotal - discountTotal`

## 5. Tax Rule

```
taxableAmount = cashSubtotal - discountTotal
taxTotal      = round(taxableAmount * taxRate / 100, 2)
```

- **Tax-inclusive items:** tax is extracted from the stored price (`price - price / (1 + rate)`)
- **Tax-exclusive items:** tax is added to the stored price
- Surcharge does **NOT** change the taxable basis — `cardTax = cashTax`

## 6. Rounding Rule

- **Cash payments:** final total is rounded to the nearest nickel/dime/quarter/dollar per venue setting
- **Card/debit payments:** exact cents, NO rounding

```
cashRounded = roundToUnit(cashSubtotal - discountTotal + taxTotal, roundingUnit)
```

Rounding applies to the **final cash total only**, after tax and discounts.

## 7. Receipt Rule

Receipts display prices in the **payment tier that was actually used**.

| Payment method | Item prices shown | Modifier prices shown | Tax shown     |
|----------------|-------------------|-----------------------|---------------|
| Cash           | Cash price        | Cash price            | Actual tax    |
| Credit card    | Uplifted price    | Uplifted price        | Actual tax    |
| Debit card     | Uplifted price    | Uplifted price        | Actual tax    |

**Uplift formula (per-item):**

```
displayPrice = round(cashPrice * (1 + markupPercent / 100), 2)
```

Tax shown is always the actual computed tax (cash-basis tax). It is NOT marked up.

## 8. Report Rule

- Reports use `payment.pricingProgramSnapshot` for the tier at time of payment
- Reports use **actual captured amounts**, never recalculated amounts
- `cashTotal` and `cardTotal` in report queries **include tipTotal**
- Refunds reference the original payment's pricing snapshot

---

## Quick Reference: Full Card Payment Flow

```
cashSubtotal   = sum(items * cashPrice + modifiers)
discountTotal  = sum(discounts)                              // cash-basis dollars
taxableAmount  = cashSubtotal - discountTotal
taxTotal       = round(taxableAmount * taxRate / 100, 2)
surcharge      = round(cashSubtotal * creditMarkupPercent / 100, 2)
cardTotal      = cashSubtotal + surcharge + taxTotal - discountTotal
paymentBasis   = cardTotal                                   // excludes tip
paymentTotal   = paymentBasis + tipAmount                    // charged to card
```

## Quick Reference: Full Cash Payment Flow

```
cashSubtotal   = sum(items * cashPrice + modifiers)
discountTotal  = sum(discounts)
taxableAmount  = cashSubtotal - discountTotal
taxTotal       = round(taxableAmount * taxRate / 100, 2)
cashTotal      = cashSubtotal + taxTotal - discountTotal
cashRounded    = roundToUnit(cashTotal, roundingUnit)
paymentTotal   = cashRounded + tipAmount
```
