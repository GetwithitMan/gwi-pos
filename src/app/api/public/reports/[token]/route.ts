import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { err, notFound, ok } from '@/lib/api-response'

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
      return err('Too many requests', 429)
    }

    const { token } = await context.params

    if (!token || token.length < 32) {
      return err('Invalid token')
    }

    // Look up the shared report
    const results = await db.$queryRaw<{
      id: string
      reportType: string
      parameters: unknown
      generatedData: unknown
      expiresAt: Date
      createdAt: Date
    }[]>`SELECT "id", "reportType", "parameters", "generatedData", "expiresAt", "createdAt"
       FROM "SharedReport"
       WHERE "token" = ${token}
       LIMIT 1`

    if (results.length === 0) {
      return notFound('Report not found')
    }

    const report = results[0]

    // Check expiration
    if (new Date(report.expiresAt) < new Date()) {
      return err('This report link has expired', 410)
    }

    return ok({
        reportType: report.reportType,
        parameters: report.parameters,
        generatedData: report.generatedData,
        expiresAt: report.expiresAt,
        createdAt: report.createdAt,
      })
  } catch (error) {
    console.error('[public/reports] Error fetching shared report:', error)
    return err('Internal server error', 500)
  }
})
