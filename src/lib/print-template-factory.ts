/**
 * PrintTemplateFactory - Bridge between OrderRouter manifests and ESC/POS printers
 *
 * Takes routing manifests from OrderRouter.resolveRouting() and produces
 * ESC/POS buffers sent to physical printers. This is the bridge that connects
 * the TODO in /api/orders/[id]/send/route.ts to actual kitchen printing.
 *
 * For manual reprints and advanced edge cases (pizza sections, red ribbon, etc.),
 * use the full /api/print/kitchen route directly.
 */

import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import {
  buildDocument,
  buildDocumentNoCut,
  line,
  divider,
  ESCPOS,
  PAPER_WIDTH,
} from '@/lib/escpos/commands'
import type {
  RoutingManifest,
  RoutingResult,
  OrderContext,
} from '@/types/routing'

// Result for a single printer send attempt
export interface PrintResult {
  stationId: string
  stationName: string
  success: boolean
  error?: string
  itemCount: number
}

/**
 * Send kitchen tickets to all PRINTER-type stations in a routing result.
 *
 * Called fire-and-forget from the send-to-kitchen route after OrderRouter
 * produces manifests. Skips KDS stations (those are handled by socket dispatch).
 */
export async function printKitchenTicketsForManifests(
  routingResult: RoutingResult
): Promise<PrintResult[]> {
  const { order, manifests } = routingResult
  const results: PrintResult[] = []

  // Only process PRINTER stations — KDS is handled by sockets
  const printerManifests = manifests.filter((m) => m.type === 'PRINTER')

  if (printerManifests.length === 0) {
    return results
  }

  for (const manifest of printerManifests) {
    // Skip stations without network config
    if (!manifest.ipAddress || !manifest.port) {
      results.push({
        stationId: manifest.stationId,
        stationName: manifest.stationName,
        success: false,
        error: 'No IP address or port configured',
        itemCount: manifest.primaryItems.length,
      })
      continue
    }

    // Skip if no primary items to print
    if (manifest.primaryItems.length === 0) {
      continue
    }

    try {
      const buffer = buildTicketBuffer(order, manifest)
      const sendResult = await sendToPrinter(manifest.ipAddress, manifest.port, buffer)

      // Log PrintJob if we can find a matching Printer record
      await logPrintJob(order.orderId, manifest, sendResult.success, sendResult.error)

      results.push({
        stationId: manifest.stationId,
        stationName: manifest.stationName,
        success: sendResult.success,
        error: sendResult.error,
        itemCount: manifest.primaryItems.length,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`[PrintTemplateFactory] Error printing to ${manifest.stationName}:`, errorMsg)

      results.push({
        stationId: manifest.stationId,
        stationName: manifest.stationName,
        success: false,
        error: errorMsg,
        itemCount: manifest.primaryItems.length,
      })
    }
  }

  return results
}

/**
 * Build a complete ESC/POS buffer for a single station manifest.
 */
function buildTicketBuffer(order: OrderContext, manifest: RoutingManifest): Buffer {
  const isImpact = manifest.printerType === 'impact'
  const supportsCut = manifest.printerType !== 'impact' // impact printers typically don't cut
  const width = manifest.paperWidth === 58 ? PAPER_WIDTH['58mm'] : PAPER_WIDTH['80mm']
  const items = manifest.primaryItems

  // Size commands based on printer type
  const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
  const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
  const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE

  const content: Buffer[] = []

  // --- HEADER ---
  content.push(ESCPOS.ALIGN_CENTER)
  content.push(LARGE)
  content.push(line(manifest.stationName.toUpperCase()))
  content.push(NORMAL)

  // Resend indicator
  const isResend = items.some((i) => i.resendCount > 0)
  if (isResend) {
    content.push(ESCPOS.INVERSE_ON)
    content.push(LARGE)
    content.push(line('** RESEND **'))
    content.push(NORMAL)
    content.push(ESCPOS.INVERSE_OFF)
  }

  content.push(ESCPOS.ALIGN_LEFT)
  content.push(divider(width))

  // Order info
  content.push(TALL)
  content.push(line(`#${order.orderNumber}`))

  const orderTypeDisplay = order.orderType.toUpperCase()
    .replace('DINE_IN', 'DINE IN')
    .replace('BAR_TAB', 'BAR')
    .replace('TAKEOUT', 'TOGO')
    .replace('DELIVERY', 'DELIV')
  content.push(line(orderTypeDisplay))

  if (order.tableName) {
    content.push(line(order.tableName))
  } else if (order.tabName) {
    content.push(line(order.tabName))
  }
  content.push(NORMAL)

  content.push(line(`Server: ${order.employeeName}`))
  content.push(line(new Date().toLocaleTimeString()))
  content.push(divider(width))
  content.push(line(''))

  // --- ITEMS ---
  for (const item of items) {
    // Seat number prefix
    const positionPrefix = item.seatNumber ? `S${item.seatNumber}: ` : ''

    const itemName = `${positionPrefix}${item.quantity}x ${item.name}`.toUpperCase()
    content.push(TALL)
    if (!isImpact) content.push(ESCPOS.BOLD_ON)
    content.push(line(itemName))
    if (!isImpact) content.push(ESCPOS.BOLD_OFF)
    content.push(NORMAL)

    // Modifiers with depth indentation and pre-modifier labels
    for (const mod of item.modifiers) {
      const indent = mod.depth > 0 ? '  '.repeat(mod.depth) + '- ' : '  '
      const modText = mod.preModifier
        ? `${mod.preModifier.toUpperCase()} ${mod.name.toUpperCase()}`
        : mod.name.toUpperCase()
      content.push(line(`${indent}${modText}`))
    }

    // Ingredient modifications (NO/LITE/EXTRA)
    for (const ing of item.ingredientModifications) {
      const modType = ing.modificationType.toUpperCase()
      content.push(line(`  ${modType} ${ing.ingredientName.toUpperCase()}`))
    }

    // Special notes
    if (item.specialNotes) {
      if (!isImpact) content.push(ESCPOS.BOLD_ON)
      content.push(line(`  NOTE: ${item.specialNotes.toUpperCase()}`))
      if (!isImpact) content.push(ESCPOS.BOLD_OFF)
    }

    content.push(line(''))
  }

  // --- REFERENCE ITEMS (other items in the order, for context) ---
  if (manifest.showReferenceItems && manifest.referenceItems.length > 0) {
    content.push(divider(width, '.'))
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(line('--- OTHER ITEMS ---'))
    content.push(ESCPOS.ALIGN_LEFT)
    for (const ref of manifest.referenceItems) {
      content.push(line(`  ${ref.quantity}x ${ref.name}`))
    }
    content.push(line(''))
  }

  content.push(divider(width))

  // Build final document with or without cut
  if (supportsCut) {
    return buildDocument(...content)
  }
  return buildDocumentNoCut(...content)
}

/**
 * Log a PrintJob record. Since stations and printers are separate models,
 * we attempt to find a matching Printer by IP/port. If none exists,
 * we skip the PrintJob record rather than failing.
 */
async function logPrintJob(
  orderId: string,
  manifest: RoutingManifest,
  success: boolean,
  error?: string
): Promise<void> {
  try {
    // Find a Printer record matching this station's network config
    const printer = await db.printer.findFirst({
      where: {
        ipAddress: manifest.ipAddress ?? undefined,
        port: manifest.port ?? undefined,
        isActive: true,
        deletedAt: null,
      },
    })

    if (!printer) {
      // No matching Printer record — station-only config. Skip job logging.
      console.warn(
        `[PrintTemplateFactory] No Printer record for station "${manifest.stationName}" ` +
        `(${manifest.ipAddress}:${manifest.port}). PrintJob not logged.`
      )
      return
    }

    await db.printJob.create({
      data: {
        locationId: printer.locationId,
        jobType: 'kitchen',
        orderId,
        printerId: printer.id,
        status: success ? 'sent' : 'failed',
        errorMessage: error || null,
        sentAt: new Date(),
      },
    })
  } catch (err) {
    // Fire-and-forget: don't let logging failures break printing
    console.error('[PrintTemplateFactory] Failed to log PrintJob:', err)
  }
}
