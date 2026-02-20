import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'

interface PreAuthByRecordRequest {
  locationId: string
  readerId: string
  recordNo: string
  invoiceNo: string
  amount: number
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<PreAuthByRecordRequest>(request)
    const { locationId, readerId, recordNo, invoiceNo, amount } = body

    if (!locationId || !readerId || !recordNo || !invoiceNo || !amount) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, recordNo, invoiceNo, amount' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.preAuthByRecordNo(readerId, { recordNo, invoiceNo, amount })
    const error = parseError(response)

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        recordNo: response.recordNo,
        amountAuthorized: response.authorize,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
