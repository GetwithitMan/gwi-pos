/**
 * PrintTemplateFactory - Factory pattern for different ticket formats
 *
 * Builds ESC/POS buffers based on template type, allowing one printer IP
 * to serve multiple logical stations with different formats.
 *
 * Templates:
 * - STANDARD_KITCHEN: Compact food prep tickets
 * - PIZZA_STATION: Large fonts, sectional toppings for pizza make line
 * - EXPO_SUMMARY: All items grouped by source table for expeditor
 * - ENTERTAINMENT_TICKET: Game rentals with start time and "Return By"
 * - BAR_TICKET: Bar-focused drink formatting
 *
 * Settings-Driven Mode:
 * - Use buildBufferWithSettings() to generate tickets based on Visual Editor settings
 * - Every element (station name, order number, etc.) uses its own alignment, size, style
 * - Supports reverse print (thermal) and red ribbon (impact) for alerts
 */

import {
  ESCPOS,
  line,
  boldLine,
  divider,
  twoColumnLine,
  buildDocument,
  buildDocumentNoCut,
  PAPER_WIDTH,
  text,
} from '@/lib/escpos/commands'
import type { TemplateType, RoutedItem, OrderContext, PizzaItemData } from '@/types/routing'
import {
  type PizzaPrintSettings,
  type PrintTemplateSettings,
  type ElementConfig,
  type DividerConfig,
  type AlertRule,
  mergePrintTemplateSettings,
} from '@/types/print'

// Print data structure for templates
export interface PrintTemplateData {
  // Order context
  order: OrderContext

  // Items to print
  items: RoutedItem[]

  // Template-specific settings
  pizzaSettings?: Partial<PizzaPrintSettings>

  // Entertainment-specific data
  entertainmentData?: {
    gameName: string
    startTime: Date
    durationMinutes: number
    returnByTime: Date
    tableNumber?: string
    customerName?: string
  }
}

/**
 * Get paper character width from mm
 */
function getCharWidth(paperWidth: number | null): number {
  switch (paperWidth) {
    case 80:
      return PAPER_WIDTH['80mm']
    case 58:
      return PAPER_WIDTH['58mm']
    case 40:
      return PAPER_WIDTH['40mm']
    default:
      return PAPER_WIDTH['80mm']
  }
}

/**
 * Format T-S notation for an item
 */
function formatPositionPrefix(item: RoutedItem): string {
  if (item.sourceTableAbbrev && item.seatNumber) {
    return `${item.sourceTableAbbrev}-S${item.seatNumber}: `
  } else if (item.sourceTableAbbrev) {
    return `${item.sourceTableAbbrev}: `
  } else if (item.seatNumber) {
    return `S${item.seatNumber}: `
  }
  return ''
}

// === SETTINGS-DRIVEN HELPERS ===

/**
 * Get size command based on settings
 */
function getSizeCommand(size: 'normal' | 'large' | 'xlarge', isImpact: boolean): Buffer {
  if (size === 'xlarge') {
    return isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
  } else if (size === 'large') {
    return isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
  }
  return isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE
}

/**
 * Get alignment command
 */
function getAlignCommand(align: 'left' | 'center' | 'right'): Buffer {
  switch (align) {
    case 'center':
      return ESCPOS.ALIGN_CENTER
    case 'right':
      return ESCPOS.ALIGN_RIGHT
    default:
      return ESCPOS.ALIGN_LEFT
  }
}

/**
 * Build divider from config
 */
function buildDivider(config: DividerConfig, width: number): Buffer {
  if (config.style === 'blank') {
    return line('')
  }
  const chars: Record<DividerConfig['style'], string> = {
    dash: '-',
    double: '=',
    star: '*',
    dot: '.',
    thick: '█',
    blank: ' ',
  }
  const char = chars[config.style] || '-'
  const len = config.fullWidth ? width : Math.floor(width * 0.75)
  return line(char.repeat(len))
}

/**
 * Format pre-modifier based on style
 */
function formatPreModifier(
  preModifier: string,
  style: 'plain' | 'stars' | 'brackets' | 'parens' | 'caps'
): string {
  const mod = style === 'caps' ? preModifier.toUpperCase() : preModifier
  switch (style) {
    case 'stars':
      return `*${mod}*`
    case 'brackets':
      return `[${mod}]`
    case 'parens':
      return `(${mod})`
    default:
      return mod
  }
}

/**
 * Get modifier prefix character
 */
function getModifierPrefix(prefix: 'none' | 'dash' | 'bullet' | 'arrow' | 'asterisk'): string {
  switch (prefix) {
    case 'dash':
      return '- '
    case 'bullet':
      return '• '
    case 'arrow':
      return '> '
    case 'asterisk':
      return '* '
    default:
      return ''
  }
}

/**
 * Format seat number based on format setting
 */
function formatSeatNumber(
  seat: number | null,
  format: 'S1' | 'Seat 1' | '#1' | '(1)'
): string {
  if (!seat) return ''
  switch (format) {
    case 'Seat 1':
      return `Seat ${seat}`
    case '#1':
      return `#${seat}`
    case '(1)':
      return `(${seat})`
    default:
      return `S${seat}`
  }
}

/**
 * Format quantity based on settings
 */
