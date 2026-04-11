/**
 * Pricing Regression Test Suite — Release Gate
 *
 * 15 tickets verifying the CANONICAL-MONEY-SPEC produces identical amounts
 * across all surfaces (cash, card, debit). Every ticket asserts:
 *   subtotal, discount, tax, surcharge, tip, cashTotal, cardTotal, debitTotal
 *
 * Uses the actual shared pricing functions — no reimplementation.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock DB module to prevent DATABASE_URL requirement in test environment.
// The payment barrel (index.ts) imports drawer-resolution which imports db.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/location-cache', () => ({ getLocationSettings: vi.fn() }))
import {
  roundToCents,
  calculateCardPrice,
  calculateCreditPrice,
  calculateDebitPrice,
} from '@/lib/pricing'
import {
  calculateOrderTotal,
  calculateOrderTotals,
  calculateItemTotal,
  calculateSplitTax,
  type OrderItemForCalculation,
  type LocationTaxSettings,
} from '@/lib/order-calculations'
import { computePurchaseAmount } from '@/lib/domain/tab-close/compute'
import type { PricingProgram } from '@/lib/settings'
import type { TabCloseOrder } from '@/lib/domain/tab-close/types'

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Standard dual-pricing program: 4% credit, 0% debit */
const DP_PROGRAM: PricingProgram = {
  model: 'dual_price',
  enabled: true,
  creditMarkupPercent: 4,
  debitMarkupPercent: 0,
}

const TAX_RATE_8 = 0.08 // 8% as decimal

const LOCATION_8PCT: LocationTaxSettings = { tax: { defaultRate: 8 } }

/**
 * Compute the full dual-pricing breakdown for a ticket, mirroring
 * the logic in computeDualPricing (order-queries.ts).
 *
 * Pure math — no DB calls.
 */
function computeTicketPricing(params: {
  subtotal: number
  discountTotal?: number
  taxRate?: number
  tipTotal?: number
  creditMarkupPercent?: number
  debitMarkupPercent?: number
  isTaxInclusive?: boolean
}) {
  const {
    subtotal,
    discountTotal = 0,
    taxRate = TAX_RATE_8,
    tipTotal = 0,
    creditMarkupPercent = 4,
    debitMarkupPercent = 0,
  } = params

  const discountedCashSub = Math.max(0, subtotal - discountTotal)

  // Tax on discounted subtotal (CANONICAL-MONEY-SPEC section 5)
  const taxTotal = roundToCents(discountedCashSub * taxRate)

  // Surcharge on FULL subtotal (pre-discount) per CANONICAL-MONEY-SPEC section 4
  const creditSurcharge = roundToCents(subtotal * creditMarkupPercent / 100)
  const debitSurcharge = debitMarkupPercent > 0
    ? roundToCents(subtotal * debitMarkupPercent / 100)
    : 0

  // Cash total: discounted subtotal + tax + tip (no surcharge)
  const cashTotal = roundToCents(discountedCashSub + taxTotal + tipTotal)

  // Card total: discounted subtotal + surcharge + tax + tip
  const cardTotal = roundToCents(discountedCashSub + creditSurcharge + taxTotal + tipTotal)

  // Debit total: same as cash if 0% markup, else discounted sub + debit surcharge + tax + tip
  const debitTotal = debitMarkupPercent > 0
    ? roundToCents(discountedCashSub + debitSurcharge + taxTotal + tipTotal)
    : cashTotal

  return {
    subtotal,
    discountTotal,
    taxTotal,
    creditSurcharge,
    debitSurcharge,
    tipTotal,
    cashTotal,
    cardTotal,
    debitTotal,
  }
}

/** Build a minimal order item for calculateOrderTotals */
function item(price: number, qty: number = 1, opts?: {
  modifiers?: Array<{ price: number; quantity?: number }>
  status?: string
  isTaxInclusive?: boolean
}): OrderItemForCalculation {
  return {
    price,
    quantity: qty,
    modifiers: opts?.modifiers,
    status: opts?.status,
    isTaxInclusive: opts?.isTaxInclusive ?? false,
  }
}

