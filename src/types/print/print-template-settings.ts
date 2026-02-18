/**
 * PrintTemplateSettings - Station-Based Template Engine Types
 *
 * Every metadata field (Station, Tab, Order Type) has its own:
 * - Alignment, Size, Weight, Color property
 * - Reverse Print mode for thermal paper highlighting
 * - Impact Red support for high-priority items (Allergies, Rush)
 * - Configurable ASCII dividers for visual hierarchy
 */

// === ELEMENT CONFIGURATION ===
// Each header/item element is independently configurable
export interface ElementConfig {
  id: string
  label: string
  enabled: boolean
  alignment: 'left' | 'center' | 'right'
  size: 'normal' | 'large' | 'xlarge'
  bold: boolean
  caps: boolean
  reversePrint: boolean // White on black (thermal) / Inverse (impact)
  redPrint: boolean // Red ribbon on impact printers
  prefix: string
  suffix: string
  borderBottom: 'none' | 'dash' | 'double' | 'star' | 'dot'
}

// === DIVIDER CONFIGURATION ===
export interface DividerConfig {
  style: 'dash' | 'double' | 'star' | 'dot' | 'blank' | 'thick'
  fullWidth: boolean
}

// === ALERT RULES ===
export interface AlertRule {
  id: string
  name: string
  trigger: 'allergy' | 'rush' | 'fire' | 'vip' | 'custom'
  customKeyword?: string
  thermalStyle: 'reverse' | 'bold' | 'xlarge' | 'boxed'
  impactStyle: 'red' | 'red-bold' | 'red-xlarge'
  forceSize: 'normal' | 'large' | 'xlarge' | 'inherit'
}

// === MAIN SETTINGS STRUCTURE ===
export interface PrintTemplateSettings {
  // Header elements in display order (draggable)
  headerElements: ElementConfig[]

  // Dividers
  dividers: {
    afterHeader: DividerConfig
    betweenItems: DividerConfig
    betweenCategories: DividerConfig
    beforeFooter: DividerConfig
  }

  // Item display
  items: {
    quantityPosition: 'before' | 'after' | 'none'
    quantityFormat: 'number' | 'numberX' | 'xNumber'
    size: 'normal' | 'large' | 'xlarge'
    bold: boolean
    caps: boolean
    alignment: 'left' | 'center' | 'right'
  }

  // Seat numbers
  seats: {
    display: 'none' | 'prefix' | 'inline' | 'header'
    format: 'S1' | 'Seat 1' | '#1' | '(1)'
    groupBySeat: boolean
    // Separator between seats when grouping
    seatSeparator: 'none' | 'blank' | 'dash' | 'double' | 'newSeat'
    newSeatText: string // e.g., "--- NEW SEAT ---" or "=== SEAT 2 ==="
  }

  // Category headers
  categories: {
    enabled: boolean
    size: 'normal' | 'large' | 'xlarge'
    style: 'plain' | 'bold' | 'boxed' | 'banner' | 'reverse'
    caps: boolean
    alignment: 'left' | 'center' | 'right'
    dividerAbove: boolean
  }

  // Modifiers
  modifiers: {
    indent: 0 | 2 | 4 | 6
    prefix: 'none' | 'dash' | 'bullet' | 'arrow' | 'asterisk'
    size: 'small' | 'normal' | 'large'
    bold: boolean
    caps: boolean
  }

  // Pre-modifiers (NO, EXTRA, LITE)
  preModifiers: {
    style: 'plain' | 'stars' | 'brackets' | 'parens' | 'caps'
    highlight: boolean // Reverse/Red for these
  }

  // Special notes
  notes: {
    enabled: boolean
    style: 'plain' | 'italic' | 'boxed' | 'reverse'
    prefix: string
  }

  // Alert rules
  alerts: AlertRule[]

  // Collapsing
  collapsing: {
    enabled: boolean
    onKitchen: boolean
    onExpo: boolean
  }

  // Reference printing
  reference: {
    enabled: boolean
    style: 'inline' | 'section' | 'footer'
    prefix: string
  }

