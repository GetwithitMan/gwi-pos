import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

interface SaleByRecordRequest {
  locationId: string
  readerId: string
  recordNo: string
  invoiceNo: string
  amount: number
  gratuityAmount?: number
}

export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(request: NextRequest) {
  try {
    const body = await parseBody<SaleByRecordRequest>(request)
    const { locationId, readerId, recordNo, invoiceNo, amount, gratuityAmount } = body

    if (!locationId || !readerId || !recordNo || !invoiceNo || amount === undefined || amount === null) {
      return err('Missing required fields: locationId, readerId, recordNo, invoiceNo, amount')
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.saleByRecordNo(readerId, { recordNo, invoiceNo, amount, gratuityAmount })
    const error = parseError(response)

    return ok({
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        recordNo: response.recordNo,
        amountAuthorized: response.authorize,
        isPartialApproval: response.isPartialApproval,
        storedOffline: response.storedOffline,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      })
  } catch (err) {
    return datacapErrorResponse(err)
  }
}))