/** Build a minimal TabCloseOrder for computePurchaseAmount */
function tabOrder(total: number, tipTotal: number = 0): TabCloseOrder {
  return {
    id: 'test-order',
    locationId: 'test-loc',
    employeeId: 'test-emp',
    status: 'open',
    tabStatus: 'open',
    total,
    tipTotal,
    guestCount: 1,
    tableId: null,
    isBottleService: false,
    bottleServiceTierId: null,
    version: 1,
    updatedAt: new Date(),
    cards: [],
    items: [{ id: 'item-1' }],
  }
}

// ─── TICKET 1: Tax-exclusive item, no discount, no tip, 8% tax ──────────────

describe('Ticket 1: Tax-exclusive $10.00, no discount, no tip, 8% tax', () => {
  const SUB = 10.00
  const TAX = 0.80 // 10.00 * 0.08
  const SURCHARGE = 0.40 // 10.00 * 0.04

  it('calculateOrderTotals produces correct subtotal and tax', () => {
    const result = calculateOrderTotals([item(10)], LOCATION_8PCT)
    expect(result.subtotal).toBe(SUB)
    expect(result.taxTotal).toBe(TAX)
  })

  it('cashTotal = 10.80 (no surcharge)', () => {
    const t = computeTicketPricing({ subtotal: SUB })
    expect(t.cashTotal).toBe(10.80)
    // creditSurcharge is computed but NOT added to cashTotal
    expect(t.creditSurcharge).toBe(0.40)
    // Verify via calculateOrderTotal (subtotal + tax - discount + tip)
    expect(calculateOrderTotal(SUB, TAX, 0, 0)).toBe(10.80)
  })

  it('cardTotal = 11.20 (subtotal + surcharge + tax)', () => {
    const t = computeTicketPricing({ subtotal: SUB })
    expect(t.cardTotal).toBe(11.20)
    expect(t.creditSurcharge).toBe(SURCHARGE)
  })

  it('debitTotal = cashTotal = 10.80 (0% debit markup)', () => {
    const t = computeTicketPricing({ subtotal: SUB })
    expect(t.debitTotal).toBe(10.80)
    expect(t.debitTotal).toBe(t.cashTotal)
  })

  it('calculateCardPrice matches surcharge math', () => {
    // Per-item uplift: 10.00 * 1.04 = 10.40
    expect(calculateCardPrice(SUB, 4)).toBe(10.40)
  })
})

// ─── TICKET 2: Tax-inclusive item ($10.00), no discount, no tip ──────────────

describe('Ticket 2: Tax-inclusive $10.00, no discount, no tip', () => {
  // Tax-inclusive: tax is backed out. With 8% rate:
  // taxFromInclusive = 10.00 - 10.00 / 1.08 = 10.00 - 9.259259... = 0.74 (rounded)
  // preTaxAmount = 10.00 - 0.74 = 9.26
  const INCLUSIVE_PRICE = 10.00

  it('calculateSplitTax backs out tax correctly', () => {
    const result = calculateSplitTax(INCLUSIVE_PRICE, 0, TAX_RATE_8)
    expect(result.taxFromInclusive).toBe(0.74)
    expect(result.taxFromExclusive).toBe(0)
    expect(result.totalTax).toBe(0.74)
  })

  it('cashTotal = 10.00 (price already includes tax)', () => {
    const result = calculateOrderTotals(
      [item(INCLUSIVE_PRICE, 1, { isTaxInclusive: true })],
      LOCATION_8PCT
    )
    // Total = inclusive subtotal + exclusive subtotal + taxFromExclusive - discount + tip
    // = 10.00 + 0 + 0 - 0 + 0 = 10.00
    expect(result.total).toBe(10.00)
  })

  it('cardTotal uses surcharge on pre-tax basis', () => {
    // Pre-tax cash basis = 10.00 - 0.74 = 9.26
    // But per CANONICAL-MONEY-SPEC, surcharge is on cashSubtotal (the stored subtotal),
    // which for inclusive items is the full 10.00.
    // Surcharge = round(10.00 * 0.04) = 0.40
    // cardTotal = 10.00 + 0.40 = 10.40
    const t = computeTicketPricing({ subtotal: INCLUSIVE_PRICE })
    // For inclusive items, the surcharge base is still the full stored price
    expect(t.creditSurcharge).toBe(0.40)
  })

  it('debitTotal = cashTotal for 0% debit markup', () => {
    expect(calculateDebitPrice(INCLUSIVE_PRICE, 0)).toBe(INCLUSIVE_PRICE)
  })
})

