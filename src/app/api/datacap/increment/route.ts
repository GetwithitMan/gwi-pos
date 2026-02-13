import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'

interface IncrementRequest {
  locationId: string
  readerId: string
  recordNo: string
  additionalAmount: number
  employeeId: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<IncrementRequest>(request)
    const { locationId, readerId, recordNo, additionalAmount, employeeId } = body

    if (!locationId || !readerId || !recordNo || !additionalAmount) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, recordNo, additionalAmount' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.incrementalAuth(readerId, {
      recordNo,
      additionalAmount,
    })

    const error = parseError(response)

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        newAuthorizedAmount: response.authorize,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