function formatQuantity(
  qty: number,
  position: 'before' | 'after' | 'none',
  format: 'number' | 'numberX' | 'xNumber'
): { before: string; after: string } {
  if (position === 'none') return { before: '', after: '' }
  let formatted: string
  switch (format) {
    case 'numberX':
      formatted = `${qty}x`
      break
    case 'xNumber':
      formatted = `x${qty}`
      break
    default:
      formatted = `${qty}`
  }
  if (position === 'before') return { before: formatted + ' ', after: '' }
  return { before: '', after: ' ' + formatted }
}

/**
 * Check if item matches an alert rule
 */
function checkAlertTrigger(
  item: RoutedItem,
  order: OrderContext,
  rule: AlertRule
): boolean {
  const lowerNotes = (item.specialNotes || '').toLowerCase()
  const lowerName = item.name.toLowerCase()

  switch (rule.trigger) {
    case 'allergy':
      return lowerNotes.includes('allergy') || lowerNotes.includes('allergic')
    case 'rush':
      return lowerNotes.includes('rush') || (order as any).isRush === true
    case 'fire':
      return lowerNotes.includes('fire') || (order as any).isFire === true
    case 'vip':
      return (order as any).isVIP === true
    case 'custom':
      return rule.customKeyword
        ? lowerNotes.includes(rule.customKeyword.toLowerCase()) ||
            lowerName.includes(rule.customKeyword.toLowerCase())
        : false
    default:
      return false
  }
}

/**
 * Build a line with element configuration (alignment, size, bold, reverse, etc.)
 */
function buildElementLine(
  content: string,
  config: ElementConfig,
  isImpact: boolean,
  width: number
): Buffer[] {
  const parts: Buffer[] = []

  // Alignment
  parts.push(getAlignCommand(config.alignment))

  // Size
  parts.push(getSizeCommand(config.size, isImpact))

  // Color (impact only)
  if (config.redPrint && isImpact) {
    parts.push(ESCPOS.COLOR_RED)
  }

  // Reverse print (thermal inverse)
  if (config.reversePrint) {
    parts.push(ESCPOS.INVERSE_ON)
  }

  // Bold
  if (config.bold) {
    parts.push(ESCPOS.BOLD_ON)
  }

  // Apply text transformations
  let finalText = config.prefix + content + config.suffix
  if (config.caps) {
    finalText = finalText.toUpperCase()
  }

  // Add padding for reverse print to look better
  if (config.reversePrint) {
    finalText = ` ${finalText} `
  }

  parts.push(line(finalText))

  // Reset formatting
  if (config.bold) {
    parts.push(ESCPOS.BOLD_OFF)
  }
  if (config.reversePrint) {
    parts.push(ESCPOS.INVERSE_OFF)
  }
  if (config.redPrint && isImpact) {
    parts.push(ESCPOS.COLOR_BLACK)
  }

  // Reset size
  parts.push(isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE)

  // Reset alignment to left
  parts.push(ESCPOS.ALIGN_LEFT)

  // Border bottom
  if (config.borderBottom !== 'none') {
    const borderChars: Record<string, string> = {
      dash: '-',
      double: '=',
      star: '*',
      dot: '.',
    }
    parts.push(line(borderChars[config.borderBottom]?.repeat(width) || ''))
  }

  return parts
}

/**
 * Get header element value from order data
 */
function getHeaderElementValue(
  elementId: string,
  data: PrintTemplateData,
  stationName?: string
): string | null {
  switch (elementId) {
    case 'stationName':
      return stationName || 'KITCHEN'
    case 'orderNumber':
      return String(data.order.orderNumber)
    case 'orderType':
      return data.order.orderType || ''
    case 'tableName':
      return data.order.tableName || ''
    case 'tabName':
      return data.order.tabName || ''
    case 'guestCount':
      return (data.order as any).guestCount
        ? String((data.order as any).guestCount)
        : null
    case 'serverName':
      return data.order.employeeName || ''
    case 'checkNumber':
      return (data.order as any).checkNumber
        ? String((data.order as any).checkNumber)
        : null
    case 'timestamp':
      return new Date().toLocaleTimeString()
    case 'date':
      return new Date().toLocaleDateString()
    default:
      return null
  }
}

/**
 * PrintTemplateFactory - Build ticket buffers based on template type
 */
export class PrintTemplateFactory {
  /**
   * Build ESC/POS buffer(s) based on template type (legacy hardcoded templates)
   * @returns Buffer for the ticket
   */
  static buildBuffer(
    templateType: TemplateType,
    data: PrintTemplateData,
    paperWidth: number | null,
    printerType: 'thermal' | 'impact' | null
  ): Buffer {
    const width = getCharWidth(paperWidth)
    const isImpact = printerType === 'impact'

    switch (templateType) {
      case 'PIZZA_STATION':
        return this.buildPizzaStationTicket(data, width, isImpact)
      case 'EXPO_SUMMARY':
        return this.buildExpoSummaryTicket(data, width, isImpact)
      case 'ENTERTAINMENT_TICKET':
        return this.buildEntertainmentTicket(data, width, isImpact)
      case 'BAR_TICKET':
        return this.buildBarTicket(data, width, isImpact)
      case 'STANDARD_KITCHEN':
      default:
        return this.buildStandardKitchenTicket(data, width, isImpact)
    }
  }

