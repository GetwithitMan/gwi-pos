import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'

export const dynamic = 'force-dynamic'

// ── Rate limiter (20 req/min/IP) ────────────────────────────────────────────
const limiter = createRateLimiter({ maxAttempts: 20, windowMs: 60_000 })

/**
 * GET /api/public/reports/[token] — Fetch shared report data (public, no auth)
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getClientIp(request)
    if (!limiter.check(ip).allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { token } = await context.params

    if (!token || token.length < 32) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    // Look up the shared report
    const results = await db.$queryRawUnsafe<{
      id: string
      reportType: string
      parameters: unknown
      generatedData: unknown
      expiresAt: Date
      createdAt: Date
    }[]>(
      `SELECT "id", "reportType", "parameters", "generatedData", "expiresAt", "createdAt"
       FROM "SharedReport"
       WHERE "token" = $1
       LIMIT 1`,
      token
    )

    if (results.length === 0) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    const report = results[0]

    // Check expiration
    if (new Date(report.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'This report link has expired' }, { status: 410 })
    }

    return NextResponse.json({
      data: {
        reportType: report.reportType,
        parameters: report.parameters,
        generatedData: report.generatedData,
        expiresAt: report.expiresAt,
        createdAt: report.createdAt,
      },
    })
  } catch (error) {
    console.error('[public/reports] Error fetching shared report:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
