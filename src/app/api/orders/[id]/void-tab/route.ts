import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchTabUpdated } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'

// POST - Void an unclosed tab (releases all card holds)
// Fires VoidSaleByRecordNo for each authorized OrderCard
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { employeeId, reason } = body

    if (!employeeId) {
      return NextResponse.json({ error: 'Missing required field: employeeId' }, { status: 400 })
    }

    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        cards: {
          where: { deletedAt: null, status: 'authorized' },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.cards.length === 0) {
      return NextResponse.json({ error: 'No authorized cards to void on this tab' }, { status: 400 })
    }

    const locationId = order.locationId
    const results: Array<{ cardLast4: string; voided: boolean; error?: string }> = []

    // Void each authorized card
    for (const card of order.cards) {
      try {
        await validateReader(card.readerId, locationId)
        const client = await requireDatacapClient(locationId)

        const response = await client.voidSale(card.readerId, {
          recordNo: card.recordNo,
        })

        const voided = response.cmdStatus === 'Approved' || response.cmdStatus === 'Success'

        await db.orderCard.update({
          where: { id: card.id },
          data: { status: voided ? 'voided' : card.status },
        })

        results.push({
          cardLast4: card.cardLast4,
          voided,
          error: voided ? undefined : response.textResponse,
        })

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Void failed'
        results.push({ cardLast4: card.cardLast4, voided: false, error: errorMsg })
        console.warn(`[Tab Void] Error voiding card ...${card.cardLast4}:`, err)
      }
    }

    const allVoided = results.every((r) => r.voided)

    // Update order status
    await db.order.update({
      where: { id: orderId },
      data: {
        tabStatus: allVoided ? 'closed' : order.tabStatus,
        status: allVoided ? 'voided' : order.status,
        notes: reason ? `Tab voided: ${reason}` : order.notes,
      },
    })

    // Fire-and-forget event emission
    if (allVoided) {
      void emitOrderEvent(locationId, orderId, 'ORDER_CLOSED', {
        closedStatus: 'voided',
        reason: reason || 'Tab voided',
      }).catch(console.error)
    }

    // Dispatch socket events for voided tab (fire-and-forget)
    if (allVoided) {
      void dispatchOpenOrdersChanged(locationId, {
        trigger: 'voided',
        orderId,
        tableId: order.tableId || undefined,
      }, { async: true }).catch(() => {})
      void dispatchTabUpdated(locationId, {
        orderId,
        status: 'voided',
      }).catch(() => {})
      if (order.tableId) {
        void dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})
      }
    }

    return NextResponse.json({
      data: {
        success: allVoided,
        results,
        partialVoid: !allVoided && results.some((r) => r.voided),
      },
    })
  } catch (error) {
    console.error('Failed to void tab:', error)
    return NextResponse.json({ error: 'Failed to void tab' }, { status: 500 })
  }
})
