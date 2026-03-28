import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { calculateProration } from '@/lib/membership/proration'
import { err, notFound, ok } from '@/lib/api-response'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, newPlanId } = body

    if (!locationId || !newPlanId) {
      return err('locationId and newPlanId required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    const mbrs: any[] = await db.$queryRawUnsafe(`
      SELECT "priceAtSignup", "currentPeriodStart", "currentPeriodEnd"
      FROM "Membership"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId)
    if (mbrs.length === 0) return notFound('Membership not found')

    const plans: any[] = await db.$queryRawUnsafe(`
      SELECT "price", "name" FROM "MembershipPlan"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, newPlanId, locationId)
    if (plans.length === 0) return notFound('Plan not found')

    const mbr = mbrs[0]
    const plan = plans[0]

    if (!mbr.currentPeriodStart || !mbr.currentPeriodEnd) {
      return ok({ creditAmount: 0, chargeAmount: 0, netAmount: 0, newPlanName: plan.name })
    }

    const proration = calculateProration({
      currentPrice: parseFloat(mbr.priceAtSignup),
      newPrice: parseFloat(plan.price),
      currentPeriodStart: new Date(mbr.currentPeriodStart),
      currentPeriodEnd: new Date(mbr.currentPeriodEnd),
      effectiveDate: new Date(),
    })

    return ok({ ...proration, newPlanName: plan.name, newPrice: parseFloat(plan.price) })
  } catch (caughtErr) {
    console.error('[memberships/preview-change-plan] error:', err)
    return err('Internal error', 500)
  }
})
