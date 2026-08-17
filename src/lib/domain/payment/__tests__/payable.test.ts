import { describe, it, expect } from 'vitest'
import { computePayable, computeTaxInclusiveTotal, isAllocationSplitChild } from '../payable'
import type { PayableSettings } from '../payable'

/**
 * Pins the authoritative payable — the single source of truth now shared by the
 * payment path and (Phase 0) by order reads.
 *
 * Every case below was observed on real hardware at Monument between
 * 2026-08-14 and 2026-08-17, or read directly from production rows. If this file
 * and the register ever disagree again, one of them is wrong and this is the
 * arbiter.
 */

// Monument, verified from Location.settings.
const MONUMENT: PayableSettings = {
  tax: { defaultRate: 10 },
  priceRounding: {
    enabled: true, increment: '1.00', direction: 'nearest',
    applyToCash: true, applyToCard: false,
  },
}
const MONUMENT_8PCT: PayableSettings = { ...MONUMENT, tax: { defaultRate: 8 } }
const NO_ROUNDING: PayableSettings = { tax: { defaultRate: 10 }, priceRounding: null }

describe('computePayable — Order.total already includes tax', () => {
  it('does NOT add tax again when taxTotal is persisted (the $4/check overcharge)', () => {
    // Real production row 224: subtotal 42.96, taxTotal 3.44, total 46.40.
    const payable = computePayable(
      { total: 46.40, taxTotal: 3.44, isAllocationChild: false }, MONUMENT_8PCT,
    )
    expect(payable).toBe(46.00)          // round(46.40)
    expect(payable).not.toBe(50.00)      // round(46.40 + 3.44) — the pre-fix bug
  })

  it('the verified 8-item sale: 85.92 + 8.59 = 94.51 -> $95.00', () => {
    // This is the payment that actually completed on hardware.
    const payable = computePayable(
      { total: 94.51, taxTotal: 8.59, isAllocationChild: false }, MONUMENT,
    )
    expect(payable).toBe(95.00)
  })

  it('the verified 4-item sale: 42.96 + 4.30 = 47.26 -> $47.00', () => {
    const payable = computePayable(
      { total: 47.26, taxTotal: 4.30, isAllocationChild: false }, MONUMENT,
    )
    expect(payable).toBe(47.00)
  })
})

describe('computePayable — legacy rows with no persisted tax', () => {
  it("falls back to the venue's own rate", () => {
    const payable = computePayable(
      { total: 42.96, taxTotal: 0, isAllocationChild: false }, MONUMENT,
    )
    expect(payable).toBe(47.00)          // 42.96 + 10% = 47.26 -> 47.00
  })

  it('uses the rate the venue is actually configured at (8% vs 10%)', () => {
    const at8 = computePayable({ total: 42.96, taxTotal: 0, isAllocationChild: false }, MONUMENT_8PCT)
    const at10 = computePayable({ total: 42.96, taxTotal: 0, isAllocationChild: false }, MONUMENT)
    expect(at8).toBe(46.00)              // 46.40 -> 46.00
    expect(at10).toBe(47.00)             // 47.26 -> 47.00
    expect(at8).not.toBe(at10)           // rate is venue config, never hardcoded
  })

  it('adds nothing when the venue has no tax rate', () => {
    const payable = computePayable(
      { total: 42.96, taxTotal: 0, isAllocationChild: false },
      { tax: { defaultRate: 0 }, priceRounding: null },
    )
    expect(payable).toBe(42.96)
  })
})

describe('computePayable — allocation split children', () => {
  it('never adds tax to an allocation child (its total is already inclusive)', () => {
    const payable = computePayable(
      { total: 23.63, taxTotal: 2.15, isAllocationChild: true }, MONUMENT,
    )
    expect(payable).toBe(24.00)          // round(23.63)
    expect(payable).not.toBe(26.00)      // round(23.63 + 2.15) — double count
  })

  it('reproduces the live standoff and shows it resolved', () => {
    // On hardware the register offered $21.00 while the server demanded $23.20,
    // because the child total was NOT tax-inclusive (tax had been clobbered to 0).
    const brokenChild = computePayable(
      { total: 21.48, taxTotal: 0, isAllocationChild: true }, MONUMENT_8PCT,
    )
    // With the allocation guard the server no longer inflates it to 23.20.
    expect(brokenChild).toBe(21.00)
  })
})

describe('computeTaxInclusiveTotal — rounding must never touch tax', () => {
  it('returns the unrounded tax-inclusive amount', () => {
    expect(computeTaxInclusiveTotal(
      { total: 42.96, taxTotal: 0, isAllocationChild: false }, MONUMENT,
    )).toBe(47.26)
  })

  it('is unaffected by the rounding setting', () => {
    const withRounding = computeTaxInclusiveTotal(
      { total: 42.96, taxTotal: 0, isAllocationChild: false }, MONUMENT)
    const without = computeTaxInclusiveTotal(
      { total: 42.96, taxTotal: 0, isAllocationChild: false }, NO_ROUNDING)
    expect(withRounding).toBe(without)
    // Only the payable differs — the difference is booked as roundingAdjustment,
    // i.e. it comes out of product revenue, never out of tax.
    expect(computePayable({ total: 42.96, taxTotal: 0, isAllocationChild: false }, MONUMENT)).toBe(47.00)
    expect(computePayable({ total: 42.96, taxTotal: 0, isAllocationChild: false }, NO_ROUNDING)).toBe(47.26)
  })
})

describe('computePayable — tender method honours the venue setting', () => {
  it('rounds cash but not card (applyToCard is false at Monument)', () => {
    const input = { total: 47.26, taxTotal: 4.30, isAllocationChild: false }
    expect(computePayable(input, MONUMENT, 'cash')).toBe(47.00)
    expect(computePayable(input, MONUMENT, 'card')).toBe(47.26)
  })
})

describe('isAllocationSplitChild', () => {
  it('is true only for a child explicitly marked allocation', () => {
    expect(isAllocationSplitChild({ parentOrderId: 'p', splitClass: 'allocation' })).toBe(true)
  })
  it('is false for a structural child, which owns real items', () => {
    expect(isAllocationSplitChild({ parentOrderId: 'p', splitClass: 'structural' })).toBe(false)
  })
  it('is false for an ordinary order', () => {
    expect(isAllocationSplitChild({ parentOrderId: null, splitClass: null })).toBe(false)
  })
})
