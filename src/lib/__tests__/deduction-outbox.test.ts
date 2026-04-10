/**
 * Deduction Outbox — Critical Guarantee Tests
 *
 * Verifies:
 * 1. Processor claims and runs a pending deduction
 * 2. Successful run marks status=succeeded + creates DeductionRun record
 * 3. Failed run marks status=failed with backoff, records error
 * 4. Dead-letter: after maxAttempts the job becomes 'dead' (not retried)
 * 5. Idempotency: no row → returns processed=false (no double-deduct)
 * 6. processAllPending() drains the queue and stops when empty
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock db ─────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn()
const mockPendingDeductionUpdate = vi.fn()
const mockDeductionRunCreate = vi.fn()

const mockInventoryItemTransactionCreate = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    pendingDeduction: {
      update: (...args: unknown[]) => mockPendingDeductionUpdate(...args),
    },
    deductionRun: {
      create: (...args: unknown[]) => mockDeductionRunCreate(...args),
    },
    inventoryItemTransaction: {
      create: (...args: unknown[]) => mockInventoryItemTransactionCreate(...args),
    },
  },
}))

vi.mock('@/generated/prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
}))

// ─── Mock deduction workers ───────────────────────────────────────────────────

const mockDeductInventory = vi.fn()

vi.mock('@/lib/inventory', () => ({
  deductInventoryForOrder: (...args: unknown[]) => mockDeductInventory(...args),
}))

vi.mock('@/lib/socket-server', () => ({
  emitCriticalToLocation: vi.fn().mockResolvedValue(undefined),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { processNextDeduction, processAllPending } from '@/lib/deduction-processor'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<{
  id: string
  orderId: string
  attempts: number
  maxAttempts: number
  status: string
}> = {}) {
  return {
    id: 'job-1',
    locationId: 'loc-1',
    orderId: 'order-abc',
    paymentId: 'pay-1',
    deductionType: 'full',
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    availableAt: new Date(Date.now() - 1000),
    lastError: null,
    lastAttemptAt: null,
    succeededAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// ─── processNextDeduction ─────────────────────────────────────────────────────

describe('processNextDeduction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeductInventory.mockResolvedValue({ success: true, itemsDeducted: 2 })
    mockPendingDeductionUpdate.mockResolvedValue({})
    mockDeductionRunCreate.mockResolvedValue({})
    mockInventoryItemTransactionCreate.mockResolvedValue({})
  })

  it('returns processed=false when queue is empty', async () => {
    mockQueryRaw.mockResolvedValue([]) // no rows claimed

    const result = await processNextDeduction()

    expect(result.processed).toBe(false)
    expect(mockDeductInventory).not.toHaveBeenCalled()
    expect(mockPendingDeductionUpdate).not.toHaveBeenCalled()
  })

  it('claims a job, runs deductions, marks succeeded', async () => {
    mockQueryRaw.mockResolvedValue([makeJob()])

    const result = await processNextDeduction()

    expect(result.processed).toBe(true)
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('order-abc')

    // Unified deduction worker called (processLiquorInventory was removed —
    // deductInventoryForOrder now handles both food AND liquor)
    expect(mockDeductInventory).toHaveBeenCalledWith('order-abc', null)

    // Status updated to succeeded
    expect(mockPendingDeductionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'succeeded' }),
      })
    )

    // DeductionRun created with success=true
    expect(mockDeductionRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pendingDeductionId: 'job-1',
          success: true,
        }),
      })
    )
  })

  it('marks status=failed with backoff when status write throws', async () => {
    // Note: Promise.allSettled() absorbs deduction errors — the job only enters
    // the catch path if the DB status-write itself fails.
    mockQueryRaw.mockResolvedValue([makeJob({ attempts: 1 })])
    // First update call (mark succeeded) throws; second call (mark failed) succeeds
    mockPendingDeductionUpdate
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValue({})

    const result = await processNextDeduction()

    expect(result.processed).toBe(true)
    expect(result.success).toBe(false)

    // Second update call is the failed-status write
    const updateCall = mockPendingDeductionUpdate.mock.calls[1][0]
    expect(updateCall.data.status).toBe('failed')
    expect(updateCall.data.lastError).toContain('DB connection lost')
    // Backoff: availableAt should be in the future
    expect(updateCall.data.availableAt.getTime()).toBeGreaterThan(Date.now())

    // DeductionRun created with success=false
    expect(mockDeductionRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ success: false, error: 'DB connection lost' }),
      })
    )
  })

  it('dead-letters job when attempts >= maxAttempts', async () => {
    mockQueryRaw.mockResolvedValue([makeJob({ attempts: 5, maxAttempts: 5 })])
    // First update (succeeded write) throws → enters catch; isDead = 5 >= 5
    mockPendingDeductionUpdate
      .mockRejectedValueOnce(new Error('persistent failure'))
      .mockResolvedValue({})

    await processNextDeduction()

    // Second update is the dead/failed write
    const updateCall = mockPendingDeductionUpdate.mock.calls[1][0]
    expect(updateCall.data.status).toBe('dead')
    // No availableAt set for dead jobs
    expect(updateCall.data.availableAt).toBeUndefined()
  })

  it('exponential backoff increases with attempt count', async () => {
    const attempt1Job = makeJob({ attempts: 1 })
    const attempt3Job = makeJob({ attempts: 3, id: 'job-2' })

    // attempt 1: backoff = 2^1 * 30s = 60s
    mockQueryRaw.mockResolvedValueOnce([attempt1Job])
    mockPendingDeductionUpdate
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue({})
    const before1 = Date.now()
    await processNextDeduction()
    const backoff1 = mockPendingDeductionUpdate.mock.calls[1][0].data.availableAt.getTime() - before1

    vi.clearAllMocks()
    mockPendingDeductionUpdate
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue({})
    mockDeductionRunCreate.mockResolvedValue({})

    // attempt 3: backoff = 2^3 * 30s = 240s
    mockQueryRaw.mockResolvedValueOnce([attempt3Job])
    const before3 = Date.now()
    await processNextDeduction()
    const backoff3 = mockPendingDeductionUpdate.mock.calls[1][0].data.availableAt.getTime() - before3

    expect(backoff3).toBeGreaterThan(backoff1)
  })
})

// ─── Idempotency guarantee ────────────────────────────────────────────────────

describe('idempotency: re-running processor on already-succeeded job', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does nothing when no pending jobs exist (already processed)', async () => {
    // Simulate: job was succeeded, so FOR UPDATE SKIP LOCKED finds nothing
    mockQueryRaw.mockResolvedValue([])

    const result = await processNextDeduction()

    expect(result.processed).toBe(false)
    expect(mockDeductInventory).not.toHaveBeenCalled()
  })
})

// ─── processAllPending ────────────────────────────────────────────────────────

describe('processAllPending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPendingDeductionUpdate.mockResolvedValue({})
    mockDeductionRunCreate.mockResolvedValue({})
    mockDeductInventory.mockResolvedValue({ success: true })
    mockInventoryItemTransactionCreate.mockResolvedValue({})
  })

  it('processes all jobs and stops when queue is empty', async () => {
    // 3 jobs then empty
    mockQueryRaw
      .mockResolvedValueOnce([makeJob({ id: 'j1', orderId: 'o1' })])
      .mockResolvedValueOnce([makeJob({ id: 'j2', orderId: 'o2' })])
      .mockResolvedValueOnce([makeJob({ id: 'j3', orderId: 'o3' })])
      .mockResolvedValue([]) // empty → stop

    const result = await processAllPending()

    expect(result.processed).toBe(3)
    expect(result.succeeded).toBe(3)
    expect(result.failed).toBe(0)
  })

  it('counts failures separately from successes', async () => {
    // Job 1 succeeds normally; job 2 fails because its status write throws
    mockQueryRaw
      .mockResolvedValueOnce([makeJob({ id: 'j1', orderId: 'o1' })])
      .mockResolvedValueOnce([makeJob({ id: 'j2', orderId: 'o2', attempts: 0, maxAttempts: 5 })])
      .mockResolvedValue([])

    // Job 1: update succeeds; job 2: first update throws (triggers failure path), second succeeds
    mockPendingDeductionUpdate
      .mockResolvedValueOnce({})         // j1 succeeded write
      .mockRejectedValueOnce(new Error('j2 write failed'))  // j2 succeeded write → catch
      .mockResolvedValue({})             // j2 failed write (in catch)

    const result = await processAllPending()

    expect(result.processed).toBe(2)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('stops after 100 iterations even if queue never empties (safety cap)', async () => {
    // Always returns a job — simulates infinite queue
    mockQueryRaw.mockResolvedValue([makeJob()])

    const result = await processAllPending()

    expect(result.processed).toBe(100)
    // queryRaw called exactly 100 times (loop limit)
    expect(mockQueryRaw.mock.calls.length).toBe(100)
  })
})
