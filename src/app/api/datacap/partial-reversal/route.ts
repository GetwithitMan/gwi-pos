import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'

interface PartialReversalRequest {
  locationId: string
  readerId: string
  recordNo: string
  reversalAmount: number  // Amount to REDUCE the hold by
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<PartialReversalRequest>(request)
    const { locationId, readerId, recordNo, reversalAmount } = body

    if (!locationId || !readerId || !recordNo || reversalAmount === undefined) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, recordNo, reversalAmount' }, { status: 400 })
    }

    if (reversalAmount <= 0) {
      return Response.json({ error: 'reversalAmount must be positive' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.partialReversal(readerId, { recordNo, reversalAmount })
    const error = parseError(response)

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        recordNo: response.recordNo,
        amountReversed: response.authorize,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
