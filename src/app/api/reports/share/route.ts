import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { randomBytes } from 'crypto'
import { err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * POST /api/reports/share — Create a shareable report link
 *
 * Body: {
 *   reportType: string,         // e.g. 'sales', 'labor-cost', 'product-mix'
 *   parameters: object,         // date range, filters, etc.
 *   generatedData: object,      // the full report data snapshot
 *   locationId: string,
 *   employeeId: string,
 *   expirationHours?: number,   // default 72
 * }
 *
 * Returns: { url, token, expiresAt }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      reportType,
      parameters,
      generatedData,
      locationId,
      employeeId,
      expirationHours = 72,
    } = body

    if (!reportType || !locationId || !employeeId) {
      return err('reportType, locationId, and employeeId are required')
    }

    if (!generatedData || typeof generatedData !== 'object') {
      return err('generatedData (report snapshot) is required')
    }

    // Validate permission — need REPORTS_EXPORT to share
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_EXPORT)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Generate secure token (32 bytes = 64 hex chars)
    const token = randomBytes(32).toString('hex')

    // Calculate expiration
    const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000)

    // Store in SharedReport table
    await db.$executeRawUnsafe(
      `INSERT INTO "SharedReport" ("id", "locationId", "token", "reportType", "parameters", "generatedData", "expiresAt", "createdById")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      locationId,
      token,
      reportType,
      JSON.stringify(parameters || {}),
      JSON.stringify(generatedData),
      expiresAt,
      employeeId
    )

    // Build the share URL
    const host = request.headers.get('host') || 'localhost:3005'
    const protocol = host.includes('localhost') ? 'http' : 'https'
    const url = `${protocol}://${host}/reports/shared/${token}`

    return ok({ url, token, expiresAt: expiresAt.toISOString() })
  } catch (error) {
    console.error('[reports/share] Error creating shared report:', error)
    return err('Failed to create shared report', 500)
  }
})
