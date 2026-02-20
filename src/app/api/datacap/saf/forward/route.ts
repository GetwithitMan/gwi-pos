import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'

interface SAFForwardRequest {
  locationId: string
  readerId: string
}

/**
 * POST /api/datacap/saf/forward
 * Forward all offline-stored SAF transactions to the processor
 * Datacap certification test 18.3
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<SAFForwardRequest>(request)
    const { locationId, readerId } = body

    if (!locationId || !readerId) {
      return Response.json({ error: 'Missing required fields: locationId, readerId' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.safForwardAll(readerId)

    return Response.json({
      data: {
        success: response.cmdStatus === 'Success',
        safForwarded: parseInt(response.safForwarded || '0', 10),
        sequenceNo: response.sequenceNo,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