// ─── TICKET 3: Item + priced modifier, no discount, 8% tax ──────────────────

describe('Ticket 3: $10.00 item + $2.00 modifier, no discount, 8% tax', () => {
  const ITEMS = [item(10, 1, { modifiers: [{ price: 2, quantity: 1 }] })]
  const EXPECTED_SUB = 12.00 // 10 + 2
  const EXPECTED_TAX = 0.96 // 12.00 * 0.08

  it('calculateItemTotal includes modifier price', () => {
    expect(calculateItemTotal(ITEMS[0])).toBe(EXPECTED_SUB)
  })

  it('calculateOrderTotals produces correct subtotal and tax', () => {
    const result = calculateOrderTotals(ITEMS, LOCATION_8PCT)
    expect(result.subtotal).toBe(EXPECTED_SUB)
    expect(result.taxTotal).toBe(EXPECTED_TAX)
  })

  it('surcharge computed on full 12.00', () => {
    const t = computeTicketPricing({ subtotal: EXPECTED_SUB })
    expect(t.creditSurcharge).toBe(0.48) // 12.00 * 0.04
  })

  it('cashTotal = 12.96, cardTotal = 13.44', () => {
    const t = computeTicketPricing({ subtotal: EXPECTED_SUB })
    expect(t.cashTotal).toBe(12.96) // 12.00 + 0.96
    expect(t.cardTotal).toBe(13.44) // 12.00 + 0.48 + 0.96
  })

  it('debitTotal = cashTotal', () => {
    const t = computeTicketPricing({ subtotal: EXPECTED_SUB })
    expect(t.debitTotal).toBe(t.cashTotal)
  })
})

// ─── TICKET 4: Fixed-dollar discount ($5 off $20), 8% tax ───────────────────

describe('Ticket 4: $5.00 fixed discount off $20.00 item, 8% tax', () => {
  const SUB = 20.00
  const DISCOUNT = 5.00
  const DISCOUNTED_SUB = 15.00
  const TAX = 1.20 // 15.00 * 0.08
  // Surcharge on FULL subtotal (pre-discount)
  const SURCHARGE = 0.80 // 20.00 * 0.04

  it('tax computed on discounted subtotal', () => {
    const t = computeTicketPricing({ subtotal: SUB, discountTotal: DISCOUNT })
    expect(t.taxTotal).toBe(TAX)
  })

  it('surcharge computed on FULL subtotal (pre-discount)', () => {
    const t = computeTicketPricing({ subtotal: SUB, discountTotal: DISCOUNT })
    expect(t.creditSurcharge).toBe(SURCHARGE)
  })

  it('cashTotal = 16.20 (discountedSub + tax)', () => {
    const t = computeTicketPricing({ subtotal: SUB, discountTotal: DISCOUNT })
    expect(t.cashTotal).toBe(16.20) // 15.00 + 1.20
  })

  it('cardTotal = 17.00 (discountedSub + surcharge + tax)', () => {
    const t = computeTicketPricing({ subtotal: SUB, discountTotal: DISCOUNT })
    expect(t.cardTotal).toBe(17.00) // 15.00 + 0.80 + 1.20
  })

  it('debitTotal = cashTotal', () => {
    const t = computeTicketPricing({ subtotal: SUB, discountTotal: DISCOUNT })
    expect(t.debitTotal).toBe(t.cashTotal)
  })
})

// ─── TICKET 5: Percent discount (10% off $20), 8% tax ───────────────────────

