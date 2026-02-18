/**
 * Per-printer settings for kitchen ticket formatting
 * These settings override global defaults and are specific to each printer's capabilities
 */

export interface PrinterSettings {
  // Text sizing
  textSizing: {
    headerSize: 'normal' | 'large' | 'xlarge'      // "KITCHEN" header, order number
    itemNameSize: 'normal' | 'large' | 'xlarge'    // Item names (e.g., "2x Pepperoni Pizza")
    modifierSize: 'small' | 'normal' | 'large'     // Modifiers and toppings
    notesSize: 'normal' | 'large'                  // Special notes
  }

  // Two-color ribbon support (TM-U220 and similar)
  ribbon: {
    hasRedRibbon: boolean                          // Does this printer have red/black ribbon?
    useRedForHeaders: boolean                      // Print "KITCHEN", order# in red
    useRedForResend: boolean                       // Print "RESEND" in red
    useRedForNoItems: boolean                      // Print "NO [ingredient]" in red
    useRedForAllergies: boolean                    // Print allergy warnings in red
    useRedForNotes: boolean                        // Print special notes in red
    useRedForCriticalMods: boolean                 // Print critical modifications in red
  }

  // Impact printer specific
  impact: {
    emphasizedText: boolean                        // Use emphasized (bold) mode
    doubleStrike: boolean                          // Double-strike for darker text
  }

  // General formatting
  formatting: {
    allCapsItems: boolean                          // Print item names in ALL CAPS
    allCapsMods: boolean                           // Print modifiers in ALL CAPS
    compactSpacing: boolean                        // Reduce line spacing
    dividerStyle: 'dashes' | 'equals' | 'stars' | 'none'
  }
}

// Default settings for thermal printers (TM-T88 series)
export const DEFAULT_THERMAL_SETTINGS: PrinterSettings = {
  textSizing: {
    headerSize: 'large',
    itemNameSize: 'normal',
    modifierSize: 'normal',
    notesSize: 'large',
  },
  ribbon: {
    hasRedRibbon: false,
    useRedForHeaders: false,
    useRedForResend: false,
    useRedForNoItems: false,
    useRedForAllergies: false,
    useRedForNotes: false,
    useRedForCriticalMods: false,
  },
  impact: {
    emphasizedText: false,
    doubleStrike: false,
  },
  formatting: {
    allCapsItems: false,
    allCapsMods: true,
    compactSpacing: false,
    dividerStyle: 'dashes',
  },
}

// Default settings for impact printers (TM-U220 series)
export const DEFAULT_IMPACT_SETTINGS: PrinterSettings = {
  textSizing: {
    headerSize: 'xlarge',
    itemNameSize: 'large',
    modifierSize: 'normal',
    notesSize: 'large',
  },
  ribbon: {
    hasRedRibbon: true,
    useRedForHeaders: false,
    useRedForResend: true,
    useRedForNoItems: true,
    useRedForAllergies: true,
    useRedForNotes: true,
    useRedForCriticalMods: true,
  },
  impact: {
    emphasizedText: true,
    doubleStrike: false,
  },
  formatting: {
    allCapsItems: true,
    allCapsMods: true,
    compactSpacing: false,
    dividerStyle: 'dashes',
  },
}

// Get default settings based on printer type
export function getDefaultPrinterSettings(printerType: string): PrinterSettings {
  return printerType === 'impact' ? DEFAULT_IMPACT_SETTINGS : DEFAULT_THERMAL_SETTINGS
}
