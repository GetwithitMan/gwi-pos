import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import { getEligibleKitchenItems } from '@/lib/kitchen-item-filter'

import {
  buildDocument,
  buildDocumentNoCut,
  line,
  divider,
  ESCPOS,
  PAPER_WIDTH,
  truncateForPrint,
} from '@/lib/escpos/commands'
import { PizzaPrintSettings, DEFAULT_PIZZA_PRINT_SETTINGS, PrinterSettings, getDefaultPrinterSettings } from '@/types/print'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { queueIfOutage, pushUpstream } from '@/lib/sync/outage-safe-write'

interface PrintKitchenRequest {
  orderId: string
  itemIds?: string[] // Optional: only print specific items (for resends)
}

// POST /api/print/kitchen - Print kitchen ticket for an order
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body: PrintKitchenRequest = await request.json()
    const { orderId, itemIds } = body
    // Fetch order with items
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        table: true,
        employee: true,
        location: true,
        items: {
          include: {
            modifiers: {
              include: {
                modifier: {
                  select: {
                    printerRouting: true,
                    printerIds: true,
                    modifierGroup: {
                      select: {
                        nonePrintsToKitchen: true,
                      },
                    },
                  },
                },
              },
            },
            ingredientModifications: true,
            // Source table for seat tracking
            sourceTable: {
              select: {
                id: true,
                name: true,
                abbreviation: true,
              },
            },
            pizzaData: {
              include: {
                size: { select: { name: true, inches: true } },
                crust: { select: { name: true } },
                sauce: { select: { name: true } },
                cheese: { select: { name: true } },
              },
            },
            menuItem: {
              select: {
                id: true,
                categoryId: true,
                printerIds: true,
                backupPrinterIds: true,
                category: {
                  select: {
                    id: true,
                    name: true,
                    printerIds: true,
                    categoryType: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Fetch delivery customer info from DeliveryOrder table (raw SQL, not in Prisma schema)
    let deliveryInfo: { customerName?: string | null; customerPhone?: string | null; deliveryAddress?: string | null; deliveryInstructions?: string | null; source?: string | null } = {}
    if (order.orderType?.startsWith('delivery')) {
      try {
        const rows: Array<{ customerName: string | null; phone: string | null; address: string | null; addressLine2: string | null; city: string | null; state: string | null; zipCode: string | null; notes: string | null }> = await db.$queryRawUnsafe(
          `SELECT "customerName", "phone", "address", "addressLine2", "city", "state", "zipCode", "notes"
           FROM "DeliveryOrder" WHERE "orderId" = $1 LIMIT 1`,
          orderId
        )
        if (rows.length > 0) {
          const row = rows[0]
          const addrParts = [row.address, row.addressLine2, row.city, row.state, row.zipCode].filter(Boolean)
          deliveryInfo = {
            customerName: row.customerName,
            customerPhone: row.phone,
            deliveryAddress: addrParts.length > 0 ? addrParts.join(', ') : null,
            deliveryInstructions: row.notes,
            source: (order as any).source || null,
          }
        }
      } catch {
        // Non-fatal: delivery info is supplementary for ticket printing
      }
    }

    // Enrich order with delivery fields for ticket rendering
    const orderWithDelivery = {
      ...order,
      ...deliveryInfo,
    }

    // Filter items using shared kitchen eligibility logic (aligned with send route)
    // Always exclude held items — they should not print until explicitly fired
    // Fallback: print items that have been sent to kitchen (not pending/delayed/held/completed)
    const itemsToPrint = getEligibleKitchenItems(order.items, {
      filterItemIds: itemIds,
      expectedStatus: 'sent',
      excludeCompleted: true,
    })

    if (itemsToPrint.length === 0) {
      return NextResponse.json({ data: { message: 'No items to print' } })
    }

    // Pre-fetch PizzaSpecialty names for pizza items (keyed by menuItemId)
    const pizzaMenuItemIds = itemsToPrint
      .filter(item => item.pizzaData && item.menuItem?.id)
      .map(item => item.menuItem!.id)
    const specialtyMap = new Map<string, string>()
    if (pizzaMenuItemIds.length > 0) {
      const specialties = await db.pizzaSpecialty.findMany({
        where: { menuItemId: { in: pizzaMenuItemIds } },
        select: { menuItemId: true, menuItem: { select: { name: true } } },
      })
      for (const s of specialties) {
        specialtyMap.set(s.menuItemId, s.menuItem.name)
      }
    }

    // Attach specialtyName to pizza items for ticket rendering
    const enrichedItems = itemsToPrint.map(item => ({
      ...item,
      _specialtyName: (item.menuItem?.id && specialtyMap.get(item.menuItem.id)) || null,
    }))

    // Get all printers for the location
    const allPrinters = await db.printer.findMany({
      where: {
        locationId: order.locationId,
        isActive: true,
        printerRole: { in: ['kitchen', 'bar'] },
      },
    })
    // Alias for existing code compatibility
    const printers = allPrinters

    // Get default kitchen printer
    const defaultKitchenPrinter = printers.find(p => p.printerRole === 'kitchen' && p.isDefault)
      || printers.find(p => p.printerRole === 'kitchen')
    // Get pizza config for pizza-specific routing and print settings
    const pizzaConfig = await db.pizzaConfig.findUnique({
      where: { locationId: order.locationId },
    })
    const pizzaPrinterIds = (pizzaConfig?.printerIds as unknown as string[]) || []
    const printSettings: PizzaPrintSettings = (pizzaConfig?.printSettings as unknown as PizzaPrintSettings) || DEFAULT_PIZZA_PRINT_SETTINGS

    // Fetch PrintRoutes ordered by priority (highest first)
    const printRoutes = await db.printRoute.findMany({
      where: { locationId: order.locationId, isActive: true, deletedAt: null },
      orderBy: { priority: 'desc' },
    })

    // Group items by printer
    // Also track which PrintRoute corresponds to each printer group for failover
    const itemsByPrinter: Map<string, typeof enrichedItems> = new Map()
    const routeForPrinterMap: Map<string, typeof printRoutes[0]> = new Map()

    for (const item of enrichedItems) {
      // Check if this is a pizza item
      if (item.pizzaData && pizzaPrinterIds.length > 0) {
        // Pizza items go to all configured pizza printers
        for (const printerId of pizzaPrinterIds) {
          const existing = itemsByPrinter.get(printerId) || []
          existing.push(item)
          itemsByPrinter.set(printerId, existing)
        }
        continue
      }

      // Priority: PrintRoute > Item printers > Category printers > Default kitchen printer
      // Multiple printers are supported at each level
      let targetPrinterIds: string[] = []
      let matchedRoute: typeof printRoutes[0] | null = null

      // 1. Check PrintRoutes first (highest priority tier)
      for (const route of printRoutes) {
        if (!route.printerId) continue
        const routeCategoryIds = route.categoryIds as string[] | null
        const routeItemTypes = route.itemTypes as string[] | null

        if (
          route.routeType === 'category' &&
          routeCategoryIds &&
          item.menuItem?.categoryId &&
          routeCategoryIds.includes(item.menuItem.categoryId)
        ) {
          targetPrinterIds = [route.printerId]
          matchedRoute = route
          break
        } else if (
          route.routeType === 'item_type' &&
          routeItemTypes &&
          item.menuItem?.category?.categoryType &&
          routeItemTypes.includes(item.menuItem.category.categoryType)
        ) {
          targetPrinterIds = [route.printerId]
          matchedRoute = route
          break
        }
      }

      // 2. Fall back to item/category/default if no PrintRoute matched
      if (targetPrinterIds.length === 0) {
        const itemPrinterIds = item.menuItem?.printerIds as string[] | null
        const categoryPrinterIds = item.menuItem?.category?.printerIds as string[] | null

        if (itemPrinterIds && itemPrinterIds.length > 0) {
          targetPrinterIds = itemPrinterIds
        } else if (categoryPrinterIds && categoryPrinterIds.length > 0) {
          targetPrinterIds = categoryPrinterIds
        } else if (defaultKitchenPrinter) {
          targetPrinterIds = [defaultKitchenPrinter.id]
        }
      }

      // If still no printer, log it
      if (targetPrinterIds.length === 0) {
        console.error('[Kitchen Print] No printer found for item:', item.name)
      }

      // Determine which modifiers follow the main item vs. route elsewhere
      const mainItemModifiers = item.modifiers.filter(mod => {
        const modPrinterRouting = mod.modifier?.printerRouting ?? 'follow'
        // If follow (default), always stays with main item
        if (modPrinterRouting === 'follow') return true
        // If routing is 'only', exclude from main item
        if (modPrinterRouting === 'only') return false
        // If routing is 'also', keep in main item (AND also send elsewhere)
        return true
      })

      // Build synthetic item for main printer groups (with filtered modifiers)
      const mainItem = mainItemModifiers.length === item.modifiers.length
        ? item
        : { ...item, modifiers: mainItemModifiers }

      // Add main item to each target printer
      for (const printerId of targetPrinterIds) {
        const existing = itemsByPrinter.get(printerId) || []
        existing.push(mainItem)
        itemsByPrinter.set(printerId, existing)
        if (matchedRoute && !routeForPrinterMap.has(printerId)) {
          routeForPrinterMap.set(printerId, matchedRoute)
        }
      }

      // Handle modifier routing: 'also' and 'only' modifiers go to their own printers
      for (const mod of item.modifiers) {
        const modPrinterRouting = mod.modifier?.printerRouting ?? 'follow'
        const modPrinterIds = mod.modifier?.printerIds as string[] | null
        if (modPrinterRouting === 'follow') continue
        if (!modPrinterIds || modPrinterIds.length === 0) continue

        // 'also' and 'only' both route this modifier to its own printers
        const syntheticItem = {
          ...item,
          modifiers: [mod],
          _modifierOnlyFor: item.name,
        } as typeof enrichedItems[0] & { _modifierOnlyFor: string }

        for (const modPrinterId of modPrinterIds) {
          const existing = itemsByPrinter.get(modPrinterId) || []
          existing.push(syntheticItem)
          itemsByPrinter.set(modPrinterId, existing)
        }
      }
    }

    // Print to each printer
    const results: { printerId: string; printerName: string; success: boolean; error?: string }[] = []

    for (const [printerId, items] of itemsByPrinter) {
      const printer = printers.find(p => p.id === printerId)
      if (!printer) {
        continue
      }

      const width = printer.paperWidth === 58 ? PAPER_WIDTH['58mm'] : PAPER_WIDTH['80mm']

      // Get printer-specific settings (from printer or defaults based on type)
      const printerSettings: PrinterSettings = (printer.printSettings as unknown as PrinterSettings)
        || getDefaultPrinterSettings(printer.printerType)

      // Build the ticket content - pass printer type and settings for formatting
      try {
        const ticketContent = buildKitchenTicket(orderWithDelivery, items, width, printer.printerType, printSettings, printerSettings)
        // Build document with or without cut
        const document = printer.supportsCut
          ? buildDocument(...ticketContent)
          : buildDocumentNoCut(...ticketContent)
        // Send to printer — with backup printer failover
        let result = await sendToPrinter(printer.ipAddress, printer.port, document)

        // BUG 23: Fire-and-forget printer health update after print attempt
        void db.printer.update({
          where: { id: printer.id },
          data: { lastPingAt: new Date(), lastPingOk: result.success }
        }).catch(console.error)

        if (!result.success) {
          // W1-PR2: Try backup printer — PrintRoute first, then item-level backupPrinterIds
          const routeForPrinter = routeForPrinterMap.get(printerId) ?? null
          let backupPrinterId: string | null = routeForPrinter?.backupPrinterId ?? null

          // Fall back to item-level backupPrinterIds if no route-level backup
          if (!backupPrinterId) {
            for (const item of items) {
              const itemBackupIds = item.menuItem?.backupPrinterIds as string[] | null
              if (itemBackupIds && itemBackupIds.length > 0) {
                backupPrinterId = itemBackupIds[0]
                break
              }
            }
          }

          if (backupPrinterId) {
            const backupPrinter = allPrinters.find(p => p.id === backupPrinterId)
            if (backupPrinter) {
              const backupResult = await sendToPrinter(backupPrinter.ipAddress, backupPrinter.port, document)

              // BUG 23: Fire-and-forget printer health update for backup printer
              void db.printer.update({
                where: { id: backupPrinter.id },
                data: { lastPingAt: new Date(), lastPingOk: backupResult.success }
              }).catch(console.error)

              // BUG 24: Fire-and-forget audit log for printer failover
              void db.auditLog.create({
                data: {
                  locationId: order.locationId,
                  employeeId: null,
                  action: 'printer_failover',
                  entityType: 'printer',
                  entityId: printer.id,
                  details: {
                    primaryPrinterId: printer.id,
                    backupPrinterId: backupPrinter.id,
                    orderId: order.id,
                    reason: 'primary_print_failed'
                  }
                }
              }).catch(console.error)

              if (backupResult.success) {
                // Log the failover print job
                void db.printJob.create({
                  data: {
                    locationId: order.locationId,
                    jobType: 'kitchen',
                    orderId: order.id,
                    printerId: backupPrinter.id,
                    status: 'sent',
                    sentAt: new Date(),
                  },
                }).catch(console.error)
                // Treat the overall result as success via backup
                result = backupResult
              } else {
                console.error('[Print] Backup printer also failed:', backupResult.error)
              }
            }
          }
        }

        // Log the print job — queue for retry if both primary and backup failed
        if (result.success) {
          const pj = await db.printJob.create({
            data: {
              locationId: order.locationId,
              jobType: 'kitchen',
              orderId: order.id,
              printerId: printer.id,
              status: 'sent',
              sentAt: new Date(),
            },
          })
          queueIfOutage('PrintJob', order.locationId, pj.id, 'INSERT')
        } else {
          // Both primary and backup failed — queue for retry with stored content
          const pj = await db.printJob.create({
            data: {
              locationId: order.locationId,
              jobType: 'kitchen',
              orderId: order.id,
              printerId: printer.id,
              status: 'queued',
              retryCount: 0,
              errorMessage: result.error || 'Primary and backup print failed',
              content: document.toString('base64'), // Store ESC/POS buffer for retry
            },
          })
          queueIfOutage('PrintJob', order.locationId, pj.id, 'INSERT')
          console.warn(`[Kitchen Print] Queued for retry — order ${order.orderNumber}, printer ${printer.name}`)
        }

        results.push({
          printerId: printer.id,
          printerName: printer.name,
          success: result.success,
          error: result.error,
        })
      } catch (ticketError) {
        console.error('[Kitchen Print] Error building/sending ticket:', ticketError)
        results.push({
          printerId: printer.id,
          printerName: printer.name,
          success: false,
          error: String(ticketError),
        })
      }
    }

    // Mark items as sent to kitchen
    if (results.some(r => r.success)) {
      const now = new Date()
      await db.orderItem.updateMany({
        where: { id: { in: itemsToPrint.map(i => i.id) } },
        data: { kitchenStatus: 'cooking', kitchenSentAt: now },
      })

      // Fire-and-forget: emit ITEM_UPDATED per item for event-sourced sync
      void emitOrderEvents(order.locationId, order.id, itemsToPrint.map(item => ({
        type: 'ITEM_UPDATED' as const,
        payload: { lineItemId: item.id, kitchenStatus: 'cooking' },
      })))
    }

    pushUpstream()

    return NextResponse.json({ data: {
      success: results.some(r => r.success),
      results,
    } })
  } catch (error) {
    console.error('Failed to print kitchen ticket:', error)
    return NextResponse.json({ error: 'Failed to print kitchen ticket' }, { status: 500 })
  }
}))

// Build kitchen ticket content
function buildKitchenTicket(
  order: {
    orderNumber: number
    orderType: string
    tabName: string | null
    table: { name: string } | null
    employee: { displayName: string | null; firstName: string; lastName: string }
    createdAt: Date
    notes?: string | null
    // Delivery customer info
    customerName?: string | null
    customerPhone?: string | null
    deliveryAddress?: string | null
    deliveryInstructions?: string | null
    source?: string | null
  },
  items: Array<{
    id: string
    name: string
    quantity: number
    seatNumber: number | null  // T023: Seat assignment
    sourceTableId: string | null
    sourceTable: { id: string; name: string; abbreviation: string | null } | null
    specialNotes: string | null
    resendCount: number
    // Weight-based item fields
    soldByWeight: boolean | null
    weight: unknown | null  // Prisma Decimal
    weightUnit: string | null
    tareWeight: unknown | null  // Prisma Decimal
    modifiers: Array<{
      name: string
      preModifier: string | null
      depth: number
      isCustomEntry?: boolean
      isNoneSelection?: boolean
      customEntryName?: string | null
      swapTargetName?: string | null
      modifier?: {
        modifierGroup?: {
          nonePrintsToKitchen?: boolean
        } | null
      } | null
    }>
    ingredientModifications: Array<{
      ingredientName: string
      modificationType: string
    }>
    pizzaData: {
      sizeId: string
      crustId: string
      cookingInstructions: string | null
      cutStyle: string | null
      toppingsData: unknown
      sauceAmount: string
      cheeseAmount: string
      size: { name: string; inches: number | null } | null
      crust: { name: string } | null
      sauce: { name: string } | null
      cheese: { name: string } | null
    } | null
    _modifierOnlyFor?: string
    _specialtyName?: string | null
    pricingOptionLabel?: string | null
  }>,
  width: number,
  printerType: string = 'thermal',
  settings: PizzaPrintSettings = DEFAULT_PIZZA_PRINT_SETTINGS,
  printerSettings: PrinterSettings = getDefaultPrinterSettings('thermal')
): Buffer[] {
  const content: Buffer[] = []
  const isImpact = printerType === 'impact'

  // PRIORITY: Pizza Print Settings > Printer Settings
  // Use pizza settings if available, fall back to printer settings

  // Red ribbon - pizza settings take priority
  const hasRed = settings.redRibbon?.enabled ?? printerSettings.ribbon.hasRedRibbon
  const useRedResend = settings.redRibbon?.useRedForResend ?? printerSettings.ribbon.useRedForResend
  const useRedNoItems = settings.redRibbon?.useRedForNoItems ?? printerSettings.ribbon.useRedForNoItems
  const useRedNotes = settings.redRibbon?.useRedForNotes ?? printerSettings.ribbon.useRedForNotes
  const useRedHeaders = settings.redRibbon?.useRedForHeaders ?? printerSettings.ribbon.useRedForHeaders
  const useRedModifiers = settings.redRibbon?.useRedForModifiers ?? false
  const useRedExtraItems = settings.redRibbon?.useRedForExtraItems ?? false
  const useRedLightItems = settings.redRibbon?.useRedForLightItems ?? false
  const useRedItemNames = settings.redRibbon?.useRedForItemNames ?? false

  // Text sizing - pizza settings take priority
  const headerSize = settings.textSizing?.headerSize ?? printerSettings.textSizing.headerSize
  const itemNameSize = settings.textSizing?.itemNameSize ?? printerSettings.textSizing.itemNameSize
  const modifierSize = settings.textSizing?.modifierSize ?? printerSettings.textSizing.modifierSize
  const notesSize = settings.textSizing?.notesSize ?? printerSettings.textSizing.notesSize

  // Formatting - pizza settings take priority
  const allCapsItems = settings.formatting?.allCapsItemNames ?? printerSettings.formatting.allCapsItems
  const allCapsMods = settings.formatting?.allCapsModifiers ?? printerSettings.formatting.allCapsMods
  const boldItems = settings.formatting?.boldItemNames ?? true
  const boldMods = settings.formatting?.boldModifiers ?? false

  // Use correct commands based on printer type
  const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
  const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
  const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE
  const RED = ESCPOS.COLOR_RED
  const BLACK = ESCPOS.COLOR_BLACK

  // Get size command based on settings
  const getSizeCommand = (size: 'small' | 'normal' | 'large' | 'xlarge') => {
    switch (size) {
      case 'small': return NORMAL
      case 'normal': return isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.NORMAL_SIZE
      case 'large': return TALL
      case 'xlarge': return LARGE
      default: return NORMAL
    }
  }

  // For text that might be long, use height-only scaling to prevent wrapping
  // Double-width effectively halves the available characters
  const getSmartSizeCommand = (size: 'small' | 'normal' | 'large' | 'xlarge', textLength: number) => {
    const maxCharsForDoubleWidth = width / 2 - 2 // Account for double-width cutting chars in half
    if (textLength > maxCharsForDoubleWidth && (size === 'xlarge' || size === 'large')) {
      // Use tall (height only) instead of large/xlarge (width+height) to prevent wrapping
      return TALL
    }
    return getSizeCommand(size)
  }

  // Helper to apply red color if supported and enabled
  const withColor = (useRed: boolean, buffers: Buffer[]): Buffer[] => {
    if (hasRed && useRed) {
      return [RED, ...buffers, BLACK]
    }
    return buffers
  }

  // For impact printers, use double-size for important text
  // Uses smart sizing to prevent text wrapping
  const headerLine = (text: string, size: 'normal' | 'large' | 'xlarge' = 'large', useRed: boolean = false) => {
    const sizeCmd = getSmartSizeCommand(size, text.length)
    const parts = [sizeCmd, line(text), NORMAL]
    return Buffer.concat(withColor(useRed, parts))
  }

  const importantLine = (text: string, size: 'normal' | 'large' | 'xlarge' = 'large', useRed: boolean = false, bold: boolean = false) => {
    if (size === 'normal' && !isImpact && bold) {
      const parts = [ESCPOS.BOLD_ON, line(text), ESCPOS.BOLD_OFF]
      return Buffer.concat(withColor(useRed, parts))
    }
    // Use smart sizing to prevent long text from wrapping
    const sizeCmd = getSmartSizeCommand(size, text.length)
    const parts: Buffer[] = []
    parts.push(sizeCmd)
    if (bold && !isImpact) parts.push(ESCPOS.BOLD_ON)
    parts.push(line(text))
    if (bold && !isImpact) parts.push(ESCPOS.BOLD_OFF)
    parts.push(NORMAL)
    return Buffer.concat(withColor(useRed, parts))
  }

  // Get topping size command
  const toppingSizeCmd = getSizeCommand(modifierSize)

  // HEADER
  content.push(ESCPOS.ALIGN_CENTER)
  content.push(headerLine('KITCHEN', headerSize, useRedHeaders))

  // Check if this is a resend
  const isResend = items.some(i => i.resendCount > 0)
  if (isResend) {
    if (hasRed && useRedResend) {
      content.push(RED)
    }
    content.push(ESCPOS.INVERSE_ON)
    content.push(headerLine('** RESEND **', headerSize))
    content.push(ESCPOS.INVERSE_OFF)
    if (hasRed && useRedResend) {
      content.push(BLACK)
    }
  }

  content.push(ESCPOS.ALIGN_LEFT)
  content.push(divider(width))

  // ORDER INFO
  const orderSizeCmd = getSizeCommand(headerSize)

  if (hasRed && useRedHeaders) content.push(RED)
  content.push(orderSizeCmd)

  // Order number on its own line, order type abbreviated to fit
  content.push(line(`#${order.orderNumber}`))

  // Order type - platform-specific delivery labels, abbreviate common types
  const orderTypeDisplayMap: Record<string, string> = {
    'delivery_doordash': 'DOORDASH',
    'delivery_ubereats': 'UBER EATS',
    'delivery_grubhub': 'GRUBHUB',
  }
  const orderTypeDisplay = orderTypeDisplayMap[order.orderType]
    || order.orderType.toUpperCase()
      .replace('DINE_IN', 'DINE IN')
      .replace('BAR_TAB', 'BAR')
      .replace('TAKEOUT', 'TOGO')
      .replace('DELIVERY', 'DELIVERY')
  content.push(line(orderTypeDisplay))

  if (order.table) {
    content.push(line(order.table.name))
  } else if (order.tabName) {
    content.push(line(order.tabName))
  }
  content.push(NORMAL)
  if (hasRed && useRedHeaders) content.push(BLACK)

  const serverName = order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`
  content.push(line(`Server: ${serverName}`))
  content.push(line(new Date().toLocaleTimeString()))

  content.push(divider(width))

  // Delivery customer info section
  if (order.orderType?.startsWith('delivery') && (order.customerName || order.deliveryAddress)) {
    content.push(line(''))
    const isImpact = printerType === 'impact'

    // Platform name banner
    if (order.source) {
      content.push(ESCPOS.ALIGN_CENTER)
      content.push(getSizeCommand(headerSize))
      content.push(line(`** ${order.source.toUpperCase()} DELIVERY **`))
      content.push(NORMAL)
      content.push(ESCPOS.ALIGN_LEFT)
    }

    if (!isImpact) content.push(ESCPOS.BOLD_ON)
    if (order.customerName) {
      content.push(line(`CUSTOMER: ${order.customerName}`))
    }
    if (order.customerPhone) {
      content.push(line(`PHONE: ${order.customerPhone}`))
    }
    if (!isImpact) content.push(ESCPOS.BOLD_OFF)

    if (order.deliveryAddress) {
      content.push(line(`DELIVER TO: ${order.deliveryAddress}`))
    }

    if (order.deliveryInstructions) {
      content.push(line(''))
      if (!isImpact) content.push(ESCPOS.BOLD_ON)
      content.push(line(`!! ${order.deliveryInstructions} !!`))
      if (!isImpact) content.push(ESCPOS.BOLD_OFF)
    }

    content.push(divider(width))
  }

  content.push(line(''))

  // SEAT ALLERGY NOTES — parsed from Order.notes JSON
  if (order.notes) {
    try {
      const parsed = JSON.parse(order.notes)
      if (parsed && typeof parsed === 'object' && parsed.seatAllergies) {
        const seatAllergies = parsed.seatAllergies as Record<string, string>
        const seatEntries = Object.entries(seatAllergies).filter(([, notes]) => notes && notes.trim())
        if (seatEntries.length > 0) {
          // Sort by seat number
          seatEntries.sort((a, b) => Number(a[0]) - Number(b[0]))

          if (hasRed && useRedNotes) content.push(RED)
          content.push(getSizeCommand(notesSize))
          if (!isImpact) content.push(ESCPOS.BOLD_ON)
          for (const [seat, notes] of seatEntries) {
            const allergyLine = truncateForPrint(`!! SEAT ${seat}: ${notes.toUpperCase()}`, width)
            content.push(line(allergyLine))
          }
          if (!isImpact) content.push(ESCPOS.BOLD_OFF)
          content.push(NORMAL)
          if (hasRed && useRedNotes) content.push(BLACK)

          content.push(divider(width))
          content.push(line(''))
        }
      }
    } catch {
      // Not JSON or parse error — legacy text, skip allergy rendering
    }
  }

  // ITEMS
  for (const item of items) {
    // Item name with quantity and seat notation
    // Format: S3 = Seat 3
    let positionPrefix = ''
    if (item.sourceTable) {
      const tablePrefix = item.sourceTable.abbreviation || item.sourceTable.name.slice(0, 4)
      if (item.seatNumber) {
        positionPrefix = `${tablePrefix}-S${item.seatNumber}: `
      } else {
        positionPrefix = `${tablePrefix}: `
      }
    } else if (item.seatNumber) {
      // Regular seat number only
      positionPrefix = `S${item.seatNumber}: `
    }
    // Modifier-only context line: show which item this modifier belongs to
    if (item._modifierOnlyFor) {
      content.push(NORMAL)
      content.push(line(`FOR: ${item._modifierOnlyFor}`))
    }

    // Weight-based items show weight instead of quantity
    let itemName: string
    if (item.soldByWeight && item.weight != null) {
      const w = Number(item.weight).toFixed(3)
      const unit = item.weightUnit || 'lb'
      const netLabel = item.tareWeight != null && Number(item.tareWeight) > 0 ? ' (NET)' : ''
      itemName = `${positionPrefix}${w} ${unit} ${item.name}${netLabel}`
    } else {
      itemName = `${positionPrefix}${item.quantity}x ${item.name}`
    }
    if (allCapsItems) itemName = itemName.toUpperCase()
    itemName = truncateForPrint(itemName, width)
    content.push(importantLine(itemName, itemNameSize, useRedItemNames, boldItems))

    // Pizza specialty label (e.g., "*** MEAT LOVERS ***")
    if (item._specialtyName && item.pizzaData) {
      content.push(TALL)
      content.push(ESCPOS.BOLD_ON)
      content.push(line(`*** ${item._specialtyName.toUpperCase()} ***`))
      content.push(ESCPOS.BOLD_OFF)
      content.push(NORMAL)
    }

    // Pricing option label-only line (e.g., "** HOT **" for label-only pricing options)
    if (item.pricingOptionLabel && !item.name.includes(`(${item.pricingOptionLabel})`)) {
      content.push(toppingSizeCmd)
      content.push(ESCPOS.BOLD_ON)
      content.push(line(`  ** ${item.pricingOptionLabel.toUpperCase()} **`))
      content.push(ESCPOS.BOLD_OFF)
      content.push(NORMAL)
    }

    // Modifiers - SKIP for pizza items (pizzaData has the organized toppings)
    if (!item.pizzaData) {
      for (const mod of item.modifiers) {
        // Skip "None" selections unless the parent group has nonePrintsToKitchen enabled
        if (mod.isNoneSelection && !mod.modifier?.modifierGroup?.nonePrintsToKitchen) continue
        const prefix = mod.depth > 0 ? '  '.repeat(mod.depth) + '- ' : '  '
        // T-042: handle compound preModifier strings (e.g. "side,extra" → "Side Extra Ranch")
        const preLabel = mod.preModifier
          ? mod.preModifier.split(',').map(t => t.trim()).filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ') + ' '
          : ''
        const customPrefix = mod.isNoneSelection ? '' : mod.isCustomEntry ? 'CUSTOM: ' : ''
        const swapSuffix = mod.swapTargetName ? ` → ${mod.swapTargetName}` : ''
        let modLine = `${customPrefix}${preLabel}${mod.name}${swapSuffix}`
        if (allCapsMods) {
          modLine = modLine.toUpperCase()
        }
        const fullModLine = truncateForPrint(`${prefix}${modLine}`, width)
        // Apply red for modifiers if enabled
        if (hasRed && useRedModifiers) content.push(RED)
        content.push(toppingSizeCmd)
        if (boldMods && !isImpact) {
          content.push(ESCPOS.BOLD_ON)
        }
        content.push(line(fullModLine))
        if (boldMods && !isImpact) {
          content.push(ESCPOS.BOLD_OFF)
        }
        content.push(NORMAL)
        if (hasRed && useRedModifiers) content.push(BLACK)
      }
    }

    // Ingredient modifications
    for (const ing of item.ingredientModifications) {
      const modType = ing.modificationType.toUpperCase()

      if (modType === 'NO' && settings.modifications.highlightNo) {
        // NO items - use settings and RED if enabled
        const noStyle = settings.modifications.noStyle
        const noPrefix = settings.modifications.noPrefix || 'NO'

        // Apply red color for NO items if enabled
        if (hasRed && useRedNoItems) content.push(RED)

        if (noStyle === 'all' || noStyle === 'inverted') {
          content.push(LARGE)
          content.push(ESCPOS.INVERSE_ON)
          content.push(line(`** ${noPrefix} ${ing.ingredientName.toUpperCase()} **`))
          content.push(ESCPOS.INVERSE_OFF)
          content.push(NORMAL)
        } else {
          content.push(toppingSizeCmd)
          if (noStyle === 'bold' && !isImpact) content.push(ESCPOS.BOLD_ON)
          const noText = noStyle === 'boxed'
            ? `[${noPrefix} ${ing.ingredientName.toUpperCase()}]`
            : `${noPrefix} ${ing.ingredientName.toUpperCase()}`
          content.push(line(`  ${noText}`))
          if (noStyle === 'bold' && !isImpact) content.push(ESCPOS.BOLD_OFF)
          content.push(NORMAL)
        }

        // Reset to black after NO item
        if (hasRed && useRedNoItems) content.push(BLACK)
      } else if (modType === 'EXTRA' && settings.modifications.highlightExtra) {
        // EXTRA items - use settings and RED if enabled
        const extraPrefix = settings.modifications.extraPrefix || 'EXTRA'
        const extraStyle = settings.modifications.extraStyle
        let extraText = `${extraPrefix} ${ing.ingredientName}`
        if (extraStyle === 'caps' || extraStyle === 'all') extraText = extraText.toUpperCase()
        if (extraStyle === 'boxed') extraText = `[${extraText}]`

        // Apply red for EXTRA items if enabled
        if (hasRed && useRedExtraItems) content.push(RED)
        content.push(toppingSizeCmd)
        if ((extraStyle === 'bold' || extraStyle === 'all') && !isImpact) content.push(ESCPOS.BOLD_ON)
        content.push(line(`  ${extraText}`))
        if ((extraStyle === 'bold' || extraStyle === 'all') && !isImpact) content.push(ESCPOS.BOLD_OFF)
        content.push(NORMAL)
        if (hasRed && useRedExtraItems) content.push(BLACK)
      } else if (modType === 'LITE' && settings.modifications.highlightLight) {
        // LIGHT items - use settings and RED if enabled
        const lightPrefix = settings.modifications.lightPrefix || 'LIGHT'
        let lightText = `${lightPrefix} ${ing.ingredientName}`
        if (settings.modifications.lightStyle === 'caps') lightText = lightText.toUpperCase()

        // Apply red for LIGHT items if enabled
        if (hasRed && useRedLightItems) content.push(RED)
        content.push(toppingSizeCmd)
        if (settings.modifications.lightStyle === 'bold' && !isImpact) content.push(ESCPOS.BOLD_ON)
        content.push(line(`  ${lightText}`))
        if (settings.modifications.lightStyle === 'bold' && !isImpact) content.push(ESCPOS.BOLD_OFF)
        content.push(NORMAL)
        if (hasRed && useRedLightItems) content.push(BLACK)
      } else {
        // Default modification display
        content.push(toppingSizeCmd)
        content.push(line(`  ${modType} ${ing.ingredientName}`))
        content.push(NORMAL)
      }
    }

    // Pizza-specific formatting - pass priority settings
    if (item.pizzaData) {
      content.push(line(''))
      content.push(buildPizzaSection(item.pizzaData, width, isImpact, settings, hasRed, useRedNotes, useRedModifiers, modifierSize, notesSize))
    }

    // Special notes - use settings and priority settings for red
    if (item.specialNotes && settings.specialInstructions.show) {
      const noteStyle = settings.specialInstructions.style
      const noteLabel = settings.specialInstructions.label || 'NOTE:'
      let noteText = `${noteLabel} ${item.specialNotes}`
      if (settings.specialInstructions.allCaps) noteText = noteText.toUpperCase()

      // Apply red for notes if enabled
      if (hasRed && useRedNotes) content.push(RED)

      if (noteStyle === 'inverted') {
        content.push(getSizeCommand(notesSize))
        content.push(ESCPOS.INVERSE_ON)
        content.push(line(noteText))
        content.push(ESCPOS.INVERSE_OFF)
        content.push(NORMAL)
      } else {
        content.push(getSizeCommand(notesSize))
        if (noteStyle === 'bold' && !isImpact) content.push(ESCPOS.BOLD_ON)
        const finalText = noteStyle === 'boxed' ? `[${noteText}]` : noteText
        content.push(line(finalText))
        if (noteStyle === 'bold' && !isImpact) content.push(ESCPOS.BOLD_OFF)
        content.push(NORMAL)
      }

      // Reset to black after notes
      if (hasRed && useRedNotes) content.push(BLACK)
    }

    content.push(line(''))
  }

  content.push(divider(width))

  return content
}

// Build pizza section details
function buildPizzaSection(
  pizzaData: {
    cookingInstructions: string | null
    cutStyle: string | null
    toppingsData: unknown
    sauceAmount: string
    cheeseAmount: string
    size: { name: string; inches: number | null } | null
    crust: { name: string } | null
    sauce: { name: string } | null
    cheese: { name: string } | null
  },
  width: number,
  isImpact: boolean = false,
  settings: PizzaPrintSettings = DEFAULT_PIZZA_PRINT_SETTINGS,
  hasRed: boolean = false,
  useRedForNotes: boolean = false,
  useRedForModifiers: boolean = false,
  modifierSize: 'small' | 'normal' | 'large' = 'normal',
  notesSize: 'normal' | 'large' = 'normal'
): Buffer {
  const parts: Buffer[] = []

  // Use correct commands based on printer type
  const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
  const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
  const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE
  const RED = ESCPOS.COLOR_RED
  const BLACK = ESCPOS.COLOR_BLACK

  // Get size command based on priority settings
  const getToppingSizeCmd = () => {
    switch (modifierSize) {
      case 'small': return NORMAL
      case 'normal': return isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.NORMAL_SIZE
      case 'large': return TALL
      default: return NORMAL
    }
  }

  const toppingSizeCmd = getToppingSizeCmd()

  // Print SIZE and CRUST prominently at the top
  if (pizzaData.size) {
    const sizeText = pizzaData.size.inches
      ? `${pizzaData.size.name.toUpperCase()} (${pizzaData.size.inches}")`
      : pizzaData.size.name.toUpperCase()
    parts.push(TALL)
    parts.push(line(sizeText))
    parts.push(NORMAL)
  }

  if (pizzaData.crust) {
    parts.push(toppingSizeCmd)
    parts.push(line(`  ${pizzaData.crust.name.toUpperCase()} CRUST`))
    parts.push(NORMAL)
  }

  // Parse toppings data
  // Note: Android writes "microSections" but TypeScript types use "sections".
  // Normalize to "sections" for consistent rendering.
  const rawData = pizzaData.toppingsData as {
    toppings?: Array<{ name: string; sections?: number[]; microSections?: number[]; amount: string }>
    sauces?: Array<{ name: string; sections?: number[]; microSections?: number[]; amount: string }>
    cheeses?: Array<{ name: string; sections?: number[]; microSections?: number[]; amount: string }>
    sauceSections?: number[] | null
    cheeseSections?: number[] | null
  } | null

  // Normalize: prefer "sections", fall back to "microSections"
  const normalizeItems = (items?: Array<{ name: string; sections?: number[]; microSections?: number[]; amount: string }>) =>
    items?.map(item => ({ ...item, sections: item.sections || item.microSections || [] })) || []
  const data = rawData ? {
    ...rawData,
    toppings: normalizeItems(rawData.toppings),
    sauces: normalizeItems(rawData.sauces),
    cheeses: normalizeItems(rawData.cheeses),
  } : null

  const MAX_SECTIONS = 24

  // Infer sectionMode from the smallest topping section span
  const inferSectionMode = (): number => {
    if (!data) return 1
    const allItems = [
      ...(data.toppings || []),
      ...(data.sauces || []),
      ...(data.cheeses || []),
    ]
    let mode = 1
    for (const item of allItems) {
      if (!item.sections || item.sections.length >= MAX_SECTIONS) continue
      const len = item.sections.length
      if (len <= 3) mode = Math.max(mode, 8)       // 24/8 = 3
      else if (len <= 4) mode = Math.max(mode, 6)   // 24/6 = 4
      else if (len <= 6) mode = Math.max(mode, 4)   // 24/4 = 6
      else if (len <= 8) mode = Math.max(mode, 3)   // 24/3 = 8
      else if (len <= 12) mode = Math.max(mode, 2)  // 24/2 = 12
    }
    return mode
  }

  const sectionMode = inferSectionMode()

  // Define section boundaries for each mode
  // Each entry: [startIndex, endIndex] (inclusive)
  const getSectionBoundaries = (mode: number): number[][] => {
    const sliceSize = MAX_SECTIONS / mode
    return Array.from({ length: mode }, (_, i) => {
      const start = i * sliceSize
      return Array.from({ length: sliceSize }, (__, j) => start + j)
    })
  }

  const sectionBoundaries = getSectionBoundaries(sectionMode)

  // Check if a topping's sections overlap with a given set of indices
  const overlaps = (toppingSections: number[], sectionIndices: number[]): boolean => {
    const sectionSet = new Set(sectionIndices)
    return toppingSections.some(idx => sectionSet.has(idx))
  }

  // Check if base sauce/cheese are whole-pizza (no section-specific data)
  const baseSauceIsWhole = !data?.sauceSections
  const baseCheeseIsWhole = !data?.cheeseSections

  // When new sauces[]/cheeses[] arrays exist, skip legacy header rendering
  // to avoid double-printing (the arrays are already in allToppings below).
  const hasNewSauceArray = (data?.sauces?.length ?? 0) > 0
  const hasNewCheeseArray = (data?.cheeses?.length ?? 0) > 0

  // For whole-pizza base sauce/cheese, print in header area (before sections)
  // Only when using legacy single-sauce format (no sauces[] array)
  if (!hasNewSauceArray && baseSauceIsWhole && pizzaData.sauce) {
    const saucePrefix = pizzaData.sauceAmount !== 'regular' ? `${pizzaData.sauceAmount.toUpperCase()} ` : ''
    parts.push(toppingSizeCmd)
    parts.push(line(`  ${saucePrefix}${pizzaData.sauce.name.toUpperCase()} SAUCE`))
    parts.push(NORMAL)
  }

  if (!hasNewCheeseArray && baseCheeseIsWhole && pizzaData.cheese) {
    const cheesePrefix = pizzaData.cheeseAmount !== 'regular' ? `${pizzaData.cheeseAmount.toUpperCase()} ` : ''
    parts.push(toppingSizeCmd)
    parts.push(line(`  ${cheesePrefix}${pizzaData.cheese.name.toUpperCase()} CHEESE`))
    parts.push(NORMAL)
  }

  parts.push(line('')) // Blank line before toppings

  if (!data) return Buffer.concat(parts)

  // Get section label for a 1-based section number
  const getSectionLabel = (sectionNum: number, totalSections: number): string => {
    const labelStyle = settings.sections.showSectionLabels || 'full'

    if (totalSections === 1) return 'WHOLE'

    if (totalSections === 2) {
      if (labelStyle === 'full') return sectionNum === 1 ? 'LEFT HALF' : 'RIGHT HALF'
      if (labelStyle === 'abbreviated') return sectionNum === 1 ? 'L' : 'R'
      if (labelStyle === 'numbered') return `${sectionNum}/${totalSections}`
    }

    // For 3, 4, 6, 8 sections
    if (labelStyle === 'full') return `SEC. ${sectionNum}`
    if (labelStyle === 'abbreviated') return `S${sectionNum}`
    if (labelStyle === 'numbered') return `${sectionNum}/${totalSections}`

    return `SEC. ${sectionNum}`
  }

  // Collect all toppings/sauces/cheeses from toppingsData
  const allToppings = [
    ...(data.toppings || []),
    ...(data.sauces || []),
    ...(data.cheeses || []),
  ]

  // For sectionMode 1 (whole pizza), list everything flat — no section header
  if (sectionMode === 1) {
    const indent = settings.toppings.indentToppings ? '  ' : ''
    for (const item of allToppings) {
      const amountPrefix = item.amount !== 'regular' ? `${item.amount.toUpperCase()} ` : ''
      let itemText = `${amountPrefix}${item.name}`
      if (settings.toppings.allCaps) itemText = itemText.toUpperCase()

      if (hasRed && useRedForModifiers) parts.push(RED)
      parts.push(toppingSizeCmd)
      if (settings.toppings.boldToppings && !isImpact) parts.push(ESCPOS.BOLD_ON)
      parts.push(line(`${indent}${itemText}`))
      if (settings.toppings.boldToppings && !isImpact) parts.push(ESCPOS.BOLD_OFF)
      parts.push(NORMAL)
      if (hasRed && useRedForModifiers) parts.push(BLACK)
    }
  } else {
    // Multi-section: print each section with its items
    for (let secIdx = 0; secIdx < sectionBoundaries.length; secIdx++) {
      const sectionIndices = sectionBoundaries[secIdx]
      const sectionNum = secIdx + 1

      // Collect items for this section
      const sectionItems: string[] = []

      // Add section-specific base sauce if applicable (legacy format only)
      if (!hasNewSauceArray && !baseSauceIsWhole && pizzaData.sauce && data.sauceSections) {
        if (overlaps(data.sauceSections, sectionIndices)) {
          const saucePrefix = pizzaData.sauceAmount !== 'regular' ? `${pizzaData.sauceAmount.toUpperCase()} ` : ''
          sectionItems.push(`${saucePrefix}${pizzaData.sauce.name.toUpperCase()} SAUCE`)
        }
      }

      // Add section-specific base cheese if applicable (legacy format only)
      if (!hasNewCheeseArray && !baseCheeseIsWhole && pizzaData.cheese && data.cheeseSections) {
        if (overlaps(data.cheeseSections, sectionIndices)) {
          const cheesePrefix = pizzaData.cheeseAmount !== 'regular' ? `${pizzaData.cheeseAmount.toUpperCase()} ` : ''
          sectionItems.push(`${cheesePrefix}${pizzaData.cheese.name.toUpperCase()} CHEESE`)
        }
      }

      // Add all toppings/sauces/cheeses from toppingsData that overlap this section
      for (const item of allToppings) {
        const toppingSections = item.sections
        // Whole-pizza toppings (all 24 sections or empty) show in every section
        const isWhole = !toppingSections || toppingSections.length === 0 || toppingSections.length >= MAX_SECTIONS
        if (isWhole || overlaps(toppingSections, sectionIndices)) {
          const amountPrefix = item.amount !== 'regular' ? `${item.amount.toUpperCase()} ` : ''
          sectionItems.push(`${amountPrefix}${item.name}`)
        }
      }

      // Skip empty sections
      if (sectionItems.length === 0) continue

      // Section header
      if (settings.sections.useSectionHeaders) {
        const sectionLabel = getSectionLabel(sectionNum, sectionMode)

        const headerStyle = settings.sections.sectionHeaderStyle
        const headerText = `--- ${sectionLabel.toUpperCase()} ---`

        parts.push(TALL)
        if (headerStyle === 'bold' && !isImpact) parts.push(ESCPOS.BOLD_ON)
        if (headerStyle === 'underlined' && !isImpact) parts.push(ESCPOS.UNDERLINE_ON)
        if (headerStyle === 'red' || headerStyle === 'red-bold') {
          if (hasRed) parts.push(RED)
          if (headerStyle === 'red-bold' && !isImpact) parts.push(ESCPOS.BOLD_ON)
        }
        parts.push(line(headerText))
        if (headerStyle === 'red' || headerStyle === 'red-bold') {
          if (headerStyle === 'red-bold' && !isImpact) parts.push(ESCPOS.BOLD_OFF)
          if (hasRed) parts.push(BLACK)
        }
        if (headerStyle === 'underlined' && !isImpact) parts.push(ESCPOS.UNDERLINE_OFF)
        if (headerStyle === 'bold' && !isImpact) parts.push(ESCPOS.BOLD_OFF)
        parts.push(NORMAL)
      }

      // Print items in this section
      const indent = settings.toppings.indentToppings ? '  ' : ''
      for (const item of sectionItems) {
        let itemText = item
        if (settings.toppings.allCaps) itemText = itemText.toUpperCase()

        if (hasRed && useRedForModifiers) parts.push(RED)
        parts.push(toppingSizeCmd)
        if (settings.toppings.boldToppings && !isImpact) parts.push(ESCPOS.BOLD_ON)
        parts.push(line(`${indent}${itemText}`))
        if (settings.toppings.boldToppings && !isImpact) parts.push(ESCPOS.BOLD_OFF)
        parts.push(NORMAL)
        if (hasRed && useRedForModifiers) parts.push(BLACK)
      }
    }
  }

  // Cooking instructions - use special instructions settings with red support
  if (pizzaData.cookingInstructions && settings.specialInstructions.show) {
    const instrStyle = settings.specialInstructions.style
    let instrText = `COOK: ${pizzaData.cookingInstructions}`
    if (settings.specialInstructions.allCaps) instrText = instrText.toUpperCase()

    // Apply red for cooking instructions if enabled
    if (hasRed && useRedForNotes) parts.push(RED)

    const notesSizeCmd = notesSize === 'large' ? LARGE : TALL

    if (instrStyle === 'inverted') {
      parts.push(notesSizeCmd)
      parts.push(ESCPOS.INVERSE_ON)
      parts.push(line(instrText))
      parts.push(ESCPOS.INVERSE_OFF)
      parts.push(NORMAL)
    } else {
      parts.push(notesSizeCmd)
      if (instrStyle === 'bold' && !isImpact) parts.push(ESCPOS.BOLD_ON)
      const finalText = instrStyle === 'boxed' ? `[${instrText}]` : instrText
      parts.push(line(finalText))
      if (instrStyle === 'bold' && !isImpact) parts.push(ESCPOS.BOLD_OFF)
      parts.push(NORMAL)
    }

    // Reset to black
    if (hasRed && useRedForNotes) parts.push(BLACK)
  }

  // Cut style - always show if present, use topping size
  if (pizzaData.cutStyle) {
    let cutText = `CUT: ${pizzaData.cutStyle}`
    if (settings.toppings.allCaps) cutText = cutText.toUpperCase()

    parts.push(toppingSizeCmd)
    parts.push(line(cutText))
    parts.push(NORMAL)
  }

  return Buffer.concat(parts)
}
