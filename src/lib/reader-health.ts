// Reader Health — DB-backed transaction logging and health summary
// Tracks per-transaction response time and success rate for each payment reader.
// All DB writes are fire-and-forget (never block a payment path).

import { db } from '@/lib/db'

// ─── Log Writer ───────────────────────────────────────────────────────────────

/**
 * Log a completed Datacap transaction and update the reader's rolling metrics.
 * ALWAYS call fire-and-forget: void logReaderTransaction(...).catch(() => {})
 */
export async function logReaderTransaction(opts: {
  locationId: string
  readerId: string
  responseTimeMs: number
  success: boolean
  errorCode?: string
  tranType?: string
}): Promise<void> {
  const { locationId, readerId, responseTimeMs, success, errorCode, tranType } = opts

  // 1. Create the log record
  await db.paymentReaderLog.create({
    data: {
      locationId,
      readerId,
      responseTime: responseTimeMs,
      success,
      errorCode: errorCode ?? null,
      tranType: tranType ?? null,
    },
  })

  // 2. Recompute rolling metrics from last 50 logs (fire-and-forget internally)
  void (async () => {
    try {
      const recent = await db.paymentReaderLog.findMany({
        where: { readerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { responseTime: true, success: true },
      })

      if (recent.length === 0) return

      const avgResponseTime = Math.round(
        recent.reduce((sum, r) => sum + r.responseTime, 0) / recent.length
      )
      const successCount = recent.filter(r => r.success).length
      // Store as percentage rounded to 2 decimal places (Decimal field in schema)
      const successRate = parseFloat(((successCount / recent.length) * 100).toFixed(2))

      await db.paymentReader.update({
        where: { id: readerId },
        data: {
          avgResponseTime,
          successRate,
          ...(success ? { lastSeenAt: new Date() } : {}),
        },
      })
    } catch {
      // Silently swallow — metrics update is non-critical
    }
  })()
}

// ─── Health Summary ───────────────────────────────────────────────────────────

export interface ReaderHealthSummary {
  avgResponseTime: number | null
  successRate: number | null
  totalTransactions: number
  recentErrors: Array<{
    createdAt: Date
    errorCode: string | null
    tranType: string | null
  }>
}

/**
 * Get health summary for a single reader.
 * Returns rolling metrics from the PaymentReader record plus recent error logs.
 */
export async function getReaderHealthSummary(
  readerId: string,
  locationId: string
): Promise<ReaderHealthSummary> {
  const [reader, totalCount, recentErrors] = await Promise.all([
    db.paymentReader.findFirst({
      where: { id: readerId, locationId },
      select: { avgResponseTime: true, successRate: true },
    }),
    db.paymentReaderLog.count({
      where: { readerId, locationId },
    }),
    db.paymentReaderLog.findMany({
      where: { readerId, locationId, success: false },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { createdAt: true, errorCode: true, tranType: true },
    }),
  ])

  return {
    avgResponseTime: reader?.avgResponseTime ?? null,
    successRate: reader?.successRate != null ? Number(reader.successRate) : null,
    totalTransactions: totalCount,
    recentErrors,
  }
}
