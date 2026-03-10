import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import { ESCPOS } from '@/lib/escpos/commands'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { dispatchAlert } from '@/lib/alert-service'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'

/**
 * POST /api/print/cash-drawer
 *
 * Sends an ESC/POS drawer-kick command to the receipt printer for a location.
 * This route is the "No Sale" cash drawer open (not triggered by payment).
 *
 * Body: { locationId?: string, employeeId?: string, reason?: string }
 * If locationId is omitted, it is resolved from the venue context (first active location).
 *
 * Always returns 200. On missing printer returns { success: false, reason }.
 * On send failure returns { success: false, error }.
 * On success returns { success: true }.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      locationId?: string
      employeeId?: string
      reason?: string
    }

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

    // Auth check — require pos.no_sale permission
    if (body.employeeId) {
      const auth = await requirePermission(body.employeeId, locationId, PERMISSIONS.POS_NO_SALE)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
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
      // W1-PR3: Return 404 when no printer configured
      return NextResponse.json(
        { data: { success: false, reason: 'No receipt printer configured' } },
        { status: 404 }
      )
    }

    const result = await sendToPrinter(printer.ipAddress, printer.port, ESCPOS.DRAWER_KICK)

    if (!result.success) {
      // W1-PR3: Return 500 on printer failure
      return NextResponse.json(
        { data: { success: false, error: result.error ?? 'Printer did not acknowledge' } },
        { status: 500 }
      )
    }

    // Alert dispatch: notify on no-sale cash drawer open (fire-and-forget)
    // This route IS the no-sale open path — payment-triggered opens use triggerCashDrawer() directly
    if (body.employeeId) {
      const empId = body.employeeId
      const drawerReason = body.reason || 'No Sale'
      const resolvedLocationId = locationId
      void (async () => {
        try {
          const locSettings = parseSettings(await getLocationSettings(resolvedLocationId))
          if (!locSettings.alerts.enabled || !locSettings.alerts.cashDrawerAlertEnabled) return

          const employee = await db.employee.findUnique({
            where: { id: empId },
            select: { firstName: true, lastName: true, displayName: true },
          })
          const empName = employee?.displayName || `${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim() || 'Unknown'

          void dispatchAlert({
            severity: 'LOW',
            errorType: 'drawer_opened',
            category: 'cash_drawer',
            message: `Cash drawer opened by ${empName} - Reason: ${drawerReason}`,
            locationId: resolvedLocationId,
            employeeId: empId,
            groupId: `drawer-${resolvedLocationId}-${empId}-${Date.now()}`,
          }).catch(console.error)
        } catch (err) {
          console.error('[cash-drawer] Alert dispatch failed:', err)
        }
      })()
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[CashDrawer API] Unexpected error:', error)
    // W1-PR3: Return 500 on unexpected errors
    return NextResponse.json(
      {
        data: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    )
  }
})
