import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { dispatchExceptionEvent } from '@/lib/delivery/dispatch-events'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { createChildLogger } from '@/lib/logger'
import { created, err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-exceptions')

export const dynamic = 'force-dynamic'

function sanitizeHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

// ── Exception Type Taxonomy ─────────────────────────────────────────────────

const VALID_EXCEPTION_TYPES = [
  'driver_no_show',
  'driver_late_return',
  'customer_unreachable',
  'wrong_address',
  'partial_order_not_ready',
  'redelivery_needed',
  'failed_proof_upload',
  'cash_overage',
  'cash_shortage',
  'reassignment_mid_run',
  'vehicle_trouble',
  'order_cancelled_after_food_left',
  'driver_overdue',
  'expiring_document',
] as const

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

// ── Rate Limiting (in-memory, per-location, 30/min) ─────────────────────────
import { createRateLimiter } from '@/lib/rate-limiter'

const limiter = createRateLimiter({ maxAttempts: 30, windowMs: 60_000 })

/**
 * GET /api/delivery/exceptions — List delivery exceptions
 *
 * Query params: status?, severity?, type?, dateFrom?, dateTo?
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'exceptionsQueueProvisioned' })
    if (featureGate) return featureGate

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_EXCEPTIONS)
    if (!auth.authorized) return err(auth.error, auth.status)

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const severity = searchParams.get('severity')
    const type = searchParams.get('type')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    let whereClause = `WHERE ex."locationId" = $1 AND ex."deletedAt" IS NULL`
    const params: any[] = [locationId]
    let paramIdx = 2

    if (status && ['open', 'acknowledged', 'resolved'].includes(status)) {
      whereClause += ` AND ex."status" = $${paramIdx}`
      params.push(status)
      paramIdx++
    }

    if (severity && (VALID_SEVERITIES as readonly string[]).includes(severity)) {
      whereClause += ` AND ex."severity" = $${paramIdx}`
      params.push(severity)
      paramIdx++
    }

    if (type && (VALID_EXCEPTION_TYPES as readonly string[]).includes(type)) {
      whereClause += ` AND ex."type" = $${paramIdx}`
      params.push(type)
      paramIdx++
    }

    if (dateFrom) {
      whereClause += ` AND ex."createdAt" >= $${paramIdx}`
      params.push(new Date(dateFrom))
      paramIdx++
    }

    if (dateTo) {
      whereClause += ` AND ex."createdAt" <= $${paramIdx}`
      params.push(new Date(dateTo))
      paramIdx++
    }

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT ex.*,
             dord."customerName" as "deliveryCustomerName",
             dord."status" as "deliveryOrderStatus",
             dord."orderId" as "deliveryOrderOrderId",
             dr."status" as "runStatus",
             dr."driverId" as "runDriverId",
             e."firstName" as "driverFirstName", e."lastName" as "driverLastName"
      FROM "DeliveryException" ex
      LEFT JOIN "DeliveryOrder" dord ON dord.id = ex."deliveryOrderId"
      LEFT JOIN "DeliveryRun" dr ON dr.id = ex."runId"
      LEFT JOIN "Employee" e ON e.id = ex."driverId"
      ${whereClause}
      ORDER BY
        CASE ex."severity"
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        ex."createdAt" ASC
    `, ...params)

    const exceptions = rows.map(row => ({
      ...row,
      driverName: row.driverFirstName ? `${row.driverFirstName} ${row.driverLastName}`.trim() : null,
    }))

    return ok({ exceptions })
  } catch (error) {
    console.error('[Delivery/Exceptions] GET error:', error)
    return err('Failed to fetch delivery exceptions', 500)
  }
})

/**
 * POST /api/delivery/exceptions — Create a new delivery exception
 *
 * Body: { type, severity, deliveryOrderId?, runId?, driverId?, description }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'exceptionsQueueProvisioned' })
    if (featureGate) return featureGate

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_EXCEPTIONS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Rate limit: 30/min per location
    if (!limiter.check(locationId).allowed) {
      return err('Rate limit exceeded. Maximum 30 exceptions per minute per location.', 429)
    }

    const body = await request.json()
    const { type, severity, deliveryOrderId, runId, driverId, description } = body

    // Validate type
    if (!type || !(VALID_EXCEPTION_TYPES as readonly string[]).includes(type)) {
      return err(`Invalid exception type. Must be one of: ${VALID_EXCEPTION_TYPES.join(', ')}`)
    }

    // Validate severity
    if (!severity || !(VALID_SEVERITIES as readonly string[]).includes(severity)) {
      return err(`Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}`)
    }

    // Validate description
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return err('Description is required')
    }

    // Validate foreign keys exist if provided
    if (deliveryOrderId) {
      const orderExists: any[] = await db.$queryRawUnsafe(
        `SELECT id FROM "DeliveryOrder" WHERE id = $1 AND "locationId" = $2 LIMIT 1`,
        deliveryOrderId, locationId,
      )
      if (!orderExists.length) {
        return notFound('Delivery order not found')
      }
    }

    if (runId) {
      const runExists: any[] = await db.$queryRawUnsafe(
        `SELECT id FROM "DeliveryRun" WHERE id = $1 AND "locationId" = $2 LIMIT 1`,
        runId, locationId,
      )
      if (!runExists.length) {
        return notFound('Delivery run not found')
      }
    }

    if (driverId) {
      const driverExists: any[] = await db.$queryRawUnsafe(
        `SELECT id FROM "DeliveryDriver" WHERE id = $1 AND "locationId" = $2 LIMIT 1`,
        driverId, locationId,
      )
      if (!driverExists.length) {
        return notFound('Driver not found')
      }
    }

    // Insert exception
    const inserted: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "DeliveryException" (
        "id", "locationId", "type", "severity", "status",
        "deliveryOrderId", "runId", "driverId",
        "description", "createdAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid()::text, $1, $2, $3, 'open',
        $4, $5, $6,
        $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `,
      locationId,
      type,
      severity,
      deliveryOrderId || null,
      runId || null,
      driverId || null,
      sanitizeHtml(description),
    )

    if (!inserted.length) {
      return err('Failed to create exception', 500)
    }

    const exception = inserted[0]

    // Write audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'exception_created',
      deliveryOrderId: deliveryOrderId || undefined,
      runId: runId || undefined,
      driverId: driverId || undefined,
      employeeId: auth.employee.id,
      newValue: { type, severity, description: sanitizeHtml(description) },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Fire socket event
    void dispatchExceptionEvent(locationId, 'delivery:exception_created', exception).catch(err => log.warn({ err }, 'Background task failed'))

    return created({ exception })
  } catch (error) {
    console.error('[Delivery/Exceptions] POST error:', error)
    return err('Failed to create delivery exception', 500)
  }
})