  /**
   * Build ESC/POS buffer using Visual Editor settings
   * This is the settings-driven mode that uses PrintTemplateSettings
   * for full customization of every element.
   *
   * @param data - Order and item data
   * @param settings - PrintTemplateSettings from Visual Editor
   * @param paperWidth - Paper width in mm (80, 58, 40)
   * @param printerType - 'thermal' or 'impact'
   * @param stationName - Name of the station (for header)
   * @returns Buffer for the ticket
   */
  static buildBufferWithSettings(
    data: PrintTemplateData,
    settings: Partial<PrintTemplateSettings> | null | undefined,
    paperWidth: number | null,
    printerType: 'thermal' | 'impact' | null,
    stationName?: string
  ): Buffer {
    const s = mergePrintTemplateSettings(settings)
    const width = getCharWidth(paperWidth)
    const isImpact = printerType === 'impact'

    const content: Buffer[] = []
    const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE

    // === HEADER ELEMENTS ===
    // Build each enabled header element in order
    for (const element of s.headerElements) {
      if (!element.enabled) continue

      const value = getHeaderElementValue(element.id, data, stationName)
      if (value === null || value === '') continue

      content.push(...buildElementLine(value, element, isImpact, width))
    }

    // Header divider
    content.push(buildDivider(s.dividers.afterHeader, width))

    // === ITEMS ===
    // Group by category if enabled
    let itemsByCategory: Map<string, RoutedItem[]> = new Map()

    if (s.categories.enabled) {
      for (const item of data.items) {
        const catName = item.categoryName || 'Other'
        if (!itemsByCategory.has(catName)) {
          itemsByCategory.set(catName, [])
        }
        itemsByCategory.get(catName)!.push(item)
      }
    } else {
      itemsByCategory.set('_all', data.items)
    }

    // Group by seat if enabled
    if (s.seats.groupBySeat) {
      const regrouped = new Map<string, RoutedItem[]>()
      for (const [category, items] of itemsByCategory) {
        const bySeats = new Map<string, RoutedItem[]>()
        for (const item of items) {
          const seatKey = item.seatNumber ? `Seat ${item.seatNumber}` : 'No Seat'
          if (!bySeats.has(seatKey)) {
            bySeats.set(seatKey, [])
          }
          bySeats.get(seatKey)!.push(item)
        }
        // Flatten back with seat headers
        for (const [seatLabel, seatItems] of bySeats) {
          const key = s.categories.enabled ? `${category} - ${seatLabel}` : seatLabel
          regrouped.set(key, seatItems)
        }
      }
      itemsByCategory = regrouped
    }

    // Print items
    let isFirstCategory = true
    for (const [categoryName, items] of itemsByCategory) {
      // Category header
      if (s.categories.enabled && categoryName !== '_all') {
        if (!isFirstCategory && s.categories.dividerAbove) {
          content.push(buildDivider(s.dividers.betweenCategories, width))
        }

        const catAlign = getAlignCommand(s.categories.alignment)
        const catSize = getSizeCommand(s.categories.size, isImpact)
        content.push(catAlign)
        content.push(catSize)

        if (s.categories.style === 'reverse') {
          content.push(ESCPOS.INVERSE_ON)
        }
        if (s.categories.style === 'bold' || s.categories.style === 'banner') {
          content.push(ESCPOS.BOLD_ON)
        }

        let catText = s.categories.caps ? categoryName.toUpperCase() : categoryName
        if (s.categories.style === 'boxed') {
          catText = `[ ${catText} ]`
        } else if (s.categories.style === 'banner') {
          catText = `=== ${catText} ===`
        }

        content.push(line(catText))

        if (s.categories.style === 'bold' || s.categories.style === 'banner') {
          content.push(ESCPOS.BOLD_OFF)
        }
        if (s.categories.style === 'reverse') {
          content.push(ESCPOS.INVERSE_OFF)
        }
        content.push(NORMAL)
        content.push(ESCPOS.ALIGN_LEFT)
      }
      isFirstCategory = false

      // Print each item
      for (const item of items) {
        // Check for alert triggers
        let matchedAlert: AlertRule | null = null
        for (const alert of s.alerts) {
          if (checkAlertTrigger(item, data.order, alert)) {
            matchedAlert = alert
            break
          }
        }

        // Build item line
        const qty = formatQuantity(item.quantity, s.items.quantityPosition, s.items.quantityFormat)
        let seatPrefix = ''
        if (s.seats.display === 'prefix' && item.seatNumber) {
          seatPrefix = formatSeatNumber(item.seatNumber, s.seats.format) + ': '
        }

        let itemName = s.items.caps ? item.name.toUpperCase() : item.name
        const itemText = `${qty.before}${seatPrefix}${itemName}${qty.after}`

        // Apply item formatting
        content.push(getAlignCommand(s.items.alignment))

        // Size (or alert override)
        const itemSize =
          matchedAlert && matchedAlert.forceSize !== 'inherit'
            ? matchedAlert.forceSize
            : s.items.size
        content.push(getSizeCommand(itemSize, isImpact))

        // Alert styling
        if (matchedAlert) {
          if (isImpact) {
            // Impact: use red
            if (
              matchedAlert.impactStyle === 'red' ||
              matchedAlert.impactStyle === 'red-bold' ||
              matchedAlert.impactStyle === 'red-xlarge'
            ) {
              content.push(ESCPOS.COLOR_RED)
            }
            if (matchedAlert.impactStyle === 'red-bold') {
              content.push(ESCPOS.BOLD_ON)
            }
          } else {
            // Thermal: use reverse or bold
            if (matchedAlert.thermalStyle === 'reverse' || matchedAlert.thermalStyle === 'boxed') {
              content.push(ESCPOS.INVERSE_ON)
            }
            if (matchedAlert.thermalStyle === 'bold') {
              content.push(ESCPOS.BOLD_ON)
            }
          }
        } else if (s.items.bold) {
          content.push(ESCPOS.BOLD_ON)
        }

        content.push(line(itemText))

        // Reset alert/item formatting
        if (matchedAlert) {
          if (isImpact) {
            content.push(ESCPOS.COLOR_BLACK)
            content.push(ESCPOS.BOLD_OFF)
          } else {
            content.push(ESCPOS.INVERSE_OFF)
            content.push(ESCPOS.BOLD_OFF)
          }
        } else if (s.items.bold) {
          content.push(ESCPOS.BOLD_OFF)
        }
        content.push(NORMAL)
        content.push(ESCPOS.ALIGN_LEFT)

        // Modifiers
        const modIndent = ' '.repeat(s.modifiers.indent)
        const modPrefix = getModifierPrefix(s.modifiers.prefix)

        for (const mod of item.modifiers) {
          const extraIndent = '  '.repeat(mod.depth)
          let modText = mod.name
          if (mod.preModifier) {
            const formattedPre = formatPreModifier(mod.preModifier, s.preModifiers.style)
            modText = `${formattedPre} ${modText}`

            // Highlight pre-modifiers if configured
            if (s.preModifiers.highlight && isImpact) {
              content.push(ESCPOS.COLOR_RED)
            } else if (s.preModifiers.highlight && !isImpact) {
              content.push(ESCPOS.INVERSE_ON)
            }
          }

          if (s.modifiers.caps) {
            modText = modText.toUpperCase()
          }
          if (s.modifiers.bold) {
            content.push(ESCPOS.BOLD_ON)
          }

          content.push(line(`${modIndent}${extraIndent}${modPrefix}${modText}`))

          if (s.modifiers.bold) {
            content.push(ESCPOS.BOLD_OFF)
          }
          if (mod.preModifier && s.preModifiers.highlight) {
            if (isImpact) {
              content.push(ESCPOS.COLOR_BLACK)
            } else {
              content.push(ESCPOS.INVERSE_OFF)
            }
          }
        }

        // Ingredient modifications (for items with detailed ingredients)
        for (const ing of item.ingredientModifications) {
          const modType = ing.modificationType.toUpperCase()
          const formattedMod = formatPreModifier(modType, s.preModifiers.style)

          if (s.preModifiers.highlight) {
            if (isImpact) {
              content.push(ESCPOS.COLOR_RED)
            } else {
              content.push(ESCPOS.INVERSE_ON)
            }
          }

          let ingText = `${modIndent}${formattedMod} ${ing.ingredientName}`
          if (s.modifiers.caps) {
            ingText = ingText.toUpperCase()
          }
          content.push(line(ingText))

          if (s.preModifiers.highlight) {
            if (isImpact) {
              content.push(ESCPOS.COLOR_BLACK)
            } else {
              content.push(ESCPOS.INVERSE_OFF)
            }
          }
        }

        // Special notes
        if (item.specialNotes && s.notes.enabled) {
          const notePrefix = s.notes.prefix ? s.notes.prefix + ' ' : ''

          if (s.notes.style === 'reverse') {
            content.push(ESCPOS.INVERSE_ON)
          } else if (s.notes.style === 'boxed') {
            content.push(line('┌' + '─'.repeat(width - 2) + '┐'))
          }
          if (isImpact && s.notes.style !== 'plain') {
            content.push(ESCPOS.COLOR_RED)
          }

          content.push(line(`${modIndent}${notePrefix}${item.specialNotes}`))

          if (s.notes.style === 'boxed') {
            content.push(line('└' + '─'.repeat(width - 2) + '┘'))
          }
          if (s.notes.style === 'reverse') {
            content.push(ESCPOS.INVERSE_OFF)
          }
          if (isImpact && s.notes.style !== 'plain') {
            content.push(ESCPOS.COLOR_BLACK)
          }
        }

        // Resend indicator
        if (item.resendCount > 0 && s.indicators.resend.enabled) {
          if (s.indicators.resend.reverse) {
            if (isImpact) {
              content.push(ESCPOS.COLOR_RED)
            } else {
              content.push(ESCPOS.INVERSE_ON)
            }
          }
          content.push(ESCPOS.BOLD_ON)
          const resendText = s.indicators.resend.format.replace(
            '**',
            `#${item.resendCount}`
          )
          content.push(line(`${modIndent}${resendText}`))
          content.push(ESCPOS.BOLD_OFF)
          if (s.indicators.resend.reverse) {
            if (isImpact) {
              content.push(ESCPOS.COLOR_BLACK)
            } else {
              content.push(ESCPOS.INVERSE_OFF)
            }
          }
        }

        // Item spacing
        if (!s.spacing.compact && s.spacing.linesBetweenItems > 0) {
          for (let i = 0; i < s.spacing.linesBetweenItems; i++) {
            content.push(line(''))
          }
        }
      }
    }

    // === FOOTER ===
    if (s.footer.enabled) {
      content.push(buildDivider(s.dividers.beforeFooter, width))

      if (s.footer.showTime) {
        content.push(line(new Date().toLocaleTimeString()))
      }
      if (s.footer.showTicketNumber && (data.order as any).ticketNumber) {
        content.push(line(`Ticket: ${(data.order as any).ticketNumber}`))
      }
      if (s.footer.customText) {
        content.push(line(s.footer.customText))
      }

      // Duplicate header at end
      if (s.footer.duplicateHeader) {
        content.push(buildDivider(s.dividers.afterHeader, width))
        for (const element of s.headerElements) {
          if (!element.enabled) continue
          const value = getHeaderElementValue(element.id, data, stationName)
          if (value === null || value === '') continue
          content.push(...buildElementLine(value, element, isImpact, width))
        }
      }
    }

    return isImpact ? buildDocumentNoCut(...content) : buildDocument(...content)
  }

