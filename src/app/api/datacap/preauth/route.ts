import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError, buildDeclineDetail } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { roundToCents } from '@/lib/pricing'
import { err, ok } from '@/lib/api-response'

interface PreAuthRequest {
  locationId: string
  readerId: string
  orderId: string
  amount: number
  employeeId: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<PreAuthRequest>(request)
    const { locationId, readerId, orderId, employeeId } = body
    let { amount } = body

    if (!locationId || !readerId || !orderId || amount === undefined || amount === null) {
      return err('Missing required fields: locationId, readerId, orderId, amount')
    }

    if (amount <= 0) {
      return err('Amount must be positive')
    }

    amount = roundToCents(amount)

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return err(auth.error, auth.status ?? 403)
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.preAuth(readerId, {
      invoiceNo: orderId,
      amount,
      requestRecordNo: true,
    })

    const error = parseError(response)
    const declineDetail = buildDeclineDetail(response, amount)

    return ok({
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        recordNo: response.recordNo,
        cardType: response.cardType,
        cardLast4: response.cardLast4,
        cardholderName: response.cardholderName,
        entryMethod: response.entryMethod,
        amountAuthorized: response.authorize,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
        declineDetail: declineDetail || undefined,
      })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
