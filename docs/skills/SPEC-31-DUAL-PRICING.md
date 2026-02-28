# 31 - Dual Pricing (Cash Discount)

**Status:** Planning
**Priority:** Medium
**Dependencies:** 03-Menu-Programming, 30-Tender-Types

---

## Overview

The Dual Pricing skill implements cash discount programs where customers pay a lower price for cash payments vs card payments. The card price includes a service fee to offset processing costs. Must comply with card network rules and state laws.

**Primary Goal:** Reduce credit card processing costs while remaining compliant with regulations.

---

## User Stories

### As a Customer...
- I want to see both cash and card prices clearly
- I want to understand the savings for paying cash
- I want the choice clearly presented at checkout

### As a Manager...
- I want to set the cash discount percentage
- I want dual pricing on receipts and menus
- I want to ensure compliance with regulations

### As an Owner...
- I want to reduce processing fees
- I want to stay compliant with card rules
- I want to track savings from cash payments

---

## Features

### Pricing Configuration

#### Cash Discount Setup
- [ ] Enable/disable dual pricing
- [ ] Cash discount percentage (typically 3-4%)
- [ ] Or card surcharge percentage
- [ ] Minimum amount threshold

#### Pricing Models
```yaml
dual_pricing:
  model: "cash_discount"  # or "card_surcharge"
  percentage: 3.5
  minimum_order: 0.00
  apply_to:
    - credit_card
    - debit_card
  exclude:
    - gift_card
    - house_account
```

### Price Display

#### Menu Display
- [ ] Show base (cash) price
- [ ] Show card price (calculated)
- [ ] Clear labeling
- [ ] Signage requirements

#### Display Format
```
Cheeseburger
Cash: $14.99 | Card: $15.51

-- or --

Cheeseburger - $14.99
(3.5% service fee applies to card payments)
```

### Checkout Experience

#### Payment Selection
- [ ] Clear cash vs card pricing
- [ ] Auto-calculate based on tender
- [ ] Show savings for cash

#### Checkout Display
```
Subtotal:                     $87.50
Tax:                           $7.00
─────────────────────────────────────
Cash Price:                   $94.50
Card Price:                   $97.81 (+$3.31)
                              ────────
Pay with cash and save $3.31!
```

### Receipt Handling

#### Receipt Requirements
- [ ] Show cash price as base
- [ ] Show service fee as line item (for card)
- [ ] Clear explanation text
- [ ] Compliance language

#### Card Receipt Example
```
================================
       RESTAURANT NAME
================================
Cheeseburger              $14.99
Fries                      $4.99
Draft Beer                 $7.00
--------------------------------
Subtotal                  $26.98
Tax                        $2.16
Service Fee (3.5%)         $0.94
--------------------------------
TOTAL                     $30.08
================================
Service fee reflects cost of
card processing. Pay cash to
avoid this fee.
================================
```

### Compliance Features

#### Signage Generator
- [ ] Generate compliant signage
- [ ] Multiple sizes
- [ ] Required disclosures

#### State Compliance
- [ ] State-specific rules
- [ ] Surcharge vs discount rules
- [ ] Maximum percentages

### Reporting

#### Dual Pricing Reports
- [ ] Cash vs card transactions
- [ ] Service fees collected
- [ ] Estimated savings
- [ ] Payment method trends

---

## UI/UX Specifications

### POS Payment Screen

```
+------------------------------------------------------------------+
| PAYMENT - Check #1234                                            |
+------------------------------------------------------------------+
|                                                                  |
| ITEMS                                                            |
| Cheeseburger                                             $14.99  |
| Fries                                                     $4.99  |
| Draft Beer                                                $7.00  |
| ───────────────────────────────────────────────────────────────  |
| Subtotal                                                 $26.98  |
| Tax                                                       $2.16  |
|                                                                  |
+==================================================================+
|                                                                  |
|    💵 PAY CASH               💳 PAY CARD                        |
|    ┌─────────────────┐       ┌─────────────────┐                |
|    │                 │       │                 │                |
|    │    $29.14       │       │    $30.16       │                |
|    │                 │       │  (+$1.02 fee)   │                |
|    │   [Pay Cash]    │       │   [Pay Card]    │                |
|    │                 │       │                 │                |
|    └─────────────────┘       └─────────────────┘                |
|                                                                  |
|    💡 Save $1.02 by paying with cash!                           |
|                                                                  |
+------------------------------------------------------------------+
```

### Configuration Screen

```
+------------------------------------------------------------------+
| DUAL PRICING SETTINGS                                  [Save]    |
+------------------------------------------------------------------+
|                                                                  |
| ENABLE DUAL PRICING                                              |
| [✓] Enable cash discount / card service fee                     |
|                                                                  |
| PRICING MODEL                                                    |
| (•) Cash Discount - Show cash as discounted price               |
| ( ) Card Surcharge - Show card as surcharged price              |
|                                                                  |
| PERCENTAGE                                                       |
| Service Fee: [3.5]%                                             |
| (Typically 2.5% - 4% to cover processing costs)                 |
|                                                                  |
| APPLIES TO                                                       |
| [✓] Credit Cards                                                |
| [✓] Debit Cards                                                 |
| [ ] Gift Cards                                                   |
| [ ] House Accounts                                               |
|                                                                  |
| DISPLAY OPTIONS                                                  |
| [✓] Show both prices on POS                                     |
| [✓] Show service fee on receipt                                 |
| [✓] Show savings message                                        |
|                                                                  |
| COMPLIANCE                                                       |
| State: [California ▼]                                           |
| ⚠️ California requires "surcharge" model for credit cards only  |
|    Debit cards cannot be surcharged in California               |
|                                                                  |
| [Generate Signage]  [View Compliance Guide]                     |
|                                                                  |
+------------------------------------------------------------------+
```

