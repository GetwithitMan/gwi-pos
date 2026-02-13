import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'

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
    const { locationId, readerId, recordNo, purchaseAmount, gratuityAmount, employeeId } = body

    if (!locationId || !readerId || !recordNo || purchaseAmount === undefined) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, recordNo, purchaseAmount' }, { status: 400 })
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