  /**
   * Build customer receipt with tip lines, suggested tips, signature slips
   * Uses the receipt-specific settings from PrintTemplateSettings
   */
  static buildReceiptWithSettings(
    data: PrintTemplateData,
    settings: Partial<PrintTemplateSettings> | null | undefined,
    paperWidth: number | null,
    printerType: 'thermal' | 'impact' | null,
    totals: {
      subtotal: number
      discount?: number
      tax: number
      total: number
      payments?: { method: string; amount: number }[]
      change?: number
      // Surcharge (T-080 Phase 5)
      surchargeAmount?: number
      surchargePercent?: number
      surchargeDisclosure?: string
    }
  ): Buffer {
    const s = mergePrintTemplateSettings(settings)
    const width = getCharWidth(paperWidth)
    const isImpact = printerType === 'impact'

    const content: Buffer[] = []
    const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE
    const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
    const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE

    // Header elements
    for (const element of s.headerElements) {
      if (!element.enabled) continue
      const value = getHeaderElementValue(element.id, data)
      if (value === null || value === '') continue
      content.push(...buildElementLine(value, element, isImpact, width))
    }

    content.push(buildDivider(s.dividers.afterHeader, width))

    // Items (compact for receipts)
    for (const item of data.items) {
      const qty = formatQuantity(item.quantity, s.items.quantityPosition, s.items.quantityFormat)
      const itemText = `${qty.before}${item.name}${qty.after}`
      const priceText = `$${((item as any).price || 0).toFixed(2)}`

      content.push(twoColumnLine(itemText, priceText, width))

      // Modifiers
      for (const mod of item.modifiers) {
        const modPrice = (mod as any).price || 0
        if (modPrice > 0) {
          content.push(
            twoColumnLine(`  ${mod.name}`, `$${modPrice.toFixed(2)}`, width)
          )
        } else {
          content.push(line(`  ${mod.name}`))
        }
      }
    }

    content.push(buildDivider({ style: 'dash', fullWidth: true }, width))

    // Totals
    content.push(twoColumnLine('Subtotal:', `$${totals.subtotal.toFixed(2)}`, width))
    if (totals.discount && totals.discount > 0) {
      content.push(twoColumnLine('Discount:', `-$${totals.discount.toFixed(2)}`, width))
    }
    if (totals.surchargeAmount && totals.surchargeAmount > 0) {
      const surchargePctLabel = totals.surchargePercent ? ` (${totals.surchargePercent}%)` : ''
      content.push(twoColumnLine(`CC Surcharge${surchargePctLabel}:`, `$${totals.surchargeAmount.toFixed(2)}`, width))
    }
    content.push(twoColumnLine('Tax:', `$${totals.tax.toFixed(2)}`, width))
    content.push(TALL)
    content.push(ESCPOS.BOLD_ON)
    content.push(twoColumnLine('TOTAL:', `$${totals.total.toFixed(2)}`, width))
    content.push(ESCPOS.BOLD_OFF)
    content.push(NORMAL)

    // Payments
    if (totals.payments && totals.payments.length > 0) {
      content.push(line(''))
      for (const pmt of totals.payments) {
        content.push(twoColumnLine(pmt.method, `$${pmt.amount.toFixed(2)}`, width))
      }
      if (totals.change && totals.change > 0) {
        content.push(twoColumnLine('Change:', `$${totals.change.toFixed(2)}`, width))
      }
    }

    // Tip section
    if (s.receipt.tipLine) {
      content.push(line(''))
      content.push(buildDivider({ style: 'dash', fullWidth: true }, width))

      // Suggested tips
      if (s.receipt.suggestedTips.length > 0) {
        const tipBase =
          s.receipt.tipCalculation === 'pre-tax' ? totals.subtotal : totals.total
        content.push(line(''))
        content.push(ESCPOS.ALIGN_CENTER)
        content.push(line('Suggested Gratuity'))
        content.push(ESCPOS.ALIGN_LEFT)

        for (const pct of s.receipt.suggestedTips) {
          const tipAmount = (tipBase * pct) / 100
          const tipTotal = totals.total + tipAmount
          content.push(
            twoColumnLine(
              `${pct}% = $${tipAmount.toFixed(2)}`,
              `Total: $${tipTotal.toFixed(2)}`,
              width
            )
          )
        }
      }

      content.push(line(''))
      content.push(twoColumnLine('Tip:', '_____________', width))
      content.push(line(''))
      content.push(twoColumnLine('Total:', '_____________', width))
    }

    // Signature
    const sig = s.receipt.signature
    if (sig?.enabled && (sig.copies || 1) > 0) {
      content.push(line(''))
      content.push(line(''))

      // Signature line style
      const sigLineChar = sig.lineStyle === 'dotted' ? '.' : '_'
      const sigPrefix = sig.lineStyle === 'x-line' ? 'x' : ''
      content.push(line(sigPrefix + sigLineChar.repeat(width - sigPrefix.length)))

      content.push(ESCPOS.ALIGN_CENTER)
      content.push(line('Signature'))

      // Copy label
      if (sig.showCopyLabel) {
        content.push(line(''))
        content.push(ESCPOS.BOLD_ON)
        content.push(line(sig.customerCopyLabel || 'CUSTOMER COPY'))
        content.push(ESCPOS.BOLD_OFF)
      }
      content.push(ESCPOS.ALIGN_LEFT)
    }

    // Surcharge disclosure (T-080 Phase 5)
    if (totals.surchargeAmount && totals.surchargeAmount > 0) {
      content.push(line(''))
      content.push(ESCPOS.ALIGN_CENTER)
      content.push(line(totals.surchargeDisclosure || '*Credit card surcharge applied per Visa/MC guidelines'))
      content.push(ESCPOS.ALIGN_LEFT)
    }

    // Terms text
    if (s.receipt.termsText) {
      content.push(line(''))
      content.push(ESCPOS.ALIGN_CENTER)
      content.push(line(s.receipt.termsText))
      content.push(ESCPOS.ALIGN_LEFT)
    }

    // Promo text
    if (s.receipt.promoText) {
      content.push(line(''))
      content.push(ESCPOS.ALIGN_CENTER)
      content.push(ESCPOS.BOLD_ON)
      content.push(line(s.receipt.promoText))
      content.push(ESCPOS.BOLD_OFF)
      content.push(ESCPOS.ALIGN_LEFT)
    }

    return isImpact ? buildDocumentNoCut(...content) : buildDocument(...content)
  }

