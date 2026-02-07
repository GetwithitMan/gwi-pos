import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'

interface SaleRequest {
  locationId: string
  readerId: string
  invoiceNo: string
  amount: number
  tipAmount?: number
  tipMode?: 'suggestive' | 'prompt' | 'included' | 'none'
  tipSuggestions?: number[]
  employeeId: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<SaleRequest>(request)
    const { locationId, readerId, invoiceNo, amount, tipAmount, tipMode, tipSuggestions, employeeId } = body

    if (!locationId || !readerId || !invoiceNo || !amount) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, invoiceNo, amount' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.sale(readerId, {
      invoiceNo,
      amounts: {
        purchase: amount,
        gratuity: tipMode === 'included' ? tipAmount : undefined,
      },
      tipMode: tipMode || 'none',
      tipSuggestions,
      requestRecordNo: true,
      allowPartialAuth: true,
    })

    const error = parseError(response)

    console.log(`[Datacap Sale] Invoice=${invoiceNo} Employee=${employeeId} Status=${response.cmdStatus} Auth=${response.authCode || 'N/A'}`)

    // Fire-and-forget: card recognition (Phase 8)
    if (response.cmdStatus === 'Approved' && response.cardholderIdHash) {
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/card-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          cardholderIdHash: response.cardholderIdHash,
          cardType: response.cardType || 'unknown',
          cardLast4: response.cardLast4 || '????',
          cardholderName: response.cardholderName,
          spendAmount: parseFloat(response.authorize || '0') || amount,
        }),
      }).catch(err => console.warn('[Card Recognition] Background update failed:', err))
    }

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        recordNo: response.recordNo,
        cardType: response.cardType,
        cardLast4: response.cardLast4,
        cardholderName: response.cardholderName,
        entryMethod: response.entryMethod,
        amountAuthorized: response.authorize,
        isPartialApproval: response.isPartialApproval,
        gratuity: response.gratuityAmount,
        printData: response.printData,
        cvm: response.cvm,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
}
