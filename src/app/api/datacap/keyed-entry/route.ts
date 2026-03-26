import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { requireDatacapClient, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// ─── Validation Helpers ─────────────────────────────────────────────────────

function isValidCardNumber(num: string): boolean {
  const digits = num.replace(/\s/g, '')
  return /^\d{13,19}$/.test(digits)
}

function isValidExpiry(month: string, year: string): boolean {
  const m = parseInt(month, 10)
  const y = parseInt(year, 10)
  if (isNaN(m) || isNaN(y) || m < 1 || m > 12) return false
  // Compare against current date — year is 2-digit
  const now = new Date()
  const currentYear = now.getFullYear() % 100
  const currentMonth = now.getMonth() + 1
  if (y < currentYear) return false
  if (y === currentYear && m < currentMonth) return false
  return true
}

function isValidCVV(cvv: string): boolean {
  return /^\d{3,4}$/.test(cvv)
}

function detectCardBrand(cardNumber: string): string {
  const num = cardNumber.replace(/\s/g, '')
  if (/^4/.test(num)) return 'visa'
  if (/^5[1-5]/.test(num) || /^2[2-7]/.test(num)) return 'mastercard'
  if (/^3[47]/.test(num)) return 'amex'
  if (/^6(?:011|5)/.test(num)) return 'discover'
  return 'unknown'
}

// ─── Request Interface ──────────────────────────────────────────────────────

interface KeyedEntryRequest {
  orderId: string
  amount: number
  tipAmount?: number
  cardNumber: string
  expiryMonth: string
  expiryYear: string
  cvv: string
  zipCode?: string
  readerId: string
  invoiceNo?: string
}

// ─── POST Handler ───────────────────────────────────────────────────────────

/**
 * Process a manual/keyed card entry payment.
 *
 * SECURITY: Requires manager.keyed_entry permission (higher risk than card-present).
 * Card data is sent directly to Datacap cloud and NEVER logged or stored.
 * Only last 4 digits are retained after tokenization.
 */
export const POST = withVenue(withAuth('manager.keyed_entry', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const body = await parseBody<KeyedEntryRequest>(request)
    const { orderId, amount, tipAmount, cardNumber, expiryMonth, expiryYear, cvv, zipCode, readerId } = body
    const locationId = ctx.auth.locationId
    const employeeId = ctx.auth.employeeId

    // ─── Validate required fields ──────────────────────────────────────
    if (!orderId || amount === undefined || amount === null || amount <= 0) {
      return Response.json({ error: 'Missing required fields: orderId, amount (positive)' }, { status: 400 })
    }
    if (!cardNumber || !expiryMonth || !expiryYear || !cvv) {
      return Response.json({ error: 'Missing required card fields: cardNumber, expiryMonth, expiryYear, cvv' }, { status: 400 })
    }
    // Auto-resolve reader for sequence tracking if not provided
    let resolvedReaderId = readerId
    if (!resolvedReaderId) {
      const reader = await db.paymentReader.findFirst({
        where: { locationId, isActive: true, deletedAt: null },
        select: { id: true },
      })
      if (!reader) {
        return Response.json({ error: 'No active payment reader found for this location. A reader is needed for keyed entry processing.' }, { status: 400 })
      }
      resolvedReaderId = reader.id
    }

    // ─── Validate card data ────────────────────────────────────────────
    const cleanCardNumber = cardNumber.replace(/[\s-]/g, '')
    if (!isValidCardNumber(cleanCardNumber)) {
      return Response.json({ error: 'Invalid card number. Must be 13-19 digits.' }, { status: 400 })
    }
    if (!isValidExpiry(expiryMonth, expiryYear)) {
      return Response.json({ error: 'Invalid or expired card date.' }, { status: 400 })
    }
    if (!isValidCVV(cvv)) {
      return Response.json({ error: 'Invalid CVV. Must be 3-4 digits.' }, { status: 400 })
    }

    // ─── Extract safe data BEFORE processing (never log full PAN) ──────
    const cardLast4 = cleanCardNumber.slice(-4)
    const cardBrand = detectCardBrand(cleanCardNumber)
    const invoiceNo = body.invoiceNo || orderId

    // Audit log — only last 4 digits, NEVER full card number
    logger.warn('datacap', `[KEYED ENTRY] Processing manual card entry: last4=****${cardLast4}, brand=${cardBrand}, amount=$${amount}, orderId=${orderId}, employee=${employeeId}`)

    // ─── Get Datacap client ────────────────────────────────────────────
    const client = await requireDatacapClient(locationId)

    // ─── HA Failover Protection: Track pending sale ────────────────────
    const pendingId = crypto.randomUUID()
    await db.$executeRawUnsafe(
      `INSERT INTO "_pending_datacap_sales" (id, "orderId", "terminalId", "invoiceNo", "amount", "status", "locationId")
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      pendingId, orderId, resolvedReaderId, invoiceNo, amount, locationId
    )

    // ─── Process keyed sale via Datacap cloud ──────────────────────────
    let response
    try {
      response = await client.keyedSale(resolvedReaderId, {
        invoiceNo,
        amounts: {
          purchase: amount,
          gratuity: tipAmount || undefined,
        },
        cardNumber: cleanCardNumber,
        expiryMonth: expiryMonth.padStart(2, '0'),
        expiryYear: expiryYear.padStart(2, '0'),
        cvv,
        zipCode,
        requestRecordNo: true,
        allowPartialAuth: true,
      })
    } catch (saleError) {
      // Mark pending as failed
      void db.$executeRawUnsafe(
        `UPDATE "_pending_datacap_sales" SET "status" = 'failed', "resolvedAt" = NOW() WHERE id = $1`,
        pendingId
      ).catch(e => console.error('[Keyed Entry] Failed to mark pending sale as failed:', e))
      throw saleError
    }

    const error = parseError(response)

    // ─── Update pending sale record with outcome ───────────────────────
    if (response.cmdStatus === 'Approved') {
      void db.$executeRawUnsafe(
        `UPDATE "_pending_datacap_sales" SET "status" = 'completed', "datacapRecordNo" = $2, "datacapRefNumber" = $3, "resolvedAt" = NOW() WHERE id = $1`,
        pendingId, response.recordNo || null, response.refNo || null
      ).catch(e => console.error('[Keyed Entry] Failed to mark pending sale as completed:', e))
    } else {
      void db.$executeRawUnsafe(
        `UPDATE "_pending_datacap_sales" SET "status" = 'declined', "resolvedAt" = NOW() WHERE id = $1`,
        pendingId
      ).catch(e => console.error('[Keyed Entry] Failed to mark pending sale as declined:', e))
    }

    pushUpstream()

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        recordNo: response.recordNo,
        cardType: cardBrand,
        cardLast4,
        entryMethod: 'Manual',
        amountAuthorized: response.authorize,
        isPartialApproval: response.isPartialApproval,
        gratuity: response.gratuityAmount,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
}))
