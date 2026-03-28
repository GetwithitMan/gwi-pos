import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission } from '@/lib/api-auth'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchTabUpdated, dispatchTabStatusUpdate, dispatchOrderClosed, dispatchEntertainmentStatusChanged, dispatchTableStatusChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { OrderRepository } from '@/lib/repositories'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('orders-void-tab')

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

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularVoidTab = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularVoidTab ? 'cloud' : 'local'

    if (!employeeId) {
      return err('Missing required field: employeeId')
    }

    if (!reason) {
      return err('Void reason is required')
    }

    // Phase 1: Read order under FOR UPDATE lock to prevent double-void races
    const lockedRead = await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      const order = await tx.order.findFirst({
        where: { id: orderId, deletedAt: null },
        include: {
          cards: {
            where: { deletedAt: null, status: 'authorized' },
          },
        },
      })

      if (!order) {
        return { error: 'Order not found', status: 404 } as const
      }

      if (order.status === 'voided') {
        return { error: 'Tab already voided', status: 400 } as const
      }

      if (order.cards.length === 0) {
        return { error: 'No authorized cards to void on this tab', status: 400 } as const
      }

      return { order }
    }, { timeout: 15000 })

    if ('error' in lockedRead) {
      return err(lockedRead.error, lockedRead.status)
    }

    const { order } = lockedRead

    // Require manager void permission — voiding a tab is a high-risk financial action
    const authResult = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_VOID_ORDERS)
    if (!authResult.authorized) return err(authResult.error, authResult.status)

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
          data: { status: voided ? 'voided' : card.status, lastMutatedBy: mutationOrigin },
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
    const totalAmount = order.cards.reduce((sum, c) => sum + Number(c.authAmount || 0), 0)

    // Phase 2: Update order + audit log atomically under FOR UPDATE lock
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      // Re-check status inside lock (may have changed since Phase 1)
      const freshOrder = await tx.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: { status: true },
      })
      if (freshOrder?.status === 'voided') {
        throw new Error('Tab already voided')
      }

      await OrderRepository.updateOrder(orderId, locationId, {
        tabStatus: allVoided ? 'closed' : order.tabStatus,
        status: allVoided ? 'voided' : order.status,
        notes: `Tab voided: ${reason}`,
        lastMutatedBy: mutationOrigin,
      }, tx)

      // Audit trail — financial compliance requirement
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId,
          action: 'tab_voided',
          entityType: 'order',
          entityId: orderId,
          details: {
            orderId,
            tabName: order.tabName || order.orderNumber,
            reason,
            cardResults: results,
            totalAmount,
            allVoided,
          },
          ipAddress: request.headers.get('x-forwarded-for'),
          userAgent: request.headers.get('user-agent'),
        },
      })
    }, { timeout: 15000 })

    // Reset table to available when tab is fully voided
    if (allVoided && order.tableId) {
      await db.table.update({
        where: { id: order.tableId },
        data: { status: 'available' },
      })
      void dispatchTableStatusChanged(locationId, { tableId: order.tableId, status: 'available' }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Clean up entertainment items tied to this order
    let cleanedEntertainmentIds: string[] = []
    if (allVoided) {
      try {
        // Find all timed_rental MenuItems currently linked to this order
        const entertainmentItems = await db.menuItem.findMany({
          where: {
            currentOrderId: orderId,
            locationId,
            itemType: 'timed_rental',
          },
          select: { id: true, name: true },
        })

        // Clear blockTimeStartedAt on order items
        // TODO: Complex relation filter (menuItem.itemType) -- raw db with locationId guard
        await db.orderItem.updateMany({
          where: { orderId, locationId, menuItem: { itemType: 'timed_rental' }, blockTimeStartedAt: { not: null } },
          data: { blockTimeStartedAt: null },
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

        // entertainment items cleaned up
      } catch (cleanupErr) {
        console.error('[Tab Void] Failed to clean up entertainment items:', cleanupErr)
      }
    }

    // Fire-and-forget event emission
    if (allVoided) {
      void emitOrderEvent(locationId, orderId, 'ORDER_CLOSED', {
        closedStatus: 'voided',
        reason: reason || 'Tab voided',
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Dispatch socket events for voided tab (fire-and-forget)
    if (allVoided) {
      void dispatchOpenOrdersChanged(locationId, {
        trigger: 'voided',
        orderId,
        tableId: order.tableId || undefined,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.void-tab'))
      void dispatchTabUpdated(locationId, {
        orderId,
        status: 'voided',
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.void-tab'))
      dispatchTabStatusUpdate(locationId, { orderId, status: 'voided' })
      // BUG 3: Dispatch order:closed so Android clients listening for the event learn about voided tabs
      void dispatchOrderClosed(locationId, {
        orderId,
        status: 'voided',
        closedAt: new Date().toISOString(),
        closedByEmployeeId: employeeId,
        locationId,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.void-tab'))
      if (order.tableId) {
        void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
      }
      // Notify entertainment status changes for cleaned-up items
      for (const itemId of cleanedEntertainmentIds) {
        void dispatchEntertainmentStatusChanged(locationId, {
          itemId,
          entertainmentStatus: 'available',
          currentOrderId: null,
          expiresAt: null,
        }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.void-tab'))
        void notifyNextWaitlistEntry(locationId, itemId).catch(err => log.warn({ err }, 'waitlist notify failed'))
      }
      if (cleanedEntertainmentIds.length > 0) {
        void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
      }
    }

    pushUpstream()

    return ok({
        success: allVoided,
        results,
        partialVoid: !allVoided && results.some((r) => r.voided),
      })
  } catch (error) {
    console.error('Failed to void tab:', error)
    return err('Failed to void tab', 500)
  }
})
