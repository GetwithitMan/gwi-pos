import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { canAssignDriver } from '@/lib/delivery/dispatch-policy'
import { dispatchRunEvent, dispatchDriverStatusChanged, dispatchOrderReassigned } from '@/lib/delivery/dispatch-events'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-runs-reassign')

export const dynamic = 'force-dynamic'

/**
 * POST /api/delivery/runs/[id]/reassign — Reassign run to a different driver
 *
 * Body: { newDriverId, reason }
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    const body = await request.json()
    const { newDriverId, reason } = body

    if (!newDriverId || typeof newDriverId !== 'string') {
      return err('newDriverId is required')
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return err('reason is required for reassignment')
    }

    // Load dispatch policy
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY
    const policy = deliveryConfig.dispatchPolicy

    const result = await db.$transaction(async (tx) => {
      // Fetch the run
      const runs: any[] = await tx.$queryRaw`SELECT * FROM "DeliveryRun" WHERE id = ${id} AND "locationId" = ${locationId} FOR UPDATE`

      if (!runs.length) {
        throw new Error('Run not found')
      }

      const run = runs[0]
      const oldDriverId = run.driverId

      if (oldDriverId === newDriverId) {
        throw new Error('New driver is the same as the current driver')
      }

      // Run must not be in terminal state
      if (['completed', 'returned', 'cancelled'].includes(run.status)) {
        throw new Error(`Cannot reassign a run in '${run.status}' status`)
      }

      // Validate new driver exists and is eligible
      const newDrivers: any[] = await tx.$queryRaw`SELECT dd.*, e."firstName", e."lastName"
         FROM "DeliveryDriver" dd
         JOIN "Employee" e ON e.id = dd."employeeId"
         WHERE dd.id = ${newDriverId} AND dd."locationId" = ${locationId}`

      if (!newDrivers.length) {
        throw new Error('New driver not found')
      }

      const newDriver = newDrivers[0]
      const driverCheck = canAssignDriver(policy, {
        isSuspended: newDriver.isSuspended ?? false,
        isActive: newDriver.isActive ?? true,
      })
      if (!driverCheck.allowed) {
        throw new Error(driverCheck.reason || 'New driver cannot be assigned')
      }

      // Check new driver has no active run
      const newDriverActiveRuns: any[] = await tx.$queryRaw`SELECT id FROM "DeliveryRun"
         WHERE "driverId" = ${newDriverId} AND "locationId" = ${locationId}
           AND status NOT IN ('completed', 'returned', 'cancelled')
           AND id != ${id}
         LIMIT 1`
      if (newDriverActiveRuns.length > 0) {
        throw new Error('New driver already has an active run')
      }

      // 1. Update DeliveryRun
      const updatedRun: any[] = await tx.$queryRaw`UPDATE "DeliveryRun"
         SET "driverId" = ${newDriverId}, "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = ${id} AND "locationId" = ${locationId}
         RETURNING *`

      // 2. Update all DeliveryOrders in run
      await tx.$queryRaw`UPDATE "DeliveryOrder"
         SET "driverId" = ${newDriverId}, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "runId" = ${id} AND "locationId" = ${locationId}`

      // 3. Update old driver session → available
      if (oldDriverId) {
        const oldSessions: any[] = await tx.$queryRaw`UPDATE "DeliveryDriverSession"
           SET "status" = 'available', "updatedAt" = CURRENT_TIMESTAMP
           WHERE "driverId" = ${oldDriverId} AND "locationId" = ${locationId}
             AND "endedAt" IS NULL AND status = 'on_delivery'
           RETURNING *`
        if (oldSessions.length > 0) {
          void dispatchDriverStatusChanged(locationId, oldSessions[0]).catch(err => log.warn({ err }, 'Background task failed'))
        }
      }

      // 4. Update new driver session → on_delivery
      const newSessions: any[] = await tx.$queryRaw`UPDATE "DeliveryDriverSession"
         SET "status" = 'on_delivery', "updatedAt" = CURRENT_TIMESTAMP
         WHERE "driverId" = ${newDriverId} AND "locationId" = ${locationId}
           AND "endedAt" IS NULL AND status != 'off_duty'
         RETURNING *`
      if (newSessions.length > 0) {
        void dispatchDriverStatusChanged(locationId, newSessions[0]).catch(err => log.warn({ err }, 'Background task failed'))
      }

      // Get old driver name for audit
      let oldDriverName = 'unknown'
      if (oldDriverId) {
        const oldDrivers: any[] = await tx.$queryRaw`SELECT e."firstName", e."lastName"
           FROM "DeliveryDriver" dd
           JOIN "Employee" e ON e.id = dd."employeeId"
           WHERE dd.id = ${oldDriverId}`
        if (oldDrivers.length > 0) {
          oldDriverName = `${oldDrivers[0].firstName} ${oldDrivers[0].lastName}`.trim()
        }
      }

      return {
        run: updatedRun[0],
        oldDriverId,
        oldDriverName,
        newDriverName: `${newDriver.firstName} ${newDriver.lastName}`.trim(),
      }
    })

    pushUpstream()

    // Write audit log (outside tx for non-blocking)
    void writeDeliveryAuditLog({
      locationId,
      action: 'reassignment',
      runId: id,
      driverId: newDriverId,
      employeeId: actor.employeeId ?? 'unknown',
      previousValue: { driverId: result.oldDriverId, driverName: result.oldDriverName },
      newValue: { driverId: newDriverId, driverName: result.newDriverName },
      reason: reason.trim(),
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Fire socket events
    void dispatchRunEvent(locationId, 'delivery:run_created', result.run).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchOrderReassigned(locationId, {
      runId: id,
      oldDriverId: result.oldDriverId,
      newDriverId: newDriverId,
      oldDriverName: result.oldDriverName,
      newDriverName: result.newDriverName,
      reason: reason.trim(),
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
      run: result.run,
      message: `Run reassigned from ${result.oldDriverName} to ${result.newDriverName}`,
    })
  } catch (error: any) {
    console.error('[Delivery/Runs/Reassign] POST error:', error)
    const message = error?.message || 'Failed to reassign run'
    if (
      message.includes('not found') ||
      message.includes('same as the current') ||
      message.includes('Cannot reassign') ||
      message.includes('active run') ||
      message.includes('cannot be assigned')
    ) {
      return err(message)
    }
    return err('Failed to reassign run', 500)
  }
})
