import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { sendToPrinter } from '@/lib/printer-connection'
import { ESCPOS } from '@/lib/escpos/commands'
import { dispatchAlert } from '@/lib/alert-service'
import { emitToLocation } from '@/lib/socket-server'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'

/**
 * POST /api/drawers/[id]/open
 *
 * Open a specific cash drawer for non-payment reasons (No-Sale).
 * Sends the ESC/POS drawer kick command, logs to audit trail,
 * and dispatches an alert.
 *
 * Body: {
 *   employeeId: string
 *   reason: 'manual_reconciliation' | 'making_change' | 'safe_drop' | 'audit'
 * }
 */
const VALID_REASONS = ['manual_reconciliation', 'making_change', 'safe_drop', 'audit'] as const
type OpenReason = typeof VALID_REASONS[number]

const REASON_LABELS: Record<OpenReason, string> = {
  manual_reconciliation: 'Manual Reconciliation',
  making_change: 'Making Change',
  safe_drop: 'Safe Drop',
  audit: 'Audit',
}

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: drawerId } = await params
    const body = await request.json().catch(() => ({})) as {
      employeeId?: string
      reason?: string
    }

    // ── Validation ────────────────────────────────────────────────────
    if (!body.employeeId) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 })
    }

    // ── Drawer exists? ───────────────────────────────────────────────
    const drawer = await db.drawer.findFirst({
      where: { id: drawerId, isActive: true, deletedAt: null },
      select: { id: true, name: true, locationId: true, deviceId: true },
    })
    if (!drawer) {
      return NextResponse.json({ error: 'Drawer not found' }, { status: 404 })
    }

    // ── Load cash management settings ────────────────────────────────
    const locationSettings = parseSettings(await getLocationSettings(drawer.locationId))
    const cashMgmt = locationSettings.cashManagement

    // Reason validation
    if (cashMgmt?.requireReasonForNoSale) {
      if (!body.reason || !VALID_REASONS.includes(body.reason as OpenReason)) {
        return NextResponse.json(
          { error: `Reason is required. Must be one of: ${VALID_REASONS.join(', ')}` },
          { status: 400 }
        )
      }
    }

    const reason = body.reason as OpenReason | undefined
    const reasonLabel = reason ? REASON_LABELS[reason] : 'No Sale'

    // ── Permission check ─────────────────────────────────────────────
    const auth = await requirePermission(body.employeeId, drawer.locationId, PERMISSIONS.POS_CASH_DRAWER)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // ── Find receipt printer: terminal-specific first, then location default
    let printer: { id: string; ipAddress: string; port: number } | null = null

    // If the drawer is assigned to a terminal, use that terminal's receipt printer
    if (drawer.deviceId) {
      const terminal = await db.terminal.findUnique({
        where: { id: drawer.deviceId },
        select: {
          id: true,
          name: true,
          receiptPrinterId: true,
          receiptPrinter: {
            select: { id: true, ipAddress: true, port: true, isActive: true, deletedAt: true },
          },
        },
      })
      if (terminal?.receiptPrinter && terminal.receiptPrinter.isActive && !terminal.receiptPrinter.deletedAt) {
        printer = {
          id: terminal.receiptPrinter.id,
          ipAddress: terminal.receiptPrinter.ipAddress,
          port: terminal.receiptPrinter.port,
        }
      }
    }

    // Fall back to location default receipt printer
    if (!printer) {
      printer = await db.printer.findFirst({
        where: {
          locationId: drawer.locationId,
          printerRole: 'receipt',
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, ipAddress: true, port: true },
      })
    }

    if (!printer) {
      return NextResponse.json(
        { data: { success: false, reason: 'No receipt printer configured' } },
        { status: 404 }
      )
    }

    // ── Send drawer kick command ─────────────────────────────────────
    const result = await sendToPrinter(printer.ipAddress, printer.port, ESCPOS.DRAWER_KICK)

    if (!result.success) {
      return NextResponse.json(
        { data: { success: false, error: result.error ?? 'Printer did not acknowledge' } },
        { status: 500 }
      )
    }

    // ── Audit log (fire-and-forget) ──────────────────────────────────
    void db.auditLog.create({
      data: {
        locationId: drawer.locationId,
        employeeId: body.employeeId,
        action: 'drawer_opened_no_sale',
        entityType: 'drawer',
        entityId: drawerId,
        details: {
          reason: reasonLabel,
          drawerId,
          drawerName: drawer.name,
        },
      },
    }).catch(console.error)

    // ── Manager drawer access audit (fire-and-forget) ──────────────
    // If the employee opening this drawer is different from the shift owner, log it
    void (async () => {
      try {
        const ownerShift = await db.shift.findFirst({
          where: { drawerId, status: 'open', deletedAt: null },
          select: { id: true, employeeId: true },
        })
        if (ownerShift && ownerShift.employeeId !== body.employeeId) {
          void db.auditLog.create({
            data: {
              locationId: drawer.locationId,
              employeeId: body.employeeId,
              action: 'manager_drawer_access',
              entityType: 'drawer',
              entityId: drawerId,
              details: {
                shiftOwnerEmployeeId: ownerShift.employeeId,
                shiftId: ownerShift.id,
                reason: 'No-sale drawer open by different employee',
              },
            },
          }).catch(console.error)
        }
      } catch (err) {
        console.error('[drawer/open] Manager drawer access audit failed:', err)
      }
    })()

    // ── Socket event (fire-and-forget) ───────────────────────────────
    void emitToLocation(drawer.locationId, 'drawer:no-sale-open', {
      drawerId,
      drawerName: drawer.name,
      employeeId: body.employeeId,
      reason: reasonLabel,
      timestamp: new Date().toISOString(),
    }).catch(console.error)

    // ── Alert dispatch (fire-and-forget) ─────────────────────────────
    const empId = body.employeeId
    void (async () => {
      try {
        const locSettings = parseSettings(await getLocationSettings(drawer.locationId))
        if (!locSettings.alerts.enabled || !locSettings.alerts.cashDrawerAlertEnabled) return

        const employee = await db.employee.findUnique({
          where: { id: empId },
          select: { firstName: true, lastName: true, displayName: true },
        })
        const empName = employee?.displayName
          || `${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim()
          || 'Unknown'

        void dispatchAlert({
          severity: 'LOW',
          errorType: 'drawer_opened',
          category: 'cash_drawer',
          message: `Cash drawer "${drawer.name}" opened by ${empName} - Reason: ${reasonLabel}`,
          locationId: drawer.locationId,
          employeeId: empId,
          groupId: `drawer-${drawer.locationId}-${empId}-${Date.now()}`,
        }).catch(console.error)
      } catch (err) {
        console.error('[drawer/open] Alert dispatch failed:', err)
      }
    })()

    return NextResponse.json({ data: { success: true, reason: reasonLabel } })
  } catch (error) {
    console.error('[DrawerOpen API] Error:', error)
    return NextResponse.json(
      { data: { success: false, error: error instanceof Error ? error.message : 'Unknown error' } },
      { status: 500 }
    )
  }
})
