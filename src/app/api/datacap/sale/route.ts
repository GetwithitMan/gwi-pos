import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

if (!process.env.INTERNAL_API_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('[Startup] INTERNAL_API_SECRET environment variable is required in production')
}

interface SaleRequest {
  locationId: string
  readerId: string
  invoiceNo: string
  amount: number
  tipAmount?: number
  tipMode?: 'suggestive' | 'prompt' | 'included' | 'none'
  tipSuggestions?: number[]
  employeeId: string
  customerCode?: string   // Level II — PO number or customer code
  taxAmount?: number      // Level II — tax for interchange qualification
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<SaleRequest>(request)
    const { locationId, readerId, invoiceNo, amount, tipAmount, tipMode, tipSuggestions, employeeId } = body

    if (!locationId || !readerId || !invoiceNo || amount === undefined || amount === null) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, invoiceNo, amount' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return Response.json({ error: auth.error }, { status: auth.status ?? 403 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.sale(readerId, {
      invoiceNo,
      amounts: {
        purchase: amount,
        gratuity: tipMode === 'included' ? tipAmount : undefined,
        tax: body.taxAmount,   // Level II tax
      },
      tipMode: tipMode || 'none',
      tipSuggestions,
      requestRecordNo: true,
      allowPartialAuth: true,
      customerCode: body.customerCode,
    })

    const error = parseError(response)

    // Fire-and-forget: card recognition (Phase 8)
    // Use server-relative URL to avoid exposing internal endpoints via NEXT_PUBLIC_ vars
    if (response.cmdStatus === 'Approved' && response.cardholderIdHash) {
      const baseUrl = process.env.INTERNAL_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3005'
      fetch(`${baseUrl}/api/card-profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-call': process.env.INTERNAL_API_SECRET || '',
        },
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
        level2Status: response.level2Status,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
