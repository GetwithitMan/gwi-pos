import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import type { IngredientModificationType } from '@/types/orders'
import {
  buildDocument,
  buildDocumentNoCut,
  line,
  boldLine,
  largeLine,
  divider,
  twoColumnLine,
  ESCPOS,
  PAPER_WIDTH,
} from '@/lib/escpos/commands'
import { PizzaPrintSettings, DEFAULT_PIZZA_PRINT_SETTINGS } from '@/types/pizza-print-settings'
import { PrinterSettings, getDefaultPrinterSettings } from '@/types/printer-settings'

interface PrintKitchenRequest {
  orderId: string
  itemIds?: string[] // Optional: only print specific items (for resends)
}

// POST /api/print/kitchen - Print kitchen ticket for an order
export async function POST(request: NextRequest) {
  try {
    const body: PrintKitchenRequest = await request.json()
    const { orderId, itemIds } = body
    console.log('[Kitchen Print] Request:', { orderId, itemIds })

    // Fetch order with items
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        table: true,
        employee: true,
        location: true,
        items: {
          include: {
            modifiers: true,
            ingredientModifications: true,
            // Source table for T-S notation (virtual combined tables)
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

    // Filter items if specific itemIds provided
    const itemsToPrint = itemIds
      ? order.items.filter(item => itemIds.includes(item.id))
      : order.items.filter(item => item.kitchenStatus === 'pending') // Only items not yet sent

    if (itemsToPrint.length === 0) {
      console.log('[Kitchen Print] No items to print')
      return NextResponse.json({ message: 'No items to print' })
    }
    console.log('[Kitchen Print] Items to print:', itemsToPrint.length, itemsToPrint.map(i => ({ name: i.name, hasPizzaData: !!i.pizzaData })))

    // Get all printers for the location
    const printers = await db.printer.findMany({
      where: {
        locationId: order.locationId,
        isActive: true,
        printerRole: { in: ['kitchen', 'bar'] },
      },
    })

    // Get default kitchen printer
    const defaultKitchenPrinter = printers.find(p => p.printerRole === 'kitchen' && p.isDefault)
      || printers.find(p => p.printerRole === 'kitchen')
    console.log('[Kitchen Print] Found printers:', printers.length, 'Default kitchen:', defaultKitchenPrinter?.name || 'NONE')

    // Get pizza config for pizza-specific routing and print settings
    const pizzaConfig = await db.pizzaConfig.findUnique({
      where: { locationId: order.locationId },
    })
    const pizzaPrinterIds = (pizzaConfig?.printerIds as unknown as string[]) || []
    const printSettings: PizzaPrintSettings = (pizzaConfig?.printSettings as unknown as PizzaPrintSettings) || DEFAULT_PIZZA_PRINT_SETTINGS
    console.log('[Kitchen Print] Pizza printer IDs:', pizzaPrinterIds)

    // Group items by printer
    const itemsByPrinter: Map<string, typeof itemsToPrint> = new Map()

    for (const item of itemsToPrint) {
      let targetPrinterId: string | null = null

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

      // Priority: Item printers > Category printers > Default kitchen printer
      // Multiple printers are supported at each level
      let targetPrinterIds: string[] = []

      const itemPrinterIds = item.menuItem?.printerIds as string[] | null
      const categoryPrinterIds = item.menuItem?.category?.printerIds as string[] | null

      if (itemPrinterIds && itemPrinterIds.length > 0) {
        targetPrinterIds = itemPrinterIds
      } else if (categoryPrinterIds && categoryPrinterIds.length > 0) {
        targetPrinterIds = categoryPrinterIds
      } else if (defaultKitchenPrinter) {
        targetPrinterIds = [defaultKitchenPrinter.id]
      }

      // If still no printer, log it
      if (targetPrinterIds.length === 0) {
        console.log('[Kitchen Print] No printer found for item:', item.name, '(pizzaData:', !!item.pizzaData, ')')
      }

      // Add item to each target printer
      for (const printerId of targetPrinterIds) {
        const existing = itemsByPrinter.get(printerId) || []
        existing.push(item)
        itemsByPrinter.set(printerId, existing)
      }
    }

    // Print to each printer
    const results: { printerId: string; printerName: string; success: boolean; error?: string }[] = []

    console.log('[Kitchen Print] Items grouped by printer:', Array.from(itemsByPrinter.entries()).map(([pid, items]) => ({ printerId: pid, itemCount: items.length })))

    for (const [printerId, items] of itemsByPrinter) {
      const printer = printers.find(p => p.id === printerId)
      if (!printer) {
        console.log('[Kitchen Print] Printer not found:', printerId)
        continue
      }

      console.log('[Kitchen Print] Printing to:', printer.name, printer.ipAddress, printer.printerType)

      const width = printer.paperWidth === 58 ? PAPER_WIDTH['58mm'] : PAPER_WIDTH['80mm']

      // Get printer-specific settings (from printer or defaults based on type)
      const printerSettings: PrinterSettings = (printer.printSettings as unknown as PrinterSettings)
        || getDefaultPrinterSettings(printer.printerType)

      // Build the ticket content - pass printer type and settings for formatting
      try {
        const ticketContent = buildKitchenTicket(order, items, width, printer.printerType, printSettings, printerSettings)
        console.log('[Kitchen Print] Ticket content built, buffers:', ticketContent.length)

        // Build document with or without cut
        const document = printer.supportsCut
          ? buildDocument(...ticketContent)
          : buildDocumentNoCut(...ticketContent)
        console.log('[Kitchen Print] Document size:', document.length, 'bytes')

        // Send to printer
        const result = await sendToPrinter(printer.ipAddress, printer.port, document)
        console.log('[Kitchen Print] Send result:', result)

        // Log the print job
        await db.printJob.create({
          data: {
            locationId: order.locationId,
            jobType: 'kitchen',
            orderId: order.id,
            printerId: printer.id,
            status: result.success ? 'sent' : 'failed',
            sentAt: new Date(),
          },
        })

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
      await db.orderItem.updateMany({
        where: { id: { in: itemsToPrint.map(i => i.id) } },
        data: { kitchenStatus: 'cooking' },
      })
    }

    return NextResponse.json({
      success: results.some(r => r.success),
      results,
    })
  } catch (error) {
    console.error('Failed to print kitchen ticket:', error)
    return NextResponse.json({ error: 'Failed to print kitchen ticket' }, { status: 500 })
  }
}

// Build kitchen ticket content
function buildKitchenTicket(
  order: {
    orderNumber: number
    orderType: string
    tabName: string | null
    table: { name: string } | null
    employee: { displayName: string | null; firstName: string; lastName: string }
    createdAt: Date
  },
  items: Array<{
    id: string
    name: string
    quantity: number
    seatNumber: number | null  // T023: Seat assignment
    sourceTableId: string | null  // For virtual combined tables - T-S notation
    sourceTable: { id: string; name: string; abbreviation: string | null } | null  // Source table for T-S prefix
    specialNotes: string | null
    resendCount: number
    modifiers: Array<{
      name: string
      preModifier: string | null
      depth: number
    }>
    ingredientModifications: Array<{
      ingredientName: string
      modificationType: IngredientModificationType
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

  // Order type - abbreviate common types to prevent wrapping
  const orderTypeDisplay = order.orderType.toUpperCase()
    .replace('DINE_IN', 'DINE IN')
    .replace('BAR_TAB', 'BAR')
    .replace('TAKEOUT', 'TOGO')
    .replace('DELIVERY', 'DELIV')
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
  content.push(line(''))

  // ITEMS
  for (const item of items) {
    // Item name with quantity and T-S (Table-Seat) notation for virtual combined tables
    // Format: T2-S3 = Table 2, Seat 3 | S3 = Seat 3 only (no source table)
    let positionPrefix = ''
    if (item.sourceTable) {
      // Virtual combined table - use T-S notation
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
    let itemName = `${positionPrefix}${item.quantity}x ${item.name}`
    if (allCapsItems) itemName = itemName.toUpperCase()
    content.push(importantLine(itemName, itemNameSize, useRedItemNames, boldItems))

    // Modifiers - SKIP for pizza items (pizzaData has the organized toppings)
    if (!item.pizzaData) {
      for (const mod of item.modifiers) {
        const prefix = mod.depth > 0 ? '  '.repeat(mod.depth) + '- ' : '  '
        let modLine = mod.preModifier ? `${mod.preModifier} ${mod.name}` : mod.name
        if (allCapsMods) {
          modLine = modLine.toUpperCase()
        }
        // Apply red for modifiers if enabled
        if (hasRed && useRedModifiers) content.push(RED)
        content.push(toppingSizeCmd)
        if (boldMods && !isImpact) {
          content.push(ESCPOS.BOLD_ON)
        }
        content.push(line(`${prefix}${modLine}`))
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

  // Print base sauce and cheese (the selected ones, not from toppingsData)
  if (pizzaData.sauce) {
    const saucePrefix = pizzaData.sauceAmount !== 'regular' ? `${pizzaData.sauceAmount.toUpperCase()} ` : ''
    parts.push(toppingSizeCmd)
    parts.push(line(`  ${saucePrefix}${pizzaData.sauce.name.toUpperCase()} SAUCE`))
    parts.push(NORMAL)
  }

  if (pizzaData.cheese) {
    const cheesePrefix = pizzaData.cheeseAmount !== 'regular' ? `${pizzaData.cheeseAmount.toUpperCase()} ` : ''
    parts.push(toppingSizeCmd)
    parts.push(line(`  ${cheesePrefix}${pizzaData.cheese.name.toUpperCase()} CHEESE`))
    parts.push(NORMAL)
  }

  parts.push(line('')) // Blank line before toppings

  const data = pizzaData.toppingsData as {
    toppings?: Array<{ name: string; sections: number[]; amount: string }>
    sauces?: Array<{ name: string; sections: number[]; amount: string }>
    cheeses?: Array<{ name: string; sections: number[]; amount: string }>
  } | null

  if (!data) return Buffer.concat(parts)

  const maxSections = 24 // Our standard max sections

  // Define all section ranges - each section has a label and the indices it covers
  type SectionDef = { label: string; indices: number[] }
  const allSectionDefs: SectionDef[] = [
    // Whole pizza
    { label: 'WHOLE', indices: Array.from({ length: 24 }, (_, i) => i) },
    // Halves
    { label: 'LEFT HALF', indices: Array.from({ length: 12 }, (_, i) => i) },
    { label: 'RIGHT HALF', indices: Array.from({ length: 12 }, (_, i) => i + 12) },
    // Quarters
    { label: 'TOP LEFT', indices: Array.from({ length: 6 }, (_, i) => i) },
    { label: 'TOP RIGHT', indices: Array.from({ length: 6 }, (_, i) => i + 6) },
    { label: 'BOTTOM RIGHT', indices: Array.from({ length: 6 }, (_, i) => i + 12) },
    { label: 'BOTTOM LEFT', indices: Array.from({ length: 6 }, (_, i) => i + 18) },
    // Sixths
    { label: '1/6-1', indices: Array.from({ length: 4 }, (_, i) => i) },
    { label: '1/6-2', indices: Array.from({ length: 4 }, (_, i) => i + 4) },
    { label: '1/6-3', indices: Array.from({ length: 4 }, (_, i) => i + 8) },
    { label: '1/6-4', indices: Array.from({ length: 4 }, (_, i) => i + 12) },
    { label: '1/6-5', indices: Array.from({ length: 4 }, (_, i) => i + 16) },
    { label: '1/6-6', indices: Array.from({ length: 4 }, (_, i) => i + 20) },
  ]

  // Helper: check if a topping's sections exactly match a section definition
  const exactlyMatches = (toppingSections: number[], sectionDef: SectionDef): boolean => {
    if (toppingSections.length !== sectionDef.indices.length) return false
    const sorted = [...toppingSections].sort((a, b) => a - b)
    return sorted.every((v, i) => v === sectionDef.indices[i])
  }

  // Helper: check if topping covers this section (has overlap AND is smallest matching section)
  const coversSection = (toppingSections: number[], sectionDef: SectionDef): boolean => {
    // Check if there's any overlap
    const hasOverlap = sectionDef.indices.some(idx => toppingSections.includes(idx))
    if (!hasOverlap) return false

    // Check if ALL indices of this section are covered by the topping
    const coversAll = sectionDef.indices.every(idx => toppingSections.includes(idx))
    return coversAll
  }

  // Find the best (smallest) section label for each topping
  const getBestSectionLabel = (toppingSections: number[]): string => {
    if (!toppingSections || toppingSections.length === 0) return 'WHOLE'
    if (toppingSections.length === maxSections) return 'WHOLE'

    // Try to find exact match first (prioritize smallest sections)
    // Check sixths first
    for (const def of allSectionDefs.filter(d => d.label.startsWith('1/6'))) {
      if (exactlyMatches(toppingSections, def)) return def.label
    }
    // Then quarters
    for (const def of allSectionDefs.filter(d => ['TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT'].includes(d.label))) {
      if (exactlyMatches(toppingSections, def)) return def.label
    }
    // Then halves
    for (const def of allSectionDefs.filter(d => d.label.includes('HALF'))) {
      if (exactlyMatches(toppingSections, def)) return def.label
    }

    return 'CUSTOM'
  }

  // For each section, collect items that are on that specific section
  // A topping belongs to a section if it covers EXACTLY that section or a subset
  const sectionItems: Map<string, string[]> = new Map()

  // Helper to add item to appropriate section(s)
  const addItemToSections = (item: { name: string; sections: number[]; amount: string }, itemType?: string) => {
    const toppingSections = item.sections
    const amountPrefix = item.amount !== 'regular' ? `${item.amount.toUpperCase()} ` : ''
    const itemText = `${amountPrefix}${item.name}`

    // Find the best matching section for this item
    const bestLabel = getBestSectionLabel(toppingSections)

    if (bestLabel !== 'CUSTOM') {
      const existing = sectionItems.get(bestLabel) || []
      existing.push(itemText)
      sectionItems.set(bestLabel, existing)
    } else {
      // Item spans multiple sections in a non-standard way
      // Find all sections this item covers and add to each
      for (const sectionDef of allSectionDefs.filter(d => d.label.startsWith('1/6'))) {
        if (coversSection(toppingSections, sectionDef)) {
          const existing = sectionItems.get(sectionDef.label) || []
          existing.push(itemText)
          sectionItems.set(sectionDef.label, existing)
        }
      }
      // If still not found in sixths, try halves
      if (!Array.from(sectionItems.keys()).some(k => k.startsWith('1/6'))) {
        for (const sectionDef of allSectionDefs.filter(d => d.label.includes('HALF'))) {
          if (coversSection(toppingSections, sectionDef)) {
            const existing = sectionItems.get(sectionDef.label) || []
            existing.push(itemText)
            sectionItems.set(sectionDef.label, existing)
          }
        }
      }
    }
  }

  // Add sauces
  for (const sauce of data.sauces || []) {
    addItemToSections(sauce)
  }

  // Add cheeses
  for (const cheese of data.cheeses || []) {
    addItemToSections(cheese)
  }

  // Add toppings
  for (const topping of data.toppings || []) {
    addItemToSections(topping)
  }

  // Define the order we want sections to print
  const sectionOrder = [
    'WHOLE',
    'LEFT HALF', 'RIGHT HALF',
    'TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT',
    '1/6-1', '1/6-2', '1/6-3', '1/6-4', '1/6-5', '1/6-6',
  ]

  // Print each section in order - SKIP empty sections
  for (const label of sectionOrder) {
    const items = sectionItems.get(label)
    // Skip sections with no items
    if (!items || items.length === 0) continue

    // Section header - only show if enabled
    if (settings.sections.useSectionHeaders) {
      // Get section label based on style setting
      let sectionLabel = label
      if (settings.sections.showSectionLabels === 'abbreviated') {
        // Convert to abbreviated
        if (label === 'LEFT HALF') sectionLabel = 'L'
        else if (label === 'RIGHT HALF') sectionLabel = 'R'
        else if (label === 'WHOLE') sectionLabel = 'W'
        else if (label.startsWith('TOP')) sectionLabel = label.replace('TOP ', 'T-')
        else if (label.startsWith('BOTTOM')) sectionLabel = label.replace('BOTTOM ', 'B-')
      } else if (settings.sections.showSectionLabels === 'numbered') {
        if (label === 'LEFT HALF') sectionLabel = '1/2'
        else if (label === 'RIGHT HALF') sectionLabel = '2/2'
        else if (label === 'WHOLE') sectionLabel = 'WHOLE'
      }

      // Format header based on style - use brackets for clarity
      const headerStyle = settings.sections.sectionHeaderStyle
      let headerText = `[${sectionLabel.toUpperCase()}]`
      if (headerStyle === 'uppercase' || headerStyle === 'bold') {
        headerText = `[${sectionLabel.toUpperCase()}]`
      }

      // Print section header - use TALL not LARGE to prevent text cutoff
      parts.push(TALL)
      if (headerStyle === 'bold' && !isImpact) parts.push(ESCPOS.BOLD_ON)
      if (headerStyle === 'underlined' && !isImpact) parts.push(ESCPOS.UNDERLINE_ON)
      parts.push(line(headerText))
      if (headerStyle === 'underlined' && !isImpact) parts.push(ESCPOS.UNDERLINE_OFF)
      if (headerStyle === 'bold' && !isImpact) parts.push(ESCPOS.BOLD_OFF)
      parts.push(NORMAL)
    }

    // Print items in this section
    const indent = settings.toppings.indentToppings ? '  ' : ''
    for (const item of items) {
      let itemText = item
      if (settings.toppings.allCaps) itemText = itemText.toUpperCase()

      // Apply red for modifiers/toppings if enabled
      if (hasRed && useRedForModifiers) parts.push(RED)
      parts.push(toppingSizeCmd)
      if (settings.toppings.boldToppings && !isImpact) parts.push(ESCPOS.BOLD_ON)
      parts.push(line(`${indent}${itemText}`))
      if (settings.toppings.boldToppings && !isImpact) parts.push(ESCPOS.BOLD_OFF)
      parts.push(NORMAL)
      if (hasRed && useRedForModifiers) parts.push(BLACK)
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