  /**
   * STANDARD_KITCHEN: Compact, qty + item + modifiers, table/seat info
   */
  private static buildStandardKitchenTicket(
    data: PrintTemplateData,
    width: number,
    isImpact: boolean
  ): Buffer {
    const content: Buffer[] = []

    const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
    const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
    const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE

    // Header
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(LARGE)
    content.push(line('KITCHEN'))
    content.push(NORMAL)
    content.push(ESCPOS.ALIGN_LEFT)
    content.push(divider(width))

    // Order info
    content.push(TALL)
    content.push(line(`#${data.order.orderNumber}`))
    content.push(NORMAL)

    if (data.order.tableName) {
      content.push(line(data.order.tableName))
    } else if (data.order.tabName) {
      content.push(line(data.order.tabName))
    }

    content.push(line(`Server: ${data.order.employeeName}`))
    content.push(line(new Date().toLocaleTimeString()))
    content.push(divider(width))

    // Items - compact format
    for (const item of data.items) {
      // Build T-S notation prefix
      const positionPrefix = formatPositionPrefix(item)
      let itemLine = `${positionPrefix}${item.quantity}x ${item.name}`.toUpperCase()

      content.push(ESCPOS.BOLD_ON)
      content.push(line(itemLine))
      content.push(ESCPOS.BOLD_OFF)

      // Modifiers (indented)
      for (const mod of item.modifiers) {
        const indent = '  '.repeat(Math.max(1, mod.depth + 1))
        let modText = mod.preModifier ? `${mod.preModifier} ${mod.name}` : mod.name
        content.push(line(`${indent}${modText.toUpperCase()}`))
      }

      // Ingredient modifications with highlighting
      for (const ing of item.ingredientModifications) {
        const modType = ing.modificationType.toUpperCase()
        if (modType === 'NO' && isImpact) {
          content.push(ESCPOS.COLOR_RED)
          content.push(line(`  ** NO ${ing.ingredientName.toUpperCase()} **`))
          content.push(ESCPOS.COLOR_BLACK)
        } else {
          content.push(line(`  ${modType} ${ing.ingredientName.toUpperCase()}`))
        }
      }

      // Special notes
      if (item.specialNotes) {
        if (isImpact) {
          content.push(ESCPOS.COLOR_RED)
        }
        content.push(line(`  NOTE: ${item.specialNotes.toUpperCase()}`))
        if (isImpact) {
          content.push(ESCPOS.COLOR_BLACK)
        }
      }

      // Resend indicator
      if (item.resendCount > 0) {
        content.push(ESCPOS.COLOR_RED)
        content.push(ESCPOS.BOLD_ON)
        content.push(line(`  *** RESEND #${item.resendCount} ***`))
        content.push(ESCPOS.BOLD_OFF)
        content.push(ESCPOS.COLOR_BLACK)
      }

      content.push(line(''))
    }

    content.push(divider(width))

    return isImpact
      ? buildDocumentNoCut(...content)
      : buildDocument(...content)
  }

