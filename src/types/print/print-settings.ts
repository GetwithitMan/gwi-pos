// Print Template Settings Types

export interface BasicPrintSettings {
  // Header Settings
  header: {
    showLogo: boolean
    businessName: string
    showAddress: boolean
    address?: string
    showPhone: boolean
    phone?: string
    customText?: string
  }

  // Order Info Settings
  orderInfo: {
    showOrderNumber: boolean
    orderNumberSize: 'normal' | 'large' | 'xlarge'
    showOrderType: boolean
    showTableName: boolean
    showServerName: boolean
    showDateTime: boolean
    showGuestCount: boolean
  }

  // Item Display Settings
  items: {
    fontSize: 'small' | 'normal' | 'large'
    itemNameBold: boolean
    showPrices: boolean // For kitchen tickets, often hide prices
    priceAlignment: 'right' | 'same-line' // Right column or same line as item
    showQuantity: boolean
    quantityStyle: 'prefix' | 'suffix' | 'column' // "2x Burger" vs "Burger x2" vs separate column
  }

  // Modifier Display Settings
  modifiers: {
    fontSize: 'small' | 'normal' | 'large'
    bold: boolean
    indent: boolean // Indent modifiers under items
    indentStyle: 'spaces' | 'dash' | 'arrow' // "  Ranch" vs "- Ranch" vs "> Ranch"
    showPrices: boolean
    showPreModifiers: boolean // "NO onion", "EXTRA cheese"
    preModifierStyle: 'uppercase' | 'prefix' // "NO Onion" vs "No: Onion"
    groupByType: boolean // Group mods by type (e.g., all sauces together)
  }

  // Special Instructions
  specialInstructions: {
    show: boolean
    fontSize: 'small' | 'normal' | 'large'
    bold: boolean
    boxed: boolean // Draw a box around instructions
    label: string // "NOTES:" or "SPECIAL:" etc.
  }

  // Dividers & Spacing
  layout: {
    dividerStyle: 'dashes' | 'equals' | 'dots' | 'stars' | 'blank'
    itemSpacing: 'compact' | 'normal' | 'spacious'
    sectionSpacing: number // Lines between sections
  }

  // Footer Settings (mainly for receipts)
  footer: {
    showSubtotal: boolean
    showTax: boolean
    showTotal: boolean
    totalSize: 'normal' | 'large' | 'xlarge'
    totalBold: boolean
    showTipLine: boolean
    showSignatureLine: boolean
    customText?: string
    showBarcode: boolean // Order barcode for re-printing
  }

  // Kitchen-Specific Settings
  kitchen: {
    showCourseNumber: boolean
    showSeatNumber: boolean
    highlightAllergies: boolean
    allergyStyle: 'bold' | 'boxed' | 'uppercase'
    showPrepStation: boolean
    consolidateItems: boolean // Combine "2x Burger" instead of listing twice
  }
}

// Default settings for kitchen tickets
export const DEFAULT_KITCHEN_TEMPLATE: BasicPrintSettings = {
  header: {
    showLogo: false,
    businessName: '',
    showAddress: false,
    showPhone: false,
  },
  orderInfo: {
    showOrderNumber: true,
    orderNumberSize: 'xlarge',
    showOrderType: true,
    showTableName: true,
    showServerName: true,
    showDateTime: true,
    showGuestCount: false,
  },
  items: {
    fontSize: 'large',
    itemNameBold: true,
    showPrices: false,
    priceAlignment: 'right',
    showQuantity: true,
    quantityStyle: 'prefix',
  },
  modifiers: {
    fontSize: 'normal',
    bold: false,
    indent: true,
    indentStyle: 'dash',
    showPrices: false,
    showPreModifiers: true,
    preModifierStyle: 'uppercase',
    groupByType: false,
  },
  specialInstructions: {
    show: true,
    fontSize: 'normal',
    bold: true,
    boxed: true,
    label: '*** NOTES ***',
  },
  layout: {
    dividerStyle: 'dashes',
    itemSpacing: 'normal',
    sectionSpacing: 1,
  },
  footer: {
    showSubtotal: false,
    showTax: false,
    showTotal: false,
    totalSize: 'normal',
    totalBold: false,
    showTipLine: false,
    showSignatureLine: false,
    showBarcode: false,
  },
  kitchen: {
    showCourseNumber: true,
    showSeatNumber: true,
    highlightAllergies: true,
    allergyStyle: 'boxed',
    showPrepStation: true,
    consolidateItems: true,
  },
}

// Default settings for customer receipts
export const DEFAULT_RECEIPT_TEMPLATE: BasicPrintSettings = {
  header: {
    showLogo: true,
    businessName: '',
    showAddress: true,
    showPhone: true,
  },
  orderInfo: {
    showOrderNumber: true,
    orderNumberSize: 'normal',
    showOrderType: true,
    showTableName: true,
    showServerName: true,
    showDateTime: true,
    showGuestCount: false,
  },
  items: {
    fontSize: 'normal',
    itemNameBold: false,
    showPrices: true,
    priceAlignment: 'right',
    showQuantity: true,
    quantityStyle: 'prefix',
  },
  modifiers: {
    fontSize: 'small',
    bold: false,
    indent: true,
    indentStyle: 'spaces',
    showPrices: true,
    showPreModifiers: true,
    preModifierStyle: 'prefix',
    groupByType: false,
  },
  specialInstructions: {
    show: true,
    fontSize: 'small',
    bold: false,
    boxed: false,
    label: 'Notes:',
  },
  layout: {
    dividerStyle: 'dashes',
    itemSpacing: 'compact',
    sectionSpacing: 1,
  },
  footer: {
    showSubtotal: true,
    showTax: true,
    showTotal: true,
    totalSize: 'large',
    totalBold: true,
    showTipLine: true,
    showSignatureLine: true,
    customText: 'Thank you for your business!',
    showBarcode: false,
  },
  kitchen: {
    showCourseNumber: false,
    showSeatNumber: false,
    highlightAllergies: false,
    allergyStyle: 'bold',
    showPrepStation: false,
    consolidateItems: false,
  },
}
