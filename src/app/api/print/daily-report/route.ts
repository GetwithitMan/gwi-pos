import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildDailyReportReceipt, DailyReportPrintData } from '@/lib/escpos/daily-report-receipt'
import { sendToPrinter } from '@/lib/printer-connection'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, date } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Fetch the daily report from our own API (internal reuse)
    const dateParam = date || new Date().toISOString().split('T')[0]
    const reportUrl = new URL(
      `/api/reports/daily?locationId=${locationId}&date=${dateParam}`,
      request.url
    )

    const reportRes = await fetch(reportUrl.toString())
    if (!reportRes.ok) {
      const err = await reportRes.json().catch(() => ({ error: 'Failed to fetch report' }))
      return NextResponse.json({ error: err.error || 'Failed to generate report' }, { status: 500 })
    }

    const report = await reportRes.json()

    // Get location name
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { name: true },
    })

    // Get receipt printer
    const printer = await db.printer.findFirst({
      where: { locationId, printerRole: 'receipt', isActive: true, deletedAt: null },
    })

    if (!printer) {
      return NextResponse.json({ error: 'No receipt printer configured' }, { status: 400 })
    }

    // Map report data to print data
    const printData: DailyReportPrintData = {
      locationName: location?.name || 'GWI POS',
      reportDate: dateParam,
      grossSales: report.revenue?.grossSales || 0,
      discounts: report.revenue?.discounts || 0,
      netSales: report.revenue?.netSales || 0,
      salesTax: report.revenue?.salesTax || 0,
      tips: report.revenue?.tips || 0,
      totalCollected: report.revenue?.totalCollected || 0,
      cashPayments: report.payments?.cash || { count: 0, amount: 0 },
      creditPayments: report.payments?.credit || { count: 0, amount: 0 },
      giftPayments: report.payments?.gift || { count: 0, amount: 0 },
      houseAccountPayments: report.payments?.houseAccount || { count: 0, amount: 0 },
      totalPayments: report.payments?.totalPayments || 0,
      salesByCategory: (report.salesByCategory || []).map((c: { name: string; units: number; net: number; percentOfTotal: number }) => ({
        name: c.name,
        units: c.units,
        net: c.net,
        percentOfTotal: c.percentOfTotal,
      })),
      voidCount: report.voids?.total?.count || 0,
      voidAmount: report.voids?.total?.amount || 0,
      compCount: 0, // Comps not tracked separately in daily report API yet
      compAmount: 0,
      laborHours: report.labor?.total?.hours || 0,
      laborCost: report.labor?.total?.cost || 0,
      laborPercent: report.labor?.total?.percentOfSales || 0,
      ccTipFees: report.businessCosts?.ccTipFees || 0,
      ccTipFeeTransactions: report.businessCosts?.ccTipFeeTransactions || 0,
      cashReceived: report.cash?.cashReceived || 0,
      cashIn: report.cash?.cashIn || 0,
      cashOut: report.cash?.cashOut || 0,
      tipsOut: report.cash?.tipsOut || 0,
      cashDue: report.cash?.cashDue || 0,
      checks: report.stats?.checks || 0,
      avgCheck: report.stats?.avgCheck || 0,
      covers: report.stats?.covers || 0,
    }

    const buffer = buildDailyReportReceipt(printData)
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
        jobType: 'daily_report',
        printerId: printer.id,
        status: 'sent',
        sentAt: new Date(),
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to print daily report:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Print failed' },
      { status: 500 }
    )
  }
})
