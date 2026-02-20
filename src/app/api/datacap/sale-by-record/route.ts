import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'

interface SaleByRecordRequest {
  locationId: string
  readerId: string
  recordNo: string
  invoiceNo: string
  amount: number
  gratuityAmount?: number
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<SaleByRecordRequest>(request)
    const { locationId, readerId, recordNo, invoiceNo, amount, gratuityAmount } = body

    if (!locationId || !readerId || !recordNo || !invoiceNo || amount === undefined || amount === null) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, recordNo, invoiceNo, amount' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.saleByRecordNo(readerId, { recordNo, invoiceNo, amount, gratuityAmount })
    const error = parseError(response)

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        recordNo: response.recordNo,
        amountAuthorized: response.authorize,
        isPartialApproval: response.isPartialApproval,
        storedOffline: response.storedOffline,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