  /**
   * PIZZA_STATION: Large fonts, size/crust prominent, toppings by section
   */
  private static buildPizzaStationTicket(
    data: PrintTemplateData,
    width: number,
    isImpact: boolean
  ): Buffer {
    const content: Buffer[] = []

    const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
    const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
    const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE

    // Header - "PIZZA MAKE"
    content.push(ESCPOS.ALIGN_CENTER)
    if (isImpact) content.push(ESCPOS.COLOR_RED)
    content.push(LARGE)
    content.push(line('PIZZA MAKE'))
    content.push(NORMAL)
    if (isImpact) content.push(ESCPOS.COLOR_BLACK)
    content.push(ESCPOS.ALIGN_LEFT)
    content.push(divider(width))

    // Order info
    content.push(LARGE)
    content.push(line(`#${data.order.orderNumber}`))
    content.push(NORMAL)

    if (data.order.tableName) {
      content.push(TALL)
      content.push(line(data.order.tableName))
      content.push(NORMAL)
    }

    content.push(line(`Server: ${data.order.employeeName}`))
    content.push(divider(width))

    // Pizza items - each pizza gets prominent display
    const pizzaItems = data.items.filter((i) => i.isPizza && i.pizzaData)

    for (const item of pizzaItems) {
      const pizza = item.pizzaData!

      // Size prominent
      content.push(LARGE)
      const sizeText = pizza.sizeInches
        ? `${pizza.sizeName.toUpperCase()} (${pizza.sizeInches}")`
        : pizza.sizeName.toUpperCase()
      content.push(line(sizeText))
      content.push(NORMAL)

      // Crust type
      content.push(TALL)
      content.push(line(`${pizza.crustName.toUpperCase()} CRUST`))
      content.push(NORMAL)

      // Sauce and cheese
      if (pizza.sauceName) {
        const saucePrefix =
          pizza.sauceAmount !== 'regular' ? `${pizza.sauceAmount.toUpperCase()} ` : ''
        content.push(line(`  ${saucePrefix}${pizza.sauceName.toUpperCase()} SAUCE`))
      }

      if (pizza.cheeseName) {
        const cheesePrefix =
          pizza.cheeseAmount !== 'regular' ? `${pizza.cheeseAmount.toUpperCase()} ` : ''
        content.push(line(`  ${cheesePrefix}${pizza.cheeseName.toUpperCase()} CHEESE`))
      }

      content.push(line(''))

      // Toppings by section
      if (pizza.toppingsBySection) {
        for (const [sectionLabel, toppings] of Object.entries(pizza.toppingsBySection)) {
          if (toppings.length === 0) continue

          // Section header
          content.push(TALL)
          if (isImpact) content.push(ESCPOS.COLOR_RED)
          content.push(line(`[${sectionLabel}]`))
          if (isImpact) content.push(ESCPOS.COLOR_BLACK)
          content.push(NORMAL)

          // Toppings in this section
          for (const topping of toppings) {
            const prefix =
              topping.amount !== 'regular' ? `${topping.amount.toUpperCase()} ` : ''
            content.push(line(`  ${prefix}${topping.name.toUpperCase()}`))
          }
        }
      }

      // Cooking instructions
      if (pizza.cookingInstructions) {
        content.push(line(''))
        if (isImpact) content.push(ESCPOS.COLOR_RED)
        content.push(TALL)
        content.push(line(`COOK: ${pizza.cookingInstructions.toUpperCase()}`))
        content.push(NORMAL)
        if (isImpact) content.push(ESCPOS.COLOR_BLACK)
      }

      // Cut style
      if (pizza.cutStyle) {
        content.push(line(`CUT: ${pizza.cutStyle.toUpperCase()}`))
      }

      content.push(divider(width))
    }

    // Non-pizza items (sides, drinks) in compact format
    const nonPizzaItems = data.items.filter((i) => !i.isPizza)
    if (nonPizzaItems.length > 0) {
      content.push(line('--- ALSO ---'))
      for (const item of nonPizzaItems) {
        content.push(line(`${item.quantity}x ${item.name.toUpperCase()}`))
      }
      content.push(divider(width))
    }

    return isImpact
      ? buildDocumentNoCut(...content)
      : buildDocument(...content)
  }

