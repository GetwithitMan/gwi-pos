import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { getPayApiClient, PayApiError } from '@/lib/datacap/payapi-client'
import { calculateProration } from '@/lib/membership/proration'
import { buildIdempotencyKey } from '@/lib/membership/idempotency'
import { ChargeType, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('memberships-change-plan')

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, newPlanId, effective } = body

    if (!locationId || !newPlanId) {
      return err('locationId and newPlanId required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    // Fetch membership
    const mbrs: any[] = await db.$queryRaw`
      SELECT * FROM "Membership"
      WHERE "id" = ${id} AND "locationId" = ${locationId} AND "deletedAt" IS NULL AND "status" IN ('active', 'trial')
      LIMIT 1
    `
    if (mbrs.length === 0) return notFound('Active membership not found')
    const mbr = mbrs[0]

    // Fetch new plan
    const plans: any[] = await db.$queryRaw`
      SELECT * FROM "MembershipPlan"
      WHERE "id" = ${newPlanId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL AND "isActive" = true
      LIMIT 1
    `
    if (plans.length === 0) return notFound('New plan not found or inactive')
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
          await db.$executeRaw`
            INSERT INTO "MembershipCharge" (
              "locationId", "membershipId", "subtotalAmount", "totalAmount",
              "status", "chargeType", "isProrated", "proratedFromAmount",
              "datacapRefNo", "datacapAuthCode", "datacapToken",
              "recurringDataSent", "recurringDataReceived",
              "invoiceNo", "idempotencyKey", "processedAt"
            ) VALUES (${locationId}, ${id}, ${proration.netAmount}, ${proration.netAmount}, 'approved', 'proration', true, ${parseFloat(mbr.priceAtSignup)}, ${resp.refNo}, ${resp.authCode || null}, ${resp.token || null}, ${mbr.recurringData || 'Recurring'}, ${resp.recurringData || null}, ${invoiceNo}, ${idempotencyKey}, NOW())
          `

          // Update recurring data chain
          if (resp.recurringData) {
            await db.$executeRaw`
              UPDATE "Membership" SET "recurringData" = ${resp.recurringData} WHERE "id" = ${id}
            `
          }
        } catch (caughtErr) {
          if (err instanceof PayApiError) {
            return err(`Proration charge failed: ${err.message}`, 402)
          }
          throw err
        }
      }

      // Update plan
      await db.$executeRaw`
        UPDATE "Membership"
        SET "planId" = ${newPlanId}, "priceAtSignup" = ${parseFloat(newPlan.price)}, "billingCycle" = ${newPlan.billingCycle},
            "version" = "version" + 1, "updatedAt" = NOW()
        WHERE "id" = ${id}
      `
    } else {
      // Next period — just update planId, price takes effect at renewal
      await db.$executeRaw`
        UPDATE "Membership"
        SET "planId" = ${newPlanId}, "priceAtSignup" = ${parseFloat(newPlan.price)}, "billingCycle" = ${newPlan.billingCycle},
            "version" = "version" + 1, "updatedAt" = NOW()
        WHERE "id" = ${id}
      `
    }

    await db.$executeRaw`
      INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
      VALUES (${locationId}, ${id}, ${MembershipEventType.PLAN_CHANGED}, ${JSON.stringify({ newPlanId, effective: effectiveMode, newPrice: parseFloat(newPlan.price) })}, ${requestingEmployeeId || null})
    `

    void dispatchMembershipUpdate(locationId, {
      action: 'enrolled', membershipId: id, customerId: mbr.customerId,
      details: { planChanged: true },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ success: true, effective: effectiveMode })
  } catch (caughtErr) {
    console.error('[memberships/change-plan] error:', err)
    return err('Internal error', 500)
  }
})
