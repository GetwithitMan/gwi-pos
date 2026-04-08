import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { TabUpdatedPayload, TabTransferCompletePayload, OrdersListChangedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { getLocationId } from '@/lib/location-cache'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

interface TransferRequest {
  toEmployeeId: string
  reason?: string
  fromEmployeeId: string
}

// POST - Transfer a tab to another employee
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tabId } = await params
    const body = await request.json() as TransferRequest

    const { toEmployeeId, reason, fromEmployeeId } = body

    if (!toEmployeeId || !fromEmployeeId) {
      return err('Both source and destination employee IDs are required')
    }

    // Get the tab (order with bar_tab type)
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const tab = await OrderRepository.getOrderByIdWithInclude(tabId, locationId, {
      employee: {
        select: { id: true, displayName: true, firstName: true, lastName: true },
      },
      location: true,
    })

    if (!tab) {
      return notFound('Tab not found')
    }

    if (tab.orderType !== 'bar_tab') {
      return err('This order is not a bar tab')
    }

    const auth = await requirePermission(fromEmployeeId, tab.locationId, PERMISSIONS.MGR_TRANSFER_CHECKS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Guard: destination employee must be permitted to receive transfers
    const receiveAuth = await requirePermission(toEmployeeId, tab.locationId, PERMISSIONS.MGR_RECEIVE_TRANSFERS)
    if (!receiveAuth.authorized) {
      return err(`Destination employee cannot receive transfers: ${receiveAuth.error}`, receiveAuth.status)
    }

    if (tab.status !== 'open' && tab.status !== 'in_progress') {
      return err('Cannot transfer a closed tab')
    }

    if (tab.employeeId !== fromEmployeeId) {
      return forbidden('You can only transfer tabs assigned to you')
    }

    if (tab.employeeId === toEmployeeId) {
      return err('Tab is already assigned to this employee')
    }

    // Get the destination employee
    const toEmployee = await db.employee.findUnique({
      where: { id: toEmployeeId },
      select: { id: true, displayName: true, firstName: true, lastName: true, isActive: true },
    })

    if (!toEmployee) {
      return notFound('Destination employee not found')
    }

    if (!toEmployee.isActive) {
      return err('Cannot transfer to an inactive employee')
    }

    // Wrap tab update + audit log + entertainment item link updates + socket outbox in a single atomic transaction
    const updatedTab = await db.$transaction(async (tx) => {
      const result = await OrderRepository.updateOrderAndReturn(tabId, locationId, {
        employeeId: toEmployeeId,
        notes: tab.notes
          ? `${tab.notes}\n[Transferred from ${tab.employee?.displayName || tab.employee?.firstName || 'Unknown'} to ${toEmployee.displayName || toEmployee.firstName}${reason ? `: ${reason}` : ''}]`
          : `[Transferred from ${tab.employee?.displayName || tab.employee?.firstName || 'Unknown'} to ${toEmployee.displayName || toEmployee.firstName}${reason ? `: ${reason}` : ''}]`,
      } as any, {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
      }, tx) as any
      if (!result) throw new Error(`Tab ${tabId} not found for location ${locationId}`)

      // Update any active entertainment items linked to this tab
      // When a tab transfers, the rental items (pool tables, karaoke, etc.) must follow
      // Keep their session state intact (blockTimeStartedAt, entertainer status) but link to new order
      const entertainmentItems = await tx.menuItem.findMany({
        where: {
          currentOrderId: tabId,
          itemType: 'timed_rental',
          entertainmentStatus: 'in_use',
          deletedAt: null,
        },
        select: { id: true },
      })

      if (entertainmentItems.length > 0) {
        // Link entertainment MenuItems to the new tab (still the same order, but order/tab transfer preserves session)
        await tx.menuItem.updateMany({
          where: {
            currentOrderId: tabId,
            itemType: 'timed_rental',
            deletedAt: null,
          },
          data: {
            // currentOrderId remains tabId (same order), keeping the session intact
            // The entertainer status and block time remain unchanged
          },
        })
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          locationId: tab.locationId,
          employeeId: fromEmployeeId,
          action: 'tab_transferred',
          entityType: 'order',
          entityId: tabId,
          details: {
            fromEmployeeId,
            toEmployeeId,
            tabName: tab.tabName,
            orderNumber: tab.orderNumber,
            reason: reason || null,
            entertainmentItemsFollowed: entertainmentItems.length,
          },
        },
      })

      // Queue critical socket events inside the transaction (outbox pattern)
      const tabPayload: TabUpdatedPayload = { orderId: tabId, status: result.status }
      await queueSocketEvent(tx, tab.locationId, SOCKET_EVENTS.TAB_UPDATED, tabPayload)

      const transferPayload: TabTransferCompletePayload = { orderId: tabId }
      await queueSocketEvent(tx, tab.locationId, SOCKET_EVENTS.TAB_TRANSFER_COMPLETE, transferPayload)

      const listPayload: OrdersListChangedPayload = {
        trigger: 'transferred',
        orderId: tabId,
      }
      await queueSocketEvent(tx, tab.locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)

      return result
    })

    // Transaction committed — flush outbox
    flushOutboxSafe(tab.locationId)
    pushUpstream()

    // Emit order event for event-sourced log (fire-and-forget, non-critical)
    void emitOrderEvent(tab.locationId, tabId, 'ORDER_METADATA_UPDATED', {
      employeeId: toEmployeeId,
    })

    return ok({
      success: true,
      tab: {
        id: updatedTab.id,
        orderNumber: updatedTab.orderNumber,
        tabName: updatedTab.tabName,
        newEmployee: updatedTab.employee ? {
          id: updatedTab.employee.id,
          name: updatedTab.employee.displayName ||
            `${updatedTab.employee.firstName} ${updatedTab.employee.lastName}`,
        } : null,
      },
    })
  } catch (error) {
    console.error('Failed to transfer tab:', error)
    return err('Failed to transfer tab', 500)
  }
})
