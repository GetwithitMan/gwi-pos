import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import { ESCPOS } from '@/lib/escpos/commands'
import { emitToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cash-drawer')

type DrawerOpenReason = 'no_sale' | 'cash_payment' | 'paid_in' | 'paid_out' | 'manual'

/**
 * Emit a drawer:opened socket event to all managers at the location.
 * Fire-and-forget safe: always resolves, never throws.
 * Caller should call with `void emitDrawerOpenedEvent(...)`.
 */
export async function emitDrawerOpenedEvent(
  locationId: string,
  employeeId: string | null,
  reason: DrawerOpenReason,
  terminalId?: string,
  drawerId?: string,
): Promise<void> {
  try {
    void emitToLocation(locationId, 'drawer:opened', {
      drawerId,
      employeeId,
      reason,
      terminalId,
      timestamp: new Date().toISOString(),
    }).catch(err => log.warn({ err }, 'Socket emission failed'))
  } catch (err) {
    log.error({ err }, 'emitDrawerOpenedEvent failed')
  }
}

/**
 * Trigger a cash drawer kick on the receipt printer for the given location.
 *
 * When `terminalId` is provided, looks up the terminal's assigned receipt
 * printer and kicks THAT drawer — so only the terminal the employee is
 * actually using opens. Falls back to the location-wide default receipt
 * printer when there is no terminal or the terminal has no printer assigned.
 *
 * Fire-and-forget safe: always resolves, never throws.
 * Caller should call with `void triggerCashDrawer(...)`.
 */
export async function triggerCashDrawer(locationId: string, terminalId?: string): Promise<void> {
  try {
    let printer: { id: string; ipAddress: string; port: number } | null = null
    let source = 'location-default'

    // 1. If terminalId provided, try the terminal's assigned receipt printer
    if (terminalId) {
      const terminal = await db.terminal.findUnique({
        where: { id: terminalId },
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
        source = `terminal "${terminal.name}" (${terminalId})`
      } else if (terminal) {
        log.info('[CashDrawer] Terminal "%s" has no active receipt printer — falling back to location default', terminal.name)
      }
    }

    // 2. Fall back to location default receipt printer
    if (!printer) {
      printer = await db.printer.findFirst({
        where: {
          locationId,
          printerRole: 'receipt',
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          ipAddress: true,
          port: true,
        },
      })
    }

    if (!printer) {
      log.warn('[CashDrawer] No active receipt printer found for location %s', locationId)
      return
    }

    const result = await sendToPrinter(printer.ipAddress, printer.port, ESCPOS.DRAWER_KICK)

    if (!result.success) {
      log.warn('[CashDrawer] Drawer kick failed (source: %s, printer: %s): %s', source, printer.id, result.error)
    } else {
      log.info('[CashDrawer] Drawer kicked via %s (printer: %s)', source, printer.id)
    }
  } catch (err) {
    // Non-critical — log and swallow so callers are never disrupted
    log.error({ err: err }, '[CashDrawer] Unexpected error triggering cash drawer:')
  }
}