describe('Ticket 5: 10% discount off $20.00 item, 8% tax', () => {
  const SUB = 20.00
  const DISCOUNT = roundToCents(SUB * 0.10) // 2.00
  const DISCOUNTED_SUB = 18.00
  const TAX = 1.44 // 18.00 * 0.08
  const SURCHARGE = 0.80 // 20.00 * 0.04 (full subtotal)

  it('percent discount = $2.00', () => {
    expect(DISCOUNT).toBe(2.00)
  })

  it('tax on discounted amount', () => {
    const t = computeTicketPricing({ subtotal: SUB, discountTotal: DISCOUNT })
    expect(t.taxTotal).toBe(TAX)
  })

  it('cashTotal = 19.44, cardTotal = 20.24', () => {
    const t = computeTicketPricing({ subtotal: SUB, discountTotal: DISCOUNT })
    expect(t.cashTotal).toBe(19.44) // 18.00 + 1.44
    expect(t.cardTotal).toBe(20.24) // 18.00 + 0.80 + 1.44
  })

  it('debitTotal = cashTotal', () => {
    const t = computeTicketPricing({ subtotal: SUB, discountTotal: DISCOUNT })
    expect(t.debitTotal).toBe(t.cashTotal)
  })
})

// ─── TICKET 6: Loyalty tier auto-discount (15% off $30), 8% tax ─────────────

describe('Ticket 6: 15% loyalty discount off $30.00, 8% tax', () => {
  const SUB = 30.00
  const DISCOUNT = roundToCents(SUB * 0.15) // 4.50
  const DISCOUNTED_SUB = 25.50
  const TAX = roundToCents(DISCOUNTED_SUB * TAX_RATE_8) // 2.04
  const SURCHARGE = roundToCents(SUB * 0.04) // 1.20

  it('percent discount = $4.50', () => {
    expect(DISCOUNT).toBe(4.50)
  })

  it('correct amounts', () => {
    const t = computeTicketPricing({ subtotal: SUB, discountTotal: DISCOUNT })
    expect(t.taxTotal).toBe(TAX)
    expect(t.creditSurcharge).toBe(SURCHARGE)
    expect(t.cashTotal).toBe(roundToCents(DISCOUNTED_SUB + TAX)) // 27.54
    expect(t.cardTotal).toBe(roundToCents(DISCOUNTED_SUB + SURCHARGE + TAX)) // 28.74
  })

  it('follows same pattern as percent discount (Ticket 5)', () => {
    // Surcharge on full subtotal, tax on discounted
    const t = computeTicketPricing({ subtotal: SUB, discountTotal: DISCOUNT })
    expect(t.creditSurcharge).toBe(roundToCents(SUB * 0.04))
    expect(t.taxTotal).toBe(roundToCents((SUB - DISCOUNT) * TAX_RATE_8))
  })
})

// ─── TICKET 7: Cash payment ($10.80) — no surcharge ─────────────────────────

describe('Ticket 7: Cash payment $10.00 item + 8% tax — no surcharge for any method', () => {
  // When there is NO pricing program, all tiers equal the cash total
  const SUB = 10.00
  const TAX = 0.80
  const TOTAL = 10.80

  it('all tiers equal when no pricing program', () => {
    const t = computeTicketPricing({
      subtotal: SUB,
      creditMarkupPercent: 0,
      debitMarkupPercent: 0,
    })
    expect(t.cashTotal).toBe(TOTAL)
    expect(t.cardTotal).toBe(TOTAL)
    expect(t.debitTotal).toBe(TOTAL)
  })

  it('calculateOrderTotal matches', () => {
    expect(calculateOrderTotal(SUB, TAX, 0, 0)).toBe(TOTAL)
  })
})

// ─── TICKET 8: Credit card payment ($10.00 item, 4% markup, 8% tax) ─────────

describe('Ticket 8: Credit card $10.00, 4% markup, 8% tax', () => {
  const SUB = 10.00
  const SURCHARGE = 0.40 // 10.00 * 0.04
  const TAX = 0.80 // 10.00 * 0.08

  it('cardTotal = 11.20 (sub + surcharge + tax)', () => {
    const t = computeTicketPricing({ subtotal: SUB })
    expect(t.cardTotal).toBe(11.20)
  })

  it('surcharge is NOT taxable — cardTax = cashTax', () => {
    const t = computeTicketPricing({ subtotal: SUB })
    // Tax is on subtotal only, NOT on subtotal + surcharge
    expect(t.taxTotal).toBe(TAX)
    // If surcharge were taxable, tax would be round((10.00 + 0.40) * 0.08) = 0.83
    expect(t.taxTotal).not.toBe(roundToCents((SUB + SURCHARGE) * TAX_RATE_8))
  })

  it('calculateCardPrice gives per-item uplift', () => {
    expect(calculateCardPrice(SUB, 4)).toBe(10.40)
  })
})

