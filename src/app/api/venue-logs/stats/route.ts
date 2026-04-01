/**
 * GET /api/venue-logs/stats — Aggregate diagnostics stats
 *
 * Returns error counts by level, source, and category for the given time range.
 * Also includes a trending issues list (most frequent messages).
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { err, ok } from '@/lib/api-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface CountRow { label: string; count: bigint }
interface TrendRow { message: string; level: string; source: string; category: string; count: bigint; latest: Date }

export const GET = withVenue(async function GET(req: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const params = req.nextUrl.searchParams
    const hours = Math.min(720, Math.max(1, parseInt(params.get('hours') || '24', 10) || 24))

    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    // Run all aggregation queries in parallel
    const [byLevel, bySource, byCategory, trending, totalCount] = await Promise.all([
      // Count by level
      db.$queryRaw<CountRow[]>`
        SELECT "level" as label, COUNT(*) as count
         FROM "VenueLog"
         WHERE "locationId" = ${locationId} AND "createdAt" >= ${since}
         GROUP BY "level"
         ORDER BY count DESC`,
      // Count by source
      db.$queryRaw<CountRow[]>`
        SELECT "source" as label, COUNT(*) as count
         FROM "VenueLog"
         WHERE "locationId" = ${locationId} AND "createdAt" >= ${since}
         GROUP BY "source"
         ORDER BY count DESC`,
      // Count by category
      db.$queryRaw<CountRow[]>`
        SELECT "category" as label, COUNT(*) as count
         FROM "VenueLog"
         WHERE "locationId" = ${locationId} AND "createdAt" >= ${since}
         GROUP BY "category"
         ORDER BY count DESC`,
      // Trending issues: top 10 most frequent messages
      db.$queryRaw<TrendRow[]>`
        SELECT "message", "level", "source", "category",
                COUNT(*) as count, MAX("createdAt") as latest
         FROM "VenueLog"
         WHERE "locationId" = ${locationId} AND "createdAt" >= ${since}
         GROUP BY "message", "level", "source", "category"
         ORDER BY count DESC
         LIMIT 10`,
      // Total log count
      db.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM "VenueLog"
         WHERE "locationId" = ${locationId} AND "createdAt" >= ${since}`,
    ])

    // Convert BigInt to number for JSON serialization
    const toMap = (rows: CountRow[]) =>
      Object.fromEntries(rows.map(r => [r.label, Number(r.count)]))

    const levelMap = toMap(byLevel)

    return ok({
        hours,
        since: since.toISOString(),
        total: Number(totalCount[0]?.count ?? 0),
        summary: {
          critical: levelMap['critical'] || 0,
          errors: levelMap['error'] || 0,
          warnings: levelMap['warn'] || 0,
          info: levelMap['info'] || 0,
        },
        byLevel: toMap(byLevel),
        bySource: toMap(bySource),
        byCategory: toMap(byCategory),
        trending: trending.map(t => ({
          message: t.message,
          level: t.level,
          source: t.source,
          category: t.category,
          count: Number(t.count),
          latestAt: t.latest,
        })),
      })
  } catch (error) {
    console.error('[venue-logs/stats] GET failed:', error)
    return err('Failed to fetch venue log stats', 500)
  }
})
