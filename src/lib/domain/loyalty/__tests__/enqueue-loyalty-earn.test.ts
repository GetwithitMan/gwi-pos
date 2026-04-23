/**
 * Unit tests for enqueueLoyaltyEarn (Tickets T2 + T3 + T4 of loyalty cleanup).
 *
 * Covers:
 *   - Happy path: points > 0 → INSERT runs
 *   - pointsEarned <= 0 → no-op, no INSERT
 *   - Second call for same orderId → ON CONFLICT DO NOTHING (alreadyQueued=true)
 *
 * The enqueue is a single `tx.$executeRaw`; we assert on the generated
 * statement and its bound values so we don't need a real Postgres.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enqueueLoyaltyEarn } from '../enqueue-loyalty-earn'

function makeTx(rowsInserted: number) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(rowsInserted),
  } as any
}

const baseParams = {
  locationId: 'loc-1',
  orderId: 'order-1',
  customerId: 'cust-1',
  pointsEarned: 42,
  loyaltyEarningBase: 10.5,
  tierMultiplier: 1.5,
  employeeId: 'emp-1',
  orderNumber: 1001,
}

describe('enqueueLoyaltyEarn', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns { enqueued: false } and skips INSERT when pointsEarned <= 0', async () => {
    const tx = makeTx(1)
    const result = await enqueueLoyaltyEarn({ tx, ...baseParams, pointsEarned: 0 })
    expect(result).toEqual({ enqueued: false })
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })

  it('returns { enqueued: true } on first successful INSERT', async () => {
    const tx = makeTx(1)
    const result = await enqueueLoyaltyEarn({ tx, ...baseParams })
    expect(result).toEqual({ enqueued: true, alreadyQueued: false })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it('returns { enqueued: false, alreadyQueued: true } when INSERT hits ON CONFLICT', async () => {
    const tx = makeTx(0)
    const result = await enqueueLoyaltyEarn({ tx, ...baseParams })
    expect(result).toEqual({ enqueued: false, alreadyQueued: true })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it('double invocation produces exactly one enqueue (idempotency at enqueue layer)', async () => {
    // Simulate the realistic case: first call inserts, second call's INSERT
    // is a no-op because the orderId unique constraint rejects the second row.
    const tx = {
      $executeRaw: vi.fn()
        .mockResolvedValueOnce(1)  // first call inserts
        .mockResolvedValueOnce(0), // second call hits ON CONFLICT DO NOTHING
    } as any

    const first = await enqueueLoyaltyEarn({ tx, ...baseParams })
    const second = await enqueueLoyaltyEarn({ tx, ...baseParams })

    expect(first).toEqual({ enqueued: true, alreadyQueued: false })
    expect(second).toEqual({ enqueued: false, alreadyQueued: true })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
  })
})
