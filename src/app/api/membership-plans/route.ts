import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { created, err, ok } from '@/lib/api-response'

// GET — list active membership plans for a location (no admin perm needed — read-only POS query)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId') || await getLocationId()

    if (!locationId) return err('locationId required')

    const plans: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "MembershipPlan"
      WHERE "locationId" = $1 AND "deletedAt" IS NULL
      ORDER BY "sortOrder" ASC, "name" ASC
    `, locationId)

    return ok(plans)
  } catch (caughtErr) {
    console.error('[membership-plans] GET error:', err)
    return err('Internal error', 500)
  }
})

// POST — create a new membership plan
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, requestingEmployeeId: bodyEmployeeId, name, description, price, billingCycle,
            billingDayOfMonth, billingDayOfWeek, trialDays, setupFee, benefits,
            maxMembers, isActive, sortOrder, currency } = body

    if (!locationId) return err('locationId required')
    if (!name || price == null) return err('name and price are required')

    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId ?? bodyEmployeeId

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_membership_plans')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "MembershipPlan" (
        "locationId", "name", "description", "price", "billingCycle",
        "billingDayOfMonth", "billingDayOfWeek", "trialDays", "setupFee",
        "benefits", "maxMembers", "isActive", "sortOrder", "currency"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `,
      locationId, name, description || null, price, billingCycle || 'monthly',
      billingDayOfMonth ?? null, billingDayOfWeek ?? null, trialDays ?? 0, setupFee ?? 0,
      benefits ? JSON.stringify(benefits) : null, maxMembers ?? null,
      isActive !== false, sortOrder ?? 0, currency || 'USD'
    )

    return created(rows[0])
  } catch (caughtErr) {
    console.error('[membership-plans] POST error:', err)
    return err('Internal error', 500)
  }
})
