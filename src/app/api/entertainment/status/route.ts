import { NextRequest, NextResponse } from 'next/server'
import { FloorPlanElementStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

// Force dynamic rendering - never cache this endpoint
export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET - Get all timed rental menu items with optional floor plan element data
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

    // 1. Query MenuItems as PRIMARY source — all timed_rental items
    const menuItems = await db.menuItem.findMany({
      where: {
        locationId,
        deletedAt: null,
        isActive: true,
        itemType: 'timed_rental',
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
      ],
    })

    // 2. Query FloorPlanElements for timing + waitlist data (optional join)
    const floorPlanElements = await db.floorPlanElement.findMany({
      where: {
        locationId,
        deletedAt: null,
        elementType: 'entertainment',
      },
      include: {
        waitlistEntries: {
          where: {
            status: 'waiting',
            deletedAt: null,
          },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            customerName: true,
            phone: true,
            partySize: true,
            notes: true,
            status: true,
            position: true,
            requestedAt: true,
          },
        },
      },
    })

    // 3. Build map: menuItemId → FloorPlanElement (for timing + waitlist)
    const fpeByMenuItemId = new Map(
      floorPlanElements
        .filter(fpe => fpe.linkedMenuItemId)
        .map(fpe => [fpe.linkedMenuItemId!, fpe])
    )

    // 4. Batch-fetch orders for in_use items
    const orderIdSet = new Set<string>()
    // From FloorPlanElements
    for (const fpe of fpeByMenuItemId.values()) {
      if (fpe.status === 'in_use' && fpe.currentOrderId) orderIdSet.add(fpe.currentOrderId)
    }
    // From MenuItems without FloorPlanElement
    const orderItemIdsForFallback: string[] = []
    for (const mi of menuItems) {
      if (mi.entertainmentStatus === 'in_use' && !fpeByMenuItemId.has(mi.id)) {
        if (mi.currentOrderId) orderIdSet.add(mi.currentOrderId)
        if (mi.currentOrderItemId) orderItemIdsForFallback.push(mi.currentOrderItemId)
      }
    }
    const orderIds = Array.from(orderIdSet)

    // Batch-fetch orders and fallback order items in parallel
    const [linkedOrders, fallbackOrderItems] = await Promise.all([
      orderIds.length > 0
        ? db.orderSnapshot.findMany({
            where: { id: { in: orderIds } },
            select: {
              id: true,
              tabName: true,
              orderNumber: true,
              displayNumber: true,
              openedAt: true,
            },
          })
        : Promise.resolve([]),
      orderItemIdsForFallback.length > 0
        ? db.orderItem.findMany({
            where: { id: { in: orderItemIdsForFallback } },
            select: {
              id: true,
              blockTimeStartedAt: true,
              blockTimeExpiresAt: true,
            },
          })
        : Promise.resolve([]),
    ])

    const orderMap = new Map(linkedOrders.map(o => [o.id, o]))
    const orderItemMap = new Map(fallbackOrderItems.map(oi => [oi.id, oi]))

    const now = new Date()

    // 5. Map to the SAME response shape as before (backward-compatible for KDS)
    const items = menuItems.map((menuItem) => {
      const fpe = fpeByMenuItemId.get(menuItem.id)
      const status = menuItem.entertainmentStatus || 'available'

      let currentOrder = null
      let timeInfo = null

      if (status === 'in_use') {
        // Get order info from FloorPlanElement OR MenuItem.currentOrderId
        const orderId = fpe?.currentOrderId || menuItem.currentOrderId
        if (orderId) {
          const order = orderMap.get(orderId)
          if (order) {
            currentOrder = {
              orderId: order.id,
              orderItemId: menuItem.currentOrderItemId || null,
              tabName: order.tabName || `Order #${order.displayNumber || order.orderNumber}`,
              orderNumber: order.orderNumber,
              displayNumber: order.displayNumber,
            }
          }
        }

        // Time info: prefer FloorPlanElement session times, fallback to OrderItem block times
        if (fpe?.sessionExpiresAt) {
          const expiresAt = new Date(fpe.sessionExpiresAt)
          const remaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60))

          timeInfo = {
            type: 'block',
            startedAt: fpe.sessionStartedAt?.toISOString(),
            expiresAt: fpe.sessionExpiresAt.toISOString(),
            minutesRemaining: remaining,
            isExpired: remaining <= 0,
            isExpiringSoon: remaining > 0 && remaining <= 10,
          }
        } else if (fpe?.sessionStartedAt) {
          // Per-minute billing from FloorPlanElement
          const startedAt = fpe.sessionStartedAt
          const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000 / 60)

          timeInfo = {
            type: 'per_minute',
            startedAt: startedAt.toISOString(),
            minutesElapsed: elapsed,
          }
        } else if (!fpe && menuItem.currentOrderItemId) {
          // Fallback: get timing from OrderItem for items without FloorPlanElement
          const orderItem = orderItemMap.get(menuItem.currentOrderItemId)
          if (orderItem?.blockTimeExpiresAt) {
            const expiresAt = new Date(orderItem.blockTimeExpiresAt)
            const remaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60))

            timeInfo = {
              type: 'block',
              startedAt: orderItem.blockTimeStartedAt?.toISOString(),
              expiresAt: orderItem.blockTimeExpiresAt.toISOString(),
              minutesRemaining: remaining,
              isExpired: remaining <= 0,
              isExpiringSoon: remaining > 0 && remaining <= 10,
            }
          } else if (orderItem?.blockTimeStartedAt) {
            const startedAt = orderItem.blockTimeStartedAt
            const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000 / 60)

            timeInfo = {
              type: 'per_minute',
              startedAt: startedAt.toISOString(),
              minutesElapsed: elapsed,
            }
          }
        }
      }

      // Timed pricing (Json column, already an object)
      const timedPricing = menuItem.timedPricing ?? null

      return {
        id: menuItem.id,  // MenuItem ID (primary identifier)
        elementId: fpe?.id || null,  // FloorPlanElement ID if exists
        menuItemId: menuItem.id,  // for order operations
        name: menuItem.name,
        displayName: fpe?.name || menuItem.name,
        description: menuItem.description || null,
        category: menuItem.category
          ? { id: menuItem.category.id, name: menuItem.category.name }
          : { id: 'uncategorized', name: 'Other' },
        status,
        currentOrder,
        currentOrderItemId: menuItem.currentOrderItemId || null,
        timeInfo,
        waitlistCount: fpe?.waitlistEntries.length || 0,
        waitlist: (fpe?.waitlistEntries || []).map((w) => ({
          id: w.id,
          customerName: w.customerName,
          phoneNumber: w.phone,
          partySize: w.partySize,
          position: w.position,
          status: w.status,
          notes: w.notes,
          createdAt: w.requestedAt.toISOString(),
          requestedAt: w.requestedAt.toISOString(),
          waitMinutes: Math.floor((now.getTime() - w.requestedAt.getTime()) / 1000 / 60),
          elementId: fpe?.id || null,
        })),
        price: Number(menuItem.price),
        timedPricing: timedPricing as { per15Min?: number; per30Min?: number; perHour?: number; minimum?: number } | null,
        blockTimeMinutes: menuItem.blockTimeMinutes || null,
        minimumMinutes: menuItem.minimumMinutes || null,
        maxConcurrentUses: menuItem.maxConcurrentUses || 1,
        currentUseCount: menuItem.currentUseCount || 0,
      }
    })

    const response = NextResponse.json({ data: {
      items,
      serverTime: new Date().toISOString(),
      summary: {
        total: items.length,
        available: items.filter(i => i.status === 'available').length,
        inUse: items.filter(i => i.status === 'in_use').length,
        reserved: items.filter(i => i.status === 'reserved').length,
        maintenance: items.filter(i => i.status === 'maintenance').length,
        totalWaitlist: items.reduce((sum, i) => sum + i.waitlistCount, 0),
      },
    } })

    // Prevent caching of this dynamic data
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    response.headers.set('Pragma', 'no-cache')

    return response
  } catch (error) {
    console.error('Failed to fetch entertainment status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch entertainment status' },
      { status: 500 }
    )
  }
})

