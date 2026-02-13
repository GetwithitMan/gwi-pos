import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'

interface PadResetRequest {
  locationId: string
  readerId: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<PadResetRequest>(request)
    const { locationId, readerId } = body

    if (!locationId || !readerId) {
      return Response.json({ error: 'Missing required fields: locationId, readerId' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.padReset(readerId)

    return Response.json({
      data: {
        success: response.cmdStatus === 'Success',
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
