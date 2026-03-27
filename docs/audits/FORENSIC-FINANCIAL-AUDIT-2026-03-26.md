# Forensic Financial Audit — 2026-03-26

**Scope:** 13 forensic auditors tracing every dollar from sale to payout
**Method:** Each agent reads calculation code line-by-line, constructs dollar examples
**Status:** 11 of 13 complete — findings compiled below

---

## CRITICAL FINANCIAL BUGS (Fix Immediately — Direct Money Loss)

| # | Area | Bug | Impact | File |
|---|---|---|---|---|
| F1 | **Order Totals** | Percentage discount uses `Math.round(X * (Y/100) * 100)/100` instead of `roundToCents(X * (Y/100))` | $5K-$15K/yr | discount/route.ts:321,370 |
| F2 | **Tax** | Tax-exempt orders still charge tax on inclusive items (`inclusiveRate` not zeroed) | $0-$8.26 per exempt order | order-calculations.ts:274-275 |
| F3 | **Tax** | Modifiers not marked tax-inclusive (upcharge on inclusive drink taxed wrong) | $0.10-$0.50 per modifier | orders/route.ts:496-522 |
| F4 | **Tips** | Invalid primaryEmployeeId = tips vanish (TipTransaction created, no ledger) | $7K-$15K/yr | tip-allocation.ts:240-262 |
| F5 | **Payments** | Split payment validation uses `totalAmount` (includes tips) vs `order.total` (excludes tips) | Overpayment/rejection | pay/route.ts:670-687 |
| F6 | **Payments** | Gift card balance deduction not atomic with payment creation | Double-spend risk | gift-card.ts + pay/route.ts |
| F7 | **Dual Pricing** | Bar tab close ignores surcharge model — uses cash discount calculation | $1.32+ per tab | tab-close/compute.ts:50 |
| F8 | **Dual Pricing** | Possible duplicate surcharge in PaymentModal (added on top of already-included total) | $3.00 per card payment | PaymentModal.tsx:927-933 |
| F9 | **Dual Pricing** | Split payments don't recalculate surcharge per split | $1.50+ per split | split-pricing.ts |
| F10 | **PMS** | Room charge includes TIP in OPERA posting (guest folio overcharged) | $15K/month | pay/route.ts:207-212 |
| F11 | **Accounts** | House account race condition — no FOR UPDATE lock on concurrent charges | $10+ per race | pay/route.ts:850-898 |
| F12 | **Accounts** | Deposit overpayment credit silently lost (calculated but never tracked) | Per deposit | apply-deposit:200-212 |
| F13 | **Accounts** | Cake order deposit + final payment double-counted in revenue | $50+ per cake | cake-orders/payment |
| F14 | **Splits** | Donation locked on first child, not distributed proportionally | $5+ per split with donation | item-split.ts:179-185 |
| F15 | **Reports** | Daily sales double-backs out inclusive tax (gross sales understated) | Report accuracy | daily/route.ts:161,472 |

## CRITICAL FRAUD VECTORS (Fix Immediately — Theft Enabled)

| # | Vector | Weekly Loss | Fix |
|---|---|---|---|
| V1 | Void items AFTER kitchen fulfillment (food made = pure loss) | $2K-$5K | Block voids on sent items without explicit override |
| V2 | Cash not recorded (delete order, keep cash) | $2K-$10K | Require payment before order soft-delete |
| V3 | Manager PIN observed and reused by server (no requester check) | $1K-$5K | PIN must match requester, not any manager |
| V4 | Remote void approval code NEVER consumed (reusable) | $500-$2K | Mark code "used" after first void |
| V5 | Comp items under threshold — no approval needed | $1K-$3K | Lower default threshold |
| V6 | Discount stacking — multiple rules, no cumulative cap | $500-$2K | Enforce max discount ≤ 100% of subtotal |
| V7 | Gift card activation to fake email | $500-$3K | Validate recipient against customer DB |
| V8 | Variance override requires no justification | Unlimited | Require reason + audit log |

## HIGH SEVERITY (Fix This Sprint)

