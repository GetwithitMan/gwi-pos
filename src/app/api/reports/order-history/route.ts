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
    const status = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const customerId = searchParams.get('customerId')
    const search = searchParams.get('search')
    const orderType = searchParams.get('orderType')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW, { soft: true })
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build where clause
    const where: Record<string, unknown> = {
      locationId,
    }

    // Date range
    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) {
        (where.createdAt as Record<string, Date>).gte = new Date(startDate)
      }
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        ;(where.createdAt as Record<string, Date>).lte = end
      }
    }

    // Status filter
    if (status) {
      where.status = status
    }

    // Employee filter
    if (employeeId) {
      where.employeeId = employeeId
    }

    // Customer filter
    if (customerId) {
      where.customerId = customerId
    }

    // Order type filter
    if (orderType) {
      where.orderType = orderType
    }

    // Search by order number or table name
    if (search) {
      const searchNum = parseInt(search)
      if (!isNaN(searchNum)) {
        where.orderNumber = searchNum
      } else {
        where.OR = [
          { tableName: { contains: search } },
          { tabName: { contains: search } },
          { customer: { firstName: { contains: search } } },
          { customer: { lastName: { contains: search } } },
        ]
      }
    }

    // Run all 5 queries in parallel (they're independent reads)
    const [totalCount, orders, stats, statusBreakdown, typeBreakdown, paymentBreakdown] = await Promise.all([
      // 1. Total count
      prisma.order.count({ where }),

      // 2. Paginated orders
      prisma.order.findMany({
        where,
        select: {
          id: true,
          orderNumber: true,
          orderType: true,
          status: true,
          tabName: true,
          guestCount: true,
          subtotal: true,
          taxTotal: true,
          discountTotal: true,
          total: true,
          createdAt: true,
          closedAt: true,
          employee: {
            select: { id: true, firstName: true, lastName: true },
          },
          customer: {
            select: { id: true, firstName: true, lastName: true, phone: true },
          },
          table: {
            select: { id: true, name: true },
          },
          payments: {
            select: {
              id: true,
              paymentMethod: true,
              amount: true,
              tipAmount: true,
              totalAmount: true,
              cardLast4: true,
              cardBrand: true,
            },
          },
          _count: {
            select: { items: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),

      // 3. Summary stats
      prisma.order.aggregate({
        where,
        _sum: {
          subtotal: true,
          taxTotal: true,
          total: true,
          discountTotal: true,
        },
        _count: true,
      }),

      // 4. Status breakdown (uses same filters for consistency)
      prisma.order.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { total: true },
      }),

      // 5. Order type breakdown
      prisma.order.groupBy({
        by: ['orderType'],
        where,
        _count: true,
        _sum: { total: true },
      }),

      // 6. Payment method breakdown (scoped to filtered orders)
      prisma.payment.groupBy({
        by: ['paymentMethod'],
        where: {
          order: where,
        },
        _count: true,
        _sum: { amount: true, tipAmount: true },
      }),
    ])

    return NextResponse.json({
      orders: orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        status: order.status,
        tableName: order.table?.name,
        tabName: order.tabName,
        guestCount: order.guestCount,
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        discountTotal: Number(order.discountTotal),
        total: Number(order.total),
        employee: order.employee,
        customer: order.customer,
        itemCount: order._count.items,
        payments: order.payments.map(p => ({
          id: p.id,
          method: p.paymentMethod,
          paymentMethod: p.paymentMethod,
          amount: Number(p.amount),
          tipAmount: Number(p.tipAmount),
          totalAmount: Number(p.totalAmount),
          cardLast4: p.cardLast4,
          cardBrand: p.cardBrand,
        })),
        createdAt: order.createdAt,
        closedAt: order.closedAt,
      })),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
      summary: {
        orderCount: stats._count,
        subtotal: Number(stats._sum.subtotal || 0),
        taxTotal: Number(stats._sum.taxTotal || 0),
        discountTotal: Number(stats._sum.discountTotal || 0),
        total: Number(stats._sum.total || 0),
      },
      statusBreakdown: statusBreakdown.map(s => ({
        status: s.status,
        count: s._count,
        total: Number(s._sum.total || 0),
      })),
      typeBreakdown: typeBreakdown.map(t => ({
        type: t.orderType,
        count: t._count,
        total: Number(t._sum.total || 0),
      })),
      paymentBreakdown: paymentBreakdown.map(p => ({
        method: p.paymentMethod,
        count: p._count,
        amount: Number(p._sum.amount || 0),
        tips: Number(p._sum.tipAmount || 0),
      })),
    })
  } catch (error) {
    console.error('Order history error:', error)
    return NextResponse.json({ error: 'Failed to fetch order history' }, { status: 500 })
  }
})
