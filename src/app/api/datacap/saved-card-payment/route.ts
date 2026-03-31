import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { roundToCents } from '@/lib/pricing'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Process a payment using a saved card token (SaleByRecordNo)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, savedCardId, amount, tipAmount, employeeId, locationId, terminalId } = body

    if (!orderId || !savedCardId || !amount || !locationId) {
      return err('orderId, savedCardId, amount, and locationId are required')
    }

    if (amount <= 0) {
      return err('Amount must be positive')
    }
    if (tipAmount !== undefined && tipAmount !== null && tipAmount < 0) {
      return err('Tip amount must be non-negative')
    }
    if (tipAmount !== undefined && tipAmount !== null && tipAmount > amount) {
      return err('Tip amount cannot exceed purchase amount')
    }

    // Permission check — card payment permission
    const auth = await requireAnyPermission(
      employeeId, locationId,
      [PERMISSIONS.POS_CARD_PAYMENTS]
    )
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Check card-on-file is enabled
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)

    if (!settings.cardOnFile?.enabled) {
      return err('Card on file is not enabled')
    }

    // Look up the saved card — retrieve token for processing
    const savedCards = await db.$queryRaw<Array<{
      id: string
      token: string
      last4: string
      cardBrand: string
      customerId: string
    }>>`SELECT id, token, last4, "cardBrand", "customerId"
       FROM "SavedCard"
       WHERE id = ${savedCardId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL LIMIT 1`

    if (!savedCards.length) {
      return notFound('Saved card not found')
    }

    const card = savedCards[0]

    // Verify order exists and is open
    const order = await db.order.findFirst({
      where: { id: orderId, locationId, deletedAt: null },
      select: { id: true, orderNumber: true, status: true, total: true },
    })

    if (!order) {
      return notFound('Order not found')
    }

    if (order.status === 'paid' || order.status === 'cancelled') {
      return err(`Order is already ${order.status}`)
    }

    // Resolve reader from terminal
    let readerId: string | null = null
    if (terminalId) {
      const terminal = await db.terminal.findUnique({
        where: { id: terminalId },
        select: { paymentReaderId: true },
      })
      readerId = terminal?.paymentReaderId ?? null
    }

    if (!readerId) {
      // Try to find any active reader for this location
      const reader = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "PaymentReader"
         WHERE "locationId" = ${locationId} AND "isActive" = true AND "deletedAt" IS NULL
         LIMIT 1`
      readerId = reader[0]?.id ?? null
    }

    if (!readerId) {
      return err('No payment reader available')
    }

    // Process via Datacap SaleByRecordNo using the stored token
    const datacap = await getDatacapClient(locationId)
    const invoiceNo = `${order.orderNumber || orderId.slice(-8)}-${Date.now().toString(36)}`
    const roundedAmount = roundToCents(amount)
    const roundedTip = roundToCents(tipAmount || 0)

    const result = await datacap.saleByRecordNo(readerId, {
      recordNo: card.token,
      invoiceNo,
      amount: roundedAmount,
      gratuityAmount: roundedTip,
    })

    const isApproved = result.cmdStatus === 'Approved' || result.cmdStatus === 'Success'

    if (!isApproved) {
      return NextResponse.json({
        error: 'Card declined',
        details: result.textResponse || 'The saved card was declined.',
        cardLast4: card.last4,
        cardBrand: card.cardBrand,
      }, { status: 402 })
    }

    // Payment was approved — the caller should use the standard /pay route
    // to record the payment with the Datacap fields from this response
    return ok({
        approved: true,
        orderId,
        savedCardId: card.id,
        cardLast4: card.last4,
        cardBrand: card.cardBrand,
        customerId: card.customerId,
        amount,
        tipAmount: tipAmount || 0,
        totalAmount: amount + (tipAmount || 0),
        // Datacap fields for the /pay route
        datacapRecordNo: result.recordNo || null,
        datacapRefNumber: result.refNo,
        datacapSequenceNo: result.sequenceNo,
        authCode: result.authCode,
        invoiceNo,
      })
  } catch (error) {
    console.error('Saved card payment failed:', error)
    return err('Failed to process saved card payment', 500)
  }
})
