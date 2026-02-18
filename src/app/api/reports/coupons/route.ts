import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date filter for redemptions
    const dateFilter: Record<string, unknown> = {}
    if (startDate || endDate) {
      dateFilter.redeemedAt = {}
      if (startDate) {
        (dateFilter.redeemedAt as Record<string, Date>).gte = new Date(startDate)
      }
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        ;(dateFilter.redeemedAt as Record<string, Date>).lte = end
      }
    }

    // Get all coupons with redemption counts
    const coupons = await prisma.coupon.findMany({
      where: { locationId },
      include: {
        _count: {
          select: { redemptions: true },
        },
        redemptions: {
          where: dateFilter,
          orderBy: { redeemedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get all order IDs from redemptions and fetch orders
    const allRedemptions = coupons.flatMap(c => c.redemptions)
    const orderIds = [...new Set(allRedemptions.map(r => r.orderId))]

    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        createdAt: true,
      },
    })

    const orderMap = Object.fromEntries(orders.map(o => [o.id, o]))

    // Calculate summary stats
    const totalRedemptions = allRedemptions.length
    const totalDiscountGiven = allRedemptions.reduce((sum, r) => sum + Number(r.discountAmount), 0)
    const totalOrderValue = allRedemptions.reduce((sum, r) => {
      const order = orderMap[r.orderId]
      return sum + (order ? Number(order.total) : 0)
    }, 0)

    // Top performing coupons
    const couponStats = coupons.map(coupon => {
      const redemptionCount = coupon.redemptions.length
      const totalDiscount = coupon.redemptions.reduce((sum, r) => sum + Number(r.discountAmount), 0)
      const avgOrderValue = redemptionCount > 0
        ? coupon.redemptions.reduce((sum, r) => {
            const order = orderMap[r.orderId]
            return sum + (order ? Number(order.total) : 0)
          }, 0) / redemptionCount
        : 0

      return {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        discountType: coupon.discountType,
        discountValue: Number(coupon.discountValue),
        isActive: coupon.isActive,
        usageLimit: coupon.usageLimit,
        usageCount: coupon._count.redemptions,
        periodRedemptions: redemptionCount,
        totalDiscount,
        avgOrderValue,
        validFrom: coupon.validFrom,
        validUntil: coupon.validUntil,
      }
    })

    // Daily redemption trend
    const dailyTrend: Record<string, { date: string; count: number; discount: number }> = {}
    allRedemptions.forEach(r => {
      const date = new Date(r.redeemedAt).toISOString().split('T')[0]
      if (!dailyTrend[date]) {
        dailyTrend[date] = { date, count: 0, discount: 0 }
      }
      dailyTrend[date].count++
      dailyTrend[date].discount += Number(r.discountAmount)
    })

    // Redemption by discount type
    const byType = coupons.reduce((acc, c) => {
      const type = c.discountType
      if (!acc[type]) {
        acc[type] = { type, count: 0, discount: 0 }
      }
      c.redemptions.forEach(r => {
        acc[type].count++
        acc[type].discount += Number(r.discountAmount)
      })
      return acc
    }, {} as Record<string, { type: string; count: number; discount: number }>)

    // Recent redemptions list
    const recentRedemptions = allRedemptions
      .slice(0, 50)
      .map(r => {
        const coupon = coupons.find(c => c.id === r.couponId)
        const order = orderMap[r.orderId]
        return {
          id: r.id,
          couponCode: coupon?.code,
          couponName: coupon?.name,
          discountAmount: Number(r.discountAmount),
          orderNumber: order?.orderNumber,
          orderTotal: order ? Number(order.total) : 0,
          redeemedAt: r.redeemedAt,
        }
      })

    return NextResponse.json({
      summary: {
        totalCoupons: coupons.length,
        activeCoupons: coupons.filter(c => c.isActive).length,
        totalRedemptions,
        totalDiscountGiven,
        totalOrderValue,
        avgDiscountPerRedemption: totalRedemptions > 0 ? totalDiscountGiven / totalRedemptions : 0,
      },
      coupons: couponStats.sort((a, b) => b.periodRedemptions - a.periodRedemptions),
      dailyTrend: Object.values(dailyTrend).sort((a, b) => a.date.localeCompare(b.date)),
      byType: Object.values(byType),
      recentRedemptions,
    })
  } catch (error) {
    console.error('Coupon report error:', error)
    return NextResponse.json({ error: 'Failed to generate coupon report' }, { status: 500 })
  }
})
