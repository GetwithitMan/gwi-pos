import { NextRequest, NextResponse } from 'next/server'
import { FloorPlanElementStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

// Force dynamic rendering - never cache this endpoint
export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET - Get all floor plan entertainment elements with their status
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

    // Get all floor plan elements (entertainment type)
    const elements = await db.floorPlanElement.findMany({
      where: {
        locationId,
        deletedAt: null,
        elementType: 'entertainment',
        isVisible: true,
      },
      include: {
        linkedMenuItem: {
          select: {
            id: true,
            name: true,
            price: true,
            blockTimeMinutes: true,
            timedPricing: true,
            minimumMinutes: true,
          },
        },
        section: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
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
      orderBy: [
        { section: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
      ],
    })

    // Batch-fetch all linked orders instead of N+1 individual queries
    const orderIds = elements
      .filter(el => el.status === 'in_use' && el.currentOrderId)
      .map(el => el.currentOrderId!)

    const linkedOrders = orderIds.length > 0
      ? await db.order.findMany({
          where: { id: { in: orderIds } },
          select: {
            id: true,
            tabName: true,
            orderNumber: true,
            displayNumber: true,
            openedAt: true,
          },
        })
      : []

    const orderMap = new Map(linkedOrders.map(o => [o.id, o]))

    const now = new Date()
    const elementsWithOrders = elements.map((element) => {
      let currentOrder = null
      let timeInfo = null

      if (element.status === 'in_use' && element.currentOrderId) {
        const order = orderMap.get(element.currentOrderId)

        if (order) {
          currentOrder = {
            orderId: order.id,
            tabName: order.tabName || `Order #${order.displayNumber || order.orderNumber}`,
            orderNumber: order.orderNumber,
            displayNumber: order.displayNumber,
          }

          // Calculate time info
          if (element.sessionExpiresAt) {
            const expiresAt = new Date(element.sessionExpiresAt)
            const remaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60))

            timeInfo = {
              type: 'block',
              startedAt: element.sessionStartedAt?.toISOString(),
              expiresAt: element.sessionExpiresAt.toISOString(),
              minutesRemaining: remaining,
              isExpired: remaining <= 0,
              isExpiringSoon: remaining > 0 && remaining <= 10,
            }
          } else if (element.sessionStartedAt) {
            // Per-minute billing - calculate elapsed
            const startedAt = element.sessionStartedAt
            const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000 / 60)

            timeInfo = {
              type: 'per_minute',
              startedAt: startedAt.toISOString(),
              minutesElapsed: elapsed,
            }
          }
        }
      }

      // Timed pricing from linked menu item (Json column, already an object)
      const timedPricing = element.linkedMenuItem?.timedPricing ?? null

      return {
        id: element.id,
        name: element.name,
        abbreviation: element.abbreviation,
        visualType: element.visualType,
        sectionId: element.sectionId,
        section: element.section,
        posX: element.posX,
        posY: element.posY,
        width: element.width,
        height: element.height,
        status: element.status || 'available',
        currentOrder,
        currentOrderId: element.currentOrderId,
        timeInfo,
        waitlistCount: element.waitlistEntries.length,
        waitlist: element.waitlistEntries.map((w) => ({
          id: w.id,
          customerName: w.customerName,
          phone: w.phone,
          partySize: w.partySize,
          position: w.position,
          status: w.status,
          notes: w.notes,
          elementId: element.id,
          requestedAt: w.requestedAt.toISOString(),
          waitMinutes: Math.floor((now.getTime() - w.requestedAt.getTime()) / 1000 / 60),
        })),
        // Linked menu item for pricing
        linkedMenuItem: element.linkedMenuItem ? {
          id: element.linkedMenuItem.id,
          name: element.linkedMenuItem.name,
          price: Number(element.linkedMenuItem.price),
          blockTimeMinutes: element.linkedMenuItem.blockTimeMinutes,
          timedPricing,
          minimumMinutes: element.linkedMenuItem.minimumMinutes,
        } : null,
      }
    })

    const response = NextResponse.json({ data: {
      elements: elementsWithOrders,
      summary: {
        total: elementsWithOrders.length,
        available: elementsWithOrders.filter(i => i.status === 'available').length,
        inUse: elementsWithOrders.filter(i => i.status === 'in_use').length,
        reserved: elementsWithOrders.filter(i => i.status === 'reserved').length,
        maintenance: elementsWithOrders.filter(i => i.status === 'maintenance').length,
        totalWaitlist: elementsWithOrders.reduce((sum, i) => sum + i.waitlistCount, 0),
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
