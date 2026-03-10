import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

// GET /api/tabs/closed - List closed/paid bar tabs with pagination
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const employeeId = searchParams.get('employeeId')
    const search = searchParams.get('search')?.trim()
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = 25
    const offset = (page - 1) * limit

    // Build date range filter
    const dateFilter: Record<string, unknown> = {}
    if (dateFrom) {
      dateFilter.gte = new Date(dateFrom)
    }
    if (dateTo) {
      const end = new Date(dateTo)
      end.setHours(23, 59, 59, 999)
      dateFilter.lte = end
    }

    // Build search filter
    const searchFilter = search
      ? {
          OR: [
            { tabName: { contains: search, mode: 'insensitive' as const } },
            { employee: { firstName: { contains: search, mode: 'insensitive' as const } } },
            { employee: { lastName: { contains: search, mode: 'insensitive' as const } } },
            { employee: { displayName: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {}

    const where = {
      locationId,
      orderType: 'bar_tab' as const,
      status: { in: ['paid', 'closed'] as ('paid' | 'closed')[] },
      deletedAt: null,
      ...(Object.keys(dateFilter).length > 0 ? { closedAt: dateFilter } : {}),
      ...(employeeId ? { employeeId } : {}),
      ...searchFilter,
    }

    // Run count + data in parallel
    const [totalCount, tabs] = await Promise.all([
      db.order.count({ where }),
      db.order.findMany({
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
            where: { status: 'completed' },
          },
          cards: {
            where: { deletedAt: null },
            select: {
              id: true,
              cardType: true,
              cardLast4: true,
              cardholderName: true,
            },
          },
        },
        orderBy: { closedAt: 'desc' },
        skip: offset,
        take: limit,
      }),
    ])

    const totalPages = Math.ceil(totalCount / limit)

    // Map response
    const data = tabs.map(tab => {
      const employeeName = tab.employee.displayName || `${tab.employee.firstName} ${tab.employee.lastName}`
      const payments = tab.payments || []
      const tipTotal = payments.reduce((sum, p) => sum + Number(p.tipAmount || 0), 0)
      const paidTotal = payments.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0)
      const paymentMethods = [...new Set(payments.map(p => p.paymentMethod))]
      const customerName = tab.cards?.[0]?.cardholderName || null

      return {
        id: tab.id,
        tabName: tab.tabName,
        customerName,
        employee: { id: tab.employee.id, name: employeeName },
        openedAt: tab.createdAt.toISOString(),
        closedAt: tab.closedAt?.toISOString() || null,
        subtotal: Number(tab.subtotal),
        taxTotal: Number(tab.taxTotal),
        tipTotal,
        total: Number(tab.total),
        paidTotal,
        paymentMethods,
        itemCount: tab.items.reduce((sum, i) => sum + i.quantity, 0),
        items: tab.items.map(item => ({
          id: item.id,
          name: item.name,
          price: Number(item.price),
          quantity: item.quantity,
          itemTotal: Number(item.itemTotal),
          specialNotes: item.specialNotes,
          modifiers: item.modifiers.map(m => ({
            id: m.id,
            name: m.name,
            price: Number(m.price),
            preModifier: m.preModifier,
          })),
        })),
        payments: payments.map(p => ({
          id: p.id,
          amount: Number(p.amount),
          tipAmount: Number(p.tipAmount || 0),
          totalAmount: Number(p.totalAmount),
          paymentMethod: p.paymentMethod,
          cardBrand: p.cardBrand,
          cardLast4: p.cardLast4,
          status: p.status,
        })),
      }
    })

    // Summary stats
    const summary = {
      totalTabsClosed: totalCount,
      totalRevenue: data.reduce((sum, t) => sum + t.paidTotal, 0),
      averageTabSize: data.length > 0 ? data.reduce((sum, t) => sum + t.paidTotal, 0) / data.length : 0,
      averageTipPercent: (() => {
        const withTips = data.filter(t => t.subtotal > 0)
        if (withTips.length === 0) return 0
        const totalTips = withTips.reduce((sum, t) => sum + t.tipTotal, 0)
        const totalSubtotals = withTips.reduce((sum, t) => sum + t.subtotal, 0)
        return totalSubtotals > 0 ? (totalTips / totalSubtotals) * 100 : 0
      })(),
    }

    return NextResponse.json({
      data: {
        tabs: data,
        summary,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasMore: page < totalPages,
        },
      },
    })
  } catch (error) {
    console.error('Failed to fetch closed tabs:', error)
    return NextResponse.json({ error: 'Failed to fetch closed tabs' }, { status: 500 })
  }
})
