import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { db } from '@/lib/db'

/**
 * GET /api/system/batch-status
 *
 * Returns live batch metrics for the heartbeat script to report to Mission Control.
 * Called from localhost by the NUC heartbeat cron — no user auth needed.
 *
 * Response: { data: { openOrderCount, unadjustedTipCount, currentBatchTotal, lastBatchClosedAt } }
 */
export const GET = withVenue(async () => {
  try {
    // Read last batch closed time from the file written by datacap batch close
    let lastBatchClosedAt: Date | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs')
      const raw = fs.readFileSync('/opt/gwi-pos/last-batch.json', 'utf-8')
      const info = JSON.parse(raw)
      if (info.closedAt) {
        lastBatchClosedAt = new Date(info.closedAt)
      }
    } catch {
      // File doesn't exist (first run, dev mode, or never batched) — that's fine
    }

    // Count open orders (not yet paid/closed/voided/merged)
    const openOrderCount = await db.order.count({
      where: {
        deletedAt: null,
        status: { notIn: ['paid', 'closed', 'voided', 'merged'] },
      },
    })

    // Count card payments with zero tip since last batch close (unadjusted tips)
    const unadjustedTipCount = await db.payment.count({
      where: {
        deletedAt: null,
        paymentMethod: { in: ['credit', 'debit'] },
        status: 'completed',
        tipAmount: { lte: 0 },
        ...(lastBatchClosedAt ? { createdAt: { gte: lastBatchClosedAt } } : {}),
      },
    })

    // Sum current open batch total (all card payments since last batch close)
    const batchAgg = await db.payment.aggregate({
      where: {
        deletedAt: null,
        paymentMethod: { in: ['credit', 'debit'] },
        status: 'completed',
        ...(lastBatchClosedAt ? { createdAt: { gte: lastBatchClosedAt } } : {}),
      },
      _sum: { amount: true },
    })

    return NextResponse.json({
      data: {
        openOrderCount,
        unadjustedTipCount,
        currentBatchTotal: Number(batchAgg._sum.amount ?? 0),
        lastBatchClosedAt: lastBatchClosedAt?.toISOString() ?? null,
      },
    })
  } catch (e) {
    console.error('[batch-status]', e)
    return NextResponse.json({
      data: {
        openOrderCount: null,
        unadjustedTipCount: null,
        currentBatchTotal: null,
        lastBatchClosedAt: null,
      },
    })
  }
})
