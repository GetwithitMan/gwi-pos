/**
 * GET /api/venue-logs — Query venue diagnostic logs with filters
 * POST /api/venue-logs — Create log entries (single or batch)
 *
 * Location-scoped via withVenue(). Supports pagination, level/source/category
 * filters, date range, and full-text search on message.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { getLocationId } from '@/lib/location-cache'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { logVenueEventsBatch, cleanupExpiredLogs } from '@/lib/venue-logger'
import type { VenueLogEntry } from '@/lib/venue-logger'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('venue-logs')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Rate limit ingestion: 60 req/min per IP
const ingestLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 1000 })

const VALID_LEVELS = ['info', 'warn', 'error', 'critical']
const VALID_SOURCES = ['server', 'pos', 'kds', 'android', 'sync', 'pax']
const VALID_CATEGORIES = ['payment', 'sync', 'hardware', 'auth', 'order', 'system']

// ============================================
// GET — Query logs
// ============================================

export const GET = withVenue(async function GET(req: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const params = req.nextUrl.searchParams
    const level = params.get('level')
    const source = params.get('source')
    const category = params.get('category')
    const search = params.get('search')
    const startDate = params.get('startDate')
    const endDate = params.get('endDate')
    const limit = Math.min(200, Math.max(1, parseInt(params.get('limit') || '50', 10)))
    const offset = Math.max(0, parseInt(params.get('offset') || '0', 10))

    // Default to last 24 hours if no date range given
    const now = new Date()
    const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const dateFrom = startDate ? new Date(startDate) : defaultStart
    const dateTo = endDate ? new Date(endDate) : now

    // Build WHERE conditions
    const conditions: string[] = ['"locationId" = $1', '"createdAt" >= $2', '"createdAt" <= $3']
    const values: unknown[] = [locationId, dateFrom, dateTo]
    let paramIdx = 4

    if (level && VALID_LEVELS.includes(level)) {
      conditions.push(`"level" = $${paramIdx}`)
      values.push(level)
      paramIdx++
    }
    if (source && VALID_SOURCES.includes(source)) {
      conditions.push(`"source" = $${paramIdx}`)
      values.push(source)
      paramIdx++
    }
    if (category && VALID_CATEGORIES.includes(category)) {
      conditions.push(`"category" = $${paramIdx}`)
      values.push(category)
      paramIdx++
    }
    if (search && search.length > 0 && search.length <= 200) {
      conditions.push(`"message" ILIKE $${paramIdx}`)
      values.push(`%${search}%`)
      paramIdx++
    }

    const whereClause = conditions.join(' AND ')

    // Count total for pagination
    const countResult = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*) as count FROM "VenueLog" WHERE ${whereClause}`,
      ...values
    )
    const total = Number(countResult[0]?.count ?? 0)

    // Fetch logs
    const logs = await db.$queryRawUnsafe<Array<{
      id: string
      locationId: string
      level: string
      source: string
      category: string
      message: string
      details: unknown
      employeeId: string | null
      deviceId: string | null
      stackTrace: string | null
      createdAt: Date
      expiresAt: Date
    }>>(
      `SELECT "id", "locationId", "level", "source", "category", "message", "details",
              "employeeId", "deviceId", "stackTrace", "createdAt", "expiresAt"
       FROM "VenueLog"
       WHERE ${whereClause}
       ORDER BY "createdAt" DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      ...values,
      limit,
      offset
    )

    return NextResponse.json({
      data: logs,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    console.error('[venue-logs] GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch venue logs' }, { status: 500 })
  }
})

// ============================================
// POST — Create log entries
// ============================================

export const POST = withVenue(withAuth(async function POST(req: NextRequest) {
  try {
    // Rate limit
    const ip = getClientIp(req)
    const rateCheck = ingestLimiter.check(ip)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter) } }
      )
    }

    const body = await req.json()
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Support both single entry and batch
    const entries: VenueLogEntry[] = Array.isArray(body) ? body : [body]

    if (entries.length === 0) {
      return NextResponse.json({ error: 'No entries provided' }, { status: 400 })
    }
    if (entries.length > 500) {
      return NextResponse.json({ error: 'Batch size exceeds 500 limit' }, { status: 400 })
    }

    // Validate each entry
    for (const entry of entries) {
      if (!entry.message || typeof entry.message !== 'string') {
        return NextResponse.json({ error: 'Each entry requires a message string' }, { status: 400 })
      }
      if (entry.level && !VALID_LEVELS.includes(entry.level)) {
        return NextResponse.json(
          { error: `Invalid level "${entry.level}". Must be one of: ${VALID_LEVELS.join(', ')}` },
          { status: 400 }
        )
      }
      if (entry.source && !VALID_SOURCES.includes(entry.source)) {
        return NextResponse.json(
          { error: `Invalid source "${entry.source}". Must be one of: ${VALID_SOURCES.join(', ')}` },
          { status: 400 }
        )
      }
      if (entry.category && !VALID_CATEGORIES.includes(entry.category)) {
        return NextResponse.json(
          { error: `Invalid category "${entry.category}". Must be one of: ${VALID_CATEGORIES.join(', ')}` },
          { status: 400 }
        )
      }
    }

    const result = await logVenueEventsBatch(entries, locationId)

    // Opportunistic cleanup: ~1% of requests trigger expired log cleanup
    if (Math.random() < 0.01) {
      void cleanupExpiredLogs().catch(err => log.warn({ err }, 'Background task failed'))
    }

    return NextResponse.json({
      data: {
        success: true,
        written: result.written,
        errors: result.errors,
      },
    })
  } catch (error) {
    console.error('[venue-logs] POST failed:', error)
    return NextResponse.json({ error: 'Failed to write venue logs' }, { status: 500 })
  }
}))
