// GET /api/hardware/readers/health
// Returns reader health summary for a location, or detailed health for a single reader.
//
// Query params:
//   locationId  (required) — venue location
//   readerId    (optional) — when provided, returns last 100 logs + summary for that reader

import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { db } from '@/lib/db'
import { getReaderHealthSummary } from '@/lib/reader-health'

export const GET = withVenue(async (request: Request) => {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const readerId = searchParams.get('readerId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
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
        return NextResponse.json({ error: 'Reader not found' }, { status: 404 })
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

      return NextResponse.json({
        data: {
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
        },
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

    return NextResponse.json({
      data: {
        readers: readers.map(r => ({
          id: r.id,
          name: r.name,
          isOnline: r.isOnline,
          avgResponseTime: r.avgResponseTime,
          successRate: r.successRate != null ? Number(r.successRate) : null,
          lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
          lastError: r.lastError,
        })),
      },
    })
  } catch (err) {
    console.error('[GET /api/hardware/readers/health]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