  // Footer
  footer: {
    enabled: boolean
    showTime: boolean
    showTicketNumber: boolean
    duplicateHeader: boolean
    customText: string
  }

  // Indicators
  indicators: {
    resend: { enabled: boolean; format: string; reverse: boolean }
    rush: { enabled: boolean; format: string; reverse: boolean }
    fire: { enabled: boolean; format: string; reverse: boolean }
    void: { enabled: boolean; format: string; reverse: boolean }
  }

  // Receipt-specific
  receipt: {
    // Receipt Type - Simple (totals only) vs Itemized (full breakdown)
    receiptType: 'simple' | 'itemized'

    // Itemized receipt options (only used when receiptType = 'itemized')
    itemized: {
      showItemPrices: boolean        // Show price per item
      showQuantity: boolean          // Show quantity column (1x, 2x)
      showModifiers: boolean         // Show modifiers under items
      showModifierPrices: boolean    // Show modifier prices (+$0.50)
      collapseDuplicates: boolean    // "2x Burger" vs listing each separately
      groupByCategory: boolean       // Group items by category with headers
      groupBySeat: boolean           // Group items by seat number
      indentModifiers: boolean       // Indent modifiers under parent item
    }

    // Totals section
    totals: {
      showSubtotal: boolean
      showTax: boolean
      showTaxBreakdown: boolean      // Show each tax type separately
      showDiscounts: boolean         // Show discount line items
      showServiceCharge: boolean     // Auto-gratuity line
      showPaymentMethod: boolean     // "VISA *1234"
      showChange: boolean            // Cash change amount
    }

    // Tip section
    tipLine: boolean
    suggestedTips: number[]
    tipCalculation: 'pre-tax' | 'post-tax'
    // Tip styling
    tipSectionStyle: {
      size: 'small' | 'normal' | 'large'
      weight: 'thin' | 'normal' | 'bold' | 'thick'
      tipsPerLine: 1 | 2 | 3  // How many tip suggestions per row
      frame: 'none' | 'box' | 'doubleLine' | 'dashedBox'
      tipInputStyle: 'line' | 'checkbox' | 'blank'  // How to show the tip entry
      showTipTotal: boolean  // Show "Tip + Total = ___"
    }
    // Signature section
    signature: {
      enabled: boolean
      copies: 0 | 1 | 2
      showCopyLabel: boolean  // Show "CUSTOMER COPY" / "MERCHANT COPY"
      customerCopyLabel: string
      merchantCopyLabel: string
      lineStyle: 'solid' | 'dotted' | 'x-line'  // "x_________" style
    }
    // Footer text
    termsText: string
    promoText: string
  }

  // Pizza-specific
  pizza: {
    sizeProminent: boolean
    showInches: boolean
    showCrust: boolean
    sectionStyle: 'brackets' | 'header' | 'indent'
  }

  // Entertainment-specific (waitlist, reservations, session tickets)
  entertainment: {
    // Ticket types to print
    printOnWaitlist: boolean         // Print when added to waitlist
    printOnSessionStart: boolean     // Print when session/reservation starts
    printOnSessionEnd: boolean       // Print when session ends
    printOnTimeWarning: boolean      // Print warning before time expires

    // Content options
    showGuestName: boolean           // Customer/party name
    showPartySize: boolean           // Number of guests
    showTableAssignment: boolean     // Which table/lane/court assigned
    showStartTime: boolean           // Session start time
    showEndTime: boolean             // Session end time / "Return By" time
    showDuration: boolean            // Total session duration
    showTimeRemaining: boolean       // Time left (for warning tickets)
    showInstructions: boolean        // Special instructions field
    showPrice: boolean               // Session price

    // Styling
    nameSize: 'normal' | 'large' | 'xlarge'
    nameBold: boolean
    highlightWarnings: boolean       // Reverse print for time warnings

    // Custom text
    waitlistHeader: string           // e.g., "WAITLIST TICKET"
    sessionStartHeader: string       // e.g., "SESSION STARTED"
    sessionEndHeader: string         // e.g., "TIME'S UP!"
    warningHeader: string            // e.g., "5 MINUTES LEFT"
    instructionsLabel: string        // e.g., "Instructions:"
    returnByLabel: string            // e.g., "Return By:"
  }

