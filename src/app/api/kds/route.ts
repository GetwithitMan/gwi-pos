import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchItemStatus, dispatchOrderBumped } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

// GET - Get orders for KDS display
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const stationId = searchParams.get('stationId')
    const showAll = searchParams.get('showAll') === 'true' // Expo mode

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Get the station info if specified
    let station = null
    if (stationId) {
      station = await db.prepStation.findUnique({
        where: { id: stationId },
        include: {
          categories: { select: { id: true } },
          menuItems: { select: { id: true } },
        },
      })
    }

    // Get orders that have been sent to kitchen (including paid orders with incomplete items)
    const orders = await db.order.findMany({
      where: {
        locationId,
        status: { in: ['open', 'in_progress', 'paid'] },
        // Only orders with items (sent to kitchen)
        items: { some: {} },
      },
      include: {
        employee: {
          select: {
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        table: {
          select: {
            name: true,
          },
        },
        items: {
          where: {
            deletedAt: null,
            kitchenStatus: { not: 'pending' },  // Only show items that have been sent to kitchen
            status: { not: 'voided' },           // Hide voided items
            ...(showAll ? {} : { isCompleted: false }),  // Normal mode: hide completed items
          },
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                categoryId: true,
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
            ingredientModifications: {
              select: {
                id: true,
                ingredientName: true,
                modificationType: true,
                swappedToModifierName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Filter and format orders for KDS
    const kdsOrders = orders.map(order => {
      // Filter items for this station
      let filteredItems = order.items

      if (station && !station.showAllItems) {
        // Get station's assigned category and item IDs
        const stationCategoryIds = station.categories.map(c => c.id)
        const stationItemIds = station.menuItems.map(i => i.id)

        filteredItems = order.items.filter(item => {
          // Check if item has direct station override
          if (item.menuItem.prepStationId) {
            return item.menuItem.prepStationId === stationId
          }
          // Check if item's category is assigned to this station
          if (item.menuItem.category?.prepStationId) {
            return item.menuItem.category.prepStationId === stationId
          }
          // Check if category is in station's assigned categories
          if (stationCategoryIds.includes(item.menuItem.categoryId)) {
            return true
          }
          // Check if item is specifically assigned
          if (stationItemIds.includes(item.menuItemId)) {
            return true
          }
          return false
        })
      }

      // Skip orders with no items for this station
      if (filteredItems.length === 0) {
        return null
      }

      // Calculate time since order was created
      const createdAt = new Date(order.createdAt)
      const now = new Date()
      const elapsedMs = now.getTime() - createdAt.getTime()
      const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60))

      // Determine status color based on elapsed time
      let timeStatus: 'fresh' | 'aging' | 'late' = 'fresh'
      if (elapsedMinutes >= 15) {
        timeStatus = 'late'
      } else if (elapsedMinutes >= 8) {
        timeStatus = 'aging'
      }

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        tableName: order.table?.name || null,
        tabName: order.tabName,
        employeeName: order.employee?.displayName ||
          `${order.employee?.firstName || ''} ${order.employee?.lastName || ''}`.trim(),
        createdAt: order.createdAt.toISOString(),
        elapsedMinutes,
        timeStatus,
        notes: order.notes,
        items: filteredItems.map(item => ({
          id: item.id,
          name: item.menuItem.name,
          quantity: item.quantity,
          categoryName: item.menuItem.category?.name,
          specialNotes: item.specialNotes,
          isCompleted: item.isCompleted || false,
          completedAt: item.completedAt?.toISOString() || null,
          resendCount: item.resendCount || 0,
          lastResentAt: item.lastResentAt?.toISOString() || null,
          resendNote: item.resendNote || null,
          // Seat assignment (T023)
          seatNumber: item.seatNumber ?? null,
          // Coursing info (T013)
          courseNumber: item.courseNumber ?? null,
          courseStatus: item.courseStatus ?? 'pending',
          isHeld: item.isHeld ?? false,
          firedAt: item.firedAt?.toISOString() || null,
          modifiers: item.modifiers.map(mod => ({
            id: mod.id,
            // T-042: handle compound preModifier strings (e.g. "side,extra" → "Side Extra Ranch")
            name: mod.preModifier
              ? `${mod.preModifier.split(',').map(t => t.trim()).filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ')} ${mod.name}`
              : mod.name,
            depth: mod.depth || 0,
          })),
          ingredientModifications: item.ingredientModifications.map(ing => ({
            id: ing.id,
            ingredientName: ing.ingredientName,
            modificationType: ing.modificationType as 'no' | 'lite' | 'on_side' | 'extra' | 'swap',
            swappedToModifierName: ing.swappedToModifierName,
          })),
        })),
      }
    }).filter(Boolean)

    return NextResponse.json({ data: {
      orders: kdsOrders,
      station: station ? {
        id: station.id,
        name: station.name,
        displayName: station.displayName,
        color: station.color,
        stationType: station.stationType,
        showAllItems: station.showAllItems,
      } : null,
      timestamp: new Date().toISOString(),
    } })
  } catch (error) {
    console.error('Failed to fetch KDS orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch KDS orders' },
      { status: 500 }
    )
  }
})

// PUT - Mark item(s) as complete (bump) or resend
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { itemIds, action, resendNote } = body as {
      itemIds: string[]
      action: 'complete' | 'uncomplete' | 'bump_order' | 'resend'
      resendNote?: string
    }

    if (!itemIds || itemIds.length === 0) {
      return NextResponse.json(
        { error: 'Item IDs are required' },
        { status: 400 }
      )
    }

    const now = new Date()

    if (action === 'complete') {
      await db.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          isCompleted: true,
          completedAt: now,
        },
      })
    } else if (action === 'uncomplete') {
      await db.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          isCompleted: false,
          completedAt: null,
        },
      })
    } else if (action === 'bump_order') {
      // Complete all items in the order
      await db.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          isCompleted: true,
          completedAt: now,
        },
      })
    } else if (action === 'resend') {
      // Resend items to kitchen - batch update all at once
      await db.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          resendCount: { increment: 1 },
          lastResentAt: now,
          resendNote: resendNote || null,
          isCompleted: false,
          completedAt: null,
          kitchenStatus: 'pending', // Reset kitchen status so it can be reprinted
        },
      })

      // Get order ID to trigger reprint
      const firstItem = await db.orderItem.findUnique({
        where: { id: itemIds[0] },
        select: { orderId: true },
      })

      if (firstItem?.orderId) {
        // Print the resend items to kitchen (fire-and-forget)
        void fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/print/kitchen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: firstItem.orderId,
            itemIds, // Only reprint these specific items
          }),
        }).catch(err => console.error('[KDS] Failed to print resend ticket:', err))
      }
    }

    // Get order info for socket dispatch (locationId, orderId, employeeId)
    const firstItemForDispatch = await db.orderItem.findUnique({
      where: { id: itemIds[0] },
      select: { orderId: true, order: { select: { locationId: true, employeeId: true } } },
    })

    if (firstItemForDispatch?.order) {
      const locationId = firstItemForDispatch.order.locationId
      const orderId = firstItemForDispatch.orderId

      if (action === 'complete' || action === 'uncomplete') {
        // Dispatch item status change for each item
        for (const iid of itemIds) {
          dispatchItemStatus(locationId, {
            orderId,
            itemId: iid,
            status: action === 'complete' ? 'completed' : 'active',
            stationId: body.stationId || '',
            updatedBy: body.employeeId || firstItemForDispatch.order.employeeId || '',
          }, { async: true }).catch(err => {
            console.error('Failed to dispatch item status:', err)
          })
        }
      } else if (action === 'bump_order') {
        // Dispatch order bumped event
        dispatchOrderBumped(locationId, {
          orderId,
          stationId: body.stationId || '',
          bumpedBy: body.employeeId || firstItemForDispatch.order.employeeId || '',
          allItemsServed: true,
        }, { async: true }).catch(err => {
          console.error('Failed to dispatch order bumped:', err)
        })
      }
    }

    return NextResponse.json({ data: {
      success: true,
      itemIds,
      action,
      timestamp: now.toISOString(),
    } })
  } catch (error) {
    console.error('Failed to update KDS items:', error)
    return NextResponse.json(
      { error: 'Failed to update items' },
      { status: 500 }
    )
  }
})
