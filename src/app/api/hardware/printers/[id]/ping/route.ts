import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { testPrinterConnection } from '@/lib/printer-connection'
import { withVenue } from '@/lib/with-venue'

// POST test printer connection
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const printer = await db.printer.findUnique({
      where: { id },
    })

    if (!printer) {
      return NextResponse.json({ error: 'Printer not found' }, { status: 404 })
    }

    // Test the connection
    const result = await testPrinterConnection(printer.ipAddress, printer.port)

    // Update printer status
    await db.printer.update({
      where: { id },
      data: {
        lastPingAt: new Date(),
        lastPingOk: result.success,
      },
    })

    return NextResponse.json({ data: {
      success: result.success,
      responseTime: result.responseTime,
      error: result.error,
      printer: {
        id: printer.id,
        name: printer.name,
        ipAddress: printer.ipAddress,
        port: printer.port,
      },
    } })
  } catch (error) {
    console.error('Failed to ping printer:', error)
    return NextResponse.json({ error: 'Failed to ping printer' }, { status: 500 })
  }
})
