import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildShiftCloseoutReceipt } from '@/lib/escpos/shift-closeout-receipt'
import { sendToPrinter } from '@/lib/printer-connection'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { shiftId, locationId } = body

    if (!shiftId || !locationId) {
      return NextResponse.json({ error: 'shiftId and locationId required' }, { status: 400 })
    }

    // Fetch shift with employee, location, and tip-out data
    const shift = await db.shift.findFirst({
      where: { id: shiftId, locationId, deletedAt: null },
      include: {
        employee: {
          select: { firstName: true, lastName: true, displayName: true },
        },
        location: {
          select: { name: true },
        },
        tipShares: {
          where: { shareType: 'role_tipout', deletedAt: null },
          include: {
            rule: {
              select: { percentage: true },
            },
            toEmployee: {
              select: {
                role: { select: { name: true } },
              },
            },
          },
        },
      },
    })

    if (!shift) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    }

    // Get receipt printer
    const printer = await db.printer.findFirst({
      where: { locationId, printerRole: 'receipt', isActive: true, deletedAt: null },
    })

    if (!printer) {
      return NextResponse.json({ error: 'No receipt printer configured' }, { status: 400 })
    }

    // Get order count and cash transaction details from payments during this shift
    const endTime = shift.endedAt || new Date()
    const payments = await db.payment.findMany({
      where: {
        employeeId: shift.employeeId,
        status: 'completed',
        processedAt: {
          gte: shift.startedAt,
          lte: endTime,
        },
        order: { locationId },
      },
      select: {
        paymentMethod: true,
        amountTendered: true,
        changeGiven: true,
        orderId: true,
      },
    })

    // Count unique orders
    const uniqueOrderIds = new Set(payments.map(p => p.orderId))
    const orderCount = uniqueOrderIds.size

    // Sum cash received and change given from cash payments
    let cashReceived = 0
    let changeGiven = 0
    for (const payment of payments) {
      if (payment.paymentMethod === 'cash') {
        cashReceived += Number(payment.amountTendered || 0)
        changeGiven += Number(payment.changeGiven || 0)
      }
    }

    // Build employee display name
    const employeeName = shift.employee.displayName
      || `${shift.employee.firstName} ${shift.employee.lastName || ''}`.trim()

    // Calculate duration
    const clockIn = shift.startedAt.toISOString()
    const clockOut = shift.endedAt ? shift.endedAt.toISOString() : new Date().toISOString()
    const durationMs = endTime.getTime() - shift.startedAt.getTime()
    const durationMinutes = Math.round(durationMs / 60000)

    // Build tip-out data from TipShare records with rule percentage
    const tipOuts = shift.tipShares.map(ts => ({
      roleName: ts.toEmployee?.role?.name || 'Unknown',
      percentage: ts.rule ? Number(ts.rule.percentage) : 0,
      amount: Number(ts.amount),
    }))

    // Extract numeric shift fields
    const startingCash = Number(shift.startingCash)
    const expectedCash = shift.expectedCash ? Number(shift.expectedCash) : 0
    const actualCash = shift.actualCash ? Number(shift.actualCash) : 0
    const netTips = shift.netTips ? Number(shift.netTips) : 0
    const grossTips = shift.grossTips ? Number(shift.grossTips) : 0

    // Safe drop: excess cash above starting amount that goes to the safe
    const safeDrop = Math.max(0, actualCash - startingCash)
    const employeeTakeHome = netTips

    const receiptData = {
      locationName: shift.location.name || 'GWI POS',
      employeeName,
      clockIn,
      clockOut,
      durationMinutes,
      totalSales: shift.totalSales ? Number(shift.totalSales) : 0,
      cashSales: shift.cashSales ? Number(shift.cashSales) : 0,
      cardSales: shift.cardSales ? Number(shift.cardSales) : 0,
      orderCount,
      startingCash,
      cashReceived: Math.round(cashReceived * 100) / 100,
      changeGiven: Math.round(changeGiven * 100) / 100,
      expectedCash,
      countedCash: actualCash,
      variance: shift.variance ? Number(shift.variance) : 0,
      grossTips,
      tipOuts,
      netTips,
      tipBankBalance: 0,
      payoutMethod: 'PAYROLL',
      payoutAmount: netTips,
      safeDrop,
      employeeTakeHome,
    }

    const buffer = buildShiftCloseoutReceipt(receiptData)
    const result = await sendToPrinter(printer.ipAddress, printer.port, buffer)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send to printer' },
        { status: 500 }
      )
    }

    // Log the print job
    await db.printJob.create({
      data: {
        locationId,
        jobType: 'shift_closeout',
        printerId: printer.id,
        status: 'sent',
        sentAt: new Date(),
      },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to print shift closeout receipt:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Print failed' },
      { status: 500 }
    )
  }
})
