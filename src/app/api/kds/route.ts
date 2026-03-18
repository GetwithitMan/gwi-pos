import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { OrderItemRepository } from '@/lib/repositories'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { dispatchPrintWithRetry } from '@/lib/print-retry'
import { dispatchItemStatus, dispatchOrderBumped } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { parseSettings, DEFAULT_SPEED_OF_SERVICE } from '@/lib/settings'
import { dispatchAlert } from '@/lib/alert-service'
import { checkKdsBumpDeliveryAdvance } from '@/lib/delivery/state-machine'

// Throttle entertainment expiry scan — once per 30s, not every KDS poll
let _lastExpiryCheck = 0
const _EXPIRY_INTERVAL = 30_000

// GET - Get orders for KDS display
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const stationId = searchParams.get('stationId')
    const showAll = searchParams.get('showAll') === 'true' // Expo mode
    const cursor = searchParams.get('cursor')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // W2-K3: Lazy expiry for entertainment sessions — fire-and-forget
    // Throttled to every 30s. Runs in background to avoid blocking KDS response.
    const shouldRunExpiry = Date.now() - _lastExpiryCheck > _EXPIRY_INTERVAL
    if (shouldRunExpiry) {
      _lastExpiryCheck = Date.now()
      void (async () => {
        try {
          const expiredItems = await adminDb.orderItem.findMany({
            where: {
              order: { locationId },
              blockTimeExpiresAt: { lte: new Date() },
              kitchenStatus: { not: 'delivered' },
              isCompleted: false,
              deletedAt: null,
            },
            select: { id: true, orderId: true },
          })
          if (expiredItems.length > 0) {
            await OrderItemRepository.updateItemsByIds(
              expiredItems.map(i => i.id),
              locationId!,
              { kitchenStatus: 'delivered', isCompleted: true, completedAt: new Date() },
            )
            // Group expired items by orderId for batched event emission
            const expiredByOrder = new Map<string, string[]>()
            for (const item of expiredItems) {
              dispatchItemStatus(locationId!, {
                orderId: item.orderId,
                itemId: item.id,
                status: 'completed',
                stationId: '',
                updatedBy: 'system',
              }, { async: true }).catch(console.error)
              const list = expiredByOrder.get(item.orderId) || []
              list.push(item.id)
              expiredByOrder.set(item.orderId, list)
            }
            // Event sourcing: emit ITEM_UPDATED for expired entertainment items
            for (const [oid, ids] of expiredByOrder) {
              void emitOrderEvents(locationId!, oid, ids.map(id => ({
                type: 'ITEM_UPDATED' as const,
                payload: { lineItemId: id, kitchenStatus: 'delivered', isCompleted: true },
              }))).catch(err => console.error('[order-events] KDS entertainment expiry emit failed:', err))
            }
          }
        } catch (err) {
          console.error('[KDS] Entertainment expiry check failed:', err)
        }
      })()
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
    // Cursor-based pagination: take 50 at a time for performance at 100+ open orders
    const orders = await adminDb.order.findMany({
      where: {
        locationId,
        // W2-K1: Paid orders only shown for 2 hours to prevent KDS clutter
        OR: [
          { status: { in: ['open', 'in_progress'] } },
          { status: 'paid', paidAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
        ],
        // Only orders with items (sent to kitchen)
        items: { some: {} },
      },
      take: 50,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
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
                itemType: true,
                categoryId: true,
                prepStationId: true,
                allergens: true,
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
                isCustomEntry: true,
                customEntryName: true,
                swapTargetName: true,
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

      // M3: Exclude entertainment/timed_rental items from regular KDS stations.
      // Entertainment items should only appear on entertainment-type stations.
      if (!station || station.stationType !== 'entertainment') {
        filteredItems = filteredItems.filter(item => item.menuItem.itemType !== 'timed_rental')
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
      // Defaults: 10min warning (aging), 20min critical (late)
      // Client recomputes live from createdAt using per-screen config thresholds
      let timeStatus: 'fresh' | 'aging' | 'late' = 'fresh'
      if (elapsedMinutes >= 20) {
        timeStatus = 'late'
      } else if (elapsedMinutes >= 10) {
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
          pricingOptionLabel: item.pricingOptionLabel ?? null,
          specialNotes: item.specialNotes,
          isCompleted: item.isCompleted || false,
          completedAt: item.completedAt?.toISOString() || null,
          kitchenSentAt: item.kitchenSentAt?.toISOString() || null,
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
            isCustomEntry: (mod as any).isCustomEntry ?? false,
            customEntryName: (mod as any).customEntryName ?? null,
            swapTargetName: (mod as any).swapTargetName ?? null,
          })),
          ingredientModifications: item.ingredientModifications.map(ing => ({
            id: ing.id,
            ingredientName: ing.ingredientName,
            modificationType: ing.modificationType as 'no' | 'lite' | 'on_side' | 'extra' | 'swap',
            swappedToModifierName: ing.swappedToModifierName,
          })),
          // Allergen tracking — passed to KDS for display
          allergens: item.menuItem.allergens || [],
        })),
      }
    }).filter(Boolean)

    // Cursor for next page — last order ID from the raw DB result (before filtering)
    const nextCursor = orders.length === 50 ? orders[orders.length - 1].id : null

    return NextResponse.json({ data: {
      orders: kdsOrders,
      nextCursor,
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

    // Resend reason is mandatory — prevents frivolous resends
    if (action === 'resend' && (!resendNote || resendNote.trim().length === 0)) {
      return NextResponse.json(
        { error: 'A resend reason is required' },
        { status: 400 }
      )
    }

    const now = new Date()

    // Resolve locationId from the first item for tenant-scoped operations
    const firstItemForDispatch = await adminDb.orderItem.findUnique({
      where: { id: itemIds[0] },
      select: { orderId: true, order: { select: { locationId: true, employeeId: true } } },
    })
    const locationId = firstItemForDispatch?.order?.locationId

    if (action === 'complete') {
      await OrderItemRepository.updateItemsByIds(itemIds, locationId!, {
        isCompleted: true,
        completedAt: now,
      })
    } else if (action === 'uncomplete') {
      await OrderItemRepository.updateItemsByIds(itemIds, locationId!, {
        isCompleted: false,
        completedAt: null,
      })
    } else if (action === 'bump_order') {
      // Complete all items in the order
      await OrderItemRepository.updateItemsByIds(itemIds, locationId!, {
        isCompleted: true,
        completedAt: now,
      })
    } else if (action === 'resend') {
      // Resend items to kitchen - batch update all at once
      await OrderItemRepository.updateItemsByIds(itemIds, locationId!, {
        resendCount: { increment: 1 },
        lastResentAt: now,
        resendNote: resendNote || null,
        isCompleted: false,
        completedAt: null,
        kitchenStatus: 'pending', // Reset kitchen status so it can be reprinted
      })

      if (firstItemForDispatch?.orderId) {
        // M1: Print resend with try/catch — DB is source of truth, print is best-effort.
        // If print fails, KDS shows RESEND badge but no physical ticket prints.
        try {
          void dispatchPrintWithRetry(
            `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/print/kitchen`,
            { orderId: firstItemForDispatch.orderId, itemIds },
            { locationId: locationId!, employeeId: body.employeeId || null, orderId: firstItemForDispatch.orderId }
          )
        } catch (printErr) {
          console.warn(`[KDS] Resend print failed for order ${firstItemForDispatch.orderId} — KDS shows RESEND badge but no physical ticket:`, printErr)
        }
      }
    }

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
        // Also dispatch per-item kds:item-status so Android terminals (which listen
        // for kds:item-status but not kds:order-bumped) update kitchen status
        for (const iid of itemIds) {
          dispatchItemStatus(locationId, {
            orderId,
            itemId: iid,
            status: 'completed',
            stationId: body.stationId || '',
            updatedBy: body.employeeId || firstItemForDispatch.order.employeeId || '',
          }, { async: true }).catch(err => {
            console.error('Failed to dispatch bump item status:', err)
          })
        }
      } else if (action === 'resend') {
        // W1-K2: Dispatch resend event so all KDS screens re-show the resent items
        for (const iid of itemIds) {
          dispatchItemStatus(locationId, {
            orderId,
            itemId: iid,
            status: 'resent',
            stationId: body.stationId || '',
            updatedBy: body.employeeId || firstItemForDispatch.order.employeeId || '',
          }, { async: true }).catch(err => {
            console.error('Failed to dispatch resend status:', err)
          })
        }
      }

      // Speed-of-service tracking: compute bump times for complete/bump_order
      // Fire-and-forget — calculate timing from kitchenSentAt → completedAt
      // Enhanced: check against goal/warning thresholds and fire alerts
      if (action === 'complete' || action === 'bump_order') {
        void (async () => {
          try {
            const bumpedItems = await OrderItemRepository.getItemsByIdsWithSelect(
              itemIds, locationId!, { id: true, kitchenSentAt: true, completedAt: true },
            )
            const speedOfServiceItems: { itemId: string; seconds: number }[] = []
            for (const item of bumpedItems) {
              if (item.kitchenSentAt && item.completedAt) {
                const seconds = Math.round((item.completedAt.getTime() - item.kitchenSentAt.getTime()) / 1000)
                if (seconds > 0) {
                  speedOfServiceItems.push({ itemId: item.id, seconds })
                }
              }
            }
            if (speedOfServiceItems.length > 0) {
              const avgSeconds = Math.round(speedOfServiceItems.reduce((s, i) => s + i.seconds, 0) / speedOfServiceItems.length)
              const avgMinutes = avgSeconds / 60

              // Load speed-of-service settings for goal/alert comparison
              const location = await db.location.findUnique({
                where: { id: locationId },
                select: { settings: true },
              })
              const settings = parseSettings(location?.settings)
              const sos = settings.speedOfService ?? DEFAULT_SPEED_OF_SERVICE
              const exceededGoal = avgMinutes > sos.goalMinutes

              // Store speed-of-service data in audit log for reporting
              await db.auditLog.create({
                data: {
                  locationId,
                  employeeId: body.employeeId || null,
                  action: 'kds_speed_of_service',
                  entityType: 'order',
                  entityId: orderId,
                  details: {
                    stationId: body.stationId,
                    bumpAction: action,
                    avgSeconds,
                    avgMinutes: Math.round(avgMinutes * 10) / 10,
                    goalMinutes: sos.goalMinutes,
                    exceededGoal,
                    items: speedOfServiceItems,
                  },
                },
              })

              // Fire alert if bump time exceeds warning threshold
              if (sos.alertEnabled && avgMinutes > sos.warningMinutes) {
                void dispatchAlert({
                  severity: 'LOW',
                  errorType: 'slow_ticket',
                  category: 'speed_of_service',
                  message: `Order ${orderId} bumped after ${Math.round(avgMinutes)}m (warning: ${sos.warningMinutes}m)`,
                  locationId,
                  orderId,
                  groupId: `sos-slow-${locationId}`,
                }).catch(console.error)
              }
            }
          } catch (err) {
            console.error('[KDS] Speed-of-service tracking failed:', err)
          }
        })()
      }

      // BUG 20: Fire-and-forget audit trail for KDS actions
      if (action === 'bump_order') {
        void db.auditLog.create({
          data: {
            locationId,
            employeeId: body.employeeId || null,
            action: 'kds_bump',
            entityType: 'order',
            entityId: orderId,
            details: { action, stationId: body.stationId }
          }
        }).catch(err => console.error('[AuditLog] KDS audit failed:', err))
      } else {
        const auditAction = action === 'complete' ? 'kds_complete'
          : action === 'uncomplete' ? 'kds_uncomplete'
          : 'kds_resend'
        // Bulk insert audit logs — single query instead of N individual creates
        void db.auditLog.createMany({
          data: itemIds.map((iid: string) => ({
            locationId,
            employeeId: body.employeeId || null,
            action: auditAction,
            entityType: 'order_item',
            entityId: iid,
            details: { action, stationId: body.stationId },
          })),
        }).catch(err => console.error('[AuditLog] KDS audit failed:', err))
      }

      // Event sourcing: emit ITEM_UPDATED events (fire-and-forget)
      if (action === 'complete' || action === 'bump_order') {
        void emitOrderEvents(locationId, orderId, itemIds.map((id: string) => ({
          type: 'ITEM_UPDATED' as const,
          payload: { lineItemId: id, isCompleted: true },
        })))
      } else if (action === 'uncomplete') {
        void emitOrderEvents(locationId, orderId, itemIds.map((id: string) => ({
          type: 'ITEM_UPDATED' as const,
          payload: { lineItemId: id, isCompleted: false },
        })))
      } else if (action === 'resend') {
        // Need updated resendCount — query then emit
        void (async () => {
          const updated = await OrderItemRepository.getItemsByIdsWithSelect(
            itemIds, locationId!, { id: true, resendCount: true },
          )
          void emitOrderEvents(locationId, orderId, updated.map(item => ({
            type: 'ITEM_UPDATED' as const,
            payload: { lineItemId: item.id, resendCount: item.resendCount || 0, kitchenStatus: 'pending' },
          })))
        })().catch(err => console.error('[order-events] KDS resend emit failed:', err))
      }

      // Delivery auto-advance: preparing → ready_for_pickup when all items bumped
      if (action === 'complete' || action === 'bump_order') {
        void checkKdsBumpDeliveryAdvance(orderId, locationId).catch(console.error)
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
