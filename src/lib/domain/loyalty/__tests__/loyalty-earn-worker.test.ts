/**
 * Unit tests for the loyalty earn outbox worker (T4 of loyalty cleanup).
 *
 * Covers:
 *   - Link-then-pay creates exactly one earn (happy path: claim → insert → ack)
 *   - Concurrent unlink-during-pay produces zero earns (customer row absent)
 *   - Double pay invocation produces exactly one earn (unique-index idempotency)
 *   - Outbox replay after process death (idempotent retry of a dead row)
 *
 * The worker talks to `db` via `$queryRaw`/`$executeRaw`/`$transaction`, so we
 * mock the whole client at module level.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mocks -----------------------------------------------------------------
// `vi.mock` is hoisted by vitest to the top of the file. Keep the factory
// self-contained (no top-level variable references) to avoid TDZ errors.

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    pendingLoyaltyEarn: { update: vi.fn() },
  },
}))

vi.mock('@/lib/socket-dispatch/misc-dispatch', () => ({
  dispatchLoyaltyEarnDeadLetter: vi.fn().mockResolvedValue(true),
  dispatchLoyaltyRewardMissesDetected: vi.fn().mockResolvedValue(true),
}))

// After the hoisted mock is set up we can safely import the worker + the
// mocked db instance.
import { processNextLoyaltyEarn } from '../loyalty-earn-worker'
import { db as mockDb } from '@/lib/db'
import { dispatchLoyaltyEarnDeadLetter } from '@/lib/socket-dispatch/misc-dispatch'

// ---- Helpers ---------------------------------------------------------------

function makeClaimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'earn-1',
    locationId: 'loc-1',
    orderId: 'order-1',
    customerId: 'cust-1',
    pointsEarned: 42,
    loyaltyEarningBase: '10.50',
    tierMultiplier: '1.500',
    employeeId: 'emp-1',
    orderNumber: 1001,
    status: 'processing',
    attempts: 1,
    maxAttempts: 5,
    ...overrides,
  }
}

function txFactory(opts: {
  customerRow?: { loyaltyPoints: number; lifetimePoints: number; loyaltyProgramId: string | null; loyaltyTierId: string | null } | null
  insertThrows?: Error
  tierRows?: Array<{ id: string; name: string; minimumPoints: number }>
}) {
  return async (work: (tx: any) => Promise<unknown>) => {
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ..._values: unknown[]) => {
        const q = strings.join('?')
        if (/FROM "Customer"/.test(q)) {
          return opts.customerRow ? [opts.customerRow] : []
        }
        if (/FROM "LoyaltyTier"/.test(q)) {
          return opts.tierRows ?? []
        }
        return []
      }),
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, ..._values: unknown[]) => {
        const q = strings.join('?')
        if (/INSERT INTO "LoyaltyTransaction"/.test(q) && opts.insertThrows) {
          throw opts.insertThrows
        }
        return 1
      }),
    }
    return work(tx)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---- Tests -----------------------------------------------------------------

describe('processNextLoyaltyEarn', () => {
  it('returns { processed: false } when the queue is empty', async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([])
    const result = await processNextLoyaltyEarn()
    expect(result).toEqual({ processed: false })
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('writes exactly one LoyaltyTransaction on happy path (link-then-pay)', async () => {
    // Claim returns our row.
    mockDb.$queryRaw.mockResolvedValueOnce([makeClaimRow()])

    const factory = txFactory({
      customerRow: { loyaltyPoints: 100, lifetimePoints: 100, loyaltyProgramId: 'prog-1', loyaltyTierId: null },
    })
    const txSpy = vi.fn(factory)
    mockDb.$transaction.mockImplementation(txSpy as any)

    const result = await processNextLoyaltyEarn()
    expect(result).toEqual({ processed: true, orderId: 'order-1', success: true })
    expect(txSpy).toHaveBeenCalledTimes(1)
  })

  it('double invocation: second call acks via partial unique index (idempotent)', async () => {
    // Second pay claims the same row again somehow (e.g. retry/replay); the
    // LoyaltyTransaction INSERT fails with Postgres unique_violation (23505).
    mockDb.$queryRaw.mockResolvedValueOnce([makeClaimRow({ attempts: 2 })])
    const uniqueErr: any = new Error('duplicate key value violates unique constraint "LoyaltyTransaction_locationId_orderId_earn_unique"')
    uniqueErr.code = '23505'

    mockDb.$transaction.mockImplementation(txFactory({
      customerRow: { loyaltyPoints: 0, lifetimePoints: 0, loyaltyProgramId: null, loyaltyTierId: null },
      insertThrows: uniqueErr,
    }) as any)
    mockDb.pendingLoyaltyEarn.update.mockResolvedValue({})

    const result = await processNextLoyaltyEarn()
    expect(result.processed).toBe(true)
    expect(result.success).toBe(true)
    expect(result.idempotent).toBe(true)
    expect(mockDb.pendingLoyaltyEarn.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'succeeded', lastError: 'already_earned' }) })
    )
  })

  it('concurrent unlink-during-pay: customer row gone → ack as dead, zero earns', async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([makeClaimRow()])
    mockDb.$transaction.mockImplementation(txFactory({
      customerRow: null, // hard-deleted or never existed at this location
    }) as any)
    mockDb.pendingLoyaltyEarn.update.mockResolvedValue({})

    const result = await processNextLoyaltyEarn()
    expect(result.processed).toBe(true)
    expect(result.success).toBe(false)
    // Dead row signals "never retry" — 0 earns for this order.
    expect(mockDb.pendingLoyaltyEarn.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'dead', lastError: 'customer_not_found' }) })
    )
  })

  it('outbox replay after process death: transient failure marks row failed + backs off', async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([makeClaimRow({ attempts: 2, maxAttempts: 5 })])
    mockDb.$transaction.mockImplementation(txFactory({
      customerRow: { loyaltyPoints: 0, lifetimePoints: 0, loyaltyProgramId: null, loyaltyTierId: null },
      insertThrows: new Error('connection refused'),
    }) as any)
    mockDb.pendingLoyaltyEarn.update.mockResolvedValue({})

    const result = await processNextLoyaltyEarn()
    expect(result.processed).toBe(true)
    expect(result.success).toBe(false)
    // Row is rescheduled (failed, not dead — attempts < maxAttempts).
    expect(mockDb.pendingLoyaltyEarn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'earn-1' },
        data: expect.objectContaining({
          status: 'failed',
          lastError: 'connection refused',
          availableAt: expect.any(Date),
        }),
      })
    )
  })

  it('outbox replay: dead-letters when attempts hit maxAttempts', async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([makeClaimRow({ attempts: 5, maxAttempts: 5 })])
    mockDb.$transaction.mockImplementation(txFactory({
      customerRow: { loyaltyPoints: 0, lifetimePoints: 0, loyaltyProgramId: null, loyaltyTierId: null },
      insertThrows: new Error('connection refused'),
    }) as any)
    mockDb.pendingLoyaltyEarn.update.mockResolvedValue({})

    const result = await processNextLoyaltyEarn()
    expect(result.success).toBe(false)
    expect(mockDb.pendingLoyaltyEarn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'dead' }),
      })
    )
  })

  it('dead-letter (retry exhausted) emits loyalty:earn_dead_letter exactly once', async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([makeClaimRow({ attempts: 5, maxAttempts: 5 })])
    mockDb.$transaction.mockImplementation(txFactory({
      customerRow: { loyaltyPoints: 0, lifetimePoints: 0, loyaltyProgramId: null, loyaltyTierId: null },
      insertThrows: new Error('connection refused'),
    }) as any)
    mockDb.pendingLoyaltyEarn.update.mockResolvedValue({})

    await processNextLoyaltyEarn()

    expect(dispatchLoyaltyEarnDeadLetter).toHaveBeenCalledTimes(1)
    expect(dispatchLoyaltyEarnDeadLetter).toHaveBeenCalledWith('loc-1', expect.objectContaining({
      orderId: 'order-1',
      customerId: 'cust-1',
      attempts: 5,
      lastError: 'connection refused',
    }))
  })

  it('dead-letter (customer_not_found) emits loyalty:earn_dead_letter exactly once', async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([makeClaimRow()])
    mockDb.$transaction.mockImplementation(txFactory({
      customerRow: null,
    }) as any)
    mockDb.pendingLoyaltyEarn.update.mockResolvedValue({})

    await processNextLoyaltyEarn()

    expect(dispatchLoyaltyEarnDeadLetter).toHaveBeenCalledTimes(1)
    expect(dispatchLoyaltyEarnDeadLetter).toHaveBeenCalledWith('loc-1', expect.objectContaining({
      orderId: 'order-1',
      customerId: 'cust-1',
      lastError: 'customer_not_found',
    }))
  })

  it('transient failure (not yet dead) does NOT emit loyalty:earn_dead_letter', async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([makeClaimRow({ attempts: 2, maxAttempts: 5 })])
    mockDb.$transaction.mockImplementation(txFactory({
      customerRow: { loyaltyPoints: 0, lifetimePoints: 0, loyaltyProgramId: null, loyaltyTierId: null },
      insertThrows: new Error('connection refused'),
    }) as any)
    mockDb.pendingLoyaltyEarn.update.mockResolvedValue({})

    await processNextLoyaltyEarn()

    expect(dispatchLoyaltyEarnDeadLetter).not.toHaveBeenCalled()
  })

  it('zero points: ack outbox row without writing LoyaltyTransaction', async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([makeClaimRow({ pointsEarned: 0 })])
    mockDb.pendingLoyaltyEarn.update.mockResolvedValue({})

    const result = await processNextLoyaltyEarn()
    expect(result).toEqual({ processed: true, orderId: 'order-1', success: true })
    expect(mockDb.$transaction).not.toHaveBeenCalled()
    expect(mockDb.pendingLoyaltyEarn.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'succeeded' }) })
    )
  })
})
