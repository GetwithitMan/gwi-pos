import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { withVenue } from '@/lib/with-venue'

// GET - List closed orders (paid, closed) with search, pagination, date range, tip filtering
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const orderType = searchParams.get('orderType')
    const search = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const cursor = searchParams.get('cursor')
    const limit = Math.min(Number(searchParams.get('limit') || '50'), 100)
    const sortBy = searchParams.get('sortBy') || 'newest'
    const tipStatus = searchParams.get('tipStatus') || 'all'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Date range: default to today if no dateFrom/dateTo provided
    let dateStart: Date
    let dateEnd: Date | undefined

    if (dateFrom) {
      // Parse as local date (YYYY-MM-DD) — avoid UTC parsing of date-only strings
      const [y, m, d] = dateFrom.split('-').map(Number)
      dateStart = new Date(y, m - 1, d, 0, 0, 0, 0)
    } else {
      dateStart = new Date()
      dateStart.setHours(0, 0, 0, 0)
    }

    if (dateTo) {
      const [y, m, d] = dateTo.split('-').map(Number)
      dateEnd = new Date(y, m - 1, d, 23, 59, 59, 999)
    }

    // Sort mapping
    const orderByMap: Record<string, Prisma.OrderOrderByWithRelationInput> = {
      newest: { closedAt: 'desc' },
      oldest: { closedAt: 'asc' },
      total_high: { total: 'desc' },
      total_low: { total: 'asc' },
    }
    const orderBy = orderByMap[sortBy] || orderByMap.newest

    // Build where clause
    const where: Prisma.OrderWhereInput = {
      locationId,
      status: { in: ['paid', 'closed'] },
      parentOrderId: null,
      deletedAt: null,
      closedAt: {
        gte: dateStart,
        ...(dateEnd ? { lte: dateEnd } : {}),
      },
      ...(employeeId ? { employeeId } : {}),
      ...(orderType ? { orderType } : {}),
    }

    // Search filter: tab name, order number, or employee name
    if (search) {
      const searchNum = parseInt(search)
      where.OR = [
        { tabName: { contains: search } },
        ...(searchNum && !isNaN(searchNum) ? [{ orderNumber: searchNum }] : []),
        {
          employee: {
            OR: [
              { displayName: { contains: search } },
              { firstName: { contains: search } },
              { lastName: { contains: search } },
            ],
          },
        },
      ]
    }

    // Cursor-based pagination
    const paginationArgs: { cursor?: { id: string }; skip?: number } = {}
    if (cursor) {
      paginationArgs.cursor = { id: cursor }
      paginationArgs.skip = 1
    }

    const orders = await db.order.findMany({
      where,
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        items: {
          where: { deletedAt: null },
          include: {
            modifiers: { where: { deletedAt: null } },
          },
        },
        payments: {
          where: { deletedAt: null },
        },
      },
      orderBy,
      take: limit + 1, // Fetch one extra to determine hasMore
      ...paginationArgs,
    })

    // Check if there are more results
    const hasMore = orders.length > limit
    const resultOrders = hasMore ? orders.slice(0, limit) : orders

    // Map and filter by tipStatus
    let mappedOrders = resultOrders.map(order => {
      const activePayments = order.payments.filter(p => p.status === 'completed')
      const tipTotal = activePayments.reduce((sum, p) => sum + Number(p.tipAmount), 0)
      const hasCardPayment = activePayments.some(p =>
        ['credit', 'debit'].includes(p.paymentMethod)
      )

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        tabName: order.tabName,
        tableId: order.tableId,
        guestCount: order.guestCount,
        status: order.status,
        employee: {
          id: order.employee.id,
          name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
        },
        items: order.items.map(item => ({
          id: item.id,
          menuItemId: item.menuItemId,
          name: item.name,
          price: Number(item.price),
          quantity: item.quantity,
          itemTotal: Number(item.itemTotal),
          specialNotes: item.specialNotes,
          isCompleted: item.isCompleted,
          completedAt: item.completedAt?.toISOString() || null,
          modifiers: item.modifiers.map(mod => ({
            id: mod.id,
            modifierId: mod.modifierId,
            name: mod.name,
            price: Number(mod.price),
            preModifier: mod.preModifier,
          })),
        })),
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        tipTotal,
        total: Number(order.total),
        createdAt: order.createdAt.toISOString(),
        openedAt: order.openedAt.toISOString(),
        closedAt: order.closedAt?.toISOString() || null,
        paidAmount: activePayments.reduce((sum, p) => sum + Number(p.totalAmount), 0),
        paymentMethods: [...new Set(order.payments.map(p => p.paymentMethod))],
        payments: order.payments.map(p => ({
          id: p.id,
          amount: Number(p.amount),
          tipAmount: Number(p.tipAmount),
          totalAmount: Number(p.totalAmount),
          paymentMethod: p.paymentMethod,
          cardBrand: p.cardBrand,
          cardLast4: p.cardLast4,
          status: p.status,
          datacapRecordNo: p.datacapRecordNo || null,
        })),
        hasPreAuth: false,
        preAuth: null,
        hasCardPayment,
        needsTip: hasCardPayment && tipTotal === 0,
      }
    })

    // Filter by tip status after mapping
    if (tipStatus === 'needs_tip') {
      mappedOrders = mappedOrders.filter(o => o.needsTip)
    } else if (tipStatus === 'has_tip') {
      mappedOrders = mappedOrders.filter(o => !o.needsTip)
    }

    const nextCursor = hasMore ? resultOrders[resultOrders.length - 1].id : null

    return NextResponse.json({
      orders: mappedOrders,
      pagination: {
        hasMore,
        nextCursor,
        limit,
      },
    })
  } catch (error) {
    console.error('Failed to fetch closed orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch closed orders' },
      { status: 500 }
    )
  }
})
