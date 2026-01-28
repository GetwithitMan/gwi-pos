import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface TransferRequest {
  toEmployeeId: string
  reason?: string
  fromEmployeeId: string
}

// POST - Transfer a tab to another employee
export async function POST(
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
    const tab = await db.order.findUnique({
      where: { id: tabId },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        location: true,
      },
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

    // Update the tab with new employee
    const updatedTab = await db.order.update({
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

    // Log the transfer in audit log
    await db.auditLog.create({
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

    return NextResponse.json({
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
    })
  } catch (error) {
    console.error('Failed to transfer tab:', error)
    return NextResponse.json(
      { error: 'Failed to transfer tab' },
      { status: 500 }
    )
  }
}
