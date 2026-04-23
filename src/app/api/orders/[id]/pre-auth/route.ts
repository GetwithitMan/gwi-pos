import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { dispatchOpenOrdersChanged, dispatchTabUpdated, dispatchTabStatusUpdate, dispatchPaymentProcessed } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('orders.id.pre-auth')

// ── Zod schema for POST /api/orders/[id]/pre-auth ───────────────────
const PreAuthSchema = z.object({
  readerId: z.string().min(1, 'readerId is required'),
  employeeId: z.string().min(1, 'employeeId is required'),
  amount: z.number().positive().optional(),
}).passthrough()

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
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const rawBody = await request.json().catch(() => ({}))
    const parseResult = PreAuthSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const { readerId, employeeId, amount } = parseResult.data

    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { location: { select: { id: true, settings: true } } },
    })

    if (!order) {
      return notFound('Order not found')
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
      return ok({
          approved: false,
          error: dcError
            ? { code: dcError.code, message: dcError.text, isRetryable: dcError.isRetryable }
            : { code: 'DECLINED', message: 'Card declined', isRetryable: true },
        })
    }

    const recordNo = response.recordNo
    if (!recordNo) {
      return err('Pre-auth approved but no RecordNo token received', 500)
    }

    // Unset any existing default cards (shouldn't happen for "Start Tab" but be safe)
    await db.orderCard.updateMany({
      where: { orderId, isDefault: true, deletedAt: null },
      data: { isDefault: false, lastMutatedBy: 'local' },
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
        lastMutatedBy:  'local',
      },
    })

    // Update order preAuthAmount so Open Orders panel shows the hold amount
    await db.order.update({
      where: { id: orderId },
      data: { preAuthAmount, lastMutatedBy: 'local' },
    })

    // Fire-and-forget: emit TAB_OPENED event for event-sourced sync
    void emitOrderEvent(locationId, orderId, 'TAB_OPENED', {
      preAuthId: recordNo,
      cardLast4: response.cardLast4 || '????',
      tabName: response.cardholderName || null,
    })

    // Fire-and-forget: notify all terminals a card was added
    void dispatchPaymentProcessed(locationId, {
      orderId,
      paymentId: orderCard.id,
      status: 'authorized',
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pre-auth'))
    void dispatchTabUpdated(locationId, {
      orderId,
      status: 'open',
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pre-auth'))
    dispatchTabStatusUpdate(locationId, { orderId, status: 'open' })
    void dispatchOpenOrdersChanged(locationId, {
      trigger: 'created',
      orderId,
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pre-auth'))

    pushUpstream()

    return ok({
        approved:      true,
        orderCardId:   orderCard.id,
        cardType:      response.cardType,
        cardLast4:     response.cardLast4,
        cardholderName: response.cardholderName,
        authAmount:    preAuthAmount,
        recordNo,
      })
  } catch (error) {
    console.error('[pre-auth] Failed:', error)
    return err('Failed to start tab', 500)
  }
}))
