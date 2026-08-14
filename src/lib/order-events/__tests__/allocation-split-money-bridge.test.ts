import { describe, it, expect } from 'vitest'
import { shouldSkipMoneyBridge } from '@/lib/domain/split-order/split-helpers'

/**
 * Regression tests for the split-payment revenue loss found at Monument
 * Steakhouse on 2026-08-14.
 *
 * A $42.96 dine-in check was split evenly two ways and both halves paid.
 * Recorded revenue was $0.00, with zero Payment rows.
 *
 * Chain of failure:
 *   1. even-split.ts creates children with total = 21.48 written directly to
 *      the Order row, emitting only ORDER_CREATED — no ITEM_ADDED, so the
 *      child's event stream reduces to $0.
 *   2. ingester.ts's Order bridge rebuilt subtotal/total from that stream and
 *      overwrote the real 21.48 with 0.00.
 *   3. pay/route.ts then saw a $0 balance and took its "all items
 *      voided/comped" branch — closing the check as paid, before Zod parse,
 *      with no Payment insert.
 *
 * shouldSkipMoneyBridge is step 2's guard. If it ever returns false for an
 * allocation child again, the revenue loss returns.
 */
describe('shouldSkipMoneyBridge', () => {
  describe('allocation split children — money must be preserved', () => {
    it('skips the money bridge for an even-split child (the Monument case)', () => {
      expect(shouldSkipMoneyBridge({
        splitClass: 'allocation',
        parentOrderId: 'cmst6bm140n1801yfaze8rc1f',
        itemCount: 0,
      })).toBe(true)
    })

    it('skips for a custom_amount child, which is also amount-only', () => {
      expect(shouldSkipMoneyBridge({
        splitClass: 'allocation',
        parentOrderId: 'parent-1',
        itemCount: 0,
      })).toBe(true)
    })

    it('honours a stored allocation splitClass even if itemCount is stale/non-zero', () => {
      // Stored splitClass always wins over the legacy itemCount heuristic.
      expect(shouldSkipMoneyBridge({
        splitClass: 'allocation',
        parentOrderId: 'parent-1',
        itemCount: 3,
      })).toBe(true)
    })

    it('infers allocation for a LEGACY child with no splitClass and no items', () => {
      // Pre-existing split families created before splitClass was introduced.
      expect(shouldSkipMoneyBridge({
        splitClass: null,
        parentOrderId: 'parent-1',
        itemCount: 0,
      })).toBe(true)
    })
  })

  describe('orders that DO own their items — money must keep recomputing', () => {
    it('does NOT skip for a structural (by-item / by-seat) split child', () => {
      expect(shouldSkipMoneyBridge({
        splitClass: 'structural',
        parentOrderId: 'parent-1',
        itemCount: 2,
      })).toBe(false)
    })

    it('infers structural for a legacy child that has items', () => {
      expect(shouldSkipMoneyBridge({
        splitClass: null,
        parentOrderId: 'parent-1',
        itemCount: 2,
      })).toBe(false)
    })

    it('does NOT skip for an ordinary non-split order', () => {
      expect(shouldSkipMoneyBridge({
        splitClass: null,
        parentOrderId: null,
        itemCount: 4,
      })).toBe(false)
    })

    it('does NOT skip for a split PARENT (has items, no parentOrderId)', () => {
      // The parent keeps all 4 items and must stay recomputable.
      expect(shouldSkipMoneyBridge({
        splitClass: null,
        parentOrderId: null,
        itemCount: 4,
      })).toBe(false)
    })

    it('does NOT skip for an empty order that is not a split child', () => {
      // A genuinely empty draft must still project to $0 — that is correct.
      expect(shouldSkipMoneyBridge({
        splitClass: null,
        parentOrderId: null,
        itemCount: 0,
      })).toBe(false)
    })
  })

  describe('order does not exist yet', () => {
    it('does NOT skip when the order row is absent (it is being created)', () => {
      // The create path needs the money fields populated from the stream.
      expect(shouldSkipMoneyBridge(null)).toBe(false)
    })
  })

  describe('defensive input handling', () => {
    it('treats a missing itemCount on an allocation child as allocation', () => {
      expect(shouldSkipMoneyBridge({
        splitClass: 'allocation',
        parentOrderId: 'parent-1',
      })).toBe(true)
    })

    it('does not skip when parentOrderId is absent even if splitClass says allocation', () => {
      // Without a parent it is not a child; refuse to freeze a real order's totals.
      expect(shouldSkipMoneyBridge({
        splitClass: 'allocation',
        parentOrderId: null,
        itemCount: 0,
      })).toBe(false)
    })
  })
})
