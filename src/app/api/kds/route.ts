import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderItemRepository } from '@/lib/repositories'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { dispatchPrintWithRetry } from '@/lib/print-retry'
import { dispatchItemStatus, dispatchOrderBumped } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { parseSettings, DEFAULT_SPEED_OF_SERVICE } from '@/lib/settings'
import { dispatchAlert } from '@/lib/alert-service'
import { checkKdsBumpDeliveryAdvance } from '@/lib/delivery/state-machine'
import { processScreenLinks, screenHasForwardTargets } from '@/lib/kds/screen-links'
import { sendSMS, isTwilioConfigured, formatPhoneE164 } from '@/lib/twilio'
import { getReadinessState } from '@/lib/readiness'
import { mergeOrderBehavior } from '@/lib/kds/defaults'

// Circuit breaker: suppress repeated DeliveryOrder queries when table is missing.
// Resets on process restart (when migration 108 creates the table).
let deliveryTableMissing = false

/** Sentinel error: DB lookup failed during BOOT/degraded — caller should return 503. */
class KdsDbUnavailableError extends Error {
  constructor() { super('KDS DB unavailable during boot/degraded state') }
}

/**
 * Validate a KDS device token from request headers.
 * Checks x-device-token header, kds_device_token cookie, or Bearer token against KDSScreen.deviceToken.
 * Returns the screen's locationId if valid, null otherwise.
 * Throws KdsDbUnavailableError if a valid token was provided but DB is unreachable (BOOT/DEGRADED).
 */
async function validateKdsDeviceToken(request: NextRequest): Promise<{ locationId: string; screenId: string } | null> {
  const headerToken = request.headers.get('x-device-token')
  const cookieToken = request.cookies.get('kds_device_token')?.value
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const deviceToken = headerToken || cookieToken || bearerToken

  if (!deviceToken || typeof deviceToken !== 'string') return null

  try {
    const screen = await db.kDSScreen.findFirst({
      where: { deviceToken, deletedAt: null, isActive: true },
      select: { id: true, locationId: true },
    })
    if (screen) {
      return { locationId: screen.locationId, screenId: screen.id }
    }
  } catch (err) {
    // DB lookup failed — if server is in BOOT/DEGRADED/FAILED, signal 503 instead of
    // falling through to employee auth (which KDS devices don't have credentials for).
    const readiness = getReadinessState()
    const level = readiness?.level ?? 'BOOT' // null state = pre-boot
    if (level === 'BOOT' || level === 'DEGRADED' || level === 'FAILED') {
      console.warn(`[KDS] validateKdsDeviceToken DB error at readiness=${level}:`, err)
      throw new KdsDbUnavailableError()
    }
    // At SYNC/ORDERS level the DB should be up — this is a real error, fall through to employee auth
    console.error('[KDS] validateKdsDeviceToken DB error at readiness=', level, err)
  }
  return null
}

