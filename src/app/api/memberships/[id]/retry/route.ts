import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { getPayApiClient, PayApiError } from '@/lib/datacap/payapi-client'
import { buildIdempotencyKey } from '@/lib/membership/idempotency'
import { classifyDecline } from '@/lib/membership/decline-rules'
import { ChargeType, ChargeStatus, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'
import { randomUUID } from 'crypto'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId } = body

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.retry_membership_charge')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const mbrs: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "Membership"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId)
    if (mbrs.length === 0) return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    const mbr = mbrs[0]

    if (!mbr.lastToken) {
      return NextResponse.json({ error: 'No card on file' }, { status: 422 })
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
      await db.$executeRawUnsafe(`
        INSERT INTO "MembershipCharge" (
          "locationId", "membershipId", "subtotalAmount", "totalAmount",
          "status", "chargeType", "attemptNumber",
          "datacapRefNo", "datacapAuthCode", "datacapToken",
          "recurringDataSent", "recurringDataReceived",
          "invoiceNo", "idempotencyKey",
          "requestStartedAt", "responseReceivedAt", "processedAt"
        ) VALUES ($1, $2, $3, $3, 'approved', 'manual', $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      `,
        locationId, id, subtotal, mbr.failedAttempts + 1,
        resp.refNo, resp.authCode || null, resp.token || null,
        mbr.recurringData || 'Recurring', resp.recurringData || null,
        invoiceNo, idempotencyKey, requestStartedAt
      )

      // Update membership
      await db.$executeRawUnsafe(`
        UPDATE "Membership"
        SET "billingStatus" = 'current', "failedAttempts" = 0,
            "lastChargedAt" = NOW(), "nextRetryAt" = NULL,
            "lastFailedAt" = NULL, "lastFailReason" = NULL,
            "currentPeriodStart" = $2, "currentPeriodEnd" = $3, "nextBillingDate" = $3,
            "recurringData" = COALESCE($4, "recurringData"),
            "lastToken" = COALESCE($5, "lastToken"),
            "version" = "version" + 1, "updatedAt" = NOW()
        WHERE "id" = $1
      `, id, periodStart, periodEnd, resp.recurringData || null, resp.token || null)

      await db.$executeRawUnsafe(`
        INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
        VALUES ($1, $2, $3, $4, $5)
      `,
        locationId, id, MembershipEventType.CHARGE_SUCCESS,
        JSON.stringify({ chargeType: 'manual', total: subtotal, refNo: resp.refNo, requestId }),
        requestingEmployeeId || null
      )

      void dispatchMembershipUpdate(locationId, {
        action: 'charged', membershipId: id, customerId: mbr.customerId,
      }).catch(console.error)

      return NextResponse.json({ data: { success: true, refNo: resp.refNo } })
    } catch (err) {
      if (err instanceof PayApiError) {
        const decline = classifyDecline(err.response?.returnCode, err.response?.message)

        await db.$executeRawUnsafe(`
          INSERT INTO "MembershipCharge" (
            "locationId", "membershipId", "subtotalAmount", "totalAmount",
            "status", "chargeType", "failureType",
            "declineReason", "returnCode", "processorResponseMessage",
            "invoiceNo", "idempotencyKey",
            "requestStartedAt", "responseReceivedAt", "processedAt"
          ) VALUES ($1, $2, $3, $3, 'declined', 'manual', $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        `,
          locationId, id, subtotal, decline.category,
          decline.message, err.response?.returnCode || null, err.response?.message || null,
          invoiceNo, idempotencyKey, requestStartedAt
        )

        await db.$executeRawUnsafe(`
          INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
          VALUES ($1, $2, $3, $4, $5)
        `,
          locationId, id, MembershipEventType.CHARGE_FAILED,
          JSON.stringify({ chargeType: 'manual', reason: decline.message, requestId }),
          requestingEmployeeId || null
        )

        void dispatchMembershipUpdate(locationId, {
          action: 'declined', membershipId: id, customerId: mbr.customerId,
        }).catch(console.error)

        return NextResponse.json({ error: `Charge declined: ${decline.message}` }, { status: 402 })
      }
      throw err
    }
  } catch (err) {
    console.error('[memberships/retry] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
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
