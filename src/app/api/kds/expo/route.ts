import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchItemStatus, dispatchOrderBumped } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

/**
 * Expo KDS API - Returns all items from all stations for expeditor view
 *
 * Features:
 * - Returns ALL items regardless of station assignment
 * - Tracks item status across all prep stations
 */

// GET - Get all orders for expo display
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const cursor = searchParams.get('cursor')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Get all open orders with full item data
    // Cursor-based pagination: take 50 at a time for performance at 100+ open orders
    const orders = await db.order.findMany({
      where: {
        locationId,
        // W2-K1: Paid orders only shown for 2 hours to prevent KDS clutter
        OR: [
          { status: { in: ['open', 'in_progress'] } },
          { status: 'paid', paidAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
        ],
        items: { some: {} },
      },
      take: 50,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        table: {
          select: {
            id: true,
            name: true,
            abbreviation: true,
          },
        },
        employee: {
          select: {
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          where: {
            // Only show items that have been sent to kitchen and not yet served
            kitchenStatus: { not: 'delivered' },
            status: { not: 'voided' },    // W2-K2: Hide voided items
            deletedAt: null,               // W2-K2: Hide deleted items
          },
          include: {
            sourceTable: {
              select: {
                id: true,
                name: true,
                abbreviation: true,
              },
            },
            menuItem: {
              select: {
                id: true,
                name: true,
                prepStationId: true,
                category: {
                  select: {
                    id: true,
                    name: true,
                    prepStationId: true,
                  },
                },
              },
            },
            modifiers: {
              select: {
                id: true,
                name: true,
                preModifier: true,
                depth: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Get prep stations for labeling
    const prepStations = await db.prepStation.findMany({
      where: { locationId },
      select: { id: true, name: true, displayName: true },
    })
    const stationMap = new Map(
      prepStations.map((s) => [s.id, s.displayName || s.name])
    )

    // Transform orders
    const expoOrders = orders
      .map((order) => {
        // Skip orders with no items after filtering
        if (order.items.length === 0) return null

        const createdAt = new Date(order.createdAt)
        const now = new Date()
        const elapsedMinutes = Math.floor(
          (now.getTime() - createdAt.getTime()) / (1000 * 60)
        )

        let timeStatus: 'fresh' | 'aging' | 'late' = 'fresh'
        if (elapsedMinutes >= 15) timeStatus = 'late'
        else if (elapsedMinutes >= 8) timeStatus = 'aging'

        return {
          id: order.id,
          orderNumber: order.orderNumber,
          orderType: order.orderType,
          tabName: order.tabName,
          table: order.table,
          employeeName:
            order.employee?.displayName ||
            `${order.employee?.firstName || ''} ${order.employee?.lastName || ''}`.trim() ||
            'Unknown',
          createdAt: order.createdAt.toISOString(),
          elapsedMinutes,
          timeStatus,
          items: order.items.map((item) => {
            // Determine prep station
            const stationId =
              item.menuItem?.prepStationId ||
              item.menuItem?.category?.prepStationId

            return {
              id: item.id,
              name: item.menuItem?.name || item.name,
              quantity: item.quantity,
              seatNumber: item.seatNumber,
              sourceTable: item.sourceTable,
              kitchenStatus: item.kitchenStatus,
              isCompleted: item.isCompleted,
              completedAt: item.completedAt?.toISOString(),
              specialNotes: item.specialNotes,
              categoryName: item.menuItem?.category?.name,
              prepStationId: stationId,
              prepStationName: stationId ? stationMap.get(stationId) : null,
              modifiers: item.modifiers.map((m) => ({
                id: m.id,
                // T-042: handle compound preModifier strings (e.g. "side,extra" → "Side Extra Ranch")
                name: m.preModifier
                  ? `${m.preModifier.split(',').map(t => t.trim()).filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ')} ${m.name}`
                  : m.name,
                depth: m.depth || 0,
              })),
            }
          }),
        }
      })
      .filter(Boolean)

    // Cursor for next page — last order ID from the raw DB result (before filtering)
    const nextCursor = orders.length === 50 ? orders[orders.length - 1].id : null

    return NextResponse.json({ data: { orders: expoOrders, nextCursor } })
  } catch (error) {
    console.error('Failed to fetch expo orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    )
  }
})

// PUT - Update item status from expo
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { itemIds, action, status } = body

    if (!itemIds || itemIds.length === 0) {
      return NextResponse.json(
        { error: 'Item IDs required' },
        { status: 400 }
      )
    }

    if (action === 'serve' || status === 'served') {
      // Mark items as delivered/served
      await db.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          kitchenStatus: 'delivered',
          isCompleted: true,
          completedAt: new Date(),
        },
      })
    } else if (action === 'update_status' && status) {
      // Update to specific status
      const kitchenStatus =
        status === 'cooking'
          ? 'cooking'
          : status === 'ready'
            ? 'ready'
            : status === 'pending'
              ? 'pending'
              : undefined

      if (kitchenStatus) {
        await db.orderItem.updateMany({
          where: { id: { in: itemIds } },
          data: {
            kitchenStatus,
            isCompleted: kitchenStatus === 'ready',
            completedAt:
              kitchenStatus === 'ready' ? new Date() : null,
          },
        })
      }
    } else if (action === 'bump_order') {
      // Mark all items in the specified orders as complete
      const orderId = body.orderId
      if (orderId) {
        await db.orderItem.updateMany({
          where: {
            orderId,
            kitchenStatus: { not: 'delivered' },
          },
          data: {
            kitchenStatus: 'delivered',
            isCompleted: true,
            completedAt: new Date(),
          },
        })
      }
    }

    // W1-K3: Dispatch socket events so all KDS screens sync
    const firstItem = await db.orderItem.findUnique({
      where: { id: itemIds[0] },
      select: { orderId: true, order: { select: { locationId: true, employeeId: true } } },
    })

    if (firstItem?.order) {
      const locationId = firstItem.order.locationId
      const orderId = firstItem.orderId

      if (action === 'bump_order') {
        dispatchOrderBumped(locationId, {
          orderId: body.orderId || orderId,
          stationId: body.stationId || '',
          bumpedBy: body.employeeId || firstItem.order.employeeId || '',
          allItemsServed: true,
        }, { async: true }).catch(err => {
          console.error('[Expo] Failed to dispatch order bumped:', err)
        })
      } else {
        // serve, update_status — dispatch item status for each item
        const newStatus = action === 'serve' || status === 'served' ? 'completed' : (status || 'active')
        for (const iid of itemIds) {
          dispatchItemStatus(locationId, {
            orderId,
            itemId: iid,
            status: newStatus,
            stationId: body.stationId || '',
            updatedBy: body.employeeId || firstItem.order.employeeId || '',
          }, { async: true }).catch(err => {
            console.error('[Expo] Failed to dispatch item status:', err)
          })
        }
      }
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to update expo items:', error)
    return NextResponse.json(
      { error: 'Failed to update' },
      { status: 500 }
    )
  }
})
