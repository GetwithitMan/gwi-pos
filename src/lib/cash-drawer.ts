import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import { ESCPOS } from '@/lib/escpos/commands'

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
      console.warn('[CashDrawer] No active receipt printer found for location', locationId)
      return
    }

    const result = await sendToPrinter(printer.ipAddress, printer.port, ESCPOS.DRAWER_KICK)

    if (!result.success) {
      console.warn('[CashDrawer] Drawer kick failed:', result.error)
    }
  } catch (err) {
    // Non-critical — log and swallow so callers are never disrupted
    console.error('[CashDrawer] Unexpected error triggering cash drawer:', err)
  }
}
