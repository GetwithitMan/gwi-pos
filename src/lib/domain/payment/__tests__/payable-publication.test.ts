import { describe, it, expect } from 'vitest'
import { computePayable, isAllocationSplitChild } from '../payable'

/**
 * CONTRACT: a published payable must classify allocation children correctly.
 *
 * getOrderForPanel uses an explicit Prisma `select`. When payable publication
 * was added there, `parentOrderId` was NOT in that select, so every allocation
 * split child arrived at isAllocationSplitChild() with parentOrderId undefined,
 * was classified as a normal order, and had tax added to a total that already
 * included it. A $23.63 child would have been published as $25.99 payable.
 *
 * These tests pin the classification inputs. If a read path stops selecting
 * parentOrderId or splitClass, the "missing field" cases below fail.
 */

// Monument's real configuration.
const settings = { tax: { defaultRate: 10 } } as never

describe('allocation child classification', () => {
  it('classifies a true allocation child', () => {
    expect(isAllocationSplitChild({ parentOrderId: 'p1', splitClass: 'allocation' })).toBe(true)
  })

  it('a structural split child is NOT an allocation child — it owns items', () => {
    expect(isAllocationSplitChild({ parentOrderId: 'p1', splitClass: 'structural' })).toBe(false)
  })

  it('a normal order is not an allocation child', () => {
    expect(isAllocationSplitChild({ parentOrderId: null, splitClass: null })).toBe(false)
  })

  it('MISSING parentOrderId misclassifies an allocation child', () => {
    // This is the failure mode: the read path forgot to select the column.
    expect(isAllocationSplitChild({ splitClass: 'allocation' })).toBe(false)
  })
})

describe('payable publication for allocation children', () => {
  const child = { total: 23.63, taxTotal: 0, isAllocationChild: true }

  it('does not add tax to an allocation child whose total already includes it', () => {
    expect(computePayable(child, settings, 'cash')).toBe(23.63)
  })

  it('DOUBLE-TAXES the same child when misclassified', () => {
    // Demonstrates the concrete cost of dropping parentOrderId from a select:
    // the guest is quoted 25.99 for a 23.63 check.
    const misclassified = { ...child, isAllocationChild: false }
    expect(computePayable(misclassified, settings, 'cash')).toBe(25.99)
  })

  it('a normal order with tax already stored is not re-taxed', () => {
    // storedTax > 0 short-circuits regardless of classification.
    expect(computePayable({ total: 46.4, taxTotal: 3.44, isAllocationChild: false }, settings, 'cash')).toBe(46.4)
  })

  it('a normal order with NO stored tax gets tax added once', () => {
    expect(computePayable({ total: 10.99, taxTotal: 0, isAllocationChild: false }, settings, 'cash')).toBe(12.09)
  })
})
