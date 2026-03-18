/**
 * PrintTemplateFactory - Bridge between OrderRouter manifests and ESC/POS printers
 *
 * Takes routing manifests from OrderRouter.resolveRouting() and produces
 * ESC/POS buffers sent to physical printers. This is the bridge that connects
 * the order send route (/api/orders/[id]/send/route.ts) to actual kitchen printing.
 *
 * For manual reprints and advanced edge cases (pizza sections, red ribbon, etc.),
 * use the full /api/print/kitchen route directly.
 */

import { db, adminDb } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import { dispatchPrintJobFailed } from '@/lib/socket-dispatch'
import { dispatchAlert } from '@/lib/alert-service'
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
  routingResult: RoutingResult,
  locationId?: string
): Promise<PrintResult[]> {
  const { order, manifests } = routingResult
  const results: PrintResult[] = []

  // Resolve locationId: prefer explicit parameter, else look up from order
  let resolvedLocationId = locationId || ''
  if (!resolvedLocationId) {
    try {
      const dbOrder = await adminDb.order.findUnique({
        where: { id: order.orderId },
        select: { locationId: true },
      })
      resolvedLocationId = dbOrder?.locationId || ''
    } catch {
      // Silent — locationId only needed for failover/alerts
    }
  }

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

      if (sendResult.success) {
        // Log PrintJob on success
        await logPrintJob(order.orderId, manifest, true)

        results.push({
          stationId: manifest.stationId,
          stationName: manifest.stationName,
          success: true,
          itemCount: manifest.primaryItems.length,
        })
      } else {
        // Primary printer failed — attempt backup printer failover
        const backupResult = await attemptBackupPrinter(
          resolvedLocationId, order, manifest, buffer, sendResult.error || 'Send failed'
        )

        if (backupResult) {
          // Backup succeeded
          results.push(backupResult)
        } else {
          // No backup or backup also failed — log failure, emit socket + alert
          await logPrintJob(order.orderId, manifest, false, sendResult.error)

          if (resolvedLocationId) {
            void dispatchPrintJobFailed(resolvedLocationId, {
              orderId: order.orderId,
              orderNumber: order.orderNumber,
              printerName: manifest.stationName,
              error: sendResult.error || 'Send failed',
            }, { async: true }).catch(console.error)

            void dispatchAlert({
              severity: 'HIGH',
              errorType: 'printer_failure',
              category: 'hardware',
              message: `Kitchen printer "${manifest.stationName}" failed for order #${order.orderNumber}: ${sendResult.error || 'Send failed'}`,
              locationId: resolvedLocationId,
              orderId: order.orderId,
            }).catch(console.error)
          }

          results.push({
            stationId: manifest.stationId,
            stationName: manifest.stationName,
            success: false,
            error: sendResult.error,
            itemCount: manifest.primaryItems.length,
          })
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`[PrintTemplateFactory] Error printing to ${manifest.stationName}:`, errorMsg)

      // Emit socket event for UI awareness
      if (resolvedLocationId) {
        void dispatchPrintJobFailed(resolvedLocationId, {
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          printerName: manifest.stationName,
          error: errorMsg,
        }, { async: true }).catch(console.error)
      }

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
 * Attempt to route a failed print job to a backup printer.
 *
 * Looks for a PrintRoute with a backupPrinter configured for the same station,
 * or falls back to any other active printer with the same role (kitchen/bar).
 * Returns a PrintResult on backup success, or null if no backup available or backup also failed.
 */
async function attemptBackupPrinter(
  locationId: string,
  order: OrderContext,
  manifest: RoutingManifest,
  buffer: Buffer,
  primaryError: string
): Promise<PrintResult | null> {
  if (!locationId) return null

  try {
    // Strategy 1: Check PrintRoute for a configured backup printer
    const route = await db.printRoute.findFirst({
      where: {
        locationId,
        printerId: { not: null },
        backupPrinterId: { not: null },
        deletedAt: null,
      },
      include: {
        printer: { select: { id: true, ipAddress: true, port: true, isActive: true, name: true } },
        backupPrinter: { select: { id: true, ipAddress: true, port: true, isActive: true, name: true } },
      },
    })

    // Match: the primary printer on this route matches the manifest's IP/port
    if (route?.printer && route.backupPrinter?.isActive &&
        route.printer.ipAddress === manifest.ipAddress &&
        route.printer.port === (manifest.port ?? 9100)) {
      const backup = route.backupPrinter
      console.log(`[PrintTemplateFactory] Trying backup printer "${backup.name}" for station "${manifest.stationName}"`)

      const backupSendResult = await sendToPrinter(backup.ipAddress, backup.port, buffer)
      if (backupSendResult.success) {
        // Log success against backup printer
        await logPrintJobForPrinter(order.orderId, backup.id, locationId, true)

        return {
          stationId: manifest.stationId,
          stationName: `${manifest.stationName} (backup: ${backup.name})`,
          success: true,
          itemCount: manifest.primaryItems.length,
        }
      }
      console.warn(`[PrintTemplateFactory] Backup printer "${backup.name}" also failed: ${backupSendResult.error}`)
    }

    // Strategy 2: Find any other active kitchen printer at this location
    const primaryPrinter = await db.printer.findFirst({
      where: {
        locationId,
        ipAddress: manifest.ipAddress ?? undefined,
        port: manifest.port ?? 9100,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, printerRole: true },
    })

    if (primaryPrinter) {
      const altPrinter = await db.printer.findFirst({
        where: {
          locationId,
          printerRole: primaryPrinter.printerRole,
          isActive: true,
          deletedAt: null,
          id: { not: primaryPrinter.id },
        },
        select: { id: true, name: true, ipAddress: true, port: true },
      })

      if (altPrinter) {
        console.log(`[PrintTemplateFactory] Trying alternate ${primaryPrinter.printerRole} printer "${altPrinter.name}"`)
        const altResult = await sendToPrinter(altPrinter.ipAddress, altPrinter.port, buffer)
        if (altResult.success) {
          await logPrintJobForPrinter(order.orderId, altPrinter.id, locationId, true)
          return {
            stationId: manifest.stationId,
            stationName: `${manifest.stationName} (fallback: ${altPrinter.name})`,
            success: true,
            itemCount: manifest.primaryItems.length,
          }
        }
        console.warn(`[PrintTemplateFactory] Alternate printer "${altPrinter.name}" also failed: ${altResult.error}`)
      }
    }

    return null
  } catch (err) {
    console.error('[PrintTemplateFactory] Backup printer lookup failed:', err)
    return null
  }
}

/**
 * Log a PrintJob record for a specific printer ID (used for backup printer logging).
 */
async function logPrintJobForPrinter(
  orderId: string,
  printerId: string,
  locationId: string,
  success: boolean,
  error?: string
): Promise<void> {
  try {
    await db.printJob.create({
      data: {
        locationId,
        jobType: 'kitchen',
        orderId,
        printerId,
        status: success ? 'sent' : 'failed',
        errorMessage: error || null,
        sentAt: new Date(),
      },
    })
  } catch (err) {
    console.error('[PrintTemplateFactory] Failed to log backup PrintJob:', err)
  }
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

    // Aggregate stacked modifiers by (name, preModifier, depth)
    const aggregatedMods = item.modifiers.reduce((acc, mod) => {
      const key = `${mod.name}|${mod.preModifier || ''}|${mod.depth || 0}`
      const existing = acc.find(a => a.key === key)
      if (existing) {
        existing.count++
      } else {
        acc.push({ ...mod, key, count: 1 })
      }
      return acc
    }, [] as (typeof item.modifiers[number] & { key: string; count: number })[])

    // Modifiers with depth indentation and pre-modifier labels
    for (const mod of aggregatedMods) {
      const indent = mod.depth > 0 ? '  '.repeat(mod.depth) + '- ' : '  '
      // T-042: handle compound preModifier strings (e.g. "side,extra" → "SIDE EXTRA Ranch")
      const preLabel = mod.preModifier
        ? mod.preModifier.split(',').map(t => t.trim().toUpperCase()).filter(Boolean).join(' ') + ' '
        : ''
      const countSuffix = mod.count > 1 ? ` ×${mod.count}` : ''
      const modText = `${preLabel}${mod.name.toUpperCase()}${countSuffix}`
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
