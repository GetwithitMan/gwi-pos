import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { canEndDriverShift, requiresCashShortageApproval } from '@/lib/delivery/dispatch-policy'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-sessions-checkout')

export const dynamic = 'force-dynamic'

/**
 * POST /api/delivery/sessions/[id]/checkout — End-of-shift checkout
 *
 * Body: { cashTipsDeclaredCents, endOdometer?, managerOverrideEmployeeId? }
 *
 * Performs full cash reconciliation and ends the driver session in a single
 * DB transaction. Returns the checkout summary.
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
    const { cashTipsDeclaredCents, endOdometer, managerOverrideEmployeeId } = body

    if (cashTipsDeclaredCents == null || typeof cashTipsDeclaredCents !== 'number') {
      return err('cashTipsDeclaredCents is required')
    }

    // Load delivery config for policy checks
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY
    const policy = deliveryConfig.dispatchPolicy

    // Run entire checkout in a transaction
    const result = await db.$transaction(async (tx: any) => {
      // Fetch session
      const sessions: any[] = await tx.$queryRaw`
        SELECT * FROM "DeliveryDriverSession"
        WHERE id = ${id} AND "locationId" = ${locationId}
        LIMIT 1
      `

      if (!sessions.length) {
        return { error: 'Session not found', status: 404 }
      }

      const session = sessions[0]

      if (session.endedAt) {
        return { error: 'Session has already ended', status: 400 }
      }

      // Check for open runs (policy: driver cannot end shift with open run)
      const openRuns: any[] = await tx.$queryRaw`
        SELECT id FROM "DeliveryRun"
        WHERE "driverId" = ${session.driverId} AND "locationId" = ${locationId}
          AND "status" NOT IN ('completed', 'returned', 'cancelled')
        LIMIT 1
      `

      const shiftCheck = canEndDriverShift(policy, openRuns.length > 0)
      if (!shiftCheck.allowed) {
        return { error: shiftCheck.reason, status: 400 }
      }

      // Calculate expected cash from completed deliveries during this session
      // session.driverId is a DeliveryDriver.id which matches DeliveryOrder.driverId
      const expectedCashRows: any[] = await tx.$queryRaw`
        SELECT COALESCE(SUM(
          CASE WHEN dord."paymentMethod" = 'cash'
          THEN ROUND(dord."orderTotal" * 100)::int
          ELSE 0 END
        ), 0)::int as "expectedCashCents"
        FROM "DeliveryOrder" dord
        WHERE dord."driverId" = ${session.driverId}
          AND dord."locationId" = ${locationId}
          AND dord."status" = 'delivered'
          AND dord."deliveredAt" >= ${session.startedAt}
          AND dord."deliveredAt" <= CURRENT_TIMESTAMP
      `

      const expectedCashCents = expectedCashRows[0]?.expectedCashCents ?? 0

      // Calculate variance
      const cashCollectedCents = session.cashCollectedCents ?? 0
      const cashDroppedCents = session.cashDroppedCents ?? 0
      const varianceCents = cashCollectedCents - cashDroppedCents - expectedCashCents

      // Check if variance requires approval
      if (requiresCashShortageApproval(policy, varianceCents)) {
        if (!managerOverrideEmployeeId) {
          return {
            error: `Cash variance of $${(varianceCents / 100).toFixed(2)} requires manager approval. Provide managerOverrideEmployeeId.`,
            status: 400,
            requiresManagerOverride: true,
            varianceCents,
          }
        }
        // Verify manager has override permission
        const managerAuth = await requirePermission(
          managerOverrideEmployeeId,
          locationId,
          PERMISSIONS.MGR_CASH_VARIANCE_OVERRIDE,
        )
        if (!managerAuth.authorized) {
          return { error: 'Manager override employee lacks cash variance override permission', status: 403 }
        }
      }

      // Create CashTipDeclaration
      await tx.$executeRaw`
        INSERT INTO "CashTipDeclaration" (
          "id", "locationId", "employeeId", "amountCents", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, ${locationId}, ${session.employeeId}, ${cashTipsDeclaredCents}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `

      // Count deliveries in this session
      // session.driverId is a DeliveryDriver.id which matches DeliveryOrder.driverId
      const deliveryCountRows: any[] = await tx.$queryRaw`
        SELECT COUNT(*)::int as count
        FROM "DeliveryOrder"
        WHERE "driverId" = ${session.driverId}
          AND "locationId" = ${locationId}
          AND "status" = 'delivered'
          AND "deliveredAt" >= ${session.startedAt}
          AND "deliveredAt" <= CURRENT_TIMESTAMP
      `

      const deliveryCount = deliveryCountRows[0]?.count ?? 0

      // Build checkout summary
      const checkoutJson = {
        deliveryCount,
        cashCollectedCents,
        cashDroppedCents,
        expectedCashCents,
        varianceCents,
        cashTipsDeclaredCents,
        startingBankCents: session.startingBankCents ?? 0,
        endOdometer: endOdometer || null,
        startOdometer: session.startOdometer || null,
        managerOverrideEmployeeId: managerOverrideEmployeeId || null,
        completedAt: new Date().toISOString(),
      }

      // Update session: end it
      const updated: any[] = await tx.$queryRaw`
        UPDATE "DeliveryDriverSession"
        SET "endedAt" = CURRENT_TIMESTAMP,
            "status" = 'off_duty',
            "checkoutJson" = ${JSON.stringify(checkoutJson)}::jsonb,
            "cashTipsDeclaredCents" = ${cashTipsDeclaredCents},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${id} AND "locationId" = ${locationId}
        RETURNING *
      `

      if (!updated.length) {
        return { error: 'Failed to update session', status: 500 }
      }

      return { session: updated[0], checkout: checkoutJson }
    })

    // Check for error from transaction
    if ('error' in result) {
      const response: any = { error: result.error }
      if ('requiresManagerOverride' in result) {
        response.requiresManagerOverride = result.requiresManagerOverride
        response.varianceCents = result.varianceCents
      }
      return ok(response)
    }

    pushUpstream()

    // Write audit log (fire-and-forget, outside transaction)
    void writeDeliveryAuditLog({
      locationId,
      action: 'driver_checkout',
      driverId: result.session.driverId,
      employeeId: auth.authorized ? auth.employee.id : '',
      newValue: result.checkout,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ checkout: result.checkout, session: result.session })
  } catch (error) {
    console.error('[Delivery/Sessions/Checkout] POST error:', error)
    return err('Failed to process checkout', 500)
  }
})
