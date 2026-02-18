/**
 * Pizza-specific print settings for kitchen tickets
 * These settings help kitchen staff make pizzas accurately by
 * highlighting important information and organizing toppings clearly.
 *
 * PRIORITY: These settings OVERRIDE printer-level settings when configured.
 * If a setting is null/undefined, it falls back to printer settings.
 */

export interface PizzaPrintSettings {
  // ============================================
  // TEXT SIZING (overrides printer settings)
  // ============================================
  textSizing: {
    headerSize: 'normal' | 'large' | 'xlarge'      // "KITCHEN" header, order number
    itemNameSize: 'normal' | 'large' | 'xlarge'    // Item names (e.g., "2x Pepperoni Pizza")
    modifierSize: 'small' | 'normal' | 'large'     // Modifiers and toppings
    notesSize: 'normal' | 'large'                  // Special notes and instructions
    sectionHeaderSize: 'normal' | 'large' | 'xlarge' // Section headers like [LEFT HALF]
  }

  // ============================================
  // RED RIBBON / TWO-COLOR PRINTING
  // ============================================
  redRibbon: {
    enabled: boolean                    // Use red printing (for printers with red ribbon)
    useRedForResend: boolean            // Print "RESEND" in red
    useRedForNoItems: boolean           // Print "NO [ingredient]" in red (CRITICAL)
    useRedForAllergies: boolean         // Print allergy warnings in red
    useRedForNotes: boolean             // Print special notes in red
    useRedForHeaders: boolean           // Print headers in red
    useRedForSectionHeaders: boolean    // Print section headers in red
    useRedForModifiers: boolean         // Print modifiers/toppings in red
    useRedForExtraItems: boolean        // Print "EXTRA" items in red
    useRedForLightItems: boolean        // Print "LIGHT" items in red
    useRedForItemNames: boolean         // Print item names in red
  }

  // ============================================
  // GENERAL FORMATTING
  // ============================================
  formatting: {
    allCapsItemNames: boolean           // Print item names in ALL CAPS
    allCapsModifiers: boolean           // Print modifiers in ALL CAPS
    allCapsSectionHeaders: boolean      // Print section headers in ALL CAPS
    boldItemNames: boolean              // Bold item names
    boldModifiers: boolean              // Bold modifiers
    compactSpacing: boolean             // Reduce line spacing
  }

  // Header section
  header: {
    showSizeLarge: boolean        // Print size name in large/double-width text
    showSizeInches: boolean       // Show inches (e.g., "14 inch")
    showCrustProminent: boolean   // Highlight crust type
    showOrderNumber: boolean      // Show order number in header
    orderNumberSize: 'normal' | 'large' | 'xlarge'
  }

  // Section layout for split pizzas
  sections: {
    useSectionHeaders: boolean    // Show "LEFT HALF:", "RIGHT HALF:", etc.
    sectionHeaderStyle: 'uppercase' | 'bold' | 'boxed' | 'underlined' | 'red' | 'red-bold'
    sectionDivider: 'dashes' | 'equals' | 'stars' | 'blank' | 'double-line'
    groupToppingsBySection: boolean  // Group by section vs list all together
    showSectionLabels: 'full' | 'abbreviated' | 'numbered'
    // full: "LEFT HALF", "RIGHT HALF", "WHOLE PIZZA"
    // abbreviated: "L", "R", "W"
    // numbered: "1/2", "2/2", "WHOLE"
  }

  // Topping display
  toppings: {
    fontSize: 'small' | 'normal' | 'large'
    allCaps: boolean              // Print toppings in ALL CAPS
    boldToppings: boolean         // Bold all topping names
    indentToppings: boolean       // Indent toppings under section headers
    showToppingCategory: boolean  // Show category (Meat, Veggie, etc.)
    numberToppings: boolean       // Number each topping (1. Pepperoni, 2. Mushrooms)
  }

