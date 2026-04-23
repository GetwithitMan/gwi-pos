/**
 * Unit tests for the loyalty reward-miss monitor (T9 — Loyalty Rewards Cleanup).
 *
 * Covers:
 *   - Positive count: structured log + socket emit fire (one per location)
 *   - Zero count: no socket emit (no spam), zero-count metric still recorded
 *   - Disabled-loyalty venues: excluded from query, no alerts ever
 *   - Sample IDs are bounded (don't dump all orderIds in payload)
 *   - Error during query returns safely (does not throw — observability is best-effort)
 *
 * PR #272 review fixes (2026-04-23):
 *   - Cap-exceeded path emits cap_exceeded=true + true-count + warn log
 *   - Zero-count metric now logs at INFO (not debug) so dashboards keep series
 *   - Non-zero count still logs at ERROR (alerting unchanged)
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

// Capture log calls so we can assert on level + payload shape.
const logCalls = {
  info: [] as Array<{ payload: any; msg: string }>,
  warn: [] as Array<{ payload: any; msg: string }>,
  error: [] as Array<{ payload: any; msg: string }>,
  debug: [] as Array<{ payload: any; msg: string }>,
}

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    fatal: vi.fn(),
    error: vi.fn((payload: any, msg: string) => logCalls.error.push({ payload, msg })),
    warn: vi.fn((payload: any, msg: string) => logCalls.warn.push({ payload, msg })),
    info: vi.fn((payload: any, msg: string) => logCalls.info.push({ payload, msg })),
    debug: vi.fn((payload: any, msg: string) => logCalls.debug.push({ payload, msg })),
    trace: vi.fn(),
    log: vi.fn(),
  }),
}))

import { scanRewardMisses } from '../reward-miss-monitor'
import { db as mockDb } from '@/lib/db'
import { dispatchLoyaltyRewardMissesDetected } from '@/lib/socket-dispatch/misc-dispatch'

// Helper: stub the two raw queries the monitor issues, in order:
//   1. grouped COUNT(*) per locationId
//   2. sample-row fetch (capped at SAMPLE_FETCH_LIMIT)
function mockTwoQueries(countRows: any[], sampleRows: any[]) {
  ;(mockDb.$queryRaw as any)
    .mockResolvedValueOnce(countRows)
    .mockResolvedValueOnce(sampleRows)
}

beforeEach(() => {
  vi.clearAllMocks()
  logCalls.info = []
  logCalls.warn = []
  logCalls.error = []
  logCalls.debug = []
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
      expect(r.capExceeded).toBe(false)
    }
  })

  it('emits socket event + structured log when count > 0 for an enabled venue', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc-enabled', settings: { loyalty: { enabled: true } } },
    ])
    mockTwoQueries(
      [{ locationId: 'loc-enabled', count: 3n }],
      [
        { orderId: 'order-1', locationId: 'loc-enabled' },
        { orderId: 'order-2', locationId: 'loc-enabled' },
        { orderId: 'order-3', locationId: 'loc-enabled' },
      ],
    )

    const results = await scanRewardMisses()

    expect(results).toEqual([
      expect.objectContaining({
        locationId: 'loc-enabled',
        enabled: true,
        count: 3,
        sampleOrderIds: ['order-1', 'order-2', 'order-3'],
        capExceeded: false,
      }),
    ])

    expect(dispatchLoyaltyRewardMissesDetected).toHaveBeenCalledTimes(1)
    expect(dispatchLoyaltyRewardMissesDetected).toHaveBeenCalledWith(
      'loc-enabled',
      expect.objectContaining({
        count: 3,
        sampleOrderIds: ['order-1', 'order-2', 'order-3'],
        windowSeconds: 30,
      }),
    )

    // Non-zero count still logs at ERROR (existing alerting contract).
    const errorMetricLogs = logCalls.error.filter((l) => l.payload?.event === 'loyalty.reward_miss')
    expect(errorMetricLogs).toHaveLength(1)
  })

  it('emits ZERO socket events when count is zero for all enabled venues (no spam)', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc-clean-1', settings: { loyalty: { enabled: true } } },
      { id: 'loc-clean-2', settings: { loyalty: { enabled: true } } },
    ])
    // Empty count rows + empty sample rows = both locations have count 0.
    mockTwoQueries([], [])

    const results = await scanRewardMisses()

    expect(dispatchLoyaltyRewardMissesDetected).not.toHaveBeenCalled()
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.enabled).toBe(true)
      expect(r.count).toBe(0)
      expect(r.sampleOrderIds).toEqual([])
      expect(r.capExceeded).toBe(false)
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
    mockTwoQueries([{ locationId: 'loc', count: 25n }], misses)

    const results = await scanRewardMisses()
    expect(results[0].count).toBe(25)
    expect(results[0].sampleOrderIds).toHaveLength(10)
    expect(results[0].sampleOrderIds[0]).toBe('order-1')
    expect(results[0].sampleOrderIds[9]).toBe('order-10')
    expect(results[0].capExceeded).toBe(false)
  })

  it('groups misses correctly across multiple enabled venues', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc-a', settings: { loyalty: { enabled: true } } },
      { id: 'loc-b', settings: { loyalty: { enabled: true } } },
      { id: 'loc-c', settings: { loyalty: { enabled: false } } },
    ])
    mockTwoQueries(
      [
        { locationId: 'loc-a', count: 2n },
        { locationId: 'loc-b', count: 1n },
      ],
      [
        { orderId: 'a-1', locationId: 'loc-a' },
        { orderId: 'a-2', locationId: 'loc-a' },
        { orderId: 'b-1', locationId: 'loc-b' },
      ],
    )

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

  it('returns empty array (does not throw) when the sample query throws — observability is best-effort', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc', settings: { loyalty: { enabled: true } } },
    ])
    // Count succeeds, sample fails — entire scan returns empty (best-effort).
    ;(mockDb.$queryRaw as any)
      .mockResolvedValueOnce([{ locationId: 'loc', count: 1n }])
      .mockRejectedValueOnce(new Error('relation "Order" does not exist'))

    const results = await scanRewardMisses()
    expect(results).toEqual([])
    expect(dispatchLoyaltyRewardMissesDetected).not.toHaveBeenCalled()
  })

  it('returns empty array (does not throw) when the COUNT query throws', async () => {
    ;(mockDb.location.findMany as any).mockResolvedValueOnce([
      { id: 'loc', settings: { loyalty: { enabled: true } } },
    ])
    ;(mockDb.$queryRaw as any).mockRejectedValueOnce(new Error('connection lost'))

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

  // ── PR #272 review fixes ────────────────────────────────────────────────

  describe('cap-exceeded path (PR #272 fix)', () => {
    it('emits cap_exceeded=true + true count when sample-fetch cap is exceeded', async () => {
      ;(mockDb.location.findMany as any).mockResolvedValueOnce([
        { id: 'loc-busy', settings: { loyalty: { enabled: true } } },
      ])
      // True count is 50,000 — far above the 5000 sample cap. Sample is the
      // most recent 5000 rows, but the metric MUST report 50,000.
      const trueCount = 50_000
      const sample = Array.from({ length: 5000 }, (_, i) => ({
        orderId: `order-${i + 1}`,
        locationId: 'loc-busy',
      }))
      mockTwoQueries([{ locationId: 'loc-busy', count: BigInt(trueCount) }], sample)

      const results = await scanRewardMisses()

      // Result reflects TRUE count, not the truncated sample.
      expect(results).toHaveLength(1)
      expect(results[0].count).toBe(trueCount)
      expect(results[0].capExceeded).toBe(true)
      // Sample is still bounded to SAMPLE_LIMIT (10) for the payload.
      expect(results[0].sampleOrderIds).toHaveLength(10)

      // A dedicated WARN log fires so ops sees the cap-hit signal.
      const capWarn = logCalls.warn.find(
        (l) => l.payload?.event === 'loyalty.reward_miss_cap_hit',
      )
      expect(capWarn).toBeDefined()
      expect(capWarn!.payload.trueCountTotal).toBe(trueCount)
      expect(capWarn!.payload.sampleFetchLimit).toBe(5000)

      // Metric payload also carries cap_exceeded:true + the true count so
      // dashboards/alerts can flag without parsing the warn log.
      const metric = logCalls.info.find(
        (l) =>
          l.payload?.event ===
          'loyalty.orders_paid_with_customer_without_loyalty_txn_within_30s',
      )
      expect(metric).toBeDefined()
      expect(metric!.payload.cap_exceeded).toBe(true)
      expect(metric!.payload.count).toBe(trueCount)

      // Non-zero ERROR log also carries cap_exceeded.
      const errorLog = logCalls.error.find((l) => l.payload?.event === 'loyalty.reward_miss')
      expect(errorLog).toBeDefined()
      expect(errorLog!.payload.cap_exceeded).toBe(true)
    })

    it('does NOT set cap_exceeded when total true count is within the cap', async () => {
      ;(mockDb.location.findMany as any).mockResolvedValueOnce([
        { id: 'loc-quiet', settings: { loyalty: { enabled: true } } },
      ])
      mockTwoQueries(
        [{ locationId: 'loc-quiet', count: 12n }],
        Array.from({ length: 12 }, (_, i) => ({
          orderId: `o-${i}`,
          locationId: 'loc-quiet',
        })),
      )

      const results = await scanRewardMisses()
      expect(results[0].capExceeded).toBe(false)
      const capWarn = logCalls.warn.find(
        (l) => l.payload?.event === 'loyalty.reward_miss_cap_hit',
      )
      expect(capWarn).toBeUndefined()
    })
  })

  describe('zero-count metric level (PR #272 fix)', () => {
    it('logs zero-count metric at INFO (not debug) so the time series stays continuous', async () => {
      ;(mockDb.location.findMany as any).mockResolvedValueOnce([
        { id: 'loc-quiet', settings: { loyalty: { enabled: true } } },
      ])
      mockTwoQueries([], [])

      await scanRewardMisses()

      const zeroMetric = logCalls.info.find(
        (l) =>
          l.payload?.event ===
            'loyalty.orders_paid_with_customer_without_loyalty_txn_within_30s' &&
          l.payload?.count === 0,
      )
      expect(zeroMetric).toBeDefined()
      expect(zeroMetric!.payload.locationId).toBe('loc-quiet')
      // Same shape as non-zero metric.
      expect(zeroMetric!.payload.cap_exceeded).toBe(false)
      expect(zeroMetric!.payload.windowSeconds).toBe(30)

      // Critical: no debug-level zero log (regression guard against the
      // pre-fix behavior where the zero series disappeared in production).
      const debugZero = logCalls.debug.find(
        (l) =>
          l.payload?.event ===
          'loyalty.orders_paid_with_customer_without_loyalty_txn_within_30s',
      )
      expect(debugZero).toBeUndefined()

      // No socket emit for zero counts (existing no-spam contract preserved).
      expect(dispatchLoyaltyRewardMissesDetected).not.toHaveBeenCalled()
    })

    it('non-zero count still logs at ERROR level (existing behavior preserved)', async () => {
      ;(mockDb.location.findMany as any).mockResolvedValueOnce([
        { id: 'loc', settings: { loyalty: { enabled: true } } },
      ])
      mockTwoQueries(
        [{ locationId: 'loc', count: 4n }],
        [
          { orderId: 'o-1', locationId: 'loc' },
          { orderId: 'o-2', locationId: 'loc' },
          { orderId: 'o-3', locationId: 'loc' },
          { orderId: 'o-4', locationId: 'loc' },
        ],
      )

      await scanRewardMisses()

      // ERROR log fires with the loyalty.reward_miss event.
      const errorLog = logCalls.error.find((l) => l.payload?.event === 'loyalty.reward_miss')
      expect(errorLog).toBeDefined()
      expect(errorLog!.payload.count).toBe(4)
      expect(errorLog!.payload.locationId).toBe('loc')

      // INFO metric also fires (continuous series).
      const infoMetric = logCalls.info.find(
        (l) =>
          l.payload?.event ===
          'loyalty.orders_paid_with_customer_without_loyalty_txn_within_30s',
      )
      expect(infoMetric).toBeDefined()
      expect(infoMetric!.payload.count).toBe(4)
    })

    it('emits one INFO metric per enabled venue (continuous series across all venues)', async () => {
      ;(mockDb.location.findMany as any).mockResolvedValueOnce([
        { id: 'loc-a', settings: { loyalty: { enabled: true } } },
        { id: 'loc-b', settings: { loyalty: { enabled: true } } },
        { id: 'loc-c', settings: { loyalty: { enabled: true } } },
      ])
      // Only loc-a has misses; loc-b and loc-c are clean.
      mockTwoQueries(
        [{ locationId: 'loc-a', count: 1n }],
        [{ orderId: 'a-1', locationId: 'loc-a' }],
      )

      await scanRewardMisses()

      const metrics = logCalls.info.filter(
        (l) =>
          l.payload?.event ===
          'loyalty.orders_paid_with_customer_without_loyalty_txn_within_30s',
      )
      // 3 venues = 3 metric points (1 non-zero + 2 zero).
      expect(metrics).toHaveLength(3)
      const byLoc = Object.fromEntries(metrics.map((m) => [m.payload.locationId, m.payload]))
      expect(byLoc['loc-a'].count).toBe(1)
      expect(byLoc['loc-b'].count).toBe(0)
      expect(byLoc['loc-c'].count).toBe(0)
    })
  })
})
