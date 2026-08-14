import { describe, it, expect } from 'vitest'
import { allocateRoundedFamilyTotal, roundingIncrementCents } from '../split-helpers'

/**
 * Family-level rounding for split checks.
 *
 * Rounding each child independently rounds UP more often than not, so the table
 * collectively pays more than the check. Observed at Monument 2026-08-14:
 * a $42.96 check at 10% tax = $47.26, split 2 ways = $23.63 each, each rounded
 * to $24.00 — the house over-collected $0.74 from the table.
 *
 * The fix rounds ONCE at the family level and divides that rounded amount, so
 * the children always sum to exactly what the whole check rounds to.
 *
 * Tax is never involved: it is computed on the full pre-rounding subtotal and
 * remitted in full. Only the rounding difference moves, and it is booked to
 * product revenue via Payment.roundingAdjustment.
 */
describe('allocateRoundedFamilyTotal', () => {
  const evenChildren = (n: number, shareCents: number) =>
    Array.from({ length: n }, (_, i) => ({ splitIndex: i + 1, shareCents }))

  describe('the Monument case — $47.26 check, 2 ways, whole dollars', () => {
    const alloc = allocateRoundedFamilyTotal(4700, 100, evenChildren(2, 2363))

    it('sums to exactly the rounded family total', () => {
      const sum = [...alloc.values()].reduce((a, b) => a + b, 0)
      expect(sum).toBe(4700)
    })

    it('allocates 24.00 + 23.00, not 24.00 + 24.00', () => {
      expect(alloc.get(1)).toBe(2400)
      expect(alloc.get(2)).toBe(2300)
    })

    it('never over-collects versus the unrounded check', () => {
      const sum = [...alloc.values()].reduce((a, b) => a + b, 0)
      const unrounded = 4726
      expect(sum).toBeLessThanOrEqual(unrounded)
    })

    it('beats per-child rounding, which would have taken 48.00', () => {
      const perChild = 2400 + 2400
      const sum = [...alloc.values()].reduce((a, b) => a + b, 0)
      expect(perChild).toBe(4800)
      expect(sum).toBe(4700)
      expect(sum).toBeLessThan(perChild)
    })

    it('every child lands on a whole dollar', () => {
      for (const cents of alloc.values()) expect(cents % 100).toBe(0)
    })
  })

  describe('quarter increment — friendlier spread between guests', () => {
    const alloc = allocateRoundedFamilyTotal(4725, 25, evenChildren(2, 2363))

    it('sums exactly', () => {
      expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(4725)
    })

    it('allocates 23.75 + 23.50 — guests differ by only a quarter', () => {
      expect(alloc.get(1)).toBe(2375)
      expect(alloc.get(2)).toBe(2350)
      expect(Math.abs((alloc.get(1) ?? 0) - (alloc.get(2) ?? 0))).toBe(25)
    })

    it('every child lands on a quarter', () => {
      for (const cents of alloc.values()) expect(cents % 25).toBe(0)
    })
  })

  describe('exactness across split counts and increments', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      it(`sums exactly for a ${n}-way even split at whole dollars`, () => {
        const familyRounded = 4700
        const alloc = allocateRoundedFamilyTotal(familyRounded, 100, evenChildren(n, Math.round(4726 / n)))
        expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(familyRounded)
        expect(alloc.size).toBe(n)
      })
    }

    for (const inc of [5, 10, 25, 50, 100]) {
      it(`sums exactly at a ${inc}c increment`, () => {
        const familyRounded = Math.round(4726 / inc) * inc
        const alloc = allocateRoundedFamilyTotal(familyRounded, inc, evenChildren(3, 1575))
        expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(familyRounded)
        for (const cents of alloc.values()) expect(cents % inc).toBe(0)
      })
    }
  })

  describe('uneven (custom_amount) splits allocate proportionally', () => {
    it('gives the bigger share to the bigger check', () => {
      // 30.00 / 17.26 of a 47.26 check that rounds to 47.00
      const alloc = allocateRoundedFamilyTotal(4700, 100, [
        { splitIndex: 1, shareCents: 3000 },
        { splitIndex: 2, shareCents: 1726 },
      ])
      expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(4700)
      expect(alloc.get(1)!).toBeGreaterThan(alloc.get(2)!)
    })
  })

  describe('determinism — payment order must not change the outcome', () => {
    it('produces identical allocation regardless of input ordering', () => {
      const forward = allocateRoundedFamilyTotal(4700, 100, [
        { splitIndex: 1, shareCents: 2363 },
        { splitIndex: 2, shareCents: 2363 },
        { splitIndex: 3, shareCents: 2363 },
      ])
      const reversed = allocateRoundedFamilyTotal(4700, 100, [
        { splitIndex: 3, shareCents: 2363 },
        { splitIndex: 2, shareCents: 2363 },
        { splitIndex: 1, shareCents: 2363 },
      ])
      expect([...forward.entries()].sort()).toEqual([...reversed.entries()].sort())
    })

    it('breaks ties on splitIndex, so the earliest child absorbs the extra unit', () => {
      const alloc = allocateRoundedFamilyTotal(4700, 100, evenChildren(2, 2363))
      expect(alloc.get(1)).toBeGreaterThan(alloc.get(2)!)
    })
  })

  describe('degenerate inputs are safe', () => {
    it('returns empty for no children', () => {
      expect(allocateRoundedFamilyTotal(4700, 100, []).size).toBe(0)
    })

    it('splits evenly when all shares are zero', () => {
      const alloc = allocateRoundedFamilyTotal(4700, 100, evenChildren(2, 0))
      expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(4700)
    })

    it('handles a single child taking the whole family total', () => {
      const alloc = allocateRoundedFamilyTotal(4700, 100, [{ splitIndex: 1, shareCents: 4726 }])
      expect(alloc.get(1)).toBe(4700)
    })

    it('treats a zero increment as cent-level rather than dividing by zero', () => {
      const alloc = allocateRoundedFamilyTotal(4726, 0, evenChildren(2, 2363))
      expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(4726)
    })
  })
})

describe('roundingIncrementCents', () => {
  it('maps the venue priceRounding.increment values', () => {
    expect(roundingIncrementCents('1.00')).toBe(100)
    expect(roundingIncrementCents('0.50')).toBe(50)
    expect(roundingIncrementCents('0.25')).toBe(25)
    expect(roundingIncrementCents('0.10')).toBe(10)
    expect(roundingIncrementCents('0.05')).toBe(5)
  })

  it('falls back to cent-level for "none" or an unknown value', () => {
    expect(roundingIncrementCents('none')).toBe(1)
    expect(roundingIncrementCents(undefined)).toBe(1)
    expect(roundingIncrementCents(null)).toBe(1)
  })
})
