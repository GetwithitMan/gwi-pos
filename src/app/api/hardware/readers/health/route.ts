// GET /api/hardware/readers/health
// Returns reader health summary for a location, or detailed health for a single reader.
//
// Query params:
//   locationId  (required) — venue location
//   readerId    (optional) — when provided, returns last 100 logs + summary for that reader

import { withVenue } from '@/lib/with-venue'
import { db } from '@/lib/db'
import { getReaderHealthSummary } from '@/lib/reader-health'
import { err, notFound, ok } from '@/lib/api-response'

export const GET = withVenue(async (request: Request) => {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const readerId = searchParams.get('readerId')

    if (!locationId) {
      return err('locationId is required')
    }

    // ── Single reader: detailed view ───────────────────────────────────────
    if (readerId) {
      const reader = await db.paymentReader.findFirst({
        where: { id: readerId, locationId, deletedAt: null },
        select: {
          id: true,
          name: true,
          isOnline: true,
          avgResponseTime: true,
          successRate: true,
          lastSeenAt: true,
          lastError: true,
        },
      })

      if (!reader) {
        return notFound('Reader not found')
      }

      const [summary, recentLogs] = await Promise.all([
        getReaderHealthSummary(readerId, locationId),
        db.paymentReaderLog.findMany({
          where: { readerId, locationId },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            createdAt: true,
            responseTime: true,
            success: true,
            errorCode: true,
            tranType: true,
          },
        }),
      ])

      return ok({
          readers: [
            {
              id: reader.id,
              name: reader.name,
              isOnline: reader.isOnline,
              avgResponseTime: reader.avgResponseTime,
              successRate: reader.successRate != null ? Number(reader.successRate) : null,
              lastSeenAt: reader.lastSeenAt?.toISOString() ?? null,
              lastError: reader.lastError,
              summary,
              recentLogs: recentLogs.map(l => ({
                createdAt: l.createdAt.toISOString(),
                responseTime: l.responseTime,
                success: l.success,
                errorCode: l.errorCode,
                tranType: l.tranType,
              })),
            },
          ],
        })
    }

    // ── All readers at location: summary view ──────────────────────────────
    const readers = await db.paymentReader.findMany({
      where: { locationId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        isOnline: true,
        avgResponseTime: true,
        successRate: true,
        lastSeenAt: true,
        lastError: true,
      },
    })

    return ok({
        readers: readers.map(r => ({
          id: r.id,
          name: r.name,
          isOnline: r.isOnline,
          avgResponseTime: r.avgResponseTime,
          successRate: r.successRate != null ? Number(r.successRate) : null,
          lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
          lastError: r.lastError,
        })),
      })
  } catch (caughtErr) {
    console.error('[GET /api/hardware/readers/health]', err)
    return err('Internal server error', 500)
  }
})
