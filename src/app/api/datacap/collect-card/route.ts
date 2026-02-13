import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'

interface CollectCardRequest {
  locationId: string
  readerId: string
  placeholderAmount?: number
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<CollectCardRequest>(request)
    const { locationId, readerId, placeholderAmount } = body

    if (!locationId || !readerId) {
      return Response.json({ error: 'Missing required fields: locationId, readerId' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.collectCardData(readerId, { placeholderAmount })

    const error = parseError(response)

    return Response.json({
      data: {
        success: response.cmdStatus === 'Success' || response.cmdStatus === 'Approved',
        cardholderName: response.cardholderName,
        cardType: response.cardType,
        cardLast4: response.cardLast4,
        cardholderIdHash: response.cardholderIdHash,
        entryMethod: response.entryMethod,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