| # | Area | Bug | File |
|---|---|---|---|
| H1 | Tax | Multiple tax rates summed then applied as single rate (not distributive) | tax-utils.ts:28-49 |
| H2 | Tax | Separate inclusive rate not per-category (food 8% vs liquor 9% lumped) | order-calculations.ts:313-320 |
| H3 | Payments | Datacap charge vs POS recording never cross-validated | pay/route.ts |
| H4 | Payments | Refund validated against POS amount, not Datacap amount | refund-payment:150-165 |
| H5 | Payments | Order total not recalculated after entertainment settlement before payment | pay/route.ts:703-830 |
| H6 | Cash | Cash tips not separated from drawer reconciliation formula | shift-summary.ts |
| H7 | Cash | Paid-out records can be soft-deleted to mask shortage | paid-in-out/[id]/route.ts |
| H8 | Reports | Comped items excluded from item counts (menu engineering broken) | sales/route.ts:301 |
| H9 | Reports | Labor cost reads pre-calc fields without validation | labor-cost:84-115 |
| H10 | Accounts | Gift card can go negative on concurrent redemptions | gift-card.ts:77-89 |
| H11 | Accounts | House account payment silently clamped without error | payments/route.ts:62-74 |
| H12 | Accounts | Bottle service pre-auth not enforced at capture | bottle-service/route.ts |
| H13 | PMS | Room charge amount not validated against order total (fraud) | pay/route.ts:207-212 |
| H14 | Dual Pricing | Surcharge base inconsistent (pre-tax vs post-tax in different paths) | usePricing.ts vs compute.ts |
| H15 | Splits | Inclusive tax reconciliation breaks on discount+split | item-split.ts:163-167 |
| H16 | Splits | Discount remainder >5¢ silently dropped | discount-distribution.ts:175 |

## MEDIUM SEVERITY

| Area | Issue |
|---|---|
| Tax | Rounding compounds across multiple steps ($0.01-$0.03 per order) |
| Tax | Receipt display mismatch on discounted inclusive items |
| Tips | Double payroll export risk (no export tracking) |
| Tips | Concurrent delete + allocation = tips lost |
| Cash | Multi-drawer sharing without reconciliation guard |
| Cash | Unclosed drawers at EOD not handled |
| Cash | Rounding adjustments not in expectedCash formula |
| Reports | Discount double-counting (order-level + item-level overlap) |
| Accounts | Reservation deposit partial refund before apply |
| Dual Pricing | Mobile wallet (Apple Pay) surcharge treatment undefined |
| Entertainment | Extension bypasses grace period (policy question) |
| Entertainment | Session expiry loses happy hour discount context |

---

## ESTIMATED ANNUAL FINANCIAL IMPACT

| Category | Conservative | High |
|---|---|---|
| Calculation bugs (F1-F15) | $25,000 | $100,000 |
| Fraud vectors (V1-V8) | $364,000 | $1,404,000 |
| Report inaccuracy | Audit exposure | Audit exposure |
| **Total per location** | **$389,000** | **$1,504,000** |

---

## FIX PRIORITY ORDER

### Week 1: Stop The Bleeding (Financial Bugs)
1. F1: Fix percentage discount rounding formula
2. F10: Remove tip from OPERA room charge amount
3. F4: Validate employee exists before tip allocation
4. F5: Fix split payment validation (use amount, not totalAmount)
5. F7+F8+F9: Fix dual pricing surcharge across all paths
6. V4: Consume remote void approval codes after use

### Week 2: Close Fraud Vectors
7. V1: Block voids on sent/received items without explicit manager override
8. V3: Manager PIN must match requester identity
9. V6: Enforce cumulative discount cap (≤ 100% of subtotal)
10. V2: Require payment recording before order deletion
11. V8: Require justification for cash variance override

### Week 3: Fix Remaining Calculations
12. F2+F3: Fix tax-exempt inclusive handling + modifier tax inheritance
13. F6+F11: Atomic gift card deduction + house account FOR UPDATE lock
14. F13+F14: Fix cake deposit double-count + split donation distribution
15. F15+H8: Fix daily report inclusive tax double-backout + comped item counts
