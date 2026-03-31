import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { getPayApiClient, PayApiError } from '@/lib/datacap/payapi-client'
import { buildIdempotencyKey } from '@/lib/membership/idempotency'
import { calculateSignupProration } from '@/lib/membership/proration'
import { ChargeType, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { created, err, notFound } from '@/lib/api-response'
const log = createChildLogger('memberships')

// GET — list memberships with filters + pagination
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId')
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId ?? sp.get('requestingEmployeeId')
    const status = sp.get('status')
    const billingStatus = sp.get('billingStatus')
    const customerId = sp.get('customerId')
    const limit = parseInt(sp.get('limit') || '50')
    const offset = parseInt(sp.get('offset') || '0')

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(employeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    let where = `"m"."locationId" = $1 AND "m"."deletedAt" IS NULL`
    const params: any[] = [locationId]
    let idx = 2

    if (status) { where += ` AND "m"."status" = $${idx}`; params.push(status); idx++ }
    if (billingStatus) { where += ` AND "m"."billingStatus" = $${idx}`; params.push(billingStatus); idx++ }
    if (customerId) { where += ` AND "m"."customerId" = $${idx}`; params.push(customerId); idx++ }

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT "m".*, "p"."name" AS "planName", "p"."price" AS "planPrice",
             "c"."firstName" AS "customerFirstName", "c"."lastName" AS "customerLastName",
             "c"."email" AS "customerEmail", "c"."phone" AS "customerPhone",
             "sc"."last4" AS "cardLast4", "sc"."cardBrand" AS "cardBrand"
      FROM "Membership" "m"
      LEFT JOIN "MembershipPlan" "p" ON "m"."planId" = "p"."id"
      LEFT JOIN "Customer" "c" ON "m"."customerId" = "c"."id"
      LEFT JOIN "SavedCard" "sc" ON "m"."savedCardId" = "sc"."id"
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
  } catch (caughtErr) {
    console.error('[memberships] GET error:', caughtErr)
    return err('Internal error', 500)
  }
})

// POST — enroll a new membership
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, requestingEmployeeId: bodyEmployeeId, customerId, planId, savedCardId } = body

    if (!locationId || !customerId || !planId) {
      return err('locationId, customerId, planId required')
    }

    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId ?? bodyEmployeeId

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    // Validate plan
    const plans: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "MembershipPlan"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL AND "isActive" = true
      LIMIT 1
    `, planId, locationId)
    if (plans.length === 0) return notFound('Plan not found or inactive')
    const plan = plans[0]

    // Validate customer
    const customers: any[] = await db.$queryRawUnsafe(`
      SELECT "id" FROM "Customer"
      WHERE "id" = $1 AND "locationId" = $2 AND "isActive" = true
      LIMIT 1
    `, customerId, locationId)
    if (customers.length === 0) return notFound('Customer not found')

    // Validate saved card if provided
    let token: string | null = null
    if (savedCardId) {
      const cards: any[] = await db.$queryRawUnsafe(`
        SELECT "id", "token" FROM "SavedCard"
        WHERE "id" = $1 AND "locationId" = $2 AND "customerId" = $3 AND "deletedAt" IS NULL
        LIMIT 1
      `, savedCardId, locationId, customerId)
      if (cards.length === 0) return err('Saved card not found or does not belong to customer')
      token = cards[0].token
    }

    // Check max members
    if (plan.maxMembers) {
      const countResult: any[] = await db.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS "cnt" FROM "Membership"
        WHERE "planId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL AND "status" IN ('trial', 'active', 'paused')
      `, planId, locationId)
      if (countResult[0]?.cnt >= plan.maxMembers) {
        return err('Plan is at maximum capacity', 409)
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
      } catch (caughtErr) {
        if (caughtErr instanceof PayApiError) {
          return err(`Setup fee charge failed: ${(caughtErr as PayApiError).message}`, 402)
        }
        throw caughtErr
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
    }).catch(e => log.warn({ err: e }, 'Background task failed'))

    void pushUpstream()

    return created(membership)
  } catch (caughtErr) {
    console.error('[memberships] POST error:', caughtErr)
    return err('Internal error', 500)
  }
})
