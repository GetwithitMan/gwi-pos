/**
 * Routing Engine Types
 *
 * Unified tag-based routing system for POS
 * Items publish to routeTags, Stations subscribe to tags
 */

import type { IngredientModificationType } from '@/types/orders'

// Template types for different ticket formats
export type TemplateType =
  | 'STANDARD_KITCHEN'
  | 'PIZZA_STATION'
  | 'EXPO_SUMMARY'
  | 'ENTERTAINMENT_TICKET'
  | 'BAR_TICKET'
  | 'RECEIPT'

// Station types
export type StationType = 'PRINTER' | 'KDS'

// Item with routing information resolved
export interface RoutedItem {
  id: string
  name: string
  quantity: number
  seatNumber: number | null
  sourceTableId: string | null
  sourceTableName: string | null    // For T-S notation display
  sourceTableAbbrev: string | null
  specialNotes: string | null
  resendCount: number
  courseNumber: number | null

  // Resolved routing info
  routeTags: string[]
  tagSource: 'item' | 'category' | 'default'

  // Item type detection
  isPizza: boolean
  isEntertainment: boolean
  isBar: boolean

  // Category info for grouping
  categoryName: string | null

  // Pricing option label (e.g., "Large", "Bowl")
  pricingOptionLabel?: string | null

  // Weight-based item fields
  soldByWeight?: boolean
  weight?: number | null
  weightUnit?: string | null
  unitPrice?: number | null
  tareWeight?: number | null

  // Full item data for template rendering
  modifiers: Array<{
    id: string
    name: string
    preModifier: string | null
    depth: number
    quantity: number
  }>
  ingredientModifications: Array<{
    ingredientName: string
    modificationType: IngredientModificationType
    swappedToModifierName?: string | null
  }>
  pizzaData: PizzaItemData | null
  menuItem: {
    id: string
    categoryId: string
    categoryType: string
    categoryName?: string
  }
}

// Pizza-specific data for PIZZA_STATION template
export interface PizzaItemData {
  id: string
  sizeName: string
  sizeInches?: number
  crustName: string
  sauceName?: string
  sauceAmount: 'none' | 'light' | 'regular' | 'extra'
  cheeseName?: string
  cheeseAmount: 'none' | 'light' | 'regular' | 'extra'
  cookingInstructions?: string
  cutStyle?: string
  toppingsBySection?: Record<string, Array<{
    name: string
    amount: 'regular' | 'light' | 'extra'
  }>>
}

// Routing manifest for a single station
export interface RoutingManifest {
  stationId: string
  stationName: string
  type: StationType

  // Network info (for printers)
  ipAddress: string | null
  port: number | null

  // Template configuration
  template: TemplateType
  printerType: 'thermal' | 'impact' | null
  paperWidth: number | null
  printSettings: unknown | null
  atomicPrintConfig: AtomicPrintConfig | null

  // Backup info
  backupStationId: string | null
  failoverTimeout: number | null

  // Primary items - items that matched this station's tags
  primaryItems: RoutedItem[]

  // Reference items - other items in the order (for context)
  // Shows line cooks "this burger is part of a larger order with a pizza"
  referenceItems: RoutedItem[]

  // Legacy: combined items array (primaryItems + referenceItems)
  // Use primaryItems/referenceItems for new code
  items: RoutedItem[]

  // Routing metadata
  isExpo: boolean           // Did this match due to expo flag?
  matchedTags: string[]     // Which tags caused the match
  showReferenceItems: boolean // Whether this station displays reference items
}

// Order context for printing/display
export interface OrderContext {
  orderId: string
  orderNumber: number
  orderType: string
  tableName: string | null
  tabName: string | null
  employeeName: string
  createdAt: Date
}

// Complete routing result
export interface RoutingResult {
  order: OrderContext
  manifests: RoutingManifest[]
  unroutedItems: RoutedItem[]  // Items that matched no station
  routingStats: {
    totalItems: number
    routedItems: number
    stationsUsed: number
    expoItems: number
  }
}

// Station configuration (mirrors Prisma model)
export interface StationConfig {
  id: string
  locationId: string
  name: string
  displayName?: string | null
  type: StationType

  // Routing
  tags: string[]
  isExpo: boolean

  // Template
  templateType: TemplateType

  // Network (PRINTER only)
  ipAddress?: string | null
  port?: number | null

  // Printer settings (PRINTER only)
  printerType?: 'thermal' | 'impact' | null
  printerModel?: string | null
  paperWidth?: 80 | 58 | 40 | null
  supportsCut?: boolean
  printSettings?: unknown | null
  atomicPrintConfig?: AtomicPrintConfig | null

  // KDS settings (KDS only)
  columns?: number | null
  fontSize?: 'small' | 'normal' | 'large' | null
  colorScheme?: 'dark' | 'light' | null
  agingWarning?: number | null
  lateWarning?: number | null

  // Reference items
  showReferenceItems?: boolean

  // Backup
  backupStationId?: string | null
  failoverTimeout?: number | null

  // Status
  isActive: boolean
  isDefault: boolean
}

// Default route tags configuration
export interface RouteTagConfig {
  tag: string
  description: string
  color?: string          // For UI display
  autoAssignTo?: string[] // Category types that auto-get this tag
}

// ============================================
// ATOMIC PRINT CONFIGURATION
// Per-element print formatting for complete control
// ============================================

