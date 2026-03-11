import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'

// GET — list active membership plans for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId')
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId ?? sp.get('requestingEmployeeId')

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(employeeId, locationId, 'admin.manage_membership_plans')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const plans: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "MembershipPlan"
      WHERE "locationId" = $1 AND "deletedAt" IS NULL
      ORDER BY "sortOrder" ASC, "name" ASC
    `, locationId)

    return NextResponse.json({ data: plans })
  } catch (err) {
    console.error('[membership-plans] GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})

// POST — create a new membership plan
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, requestingEmployeeId: bodyEmployeeId, name, description, price, billingCycle,
            billingDayOfMonth, billingDayOfWeek, trialDays, setupFee, benefits,
            maxMembers, isActive, sortOrder, currency } = body

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })
    if (!name || price == null) return NextResponse.json({ error: 'name and price are required' }, { status: 400 })

    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId ?? bodyEmployeeId

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_membership_plans')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

    return NextResponse.json({ data: rows[0] }, { status: 201 })
  } catch (err) {
    console.error('[membership-plans] POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