  /**
   * EXPO_SUMMARY: All items grouped by source table, shows item status
   */
  private static buildExpoSummaryTicket(
    data: PrintTemplateData,
    width: number,
    isImpact: boolean
  ): Buffer {
    const content: Buffer[] = []

    const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
    const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
    const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE

    // Header - "EXPO"
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(LARGE)
    content.push(line('EXPO'))
    content.push(NORMAL)
    content.push(ESCPOS.ALIGN_LEFT)
    content.push(divider(width, '='))

    // Order info
    content.push(LARGE)
    content.push(line(`#${data.order.orderNumber}`))
    content.push(NORMAL)

    if (data.order.tableName) {
      content.push(TALL)
      content.push(line(data.order.tableName))
      content.push(NORMAL)
    }

    content.push(line(`Server: ${data.order.employeeName}`))
    content.push(line(new Date().toLocaleTimeString()))
    content.push(divider(width, '='))

    // Group items by source table for multi-table orders
    const itemsByTable = new Map<string, RoutedItem[]>()

    for (const item of data.items) {
      const tableKey = item.sourceTableAbbrev || item.sourceTableName || data.order.tableName || 'Order'
      if (!itemsByTable.has(tableKey)) {
        itemsByTable.set(tableKey, [])
      }
      itemsByTable.get(tableKey)!.push(item)
    }

    // Print items grouped by table
    for (const [tableLabel, items] of itemsByTable) {
      if (itemsByTable.size > 1) {
        // Show table subheader for multi-table orders
        content.push(ESCPOS.INVERSE_ON)
        content.push(line(` ${tableLabel} `))
        content.push(ESCPOS.INVERSE_OFF)
      }

      for (const item of items) {
        // T-S notation for seat
        let positionPrefix = ''
        if (item.seatNumber) {
          positionPrefix = `S${item.seatNumber}: `
        }

        const itemText = `[ ] ${positionPrefix}${item.quantity}x ${item.name}`
        content.push(line(itemText.toUpperCase()))

        // Key modifiers only (top level)
        const topModifiers = item.modifiers.filter((m) => m.depth === 0)
        for (const mod of topModifiers.slice(0, 2)) {
          content.push(line(`     ${mod.name.toUpperCase()}`))
        }
      }

      content.push(line(''))
    }

    content.push(divider(width, '='))

    // Summary counts
    const totalItems = data.items.reduce((sum, i) => sum + i.quantity, 0)
    content.push(line(`TOTAL: ${totalItems} items`))

    return isImpact
      ? buildDocumentNoCut(...content)
      : buildDocument(...content)
  }

