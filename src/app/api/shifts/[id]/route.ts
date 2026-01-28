import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get shift details with sales summary
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const shift = await db.shift.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (!shift) {
      return NextResponse.json(
        { error: 'Shift not found' },
        { status: 404 }
      )
    }

    // Get all orders/payments for this shift period
    const shiftSummary = await calculateShiftSummary(
      shift.locationId,
      shift.employeeId,
      shift.startedAt,
      shift.endedAt || new Date()
    )

    return NextResponse.json({
      shift: {
        id: shift.id,
        employee: {
          id: shift.employee.id,
          name: shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`,
        },
        location: shift.location,
        startedAt: shift.startedAt.toISOString(),
        endedAt: shift.endedAt?.toISOString() || null,
        status: shift.status,
        startingCash: Number(shift.startingCash),
        expectedCash: shift.expectedCash ? Number(shift.expectedCash) : null,
        actualCash: shift.actualCash ? Number(shift.actualCash) : null,
        variance: shift.variance ? Number(shift.variance) : null,
        totalSales: shift.totalSales ? Number(shift.totalSales) : null,
        cashSales: shift.cashSales ? Number(shift.cashSales) : null,
        cardSales: shift.cardSales ? Number(shift.cardSales) : null,
        tipsDeclared: shift.tipsDeclared ? Number(shift.tipsDeclared) : null,
        notes: shift.notes,
      },
      summary: shiftSummary,
    })
  } catch (error) {
    console.error('Failed to fetch shift:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shift' },
      { status: 500 }
    )
  }
}

// PUT - Close shift / update shift
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, actualCash, tipsDeclared, notes } = body as {
      action: 'close' | 'update'
      actualCash?: number
      tipsDeclared?: number
      notes?: string
    }

    const shift = await db.shift.findUnique({
      where: { id },
    })

    if (!shift) {
      return NextResponse.json(
        { error: 'Shift not found' },
        { status: 404 }
      )
    }

    if (action === 'close') {
      if (shift.status === 'closed') {
        return NextResponse.json(
          { error: 'Shift is already closed' },
          { status: 400 }
        )
      }

      if (actualCash === undefined) {
        return NextResponse.json(
          { error: 'Actual cash count is required to close shift' },
          { status: 400 }
        )
      }

      // Calculate shift summary
      const endTime = new Date()
      const summary = await calculateShiftSummary(
        shift.locationId,
        shift.employeeId,
        shift.startedAt,
        endTime
      )

      // Expected cash = starting cash + cash received - change given
      const expectedCash = Number(shift.startingCash) + summary.netCashReceived
      const variance = actualCash - expectedCash

      // Update shift with closeout data
      const updatedShift = await db.shift.update({
        where: { id },
        data: {
          endedAt: endTime,
          status: 'closed',
          expectedCash,
          actualCash,
          variance,
          totalSales: summary.totalSales,
          cashSales: summary.cashSales,
          cardSales: summary.cardSales,
          tipsDeclared: tipsDeclared || summary.totalTips,
          notes: notes || shift.notes,
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      })

      return NextResponse.json({
        shift: {
          id: updatedShift.id,
          employee: {
            id: updatedShift.employee.id,
            name: updatedShift.employee.displayName || `${updatedShift.employee.firstName} ${updatedShift.employee.lastName}`,
          },
          startedAt: updatedShift.startedAt.toISOString(),
          endedAt: updatedShift.endedAt?.toISOString(),
          status: updatedShift.status,
          startingCash: Number(updatedShift.startingCash),
          expectedCash: Number(updatedShift.expectedCash),
          actualCash: Number(updatedShift.actualCash),
          variance: Number(updatedShift.variance),
          totalSales: Number(updatedShift.totalSales),
          cashSales: Number(updatedShift.cashSales),
          cardSales: Number(updatedShift.cardSales),
          tipsDeclared: Number(updatedShift.tipsDeclared),
          notes: updatedShift.notes,
        },
        summary,
        message: variance === 0
          ? 'Shift closed successfully. Drawer is balanced!'
          : variance > 0
            ? `Shift closed. Drawer is OVER by $${variance.toFixed(2)}`
            : `Shift closed. Drawer is SHORT by $${Math.abs(variance).toFixed(2)}`,
      })
    }

    // Simple update (notes, etc.)
    const updatedShift = await db.shift.update({
      where: { id },
      data: {
        ...(notes !== undefined ? { notes } : {}),
      },
    })

    return NextResponse.json({
      shift: updatedShift,
      message: 'Shift updated',
    })
  } catch (error) {
    console.error('Failed to update shift:', error)
    return NextResponse.json(
      { error: 'Failed to update shift' },
      { status: 500 }
    )
  }
}

// Helper function to calculate shift summary
async function calculateShiftSummary(
  locationId: string,
  employeeId: string,
  startTime: Date,
  endTime: Date
) {
  // Get all completed payments by this employee during the shift
  const payments = await db.payment.findMany({
    where: {
      employeeId,
      status: 'completed',
      processedAt: {
        gte: startTime,
        lte: endTime,
      },
      order: {
        locationId,
      },
    },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          total: true,
        },
      },
    },
  })

  // Get all orders created by this employee during the shift
  const orders = await db.order.findMany({
    where: {
      employeeId,
      locationId,
      createdAt: {
        gte: startTime,
        lte: endTime,
      },
      status: { in: ['paid', 'closed'] },
    },
    select: {
      id: true,
      total: true,
      tipTotal: true,
      discountTotal: true,
    },
  })

  // Calculate totals
  let totalSales = 0
  let cashSales = 0
  let cardSales = 0
  let totalTips = 0
  let cashReceived = 0
  let changeGiven = 0

  payments.forEach(payment => {
    const amount = Number(payment.amount)
    const tip = Number(payment.tipAmount)

    totalSales += amount
    totalTips += tip

    if (payment.paymentMethod === 'cash') {
      cashSales += amount + tip
      cashReceived += Number(payment.amountTendered || 0)
      changeGiven += Number(payment.changeGiven || 0)
    } else {
      cardSales += amount + tip
    }
  })

  // Net cash received = cash tendered - change given
  const netCashReceived = cashReceived - changeGiven

  // Count orders and payments
  const orderCount = orders.length
  const paymentCount = payments.length

  // Get voids/comps during shift (count items with voided/comped status on orders in this period)
  const voids = await db.orderItem.count({
    where: {
      order: {
        employeeId,
        locationId,
        createdAt: {
          gte: startTime,
          lte: endTime,
        },
      },
      status: 'voided',
    },
  })

  const comps = await db.orderItem.count({
    where: {
      order: {
        employeeId,
        locationId,
        createdAt: {
          gte: startTime,
          lte: endTime,
        },
      },
      status: 'comped',
    },
  })

  return {
    totalSales: Math.round(totalSales * 100) / 100,
    cashSales: Math.round(cashSales * 100) / 100,
    cardSales: Math.round(cardSales * 100) / 100,
    totalTips: Math.round(totalTips * 100) / 100,
    cashReceived: Math.round(cashReceived * 100) / 100,
    changeGiven: Math.round(changeGiven * 100) / 100,
    netCashReceived: Math.round(netCashReceived * 100) / 100,
    orderCount,
    paymentCount,
    voidCount: voids,
    compCount: comps,
  }
}
