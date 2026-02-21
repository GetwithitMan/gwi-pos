import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import { ESCPOS } from '@/lib/escpos/commands'

/**
 * POST /api/print/cash-drawer
 *
 * Sends an ESC/POS drawer-kick command to the receipt printer for a location.
 *
 * Body: { locationId?: string }
 * If locationId is omitted, it is resolved from the venue context (first active location).
 *
 * Always returns 200. On missing printer returns { success: false, reason }.
 * On send failure returns { success: false, error }.
 * On success returns { success: true }.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { locationId?: string }

    // Resolve locationId — body takes precedence; fall back to the venue's only location
    let locationId = body.locationId

    if (!locationId) {
      const location = await db.location.findFirst({
        where: { isActive: true },
        select: { id: true },
      })
      if (!location) {
        return NextResponse.json(
          { data: { success: false, reason: 'No location found' } },
          { status: 404 }
        )
      }
      locationId = location.id
    }

    // Find the active receipt printer for this location
    const printer = await db.printer.findFirst({
      where: {
        locationId,
        printerRole: 'receipt',
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, ipAddress: true, port: true },
    })

    if (!printer) {
      return NextResponse.json({
        data: { success: false, reason: 'No receipt printer configured' },
      })
    }

    const result = await sendToPrinter(printer.ipAddress, printer.port, ESCPOS.DRAWER_KICK)

    if (!result.success) {
      return NextResponse.json({
        data: { success: false, error: result.error ?? 'Printer did not acknowledge' },
      })
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[CashDrawer API] Unexpected error:', error)
    return NextResponse.json({
      data: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    })
  }
})
