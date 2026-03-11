import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { getPayApiClient, PayApiError } from '@/lib/datacap/payapi-client'
import { calculateProration } from '@/lib/membership/proration'
import { buildIdempotencyKey } from '@/lib/membership/idempotency'
import { ChargeType, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, newPlanId, effective } = body

    if (!locationId || !newPlanId) {
      return NextResponse.json({ error: 'locationId and newPlanId required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Fetch membership
    const mbrs: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "Membership"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL AND "status" IN ('active', 'trial')
      LIMIT 1
    `, id, locationId)
    if (mbrs.length === 0) return NextResponse.json({ error: 'Active membership not found' }, { status: 404 })
    const mbr = mbrs[0]

    // Fetch new plan
    const plans: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "MembershipPlan"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL AND "isActive" = true
      LIMIT 1
    `, newPlanId, locationId)
    if (plans.length === 0) return NextResponse.json({ error: 'New plan not found or inactive' }, { status: 404 })
    const newPlan = plans[0]

    const effectiveMode = effective || 'next_period'

    if (effectiveMode === 'immediate' && mbr.currentPeriodStart && mbr.currentPeriodEnd) {
      // Immediate plan change with proration
      const proration = calculateProration({
        currentPrice: parseFloat(mbr.priceAtSignup),
        newPrice: parseFloat(newPlan.price),
        currentPeriodStart: new Date(mbr.currentPeriodStart),
        currentPeriodEnd: new Date(mbr.currentPeriodEnd),
        effectiveDate: new Date(),
      })

      // Charge prorated amount if positive
      if (proration.netAmount > 0 && mbr.lastToken) {
        const idempotencyKey = buildIdempotencyKey({
          type: ChargeType.PRORATION,
          params: { membershipId: id, effectiveDate: new Date() },
        })

        const invoiceNo = `MBR-PRO-${id.slice(-6)}-${Date.now()}`
        try {
          const payapi = getPayApiClient()
          const resp = await payapi.sale({
            token: mbr.lastToken,
            amount: proration.netAmount.toFixed(2),
            invoiceNo,
            recurringData: mbr.recurringData || 'Recurring',
          })

          // Record charge
          await db.$executeRawUnsafe(`
            INSERT INTO "MembershipCharge" (
              "locationId", "membershipId", "subtotalAmount", "totalAmount",
              "status", "chargeType", "isProrated", "proratedFromAmount",
              "datacapRefNo", "datacapAuthCode", "datacapToken",
              "recurringDataSent", "recurringDataReceived",
              "invoiceNo", "idempotencyKey", "processedAt"
            ) VALUES ($1, $2, $3, $3, 'approved', 'proration', true, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          `,
            locationId, id, proration.netAmount, parseFloat(mbr.priceAtSignup),
            resp.refNo, resp.authCode || null, resp.token || null,
            mbr.recurringData || 'Recurring', resp.recurringData || null,
            invoiceNo, idempotencyKey
          )

          // Update recurring data chain
          if (resp.recurringData) {
            await db.$executeRawUnsafe(`
              UPDATE "Membership" SET "recurringData" = $2 WHERE "id" = $1
            `, id, resp.recurringData)
          }
        } catch (err) {
          if (err instanceof PayApiError) {
            return NextResponse.json({ error: `Proration charge failed: ${err.message}` }, { status: 402 })
          }
          throw err
        }
      }

      // Update plan
      await db.$executeRawUnsafe(`
        UPDATE "Membership"
        SET "planId" = $2, "priceAtSignup" = $3, "billingCycle" = $4,
            "version" = "version" + 1, "updatedAt" = NOW()
        WHERE "id" = $1
      `, id, newPlanId, parseFloat(newPlan.price), newPlan.billingCycle)
    } else {
      // Next period — just update planId, price takes effect at renewal
      await db.$executeRawUnsafe(`
        UPDATE "Membership"
        SET "planId" = $2, "priceAtSignup" = $3, "billingCycle" = $4,
            "version" = "version" + 1, "updatedAt" = NOW()
        WHERE "id" = $1
      `, id, newPlanId, parseFloat(newPlan.price), newPlan.billingCycle)
    }

    await db.$executeRawUnsafe(`
      INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
      VALUES ($1, $2, $3, $4, $5)
    `,
      locationId, id, MembershipEventType.PLAN_CHANGED,
      JSON.stringify({ newPlanId, effective: effectiveMode, newPrice: parseFloat(newPlan.price) }),
      requestingEmployeeId || null
    )

    void dispatchMembershipUpdate(locationId, {
      action: 'enrolled', membershipId: id, customerId: mbr.customerId,
      details: { planChanged: true },
    }).catch(console.error)

    return NextResponse.json({ data: { success: true, effective: effectiveMode } })
  } catch (err) {
    console.error('[memberships/change-plan] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