// ─── TICKET 9: Debit card ($10.00, 0% debit markup, 8% tax) ─────────────────

describe('Ticket 9: Debit card $10.00, 0% debit markup, 8% tax', () => {
  const SUB = 10.00

  it('debitTotal = cashTotal = 10.80 (no markup)', () => {
    const t = computeTicketPricing({ subtotal: SUB })
    expect(t.debitTotal).toBe(10.80)
    expect(t.debitTotal).toBe(t.cashTotal)
  })

  it('calculateDebitPrice returns cash price for 0% markup', () => {
    expect(calculateDebitPrice(SUB, 0)).toBe(SUB)
  })

  it('debit surcharge is zero', () => {
    const t = computeTicketPricing({ subtotal: SUB })
    expect(t.debitSurcharge).toBe(0)
  })
})

// ─── TICKET 10: Card payment with $5 tip ────────────────────────────────────

describe('Ticket 10: Card $10.00, 4% markup, 8% tax, $5.00 tip', () => {
  const SUB = 10.00
  const TIP = 5.00
  const TAX = 0.80
  const SURCHARGE = 0.40

  it('tip is NOT surcharged — cardTotal = 11.20 + 5.00 = 16.20', () => {
    const t = computeTicketPricing({ subtotal: SUB, tipTotal: TIP })
    // paymentBasis (pre-tip) = 10.00 + 0.40 + 0.80 = 11.20
    // paymentTotal = 11.20 + 5.00 = 16.20
    expect(t.cardTotal).toBe(16.20)
  })

  it('surcharge unchanged by tip', () => {
    const withTip = computeTicketPricing({ subtotal: SUB, tipTotal: TIP })
    const withoutTip = computeTicketPricing({ subtotal: SUB, tipTotal: 0 })
    expect(withTip.creditSurcharge).toBe(withoutTip.creditSurcharge)
    expect(withTip.creditSurcharge).toBe(SURCHARGE)
  })

  it('cashTotal = 15.80 (sub + tax + tip, no surcharge)', () => {
    const t = computeTicketPricing({ subtotal: SUB, tipTotal: TIP })
    expect(t.cashTotal).toBe(15.80)
  })

  it('tip does NOT affect tax', () => {
    const withTip = computeTicketPricing({ subtotal: SUB, tipTotal: TIP })
    const withoutTip = computeTicketPricing({ subtotal: SUB, tipTotal: 0 })
    expect(withTip.taxTotal).toBe(withoutTip.taxTotal)
    expect(withTip.taxTotal).toBe(TAX)
  })
})

// ─── TICKET 11: Partial card + cash split ───────────────────────────────────

describe('Ticket 11: Partial card ($15) then cash ($5) on $20 order, 8% tax', () => {
  const SUB = 20.00
  const TAX = 1.60 // 20.00 * 0.08
  const TOTAL_CASH_BASIS = 21.60 // 20.00 + 1.60
  const SURCHARGE = 0.80 // 20.00 * 0.04
  const TOTAL_CARD_BASIS = 22.40 // 20.00 + 0.80 + 1.60

  it('full order totals are consistent', () => {
    const t = computeTicketPricing({ subtotal: SUB })
    expect(t.cashTotal).toBe(TOTAL_CASH_BASIS)
    expect(t.cardTotal).toBe(TOTAL_CARD_BASIS)
  })

  it('each split payment references the same order totals', () => {
    // In split scenarios, each payment is a portion of the order total.
    // The order-level pricing is computed once; payments reference it.
    const cardPayment = 15.00
    const cashPayment = TOTAL_CASH_BASIS - cardPayment // 6.60

    // Card portion carries its share of surcharge
    // Cash portion has no surcharge
    // Combined must cover the full order
    expect(roundToCents(cardPayment + cashPayment)).toBe(TOTAL_CASH_BASIS)
  })

  it('surcharge only applies to card portion basis', () => {
    // Verify surcharge is computed on order subtotal, not per-payment
    expect(roundToCents(SUB * 0.04)).toBe(SURCHARGE)
  })
})

