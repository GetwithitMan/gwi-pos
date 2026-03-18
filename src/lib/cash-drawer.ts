import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import { ESCPOS } from '@/lib/escpos/commands'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cash-drawer')

/**
 * Trigger a cash drawer kick on the receipt printer for the given location.
 *
 * Fire-and-forget safe: always resolves, never throws.
 * Caller should call with `void triggerCashDrawer(...)`.
 */
export async function triggerCashDrawer(locationId: string): Promise<void> {
  try {
    const printer = await db.printer.findFirst({
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

    if (!printer) {
      log.warn('[CashDrawer] No active receipt printer found for location', locationId)
      return
    }

    const result = await sendToPrinter(printer.ipAddress, printer.port, ESCPOS.DRAWER_KICK)

    if (!result.success) {
      log.warn('[CashDrawer] Drawer kick failed:', result.error)
    }
  } catch (err) {
    // Non-critical — log and swallow so callers are never disrupted
    log.error({ err: err }, '[CashDrawer] Unexpected error triggering cash drawer:')
  }
}
