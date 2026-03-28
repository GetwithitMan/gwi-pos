import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { PERMISSIONS } from '@/lib/auth-utils'
import { roundToCents } from '@/lib/pricing'
import { db } from '@/lib/db'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

interface SaleRequest {
  locationId: string
  readerId: string
  invoiceNo: string
  amount: number
  tipAmount?: number
  tipMode?: 'suggestive' | 'prompt' | 'included' | 'none'
  tipSuggestions?: number[]
  employeeId: string
  orderId?: string        // Optional — used for pending sale tracking (HA failover protection)
  terminalId?: string     // Optional — terminal ID for pending sale tracking
  customerCode?: string   // Level II — PO number or customer code
  taxAmount?: number      // Level II — tax for interchange qualification
}

export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(request: NextRequest, ctx: AuthenticatedContext) {
  try {
    const body = await parseBody<SaleRequest>(request)
    const { locationId, readerId, invoiceNo, tipAmount, tipMode, tipSuggestions } = body
    // SECURITY: Use authenticated employee ID for permission check, not body.employeeId
    const employeeId = ctx.auth.employeeId || body.employeeId
    let { amount } = body

    if (!locationId || !readerId || !invoiceNo || amount === undefined || amount === null) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, invoiceNo, amount' }, { status: 400 })
    }

    if (amount <= 0) {
      return Response.json({ error: 'Amount must be positive' }, { status: 400 })
    }
    if (tipAmount !== undefined && tipAmount !== null && tipAmount < 0) {
      return Response.json({ error: 'Tip amount must be non-negative' }, { status: 400 })
    }
    if (tipAmount !== undefined && tipAmount !== null && tipAmount > amount) {
      return Response.json({ error: 'Tip amount cannot exceed purchase amount' }, { status: 400 })
    }

    amount = roundToCents(amount)

    const existingSale = await db.$queryRawUnsafe<Array<{ id: string; status: string }>>(
      `SELECT id, status FROM "_pending_datacap_sales"
       WHERE "invoiceNo" = $1 AND "locationId" = $2 AND "status" IN ('pending', 'completed')
       LIMIT 1`,
      invoiceNo, locationId
    )
    if (existingSale.length > 0) {
      return Response.json(
        {
          error: 'Duplicate sale: a transaction with this invoiceNo is already pending or completed',
          duplicate: true,
          existingSale: { id: existingSale[0].id, status: existingSale[0].status },
        },
        { status: 409 }
      )
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return Response.json({ error: auth.error }, { status: auth.status ?? 403 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    // HA FAILOVER PROTECTION: Track pending sale BEFORE sending to Datacap.
    // If the primary NUC dies between card-charged and response-returned,
    // the backup can detect the orphaned pending record and prevent double-charge.
    const pendingId = crypto.randomUUID()
    const trackOrderId = body.orderId || invoiceNo // fallback to invoiceNo if orderId not sent
    const trackTerminalId = body.terminalId || readerId

    await db.$executeRawUnsafe(
      `INSERT INTO "_pending_datacap_sales" (id, "orderId", "terminalId", "invoiceNo", "amount", "status", "locationId")
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      pendingId, trackOrderId, trackTerminalId, invoiceNo, amount, locationId
    )

    let response
    try {
      response = await client.sale(readerId, {
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
    } catch (saleError) {
      // Sale failed (timeout, network, etc.) — mark pending record as failed
      void db.$executeRawUnsafe(
        `UPDATE "_pending_datacap_sales" SET "status" = 'failed', "resolvedAt" = NOW() WHERE id = $1`,
        pendingId
      ).catch(e => console.error('[Datacap Sale] Failed to mark pending sale as failed:', e))
      throw saleError
    }

    const error = parseError(response)

    // Update pending sale record with outcome
    if (response.cmdStatus === 'Approved') {
      void db.$executeRawUnsafe(
        `UPDATE "_pending_datacap_sales" SET "status" = 'completed', "datacapRecordNo" = $2, "datacapRefNumber" = $3, "resolvedAt" = NOW() WHERE id = $1`,
        pendingId, response.recordNo || null, response.refNo || null
      ).catch(e => console.error('[Datacap Sale] Failed to mark pending sale as completed:', e))
    } else {
      void db.$executeRawUnsafe(
        `UPDATE "_pending_datacap_sales" SET "status" = 'declined', "resolvedAt" = NOW() WHERE id = $1`,
        pendingId
      ).catch(e => console.error('[Datacap Sale] Failed to mark pending sale as declined:', e))
    }

    pushUpstream()

    // Fire-and-forget: card recognition (Phase 8)
    // Use server-relative URL to avoid exposing internal endpoints via NEXT_PUBLIC_ vars
    // Pass orderId so card-profiles can auto-link CardProfile → Customer when the order has one
    if (response.cmdStatus === 'Approved' && response.cardholderIdHash) {
      const baseUrl = process.env.INTERNAL_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`
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
          spendAmount: roundToCents(parseFloat(response.authorize || '0')) || amount,
          orderId: body.orderId || null,
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
}))
