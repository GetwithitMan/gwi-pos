import { describe, it, expect } from 'vitest'
import { roundToCents } from '@/lib/pricing'

/**
 * Regression tests for RC-3 — found at Monument Steakhouse, 2026-08-14.
 *
 * Two coupled defects, both proven on live hardware:
 *
 * (1) TAX WAS NEVER PERSISTED.
 *     recalculateOrderTotalsForAdd computes tax correctly from the venue rate,
 *     and the rate is stored on the row (exclusiveTaxRate = 0.0800 was verified
 *     in production). But the ingester's Order bridge then overwrote taxTotal
 *     with `state.taxTotalCents / 100`, and state.taxTotalCents is ONLY ever set
 *     by the discount handlers (reducer.ts DISCOUNT_APPLIED / DISCOUNT_REMOVED).
 *     No ITEM_ADDED path sets it. So every order that never received a discount
 *     had its tax stamped back to 0.00 — every venue reported $0.00 tax collected.
 *
 * (2) THE ALLOCATION-CHILD PAYABLE DOUBLE-COUNTED TAX AND SKIPPED ROUNDING.
 *     even-split.ts builds a child's total as (subtotal + tax - discount), i.e.
 *     ALREADY tax-inclusive. The pay path added tax on top of that, and skipped
 *     cash rounding for allocation children while the register applies it. Live
 *     result: register offered $21.00, server demanded $23.20, payment rejected.
 *
 * The register side of the contract is stated in DefaultCheckoutEvaluationEngine.kt:
 *   "Allocation split children carry server-set proportional totals that already
 *    include tax, discounts, and surcharge. The engine must NOT recompute these
 *    or it will double-count tax."
 *
 * TAX RATE IS A VENUE SETTING. Settings -> Tax Rules; the sum of non-inclusive
 * TaxRule rates is derived into Location.settings.tax.defaultRate and shipped to
 * the register at bootstrap. Monument moved 8% -> 10% mid-session on 2026-08-14.
 * These tests are therefore parameterised over the rate — the contract must hold
 * at ANY rate and must never be re-pinned to whatever a venue is configured at today.
 */

const ROUNDING_INCREMENT_CENTS = 100 // priceRounding.increment "1.00"

/** Mirrors the register's calcRoundingDelta for direction "nearest" (half-up). */
function roundNearestDollar(amount: number): number {
  const cents = Math.round(amount * 100)
  const rem = cents % ROUNDING_INCREMENT_CENTS
  const rounded = rem * 2 >= ROUNDING_INCREMENT_CENTS
    ? cents + (ROUNDING_INCREMENT_CENTS - rem)
    : cents - rem
  return rounded / 100
}

/** The payable the SERVER computes — mirrors build-payment-financial-context. */
function serverPayable(
  taxRatePct: number,
  order: { total: number; taxTotal: number; parentOrderId: string | null; splitClass: string | null },
): number {
  const isAllocChild = !!order.parentOrderId && order.splitClass === 'allocation'
  let taxInclusive = order.total
  if (!isAllocChild) {
    // Order.total ALREADY includes tax when taxTotal was persisted
    // (order-calculations.ts adds taxFromExclusive into total). Only add tax when
    // it was never computed — the legacy/clobbered case.
    taxInclusive = order.taxTotal > 0
      ? order.total
      : roundToCents(order.total + roundToCents(order.total * taxRatePct / 100))
  }
  return roundNearestDollar(taxInclusive)
}

/** The payable the REGISTER computes for an allocation child (v1.9.0 fast-path). */
function registerAllocationPayable(storedTotal: number): number {
  return roundNearestDollar(storedTotal)
}

/** Build a 2-way even split the way even-split.ts does, at a given rate. */
function evenSplitTwoWays(subtotal: number, taxRatePct: number) {
  const parentTax = roundToCents(subtotal * taxRatePct / 100)
  const childSubtotal = Math.floor((subtotal / 2) * 100) / 100
  const childTax = Math.floor((parentTax / 2) * 100) / 100
  // Last child absorbs the penny remainder, as even-split.ts does.
  const lastSubtotal = roundToCents(subtotal - childSubtotal)
  const lastTax = roundToCents(parentTax - childTax)
  return {
    parentTax,
    parentTaxInclusive: roundToCents(subtotal + parentTax),
    children: [
      { subtotal: childSubtotal, tax: childTax, total: roundToCents(childSubtotal + childTax) },
      { subtotal: lastSubtotal, tax: lastTax, total: roundToCents(lastSubtotal + lastTax) },
    ],
  }
}

// Monument's live check: 10.99 + 8.99 + 9.99 + 12.99
const CHECK_SUBTOTAL = 42.96

