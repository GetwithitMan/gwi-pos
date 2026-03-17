import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { emitToLocation } from '@/lib/socket-server'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { dispatchExceptionEvent } from '@/lib/delivery/dispatch-events'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'

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

// ── Rate Limiting (in-memory, per-location) ─────────────────────────────────
// TODO: Replace with Redis or middleware-based rate limiter in production
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute

function checkRateLimit(locationId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(locationId)

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(locationId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false
  }

  entry.count++
  return true
}

/**
 * GET /api/delivery/exceptions — List delivery exceptions
 *
 * Query params: status?, severity?, type?, dateFrom?, dateTo?
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'exceptionsQueueProvisioned' })
    if (featureGate) return featureGate

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_EXCEPTIONS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

    return NextResponse.json({ exceptions })
  } catch (error) {
    console.error('[Delivery/Exceptions] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch delivery exceptions' }, { status: 500 })
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
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'exceptionsQueueProvisioned' })
    if (featureGate) return featureGate

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_EXCEPTIONS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Rate limit: 10/min per location
    if (!checkRateLimit(locationId)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Maximum 30 exceptions per minute per location.' },
        { status: 429 }
      )
    }

    const body = await request.json()
    const { type, severity, deliveryOrderId, runId, driverId, description } = body

    // Validate type
    if (!type || !(VALID_EXCEPTION_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        { error: `Invalid exception type. Must be one of: ${VALID_EXCEPTION_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate severity
    if (!severity || !(VALID_SEVERITIES as readonly string[]).includes(severity)) {
      return NextResponse.json(
        { error: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate description
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }

    // Validate foreign keys exist if provided
    if (deliveryOrderId) {
      const orderExists: any[] = await db.$queryRawUnsafe(
        `SELECT id FROM "DeliveryOrder" WHERE id = $1 AND "locationId" = $2 LIMIT 1`,
        deliveryOrderId, locationId,
      )
      if (!orderExists.length) {
        return NextResponse.json({ error: 'Delivery order not found' }, { status: 404 })
      }
    }

    if (runId) {
      const runExists: any[] = await db.$queryRawUnsafe(
        `SELECT id FROM "DeliveryRun" WHERE id = $1 AND "locationId" = $2 LIMIT 1`,
        runId, locationId,
      )
      if (!runExists.length) {
        return NextResponse.json({ error: 'Delivery run not found' }, { status: 404 })
      }
    }

    if (driverId) {
      const driverExists: any[] = await db.$queryRawUnsafe(
        `SELECT id FROM "DeliveryDriver" WHERE id = $1 AND "locationId" = $2 LIMIT 1`,
        driverId, locationId,
      )
      if (!driverExists.length) {
        return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
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
      return NextResponse.json({ error: 'Failed to create exception' }, { status: 500 })
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
    }).catch(console.error)

    // Fire socket event
    void dispatchExceptionEvent(locationId, 'delivery:exception_created', exception).catch(console.error)

    return NextResponse.json({ exception }, { status: 201 })
  } catch (error) {
    console.error('[Delivery/Exceptions] POST error:', error)
    return NextResponse.json({ error: 'Failed to create delivery exception' }, { status: 500 })
  }
})