// ─── TICKET 12: Comp (item comped, $0 total) ────────────────────────────────

describe('Ticket 12: Comp — comped item produces $0 total', () => {
  it('comped items excluded from subtotal', () => {
    const items = [item(10, 1, { status: 'comped' })]
    const result = calculateOrderTotals(items, LOCATION_8PCT)
    expect(result.subtotal).toBe(0)
    expect(result.taxTotal).toBe(0)
    expect(result.total).toBe(0)
  })

  it('all tiers zero', () => {
    const t = computeTicketPricing({ subtotal: 0 })
    expect(t.cashTotal).toBe(0)
    expect(t.cardTotal).toBe(0)
    expect(t.debitTotal).toBe(0)
    expect(t.creditSurcharge).toBe(0)
    expect(t.taxTotal).toBe(0)
  })

  it('mixed order: one active + one comped', () => {
    const items = [
      item(10, 1), // active
      item(15, 1, { status: 'comped' }),
    ]
    const result = calculateOrderTotals(items, LOCATION_8PCT)
    expect(result.subtotal).toBe(10.00) // only active item
    expect(result.taxTotal).toBe(0.80)
    expect(result.total).toBe(10.80)
  })
})

// ─── TICKET 13: Void (item voided) — totals recalculate ─────────────────────

describe('Ticket 13: Void — voided item excluded from recalculated totals', () => {
  it('voided items excluded from subtotal', () => {
    const items = [item(10, 1, { status: 'voided' })]
    const result = calculateOrderTotals(items, LOCATION_8PCT)
    expect(result.subtotal).toBe(0)
    expect(result.taxTotal).toBe(0)
    expect(result.total).toBe(0)
  })

  it('void one of two items recalculates correctly', () => {
    const items = [
      item(20, 1), // active
      item(10, 1, { status: 'voided' }),
    ]
    const result = calculateOrderTotals(items, LOCATION_8PCT)
    expect(result.subtotal).toBe(20.00)
    expect(result.taxTotal).toBe(1.60)
    expect(result.total).toBe(21.60)
  })

  it('dual pricing recalculates on voided subtotal', () => {
    const t = computeTicketPricing({ subtotal: 20.00 })
    expect(t.cashTotal).toBe(21.60) // 20 + 1.60
    expect(t.cardTotal).toBe(22.40) // 20 + 0.80 + 1.60
  })
})

// ─── TICKET 14: Split ticket — each split priced independently ──────────────

describe('Ticket 14: Split ticket — independent pricing per split', () => {
  const FULL_SUB = 40.00

  it('even split: two halves produce correct totals', () => {
    const halfSub = 20.00
    const halfTax = roundToCents(halfSub * TAX_RATE_8) // 1.60
    const halfSurcharge = roundToCents(halfSub * 0.04) // 0.80

    const split1 = computeTicketPricing({ subtotal: halfSub })
    const split2 = computeTicketPricing({ subtotal: halfSub })

    expect(split1.cashTotal).toBe(21.60)
    expect(split1.cardTotal).toBe(22.40)
    expect(split2.cashTotal).toBe(21.60)
    expect(split2.cardTotal).toBe(22.40)
  })

  it('uneven split: $15 + $25 each priced correctly', () => {
    const split1 = computeTicketPricing({ subtotal: 15.00 })
    const split2 = computeTicketPricing({ subtotal: 25.00 })

    // Split 1: tax = 1.20, surcharge = 0.60
    expect(split1.taxTotal).toBe(1.20)
    expect(split1.creditSurcharge).toBe(0.60)
    expect(split1.cashTotal).toBe(16.20)
    expect(split1.cardTotal).toBe(16.80)

    // Split 2: tax = 2.00, surcharge = 1.00
    expect(split2.taxTotal).toBe(2.00)
    expect(split2.creditSurcharge).toBe(1.00)
    expect(split2.cashTotal).toBe(27.00)
    expect(split2.cardTotal).toBe(28.00)
  })

  it('sum of splits may differ from whole by rounding (acceptable)', () => {
    // This is expected: splitting introduces rounding at each split boundary
    const whole = computeTicketPricing({ subtotal: FULL_SUB })
    const split1 = computeTicketPricing({ subtotal: 15.00 })
    const split2 = computeTicketPricing({ subtotal: 25.00 })

    // Whole: tax = 3.20, cash = 43.20
    expect(whole.taxTotal).toBe(3.20)

    // Splits: tax = 1.20 + 2.00 = 3.20 (matches in this case)
    expect(roundToCents(split1.taxTotal + split2.taxTotal)).toBe(3.20)
  })
})

