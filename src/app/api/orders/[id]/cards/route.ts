import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { dispatchPaymentProcessed } from '@/lib/socket-dispatch'
import { resolveDetection } from '@/lib/domain/payment-readers/listener-service'

// GET - List all cards on a tab
export const GET = withVenue(async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const cards = await db.orderCard.findMany({
      where: { orderId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json({
      data: cards.map((card) => ({
        id: card.id,
        cardType: card.cardType,
        cardLast4: card.cardLast4,
        cardholderName: card.cardholderName,
        authAmount: Number(card.authAmount),
        isDefault: card.isDefault,
        status: card.status,
        capturedAmount: card.capturedAmount ? Number(card.capturedAmount) : null,
        tipAmount: card.tipAmount ? Number(card.tipAmount) : null,
        capturedAt: card.capturedAt,
        createdAt: card.createdAt,
      })),
    })
  } catch (error) {
    console.error('Failed to list order cards:', error)
    return NextResponse.json({ error: 'Failed to list order cards' }, { status: 500 })
  }
})

// POST - Add another card to an existing tab
// Fires CollectCardData + EMVPreAuth, creates a new OrderCard
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { readerId, employeeId, makeDefault = false, detectionId, expectedOrderVersion } = body

    if (!readerId || !employeeId) {
      return NextResponse.json({ error: 'Missing required fields: readerId, employeeId' }, { status: 400 })
    }

    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { location: { select: { id: true, settings: true } } },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const locationId = order.locationId

    // ── Optimistic concurrency check ──────────────────────────────────
    if (expectedOrderVersion !== undefined) {
      const currentVersion = (order as any).version ?? 1
      if (currentVersion !== expectedOrderVersion) {
        return NextResponse.json(
          { error: 'Order has been modified by another terminal', code: 'order_version_conflict' },
          { status: 409 }
        )
      }
    }

    // ── Passive card detection path ───────────────────────────────────
    // If detectionId is present, resolve to card data and skip CollectCardData + PreAuth
    if (detectionId) {
      const resolved = await resolveDetection(detectionId, 'save_card', {
        locationId,
        terminalId: body.terminalId,
        employeeId,
        targetOrderId: orderId,
      })

      if ('error' in resolved) {
        const statusMap: Record<string, number> = {
          detection_expired: 409,
          unauthorized: 403,
          detection_not_found: 404,
          already_resolved: 409,
          invalid_card_payload: 400,
        }
        return NextResponse.json(
          { error: resolved.error, code: resolved.code },
          { status: statusMap[resolved.code] || 400 }
        )
      }

      const { recordNo, cardType, cardLast4, cardholderName } = resolved

      if (!recordNo) {
        return NextResponse.json(
          { error: 'Detection has no recordNo — card data is invalid', code: 'invalid_card_payload' },
          { status: 400 }
        )
      }

      const settings = parseSettings(order.location.settings)
      const preAuthAmount = settings.payments.defaultPreAuthAmount || 1

      // PreAuth using the resolved recordNo (by-record, card-not-present)
      await validateReader(readerId, locationId)
      const client = await requireDatacapClient(locationId)

      const response = await client.preAuth(readerId, {
        invoiceNo: orderId,
        amount: preAuthAmount,
        requestRecordNo: true,
        recordNo, // Use detection's recordNo
      })

      const error = parseError(response)
      const approved = response.cmdStatus === 'Approved'

      if (!approved) {
        return NextResponse.json({
          data: {
            approved: false,
            error: error
              ? { code: error.code, message: error.text, isRetryable: error.isRetryable }
              : { code: 'DECLINED', message: 'Card declined', isRetryable: true },
          },
        })
      }

      const finalRecordNo = response.recordNo || recordNo

      if (makeDefault) {
        await db.orderCard.updateMany({
          where: { orderId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        })
      }

      const orderCard = await db.orderCard.create({
        data: {
          locationId,
          orderId,
          readerId,
          recordNo: finalRecordNo,
          cardType: cardType || response.cardType || 'unknown',
          cardLast4: cardLast4 || response.cardLast4 || '????',
          cardholderName: cardholderName || response.cardholderName,
          authAmount: preAuthAmount,
          isDefault: makeDefault,
          status: 'authorized',
          source: 'passive_detect',
        },
      })

      void dispatchPaymentProcessed(locationId, {
        orderId,
        paymentId: orderCard.id,
        status: 'authorized',
      }).catch(() => {})

      return NextResponse.json({
        data: {
          approved: true,
          orderCardId: orderCard.id,
          cardType: cardType || response.cardType,
          cardLast4: cardLast4 || response.cardLast4,
          cardholderName: cardholderName || response.cardholderName,
          authAmount: preAuthAmount,
          recordNo: finalRecordNo,
          isDefault: makeDefault,
        },
      })
    }

    // ── Standard card-present flow (no detectionId) ───────────────────
    const settings = parseSettings(order.location.settings)
    const preAuthAmount = settings.payments.defaultPreAuthAmount || 1

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    // PreAuth the new card
    const response = await client.preAuth(readerId, {
      invoiceNo: orderId,
      amount: preAuthAmount,
      requestRecordNo: true,
    })

    const error = parseError(response)
    const approved = response.cmdStatus === 'Approved'

    if (!approved) {
      return NextResponse.json({
        data: {
          approved: false,
          error: error
            ? { code: error.code, message: error.text, isRetryable: error.isRetryable }
            : { code: 'DECLINED', message: 'Card declined', isRetryable: true },
        },
      })
    }

    const recordNo = response.recordNo
    if (!recordNo) {
      return NextResponse.json({ error: 'Pre-auth approved but no RecordNo token received' }, { status: 500 })
    }

    // If making this the default, unset current default first
    if (makeDefault) {
      await db.orderCard.updateMany({
        where: { orderId, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      })
    }

    const orderCard = await db.orderCard.create({
      data: {
        locationId,
        orderId,
        readerId,
        recordNo,
        cardType: response.cardType || 'unknown',
        cardLast4: response.cardLast4 || '????',
        cardholderName: response.cardholderName,
        authAmount: preAuthAmount,
        isDefault: makeDefault,
        status: 'authorized',
      },
    })

    // Fire-and-forget socket dispatch for cross-terminal sync
    void dispatchPaymentProcessed(locationId, {
      orderId,
      paymentId: orderCard.id,
      status: 'authorized',
    }).catch(() => {})

    return NextResponse.json({
      data: {
        approved: true,
        orderCardId: orderCard.id,
        cardType: response.cardType,
        cardLast4: response.cardLast4,
        cardholderName: response.cardholderName,
        authAmount: preAuthAmount,
        recordNo,
        isDefault: makeDefault,
      },
    })
  } catch (error) {
    console.error('Failed to add card to tab:', error)
    return NextResponse.json({ error: 'Failed to add card to tab' }, { status: 500 })
  }
}))
