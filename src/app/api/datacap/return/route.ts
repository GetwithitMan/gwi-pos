import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

interface ReturnRequest {
  locationId: string
  readerId: string
  recordNo?: string
  amount: number
  cardPresent: boolean
  employeeId: string
  invoiceNo?: string
}

export const POST = withVenue(withAuth('MGR_REFUNDS', async function POST(request: NextRequest) {
  try {
    const body = await parseBody<ReturnRequest>(request)
    const { locationId, readerId, recordNo, amount, cardPresent, employeeId, invoiceNo } = body

    if (!locationId || !readerId || amount === undefined || amount === null) {
      return err('Missing required fields: locationId, readerId, amount')
    }

    if (!cardPresent && !recordNo) {
      return err('recordNo required for card-not-present returns')
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.emvReturn(readerId, {
      amount,
      recordNo,
      cardPresent,
      invoiceNo,
    })

    const error = parseError(response)

    return ok({
        approved: response.cmdStatus === 'Approved',
        refNumber: response.refNo,
        recordNo: response.recordNo,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      })
  } catch (err) {
    return datacapErrorResponse(err)
  }
}))