  // Global spacing
  spacing: {
    compact: boolean
    linesBetweenItems: 0 | 1 | 2
  }
}

// Default header elements
export const DEFAULT_HEADER_ELEMENTS: ElementConfig[] = [
  { id: 'stationName', label: 'Station Name', enabled: true, alignment: 'center', size: 'large', bold: true, caps: true, reversePrint: true, redPrint: false, prefix: '', suffix: '', borderBottom: 'none' },
  { id: 'orderNumber', label: 'Order Number', enabled: true, alignment: 'center', size: 'xlarge', bold: true, caps: false, reversePrint: false, redPrint: false, prefix: '#', suffix: '', borderBottom: 'none' },
  { id: 'orderType', label: 'Order Type', enabled: true, alignment: 'center', size: 'normal', bold: false, caps: true, reversePrint: false, redPrint: false, prefix: '', suffix: '', borderBottom: 'none' },
  { id: 'tableName', label: 'Table Name', enabled: true, alignment: 'center', size: 'normal', bold: true, caps: false, reversePrint: false, redPrint: false, prefix: 'Table ', suffix: '', borderBottom: 'none' },
  { id: 'tabName', label: 'Tab Name', enabled: false, alignment: 'center', size: 'normal', bold: false, caps: false, reversePrint: false, redPrint: false, prefix: '', suffix: '', borderBottom: 'none' },
  { id: 'guestCount', label: 'Guest Count', enabled: false, alignment: 'left', size: 'normal', bold: false, caps: false, reversePrint: false, redPrint: false, prefix: 'Guests: ', suffix: '', borderBottom: 'none' },
  { id: 'serverName', label: 'Server Name', enabled: true, alignment: 'left', size: 'normal', bold: false, caps: false, reversePrint: false, redPrint: false, prefix: 'Server: ', suffix: '', borderBottom: 'none' },
  { id: 'checkNumber', label: 'Check Number', enabled: false, alignment: 'left', size: 'normal', bold: false, caps: false, reversePrint: false, redPrint: false, prefix: 'Check #', suffix: '', borderBottom: 'none' },
  { id: 'timestamp', label: 'Time', enabled: true, alignment: 'left', size: 'normal', bold: false, caps: false, reversePrint: false, redPrint: false, prefix: '', suffix: '', borderBottom: 'none' },
  { id: 'date', label: 'Date', enabled: false, alignment: 'left', size: 'normal', bold: false, caps: false, reversePrint: false, redPrint: false, prefix: '', suffix: '', borderBottom: 'none' },
]

export const DEFAULT_ALERTS: AlertRule[] = [
  { id: 'allergy', name: 'Allergy Alert', trigger: 'allergy', thermalStyle: 'reverse', impactStyle: 'red-xlarge', forceSize: 'xlarge' },
  { id: 'rush', name: 'Rush Order', trigger: 'rush', thermalStyle: 'reverse', impactStyle: 'red-bold', forceSize: 'large' },
  { id: 'fire', name: 'Fire Now', trigger: 'fire', thermalStyle: 'bold', impactStyle: 'red', forceSize: 'inherit' },
]

