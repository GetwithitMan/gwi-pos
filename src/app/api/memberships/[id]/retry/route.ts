import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { getPayApiClient, PayApiError } from '@/lib/datacap/payapi-client'
import { buildIdempotencyKey } from '@/lib/membership/idempotency'
import { classifyDecline } from '@/lib/membership/decline-rules'
import { ChargeType, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'
import { randomUUID } from 'crypto'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('memberships-retry')

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId } = body

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.retry_membership_charge')
    if (!auth.authorized) return err(auth.error, auth.status)

    const mbrs: any[] = await db.$queryRaw`
      SELECT * FROM "Membership"
      WHERE "id" = ${id} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      LIMIT 1
    `
    if (mbrs.length === 0) return notFound('Membership not found')
    const mbr = mbrs[0]

    if (!mbr.lastToken) {
      return err('No card on file', 422)
    }

    const requestId = randomUUID()
    const idempotencyKey = buildIdempotencyKey({
      type: ChargeType.MANUAL,
      params: { membershipId: id, requestId },
    })

    const subtotal = parseFloat(mbr.priceAtSignup || '0')
    const invoiceNo = `MBR-RETRY-${id.slice(-6)}-${Date.now()}`

    const payapi = getPayApiClient()
    const requestStartedAt = new Date()

    try {
      const resp = await payapi.sale({
        token: mbr.lastToken,
        amount: subtotal.toFixed(2),
        invoiceNo,
        recurringData: mbr.recurringData || 'Recurring',
      })

      const periodStart = mbr.currentPeriodEnd || new Date()
      const periodEnd = advancePeriod(periodStart, mbr.billingCycle || 'monthly')

      // Record approved charge
      await db.$executeRaw`
        INSERT INTO "MembershipCharge" (
          "locationId", "membershipId", "subtotalAmount", "totalAmount",
          "status", "chargeType", "attemptNumber",
          "datacapRefNo", "datacapAuthCode", "datacapToken",
          "recurringDataSent", "recurringDataReceived",
          "invoiceNo", "idempotencyKey",
          "requestStartedAt", "responseReceivedAt", "processedAt"
        ) VALUES (${locationId}, ${id}, ${subtotal}, ${subtotal}, 'approved', 'manual', ${mbr.failedAttempts + 1}, ${resp.refNo}, ${resp.authCode || null}, ${resp.token || null}, ${mbr.recurringData || 'Recurring'}, ${resp.recurringData || null}, ${invoiceNo}, ${idempotencyKey}, ${requestStartedAt}, NOW(), NOW())
      `

      // Update membership
      await db.$executeRaw`
        UPDATE "Membership"
        SET "billingStatus" = 'current', "failedAttempts" = 0,
            "lastChargedAt" = NOW(), "nextRetryAt" = NULL,
            "lastFailedAt" = NULL, "lastFailReason" = NULL,
            "currentPeriodStart" = ${periodStart}, "currentPeriodEnd" = ${periodEnd}, "nextBillingDate" = ${periodEnd},
            "recurringData" = COALESCE(${resp.recurringData || null}, "recurringData"),
            "lastToken" = COALESCE(${resp.token || null}, "lastToken"),
            "version" = "version" + 1, "updatedAt" = NOW()
        WHERE "id" = ${id}
      `

      await db.$executeRaw`
        INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
        VALUES (${locationId}, ${id}, ${MembershipEventType.CHARGE_SUCCESS}, ${JSON.stringify({ chargeType: 'manual', total: subtotal, refNo: resp.refNo, requestId })}, ${requestingEmployeeId || null})
      `

      void dispatchMembershipUpdate(locationId, {
        action: 'charged', membershipId: id, customerId: mbr.customerId,
      }).catch(err => log.warn({ err }, 'Background task failed'))

      return ok({ success: true, refNo: resp.refNo })
    } catch (caughtErr) {
      if (err instanceof PayApiError) {
        const decline = classifyDecline(err.response?.returnCode, err.response?.message)

        await db.$executeRaw`
          INSERT INTO "MembershipCharge" (
            "locationId", "membershipId", "subtotalAmount", "totalAmount",
            "status", "chargeType", "failureType",
            "declineReason", "returnCode", "processorResponseMessage",
            "invoiceNo", "idempotencyKey",
            "requestStartedAt", "responseReceivedAt", "processedAt"
          ) VALUES (${locationId}, ${id}, ${subtotal}, ${subtotal}, 'declined', 'manual', ${decline.category}, ${decline.message}, ${err.response?.returnCode || null}, ${err.response?.message || null}, ${invoiceNo}, ${idempotencyKey}, ${requestStartedAt}, NOW(), NOW())
        `

        await db.$executeRaw`
          INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
          VALUES (${locationId}, ${id}, ${MembershipEventType.CHARGE_FAILED}, ${JSON.stringify({ chargeType: 'manual', reason: decline.message, requestId })}, ${requestingEmployeeId || null})
        `

        void dispatchMembershipUpdate(locationId, {
          action: 'declined', membershipId: id, customerId: mbr.customerId,
        }).catch(err => log.warn({ err }, 'Background task failed'))

        return err(`Charge declined: ${decline.message}`, 402)
      }
      throw err
    }
  } catch (caughtErr) {
    console.error('[memberships/retry] error:', err)
    return err('Internal error', 500)
  }
})

function advancePeriod(from: Date, billingCycle: string): Date {
  const d = new Date(from)
  switch (billingCycle) {
    case 'weekly': d.setDate(d.getDate() + 7); break
    case 'annual': d.setFullYear(d.getFullYear() + 1); break
    default: d.setMonth(d.getMonth() + 1); break
  }
  return d
}
