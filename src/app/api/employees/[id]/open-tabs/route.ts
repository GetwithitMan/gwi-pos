import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Check if employee has open tabs/orders
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Find all open orders for this employee
    const openOrders = await db.order.findMany({
      where: {
        employeeId,
        locationId,
        status: { in: ['open', 'sent', 'in_progress'] },
      },
      select: {
        id: true,
        orderNumber: true,
        tabName: true,
        orderType: true,
        total: true,
        guestCount: true,
        createdAt: true,
        table: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          select: {
            id: true,
            name: true,
            quantity: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ data: {
      hasOpenTabs: openOrders.length > 0,
      count: openOrders.length,
      tabs: openOrders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        tabName: order.tabName,
        tableName: order.table?.name || null,
        orderType: order.orderType,
        total: Number(order.total),
        guestCount: order.guestCount,
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        createdAt: order.createdAt.toISOString(),
      })),
    } })
  } catch (error) {
    console.error('Failed to check open tabs:', error)
    return NextResponse.json(
      { error: 'Failed to check open tabs' },
      { status: 500 }
    )
  }
})

// POST - Transfer all tabs to another employee (quick transfer)
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const body = await request.json()
    const { targetEmployeeId, locationId } = body

    if (!targetEmployeeId || !locationId) {
      return NextResponse.json(
        { error: 'Target employee ID and location ID are required' },
        { status: 400 }
      )
    }

    // Verify target employee exists and is active
    const targetEmployee = await db.employee.findFirst({
      where: {
        id: targetEmployeeId,
        locationId,
        isActive: true,
      },
    })

    if (!targetEmployee) {
      return NextResponse.json(
        { error: 'Target employee not found or inactive' },
        { status: 404 }
      )
    }

    // Transfer all open orders to target employee
    const result = await db.order.updateMany({
      where: {
        employeeId,
        locationId,
        status: { in: ['open', 'sent', 'in_progress'] },
      },
      data: {
        employeeId: targetEmployeeId,
      },
    })

    return NextResponse.json({ data: {
      success: true,
      transferredCount: result.count,
      message: `${result.count} tab(s) transferred successfully`,
    } })
  } catch (error) {
    console.error('Failed to transfer tabs:', error)
    return NextResponse.json(
      { error: 'Failed to transfer tabs' },
      { status: 500 }
    )
  }
})
