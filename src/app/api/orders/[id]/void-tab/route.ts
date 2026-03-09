import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchTabUpdated, dispatchTabStatusUpdate, dispatchOrderClosed, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
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

    // Reset table to available when tab is fully voided
    if (allVoided && order.tableId) {
      await db.table.update({
        where: { id: order.tableId },
        data: { status: 'available' },
      })
    }

    // Clean up entertainment items tied to this order
    let cleanedEntertainmentIds: string[] = []
    if (allVoided) {
      try {
        // Find all timed_rental MenuItems currently linked to this order
        const entertainmentItems = await db.menuItem.findMany({
          where: {
            currentOrderId: orderId,
            itemType: 'timed_rental',
          },
          select: { id: true, name: true },
        })

        for (const item of entertainmentItems) {
          await db.menuItem.update({
            where: { id: item.id },
            data: {
              entertainmentStatus: 'available',
              currentOrderId: null,
              currentOrderItemId: null,
            },
          })

          await db.floorPlanElement.updateMany({
            where: {
              linkedMenuItemId: item.id,
              deletedAt: null,
              status: 'in_use',
            },
            data: {
              status: 'available',
              currentOrderId: null,
              sessionStartedAt: null,
              sessionExpiresAt: null,
            },
          })
        }

        cleanedEntertainmentIds = entertainmentItems.map((i) => i.id)

        if (entertainmentItems.length > 0) {
          console.log(`[Tab Void] Cleaned up ${entertainmentItems.length} entertainment items for order ${orderId}`)
        }
      } catch (cleanupErr) {
        console.error('[Tab Void] Failed to clean up entertainment items:', cleanupErr)
      }
    }

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
      dispatchTabStatusUpdate(locationId, { orderId, status: 'voided' })
      // BUG 3: Dispatch order:closed so Android clients listening for the event learn about voided tabs
      void dispatchOrderClosed(locationId, {
        orderId,
        status: 'voided',
        closedAt: new Date().toISOString(),
        closedByEmployeeId: employeeId,
        locationId,
      }, { async: true }).catch(() => {})
      if (order.tableId) {
        void dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})
      }
      // Notify entertainment status changes for cleaned-up items
      for (const itemId of cleanedEntertainmentIds) {
        void dispatchEntertainmentStatusChanged(locationId, {
          itemId,
          entertainmentStatus: 'available',
          currentOrderId: null,
          expiresAt: null,
        }, { async: true }).catch(() => {})
      }
      if (cleanedEntertainmentIds.length > 0) {
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