// GET - Get orders for KDS display
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const stationId = searchParams.get('stationId')
    const showAll = searchParams.get('showAll') === 'true' // Expo mode
    const cursor = searchParams.get('cursor')
    const screenId = searchParams.get('screenId') // KDS Overhaul: for forwarded-item queries
    const includePager = searchParams.get('includePager') !== 'false' // Default: include pagerNumber when present

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Entertainment expiry is handled by the cron job (single source of truth).
    // Previously duplicated here with throttle — removed to avoid dual-write issues.

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

    // KDS Overhaul: Apply order-type filters + auto-expiry from screen config
    let orderTypeFilter: string[] | undefined
    let autoExpireCutoff: Date | undefined
    if (screenId) {
      const screen = await db.kDSScreen.findUnique({
        where: { id: screenId },
        select: { orderTypeFilters: true, orderBehavior: true },
      })
      const filters = screen?.orderTypeFilters as Record<string, boolean> | null
      if (filters) {
        const hiddenTypes = Object.entries(filters).filter(([, v]) => v === false).map(([k]) => k)
        if (hiddenTypes.length > 0) {
          orderTypeFilter = hiddenTypes
        }
      }
      // Auto-expiry: hide orders older than autoExpireMinutes from the KDS display
      const behavior = mergeOrderBehavior(screen?.orderBehavior as Partial<import('@/lib/kds/types').KDSOrderBehavior> | null)
      if (behavior.autoExpireMinutes > 0) {
        autoExpireCutoff = new Date(Date.now() - behavior.autoExpireMinutes * 60 * 1000)
      }
    } else {
      // No screenId — apply a sensible global default (5 hours) to prevent unbounded growth
      const defaultExpireMs = 300 * 60 * 1000 // 5 hours
      autoExpireCutoff = new Date(Date.now() - defaultExpireMs)
    }

    // Get orders that have been sent to kitchen (including paid orders with incomplete items)
    // Cursor-based pagination: take 50 at a time for performance at 100+ open orders
    const orders = await db.order.findMany({
      where: {
        locationId,
        // W2-K1: Paid orders only shown for 2 hours to prevent KDS clutter
        OR: [
          { status: { in: ['open', 'in_progress'] } },
          { status: 'paid', paidAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
        ],
        // Only orders with items (sent to kitchen)
        items: { some: {} },
        // KDS Overhaul: Server-side order-type filter
        ...(orderTypeFilter ? { orderType: { notIn: orderTypeFilter } } : {}),
        // Auto-expiry: exclude orders older than autoExpireMinutes to prevent stale tickets
        ...(autoExpireCutoff ? { createdAt: { gte: autoExpireCutoff } } : {}),
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
            // KDS Overhaul: If screenId provided, use forwarding-aware filter
            // Show items forwarded to this screen that aren't final-completed,
            // OR normal unfinished items (for non-forwarding screens)
            ...(screenId
              ? {
                  OR: [
                    // Items forwarded TO this screen (Expo view)
                    { kdsForwardedToScreenId: screenId, kdsFinalCompleted: false },
                    // Normal items not yet completed (Kitchen view)
                    ...(showAll ? [] : [{ isCompleted: false, kdsForwardedToScreenId: null }]),
                    ...(showAll ? [{}] : []),
                  ],
                }
              : showAll ? {} : { isCompleted: false }
            ),
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
                isNoneSelection: true,
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

    // Batch-fetch delivery info for all orders in a single query
    const orderIds = orders.map(o => o.id)
    let deliveryInfoMap: Record<string, { customerName: string | null; phone: string | null; address: string | null; notes: string | null }> = {}
    if (orderIds.length > 0 && !deliveryTableMissing) {
      try {
        const deliveryRows: Array<{ orderId: string; customerName: string | null; phone: string | null; address: string | null; addressLine2: string | null; city: string | null; state: string | null; zipCode: string | null; notes: string | null }> = await db.$queryRawUnsafe(
          `SELECT "orderId", "customerName", "phone", "address", "addressLine2", "city", "state", "zipCode", "notes"
           FROM "DeliveryOrder"
           WHERE "orderId" = ANY($1::text[])`,
          orderIds
        )
        for (const row of deliveryRows) {
          if (row.orderId) {
            // Build full address from components
            const addressParts = [row.address, row.addressLine2, row.city, row.state, row.zipCode].filter(Boolean)
            deliveryInfoMap[row.orderId] = {
              customerName: row.customerName,
              phone: row.phone,
              address: addressParts.length > 0 ? addressParts.join(', ') : null,
              notes: row.notes,
            }
          }
        }
      } catch (err: any) {
        // If table doesn't exist, suppress future attempts until next restart
        if (err?.message?.includes('does not exist') || err?.code === '42P01') {
          deliveryTableMissing = true
          console.warn('[KDS] DeliveryOrder table missing — delivery info disabled until restart or migration 108 runs')
        } else {
          // Non-fatal: delivery info is supplementary
          console.warn('[KDS] Failed to fetch delivery info:', err)
        }
      }
    }

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

      // Resolve delivery info for this order
      const deliveryInfo = deliveryInfoMap[order.id]

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
        // Notification pager info — included by default, opt out with ?includePager=false
        ...(includePager && (order as any).pagerNumber ? { pagerNumber: (order as any).pagerNumber } : {}),
        // Delivery customer info (from DeliveryOrder table)
        customerName: deliveryInfo?.customerName || null,
        customerPhone: deliveryInfo?.phone || null,
        deliveryAddress: deliveryInfo?.address || null,
        deliveryInstructions: deliveryInfo?.notes || null,
        source: order.source || null,
        items: filteredItems.map(item => ({
          id: item.id,
          name: item.menuItem.name,
          quantity: item.quantity,
          categoryName: item.menuItem.category?.name,
          pricingOptionLabel: item.pricingOptionLabel ?? null,
          specialNotes: item.specialNotes,
          isCompleted: item.isCompleted || false,
          completedAt: item.completedAt?.toISOString() || null,
          completedBy: item.completedBy || null,
          kdsForwardedToScreenId: item.kdsForwardedToScreenId || null,
          kdsFinalCompleted: item.kdsFinalCompleted || false,
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
            isCustomEntry: mod.isCustomEntry ?? false,
            isNoneSelection: mod.isNoneSelection ?? false,
            customEntryName: mod.customEntryName ?? null,
            swapTargetName: mod.swapTargetName ?? null,
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
    // If server is booting/degraded, return 503 so KDS retries gracefully
    const readiness = getReadinessState()
    const level = readiness?.level ?? 'BOOT'
    if (level === 'BOOT' || level === 'DEGRADED' || level === 'FAILED') {
      console.warn(`[KDS] GET failed at readiness=${level}:`, error)
      return NextResponse.json(
        { error: 'Server is starting up. KDS will retry automatically.', code: 'SERVER_BOOTING' },
        { status: 503, headers: { 'Retry-After': '5' } }
      )
    }
    console.error('Failed to fetch KDS orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch KDS orders' },
      { status: 500 }
    )
  }
})

// PUT - Mark item(s) as complete (bump) or resend
// Accepts KDS device token auth (x-device-token header, kds_device_token cookie, or Bearer token)
// OR standard employee auth (withAuth('ADMIN')) for POS web UI bumps.
const putHandler = async function PUT(request: NextRequest) {
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
    const firstItemForDispatch = await db.orderItem.findUnique({
      where: { id: itemIds[0] },
      select: { orderId: true, order: { select: { locationId: true, employeeId: true, status: true } } },
    })
    const locationId = firstItemForDispatch?.order?.locationId

    // Guard: reject bumps on voided/cancelled orders
    const orderStatus = firstItemForDispatch?.order?.status
    if (orderStatus === 'voided' || orderStatus === 'cancelled') {
      return NextResponse.json(
        { error: `Cannot modify items on a ${orderStatus} order` },
        { status: 400 }
      )
    }

    // Resolve bumpedBy for completedBy field
    const bumpedBy = body.employeeId || firstItemForDispatch?.order?.employeeId || 'unknown'
    const screenId = body.screenId as string | undefined

    // Double-bump guard: check if items are already completed (idempotency)
    let isDoubleBump = false
    if (action === 'complete' || action === 'bump_order') {
      const alreadyCompleted = await db.orderItem.count({
        where: { id: { in: itemIds }, isCompleted: true },
      })
      if (alreadyCompleted === itemIds.length) {
        isDoubleBump = true // All items already done — skip side effects but return success
      }
    }

    // KDS Overhaul: Determine if this screen has forward targets (intermediate vs final bump)
    // IMPORTANT: Check BEFORE item update to avoid race condition — if a screen link is
    // deleted between the update and this check, the intermediate flag would be wrong.
    let isIntermediateBump = false
    if (screenId && (action === 'complete' || action === 'bump_order')) {
      try {
        isIntermediateBump = await screenHasForwardTargets(screenId, locationId!)
      } catch (err) {
        console.error('[KDS] Failed to check forward targets:', err)
        // Fail open: treat as final bump if check fails
      }
    }

    if (action === 'complete') {
      await OrderItemRepository.updateItemsByIds(itemIds, locationId!, {
        isCompleted: true,
        completedAt: now,
        completedBy: bumpedBy,
      })
    } else if (action === 'uncomplete') {
      await OrderItemRepository.updateItemsByIds(itemIds, locationId!, {
        isCompleted: false,
        completedAt: null,
        completedBy: null,
      })
    } else if (action === 'bump_order') {
      // Complete all items in the order
      await OrderItemRepository.updateItemsByIds(itemIds, locationId!, {
        isCompleted: true,
        completedAt: now,
        completedBy: bumpedBy,
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

      // KDS Overhaul: Fire-and-forget screen link processing after bump commits
      // Skip all side effects on double-bump (items already completed)
      if (screenId && (action === 'complete' || action === 'bump_order') && !isDoubleBump) {
        void processScreenLinks(locationId, {
          orderId,
          itemIds,
          sourceScreenId: screenId,
          action,
          bumpedBy,
        }).catch(err => console.error('[KDS] Screen link processing failed:', err))
      }

      if (action === 'complete' || action === 'uncomplete') {
        // For uncomplete: always dispatch (it's a recall, not a forward)
        // For complete: only dispatch terminal events if this is a FINAL bump
        if (action === 'uncomplete' || !isIntermediateBump) {
          for (const iid of itemIds) {
            dispatchItemStatus(locationId, {
              orderId,
              itemId: iid,
              status: action === 'complete' ? 'completed' : 'active',
              stationId: body.stationId || '',
              updatedBy: bumpedBy,
            }, { async: true }).catch(err => {
              console.error('Failed to dispatch item status:', err)
            })
          }
        }
      } else if (action === 'bump_order') {
        // Only emit terminal "Made" / order bumped if this is a FINAL bump
        if (!isIntermediateBump) {
          dispatchOrderBumped(locationId, {
            orderId,
            stationId: body.stationId || '',
            bumpedBy,
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
              updatedBy: bumpedBy,
            }, { async: true }).catch(err => {
              console.error('Failed to dispatch bump item status:', err)
            })
          }
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

      // Phase 9: Print on bump — fire-and-forget print when configured and this is a final bump
      if ((action === 'complete' || action === 'bump_order') && !isIntermediateBump && !isDoubleBump && screenId) {
        void (async () => {
          try {
            const screen = await db.kDSScreen.findUnique({
              where: { id: screenId },
              select: { orderBehavior: true },
            })
            const behavior = screen?.orderBehavior as { printOnBump?: boolean } | null
            if (behavior?.printOnBump) {
              void dispatchPrintWithRetry(
                `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/print/kitchen`,
                { orderId, itemIds },
                { locationId, employeeId: body.employeeId || null, orderId }
              )
            }
          } catch (err) {
            console.error('[KDS] Print-on-bump check failed:', err)
          }
        })()
      }

      // W2: Phase 8: Notification Platform — order_ready on final bump
      // notifyEvent is now awaited in the same try/catch as the bump update to prevent lost notifications
      if ((action === 'bump_order') && !isIntermediateBump && !isDoubleBump) {
        try {
          // Look up order info for notification context
          const order = await db.order.findUnique({
            where: { id: orderId },
            select: {
              orderNumber: true,
              orderType: true,
              pagerNumber: true,
              tabName: true,
              customer: { select: { phone: true, firstName: true } },
            },
          })
          if (order) {
            // Look up pagerNumber from target assignment (source of truth)
            let pagerNumber: string | null = order.pagerNumber || null
            try {
              const pagerResult: any[] = await db.$queryRawUnsafe(
                `SELECT "targetValue" FROM "NotificationTargetAssignment"
                 WHERE "locationId" = $1
                   AND "subjectType" = 'order'
                   AND "subjectId" = $2
                   AND status = 'active'
                   AND "targetType" IN ('guest_pager', 'staff_pager')
                 ORDER BY "isPrimary" DESC LIMIT 1`,
                locationId, orderId
              )
              if (pagerResult[0]?.targetValue) {
                pagerNumber = pagerResult[0].targetValue
              }
            } catch { /* non-fatal */ }

            // Try notification platform first (notifyEvent enqueues a job — fast INSERT)
            let usedNotificationPlatform = false
            try {
              const { notifyEvent } = await import('@/lib/notifications/dispatcher')
              const version = order.orderNumber || 1
              await notifyEvent({
                locationId,
                eventType: 'order_ready' as any,
                subjectType: 'order',
                subjectId: orderId,
                subjectVersion: version,
                sourceSystem: 'kds',
                sourceEventId: `kds_bump:${orderId}:${screenId}:${version}`,
                dispatchOrigin: 'automatic',
                businessStage: 'initial_ready' as any,
                contextSnapshot: {
                  orderNumber: order.orderNumber,
                  orderType: order.orderType,
                  pagerNumber,
                  tabName: order.tabName,
                  customerName: order.customer?.firstName || null,
                  customerPhone: order.customer?.phone || null,
                },
              })
              usedNotificationPlatform = true
            } catch {
              // Dispatcher not available — fall back to legacy SMS
            }

            // Legacy fallback: direct Twilio SMS (best-effort, fire-and-forget)
            if (!usedNotificationPlatform && screenId && isTwilioConfigured()) {
              void (async () => {
                try {
                  const screen = await db.kDSScreen.findUnique({
                    where: { id: screenId },
                    select: { orderBehavior: true },
                  })
                  const behavior = screen?.orderBehavior as { sendSmsOnReady?: boolean } | null
                  if (!behavior?.sendSmsOnReady) return
                  if (!order.customer?.phone) return

                  const phone = formatPhoneE164(order.customer.phone)
                  if (!phone) return

                  const name = order.customer.firstName || 'there'
                  await sendSMS({
                    to: phone,
                    body: `Hi ${name}! Your order #${order.orderNumber} is ready${order.orderType === 'takeout' ? ' for pickup' : ''}. Thank you!`,
                  })
                } catch (smsErr) {
                  console.error('[KDS] Legacy SMS-on-ready failed:', smsErr)
                }
              })()
            }
          }
        } catch (err) {
          console.error('[KDS] Notification/SMS-on-ready failed:', err)
        }
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
}

// Auth wrapper: try KDS device token first, fall back to employee auth (ADMIN permission)
const authWrappedPut = withAuth('ADMIN', putHandler as any)
export const PUT = withVenue(async function PUT(request: NextRequest) {
  // Check KDS device token auth first (x-device-token, cookie, or Bearer)
  try {
    const kdsAuth = await validateKdsDeviceToken(request)
    if (kdsAuth) {
      // Valid KDS device — proceed directly without employee permission check
      return putHandler(request)
    }
  } catch (err) {
    if (err instanceof KdsDbUnavailableError) {
      // Server is booting/degraded — tell KDS to retry instead of returning 401
      return NextResponse.json(
        { error: 'Server is starting up. KDS will retry automatically.', code: 'SERVER_BOOTING' },
        { status: 503, headers: { 'Retry-After': '5' } }
      )
    }
    throw err
  }
  // Fall back to standard employee auth (POS web UI bumps)
  return authWrappedPut(request)
})
