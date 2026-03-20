import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { roundToCents } from '@/lib/pricing'

// POST - Process a payment using a saved card token (SaleByRecordNo)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, savedCardId, amount, tipAmount, employeeId, locationId, terminalId } = body

    if (!orderId || !savedCardId || !amount || !locationId) {
      return NextResponse.json(
        { error: 'orderId, savedCardId, amount, and locationId are required' },
        { status: 400 }
      )
    }

    if (amount <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
    }
    if (tipAmount !== undefined && tipAmount !== null && tipAmount < 0) {
      return NextResponse.json({ error: 'Tip amount must be non-negative' }, { status: 400 })
    }
    if (tipAmount !== undefined && tipAmount !== null && tipAmount > amount) {
      return NextResponse.json({ error: 'Tip amount cannot exceed purchase amount' }, { status: 400 })
    }

    // Permission check — card payment permission
    const auth = await requireAnyPermission(
      employeeId, locationId,
      [PERMISSIONS.POS_CARD_PAYMENTS]
    )
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Check card-on-file is enabled
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)

    if (!settings.cardOnFile?.enabled) {
      return NextResponse.json({ error: 'Card on file is not enabled' }, { status: 400 })
    }

    // Look up the saved card — retrieve token for processing
    const savedCards = await db.$queryRawUnsafe<Array<{
      id: string
      token: string
      last4: string
      cardBrand: string
      customerId: string
    }>>(
      `SELECT id, token, last4, "cardBrand", "customerId"
       FROM "SavedCard"
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
      savedCardId, locationId
    )

    if (!savedCards.length) {
      return NextResponse.json({ error: 'Saved card not found' }, { status: 404 })
    }

    const card = savedCards[0]

    // Verify order exists and is open
    const order = await db.order.findFirst({
      where: { id: orderId, locationId, deletedAt: null },
      select: { id: true, orderNumber: true, status: true, total: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.status === 'paid' || order.status === 'cancelled') {
      return NextResponse.json({ error: `Order is already ${order.status}` }, { status: 400 })
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
      const reader = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "PaymentReader"
         WHERE "locationId" = $1 AND "isActive" = true AND "deletedAt" IS NULL
         LIMIT 1`,
        locationId
      )
      readerId = reader[0]?.id ?? null
    }

    if (!readerId) {
      return NextResponse.json({ error: 'No payment reader available' }, { status: 400 })
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
    return NextResponse.json({
      data: {
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
      },
    })
  } catch (error) {
    console.error('Saved card payment failed:', error)
    return NextResponse.json({ error: 'Failed to process saved card payment' }, { status: 500 })
  }
})
