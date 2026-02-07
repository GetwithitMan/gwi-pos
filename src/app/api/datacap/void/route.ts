import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'

interface VoidRequest {
  locationId: string
  readerId: string
  recordNo: string
  employeeId: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<VoidRequest>(request)
    const { locationId, readerId, recordNo, employeeId } = body

    if (!locationId || !readerId || !recordNo) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, recordNo' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.voidSale(readerId, { recordNo })

    const error = parseError(response)

    console.log(`[Datacap Void] RecordNo=${recordNo} Employee=${employeeId} Status=${response.cmdStatus}`)

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
}
