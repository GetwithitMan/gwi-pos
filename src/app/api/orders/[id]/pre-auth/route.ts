import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { dispatchPaymentProcessed } from '@/lib/socket-dispatch'

/**
 * POST /api/orders/[id]/pre-auth
 *
 * Start Tab — present a card to the reader, run EMVPreAuth, and store the
 * resulting RecordNo token as the tab's default card.
 *
 * Called when the bartender taps "Start Tab" and the order has no card on file.
 * For adding a *second* card to an existing tab, use POST /api/orders/[id]/cards.
 *
 * Body:   { readerId, employeeId, amount? }
 * Returns { approved, orderCardId?, cardType?, cardLast4?, cardholderName?, authAmount?, error? }
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { readerId, employeeId, amount } = body as {
      readerId?: string
      employeeId?: string
      amount?: number
    }

    if (!readerId || !employeeId) {
      return NextResponse.json(
        { error: 'Missing required fields: readerId, employeeId' },
        { status: 400 }
      )
    }

    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { location: { select: { id: true, settings: true } } },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const locationId = order.locationId
    const settings = parseSettings(order.location.settings)
    const preAuthAmount = amount ?? settings.payments.defaultPreAuthAmount ?? 100

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.preAuth(readerId, {
      invoiceNo: orderId,
      amount: preAuthAmount,
      requestRecordNo: true,
    })

    const dcError = parseError(response)
    const approved = response.cmdStatus === 'Approved'

    if (!approved) {
      return NextResponse.json({
        data: {
          approved: false,
          error: dcError
            ? { code: dcError.code, message: dcError.text, isRetryable: dcError.isRetryable }
            : { code: 'DECLINED', message: 'Card declined', isRetryable: true },
        },
      })
    }

    const recordNo = response.recordNo
    if (!recordNo) {
      return NextResponse.json(
        { error: 'Pre-auth approved but no RecordNo token received' },
        { status: 500 }
      )
    }

    // Unset any existing default cards (shouldn't happen for "Start Tab" but be safe)
    await db.orderCard.updateMany({
      where: { orderId, isDefault: true, deletedAt: null },
      data: { isDefault: false },
    })

    const orderCard = await db.orderCard.create({
      data: {
        locationId,
        orderId,
        readerId,
        recordNo,
        cardType:       response.cardType || 'unknown',
        cardLast4:      response.cardLast4 || '????',
        cardholderName: response.cardholderName,
        authAmount:     preAuthAmount,
        isDefault:      true,
        status:         'authorized',
      },
    })

    // Update order preAuthAmount so Open Orders panel shows the hold amount
    await db.order.update({
      where: { id: orderId },
      data: { preAuthAmount },
    })

    // Fire-and-forget: notify all terminals a card was added
    void dispatchPaymentProcessed(locationId, {
      orderId,
      paymentId: orderCard.id,
      status: 'authorized',
    }).catch(() => {})

    return NextResponse.json({
      data: {
        approved:      true,
        orderCardId:   orderCard.id,
        cardType:      response.cardType,
        cardLast4:     response.cardLast4,
        cardholderName: response.cardholderName,
        authAmount:    preAuthAmount,
        recordNo,
      },
    })
  } catch (error) {
    console.error('[pre-auth] Failed:', error)
    return NextResponse.json({ error: 'Failed to start tab' }, { status: 500 })
  }
})