  /**
   * ENTERTAINMENT_TICKET: Game name, start time, duration, "Return By" time
   */
  private static buildEntertainmentTicket(
    data: PrintTemplateData,
    width: number,
    isImpact: boolean
  ): Buffer {
    const content: Buffer[] = []

    const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
    const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
    const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE

    // Get entertainment item
    const entItem = data.items.find((i) => i.isEntertainment)
    const ent = data.entertainmentData

    // Header with game/table name
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(LARGE)
    content.push(line((ent?.gameName || entItem?.name || 'GAME RENTAL').toUpperCase()))
    content.push(NORMAL)
    content.push(divider(width, '*'))

    // Table number if applicable
    if (ent?.tableNumber) {
      content.push(TALL)
      content.push(line(ent.tableNumber))
      content.push(NORMAL)
    }

    // Customer name if provided
    if (ent?.customerName || data.order.tabName) {
      content.push(line(`Guest: ${ent?.customerName || data.order.tabName}`))
    }

    content.push(line(''))
    content.push(divider(width))

    // Start time - prominent
    const startTime = ent?.startTime || new Date()
    content.push(TALL)
    content.push(
      line(
        `START: ${startTime.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}`
      )
    )
    content.push(NORMAL)

    // Duration
    const durationMinutes = ent?.durationMinutes || 60
    const hours = Math.floor(durationMinutes / 60)
    const mins = durationMinutes % 60
    const durationText = hours > 0 ? `${hours}h ${mins}m` : `${mins} minutes`
    content.push(line(`DURATION: ${durationText}`))

    content.push(line(''))

    // RETURN BY - very prominent
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(ESCPOS.INVERSE_ON)
    content.push(LARGE)
    content.push(line(' RETURN BY '))
    content.push(NORMAL)
    content.push(ESCPOS.INVERSE_OFF)

    const returnByTime =
      ent?.returnByTime || new Date(startTime.getTime() + durationMinutes * 60 * 1000)
    content.push(LARGE)
    content.push(
      line(
        returnByTime.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      )
    )
    content.push(NORMAL)
    content.push(ESCPOS.ALIGN_LEFT)

    content.push(line(''))
    content.push(divider(width, '*'))

    // Order reference
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(line(`Order #${data.order.orderNumber}`))
    content.push(ESCPOS.ALIGN_LEFT)

    return isImpact
      ? buildDocumentNoCut(...content)
      : buildDocument(...content)
  }

  /**
   * BAR_TICKET: Bar-focused drink formatting
   */
  private static buildBarTicket(
    data: PrintTemplateData,
    width: number,
    isImpact: boolean
  ): Buffer {
    const content: Buffer[] = []

    const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
    const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
    const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE

    // Header
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(LARGE)
    content.push(line('BAR'))
    content.push(NORMAL)
    content.push(ESCPOS.ALIGN_LEFT)
    content.push(divider(width))

    // Order info
    content.push(TALL)
    content.push(line(`#${data.order.orderNumber}`))
    content.push(NORMAL)

    if (data.order.tableName) {
      content.push(line(data.order.tableName))
    } else if (data.order.tabName) {
      content.push(boldLine(data.order.tabName))
    }

    content.push(line(`Server: ${data.order.employeeName}`))
    content.push(line(new Date().toLocaleTimeString()))
    content.push(divider(width))

    // Drinks - larger font for bar visibility
    for (const item of data.items) {
      const positionPrefix = formatPositionPrefix(item)

      content.push(TALL)
      content.push(ESCPOS.BOLD_ON)
      content.push(line(`${positionPrefix}${item.quantity}x ${item.name.toUpperCase()}`))
      content.push(ESCPOS.BOLD_OFF)
      content.push(NORMAL)

      // Modifiers (mixers, garnishes, etc.)
      for (const mod of item.modifiers) {
        const modText = mod.preModifier
          ? `${mod.preModifier} ${mod.name}`
          : mod.name
        content.push(line(`  - ${modText}`))
      }

      // Special notes
      if (item.specialNotes) {
        if (isImpact) content.push(ESCPOS.COLOR_RED)
        content.push(line(`  NOTE: ${item.specialNotes}`))
        if (isImpact) content.push(ESCPOS.COLOR_BLACK)
      }

      content.push(line(''))
    }

    content.push(divider(width))

    return isImpact
      ? buildDocumentNoCut(...content)
      : buildDocument(...content)
  }
}
