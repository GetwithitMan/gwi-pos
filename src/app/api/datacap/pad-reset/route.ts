import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

interface PadResetRequest {
  locationId: string
  readerId: string
}

export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await parseBody<PadResetRequest>(request)
    const { locationId, readerId } = body

    if (!locationId || !readerId) {
      return err('Missing required fields: locationId, readerId')
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.padReset(readerId)

    return ok({
        success: response.cmdStatus === 'Success',
      })
  } catch (err) {
    return datacapErrorResponse(err)
  }
}))
