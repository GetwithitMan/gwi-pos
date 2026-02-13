import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
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

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Get all open orders with full item data
    const orders = await db.order.findMany({
      where: {
        locationId,
        status: { in: ['open', 'in_progress', 'paid'] },
        items: { some: {} },
      },
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
                name: m.preModifier ? `${m.preModifier} ${m.name}` : m.name,
                depth: m.depth || 0,
              })),
            }
          }),
        }
      })
      .filter(Boolean)

    return NextResponse.json({ orders: expoOrders })
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

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update expo items:', error)
    return NextResponse.json(
      { error: 'Failed to update' },
      { status: 500 }
    )
  }
})
