import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { generateFakeAuthCode, generateFakeTransactionId, calculatePreAuthExpiration } from '@/lib/payment'
import { withVenue } from '@/lib/with-venue'

// GET - List open tabs with pagination
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status') || 'open'
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'))

    const where = {
      orderType: 'bar_tab' as const,
      status: status === 'all' ? undefined : status,
      ...(employeeId ? { employeeId } : {}),
    }

    const tabs = await db.order.findMany({
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
        payments: true,
      },
      orderBy: { openedAt: 'desc' },
      skip: offset,
      take: limit,
    })

    return NextResponse.json({
      tabs: tabs.map(tab => ({
        id: tab.id,
        tabName: tab.tabName, // Return actual value (null if no custom name)
        orderNumber: tab.orderNumber,
        status: tab.status,
        employee: {
          id: tab.employee.id,
          name: tab.employee.displayName || `${tab.employee.firstName} ${tab.employee.lastName}`,
        },
        itemCount: tab.items.reduce((sum, item) => sum + item.quantity, 0),
        items: tab.items
          .filter(item => !item.deletedAt)
          .map(item => ({
            id: item.id,
            menuItemId: item.menuItemId,
            name: item.name,
            price: Number(item.price),
            quantity: item.quantity,
            sentToKitchen: item.kitchenStatus !== 'pending',
            specialNotes: item.specialNotes,
            isHeld: item.isHeld,
            isCompleted: item.isCompleted,
            seatNumber: item.seatNumber,
            courseNumber: item.courseNumber,
            courseStatus: item.courseStatus,
            resendCount: item.resendCount,
            createdAt: item.createdAt?.toISOString(),
            modifiers: item.modifiers
              .filter((m: { deletedAt: Date | null }) => !m.deletedAt)
              .map((m: { id: string; name: string; price: unknown; preModifier: string | null; depth: number | null }) => ({
                id: m.id,
                name: m.name,
                price: Number(m.price),
                preModifier: m.preModifier,
                depth: m.depth || 0,
              })),
          })),
        subtotal: Number(tab.subtotal),
        taxTotal: Number(tab.taxTotal),
        total: Number(tab.total),
        // Pre-auth info
        hasPreAuth: !!tab.preAuthId,
        preAuth: tab.preAuthId ? {
          cardBrand: tab.preAuthCardBrand,
          last4: tab.preAuthLast4,
          amount: tab.preAuthAmount ? Number(tab.preAuthAmount) : null,
          expiresAt: tab.preAuthExpiresAt?.toISOString(),
        } : null,
        openedAt: tab.openedAt.toISOString(),
        // Payment status
        paidAmount: tab.payments
          .filter(p => p.status === 'completed')
          .reduce((sum, p) => sum + Number(p.totalAmount), 0),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch tabs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tabs' },
      { status: 500 }
    )
  }
})

// POST - Create new tab
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      employeeId,
      tabName,
      preAuth,
    } = body as {
      employeeId: string
      tabName?: string
      preAuth?: {
        cardBrand: string
        cardLast4: string
        amount?: number
      }
    }

    const locationId = body.locationId as string | undefined

    if (!employeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 400 }
      )
    }

    // Run employee lookup + last order number in parallel
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const [employee, lastOrder] = await Promise.all([
      db.employee.findUnique({
        where: { id: employeeId },
        include: { location: true },
      }),
      // If locationId provided, skip waiting for employee to get it
      locationId
        ? db.order.findFirst({
            where: {
              locationId,
              createdAt: { gte: today, lt: tomorrow },
            },
            orderBy: { orderNumber: 'desc' },
          })
        : null,
    ])

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    const resolvedLocationId = locationId || employee.locationId
    const settings = parseSettings(employee.location.settings)

    // Create pre-auth data if provided
    let preAuthData = {}
    if (preAuth && preAuth.cardLast4) {
      if (!/^\d{4}$/.test(preAuth.cardLast4)) {
        return NextResponse.json(
          { error: 'Invalid card last 4 digits' },
          { status: 400 }
        )
      }

      preAuthData = {
        preAuthId: generateFakeTransactionId(),
        preAuthAmount: preAuth.amount || settings.payments.defaultPreAuthAmount,
        preAuthLast4: preAuth.cardLast4,
        preAuthCardBrand: preAuth.cardBrand || 'visa',
        preAuthExpiresAt: calculatePreAuthExpiration(settings.payments.preAuthExpirationDays),
      }
    }

    // Create the tab atomically with order number generation (serializable prevents duplicates)
    const tab = await db.$transaction(async (tx) => {
      const resolvedLastOrder = lastOrder ?? await tx.order.findFirst({
        where: {
          locationId: resolvedLocationId,
          createdAt: { gte: today, lt: tomorrow },
        },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true },
      })
      const orderNumber = (resolvedLastOrder?.orderNumber || 0) + 1

      return tx.order.create({
        data: {
          locationId: resolvedLocationId,
          employeeId,
          orderNumber,
          orderType: 'bar_tab',
          tabName: tabName || null,
          status: 'open',
          guestCount: 1,
          ...preAuthData,
        },
        include: {
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
        },
      })
    }, { isolationLevel: 'Serializable' })

    return NextResponse.json({
      id: tab.id,
      tabName: tab.tabName || `Tab #${tab.orderNumber}`,
      orderNumber: tab.orderNumber,
      status: tab.status,
      employee: {
        id: tab.employee.id,
        name: tab.employee.displayName || `${tab.employee.firstName} ${tab.employee.lastName}`,
      },
      hasPreAuth: !!tab.preAuthId,
      preAuth: tab.preAuthId ? {
        cardBrand: tab.preAuthCardBrand,
        last4: tab.preAuthLast4,
        amount: tab.preAuthAmount ? Number(tab.preAuthAmount) : null,
        expiresAt: tab.preAuthExpiresAt?.toISOString(),
      } : null,
      openedAt: tab.openedAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to create tab:', error)
    return NextResponse.json(
      { error: 'Failed to create tab' },
      { status: 500 }
    )
  }
})
