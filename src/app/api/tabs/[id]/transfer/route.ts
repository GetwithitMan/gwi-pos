import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { TabUpdatedPayload, TabTransferCompletePayload, OrdersListChangedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushSocketOutbox } from '@/lib/socket-outbox'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { getLocationId } from '@/lib/location-cache'

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
      return NextResponse.json(
        { error: 'Both source and destination employee IDs are required' },
        { status: 400 }
      )
    }

    // Get the tab (order with bar_tab type)
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const tab = await OrderRepository.getOrderByIdWithInclude(tabId, locationId, {
      employee: {
        select: { id: true, displayName: true, firstName: true, lastName: true },
      },
      location: true,
    })

    if (!tab) {
      return NextResponse.json(
        { error: 'Tab not found' },
        { status: 404 }
      )
    }

    if (tab.orderType !== 'bar_tab') {
      return NextResponse.json(
        { error: 'This order is not a bar tab' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(fromEmployeeId, tab.locationId, PERMISSIONS.MGR_TRANSFER_CHECKS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Guard: destination employee must be permitted to receive transfers
    const receiveAuth = await requirePermission(toEmployeeId, tab.locationId, PERMISSIONS.MGR_RECEIVE_TRANSFERS)
    if (!receiveAuth.authorized) {
      return NextResponse.json(
        { error: `Destination employee cannot receive transfers: ${receiveAuth.error}` },
        { status: receiveAuth.status }
      )
    }

    if (tab.status !== 'open' && tab.status !== 'in_progress') {
      return NextResponse.json(
        { error: 'Cannot transfer a closed tab' },
        { status: 400 }
      )
    }

    if (tab.employeeId !== fromEmployeeId) {
      return NextResponse.json(
        { error: 'You can only transfer tabs assigned to you' },
        { status: 403 }
      )
    }

    if (tab.employeeId === toEmployeeId) {
      return NextResponse.json(
        { error: 'Tab is already assigned to this employee' },
        { status: 400 }
      )
    }

    // Get the destination employee
    const toEmployee = await db.employee.findUnique({
      where: { id: toEmployeeId },
      select: { id: true, displayName: true, firstName: true, lastName: true, isActive: true },
    })

    if (!toEmployee) {
      return NextResponse.json(
        { error: 'Destination employee not found' },
        { status: 404 }
      )
    }

    if (!toEmployee.isActive) {
      return NextResponse.json(
        { error: 'Cannot transfer to an inactive employee' },
        { status: 400 }
      )
    }

    // Wrap tab update + audit log + socket outbox in a single atomic transaction
    const updatedTab = await db.$transaction(async (tx) => {
      // TODO: Phase 2 — extract into OrderRepository.updateOrderAndReturn() once tx-passthrough is finalized
      const result = await tx.order.update({
        where: { id: tabId },
        data: {
          employeeId: toEmployeeId,
          notes: tab.notes
            ? `${tab.notes}\n[Transferred from ${tab.employee.displayName || tab.employee.firstName} to ${toEmployee.displayName || toEmployee.firstName}${reason ? `: ${reason}` : ''}]`
            : `[Transferred from ${tab.employee.displayName || tab.employee.firstName} to ${toEmployee.displayName || toEmployee.firstName}${reason ? `: ${reason}` : ''}]`,
        },
        include: {
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
        },
      })

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
    void flushSocketOutbox(tab.locationId).catch((err) => {
      console.warn('[tabs/transfer] Outbox flush failed, catch-up will deliver:', err)
    })

    // Emit order event for event-sourced log (fire-and-forget, non-critical)
    void emitOrderEvent(tab.locationId, tabId, 'ORDER_METADATA_UPDATED', {
      employeeId: toEmployeeId,
    })

    return NextResponse.json({ data: {
      success: true,
      tab: {
        id: updatedTab.id,
        orderNumber: updatedTab.orderNumber,
        tabName: updatedTab.tabName,
        newEmployee: {
          id: updatedTab.employee.id,
          name: updatedTab.employee.displayName ||
            `${updatedTab.employee.firstName} ${updatedTab.employee.lastName}`,
        },
      },
    } })
  } catch (error) {
    console.error('Failed to transfer tab:', error)
    return NextResponse.json(
      { error: 'Failed to transfer tab' },
      { status: 500 }
    )
  }
})
