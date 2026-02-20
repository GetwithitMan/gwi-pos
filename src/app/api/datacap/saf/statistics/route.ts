import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, datacapErrorResponse } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/datacap/saf/statistics?locationId=...&readerId=...
 * Query the reader's SAF queue — count and total amount of offline-stored transactions
 * Datacap certification test 18.2
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const readerId = searchParams.get('readerId')

    if (!locationId || !readerId) {
      return Response.json({ error: 'Missing required params: locationId, readerId' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.safStatistics(readerId)

    return Response.json({
      data: {
        success: response.cmdStatus === 'Success',
        safCount: parseInt(response.safCount || '0', 10),
        safAmount: parseFloat(response.safAmount || '0'),
        hasPending: parseInt(response.safCount || '0', 10) > 0,
        sequenceNo: response.sequenceNo,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
