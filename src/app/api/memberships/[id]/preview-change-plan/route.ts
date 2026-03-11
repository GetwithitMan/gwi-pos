import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { calculateProration } from '@/lib/membership/proration'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, newPlanId } = body

    if (!locationId || !newPlanId) {
      return NextResponse.json({ error: 'locationId and newPlanId required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const mbrs: any[] = await db.$queryRawUnsafe(`
      SELECT "priceAtSignup", "currentPeriodStart", "currentPeriodEnd"
      FROM "Membership"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId)
    if (mbrs.length === 0) return NextResponse.json({ error: 'Membership not found' }, { status: 404 })

    const plans: any[] = await db.$queryRawUnsafe(`
      SELECT "price", "name" FROM "MembershipPlan"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, newPlanId, locationId)
    if (plans.length === 0) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const mbr = mbrs[0]
    const plan = plans[0]

    if (!mbr.currentPeriodStart || !mbr.currentPeriodEnd) {
      return NextResponse.json({ data: { creditAmount: 0, chargeAmount: 0, netAmount: 0, newPlanName: plan.name } })
    }

    const proration = calculateProration({
      currentPrice: parseFloat(mbr.priceAtSignup),
      newPrice: parseFloat(plan.price),
      currentPeriodStart: new Date(mbr.currentPeriodStart),
      currentPeriodEnd: new Date(mbr.currentPeriodEnd),
      effectiveDate: new Date(),
    })

    return NextResponse.json({
      data: { ...proration, newPlanName: plan.name, newPrice: parseFloat(plan.price) },
    })
  } catch (err) {
    console.error('[memberships/preview-change-plan] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
