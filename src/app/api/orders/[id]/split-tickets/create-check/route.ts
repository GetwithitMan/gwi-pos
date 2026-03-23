import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { handleApiError, NotFoundError, ValidationError } from '@/lib/api-errors'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged, dispatchSplitCreated } from '@/lib/socket-dispatch'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// ============================================
// POST - Create a new empty check on a split order
// ============================================

export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get parent order
    const parentOrder = await db.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        orderNumber: true,
        employeeId: true,
        locationId: true,
        tableId: true,
        orderType: true,
        orderTypeId: true,
        splitOrders: {
          where: { deletedAt: null },
          select: { splitIndex: true },
          orderBy: { splitIndex: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            splitOrders: { where: { deletedAt: null } },
          },
        },
      },
    })

    if (!parentOrder) {
      throw new NotFoundError('Order')
    }

    if (parentOrder.status !== 'split') {
      throw new ValidationError('Parent order must have status "split" to add checks')
    }

    // Safety limit
    if (parentOrder._count.splitOrders >= 20) {
      return NextResponse.json(
        { error: 'Maximum 20 splits per order' },
        { status: 400 }
      )
    }

    // Next split index = max existing + 1
    const maxIndex = parentOrder.splitOrders[0]?.splitIndex ?? 0
    const nextIndex = maxIndex + 1
    const displayNumber = `${parentOrder.orderNumber}-${nextIndex}`

    const newOrder = await db.order.create({
      data: {
        parentOrderId: id,
        splitIndex: nextIndex,
        displayNumber,
        orderNumber: parentOrder.orderNumber,
        employeeId: parentOrder.employeeId,
        locationId: parentOrder.locationId,
        tableId: parentOrder.tableId,
        orderType: parentOrder.orderType,
        orderTypeId: parentOrder.orderTypeId,
        status: 'open',
        subtotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        taxFromInclusive: 0,
        taxFromExclusive: 0,
        tipTotal: 0,
        total: 0,
        commissionTotal: 0,
        guestCount: 1,
        baseSeatCount: 0,
        extraSeatCount: 0,
        seatVersion: 0,
        lastMutatedBy: 'local',
      },
      select: {
        id: true,
        splitIndex: true,
        displayNumber: true,
      },
    })

    // Fire-and-forget: notify all terminals that a new split order was created
    void dispatchOpenOrdersChanged(parentOrder.locationId, {
      trigger: 'created',
      orderId: newOrder.id,
      tableId: parentOrder.tableId || undefined,
    }).catch(console.error)

    // Dispatch order:split-created so all devices instantly render the new check
    void dispatchSplitCreated(parentOrder.locationId, {
      parentOrderId: id,
      parentStatus: 'split',
      splits: [{
        id: newOrder.id,
        orderNumber: parentOrder.orderNumber,
        splitIndex: newOrder.splitIndex!,
        displayNumber: newOrder.displayNumber || `${parentOrder.orderNumber}-${newOrder.splitIndex}`,
        total: 0,
        itemCount: 0,
        isPaid: false,
      }],
      sourceTerminalId: request.headers.get('x-terminal-id') || undefined,
    }).catch(console.error)

    // Event emission: new empty split check created
    void emitOrderEvent(parentOrder.locationId, newOrder.id, 'ORDER_CREATED', {
      locationId: parentOrder.locationId,
      employeeId: parentOrder.employeeId,
      orderType: parentOrder.orderType,
      tableId: parentOrder.tableId,
      guestCount: 1,
      orderNumber: parentOrder.orderNumber,
      displayNumber: newOrder.displayNumber,
      parentOrderId: id,
      splitIndex: newOrder.splitIndex,
    }).catch(console.error)

    pushUpstream()

    return NextResponse.json(
      { data: {
        id: newOrder.id,
        splitIndex: newOrder.splitIndex,
        displayNumber: newOrder.displayNumber,
      } },
      { status: 201 }
    )
  } catch (error) {
    return handleApiError(error, 'Failed to create check')
  }
}))