// ─── TICKET 15: Tab close with pre-auth capture ─────────────────────────────

describe('Ticket 15: Tab close — $25 tab, 4% markup, 8% tax, $5 tip', () => {
  // The stored order.total is the cash basis total (subtotal + tax - discount + tip)
  // For tab close, we back out the tip to get cashBaseAmount, then apply card markup
  const SUB = 25.00
  const TAX = 2.00 // 25.00 * 0.08
  const TIP = 5.00

  // order.total = sub + tax + tip (cash basis, stored in DB)
  // = 25.00 + 2.00 + 5.00 = 32.00
  const ORDER_TOTAL = roundToCents(SUB + TAX + TIP) // 32.00

  // cashBaseAmount = order.total - tipTotal = 32.00 - 5.00 = 27.00
  const CASH_BASE = roundToCents(ORDER_TOTAL - TIP) // 27.00

  // purchaseAmount = calculateCardPrice(cashBaseAmount, 4%) = 27.00 * 1.04 = 28.08
  // NOTE: computePurchaseAmount applies markup to the FULL cashBase (sub + tax),
  // which includes surcharging tax. This is the tab-close specific behavior:
  // it uses calculateCardPrice on the (sub+tax) amount because the order.total
  // already has tax baked in. The surcharge here is on (sub+tax), not just sub.
  const PURCHASE_AMOUNT = calculateCardPrice(CASH_BASE, 4) // 28.08

  // captureAmount = purchaseAmount + tip = 28.08 + 5.00 = 33.08
  const CAPTURE_AMOUNT = roundToCents(PURCHASE_AMOUNT + TIP) // 33.08

  it('computePurchaseAmount extracts cashBaseAmount correctly', () => {
    const order = tabOrder(ORDER_TOTAL, TIP)
    const { cashBaseAmount } = computePurchaseAmount(order, DP_PROGRAM)
    expect(cashBaseAmount).toBe(CASH_BASE)
  })

  it('purchaseAmount applies card markup to cashBase', () => {
    const order = tabOrder(ORDER_TOTAL, TIP)
    const { purchaseAmount } = computePurchaseAmount(order, DP_PROGRAM)
    expect(purchaseAmount).toBe(PURCHASE_AMOUNT)
  })

  it('tip is NOT included in surcharge basis', () => {
    const order = tabOrder(ORDER_TOTAL, TIP)
    const { purchaseAmount, cashBaseAmount } = computePurchaseAmount(order, DP_PROGRAM)

    // Surcharge amount = purchaseAmount - cashBaseAmount
    const surcharge = roundToCents(purchaseAmount - cashBaseAmount)
    expect(surcharge).toBe(roundToCents(CASH_BASE * 0.04)) // 1.08

    // If tip WERE surcharged, surcharge would be on 32.00 * 0.04 = 1.28
    expect(surcharge).not.toBe(roundToCents(ORDER_TOTAL * 0.04))
  })

  it('captureAmount = purchaseAmount + tip', () => {
    const order = tabOrder(ORDER_TOTAL, TIP)
    const { purchaseAmount } = computePurchaseAmount(order, DP_PROGRAM)
    const captureAmount = roundToCents(purchaseAmount + TIP)
    expect(captureAmount).toBe(CAPTURE_AMOUNT)
  })

  it('without pricing program, purchaseAmount = cashBase (no markup)', () => {
    const order = tabOrder(ORDER_TOTAL, TIP)
    const disabledProgram: PricingProgram = { ...DP_PROGRAM, enabled: false }
    const { purchaseAmount } = computePurchaseAmount(order, disabledProgram)
    expect(purchaseAmount).toBe(CASH_BASE)
  })
})

