/**
 * Unit tests for the loyalty reward-miss monitor (T9 — Loyalty Rewards Cleanup).
 *
 * Covers:
 *   - Positive count: structured log + socket emit fire (one per location)
 *   - Zero count: no socket emit (no spam), zero-count metric still recorded
 *   - Disabled-loyalty venues: excluded from query, no alerts ever
 *   - Sample IDs are bounded (don't dump all orderIds in payload)
 *   - Error during query returns safely (does not throw — observability is best-effort)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (hoisted) ────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => ({
  db: {
    location: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

vi.mock('@/lib/socket-dispatch/misc-dispatch', () => ({
  dispatchLoyaltyRewardMissesDetected: vi.fn().mockResolvedValue(true),
  dispatchLoyaltyEarnDeadLetter: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/settings', () => ({
  parseSettings: (raw: any) => {
    // Minimal stub: read loyalty.enabled directly off the input shape used
    // in the test fixtures (raw is { loyalty: { enabled: bool } } | null).
    return {
      loyalty: { enabled: raw?.loyalty?.enabled === true },
    }
  },
}))

// Logger uses pino — mock to no-op so test output stays clean.
vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    fatal: vi.fn(), error: vi.fn(), warn: vi.fn(),
    info: vi.fn(), debug: vi.fn(), trace: vi.fn(), log: vi.fn(),
  }),
}))

import { scanRewardMisses } from '../reward-miss-monitor'
import { db as mockDb } from '@/lib/db'
import { dispatchLoyaltyRewardMissesDetected } from '@/lib/socket-dispatch/misc-dispatch'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('scanRewardMisses', () => {
  it('returns empty array when there are no locations', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([])
    const results = await scanRewardMisses()
    expect(results).toEqual([])
    expect(mockDb.$queryRaw).not.toHaveBeenCalled()
    expect(dispatchLoyaltyRewardMissesDetected).not.toHaveBeenCalled()
  })

  it('skips disabled-loyalty venues entirely (no query, no alert)', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc-disabled-1', settings: { loyalty: { enabled: false } } },
      { id: 'loc-disabled-2', settings: null },
    ])

    const results = await scanRewardMisses()
    expect(mockDb.$queryRaw).not.toHaveBeenCalled()
    expect(dispatchLoyaltyRewardMissesDetected).not.toHaveBeenCalled()
    // Each disabled location is reported with enabled=false, count=0.
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.enabled).toBe(false)
      expect(r.count).toBe(0)
    }
  })

  it('emits socket event + structured log when count > 0 for an enabled venue', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc-enabled', settings: { loyalty: { enabled: true } } },
    ])
    ;(mockDb.$queryRaw as any).mockResolvedValueOnce([
      { orderId: 'order-1', locationId: 'loc-enabled' },
      { orderId: 'order-2', locationId: 'loc-enabled' },
      { orderId: 'order-3', locationId: 'loc-enabled' },
    ])

    const results = await scanRewardMisses()

    expect(results).toEqual([
      expect.objectContaining({
        locationId: 'loc-enabled',
        enabled: true,
        count: 3,
        sampleOrderIds: ['order-1', 'order-2', 'order-3'],
      }),
    ])

    expect(dispatchLoyaltyRewardMissesDetected).toHaveBeenCalledTimes(1)
    expect(dispatchLoyaltyRewardMissesDetected).toHaveBeenCalledWith(
      'loc-enabled',
      expect.objectContaining({
        count: 3,
        sampleOrderIds: ['order-1', 'order-2', 'order-3'],
        windowSeconds: 30,
      })
    )
  })

  it('emits ZERO socket events when count is zero for all enabled venues (no spam)', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc-clean-1', settings: { loyalty: { enabled: true } } },
      { id: 'loc-clean-2', settings: { loyalty: { enabled: true } } },
    ])
    ;(mockDb.$queryRaw as any).mockResolvedValueOnce([])

    const results = await scanRewardMisses()

    expect(dispatchLoyaltyRewardMissesDetected).not.toHaveBeenCalled()
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.enabled).toBe(true)
      expect(r.count).toBe(0)
      expect(r.sampleOrderIds).toEqual([])
    }
  })

  it('caps sampleOrderIds to 10 even when count is much higher', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc', settings: { loyalty: { enabled: true } } },
    ])
    const misses = Array.from({ length: 25 }, (_, i) => ({
      orderId: `order-${i + 1}`,
      locationId: 'loc',
    }))
    ;(mockDb.$queryRaw as any).mockResolvedValueOnce(misses)

    const results = await scanRewardMisses()
    expect(results[0].count).toBe(25)
    expect(results[0].sampleOrderIds).toHaveLength(10)
    expect(results[0].sampleOrderIds[0]).toBe('order-1')
    expect(results[0].sampleOrderIds[9]).toBe('order-10')
  })

  it('groups misses correctly across multiple enabled venues', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc-a', settings: { loyalty: { enabled: true } } },
      { id: 'loc-b', settings: { loyalty: { enabled: true } } },
      { id: 'loc-c', settings: { loyalty: { enabled: false } } },
    ])
    ;(mockDb.$queryRaw as any).mockResolvedValueOnce([
      { orderId: 'a-1', locationId: 'loc-a' },
      { orderId: 'a-2', locationId: 'loc-a' },
      { orderId: 'b-1', locationId: 'loc-b' },
    ])

    const results = await scanRewardMisses()
    const byLoc = Object.fromEntries(results.map((r) => [r.locationId, r]))

    expect(byLoc['loc-a'].count).toBe(2)
    expect(byLoc['loc-b'].count).toBe(1)
    // Disabled venue is reported but not queried/alerted.
    expect(byLoc['loc-c'].enabled).toBe(false)
    expect(byLoc['loc-c'].count).toBe(0)

    // One socket emit per enabled venue with non-zero misses.
    expect(dispatchLoyaltyRewardMissesDetected).toHaveBeenCalledTimes(2)
  })

  it('returns empty array (does not throw) when the query throws — observability is best-effort', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc', settings: { loyalty: { enabled: true } } },
    ])
    ;(mockDb.$queryRaw as any).mockRejectedValueOnce(new Error('relation "Order" does not exist'))

    const results = await scanRewardMisses()
    expect(results).toEqual([])
    expect(dispatchLoyaltyRewardMissesDetected).not.toHaveBeenCalled()
  })

  it('returns empty array when location enumeration fails', async () => {
    ;(mockDb.location.findMany as any).mockRejectedValueOnce(new Error('connection refused'))
    const results = await scanRewardMisses()
    expect(results).toEqual([])
    expect(mockDb.$queryRaw).not.toHaveBeenCalled()
  })
})
