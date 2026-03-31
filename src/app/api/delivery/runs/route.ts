import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { canAssignDriver, getMaxOrdersPerDriver } from '@/lib/delivery/dispatch-policy'
import { evaluateEffectiveProofMode } from '@/lib/delivery/proof-resolver'
import { dispatchRunEvent, dispatchDeliveryStatusChanged, dispatchDriverAssigned } from '@/lib/delivery/dispatch-events'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-runs')

export const dynamic = 'force-dynamic'

const CreateRunSchema = z.object({
  driverId: z.string().min(1, 'driverId is required'),
  orderIds: z.array(z.string().min(1)).min(1, 'orderIds must be a non-empty array'),
  sessionId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  notes: z.string().optional(),
})

/**
 * GET /api/delivery/runs — List delivery runs with filters
 *
 * Query params: status, driverId, dateFrom, dateTo
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const driverId = searchParams.get('driverId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    let whereClause = `WHERE r."locationId" = $1`
    const params: any[] = [locationId]
    let paramIdx = 2

    if (status) {
      whereClause += ` AND r."status" = $${paramIdx}`
      params.push(status)
      paramIdx++
    }

    if (driverId) {
      whereClause += ` AND r."driverId" = $${paramIdx}`
      params.push(driverId)
      paramIdx++
    }

    if (dateFrom) {
      whereClause += ` AND r."createdAt" >= $${paramIdx}`
      params.push(new Date(dateFrom))
      paramIdx++
    }

    if (dateTo) {
      whereClause += ` AND r."createdAt" <= $${paramIdx}`
      params.push(new Date(dateTo))
      paramIdx++
    }

    const rows: any[] = await db.$queryRaw`
      SELECT r.*,
             dd."vehicleType", dd."vehicleMake", dd."vehicleModel", dd."vehicleColor", dd."licensePlate", dd."isSuspended",
             e."firstName" as "driverFirstName", e."lastName" as "driverLastName",
             (
               SELECT COUNT(*)::int
               FROM "DeliveryOrder" dord
               WHERE dord."runId" = r.id
             ) as "orderCount"
      FROM "DeliveryRun" r
      LEFT JOIN "DeliveryDriver" dd ON dd.id = r."driverId"
      LEFT JOIN "Employee" e ON e.id = dd."employeeId"
      ${whereClause}
      ORDER BY
        CASE r."status"
          WHEN 'assigned' THEN 1
          WHEN 'handoff_ready' THEN 2
          WHEN 'dispatched' THEN 3
          WHEN 'in_progress' THEN 4
          WHEN 'completed' THEN 5
          WHEN 'returned' THEN 6
          WHEN 'cancelled' THEN 7
        END,
        r."createdAt" DESC
    `

    // Fetch orders for each run
    const runIds = rows.map(r => r.id)
    const ordersMap: Map<string, any[]> = new Map()

    if (runIds.length > 0) {
      const orderRows: any[] = await db.$queryRaw`
        SELECT d.*,
               o."orderNumber", o."status" as "orderStatus"
        FROM "DeliveryOrder" d
        LEFT JOIN "Order" o ON o.id = d."orderId"
        WHERE d."runId" = ANY(${runIds}::text[])
        ORDER BY d."runSequence" ASC NULLS LAST, d."createdAt" ASC
      `

      for (const ord of orderRows) {
        const list = ordersMap.get(ord.runId) || []
        list.push({
          ...ord,
          deliveryFee: Number(ord.deliveryFee),
        })
        ordersMap.set(ord.runId, list)
      }
    }

    const enriched = rows.map(row => ({
      ...row,
      driverName: row.driverFirstName ? `${row.driverFirstName} ${row.driverLastName}`.trim() : null,
      orders: ordersMap.get(row.id) || [],
    }))

    return ok({ runs: enriched })
  } catch (error) {
    console.error('[Delivery/Runs] GET error:', error)
    return err('Failed to fetch delivery runs', 500)
  }
})

/**
 * POST /api/delivery/runs — Create a delivery run (atomic, idempotent)
 *
 * Body: { driverId, orderIds: string[], sessionId?, idempotencyKey?, notes? }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DISPATCH)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const rawBody = await request.json()
    const parseResult = CreateRunSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(i => i.message).join(', ')}`)
    }
    const { driverId, orderIds, sessionId, idempotencyKey, notes } = parseResult.data

    // Load settings
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY
    const policy = deliveryConfig.dispatchPolicy

    // Validate order count vs maxOrdersPerRun
    if (orderIds.length > deliveryConfig.maxOrdersPerRun) {
      return err(`Run exceeds maximum ${deliveryConfig.maxOrdersPerRun} orders per run`)
    }

    // Timezone lives on Location, not LocationSettings
    const loc = await db.$queryRaw<{ timezone: string }[]>`SELECT "timezone" FROM "Location" WHERE "id" = ${locationId}`
    const timezone = loc[0]?.timezone ?? 'America/New_York'

    // Validate orders per driver limit
    const maxPerDriver = getMaxOrdersPerDriver(
      policy,
      deliveryConfig.peakHours ?? [],
      timezone
    )

    // Run creation inside a transaction for atomicity
    const result = await db.$transaction(async (tx) => {
      // 1. Idempotency check
      if (idempotencyKey) {
        const existing: any[] = await tx.$queryRaw`SELECT * FROM "DeliveryRun" WHERE "idempotencyKey" = ${idempotencyKey} AND "locationId" = ${locationId} LIMIT 1`
        if (existing.length > 0) {
          // Return existing run (idempotent)
          const existingOrders: any[] = await tx.$queryRaw`SELECT d.*, o."orderNumber" FROM "DeliveryOrder" d
             LEFT JOIN "Order" o ON o.id = d."orderId"
             WHERE d."runId" = ${existing[0].id} ORDER BY d."runSequence" ASC`
          return { run: existing[0], orders: existingOrders, isDuplicate: true }
        }
      }

      // 2. Lock delivery order rows (prevent concurrent modification)
      const lockedOrders: any[] = await tx.$queryRaw`SELECT d.*, o."orderNumber", o."status" as "orderStatus"
         FROM "DeliveryOrder" d
         LEFT JOIN "Order" o ON o.id = d."orderId"
         WHERE d.id = ANY(${orderIds}::text[]) AND d."locationId" = ${locationId}
         FOR UPDATE OF d`

      // 3. Validate all orders belong to this location
      if (lockedOrders.length !== orderIds.length) {
        const foundIds = new Set(lockedOrders.map(o => o.id))
        const missing = orderIds.filter((id: string) => !foundIds.has(id))
        throw new Error(`Orders not found: ${missing.join(', ')}`)
      }

      // 4. Validate all orders are in valid status for run assignment
      const invalidOrders = lockedOrders.filter(
        o => o.status !== 'ready_for_pickup' && o.status !== 'assigned'
      )
      if (invalidOrders.length > 0) {
        throw new Error(
          `Orders not ready for run: ${invalidOrders.map(o => `${o.id} (${o.status})`).join(', ')}`
        )
      }

      // 5. Validate driver exists, isActive, not suspended
      const drivers: any[] = await tx.$queryRaw`SELECT dd.*, e."firstName", e."lastName"
         FROM "DeliveryDriver" dd
         JOIN "Employee" e ON e.id = dd."employeeId"
         WHERE dd.id = ${driverId} AND dd."locationId" = ${locationId}`
      if (!drivers.length) {
        throw new Error('Driver not found')
      }
      const driver = drivers[0]

      const driverCheck = canAssignDriver(policy, {
        isSuspended: driver.isSuspended ?? false,
        isActive: driver.isActive ?? true,
      })
      if (!driverCheck.allowed) {
        throw new Error(driverCheck.reason || 'Driver cannot be assigned')
      }

      // 6. Validate no active run for this driver
      const activeRuns: any[] = await tx.$queryRaw`SELECT id FROM "DeliveryRun"
         WHERE "driverId" = ${driverId} AND "locationId" = ${locationId}
           AND status NOT IN ('completed', 'returned', 'cancelled')
         LIMIT 1`
      if (activeRuns.length > 0) {
        throw new Error('Driver already has an active run. Complete or cancel the existing run first.')
      }

      // 7. Validate orders per driver limit (include existing active orders)
      const driverActiveCount: any[] = await tx.$queryRaw`SELECT COUNT(*)::int as count
         FROM "DeliveryOrder"
         WHERE "driverId" = ${driverId} AND "locationId" = ${locationId}
           AND status NOT IN ('delivered', 'cancelled_before_dispatch', 'cancelled_after_dispatch', 'failed_delivery', 'returned_to_store')`
      const currentDriverOrders = driverActiveCount[0]?.count ?? 0
      if (currentDriverOrders + orderIds.length > maxPerDriver) {
        throw new Error(
          `Driver would exceed max ${maxPerDriver} active orders (current: ${currentDriverOrders}, adding: ${orderIds.length})`
        )
      }

      // 8. If blockDispatchWithoutValidZone: check all orders have zoneId
      if (policy.blockDispatchWithoutValidZone) {
        const noZone = lockedOrders.filter(o => !o.zoneId)
        if (noZone.length > 0) {
          throw new Error(
            `Orders missing delivery zone: ${noZone.map(o => o.id).join(', ')}. Assign zones or use manual pin-drop.`
          )
        }
      }

      // 9. Resolve effective proof mode for each order
      const proofModes: Map<string, string> = new Map()
      for (const order of lockedOrders) {
        const effectiveMode = evaluateEffectiveProofMode({
          baselineMode: deliveryConfig.proofOfDeliveryMode ?? 'none',
          proofRequiredForFlaggedCustomers: policy.proofRequiredForFlaggedCustomers,
          proofRequiredForCashOrders: policy.proofRequiredForCashOrders,
          proofRequiredAboveAmount: policy.proofRequiredAboveAmount,
          proofRequiredForAlcohol: policy.proofRequiredForAlcohol,
          proofRequiredForApartments: policy.proofRequiredForApartments,
          orderTotal: Number(order.deliveryFee ?? 0),
          isCashOrder: order.paymentMethod === 'cash',
          isCustomerFlagged: order.isCustomerFlagged ?? false,
          containsAlcohol: order.containsAlcohol ?? false,
          isApartment: order.isApartment ?? false,
        })
        proofModes.set(order.id, effectiveMode)
      }

      // 10. Build orderSequence JSONB
      const orderSequence = orderIds.map((orderId: string, idx: number) => {
        const order = lockedOrders.find(o => o.id === orderId)
        return {
          orderId,
          sequence: idx + 1,
          estimatedArrivalAt: null, // Phase 2: route-based ETA
        }
      })

      // 11. INSERT DeliveryRun
      const runInserted: any[] = await tx.$queryRaw`INSERT INTO "DeliveryRun" (
          "id", "locationId", "driverId", "status", "orderSequence",
          "notes", "idempotencyKey", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, ${locationId}, ${driverId}, 'assigned', ${JSON.stringify(orderSequence)}::jsonb,
          ${notes?.trim() || null}, ${idempotencyKey || null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) RETURNING *`

      const run = runInserted[0]

      // 12. UPDATE all DeliveryOrders
      const updatedOrders: any[] = []
      for (let i = 0; i < lockedOrders.length; i++) {
        const order = lockedOrders[i]
        const sequence = orderIds.indexOf(order.id) + 1
        const proofMode = proofModes.get(order.id) || 'none'

        // Freeze address snapshot
        const addressSnapshot = JSON.stringify({
          address: order.address,
          addressLine2: order.addressLine2,
          city: order.city,
          state: order.state,
          zipCode: order.zipCode,
          lat: order.lat,
          lng: order.lng,
        })

        const updated: any[] = await tx.$queryRaw`UPDATE "DeliveryOrder"
           SET "runId" = ${run.id},
               "runSequence" = ${sequence},
               "status" = 'assigned',
               "assignedAt" = CURRENT_TIMESTAMP,
               "driverId" = COALESCE("driverId", ${driverId}),
               "proofMode" = ${proofMode},
               "addressSnapshotJson" = ${addressSnapshot}::jsonb,
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE id = ${order.id} AND "locationId" = ${locationId}
           RETURNING *`
        if (updated.length > 0) {
          updatedOrders.push({ ...updated[0], orderNumber: order.orderNumber })
        }
      }

      // 13. UPDATE DeliveryDriverSession if sessionId provided
      if (sessionId) {
        await tx.$queryRaw`UPDATE "DeliveryDriverSession"
           SET "status" = 'on_delivery',
               "deliveryCount" = COALESCE("deliveryCount", 0) + ${orderIds.length},
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE id = ${sessionId} AND "locationId" = ${locationId}`
      } else {
        // Find active session for this driver and update it
        await tx.$queryRaw`UPDATE "DeliveryDriverSession"
           SET "status" = 'on_delivery',
               "deliveryCount" = COALESCE("deliveryCount", 0) + ${orderIds.length},
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE "driverId" = ${driverId} AND "locationId" = ${locationId}
             AND "endedAt" IS NULL
             AND status != 'off_duty'`
      }

      // 14. Write audit logs
      await writeDeliveryAuditLog({
        locationId,
        action: 'run_created',
        runId: run.id,
        driverId,
        employeeId: actor.employeeId ?? 'unknown',
        newValue: {
          orderIds,
          orderSequence,
          driverName: `${driver.firstName} ${driver.lastName}`.trim(),
        },
        idempotencyKey: idempotencyKey || undefined,
      })

      for (const order of updatedOrders) {
        await writeDeliveryAuditLog({
          locationId,
          action: 'order_assigned_to_run',
          deliveryOrderId: order.id,
          runId: run.id,
          driverId,
          employeeId: actor.employeeId ?? 'unknown',
          previousValue: { status: lockedOrders.find(o => o.id === order.id)?.status },
          newValue: { status: 'assigned', runId: run.id, runSequence: order.runSequence },
        })
      }

      return { run, orders: updatedOrders, isDuplicate: false }
    })

    pushUpstream()

    // Fire socket events (fire-and-forget, outside transaction)
    void dispatchRunEvent(locationId, 'delivery:run_created', result.run).catch(err => log.warn({ err }, 'Background task failed'))
    for (const order of result.orders) {
      void dispatchDeliveryStatusChanged(locationId, order).catch(err => log.warn({ err }, 'Background task failed'))
      void dispatchDriverAssigned(locationId, {
        deliveryOrderId: order.id,
        orderId: order.orderId,
        driverId: driverId,
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    return NextResponse.json(
      { run: result.run, orders: result.orders },
      { status: result.isDuplicate ? 200 : 201 }
    )
  } catch (error: any) {
    console.error('[Delivery/Runs] POST error:', error)
    const message = error?.message || 'Failed to create delivery run'
    // Known validation errors return 400
    if (
      message.includes('not found') ||
      message.includes('not ready') ||
      message.includes('missing delivery zone') ||
      message.includes('already has an active run') ||
      message.includes('exceed max') ||
      message.includes('cannot be assigned') ||
      message.includes('suspended') ||
      message.includes('inactive')
    ) {
      return err(message)
    }
    return err('Failed to create delivery run', 500)
  }
})
