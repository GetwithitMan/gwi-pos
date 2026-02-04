/**
 * Global Receipt Settings - Location-level configuration
 *
 * These settings control WHAT features are available, while the
 * Visual Editor controls HOW those features are styled per-printer.
 *
 * Stored in Location.receiptSettings JSON field
 */

export interface GlobalReceiptSettings {
  // === RECEIPT CONTENT ===
  receipt: {
    // Itemized vs Summary
    showItemizedItems: boolean        // Show each item on receipt
    showItemPrices: boolean           // Show price per item
    showModifiers: boolean            // Show modifiers under items
    showModifierPrices: boolean       // Show modifier prices
    collapseDuplicates: boolean       // "2x Burger" vs listing twice

    // Subtotals section
    showSubtotal: boolean
    showTax: boolean
    showTaxBreakdown: boolean         // Show each tax type separately
    showDiscounts: boolean            // Show discount line items
    showServiceCharge: boolean        // Auto-gratuity line

    // Payment info
    showPaymentMethod: boolean        // "VISA *1234"
    showChange: boolean               // Cash change amount
  }

  // === TIP SECTION ===
  tips: {
    enabled: boolean                  // Show tip section at all
    suggestedTips: number[]           // [15, 18, 20, 22, 25]
    calculation: 'pre-tax' | 'post-tax'
    showCalculatedAmounts: boolean    // Show "$4.50" next to "18%"
    allowCustomTip: boolean           // Show blank tip line
    showTipGuide: boolean             // "15% = $3.75, 18% = $4.50..."
  }

  // === SIGNATURE ===
  signature: {
    required: boolean                 // Require signature
    threshold: number | null          // Only require above $X (null = always)
    printCopies: 1 | 2               // Customer + Merchant copies
    showCopyLabels: boolean          // "CUSTOMER COPY" header
  }

  // === FOOTER ===
  footer: {
    showServerName: boolean
    showDateTime: boolean
    showOrderNumber: boolean
    showTableName: boolean
    termsText: string                // "Gratuity is optional"
    promoText: string                // "Thank you!"
    customLines: string[]            // Additional footer lines
  }

  // === KITCHEN TICKET ===
  kitchen: {
    showPrices: boolean              // Some kitchens don't want prices
    showSeatNumbers: boolean
    showServerName: boolean
    showOrderType: boolean
    showSpecialInstructions: boolean
    highlightAllergies: boolean
    highlightModifications: boolean  // NO/EXTRA items
  }

  // === BAR TICKET ===
  bar: {
    showPrices: boolean
    showSeatNumbers: boolean
    compactMode: boolean             // Denser layout for speed
  }
}

// Defaults for new locations
export const DEFAULT_GLOBAL_RECEIPT_SETTINGS: GlobalReceiptSettings = {
  receipt: {
    showItemizedItems: true,
    showItemPrices: true,
    showModifiers: true,
    showModifierPrices: true,
    collapseDuplicates: false,
    showSubtotal: true,
    showTax: true,
    showTaxBreakdown: false,
    showDiscounts: true,
    showServiceCharge: true,
    showPaymentMethod: true,
    showChange: true,
  },
  tips: {
    enabled: true,
    suggestedTips: [18, 20, 22],
    calculation: 'post-tax',
    showCalculatedAmounts: true,
    allowCustomTip: true,
    showTipGuide: false,
  },
  signature: {
    required: true,
    threshold: null,
    printCopies: 1,
    showCopyLabels: true,
  },
  footer: {
    showServerName: true,
    showDateTime: true,
    showOrderNumber: true,
    showTableName: true,
    termsText: 'Gratuity is optional',
    promoText: 'Thank you for your business!',
    customLines: [],
  },
  kitchen: {
    showPrices: false,
    showSeatNumbers: true,
    showServerName: true,
    showOrderType: true,
    showSpecialInstructions: true,
    highlightAllergies: true,
    highlightModifications: true,
  },
  bar: {
    showPrices: false,
    showSeatNumbers: true,
    compactMode: false,
  },
}

/**
 * Merge partial settings with defaults
 */
export function mergeGlobalReceiptSettings(
  partial?: Partial<GlobalReceiptSettings> | null
): GlobalReceiptSettings {
  if (!partial) return JSON.parse(JSON.stringify(DEFAULT_GLOBAL_RECEIPT_SETTINGS))

  // Deep clone defaults then merge each section
  const merged: GlobalReceiptSettings = {
    receipt: { ...DEFAULT_GLOBAL_RECEIPT_SETTINGS.receipt, ...partial.receipt },
    tips: { ...DEFAULT_GLOBAL_RECEIPT_SETTINGS.tips, ...partial.tips },
    signature: { ...DEFAULT_GLOBAL_RECEIPT_SETTINGS.signature, ...partial.signature },
    footer: { ...DEFAULT_GLOBAL_RECEIPT_SETTINGS.footer, ...partial.footer },
    kitchen: { ...DEFAULT_GLOBAL_RECEIPT_SETTINGS.kitchen, ...partial.kitchen },
    bar: { ...DEFAULT_GLOBAL_RECEIPT_SETTINGS.bar, ...partial.bar },
  }

  return merged
}