---

## Data Model

### Dual Pricing Settings
```sql
dual_pricing_settings {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  enabled: BOOLEAN DEFAULT false
  model: VARCHAR(50) (cash_discount, card_surcharge)
  percentage: DECIMAL(5,2)

  -- Applies to
  apply_to_credit: BOOLEAN DEFAULT true
  apply_to_debit: BOOLEAN DEFAULT true
  apply_to_gift: BOOLEAN DEFAULT false

  -- Display
  show_both_prices: BOOLEAN DEFAULT true
  show_savings_message: BOOLEAN DEFAULT true
  savings_message: TEXT (nullable)

  -- Compliance
  state: VARCHAR(50)
  surcharge_disclosure: TEXT

  updated_at: TIMESTAMP
}
```

### Service Fee Transactions
```sql
service_fee_transactions {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  order_id: UUID (FK)
  payment_id: UUID (FK)

  subtotal_amount: DECIMAL(10,2)
  fee_percentage: DECIMAL(5,2)
  fee_amount: DECIMAL(10,2)

  tender_type: VARCHAR(50)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

```
GET    /api/locations/{loc}/dual-pricing
PUT    /api/locations/{loc}/dual-pricing

GET    /api/orders/{id}/pricing  -- Returns both cash and card totals
POST   /api/orders/{id}/calculate-fee

GET    /api/reports/dual-pricing
GET    /api/compliance/dual-pricing/{state}
```

---

## Business Rules

1. **Fee Calculation:** Apply percentage to subtotal (pre-tax typically)
2. **Clear Disclosure:** Must clearly communicate fee/discount
3. **State Compliance:** Honor state-specific restrictions
4. **Card Network Rules:** Follow Visa/MC surcharge rules
5. **Debit Restrictions:** Some states prohibit debit surcharges

---

## Compliance Notes

### Card Network Rules (as of 2025)
- Surcharge max: 3% or actual cost, whichever is less
- Must disclose at point of entry and point of sale
- Cannot surcharge debit cards in some states
- Must report to card brands

### State Restrictions
- **California:** Surcharge OK for credit, not debit
- **Colorado:** No surcharges
- **Connecticut:** No surcharges
- **Maine:** Allowed with restrictions
- *[Full state list maintained in system]*

---

## Configuration Options

```yaml
dual_pricing:
  enabled: false
  model: "cash_discount"
  percentage: 3.5

  compliance:
    auto_detect_state: true
    show_warnings: true

  display:
    both_prices: true
    savings_message: "Save ${amount} by paying with cash!"
    receipt_disclosure: true

  calculation:
    apply_before_tax: true
    round_to_cents: true
```

---

## Open Questions

1. **Debit Handling:** Treat debit same as credit or exempt?

2. **Online Orders:** Apply dual pricing to online orders?

3. **Minimum Threshold:** Minimum order to apply fee?

4. **Employee Meals:** Exempt employee transactions?

---

### Admin UI — Card Price Auto-Display (2026-02-28)

Commit `8394777` added auto-calculated card price display to every cash price input in the admin menu builders. The card price is derived from the cash discount rate in Settings → General → Processing Program.

**Files updated:**
- `ItemSettingsModal.tsx` — Base price, weight-based price
- `PricingOptionRow.tsx` — Size options, quick picks
- `ItemEditor.tsx` — New modifier form
- `liquor-builder/page.tsx` — Drink price, pour sizes, modifiers
- `combos/page.tsx` — All combo price fields
- `timed-rentals/page.tsx` — Rates, packages

Pattern: `useOrderSettings()` → `calculateCardPrice(price, cashDiscountPct)` → read-only display.

---

### Bug Fixes (2026-02-28)

Commit `8bdd4bd` — Fixed 5 dual pricing bugs:
1. `ModifierModal.tsx` — 4 `ModifierGroupSection` renders missing `cardPriceMultiplier` (grid view, child/grandchild groups showed cash prices)
2. `pay/route.ts` — Validation called `calculateCashPrice(order.total)` but order.total IS already the cash price, making threshold too low
3. `close-tab/route.ts` — Tab captures sent cash price for card payments instead of card price
4. `pay-all-splits/route.ts` — Split payments sent cash price for card payments
5. `SpiritSelectionModal.tsx` — Spirit upgrade label showed cash price instead of card price

---

## Android Implementation

**Skill 458** (2026-02-27): Fixed inverted dual pricing display on Android.

**Key rule:** The default/base price stored on the server IS the credit card price. Cash gets a discount (not card gets a surcharge).

| What | Card | Cash |
|------|------|------|
| Total displayed | `total` (no modification) | `total - surchargeTotal` |
| Label | (none) | "Cash Discount (X%)" in green |
| PaymentSheet | Full total | Discounted total + "Cash discount applied: -$X.XX" |
| Amount sent to server | `total` | `total - cashDiscount` |

The Android bug was: `cardTotal = total + surchargeTotal` (adding surcharge ON TOP of what was already the card price). Fix: `cardTotal = total`, `cashTotal = total - surchargeTotal`.

---

*Last Updated: February 27, 2026*
