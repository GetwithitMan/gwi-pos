import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/sessions/[id]/checkout/preview — Preview checkout totals before confirming
 */
export const GET = withVenue(async function GET(
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

    // Fetch session
    const sessions: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "DeliveryDriverSession"
      WHERE id = $1 AND "locationId" = $2
      LIMIT 1
    `, id, locationId)

    if (!sessions.length) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const session = sessions[0]

    if (session.endedAt) {
      return NextResponse.json({ error: 'Session has already ended' }, { status: 400 })
    }

    // Count deliveries in this session
    const deliveryStats: any[] = await db.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "deliveryCount",
        COALESCE(SUM(
          CASE WHEN do."paymentMethod" = 'cash'
          THEN ROUND(do."orderTotal" * 100)::int
          ELSE 0 END
        ), 0)::int as "expectedCashCents",
        COALESCE(SUM(
          CASE WHEN do."tipAmount" IS NOT NULL
          THEN ROUND(do."tipAmount" * 100)::int
          ELSE 0 END
        ), 0)::int as "estimatedTipsCents"
      FROM "DeliveryOrder" do
      WHERE do."driverId" = $1
        AND do."locationId" = $2
        AND do."status" = 'delivered'
        AND do."deliveredAt" >= $3
        AND do."deliveredAt" <= CURRENT_TIMESTAMP
    `, session.employeeId, locationId, session.startedAt)

    const stats = deliveryStats[0] || {}

    const cashCollectedCents = session.cashCollectedCents ?? 0
    const cashDroppedCents = session.cashDroppedCents ?? 0
    const expectedCashCents = stats.expectedCashCents ?? 0

    // Calculate mileage if odometer data available
    let mileage = null
    if (session.startOdometer) {
      // Mileage will be finalized at checkout when endOdometer is provided
      const rawSettings = await getLocationSettings(locationId)
      const settings = mergeWithDefaults(rawSettings as any)
      const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY
      mileage = {
        startOdometer: session.startOdometer,
        reimbursementRate: deliveryConfig.mileageReimbursementRate,
      }
    }

    // Session duration
    const startedAt = new Date(session.startedAt)
    const durationMinutes = Math.round((Date.now() - startedAt.getTime()) / (1000 * 60))

    return NextResponse.json({
      preview: {
        sessionId: id,
        driverId: session.driverId,
        employeeId: session.employeeId,
        deliveryCount: stats.deliveryCount ?? 0,
        cashCollectedCents,
        cashDroppedCents,
        expectedCashCents,
        cashOnHandCents: cashCollectedCents - cashDroppedCents,
        varianceCents: cashCollectedCents - cashDroppedCents - expectedCashCents,
        estimatedTipsCents: stats.estimatedTipsCents ?? 0,
        startingBankCents: session.startingBankCents ?? 0,
        mileage,
        sessionDurationMinutes: durationMinutes,
        startedAt: session.startedAt,
      },
    })
  } catch (error) {
    console.error('[Delivery/Sessions/Checkout/Preview] GET error:', error)
    return NextResponse.json({ error: 'Failed to generate checkout preview' }, { status: 500 })
  }
})
