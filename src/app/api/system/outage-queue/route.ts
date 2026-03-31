import { NextResponse } from 'next/server'
import { masterClient } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * GET /api/system/outage-queue
 *
 * Returns outage queue status and recent entries for diagnostics.
 * Called from localhost by NUC heartbeat / admin UI — no user auth needed.
 */
export const GET = withVenue(async () => {
  try {
    // Count entries by status
    const counts = await masterClient.$queryRaw<Array<{
      status: string
      count: bigint
    }>>`SELECT status, COUNT(*) as count FROM "OutageQueueEntry" GROUP BY status`

    const statusCounts: Record<string, number> = {}
    let total = 0
    for (const row of counts) {
      statusCounts[row.status] = Number(row.count)
      total += Number(row.count)
    }

    // Fetch recent entries (last 50)
    const recent = await masterClient.$queryRaw<Array<{
      id: string
      tableName: string
      recordId: string
      operation: string
      status: string
      createdAt: Date
      replayedAt: Date | null
      metadata: unknown
    }>>`SELECT id, "tableName", "recordId", operation, status, "createdAt", "replayedAt", metadata
       FROM "OutageQueueEntry"
       ORDER BY "createdAt" DESC
       LIMIT 50`

    return NextResponse.json({
      success: true,
      data: {
        pending: statusCounts['PENDING'] || 0,
        failed: statusCounts['FAILED'] || 0,
        deadLetter: statusCounts['DEAD_LETTER'] || 0,
        replayed: statusCounts['REPLAYED'] || 0,
        conflict: statusCounts['CONFLICT'] || 0,
        total,
        recent: recent.map(r => ({
          id: r.id,
          tableName: r.tableName,
          recordId: r.recordId,
          operation: r.operation,
          status: r.status,
          attempts: (r.metadata as any)?.retryCount ?? 0,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
          replayedAt: r.replayedAt ? (r.replayedAt instanceof Date ? r.replayedAt.toISOString() : String(r.replayedAt)) : null,
        })),
      },
    })
  } catch (error) {
    console.error('[OutageQueue] API error:', error)
    return err('Failed to fetch outage queue status')
  }
})
