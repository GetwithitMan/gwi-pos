/**
 * GET /api/venue-logs — Query venue diagnostic logs with filters
 * POST /api/venue-logs — Create log entries (single or batch)
 *
 * Location-scoped via withVenue(). Supports pagination, level/source/category
 * filters, date range, and full-text search on message.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { getLocationId } from '@/lib/location-cache'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { logVenueEventsBatch, cleanupExpiredLogs } from '@/lib/venue-logger'
import type { VenueLogEntry } from '@/lib/venue-logger'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
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
      return err('No location found')
    }

    const params = req.nextUrl.searchParams
    const level = params.get('level')
    const source = params.get('source')
    const category = params.get('category')
    const search = params.get('search')
    const startDate = params.get('startDate')
    const endDate = params.get('endDate')
    const limit = Math.min(200, Math.max(1, parseInt(params.get('limit') || '50', 10) || 50))
    const offset = Math.max(0, parseInt(params.get('offset') || '0', 10) || 0)

    // Default to last 24 hours if no date range given
    const now = new Date()
    const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const dateFrom = startDate ? new Date(startDate) : defaultStart
    const dateTo = endDate ? new Date(endDate) : now

    // Build WHERE conditions using Prisma.sql for safe parameterization
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"locationId" = ${locationId}`,
      Prisma.sql`"createdAt" >= ${dateFrom}`,
      Prisma.sql`"createdAt" <= ${dateTo}`,
    ]

    if (level && VALID_LEVELS.includes(level)) {
      conditions.push(Prisma.sql`"level" = ${level}`)
    }
    if (source && VALID_SOURCES.includes(source)) {
      conditions.push(Prisma.sql`"source" = ${source}`)
    }
    if (category && VALID_CATEGORIES.includes(category)) {
      conditions.push(Prisma.sql`"category" = ${category}`)
    }
    if (search && search.length > 0 && search.length <= 200) {
      conditions.push(Prisma.sql`"message" ILIKE ${'%' + search + '%'}`)
    }

    const whereClause = Prisma.join(conditions, ' AND ')

    // Count total for pagination
    const countResult = await db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM "VenueLog" WHERE ${whereClause}`
    const total = Number(countResult[0]?.count ?? 0)

    // Fetch logs
    const logs = await db.$queryRaw<Array<{
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
    }>>`
      SELECT "id", "locationId", "level", "source", "category", "message", "details",
              "employeeId", "deviceId", "stackTrace", "createdAt", "expiresAt"
       FROM "VenueLog"
       WHERE ${whereClause}
       ORDER BY "createdAt" DESC
       LIMIT ${limit} OFFSET ${offset}`

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
    return err('Failed to fetch venue logs', 500)
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
      return err('No location found')
    }

    // Support both single entry and batch
    const entries: VenueLogEntry[] = Array.isArray(body) ? body : [body]

    if (entries.length === 0) {
      return err('No entries provided')
    }
    if (entries.length > 500) {
      return err('Batch size exceeds 500 limit')
    }

    // Validate each entry
    for (const entry of entries) {
      if (!entry.message || typeof entry.message !== 'string') {
        return err('Each entry requires a message string')
      }
      if (entry.level && !VALID_LEVELS.includes(entry.level)) {
        return err(`Invalid level "${entry.level}". Must be one of: ${VALID_LEVELS.join(', ')}`)
      }
      if (entry.source && !VALID_SOURCES.includes(entry.source)) {
        return err(`Invalid source "${entry.source}". Must be one of: ${VALID_SOURCES.join(', ')}`)
      }
      if (entry.category && !VALID_CATEGORIES.includes(entry.category)) {
        return err(`Invalid category "${entry.category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`)
      }
    }

    const result = await logVenueEventsBatch(entries, locationId)

    // Opportunistic cleanup: ~1% of requests trigger expired log cleanup
    if (Math.random() < 0.01) {
      void cleanupExpiredLogs().catch(err => log.warn({ err }, 'Background task failed'))
    }

    return ok({
        success: true,
        written: result.written,
        errors: result.errors,
      })
  } catch (error) {
    console.error('[venue-logs] POST failed:', error)
    return err('Failed to write venue logs', 500)
  }
}))
