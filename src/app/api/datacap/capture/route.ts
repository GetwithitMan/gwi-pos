import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { roundToCents } from '@/lib/pricing'
import { db } from '@/lib/db'

interface CaptureRequest {
  locationId: string
  readerId: string
  recordNo: string
  purchaseAmount: number
  gratuityAmount?: number
  employeeId: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<CaptureRequest>(request)
    const { locationId, readerId, recordNo, gratuityAmount, employeeId } = body
    let { purchaseAmount } = body

    if (!locationId || !readerId || !recordNo || purchaseAmount === undefined) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, recordNo, purchaseAmount' }, { status: 400 })
    }

    if (purchaseAmount <= 0) {
      return Response.json({ error: 'purchaseAmount must be positive' }, { status: 400 })
    }
    if (gratuityAmount !== undefined && gratuityAmount < 0) {
      return Response.json({ error: 'gratuityAmount must be non-negative' }, { status: 400 })
    }

    purchaseAmount = roundToCents(purchaseAmount)

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return Response.json({ error: auth.error }, { status: auth.status ?? 403 })
    }

    const orderCard = await db.orderCard.findFirst({
      where: { recordNo, locationId, deletedAt: null },
      select: { authAmount: true },
    })
    if (!orderCard) {
      return Response.json({ error: 'No pre-auth found for this recordNo' }, { status: 404 })
    }
    if (purchaseAmount + (gratuityAmount || 0) > Number(orderCard.authAmount)) {
      return Response.json(
        { error: `Capture amount $${(purchaseAmount + (gratuityAmount || 0)).toFixed(2)} exceeds authorized amount $${Number(orderCard.authAmount).toFixed(2)}` },
        { status: 400 }
      )
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.preAuthCapture(readerId, {
      recordNo,
      purchaseAmount,
      gratuityAmount,
    })

    const error = parseError(response)

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        amountAuthorized: response.authorize,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
