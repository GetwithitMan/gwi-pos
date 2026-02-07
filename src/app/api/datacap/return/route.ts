import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'

interface ReturnRequest {
  locationId: string
  readerId: string
  recordNo?: string
  amount: number
  cardPresent: boolean
  employeeId: string
  invoiceNo?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<ReturnRequest>(request)
    const { locationId, readerId, recordNo, amount, cardPresent, employeeId, invoiceNo } = body

    if (!locationId || !readerId || !amount) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, amount' }, { status: 400 })
    }

    if (!cardPresent && !recordNo) {
      return Response.json({ error: 'recordNo required for card-not-present returns' }, { status: 400 })
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

    console.log(`[Datacap Return] Employee=${employeeId} Status=${response.cmdStatus} Amount=${amount} CardPresent=${cardPresent}`)

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        refNumber: response.refNo,
        recordNo: response.recordNo,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
}