export type PrintAlignment = 'left' | 'center' | 'right'
export type PrintSize = 'small' | 'normal' | 'large' | 'xlarge'
export type DividerStyle = 'none' | 'single-line' | 'double-line' | 'dashed' | 'dots' | 'stars' | 'equals'

// Per-element configuration
export interface PrintElementConfig {
  enabled: boolean
  align: PrintAlignment
  size: PrintSize
  reverse: boolean  // Inverse/highlighted text (white on black)
  bold?: boolean
  prefix?: string   // Text before value
  suffix?: string   // Text after value
}

// Atomic configuration structure
export interface AtomicPrintConfig {
  // Header elements
  headers: {
    stationName?: PrintElementConfig    // "GRILL STATION"
    orderNumber?: PrintElementConfig    // "Order #1234"
    tabName?: PrintElementConfig        // "Tab: Smith Party"
    tableName?: PrintElementConfig      // "Table 5"
    serverName?: PrintElementConfig     // "Server: Jane"
    timestamp?: PrintElementConfig      // "1:45 PM"
    orderType?: PrintElementConfig      // "DINE IN" / "TAKEOUT"
  }

  // Divider styles between sections
  dividers: {
    afterHeader?: DividerStyle
    betweenItems?: DividerStyle
    beforeFooter?: DividerStyle
    afterReferenceHeader?: DividerStyle
  }

  // Item display settings
  items: {
    quantity?: PrintElementConfig       // "2x"
    name?: PrintElementConfig           // "Burger"
    modifiers?: PrintElementConfig      // "  - No Onions"
    specialNotes?: PrintElementConfig   // "** Allergy: Nuts **"
    seatNumber?: PrintElementConfig     // "Seat 3"
    sourceTable?: PrintElementConfig    // "T4-S2" (T-S notation)
  }

  // Reference items section
  referenceItems: {
    headerText?: string                 // "--- OTHER ITEMS ---"
    headerConfig?: PrintElementConfig
    itemConfig?: PrintElementConfig     // Typically smaller/lighter
  }

  // Footer elements
  footer: {
    itemCount?: PrintElementConfig      // "Items: 5"
    resendIndicator?: PrintElementConfig  // "*** RESEND #2 ***"
  }
}

// Default atomic print config for new stations
export const DEFAULT_ATOMIC_PRINT_CONFIG: AtomicPrintConfig = {
  headers: {
    stationName: { enabled: true, align: 'center', size: 'xlarge', reverse: true },
    orderNumber: { enabled: true, align: 'center', size: 'large', reverse: false },
    tabName: { enabled: true, align: 'left', size: 'normal', reverse: false },
    tableName: { enabled: true, align: 'left', size: 'normal', reverse: false },
    serverName: { enabled: true, align: 'left', size: 'small', reverse: false },
    timestamp: { enabled: true, align: 'right', size: 'small', reverse: false },
    orderType: { enabled: false, align: 'center', size: 'normal', reverse: false },
  },
  dividers: {
    afterHeader: 'double-line',
    betweenItems: 'none',
    beforeFooter: 'single-line',
    afterReferenceHeader: 'dashed',
  },
  items: {
    quantity: { enabled: true, align: 'left', size: 'large', reverse: false, bold: true },
    name: { enabled: true, align: 'left', size: 'large', reverse: false, bold: true },
    modifiers: { enabled: true, align: 'left', size: 'normal', reverse: false, prefix: '  - ' },
    specialNotes: { enabled: true, align: 'left', size: 'normal', reverse: true, prefix: '** ', suffix: ' **' },
    seatNumber: { enabled: true, align: 'left', size: 'small', reverse: false, prefix: 'Seat ' },
    sourceTable: { enabled: true, align: 'left', size: 'normal', reverse: false },
  },
  referenceItems: {
    headerText: '--- OTHER ITEMS IN ORDER ---',
    headerConfig: { enabled: true, align: 'center', size: 'small', reverse: false },
    itemConfig: { enabled: true, align: 'left', size: 'small', reverse: false },
  },
  footer: {
    itemCount: { enabled: false, align: 'left', size: 'small', reverse: false },
    resendIndicator: { enabled: true, align: 'center', size: 'large', reverse: true, prefix: '*** RESEND #', suffix: ' ***' },
  },
}

// Common route tags (for seed data and UI)
export const DEFAULT_ROUTE_TAGS: RouteTagConfig[] = [
  { tag: 'kitchen', description: 'General kitchen items', color: '#f97316', autoAssignTo: ['food'] },
  { tag: 'bar', description: 'Bar/drink items', color: '#3b82f6', autoAssignTo: ['liquor', 'drinks'] },
  { tag: 'pizza', description: 'Pizza items', color: '#ef4444', autoAssignTo: ['pizza'] },
  { tag: 'grill', description: 'Grill station items', color: '#dc2626' },
  { tag: 'fryer', description: 'Fryer station items', color: '#ea580c' },
  { tag: 'salad', description: 'Cold prep / salad station', color: '#22c55e' },
  { tag: 'expo', description: 'Expo station (receives all)', color: '#a855f7' },
  { tag: 'entertainment', description: 'Entertainment/rental items', color: '#06b6d4', autoAssignTo: ['entertainment'] },
  { tag: 'made-to-order', description: 'Items requiring cook attention', color: '#f59e0b' },
  { tag: 'rush', description: 'Priority/rush items', color: '#dc2626' },
]
