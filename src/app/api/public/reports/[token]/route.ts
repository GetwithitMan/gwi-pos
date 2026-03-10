import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const dynamic = 'force-dynamic'

// ── Simple rate limiter for public endpoint ─────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 20 // 20 requests per minute per IP
const RATE_WINDOW_MS = 60_000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

// Cleanup stale rate limit entries
const cleanup = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key)
  }
}, 60_000)
if (cleanup && typeof cleanup === 'object' && 'unref' in cleanup) (cleanup as NodeJS.Timeout).unref()

/**
 * GET /api/public/reports/[token] — Fetch shared report data (public, no auth)
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    if (!checkRateLimit(ip)) {
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
