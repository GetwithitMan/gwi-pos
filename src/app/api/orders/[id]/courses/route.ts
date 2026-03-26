import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchNewOrder, dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import { OrderRouter } from '@/lib/order-router'
import { printKitchenTicketsForManifests } from '@/lib/print-template-factory'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('orders.id.courses')

// Default course names for display
const DEFAULT_COURSE_NAMES: Record<number, { name: string; color: string }> = {
  0: { name: 'ASAP', color: '#EF4444' },
  1: { name: 'Appetizers', color: '#3B82F6' },
  2: { name: 'Soup/Salad', color: '#10B981' },
  3: { name: 'Entrees', color: '#F59E0B' },
  4: { name: 'Dessert', color: '#EC4899' },
  5: { name: 'After-Dinner', color: '#8B5CF6' },
}

// GET - Get course status for an order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    // Resolve locationId for tenant-safe queries
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    // Tenant-safe order fetch via OrderRepository
    const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
      items: {
        where: { status: 'active', deletedAt: null },
        orderBy: [
          { courseNumber: 'asc' },
          { seatNumber: 'asc' },
        ],
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Get course configuration for this location
    const courseConfigs = await db.courseConfig.findMany({
      where: {
        locationId: order.locationId,
        deletedAt: null,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    })

    // Build course name/color lookup
    const courseInfo: Record<number, { name: string; displayName?: string; color: string }> = { ...DEFAULT_COURSE_NAMES }
    for (const config of courseConfigs) {
      courseInfo[config.courseNumber] = {
        name: config.name,
        displayName: config.displayName || undefined,
        color: config.color || DEFAULT_COURSE_NAMES[config.courseNumber]?.color || '#6B7280',
      }
    }

    // Group items by course
    const courses: Record<number, {
      courseNumber: number
      name: string
      displayName?: string
      color: string
      status: string
      itemCount: number
      firedCount: number
      readyCount: number
      servedCount: number
      heldCount: number
      items: Array<{
        id: string
        name: string
        seatNumber: number | null
        courseStatus: string
        isHeld: boolean
        firedAt: string | null
      }>
    }> = {}

    for (const item of order.items) {
      const courseNum = item.courseNumber || 0
      const info = courseInfo[courseNum] || { name: `Course ${courseNum}`, color: '#6B7280' }

      if (!courses[courseNum]) {
        courses[courseNum] = {
          courseNumber: courseNum,
          name: info.name,
          displayName: info.displayName,
          color: info.color,
          status: 'pending',
          itemCount: 0,
          firedCount: 0,
          readyCount: 0,
          servedCount: 0,
          heldCount: 0,
          items: [],
        }
      }

      courses[courseNum].itemCount++
      if (item.courseStatus === 'fired') courses[courseNum].firedCount++
      if (item.courseStatus === 'ready') courses[courseNum].readyCount++
      if (item.courseStatus === 'served') courses[courseNum].servedCount++
      if (item.isHeld) courses[courseNum].heldCount++

      courses[courseNum].items.push({
        id: item.id,
        name: item.name,
        seatNumber: item.seatNumber,
        courseStatus: item.courseStatus,
        isHeld: item.isHeld,
        firedAt: item.firedAt?.toISOString() || null,
      })
    }

    // Determine course status
    for (const course of Object.values(courses)) {
      if (course.servedCount === course.itemCount) {
        course.status = 'served'
      } else if (course.readyCount === course.itemCount) {
        course.status = 'ready'
      } else if (course.firedCount > 0 || course.items.some(i => i.courseStatus === 'fired')) {
        course.status = 'fired'
      } else if (course.heldCount === course.itemCount) {
        course.status = 'held'
      } else {
        course.status = 'pending'
      }
    }

    return NextResponse.json({ data: {
      orderId,
      currentCourse: order.currentCourse,
      courseMode: order.courseMode,
      courses: Object.values(courses).sort((a, b) => a.courseNumber - b.courseNumber),
    } })
  } catch (error) {
    console.error('Failed to get courses:', error)
    return NextResponse.json(
      { error: 'Failed to get courses' },
      { status: 500 }
    )
  }
})