  // Modifications highlighting (to prevent mistakes)
  modifications: {
    highlightExtra: boolean       // Highlight "EXTRA" items
    extraStyle: 'bold' | 'caps' | 'underline' | 'boxed' | 'red' | 'red-bold' | 'all'
    extraPrefix: string           // e.g., "EXTRA", "2X", "DBL"

    highlightLight: boolean       // Highlight "LIGHT" items
    lightStyle: 'bold' | 'caps' | 'underline' | 'red' | 'red-bold'
    lightPrefix: string           // e.g., "LIGHT", "LT", "LITE"

    highlightNo: boolean          // Highlight "NO" items prominently
    noStyle: 'bold' | 'caps' | 'boxed' | 'inverted' | 'red' | 'red-bold' | 'red-inverted' | 'all'
    noPrefix: string              // e.g., "NO", "OMIT", "86"
    showNoItemsSeparate: boolean  // Show NO items in separate section

    highlightSubstitutions: boolean
    substitutionPrefix: string    // e.g., "SUB", "SWAP"
  }

  // Sauce & Cheese
  sauceAndCheese: {
    showSauceProminent: boolean   // Highlight non-default sauce
    showCheeseProminent: boolean  // Highlight non-default cheese
    highlightNoSauce: boolean     // Extra highlight for "NO SAUCE"
    highlightNoCheese: boolean    // Extra highlight for "NO CHEESE"
    showLightExtraSauce: boolean  // Show light/extra for sauce
    showLightExtraCheese: boolean // Show light/extra for cheese
  }

  // Special instructions
  specialInstructions: {
    show: boolean
    style: 'normal' | 'bold' | 'boxed' | 'inverted' | 'red' | 'red-bold' | 'red-inverted'
    allCaps: boolean
    label: string                 // "SPECIAL:", "NOTES:", "INSTRUCTIONS:"
    separateLine: boolean         // Print on its own line with dividers
  }

  // Allergy alerts
  allergyAlerts: {
    highlightAllergies: boolean
    allergyStyle: 'bold' | 'boxed' | 'inverted' | 'starred' | 'red' | 'red-bold' | 'red-inverted'
    allergyLabel: string          // "ALLERGY:", "ALERT:", etc.
  }

  // Footer/summary
  footer: {
    showToppingCount: boolean     // "Total toppings: 5"
    showMakeTime: boolean         // Suggested make time
    repeatSizeAtBottom: boolean   // Repeat size at bottom for verification
    repeatCrustAtBottom: boolean  // Repeat crust at bottom
  }

  // Layout
  layout: {
    paperWidth: 80 | 40           // 80mm or 40mm paper
    useFullWidth: boolean         // Use full paper width
    marginLines: number           // Blank lines at top/bottom
    compactMode: boolean          // Minimize spacing for busy kitchens
    cutAfterEach: boolean         // Cut paper after each pizza
  }

  // ============================================
  // PRINTER-TYPE SPECIFIC OVERRIDES
  // When a specific printer type is detected, these settings
  // override the general settings above.
  // ============================================
  printerOverrides?: {
    thermal?: {
      // Thermal printers (no red ribbon typically)
      textSizing?: Partial<PizzaPrintSettings['textSizing']>
      formatting?: Partial<PizzaPrintSettings['formatting']>
    }
    impact?: {
      // Impact printers (TM-U220 with red ribbon)
      textSizing?: Partial<PizzaPrintSettings['textSizing']>
      formatting?: Partial<PizzaPrintSettings['formatting']>
      redRibbon?: Partial<PizzaPrintSettings['redRibbon']>
    }
  }
}

