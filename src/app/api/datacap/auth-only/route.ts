import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'

interface AuthOnlyRequest {
  locationId: string
  readerId: string
  invoiceNo: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<AuthOnlyRequest>(request)
    const { locationId, readerId, invoiceNo } = body

    if (!locationId || !readerId || !invoiceNo) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, invoiceNo' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.authOnly(readerId, { invoiceNo })
    const error = parseError(response)

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        recordNo: response.recordNo,        // Token for future use
        cardType: response.cardType,
        cardLast4: response.cardLast4,
        cardholderName: response.cardholderName,
        entryMethod: response.entryMethod,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
