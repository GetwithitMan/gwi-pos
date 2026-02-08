import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// GET transfer activity report (from audit logs)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const transferType = searchParams.get('type') // 'tab' | 'item' | 'all'
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || employeeId

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date filter
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {}
    if (startDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, gte: new Date(startDate) }
    }
    if (endDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, lte: new Date(endDate + 'T23:59:59') }
    }

    // Build action filter
    const actions: string[] = []
    if (!transferType || transferType === 'all') {
      actions.push('tab_transferred', 'items_transferred')
    } else if (transferType === 'tab') {
      actions.push('tab_transferred')
    } else if (transferType === 'item') {
      actions.push('items_transferred')
    }

    // Get transfer audit logs
    const transfers = await db.auditLog.findMany({
      where: {
        locationId,
        action: { in: actions },
        ...dateFilter,
        ...(employeeId ? { employeeId } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get all employees for lookup
    const employees = await db.employee.findMany({
      where: { locationId },
      select: {
        id: true,
        displayName: true,
        firstName: true,
        lastName: true,
      },
    })
    const employeeMap = new Map(employees.map(e => [
      e.id,
      e.displayName || `${e.firstName} ${e.lastName}`,
    ]))

    // Initialize summary
    let totalTransfers = 0
    let tabTransfers = 0
    let itemTransfers = 0
    let totalItemsMoved = 0
    let totalTransferAmount = 0

    // Group by employee (who initiated)
    const byEmployee: Record<string, {
      id: string
      name: string
      tabTransfers: number
      itemTransfers: number
      totalItemsMoved: number
      transferAmount: number
    }> = {}

    // Group by day
    const byDay: Record<string, {
      date: string
      tabTransfers: number
      itemTransfers: number
      totalTransfers: number
    }> = {}

    // Group by hour
    const byHour: Record<number, {
      hour: number
      transfers: number
    }> = {}

    // Transfer details
    const transferLogs: {
      id: string
      type: 'tab' | 'item'
      initiatedBy: string
      fromEmployee?: string
      toEmployee?: string
      orderId: string
      orderNumber?: number
      tabName?: string
      itemCount?: number
      amount?: number
      reason?: string
      createdAt: string
    }[] = []

    transfers.forEach(transfer => {
      const details = transfer.details as Record<string, unknown> || {}
      const isTabTransfer = transfer.action === 'tab_transferred'

      totalTransfers += 1

      if (isTabTransfer) {
        tabTransfers += 1
      } else {
        itemTransfers += 1
        const itemCount = (details.itemCount as number) || 0
        totalItemsMoved += itemCount
        const amount = (details.transferAmount as number) || 0
        totalTransferAmount += amount
      }

      // By employee
      const empId = transfer.employeeId || 'unknown'
      const empName = transfer.employee
        ? (transfer.employee.displayName || `${transfer.employee.firstName} ${transfer.employee.lastName}`)
        : 'Unknown'

      if (!byEmployee[empId]) {
        byEmployee[empId] = {
          id: empId,
          name: empName,
          tabTransfers: 0,
          itemTransfers: 0,
          totalItemsMoved: 0,
          transferAmount: 0,
        }
      }

      if (isTabTransfer) {
        byEmployee[empId].tabTransfers += 1
      } else {
        byEmployee[empId].itemTransfers += 1
        byEmployee[empId].totalItemsMoved += (details.itemCount as number) || 0
        byEmployee[empId].transferAmount += (details.transferAmount as number) || 0
      }

      // By day
      const dateKey = transfer.createdAt.toISOString().split('T')[0]
      if (!byDay[dateKey]) {
        byDay[dateKey] = {
          date: dateKey,
          tabTransfers: 0,
          itemTransfers: 0,
          totalTransfers: 0,
        }
      }
      byDay[dateKey].totalTransfers += 1
      if (isTabTransfer) {
        byDay[dateKey].tabTransfers += 1
      } else {
        byDay[dateKey].itemTransfers += 1
      }

      // By hour
      const hour = transfer.createdAt.getHours()
      if (!byHour[hour]) {
        byHour[hour] = { hour, transfers: 0 }
      }
      byHour[hour].transfers += 1

      // Add to transfer logs (limit to 100)
      if (transferLogs.length < 100) {
        if (isTabTransfer) {
          transferLogs.push({
            id: transfer.id,
            type: 'tab',
            initiatedBy: empName,
            fromEmployee: employeeMap.get(details.fromEmployeeId as string) || 'Unknown',
            toEmployee: employeeMap.get(details.toEmployeeId as string) || 'Unknown',
            orderId: transfer.entityId || '',
            orderNumber: details.orderNumber as number,
            tabName: details.tabName as string,
            reason: details.reason as string || undefined,
            createdAt: transfer.createdAt.toISOString(),
          })
        } else {
          transferLogs.push({
            id: transfer.id,
            type: 'item',
            initiatedBy: empName,
            orderId: transfer.entityId || '',
            itemCount: details.itemCount as number,
            amount: details.transferAmount as number,
            createdAt: transfer.createdAt.toISOString(),
          })
        }
      }
    })

    // Format reports
    const employeeReport = Object.values(byEmployee)
      .map(e => ({
        ...e,
        totalTransfers: e.tabTransfers + e.itemTransfers,
        transferAmount: Math.round(e.transferAmount * 100) / 100,
      }))
      .sort((a, b) => b.totalTransfers - a.totalTransfers)

    const dailyReport = Object.values(byDay)
      .sort((a, b) => b.date.localeCompare(a.date))

    const hourlyReport = Object.values(byHour)
      .sort((a, b) => a.hour - b.hour)
      .map(h => ({
        ...h,
        label: `${h.hour.toString().padStart(2, '0')}:00`,
      }))

    return NextResponse.json({
      summary: {
        totalTransfers,
        tabTransfers,
        itemTransfers,
        totalItemsMoved,
        totalTransferAmount: Math.round(totalTransferAmount * 100) / 100,
        avgItemsPerTransfer: itemTransfers > 0
          ? Math.round((totalItemsMoved / itemTransfers) * 100) / 100
          : 0,
      },
      byEmployee: employeeReport,
      byDay: dailyReport,
      byHour: hourlyReport,
      transfers: transferLogs.map(t => ({
        ...t,
        amount: t.amount ? Math.round(t.amount * 100) / 100 : undefined,
      })),
      filters: {
        startDate,
        endDate,
        locationId,
        employeeId,
        type: transferType,
      },
    })
  } catch (error) {
    console.error('Failed to generate transfer report:', error)
    return NextResponse.json(
      { error: 'Failed to generate transfer report' },
      { status: 500 }
    )
  }
}