// Default settings optimized for kitchen accuracy
export const DEFAULT_PIZZA_PRINT_SETTINGS: PizzaPrintSettings = {
  // Text sizing defaults - large and readable
  textSizing: {
    headerSize: 'large',
    itemNameSize: 'large',
    modifierSize: 'normal',
    notesSize: 'large',
    sectionHeaderSize: 'large',
  },
  // Red ribbon defaults - highlight critical items
  redRibbon: {
    enabled: true,
    useRedForResend: true,
    useRedForNoItems: true,
    useRedForAllergies: true,
    useRedForNotes: true,
    useRedForHeaders: false,
    useRedForSectionHeaders: false,
    useRedForModifiers: false,
    useRedForExtraItems: false,
    useRedForLightItems: false,
    useRedForItemNames: false,
  },
  // Formatting defaults
  formatting: {
    allCapsItemNames: true,
    allCapsModifiers: true,
    allCapsSectionHeaders: true,
    boldItemNames: true,
    boldModifiers: false,
    compactSpacing: false,
  },
  header: {
    showSizeLarge: true,
    showSizeInches: true,
    showCrustProminent: true,
    showOrderNumber: true,
    orderNumberSize: 'large',
  },
  sections: {
    useSectionHeaders: true,
    sectionHeaderStyle: 'bold',
    sectionDivider: 'dashes',
    groupToppingsBySection: true,
    showSectionLabels: 'full',
  },
  toppings: {
    fontSize: 'normal',
    allCaps: true,
    boldToppings: false,
    indentToppings: true,
    showToppingCategory: false,
    numberToppings: false,
  },
  modifications: {
    highlightExtra: true,
    extraStyle: 'bold',
    extraPrefix: 'EXTRA',
    highlightLight: true,
    lightStyle: 'caps',
    lightPrefix: 'LIGHT',
    highlightNo: true,
    noStyle: 'all',
    noPrefix: 'NO',
    showNoItemsSeparate: true,
    highlightSubstitutions: true,
    substitutionPrefix: 'SUB',
  },
  sauceAndCheese: {
    showSauceProminent: true,
    showCheeseProminent: true,
    highlightNoSauce: true,
    highlightNoCheese: true,
    showLightExtraSauce: true,
    showLightExtraCheese: true,
  },
  specialInstructions: {
    show: true,
    style: 'boxed',
    allCaps: true,
    label: 'SPECIAL:',
    separateLine: true,
  },
  allergyAlerts: {
    highlightAllergies: true,
    allergyStyle: 'inverted',
    allergyLabel: '*** ALLERGY ***',
  },
  footer: {
    showToppingCount: true,
    showMakeTime: false,
    repeatSizeAtBottom: true,
    repeatCrustAtBottom: false,
  },
  layout: {
    paperWidth: 80,
    useFullWidth: true,
    marginLines: 1,
    compactMode: false,
    cutAfterEach: true,
  },
}

// Preset configurations for common use cases
export const PIZZA_PRINT_PRESETS = {
  standard: DEFAULT_PIZZA_PRINT_SETTINGS,

  compact: {
    ...DEFAULT_PIZZA_PRINT_SETTINGS,
    textSizing: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.textSizing,
      headerSize: 'normal' as const,
      itemNameSize: 'normal' as const,
      modifierSize: 'small' as const,
    },
    formatting: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.formatting,
      compactSpacing: true,
    },
    header: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.header,
      showSizeInches: false,
    },
    sections: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.sections,
      showSectionLabels: 'abbreviated' as const,
    },
    footer: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.footer,
      showToppingCount: false,
      repeatSizeAtBottom: false,
    },
    layout: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.layout,
      compactMode: true,
      marginLines: 0,
    },
  },

  highVisibility: {
    ...DEFAULT_PIZZA_PRINT_SETTINGS,
    textSizing: {
      headerSize: 'xlarge' as const,
      itemNameSize: 'xlarge' as const,
      modifierSize: 'large' as const,
      notesSize: 'large' as const,
      sectionHeaderSize: 'xlarge' as const,
    },
    redRibbon: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.redRibbon,
      useRedForHeaders: true,
      useRedForSectionHeaders: true,
      useRedForModifiers: true,
      useRedForExtraItems: true,
    },
    header: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.header,
      orderNumberSize: 'xlarge' as const,
    },
    toppings: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.toppings,
      fontSize: 'large' as const,
      boldToppings: true,
    },
    modifications: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.modifications,
      extraStyle: 'all' as const,
      noStyle: 'all' as const,
    },
    specialInstructions: {
      ...DEFAULT_PIZZA_PRINT_SETTINGS.specialInstructions,
      style: 'inverted' as const,
    },
  },

  impactPrinter: {
    ...DEFAULT_PIZZA_PRINT_SETTINGS,
    textSizing: {
      headerSize: 'xlarge' as const,
      itemNameSize: 'large' as const,
      modifierSize: 'normal' as const,
      notesSize: 'large' as const,
      sectionHeaderSize: 'large' as const,
    },
    redRibbon: {
      enabled: true,
      useRedForResend: true,
      useRedForNoItems: true,
      useRedForAllergies: true,
      useRedForNotes: true,
      useRedForHeaders: false,
      useRedForSectionHeaders: false,
      useRedForModifiers: false,
      useRedForExtraItems: true,
      useRedForLightItems: false,
      useRedForItemNames: false,
    },
    formatting: {
      allCapsItemNames: true,
      allCapsModifiers: true,
      allCapsSectionHeaders: true,
      boldItemNames: true,
      boldModifiers: false,
      compactSpacing: false,
    },
  },
} as const
