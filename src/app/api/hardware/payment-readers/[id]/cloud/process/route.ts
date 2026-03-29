import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getDatacapClient, datacapErrorResponse } from '@/lib/datacap/helpers'
import { buildDeclineDetail } from '@/lib/datacap/xml-parser'
import { roundToCents } from '@/lib/pricing'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

/**
 * Cloud reader transaction proxy
 * Accepts the same JSON body that useDatacap sends to local readers,
 * forwards to Datacap cloud via DatacapClient, and returns a compatible response.
 *
 * Body: { Amount, TranType, Invoice, TipAmount?, TipRequest?, PartialAuth? }
 */
export const POST = withVenue(withAuth(async function POST(
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
      return notFound('Reader not found or inactive')
    }

    if (reader.communicationMode !== 'cloud') {
      return err('Reader is not in cloud mode')
    }

    const amount = roundToCents(parseFloat(body.Amount))
    if (isNaN(amount) || amount <= 0) {
      return err('Invalid Amount')
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
    const declineDetail = buildDeclineDetail(response, amount)

    return ok({
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
      declineDetail: declineDetail || undefined,
    })
  } catch (error) {
    return datacapErrorResponse(error)
  }
}))
