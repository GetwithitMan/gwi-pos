import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getDatacapClient, datacapErrorResponse } from '@/lib/datacap/helpers'
import { roundToCents } from '@/lib/pricing'

/**
 * Cloud reader transaction proxy
 * Accepts the same JSON body that useDatacap sends to local readers,
 * forwards to Datacap cloud via DatacapClient, and returns a compatible response.
 *
 * Body: { Amount, TranType, Invoice, TipAmount?, TipRequest?, PartialAuth? }
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const reader = await db.paymentReader.findFirst({
      where: { id, deletedAt: null, isActive: true },
      select: { id: true, locationId: true, communicationMode: true },
    })

    if (!reader) {
      return NextResponse.json({ error: 'Reader not found or inactive' }, { status: 404 })
    }

    if (reader.communicationMode !== 'cloud') {
      return NextResponse.json({ error: 'Reader is not in cloud mode' }, { status: 400 })
    }

    const amount = roundToCents(parseFloat(body.Amount))
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid Amount' }, { status: 400 })
    }

    const tranType: 'Sale' | 'Auth' = body.TranType === 'Auth' ? 'Auth' : 'Sale'
    const invoiceNo: string = body.Invoice || ''
    const tipAmount = body.TipAmount ? roundToCents(parseFloat(body.TipAmount)) : undefined

    const client = await getDatacapClient(reader.locationId)

    let response
    if (tranType === 'Auth') {
      response = await client.preAuth(id, {
        invoiceNo,
        amount,
        requestRecordNo: true,
      })
    } else {
      response = await client.sale(id, {
        invoiceNo,
        amounts: {
          purchase: amount,
          ...(tipAmount !== undefined && { gratuity: tipAmount }),
        },
        tipMode: body.TipRequest === 'True' ? 'suggestive' : 'none',
        allowPartialAuth: body.PartialAuth === 'True',
        requestRecordNo: true,
      })
    }

    // Map DatacapResponse → the JSON shape useDatacap.ts expects
    const approved = response.cmdStatus === 'Approved'
    const amountAuthorized = response.authorize ? roundToCents(parseFloat(response.authorize)) : amount

    return NextResponse.json({
      approved,
      status: approved ? 'APPROVED' : 'DECLINED',
      authCode: response.authCode,
      refNumber: response.refNo,
      recordNo: response.recordNo,
      cardBrand: response.cardType,
      cardLast4: response.cardLast4,
      entryMethod: response.entryMethod,
      responseCode: response.dsixReturnCode,
      responseMessage: response.textResponse,
      amountAuthorized: amountAuthorized.toFixed(2),
      signatureData: response.signatureData,
    })
  } catch (error) {
    return datacapErrorResponse(error)
  }
})
