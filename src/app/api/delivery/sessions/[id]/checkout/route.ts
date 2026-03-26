import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { canEndDriverShift, requiresCashShortageApproval } from '@/lib/delivery/dispatch-policy'
import { createChildLogger } from '@/lib/logger'
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
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DISPATCH)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const { cashTipsDeclaredCents, endOdometer, managerOverrideEmployeeId } = body

    if (cashTipsDeclaredCents == null || typeof cashTipsDeclaredCents !== 'number') {
      return NextResponse.json({ error: 'cashTipsDeclaredCents is required' }, { status: 400 })
    }

    // Load delivery config for policy checks
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY
    const policy = deliveryConfig.dispatchPolicy

    // Run entire checkout in a transaction
    const result = await db.$transaction(async (tx: any) => {
      // Fetch session
      const sessions: any[] = await tx.$queryRawUnsafe(`
        SELECT * FROM "DeliveryDriverSession"
        WHERE id = $1 AND "locationId" = $2
        LIMIT 1
      `, id, locationId)

      if (!sessions.length) {
        return { error: 'Session not found', status: 404 }
      }

      const session = sessions[0]

      if (session.endedAt) {
        return { error: 'Session has already ended', status: 400 }
      }

      // Check for open runs (policy: driver cannot end shift with open run)
      const openRuns: any[] = await tx.$queryRawUnsafe(`
        SELECT id FROM "DeliveryRun"
        WHERE "driverId" = $1 AND "locationId" = $2
          AND "status" NOT IN ('completed', 'returned', 'cancelled')
        LIMIT 1
      `, session.driverId, locationId)

      const shiftCheck = canEndDriverShift(policy, openRuns.length > 0)
      if (!shiftCheck.allowed) {
        return { error: shiftCheck.reason, status: 400 }
      }

      // Calculate expected cash from completed deliveries during this session
      // session.driverId is a DeliveryDriver.id which matches DeliveryOrder.driverId
      const expectedCashRows: any[] = await tx.$queryRawUnsafe(`
        SELECT COALESCE(SUM(
          CASE WHEN dord."paymentMethod" = 'cash'
          THEN ROUND(dord."orderTotal" * 100)::int
          ELSE 0 END
        ), 0)::int as "expectedCashCents"
        FROM "DeliveryOrder" dord
        WHERE dord."driverId" = $1
          AND dord."locationId" = $2
          AND dord."status" = 'delivered'
          AND dord."deliveredAt" >= $3
          AND dord."deliveredAt" <= CURRENT_TIMESTAMP
      `, session.driverId, locationId, session.startedAt)

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
      await tx.$executeRawUnsafe(`
        INSERT INTO "CashTipDeclaration" (
          "id", "locationId", "employeeId", "amountCents", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, locationId, session.employeeId, cashTipsDeclaredCents)

      // Count deliveries in this session
      // session.driverId is a DeliveryDriver.id which matches DeliveryOrder.driverId
      const deliveryCountRows: any[] = await tx.$queryRawUnsafe(`
        SELECT COUNT(*)::int as count
        FROM "DeliveryOrder"
        WHERE "driverId" = $1
          AND "locationId" = $2
          AND "status" = 'delivered'
          AND "deliveredAt" >= $3
          AND "deliveredAt" <= CURRENT_TIMESTAMP
      `, session.driverId, locationId, session.startedAt)

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
      const updated: any[] = await tx.$queryRawUnsafe(`
        UPDATE "DeliveryDriverSession"
        SET "endedAt" = CURRENT_TIMESTAMP,
            "status" = 'off_duty',
            "checkoutJson" = $1::jsonb,
            "cashTipsDeclaredCents" = $2,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $3 AND "locationId" = $4
        RETURNING *
      `,
        JSON.stringify(checkoutJson),
        cashTipsDeclaredCents,
        id,
        locationId,
      )

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
      return NextResponse.json(response, { status: result.status })
    }

    // Write audit log (fire-and-forget, outside transaction)
    void writeDeliveryAuditLog({
      locationId,
      action: 'driver_checkout',
      driverId: result.session.driverId,
      employeeId: auth.authorized ? auth.employee.id : '',
      newValue: result.checkout,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({ checkout: result.checkout, session: result.session })
  } catch (error) {
    console.error('[Delivery/Sessions/Checkout] POST error:', error)
    return NextResponse.json({ error: 'Failed to process checkout' }, { status: 500 })
  }
})
