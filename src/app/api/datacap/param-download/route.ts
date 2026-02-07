import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'

interface ParamDownloadRequest {
  locationId: string
  readerId: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<ParamDownloadRequest>(request)
    const { locationId, readerId } = body

    if (!locationId || !readerId) {
      return Response.json({ error: 'Missing required fields: locationId, readerId' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.paramDownload(readerId)

    console.log(`[Datacap ParamDownload] Reader=${readerId} Status=${response.cmdStatus}`)

    return Response.json({
      data: {
        success: response.cmdStatus === 'Success',
        textResponse: response.textResponse,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
}