// POST - Fire a course or update course settings
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { courseNumber, action, courseMode } = body

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularCourse = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularCourse ? 'cloud' : 'local'

    // Resolve locationId for tenant-safe queries
    const postLocationId = await getLocationId()
    if (!postLocationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    // Permission check: POS_ACCESS required for course operations
    const actor = await getActorFromRequest(request)
    const courseEmployeeId = (body as any).employeeId || actor.employeeId
    const courseAuth = await requirePermission(courseEmployeeId, postLocationId, PERMISSIONS.POS_ACCESS)
    if (!courseAuth.authorized) return NextResponse.json({ error: courseAuth.error }, { status: courseAuth.status })

    // Tenant-safe order fetch via OrderRepository
    const order = await OrderRepository.getOrderById(orderId, postLocationId)

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Handle course mode update
    if (action === 'set_mode' && courseMode) {
      if (!['off', 'manual', 'auto'].includes(courseMode)) {
        return NextResponse.json(
          { error: 'Invalid course mode. Use: off, manual, auto' },
          { status: 400 }
        )
      }

      await OrderRepository.updateOrder(orderId, postLocationId, { courseMode, lastMutatedBy: mutationOrigin })

      void dispatchOrderUpdated(order.locationId, { orderId, changes: ['courseMode'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
      void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', { courseMode })

      return NextResponse.json({ data: {
        success: true,
        courseMode,
      } })
    }

    // Handle set current course
    if (action === 'set_current' && courseNumber !== undefined) {
      await OrderRepository.updateOrder(orderId, postLocationId, { currentCourse: courseNumber, lastMutatedBy: mutationOrigin })

      void dispatchOrderUpdated(order.locationId, { orderId, changes: ['currentCourse'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
      void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', { currentCourse: courseNumber })

      return NextResponse.json({ data: {
        success: true,
        currentCourse: courseNumber,
      } })
    }

    // For other actions, courseNumber is required
    if (courseNumber === undefined) {
      return NextResponse.json(
        { error: 'Course number is required' },
        { status: 400 }
      )
    }

    // Wrap batch item updates in a transaction with row-level lock
    const result = await db.$transaction(async (tx) => {
      // Row-level lock to prevent concurrent course mutations
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      switch (action) {
        case 'fire': {
          // Query item IDs before batch update for event emission (tenant-safe)
          const fireItemIds = (await OrderItemRepository.getItemIdsForOrderWhere(orderId, postLocationId, {
            courseNumber, status: 'active', deletedAt: null, courseStatus: 'pending', isHeld: false,
          }, tx)).map(i => i.id)

          // Fire all items in this course (excluding held items unless explicitly including them)
          // Also set kitchenStatus to 'sent' so items route to KDS/kitchen printers
          const firedItems = await OrderItemRepository.updateItemsWhere(orderId, postLocationId, {
            courseNumber,
            status: 'active',
            deletedAt: null,
            courseStatus: 'pending',
            isHeld: false,
          }, {
            courseStatus: 'fired',
            kitchenStatus: 'sent',
            firedAt: new Date(),
            kitchenSentAt: new Date(),
          }, tx)

          // Update current course if this course is higher
          if (courseNumber > order.currentCourse) {
            await OrderRepository.updateOrder(orderId, postLocationId, { currentCourse: courseNumber, lastMutatedBy: mutationOrigin }, tx)
          }

          // Route fired items to KDS stations and print kitchen tickets (fire-and-forget)
          if (fireItemIds.length > 0) {
            void (async () => {
              try {
                const routingResult = await OrderRouter.resolveRouting(orderId, fireItemIds)
                void dispatchNewOrder(order.locationId, routingResult, { async: true }).catch(err =>
                  log.warn({ err }, 'KDS dispatch failed for course fire'))
                void printKitchenTicketsForManifests(routingResult, order.locationId).catch(err =>
                  log.warn({ err }, 'Kitchen print failed for course fire'))
              } catch (err) {
                log.warn({ err }, 'Routing failed for course fire')
              }
            })()
          }

          void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-fired'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
          if (fireItemIds.length > 0) {
            void emitOrderEvents(order.locationId, orderId, fireItemIds.map(id => ({
              type: 'ITEM_UPDATED' as const,
              payload: { lineItemId: id, courseStatus: 'fired', kitchenStatus: 'sent' },
            })))
          }

          return { data: {
            success: true,
            courseNumber,
            itemsFired: firedItems.count,
          } }
        }

        case 'fire_all': {
          // Query item IDs before batch update for event emission (tenant-safe)
          const fireAllItemIds = (await OrderItemRepository.getItemIdsForOrderWhere(orderId, postLocationId, {
            courseNumber, status: 'active', deletedAt: null, courseStatus: { in: ['pending'] },
          }, tx)).map(i => i.id)

          // Fire all items in this course including held items
          // Also set kitchenStatus to 'sent' so items route to KDS/kitchen printers
          const allFiredItems = await OrderItemRepository.updateItemsWhere(orderId, postLocationId, {
            courseNumber,
            status: 'active',
            deletedAt: null,
            courseStatus: { in: ['pending'] },
          }, {
            courseStatus: 'fired',
            kitchenStatus: 'sent',
            firedAt: new Date(),
            kitchenSentAt: new Date(),
            isHeld: false,
          }, tx)

          // Update current course
          if (courseNumber > order.currentCourse) {
            await OrderRepository.updateOrder(orderId, postLocationId, { currentCourse: courseNumber, lastMutatedBy: mutationOrigin }, tx)
          }

          // Route fired items to KDS stations and print kitchen tickets (fire-and-forget)
          if (fireAllItemIds.length > 0) {
            void (async () => {
              try {
                const routingResult = await OrderRouter.resolveRouting(orderId, fireAllItemIds)
                void dispatchNewOrder(order.locationId, routingResult, { async: true }).catch(err =>
                  log.warn({ err }, 'KDS dispatch failed for course fire_all'))
                void printKitchenTicketsForManifests(routingResult, order.locationId).catch(err =>
                  log.warn({ err }, 'Kitchen print failed for course fire_all'))
              } catch (err) {
                log.warn({ err }, 'Routing failed for course fire_all')
              }
            })()
          }

          void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-fired-all'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
          if (fireAllItemIds.length > 0) {
            void emitOrderEvents(order.locationId, orderId, fireAllItemIds.map(id => ({
              type: 'ITEM_UPDATED' as const,
              payload: { lineItemId: id, courseStatus: 'fired', kitchenStatus: 'sent', isHeld: false },
            })))
          }

          return { data: {
            success: true,
            courseNumber,
            itemsFired: allFiredItems.count,
          } }
        }

        case 'hold': {
          // Query item IDs before batch update for event emission (tenant-safe)
          const holdItemIds = (await OrderItemRepository.getItemIdsForOrderWhere(orderId, postLocationId, {
            courseNumber, status: 'active', deletedAt: null, courseStatus: 'pending',
          }, tx)).map(i => i.id)

          // Hold all pending items in this course
          const heldItems = await OrderItemRepository.updateItemsWhere(orderId, postLocationId, {
            courseNumber,
            status: 'active',
            deletedAt: null,
            courseStatus: 'pending',
          }, {
            isHeld: true,
          }, tx)

          void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-held'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
          if (holdItemIds.length > 0) {
            void emitOrderEvents(order.locationId, orderId, holdItemIds.map(id => ({
              type: 'ITEM_UPDATED' as const,
              payload: { lineItemId: id, isHeld: true },
            })))
          }

          return { data: {
            success: true,
            courseNumber,
            itemsHeld: heldItems.count,
          } }
        }

        case 'release': {
          // Query item IDs before batch update for event emission (tenant-safe)
          const releaseItemIds = (await OrderItemRepository.getItemIdsForOrderWhere(orderId, postLocationId, {
            courseNumber, status: 'active', deletedAt: null, isHeld: true,
          }, tx)).map(i => i.id)

          // Release hold on all items in this course
          const releasedItems = await OrderItemRepository.updateItemsWhere(orderId, postLocationId, {
            courseNumber,
            status: 'active',
            deletedAt: null,
            isHeld: true,
          }, {
            isHeld: false,
          }, tx)

          void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-released'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
          if (releaseItemIds.length > 0) {
            void emitOrderEvents(order.locationId, orderId, releaseItemIds.map(id => ({
              type: 'ITEM_UPDATED' as const,
              payload: { lineItemId: id, isHeld: false },
            })))
          }

          return { data: {
            success: true,
            courseNumber,
            itemsReleased: releasedItems.count,
          } }
        }

        case 'mark_ready': {
          // Query item IDs before batch update for event emission (tenant-safe)
          const readyItemIds = (await OrderItemRepository.getItemIdsForOrderWhere(orderId, postLocationId, {
            courseNumber, status: 'active', deletedAt: null, courseStatus: 'fired',
          }, tx)).map(i => i.id)

          // Mark all fired items in course as ready
          const readyItems = await OrderItemRepository.updateItemsWhere(orderId, postLocationId, {
            courseNumber,
            status: 'active',
            deletedAt: null,
            courseStatus: 'fired',
          }, {
            courseStatus: 'ready',
            kitchenStatus: 'ready',
          }, tx)

          void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-ready'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
          if (readyItemIds.length > 0) {
            void emitOrderEvents(order.locationId, orderId, readyItemIds.map(id => ({
              type: 'ITEM_UPDATED' as const,
              payload: { lineItemId: id, courseStatus: 'ready', kitchenStatus: 'ready' },
            })))
          }

          return { data: {
            success: true,
            courseNumber,
            itemsReady: readyItems.count,
          } }
        }

        case 'mark_served': {
          // Query item IDs before batch update for event emission (tenant-safe)
          const servedItemIds = (await OrderItemRepository.getItemIdsForOrderWhere(orderId, postLocationId, {
            courseNumber, status: 'active', deletedAt: null, courseStatus: { in: ['fired', 'ready'] },
          }, tx)).map(i => i.id)

          // Mark all ready items in course as served
          const servedItems = await OrderItemRepository.updateItemsWhere(orderId, postLocationId, {
            courseNumber,
            status: 'active',
            deletedAt: null,
            courseStatus: { in: ['fired', 'ready'] },
          }, {
            courseStatus: 'served',
            kitchenStatus: 'delivered',
          }, tx)

          void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-served'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
          if (servedItemIds.length > 0) {
            void emitOrderEvents(order.locationId, orderId, servedItemIds.map(id => ({
              type: 'ITEM_UPDATED' as const,
              payload: { lineItemId: id, courseStatus: 'served', kitchenStatus: 'delivered' },
            })))
          }

          return { data: {
            success: true,
            courseNumber,
            itemsServed: servedItems.count,
          } }
        }

        default:
          return { error: 'Invalid action. Use: fire, fire_all, hold, release, mark_ready, mark_served, set_mode, set_current', status: 400 }
      }
    })

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to update course:', error)
    return NextResponse.json(
      { error: 'Failed to update course' },
      { status: 500 }
    )
  }
})
