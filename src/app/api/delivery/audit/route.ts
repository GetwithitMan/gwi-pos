import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/audit — Query delivery audit log
 *
 * Query params: deliveryOrderId?, runId?, driverId?, action?,
 *               startDate?, endDate?, limit? (default 50, max 200), offset?
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_AUDIT)
    if (!auth.authorized) return err(auth.error, auth.status)

    const searchParams = request.nextUrl.searchParams
    const deliveryOrderId = searchParams.get('deliveryOrderId')
    const runId = searchParams.get('runId')
    const driverId = searchParams.get('driverId')
    const action = searchParams.get('action')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // Pagination
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10)
    const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 50 : rawLimit, 1), 200)
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10)
    const offset = Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0)

    let whereClause = `WHERE al."locationId" = $1`
    const params: any[] = [locationId]
    let paramIdx = 2

    if (deliveryOrderId) {
      whereClause += ` AND al."deliveryOrderId" = $${paramIdx}`
      params.push(deliveryOrderId)
      paramIdx++
    }

    if (runId) {
      whereClause += ` AND al."runId" = $${paramIdx}`
      params.push(runId)
      paramIdx++
    }

    if (driverId) {
      whereClause += ` AND al."driverId" = $${paramIdx}`
      params.push(driverId)
      paramIdx++
    }

    if (action) {
      whereClause += ` AND al."action" = $${paramIdx}`
      params.push(action)
      paramIdx++
    }

    if (startDate) {
      whereClause += ` AND al."createdAt" >= $${paramIdx}`
      params.push(new Date(startDate))
      paramIdx++
    }

    if (endDate) {
      whereClause += ` AND al."createdAt" <= $${paramIdx}`
      params.push(new Date(endDate))
      paramIdx++
    }

    // Get total count for pagination
    const countResult: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int as total
      FROM "DeliveryAuditLog" al
      ${whereClause}
    `, ...params)

    const total = countResult[0]?.total ?? 0

    // Get paginated entries
    const limitParamIdx = paramIdx
    const offsetParamIdx = paramIdx + 1
    params.push(limit, offset)

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT al.*,
             e."firstName" as "employeeFirstName",
             e."lastName" as "employeeLastName"
      FROM "DeliveryAuditLog" al
      LEFT JOIN "Employee" e ON e.id = al."employeeId"
      ${whereClause}
      ORDER BY al."createdAt" DESC
      LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
    `, ...params)

    const entries = rows.map(row => ({
      ...row,
      employeeName: row.employeeFirstName
        ? `${row.employeeFirstName} ${row.employeeLastName}`.trim()
        : null,
      previousValue: row.previousValue ?? null,
      newValue: row.newValue ?? null,
    }))

    return ok({
      entries,
      total,
      hasMore: offset + limit < total,
    })
  } catch (error) {
    console.error('[Delivery/Audit] GET error:', error)
    return err('Failed to fetch delivery audit log', 500)
  }
})
