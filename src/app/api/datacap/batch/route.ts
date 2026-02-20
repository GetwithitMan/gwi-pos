import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'

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

    const response = await client.batchSummary(readerId)
    const error = parseError(response)

    // Also check SAF queue — fire-and-forget, fail silently
    let safCount = 0
    let safAmount = 0
    try {
      const safResponse = await client.safStatistics(readerId)
      safCount = parseInt(safResponse.safCount || '0', 10)
      safAmount = parseFloat(safResponse.safAmount || '0')
    } catch {
      // SAF not supported or reader error — ignore
    }

    return Response.json({
      data: {
        success: response.cmdStatus === 'Success',
        batchNo: response.batchNo,
        transactionCount: response.batchItemCount,
        safCount,
        safAmount,
        hasSAFPending: safCount > 0,
        error: error ? { code: error.code, message: error.text } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})

interface BatchCloseRequest {
  locationId: string
  readerId: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json() as BatchCloseRequest
    const { locationId, readerId } = body

    if (!locationId || !readerId) {
      return Response.json({ error: 'Missing required fields: locationId, readerId' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.batchClose(readerId)
    const error = parseError(response)

    return Response.json({
      data: {
        success: response.cmdStatus === 'Success',
        batchNo: response.batchNo,
        error: error ? { code: error.code, message: error.text } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
