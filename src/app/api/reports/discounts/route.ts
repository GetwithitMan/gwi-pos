import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET discount usage report
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const discountRuleId = searchParams.get('discountRuleId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES, { soft: true })
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date filter on order
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {}
    if (startDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, gte: new Date(startDate) }
    }
    if (endDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, lte: new Date(endDate + 'T23:59:59') }
    }

    // Get all order discounts with related data
    const orderDiscounts = await db.orderDiscount.findMany({
      where: {
        order: {
          locationId,
          ...dateFilter,
        },
        ...(discountRuleId ? { discountRuleId } : {}),
        ...(employeeId ? { appliedBy: employeeId } : {}),
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            orderType: true,
            subtotal: true,
            total: true,
            createdAt: true,
            employee: {
              select: {
                id: true,
                displayName: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        discountRule: {
          select: {
            id: true,
            name: true,
            discountType: true,
            discountConfig: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get all discount rules for reference
    const discountRules = await db.discountRule.findMany({
      where: { locationId, isActive: true },
      select: {
        id: true,
        name: true,
        discountType: true,
        discountConfig: true,
      },
    })

    // Get employees for grouping
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
    let totalDiscountCount = 0
    let totalDiscountAmount = 0
    let presetDiscountCount = 0
    let customDiscountCount = 0
    let presetDiscountAmount = 0
    let customDiscountAmount = 0

    // Group by discount rule
    const byRule: Record<string, {
      id: string | null
      name: string
      type: string
      count: number
      totalAmount: number
      avgAmount: number
      orders: number[]
    }> = {}

    // Group by employee who applied
    const byEmployee: Record<string, {
      id: string
      name: string
      count: number
      totalAmount: number
      presetCount: number
      customCount: number
    }> = {}

    // Group by day
    const byDay: Record<string, {
      date: string
      count: number
      totalAmount: number
      avgDiscount: number
    }> = {}

    // Group by order type
    const byOrderType: Record<string, {
      type: string
      count: number
      totalAmount: number
    }> = {}

    // Recent discount applications (for detail view)
    const recentDiscounts: {
      id: string
      orderNumber: number
      orderType: string
      discountName: string
      amount: number
      percent: number | null
      reason: string | null
      appliedBy: string
      orderEmployee: string
      isPreset: boolean
      createdAt: string
    }[] = []

    orderDiscounts.forEach(discount => {
      const amount = Number(discount.amount)
      const isPreset = !!discount.discountRuleId

      totalDiscountCount += 1
      totalDiscountAmount += amount

      if (isPreset) {
        presetDiscountCount += 1
        presetDiscountAmount += amount
      } else {
        customDiscountCount += 1
        customDiscountAmount += amount
      }

      // By rule
      const ruleKey = discount.discountRuleId || 'custom'
      const ruleName = discount.discountRule?.name || discount.name || 'Custom Discount'
      const ruleType = discount.discountRule?.discountType || (discount.percent ? 'percent' : 'fixed')

      if (!byRule[ruleKey]) {
        byRule[ruleKey] = {
          id: discount.discountRuleId,
          name: ruleName,
          type: ruleType,
          count: 0,
          totalAmount: 0,
          avgAmount: 0,
          orders: [],
        }
      }
      byRule[ruleKey].count += 1
      byRule[ruleKey].totalAmount += amount
      byRule[ruleKey].orders.push(discount.order.orderNumber)

      // By employee who applied
      const appliedById = discount.appliedBy || discount.order.employee.id
      const appliedByName = employeeMap.get(appliedById) ||
        (discount.order.employee.displayName ||
          `${discount.order.employee.firstName} ${discount.order.employee.lastName}`)

      if (!byEmployee[appliedById]) {
        byEmployee[appliedById] = {
          id: appliedById,
          name: appliedByName,
          count: 0,
          totalAmount: 0,
          presetCount: 0,
          customCount: 0,
        }
      }
      byEmployee[appliedById].count += 1
      byEmployee[appliedById].totalAmount += amount
      if (isPreset) {
        byEmployee[appliedById].presetCount += 1
      } else {
        byEmployee[appliedById].customCount += 1
      }

      // By day
      const dateKey = discount.createdAt.toISOString().split('T')[0]
      if (!byDay[dateKey]) {
        byDay[dateKey] = {
          date: dateKey,
          count: 0,
          totalAmount: 0,
          avgDiscount: 0,
        }
      }
      byDay[dateKey].count += 1
      byDay[dateKey].totalAmount += amount

      // By order type
      const orderType = discount.order.orderType
      if (!byOrderType[orderType]) {
        byOrderType[orderType] = {
          type: orderType,
          count: 0,
          totalAmount: 0,
        }
      }
      byOrderType[orderType].count += 1
      byOrderType[orderType].totalAmount += amount

      // Add to recent discounts (limit to 100)
      if (recentDiscounts.length < 100) {
        recentDiscounts.push({
          id: discount.id,
          orderNumber: discount.order.orderNumber,
          orderType: discount.order.orderType,
          discountName: ruleName,
          amount,
          percent: discount.percent ? Number(discount.percent) : null,
          reason: discount.reason,
          appliedBy: appliedByName,
          orderEmployee: discount.order.employee.displayName ||
            `${discount.order.employee.firstName} ${discount.order.employee.lastName}`,
          isPreset,
          createdAt: discount.createdAt.toISOString(),
        })
      }
    })

    // Calculate averages
    Object.values(byRule).forEach(rule => {
      rule.avgAmount = rule.count > 0 ? rule.totalAmount / rule.count : 0
    })
    Object.values(byDay).forEach(day => {
      day.avgDiscount = day.count > 0 ? day.totalAmount / day.count : 0
    })

    // Format reports
    const ruleReport = Object.values(byRule)
      .map(r => ({
        ...r,
        totalAmount: Math.round(r.totalAmount * 100) / 100,
        avgAmount: Math.round(r.avgAmount * 100) / 100,
        orders: undefined, // Don't include order list in response
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)

    const employeeReport = Object.values(byEmployee)
      .map(e => ({
        ...e,
        totalAmount: Math.round(e.totalAmount * 100) / 100,
        avgPerDiscount: e.count > 0 ? Math.round((e.totalAmount / e.count) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)

    const dailyReport = Object.values(byDay)
      .map(d => ({
        ...d,
        totalAmount: Math.round(d.totalAmount * 100) / 100,
        avgDiscount: Math.round(d.avgDiscount * 100) / 100,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))

    const orderTypeReport = Object.values(byOrderType)
      .map(ot => ({
        ...ot,
        totalAmount: Math.round(ot.totalAmount * 100) / 100,
        avgPerOrder: ot.count > 0 ? Math.round((ot.totalAmount / ot.count) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)

    return NextResponse.json({
      summary: {
        totalDiscountCount,
        totalDiscountAmount: Math.round(totalDiscountAmount * 100) / 100,
        presetDiscountCount,
        presetDiscountAmount: Math.round(presetDiscountAmount * 100) / 100,
        customDiscountCount,
        customDiscountAmount: Math.round(customDiscountAmount * 100) / 100,
        avgDiscountAmount: totalDiscountCount > 0
          ? Math.round((totalDiscountAmount / totalDiscountCount) * 100) / 100
          : 0,
        presetVsCustomRatio: totalDiscountCount > 0
          ? Math.round((presetDiscountCount / totalDiscountCount) * 100)
          : 0,
      },
      byRule: ruleReport,
      byEmployee: employeeReport,
      byDay: dailyReport,
      byOrderType: orderTypeReport,
      recentDiscounts: recentDiscounts.map(d => ({
        ...d,
        amount: Math.round(d.amount * 100) / 100,
      })),
      availableRules: discountRules.map(r => {
        const config = r.discountConfig as Record<string, unknown> || {}
        return {
          id: r.id,
          name: r.name,
          type: r.discountType,
          value: config.percent || config.amount || 0,
        }
      }),
      filters: {
        startDate,
        endDate,
        locationId,
        employeeId,
        discountRuleId,
      },
    })
  } catch (error) {
    console.error('Failed to generate discount report:', error)
    return NextResponse.json(
      { error: 'Failed to generate discount report' },
      { status: 500 }
    )
  }
})
