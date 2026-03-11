import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { getPayApiClient, PayApiError } from '@/lib/datacap/payapi-client'
import { buildIdempotencyKey } from '@/lib/membership/idempotency'
import { calculateSignupProration, getNextBillingDate } from '@/lib/membership/proration'
import { ChargeType, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'

// GET — list memberships with filters + pagination
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId')
    const employeeId = sp.get('requestingEmployeeId')
    const status = sp.get('status')
    const billingStatus = sp.get('billingStatus')
    const customerId = sp.get('customerId')
    const limit = parseInt(sp.get('limit') || '50')
    const offset = parseInt(sp.get('offset') || '0')

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(employeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    let where = `"m"."locationId" = $1 AND "m"."deletedAt" IS NULL`
    const params: any[] = [locationId]
    let idx = 2

    if (status) { where += ` AND "m"."status" = $${idx}`; params.push(status); idx++ }
    if (billingStatus) { where += ` AND "m"."billingStatus" = $${idx}`; params.push(billingStatus); idx++ }
    if (customerId) { where += ` AND "m"."customerId" = $${idx}`; params.push(customerId); idx++ }

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT "m".*, "p"."name" AS "planName", "p"."price" AS "planPrice"
      FROM "Membership" "m"
      LEFT JOIN "MembershipPlan" "p" ON "m"."planId" = "p"."id"
      WHERE ${where}
      ORDER BY "m"."createdAt" DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, ...params, limit, offset)

    const countResult: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "total"
      FROM "Membership" "m"
      WHERE ${where}
    `, ...params)

    return NextResponse.json({ data: rows, total: countResult[0]?.total ?? 0 })
  } catch (err) {
    console.error('[memberships] GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})

// POST — enroll a new membership
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, requestingEmployeeId, customerId, planId, savedCardId } = body

    if (!locationId || !customerId || !planId) {
      return NextResponse.json({ error: 'locationId, customerId, planId required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Validate plan
    const plans: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "MembershipPlan"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL AND "isActive" = true
      LIMIT 1
    `, planId, locationId)
    if (plans.length === 0) return NextResponse.json({ error: 'Plan not found or inactive' }, { status: 404 })
    const plan = plans[0]

    // Validate customer
    const customers: any[] = await db.$queryRawUnsafe(`
      SELECT "id" FROM "Customer"
      WHERE "id" = $1 AND "locationId" = $2 AND "isActive" = true
      LIMIT 1
    `, customerId, locationId)
    if (customers.length === 0) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    // Validate saved card if provided
    let token: string | null = null
    if (savedCardId) {
      const cards: any[] = await db.$queryRawUnsafe(`
        SELECT "id", "token" FROM "SavedCard"
        WHERE "id" = $1 AND "locationId" = $2 AND "customerId" = $3 AND "deletedAt" IS NULL
        LIMIT 1
      `, savedCardId, locationId, customerId)
      if (cards.length === 0) return NextResponse.json({ error: 'Saved card not found or does not belong to customer' }, { status: 400 })
      token = cards[0].token
    }

    // Check max members
    if (plan.maxMembers) {
      const countResult: any[] = await db.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS "cnt" FROM "Membership"
        WHERE "planId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL AND "status" IN ('trial', 'active', 'paused')
      `, planId, locationId)
      if (countResult[0]?.cnt >= plan.maxMembers) {
        return NextResponse.json({ error: 'Plan is at maximum capacity' }, { status: 409 })
      }
    }

    const now = new Date()
    const hasTrial = plan.trialDays > 0
    const initialStatus = hasTrial ? 'trial' : 'active'
    const trialEndsAt = hasTrial ? new Date(now.getTime() + plan.trialDays * 86400000) : null
    const price = parseFloat(plan.price)
    const billingCycle = plan.billingCycle || 'monthly'

    // Calculate first billing date
    let nextBillingDate: Date
    let periodStart: Date
    let periodEnd: Date

    if (hasTrial) {
      nextBillingDate = trialEndsAt!
      periodStart = now
      periodEnd = trialEndsAt!
    } else {
      const proration = calculateSignupProration({
        price,
        billingCycle,
        signupDate: now,
        billingDayOfMonth: plan.billingDayOfMonth,
        billingDayOfWeek: plan.billingDayOfWeek,
      })
      nextBillingDate = proration.nextFullBillingDate
      periodStart = proration.periodStart
      periodEnd = proration.periodEnd
    }

    // Charge setup fee if applicable
    let recurringData: string | null = null
    if (plan.setupFee > 0 && token) {
      const setupKey = buildIdempotencyKey({
        type: ChargeType.SETUP_FEE,
        params: { membershipId: 'pending', signupAt: now },
      })

      try {
        const payapi = getPayApiClient()
        const invoiceNo = `MBR-SETUP-${Date.now()}`
        const resp = await payapi.sale({
          token,
          amount: parseFloat(plan.setupFee).toFixed(2),
          invoiceNo,
          recurringData: 'Recurring',
        })
        recurringData = resp.recurringData || null
        if (resp.token) token = resp.token
      } catch (err) {
        if (err instanceof PayApiError) {
          return NextResponse.json({ error: `Setup fee charge failed: ${err.message}` }, { status: 402 })
        }
        throw err
      }
    }

    // Create membership
    const rows: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "Membership" (
        "locationId", "customerId", "planId", "savedCardId",
        "status", "billingStatus", "currentPeriodStart", "currentPeriodEnd",
        "nextBillingDate", "trialEndsAt", "priceAtSignup", "billingCycle",
        "currency", "recurringData", "lastToken",
        "startedAt", "enrolledByEmployeeId"
      ) VALUES ($1, $2, $3, $4, $5, 'current', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `,
      locationId, customerId, planId, savedCardId || null,
      initialStatus, periodStart, periodEnd, nextBillingDate,
      trialEndsAt, price, billingCycle, plan.currency || 'USD',
      recurringData || 'Recurring', token, now, requestingEmployeeId || null
    )

    const membership = rows[0]

    // Emit event
    await db.$executeRawUnsafe(`
      INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
      VALUES ($1, $2, $3, $4, $5)
    `,
      locationId, membership.id, MembershipEventType.CREATED,
      JSON.stringify({ planId, hasTrial, setupFeeCharged: plan.setupFee > 0 }),
      requestingEmployeeId || null
    )

    void dispatchMembershipUpdate(locationId, {
      action: 'enrolled', membershipId: membership.id, customerId,
    }).catch(console.error)

    return NextResponse.json({ data: membership }, { status: 201 })
  } catch (err) {
    console.error('[memberships] POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