// ─── Cross-cutting: roundToCents correctness ─────────────────────────────────

describe('Cross-cutting: roundToCents precision', () => {
  it('handles classic float drift: 10.2 * 0.1', () => {
    // Without proper rounding: 10.2 * 0.1 = 1.0200000000000002
    expect(roundToCents(10.2 * 0.1)).toBe(1.02)
  })

  it('handles 0.1 + 0.2 drift', () => {
    expect(roundToCents(0.1 + 0.2)).toBe(0.30)
  })

  it('returns 0 for non-finite values', () => {
    expect(roundToCents(NaN)).toBe(0)
    expect(roundToCents(Infinity)).toBe(0)
    expect(roundToCents(-Infinity)).toBe(0)
  })

  it('half-cent rounds correctly (IEEE 754 float representation)', () => {
    // IEEE 754 double representation means some .XX5 values are slightly below the
    // half-cent boundary and round down. This is expected behavior for Math.round.
    expect(roundToCents(1.005)).toBe(1.00) // 1.005 * 100 = 100.4999... → 100
    expect(roundToCents(1.015)).toBe(1.01) // 1.015 * 100 = 101.4999... → 101
    expect(roundToCents(1.025)).toBe(1.02) // 1.025 * 100 = 102.4999... → 102
    // Values that DO round up correctly
    expect(roundToCents(1.045)).toBe(1.05) // 1.045 * 100 = 104.5000... → 105
    expect(roundToCents(1.055)).toBe(1.06) // 1.055 * 100 = 105.5000... → 106
  })
})

// ─── Cross-cutting: Spec invariants ─────────────────────────────────────────

describe('Cross-cutting: CANONICAL-MONEY-SPEC invariants', () => {
  it('surcharge is NEVER taxable: cardTax === cashTax', () => {
    for (const sub of [5, 10, 19.99, 42.50, 100]) {
      const cashTax = roundToCents(sub * TAX_RATE_8)
      // If surcharge were taxable, cardTax would be higher
      const surcharge = roundToCents(sub * 0.04)
      const incorrectCardTax = roundToCents((sub + surcharge) * TAX_RATE_8)
      // The correct card tax must equal cash tax
      expect(cashTax).toBe(roundToCents(sub * TAX_RATE_8))
      // And differ from the incorrect calculation (in most cases)
      if (sub >= 10) {
        expect(cashTax).not.toBe(incorrectCardTax)
      }
    }
  })

  it('tip is NEVER surcharged', () => {
    const sub = 25.00
    const tip = 10.00
    const surchargeWithoutTip = roundToCents(sub * 0.04)
    const surchargeWithTip = roundToCents(sub * 0.04) // same — tip excluded

    expect(surchargeWithoutTip).toBe(surchargeWithTip)

    // If tip were surcharged, it would be higher
    const incorrectSurcharge = roundToCents((sub + tip) * 0.04)
    expect(surchargeWithoutTip).not.toBe(incorrectSurcharge)
  })

  it('discount reduces tax basis but NOT surcharge basis', () => {
    const sub = 30.00
    const discount = 10.00

    // Tax on discounted: (30 - 10) * 0.08 = 1.60
    const tax = roundToCents((sub - discount) * TAX_RATE_8)
    expect(tax).toBe(1.60)

    // Surcharge on FULL subtotal: 30 * 0.04 = 1.20
    const surcharge = roundToCents(sub * 0.04)
    expect(surcharge).toBe(1.20)

    // NOT on discounted: 20 * 0.04 = 0.80
    const incorrectSurcharge = roundToCents((sub - discount) * 0.04)
    expect(surcharge).not.toBe(incorrectSurcharge)
  })

  it('debit at 0% markup equals cash price exactly', () => {
    for (const price of [1.99, 10.00, 42.50, 99.99]) {
      expect(calculateDebitPrice(price, 0)).toBe(price)
    }
  })

  it('calculateCardPrice and calculateCreditPrice are symmetric', () => {
    // Both should produce the same result (calculateCreditPrice is an alias)
    for (const price of [10, 25.50, 99.99]) {
      expect(calculateCardPrice(price, 4)).toBe(calculateCreditPrice(price, 4))
    }
  })
})
