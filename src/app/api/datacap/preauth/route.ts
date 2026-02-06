import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'

interface PreAuthRequest {
  locationId: string
  readerId: string
  orderId: string
  amount: number
  employeeId: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<PreAuthRequest>(request)
    const { locationId, readerId, orderId, amount, employeeId } = body

    if (!locationId || !readerId || !orderId || !amount) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, orderId, amount' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.preAuth(readerId, {
      invoiceNo: orderId,
      amount,
      requestRecordNo: true,
    })

    const error = parseError(response)

    console.log(`[Datacap PreAuth] Order=${orderId} Employee=${employeeId} Status=${response.cmdStatus} Amount=${amount} RecordNo=${response.recordNo || 'N/A'}`)

    return Response.json({
      data: {
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
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
}