// PATCH - Update floor plan element status
export const PATCH = withVenue(async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { elementId, locationId, status, currentOrderId, sessionStartedAt, sessionExpiresAt } = body

    if (!elementId || !locationId) {
      return NextResponse.json(
        { error: 'Element ID and Location ID are required' },
        { status: 400 }
      )
    }

    const validStatuses = ['available', 'in_use', 'reserved', 'maintenance']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    // Verify element belongs to location (multi-tenancy security)
    const element = await db.floorPlanElement.findFirst({
      where: { id: elementId, locationId, deletedAt: null },
    })

    if (!element) {
      return NextResponse.json(
        { error: 'Element not found' },
        { status: 404 }
      )
    }

    const updateData: {
      status?: FloorPlanElementStatus
      currentOrderId?: string | null
      sessionStartedAt?: Date | null
      sessionExpiresAt?: Date | null
    } = {}

    if (status) {
      updateData.status = status as FloorPlanElementStatus
    }

    if (status === 'available') {
      updateData.currentOrderId = null
      updateData.sessionStartedAt = null
      updateData.sessionExpiresAt = null
    } else if (currentOrderId !== undefined) {
      updateData.currentOrderId = currentOrderId
    }

    if (sessionStartedAt !== undefined) {
      updateData.sessionStartedAt = sessionStartedAt ? new Date(sessionStartedAt) : null
    }

    if (sessionExpiresAt !== undefined) {
      updateData.sessionExpiresAt = sessionExpiresAt ? new Date(sessionExpiresAt) : null
    }

    const updatedElement = await db.floorPlanElement.update({
      where: { id: elementId },
      data: updateData,
      select: {
        id: true,
        name: true,
        visualType: true,
        status: true,
        currentOrderId: true,
        sessionStartedAt: true,
        sessionExpiresAt: true,
      },
    })

    // Dispatch real-time update to all connected clients (fire-and-forget)
    dispatchFloorPlanUpdate(locationId, { async: true })

    // If element is linked to a menu item, dispatch entertainment status change
    if (element.linkedMenuItemId && status) {
      dispatchEntertainmentStatusChanged(locationId, {
        itemId: element.linkedMenuItemId,
        entertainmentStatus: status as 'available' | 'in_use' | 'reserved' | 'maintenance',
        currentOrderId: updatedElement.currentOrderId,
        expiresAt: updatedElement.sessionExpiresAt?.toISOString() || null,
      }, { async: true }).catch(() => {})
    }

    return NextResponse.json({
      data: {
        element: updatedElement
      }
    })
  } catch (error) {
    console.error('Failed to update entertainment status:', error)
    return NextResponse.json(
      { error: 'Failed to update entertainment status' },
      { status: 500 }
    )
  }
})
