import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// GET - Get void/comp report
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')
    const voidType = searchParams.get('type') // 'item' or 'order'
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VOIDS, { soft: true })
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date range
    const start = startDate ? new Date(startDate) : new Date(new Date().setHours(0, 0, 0, 0))
    const end = endDate ? new Date(endDate) : new Date(new Date().setHours(23, 59, 59, 999))
    end.setHours(23, 59, 59, 999)

    // Build where clause
    const where: {
      order: { locationId: string }
      createdAt: { gte: Date; lte: Date }
      employeeId?: string
      voidType?: string
    } = {
      order: { locationId },
      createdAt: { gte: start, lte: end },
    }

    if (employeeId) {
      where.employeeId = employeeId
    }

    if (voidType) {
      where.voidType = voidType
    }

    // Get void logs
    const voidLogs = await db.voidLog.findMany({
      where,
      include: {
        order: {
          select: {
            orderNumber: true,
            orderType: true,
            tabName: true,
          },
        },
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

    // Get item names for item voids
    const itemIds = voidLogs
      .filter(log => log.itemId)
      .map(log => log.itemId as string)

    const items = await db.orderItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true },
    })

    const itemMap = new Map(items.map(i => [i.id, i.name]))

    // Calculate summary
    const summary = {
      totalVoids: 0,
      totalComps: 0,
      voidAmount: 0,
      compAmount: 0,
      byEmployee: {} as Record<string, { name: string; voids: number; comps: number; amount: number }>,
      byReason: {} as Record<string, { count: number; amount: number }>,
    }

    const logs = voidLogs.map(log => {
      const employeeName = log.employee.displayName ||
        `${log.employee.firstName} ${log.employee.lastName}`

      // Determine if this is a comp or void based on the item status
      // For simplicity, we'll check the reason - comps usually mention "comp", "free", etc.
      const isComp = log.reason.toLowerCase().includes('comp') ||
        log.reason.toLowerCase().includes('free') ||
        log.reason.toLowerCase().includes('employee') ||
        log.reason.toLowerCase().includes('birthday') ||
        log.reason.toLowerCase().includes('vip') ||
        log.reason.toLowerCase().includes('quality')

      const amount = Number(log.amount)

      if (isComp) {
        summary.totalComps++
        summary.compAmount += amount
      } else {
        summary.totalVoids++
        summary.voidAmount += amount
      }

      // By employee
      if (!summary.byEmployee[log.employeeId]) {
        summary.byEmployee[log.employeeId] = {
          name: employeeName,
          voids: 0,
          comps: 0,
          amount: 0,
        }
      }
      if (isComp) {
        summary.byEmployee[log.employeeId].comps++
      } else {
        summary.byEmployee[log.employeeId].voids++
      }
      summary.byEmployee[log.employeeId].amount += amount

      // By reason
      if (!summary.byReason[log.reason]) {
        summary.byReason[log.reason] = { count: 0, amount: 0 }
      }
      summary.byReason[log.reason].count++
      summary.byReason[log.reason].amount += amount

      return {
        id: log.id,
        orderId: log.orderId,
        orderNumber: log.order.orderNumber,
        orderType: log.order.orderType,
        tabName: log.order.tabName,
        voidType: log.voidType,
        itemId: log.itemId,
        itemName: log.itemId ? itemMap.get(log.itemId) : null,
        amount,
        reason: log.reason,
        isComp,
        employeeId: log.employeeId,
        employeeName,
        approvedById: log.approvedById,
        approvedAt: log.approvedAt?.toISOString() || null,
        createdAt: log.createdAt.toISOString(),
      }
    })

    return NextResponse.json({
      logs,
      summary: {
        ...summary,
        byEmployee: Object.values(summary.byEmployee),
        byReason: Object.entries(summary.byReason).map(([reason, data]) => ({
          reason,
          ...data,
        })),
      },
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to fetch void report:', error)
    return NextResponse.json(
      { error: 'Failed to fetch void report' },
      { status: 500 }
    )
  }
}
