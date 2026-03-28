import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { advanceDriverSessionStatus, writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { shouldForceCashDrop } from '@/lib/delivery/dispatch-policy'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-sessions')

export const dynamic = 'force-dynamic'

/**
 * PUT /api/delivery/sessions/[id] — Update session (status change, record cash drop)
 *
 * Body: { status?, cashDropAmount?, cashCollectedCents? }
 */
export const PUT = withVenue(async function PUT(
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
    const { status, cashDropAmount, cashCollectedCents } = body

    // Fetch current session
    const sessions: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "DeliveryDriverSession"
      WHERE id = $1 AND "locationId" = $2
      LIMIT 1
    `, id, locationId)

    if (!sessions.length) {
      return notFound('Session not found')
    }

    const session = sessions[0]

    if (session.endedAt) {
      return err('Session has already ended')
    }

    let updatedSession = session
    let warning: string | null = null

    // Handle status change via state machine
    if (status) {
      const result = await advanceDriverSessionStatus(
        id,
        locationId,
        status,
        auth.authorized ? auth.employee.id : '',
      )

      if (!result.success) {
        return err(result.error)
      }

      updatedSession = result.session
    }

    // Handle cash drop
    if (cashDropAmount != null && cashDropAmount > 0) {
      const cashDropCents = Math.round(Number(cashDropAmount) * 100)

      const dropResult: any[] = await db.$queryRawUnsafe(`
        UPDATE "DeliveryDriverSession"
        SET "cashDroppedCents" = "cashDroppedCents" + $1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $2 AND "locationId" = $3
        RETURNING *
      `, cashDropCents, id, locationId)

      if (dropResult.length) {
        updatedSession = dropResult[0]
      }

      // Write audit log for cash drop
      void writeDeliveryAuditLog({
        locationId,
        action: 'cash_drop',
        driverId: session.driverId,
        employeeId: auth.authorized ? auth.employee.id : '',
        newValue: { cashDropCents, totalDroppedCents: updatedSession.cashDroppedCents },
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Handle cashCollectedCents update (e.g., after a cash delivery)
    if (cashCollectedCents != null) {
      const collectResult: any[] = await db.$queryRawUnsafe(`
        UPDATE "DeliveryDriverSession"
        SET "cashCollectedCents" = $1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $2 AND "locationId" = $3
        RETURNING *
      `, Number(cashCollectedCents), id, locationId)

      if (collectResult.length) {
        updatedSession = collectResult[0]
      }
    }

    // Check if forced cash drop is needed
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY
    const policy = deliveryConfig.dispatchPolicy

    const outstandingCash =
      (updatedSession.cashCollectedCents ?? 0) - (updatedSession.cashDroppedCents ?? 0)
    if (shouldForceCashDrop(policy, outstandingCash)) {
      warning = `Cash on hand ($${(outstandingCash / 100).toFixed(2)}) exceeds drop threshold ($${deliveryConfig.cashDropThreshold.toFixed(2)}). Cash drop required.`
    }

    const response: any = { session: updatedSession }
    if (warning) {
      response.warning = warning
    }

    return ok(response)
  } catch (error) {
    console.error('[Delivery/Sessions/Detail] PUT error:', error)
    return err('Failed to update session', 500)
  }
})