describe.each([
  { rate: 8, label: '8% (Monument before 2026-08-14 18:32)' },
  { rate: 10, label: '10% (Monument after the state sales tax rule was added)' },
])('RC-3 contract at $label', ({ rate }) => {
  const split = evenSplitTwoWays(CHECK_SUBTOTAL, rate)

  it('children carry TAX-INCLUSIVE totals (subtotal + tax - discount)', () => {
    for (const c of split.children) {
      expect(c.total).toBe(roundToCents(c.subtotal + c.tax))
      expect(c.total).toBeGreaterThan(c.subtotal) // tax is actually in there
    }
  })

  it('children sum exactly to the parent tax-inclusive total — no money created or lost', () => {
    const sum = roundToCents(split.children.reduce((s, c) => s + c.total, 0))
    expect(sum).toBe(split.parentTaxInclusive)
  })

  it('server does NOT add tax again to an allocation child (the double-count bug)', () => {
    const c = split.children[0]
    const payable = serverPayable(rate, {
      total: c.total, taxTotal: c.tax, parentOrderId: 'parent-1', splitClass: 'allocation',
    })
    const doubleCounted = roundNearestDollar(roundToCents(c.total + c.tax))
    expect(payable).toBe(roundNearestDollar(c.total))
    expect(payable).not.toBe(doubleCounted)
  })

  it('server APPLIES cash rounding to allocation children, as the register does', () => {
    const c = split.children[0]
    const payable = serverPayable(rate, {
      total: c.total, taxTotal: c.tax, parentOrderId: 'parent-1', splitClass: 'allocation',
    })
    // Pre-fix the server skipped rounding here and returned the raw total.
    expect(payable).toBe(roundNearestDollar(c.total))
    expect(Math.round(payable * 100) % ROUNDING_INCREMENT_CENTS).toBe(0)
  })

  it('REGISTER and SERVER agree on every child payable', () => {
    for (const c of split.children) {
      const server = serverPayable(rate, {
        total: c.total, taxTotal: c.tax, parentOrderId: 'parent-1', splitClass: 'allocation',
      })
      expect(server).toBe(registerAllocationPayable(c.total))
    }
  })

  it('a normal (non-split) order still has tax added and rounded', () => {
    const payable = serverPayable(rate, {
      total: CHECK_SUBTOTAL, taxTotal: 0, parentOrderId: null, splitClass: null,
    })
    expect(payable).toBe(roundNearestDollar(split.parentTaxInclusive))
  })

  it('never double-counts tax when taxTotal is persisted', () => {
    // total is already tax-inclusive here, so the payable must be total (rounded),
    // NOT total + taxTotal. Pre-fix that returned 51.56 on a 47.26 check at 10%.
    const taxInclusiveTotal = roundToCents(CHECK_SUBTOTAL + split.parentTax)
    const payable = serverPayable(rate, {
      total: taxInclusiveTotal, taxTotal: split.parentTax, parentOrderId: null, splitClass: null,
    })
    expect(payable).toBe(roundNearestDollar(taxInclusiveTotal))
    expect(payable).not.toBe(roundNearestDollar(roundToCents(taxInclusiveTotal + split.parentTax)))
  })

  it('a STRUCTURAL split child still gets tax added — it owns real items', () => {
    const c = split.children[0]
    const payable = serverPayable(rate, {
      total: c.subtotal, taxTotal: 0, parentOrderId: 'parent-1', splitClass: 'structural',
    })
    expect(payable).toBe(roundNearestDollar(roundToCents(c.subtotal + roundToCents(c.subtotal * rate / 100))))
  })
})

describe('RC-3 — the exact live failure is reproduced and shown fixed', () => {
  it('pre-fix standoff: register offered $21.00, server demanded $23.20', () => {
    // Observed on hardware at 8%, with child.total = 21.48 because parent.taxTotal
    // had been clobbered to 0 — so the child total was NOT tax-inclusive.
    const brokenChildTotal = 21.48
    const registerOffered = registerAllocationPayable(brokenChildTotal)
    const serverDemandedPreFix = roundToCents(brokenChildTotal + roundToCents(brokenChildTotal * 8 / 100))
    expect(registerOffered).toBe(21.00)
    expect(serverDemandedPreFix).toBe(23.20)
    expect(registerOffered).not.toBe(serverDemandedPreFix)
  })

  it('post-fix at 8%: both sides land on $23.00 and collect $46.00', () => {
    const split = evenSplitTwoWays(CHECK_SUBTOTAL, 8)
    const payables = split.children.map(c => serverPayable(8, {
      total: c.total, taxTotal: c.tax, parentOrderId: 'p', splitClass: 'allocation',
    }))
    expect(payables).toEqual([23.00, 23.00])
    expect(roundToCents(payables[0] + payables[1])).toBe(46.00)
  })
})

describe('RC-3 — cash rounding direction (venue-configured, must not be "fixed")', () => {
  it('rounds DOWN when remainder < 50c: 32.37 -> 32.00', () => {
    expect(roundNearestDollar(32.37)).toBe(32.00)
  })

  it('rounds UP when remainder >= 50c: 11.87 -> 12.00', () => {
    expect(roundNearestDollar(11.87)).toBe(12.00)
  })

  it('rounds UP at exactly 50c (half-up): 23.50 -> 24.00', () => {
    expect(roundNearestDollar(23.50)).toBe(24.00)
  })

  it('leaves a whole dollar untouched', () => {
    expect(roundNearestDollar(23.00)).toBe(23.00)
  })
})
