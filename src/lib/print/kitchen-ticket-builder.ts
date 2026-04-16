/**
 * Kitchen Ticket Builder
 *
 * Constructs ESC/POS ticket content from order data for thermal/impact printers.
 * Extracted from the kitchen print route to keep the route handler thin.
 */

import {
  buildDocument,
  buildDocumentNoCut,
  line,
  divider,
  ESCPOS,
  PAPER_WIDTH,
  truncateForPrint,
} from '@/lib/escpos/commands'
import {
  PizzaPrintSettings,
  DEFAULT_PIZZA_PRINT_SETTINGS,
  PrinterSettings,
  getDefaultPrinterSettings,
} from '@/types/print'
import { formatCurrency } from '@/lib/utils'
import type { EnrichedItem } from './kitchen-route-resolver'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TicketOrder {
  orderNumber: number
  orderType: string
  tabName: string | null
  table: { name: string } | null
  employee: { displayName: string | null; firstName: string; lastName: string } | null
  createdAt: Date
  notes?: string | null
  customerName?: string | null
  customerPhone?: string | null
  deliveryAddress?: string | null
  deliveryInstructions?: string | null
  source?: string | null
  pagerNumber?: string | null
  fulfillmentMode?: string | null
}

export interface TicketPrinter {
  id: string
  name: string
  ipAddress: string
  port: number
  paperWidth: number | null
  printerType: string
  printerRole: string
  isDefault: boolean
  supportsCut: boolean
  printSettings: unknown
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type SizeOption = 'small' | 'normal' | 'large' | 'xlarge'

function getSizeCommand(size: SizeOption, isImpact: boolean): Buffer {
  const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
  const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
  const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE

  switch (size) {
    case 'small': return NORMAL
    case 'normal': return isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.NORMAL_SIZE
    case 'large': return TALL
    case 'xlarge': return LARGE
    default: return NORMAL
  }
}

function getSmartSizeCommand(size: SizeOption, textLength: number, width: number, isImpact: boolean): Buffer {
  const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
  const maxCharsForDoubleWidth = width / 2 - 2
  if (textLength > maxCharsForDoubleWidth && (size === 'xlarge' || size === 'large')) {
    return TALL
  }
  return getSizeCommand(size, isImpact)
}

function withColor(hasRed: boolean, useRed: boolean, buffers: Buffer[]): Buffer[] {
  if (hasRed && useRed) {
    return [ESCPOS.COLOR_RED, ...buffers, ESCPOS.COLOR_BLACK]
  }
  return buffers
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a complete ESC/POS document for a single printer's kitchen ticket.
 */
export function buildKitchenDocument(
  order: TicketOrder,
  items: EnrichedItem[],
  printer: TicketPrinter,
  pizzaPrintSettings: PizzaPrintSettings,
): Buffer {
  const width = printer.paperWidth === 58 ? PAPER_WIDTH['58mm'] : PAPER_WIDTH['80mm']
  const printerSettings: PrinterSettings = (printer.printSettings as unknown as PrinterSettings)
    || getDefaultPrinterSettings(printer.printerType)

  const ticketContent = buildKitchenTicket(
    order, items, width, printer.printerType, pizzaPrintSettings, printerSettings
  )

  return printer.supportsCut
    ? buildDocument(...ticketContent)
    : buildDocumentNoCut(...ticketContent)
}

/**
 * Build kitchen ticket content (Buffer array) for a given order + items.
 */
export function buildKitchenTicket(
  order: TicketOrder,
  items: EnrichedItem[],
  width: number,
  printerType: string = 'thermal',
  settings: PizzaPrintSettings = DEFAULT_PIZZA_PRINT_SETTINGS,
  printerSettings: PrinterSettings = getDefaultPrinterSettings('thermal'),
): Buffer[] {
  const content: Buffer[] = []
  const isImpact = printerType === 'impact'

  // PRIORITY: Pizza Print Settings > Printer Settings
  const hasRed = settings.redRibbon?.enabled ?? printerSettings.ribbon.hasRedRibbon
  const useRedResend = settings.redRibbon?.useRedForResend ?? printerSettings.ribbon.useRedForResend
  const useRedNoItems = settings.redRibbon?.useRedForNoItems ?? printerSettings.ribbon.useRedForNoItems
  const useRedNotes = settings.redRibbon?.useRedForNotes ?? printerSettings.ribbon.useRedForNotes
  const useRedHeaders = settings.redRibbon?.useRedForHeaders ?? printerSettings.ribbon.useRedForHeaders
  const useRedModifiers = settings.redRibbon?.useRedForModifiers ?? false
  const useRedExtraItems = settings.redRibbon?.useRedForExtraItems ?? false
  const useRedLightItems = settings.redRibbon?.useRedForLightItems ?? false
  const useRedItemNames = settings.redRibbon?.useRedForItemNames ?? false

  const headerSize = settings.textSizing?.headerSize ?? printerSettings.textSizing.headerSize
  const itemNameSize = settings.textSizing?.itemNameSize ?? printerSettings.textSizing.itemNameSize
  const modifierSize = settings.textSizing?.modifierSize ?? printerSettings.textSizing.modifierSize
  const notesSize = settings.textSizing?.notesSize ?? printerSettings.textSizing.notesSize

  const allCapsItems = settings.formatting?.allCapsItemNames ?? printerSettings.formatting.allCapsItems
  const allCapsMods = settings.formatting?.allCapsModifiers ?? printerSettings.formatting.allCapsMods
  const boldItems = settings.formatting?.boldItemNames ?? true
  const boldMods = settings.formatting?.boldModifiers ?? false

  const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
  const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
  const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE
  const RED = ESCPOS.COLOR_RED
  const BLACK = ESCPOS.COLOR_BLACK

  const toppingSizeCmd = getSizeCommand(modifierSize, isImpact)

  const headerLine = (text: string, size: 'normal' | 'large' | 'xlarge' = 'large', useRed: boolean = false) => {
    const sizeCmd = getSmartSizeCommand(size, text.length, width, isImpact)
    const parts = [sizeCmd, line(text), NORMAL]
    return Buffer.concat(withColor(hasRed, useRed, parts))
  }

  const importantLine = (text: string, size: 'normal' | 'large' | 'xlarge' = 'large', useRed: boolean = false, bold: boolean = false) => {
    if (size === 'normal' && !isImpact && bold) {
      const parts = [ESCPOS.BOLD_ON, line(text), ESCPOS.BOLD_OFF]
      return Buffer.concat(withColor(hasRed, useRed, parts))
    }
    const sizeCmd = getSmartSizeCommand(size, text.length, width, isImpact)
    const parts: Buffer[] = []
    parts.push(sizeCmd)
    if (bold && !isImpact) parts.push(ESCPOS.BOLD_ON)
    parts.push(line(text))
    if (bold && !isImpact) parts.push(ESCPOS.BOLD_OFF)
    parts.push(NORMAL)
    return Buffer.concat(withColor(hasRed, useRed, parts))
  }

  // ── HEADER ──
  content.push(ESCPOS.ALIGN_CENTER)
  content.push(headerLine('KITCHEN', headerSize, useRedHeaders))

  const isResend = items.some(i => i.resendCount > 0)
  if (isResend) {
    if (hasRed && useRedResend) content.push(RED)
    content.push(ESCPOS.INVERSE_ON)
    content.push(headerLine('** RESEND **', headerSize))
    content.push(ESCPOS.INVERSE_OFF)
    if (hasRed && useRedResend) content.push(BLACK)
  }

  content.push(ESCPOS.ALIGN_LEFT)
  content.push(divider(width))

  // ── ORDER INFO ──
  const orderSizeCmd = getSizeCommand(headerSize, isImpact)
  if (hasRed && useRedHeaders) content.push(RED)
  content.push(orderSizeCmd)
  content.push(line(`#${order.orderNumber}`))

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

  const serverName = order.employee?.displayName || `${order.employee?.firstName ?? ''} ${order.employee?.lastName ?? ''}`.trim() || 'Unknown'
  content.push(line(`Server: ${serverName}`))
  content.push(line(new Date().toLocaleTimeString()))

  if (order.pagerNumber) {
    content.push(TALL)
    content.push(ESCPOS.BOLD_ON)
    content.push(line(`PAGER #${order.pagerNumber}`))
    content.push(ESCPOS.BOLD_OFF)
    content.push(NORMAL)
  }

  if (order.fulfillmentMode) {
    const modeLabel = order.fulfillmentMode.toUpperCase().replace('_', ' ')
    content.push(line(modeLabel))
  }

  content.push(divider(width))

  // ── DELIVERY INFO ──
  if (order.orderType?.startsWith('delivery') && (order.customerName || order.deliveryAddress)) {
    content.push(line(''))

    if (order.source) {
      content.push(ESCPOS.ALIGN_CENTER)
      content.push(getSizeCommand(headerSize, isImpact))
      content.push(line(`** ${order.source.toUpperCase()} DELIVERY **`))
      content.push(NORMAL)
      content.push(ESCPOS.ALIGN_LEFT)
    }

    if (!isImpact) content.push(ESCPOS.BOLD_ON)
    if (order.customerName) content.push(line(`CUSTOMER: ${order.customerName}`))
    if (order.customerPhone) content.push(line(`PHONE: ${order.customerPhone}`))
    if (!isImpact) content.push(ESCPOS.BOLD_OFF)

    if (order.deliveryAddress) content.push(line(`DELIVER TO: ${order.deliveryAddress}`))

    if (order.deliveryInstructions) {
      content.push(line(''))
      if (!isImpact) content.push(ESCPOS.BOLD_ON)
      content.push(line(`!! ${order.deliveryInstructions} !!`))
      if (!isImpact) content.push(ESCPOS.BOLD_OFF)
    }

    content.push(divider(width))
  }

  content.push(line(''))

  // ── SEAT ALLERGY NOTES ──
  if (order.notes) {
    try {
      const parsed = JSON.parse(order.notes)
      if (parsed && typeof parsed === 'object' && parsed.seatAllergies) {
        const seatAllergies = parsed.seatAllergies as Record<string, string>
        const seatEntries = Object.entries(seatAllergies).filter(([, notes]) => notes && notes.trim())
        if (seatEntries.length > 0) {
          seatEntries.sort((a, b) => Number(a[0]) - Number(b[0]))
          if (hasRed && useRedNotes) content.push(RED)
          content.push(getSizeCommand(notesSize, isImpact))
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

  // ── ITEMS ──
  const coursingActive = items.some(i => i.courseNumber != null && i.courseNumber > 0)
  const sortedItems = coursingActive
    ? [...items].sort((a, b) => (a.courseNumber ?? 999) - (b.courseNumber ?? 999))
    : items

  let currentCourse: number | null = null

  for (const item of sortedItems) {
    // Course header
    if (coursingActive && item.courseNumber != null && item.courseNumber > 0 && item.courseNumber !== currentCourse) {
      currentCourse = item.courseNumber
      content.push(line(''))
      if (hasRed && useRedHeaders) content.push(RED)
      content.push(ESCPOS.ALIGN_CENTER)
      content.push(getSizeCommand(headerSize, isImpact))
      content.push(ESCPOS.BOLD_ON)
      content.push(line(`\u2500\u2500 Course ${currentCourse} \u2500\u2500`))
      content.push(ESCPOS.BOLD_OFF)
      content.push(NORMAL)
      content.push(ESCPOS.ALIGN_LEFT)
      if (hasRed && useRedHeaders) content.push(BLACK)
    }

    // Position prefix
    let positionPrefix = ''
    if (item.sourceTable) {
      const tablePrefix = item.sourceTable.abbreviation || item.sourceTable.name.slice(0, 4)
      positionPrefix = item.seatNumber ? `${tablePrefix}-S${item.seatNumber}: ` : `${tablePrefix}: `
    } else if (item.seatNumber) {
      positionPrefix = `S${item.seatNumber}: `
    }

    if (item._modifierOnlyFor) {
      content.push(NORMAL)
      content.push(line(`FOR: ${item._modifierOnlyFor}`))
    }

    // Item name
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

    // Pizza specialty label
    if (item._specialtyName && item.pizzaData) {
      content.push(TALL)
      content.push(ESCPOS.BOLD_ON)
      content.push(line(`*** ${item._specialtyName.toUpperCase()} ***`))
      content.push(ESCPOS.BOLD_OFF)
      content.push(NORMAL)
    }

    // Pricing option label
    if (item.pricingOptionLabel && !item.name.includes(`(${item.pricingOptionLabel})`)) {
      content.push(toppingSizeCmd)
      content.push(ESCPOS.BOLD_ON)
      content.push(line(`  ** ${item.pricingOptionLabel.toUpperCase()} **`))
      content.push(ESCPOS.BOLD_OFF)
      content.push(NORMAL)
    }

    // Shared indented-line helper — used for both modifiers and combo selections so
    // indentation matches existing ticket aesthetics. Depth 0 gets a 2-space indent;
    // deeper modifiers use the modifier depth convention (`  ` * depth + `- `).
    const indentFor = (depth: number) => (depth > 0 ? '  '.repeat(depth) + '- ' : '  ')
    const emitIndentedModifierLine = (label: string, depth: number) => {
      const text = truncateForPrint(`${indentFor(depth)}${label}`, width)
      if (hasRed && useRedModifiers) content.push(RED)
      content.push(toppingSizeCmd)
      if (boldMods && !isImpact) content.push(ESCPOS.BOLD_ON)
      content.push(line(text))
      if (boldMods && !isImpact) content.push(ESCPOS.BOLD_OFF)
      content.push(NORMAL)
      if (hasRed && useRedModifiers) content.push(BLACK)
    }

    // Modifiers (skip for pizza items)
    if (!item.pizzaData) {
      for (const mod of item.modifiers) {
        if (mod.isNoneSelection && !mod.modifier?.modifierGroup?.nonePrintsToKitchen) continue
        const preLabel = mod.preModifier
          ? mod.preModifier.split(',').map(t => t.trim()).filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ') + ' '
          : ''
        const customPrefix = mod.isNoneSelection ? '' : mod.isCustomEntry ? 'CUSTOM: ' : ''
        const swapSuffix = mod.swapTargetName ? ` \u2192 ${mod.swapTargetName}` : ''
        let modLine = `${customPrefix}${preLabel}${mod.name}${swapSuffix}`
        if (allCapsMods) modLine = modLine.toUpperCase()
        emitIndentedModifierLine(modLine, mod.depth)
      }
    }

    // Combo Pick N of M — render each customer-picked option as an indented child line
    // using the same formatter as modifiers. Selections are already sorted by sortIndex asc
    // via ORDER_ITEM_FULL_INCLUDE. Classic combos (no selections) render unchanged.
    const comboSelections = (item as unknown as {
      comboSelections?: Array<{ optionName?: string; upchargeApplied?: number }>
    }).comboSelections
    if (comboSelections && comboSelections.length > 0 && !item.pizzaData) {
      for (const sel of comboSelections) {
        const rawName = (sel.optionName ?? '').toString().trim()
        if (!rawName) continue
        const upcharge = Number(sel.upchargeApplied ?? 0)
        const upchargeSuffix = upcharge > 0 ? ` (+${formatCurrency(upcharge)})` : ''
        const displayName = allCapsMods ? rawName.toUpperCase() : rawName
        emitIndentedModifierLine(`${displayName}${upchargeSuffix}`, 0)
      }
    }

    // Ingredient modifications
    for (const ing of item.ingredientModifications) {
      const modType = ing.modificationType.toUpperCase()

      if (modType === 'NO' && settings.modifications.highlightNo) {
        const noStyle = settings.modifications.noStyle
        const noPrefix = settings.modifications.noPrefix || 'NO'
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
        if (hasRed && useRedNoItems) content.push(BLACK)
      } else if (modType === 'EXTRA' && settings.modifications.highlightExtra) {
        const extraPrefix = settings.modifications.extraPrefix || 'EXTRA'
        const extraStyle = settings.modifications.extraStyle
        let extraText = `${extraPrefix} ${ing.ingredientName}`
        if (extraStyle === 'caps' || extraStyle === 'all') extraText = extraText.toUpperCase()
        if (extraStyle === 'boxed') extraText = `[${extraText}]`
        if (hasRed && useRedExtraItems) content.push(RED)
        content.push(toppingSizeCmd)
        if ((extraStyle === 'bold' || extraStyle === 'all') && !isImpact) content.push(ESCPOS.BOLD_ON)
        content.push(line(`  ${extraText}`))
        if ((extraStyle === 'bold' || extraStyle === 'all') && !isImpact) content.push(ESCPOS.BOLD_OFF)
        content.push(NORMAL)
        if (hasRed && useRedExtraItems) content.push(BLACK)
      } else if (modType === 'LITE' && settings.modifications.highlightLight) {
        const lightPrefix = settings.modifications.lightPrefix || 'LIGHT'
        let lightText = `${lightPrefix} ${ing.ingredientName}`
        if (settings.modifications.lightStyle === 'caps') lightText = lightText.toUpperCase()
        if (hasRed && useRedLightItems) content.push(RED)
        content.push(toppingSizeCmd)
        if (settings.modifications.lightStyle === 'bold' && !isImpact) content.push(ESCPOS.BOLD_ON)
        content.push(line(`  ${lightText}`))
        if (settings.modifications.lightStyle === 'bold' && !isImpact) content.push(ESCPOS.BOLD_OFF)
        content.push(NORMAL)
        if (hasRed && useRedLightItems) content.push(BLACK)
      } else {
        content.push(toppingSizeCmd)
        content.push(line(`  ${modType} ${ing.ingredientName}`))
        content.push(NORMAL)
      }
    }

    // Pizza-specific formatting
    if (item.pizzaData) {
      content.push(line(''))
      content.push(buildPizzaSection(item.pizzaData, width, isImpact, settings, hasRed, useRedNotes, useRedModifiers, modifierSize, notesSize))
    }

    // Special notes
    if (item.specialNotes && settings.specialInstructions.show) {
      const noteStyle = settings.specialInstructions.style
      const noteLabel = settings.specialInstructions.label || 'NOTE:'
      let noteText = `${noteLabel} ${item.specialNotes}`
      if (settings.specialInstructions.allCaps) noteText = noteText.toUpperCase()

      if (hasRed && useRedNotes) content.push(RED)
      if (noteStyle === 'inverted') {
        content.push(getSizeCommand(notesSize, isImpact))
        content.push(ESCPOS.INVERSE_ON)
        content.push(line(noteText))
        content.push(ESCPOS.INVERSE_OFF)
        content.push(NORMAL)
      } else {
        content.push(getSizeCommand(notesSize, isImpact))
        if (noteStyle === 'bold' && !isImpact) content.push(ESCPOS.BOLD_ON)
        const finalText = noteStyle === 'boxed' ? `[${noteText}]` : noteText
        content.push(line(finalText))
        if (noteStyle === 'bold' && !isImpact) content.push(ESCPOS.BOLD_OFF)
        content.push(NORMAL)
      }
      if (hasRed && useRedNotes) content.push(BLACK)
    }

    content.push(line(''))
  }

  content.push(divider(width))
  return content
}

// ─── Pizza Section ───────────────────────────────────────────────────────────

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
  notesSize: 'normal' | 'large' = 'normal',
): Buffer {
  const parts: Buffer[] = []

  const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
  const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
  const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE
  const RED = ESCPOS.COLOR_RED
  const BLACK = ESCPOS.COLOR_BLACK

  const getToppingSizeCmd = () => {
    switch (modifierSize) {
      case 'small': return NORMAL
      case 'normal': return isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.NORMAL_SIZE
      case 'large': return TALL
      default: return NORMAL
    }
  }

  const toppingSizeCmd = getToppingSizeCmd()

  // SIZE and CRUST
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
  const rawData = pizzaData.toppingsData as {
    toppings?: Array<{ name: string; sections?: number[]; microSections?: number[]; amount: string }>
    sauces?: Array<{ name: string; sections?: number[]; microSections?: number[]; amount: string }>
    cheeses?: Array<{ name: string; sections?: number[]; microSections?: number[]; amount: string }>
    sauceSections?: number[] | null
    cheeseSections?: number[] | null
  } | null

  const normalizeItems = (items?: Array<{ name: string; sections?: number[]; microSections?: number[]; amount: string }>) =>
    items?.map(item => ({ ...item, sections: item.sections || item.microSections || [] })) || []
  const data = rawData ? {
    ...rawData,
    toppings: normalizeItems(rawData.toppings),
    sauces: normalizeItems(rawData.sauces),
    cheeses: normalizeItems(rawData.cheeses),
  } : null

  const MAX_SECTIONS = 24

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
      if (len <= 3) mode = Math.max(mode, 8)
      else if (len <= 4) mode = Math.max(mode, 6)
      else if (len <= 6) mode = Math.max(mode, 4)
      else if (len <= 8) mode = Math.max(mode, 3)
      else if (len <= 12) mode = Math.max(mode, 2)
    }
    return mode
  }

  const sectionMode = inferSectionMode()

  const getSectionBoundaries = (mode: number): number[][] => {
    const sliceSize = MAX_SECTIONS / mode
    return Array.from({ length: mode }, (_, i) => {
      const start = i * sliceSize
      return Array.from({ length: sliceSize }, (__, j) => start + j)
    })
  }

  const sectionBoundaries = getSectionBoundaries(sectionMode)

  const overlaps = (toppingSections: number[], sectionIndices: number[]): boolean => {
    const sectionSet = new Set(sectionIndices)
    return toppingSections.some(idx => sectionSet.has(idx))
  }

  const baseSauceIsWhole = !data?.sauceSections
  const baseCheeseIsWhole = !data?.cheeseSections
  const hasNewSauceArray = (data?.sauces?.length ?? 0) > 0
  const hasNewCheeseArray = (data?.cheeses?.length ?? 0) > 0

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

  parts.push(line(''))

  if (!data) return Buffer.concat(parts)

  const getSectionLabel = (sectionNum: number, totalSections: number): string => {
    const labelStyle = settings.sections.showSectionLabels || 'full'
    if (totalSections === 1) return 'WHOLE'
    if (totalSections === 2) {
      if (labelStyle === 'full') return sectionNum === 1 ? 'LEFT HALF' : 'RIGHT HALF'
      if (labelStyle === 'abbreviated') return sectionNum === 1 ? 'L' : 'R'
      if (labelStyle === 'numbered') return `${sectionNum}/${totalSections}`
    }
    if (labelStyle === 'full') return `SEC. ${sectionNum}`
    if (labelStyle === 'abbreviated') return `S${sectionNum}`
    if (labelStyle === 'numbered') return `${sectionNum}/${totalSections}`
    return `SEC. ${sectionNum}`
  }

  const allToppings = [
    ...(data.toppings || []),
    ...(data.sauces || []),
    ...(data.cheeses || []),
  ]

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
    for (let secIdx = 0; secIdx < sectionBoundaries.length; secIdx++) {
      const sectionIndices = sectionBoundaries[secIdx]
      const sectionNum = secIdx + 1
      const sectionItems: string[] = []

      if (!hasNewSauceArray && !baseSauceIsWhole && pizzaData.sauce && data.sauceSections) {
        if (overlaps(data.sauceSections, sectionIndices)) {
          const saucePrefix = pizzaData.sauceAmount !== 'regular' ? `${pizzaData.sauceAmount.toUpperCase()} ` : ''
          sectionItems.push(`${saucePrefix}${pizzaData.sauce.name.toUpperCase()} SAUCE`)
        }
      }

      if (!hasNewCheeseArray && !baseCheeseIsWhole && pizzaData.cheese && data.cheeseSections) {
        if (overlaps(data.cheeseSections, sectionIndices)) {
          const cheesePrefix = pizzaData.cheeseAmount !== 'regular' ? `${pizzaData.cheeseAmount.toUpperCase()} ` : ''
          sectionItems.push(`${cheesePrefix}${pizzaData.cheese.name.toUpperCase()} CHEESE`)
        }
      }

      for (const item of allToppings) {
        const toppingSections = item.sections
        const isWhole = !toppingSections || toppingSections.length === 0 || toppingSections.length >= MAX_SECTIONS
        if (isWhole || overlaps(toppingSections, sectionIndices)) {
          const amountPrefix = item.amount !== 'regular' ? `${item.amount.toUpperCase()} ` : ''
          sectionItems.push(`${amountPrefix}${item.name}`)
        }
      }

      if (sectionItems.length === 0) continue

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

  // Cooking instructions
  if (pizzaData.cookingInstructions && settings.specialInstructions.show) {
    const instrStyle = settings.specialInstructions.style
    let instrText = `COOK: ${pizzaData.cookingInstructions}`
    if (settings.specialInstructions.allCaps) instrText = instrText.toUpperCase()
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
    if (hasRed && useRedForNotes) parts.push(BLACK)
  }

  // Cut style
  if (pizzaData.cutStyle) {
    let cutText = `CUT: ${pizzaData.cutStyle}`
    if (settings.toppings.allCaps) cutText = cutText.toUpperCase()
    parts.push(toppingSizeCmd)
    parts.push(line(cutText))
    parts.push(NORMAL)
  }

  return Buffer.concat(parts)
}