export const DEFAULT_PRINT_TEMPLATE_SETTINGS: PrintTemplateSettings = {
  headerElements: DEFAULT_HEADER_ELEMENTS,
  dividers: {
    afterHeader: { style: 'double', fullWidth: true },
    betweenItems: { style: 'blank', fullWidth: true },
    betweenCategories: { style: 'star', fullWidth: true },
    beforeFooter: { style: 'dash', fullWidth: true },
  },
  items: {
    quantityPosition: 'before',
    quantityFormat: 'numberX',
    size: 'normal',
    bold: true,
    caps: true,
    alignment: 'left',
  },
  seats: {
    display: 'prefix',
    format: 'S1',
    groupBySeat: false,
    seatSeparator: 'blank',
    newSeatText: '--- SEAT {n} ---',
  },
  categories: {
    enabled: false,
    size: 'normal',
    style: 'bold',
    caps: true,
    alignment: 'left',
    dividerAbove: true,
  },
  modifiers: {
    indent: 2,
    prefix: 'dash',
    size: 'normal',
    bold: false,
    caps: true,
  },
  preModifiers: {
    style: 'stars',
    highlight: true,
  },
  notes: {
    enabled: true,
    style: 'italic',
    prefix: 'NOTE:',
  },
  alerts: DEFAULT_ALERTS,
  collapsing: {
    enabled: true,
    onKitchen: true,
    onExpo: true,
  },
  reference: {
    enabled: false,
    style: 'section',
    prefix: 'Also at:',
  },
  footer: {
    enabled: true,
    showTime: true,
    showTicketNumber: false,
    duplicateHeader: false,
    customText: '',
  },
  indicators: {
    resend: { enabled: true, format: '** RESEND **', reverse: true },
    rush: { enabled: true, format: '!!! RUSH !!!', reverse: true },
    fire: { enabled: true, format: '>>> FIRE <<<', reverse: true },
    void: { enabled: true, format: '** VOID **', reverse: true },
  },
  receipt: {
    // Default to itemized receipt
    receiptType: 'itemized',
    itemized: {
      showItemPrices: true,
      showQuantity: true,
      showModifiers: true,
      showModifierPrices: true,
      collapseDuplicates: false,
      groupByCategory: false,
      groupBySeat: false,
      indentModifiers: true,
    },
    totals: {
      showSubtotal: true,
      showTax: true,
      showTaxBreakdown: false,
      showDiscounts: true,
      showServiceCharge: true,
      showPaymentMethod: true,
      showChange: true,
    },
    tipLine: true,
    suggestedTips: [18, 20, 22],
    tipCalculation: 'post-tax',
    tipSectionStyle: {
      size: 'normal',
      weight: 'normal',
      tipsPerLine: 3,
      frame: 'none',
      tipInputStyle: 'line',
      showTipTotal: true,
    },
    signature: {
      enabled: true,
      copies: 1,
      showCopyLabel: true,
      customerCopyLabel: 'CUSTOMER COPY',
      merchantCopyLabel: 'MERCHANT COPY',
      lineStyle: 'x-line',
    },
    termsText: 'Gratuity is optional',
    promoText: 'Thank you for your business!',
  },
  pizza: {
    sizeProminent: true,
    showInches: true,
    showCrust: true,
    sectionStyle: 'brackets',
  },
  entertainment: {
    printOnWaitlist: true,
    printOnSessionStart: true,
    printOnSessionEnd: true,
    printOnTimeWarning: true,
    showGuestName: true,
    showPartySize: true,
    showTableAssignment: true,
    showStartTime: true,
    showEndTime: true,
    showDuration: true,
    showTimeRemaining: true,
    showInstructions: true,
    showPrice: true,
    nameSize: 'large',
    nameBold: true,
    highlightWarnings: true,
    waitlistHeader: 'WAITLIST',
    sessionStartHeader: 'SESSION STARTED',
    sessionEndHeader: "TIME'S UP!",
    warningHeader: '5 MIN WARNING',
    instructionsLabel: 'Instructions:',
    returnByLabel: 'Return By:',
  },
  spacing: {
    compact: false,
    linesBetweenItems: 1,
  },
}

/**
 * Merge partial settings with defaults
 */
export function mergePrintTemplateSettings(
  partial?: Partial<PrintTemplateSettings> | null
): PrintTemplateSettings {
  if (!partial) return { ...DEFAULT_PRINT_TEMPLATE_SETTINGS }

  const merged = JSON.parse(JSON.stringify(DEFAULT_PRINT_TEMPLATE_SETTINGS)) as PrintTemplateSettings

  Object.keys(partial).forEach((key) => {
    const k = key as keyof PrintTemplateSettings
    const val = partial[k]
    if (val !== undefined && val !== null) {
      if (Array.isArray(val)) {
        ;(merged as any)[k] = val
      } else if (typeof val === 'object') {
        ;(merged as any)[k] = { ...(merged as any)[k], ...val }
      } else {
        ;(merged as any)[k] = val
      }
    }
  })

  return merged
}
