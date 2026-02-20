import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'

interface RefundRequest {
  readerId: string
  recordNo: string
  invoiceNo: string
  amount: number
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<RefundRequest>(request)
    const { readerId, recordNo, invoiceNo, amount } = body

    if (!readerId || !recordNo || !invoiceNo || amount === undefined || amount === null) {
      return Response.json(
        { error: 'Missing required fields: readerId, recordNo, invoiceNo, amount' },
        { status: 400 }
      )
    }

    // Look up reader to get its locationId for client config
    const { db } = await import('@/lib/db')
    const reader = await db.paymentReader.findFirst({
      where: { id: readerId, deletedAt: null },
      select: { id: true, locationId: true },
    })

    if (!reader) {
      return Response.json({ error: 'Payment reader not found' }, { status: 404 })
    }

    await validateReader(readerId, reader.locationId)
    const client = await requireDatacapClient(reader.locationId)

    // ReturnByRecordNo — card not present, uses stored token
    const response = await client.emvReturn(readerId, {
      recordNo,
      invoiceNo,
      amount,
      cardPresent: false,
    })

    const approved = response.cmdStatus === 'Approved'

    if (!approved) {
      return Response.json(
        { error: response.textResponse || 'Refund declined' },
        { status: 422 }
      )
    }

    return Response.json({
      data: {
        approved,
        refNo: response.refNo ?? '',
        authCode: response.authCode ?? '',
        amount: response.authorize ? parseFloat(response.authorize) : amount,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
