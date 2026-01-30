// Hardware Management Types

import type { PrintTemplateSettings } from './print-settings'

// ============================================
// PRINTER TYPES
// ============================================

export type PrinterType = 'thermal' | 'impact'
export type PrinterRole = 'receipt' | 'kitchen' | 'bar'

export interface Printer {
  id: string
  locationId: string
  name: string
  printerType: PrinterType
  model: string | null
  ipAddress: string
  port: number
  printerRole: PrinterRole
  isDefault: boolean
  paperWidth: number
  supportsCut: boolean
  isActive: boolean
  lastPingAt: Date | null
  lastPingOk: boolean
  printSettings: PrintTemplateSettings | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export interface CreatePrinterInput {
  name: string
  printerType: PrinterType
  model?: string
  ipAddress: string
  port?: number
  printerRole: PrinterRole
  isDefault?: boolean
  paperWidth?: number
  supportsCut?: boolean
  printSettings?: PrintTemplateSettings
}

export interface UpdatePrinterInput extends Partial<CreatePrinterInput> {
  isActive?: boolean
  sortOrder?: number
}

export interface PrinterPingResult {
  success: boolean
  responseTime?: number
  error?: string
}

// ============================================
// KDS SCREEN TYPES
// ============================================

export type KDSScreenType = 'kds' | 'entertainment'
export type FontSize = 'small' | 'normal' | 'large'
export type ColorScheme = 'dark' | 'light'

export interface KDSScreen {
  id: string
  locationId: string
  name: string
  screenType: KDSScreenType
  columns: number
  fontSize: FontSize
  colorScheme: ColorScheme
  agingWarning: number
  lateWarning: number
  playSound: boolean
  flashOnNew: boolean
  isActive: boolean
  lastSeenAt: Date | null
  isOnline: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  stations?: KDSScreenStation[]
}

export interface KDSScreenStation {
  id: string
  kdsScreenId: string
  stationId: string
  sortOrder: number
  station?: {
    id: string
    name: string
    displayName: string | null
    stationType: string
    color: string | null
  }
}

export interface CreateKDSScreenInput {
  name: string
  screenType?: KDSScreenType
  columns?: number
  fontSize?: FontSize
  colorScheme?: ColorScheme
  agingWarning?: number
  lateWarning?: number
  playSound?: boolean
  flashOnNew?: boolean
  stationIds?: string[]
}

export interface UpdateKDSScreenInput extends Partial<CreateKDSScreenInput> {
  isActive?: boolean
  sortOrder?: number
}

// ============================================
// PRINT RULE TYPES
// ============================================

export type RuleLevel = 'category' | 'item' | 'modifier'

export interface PrintRule {
  id: string
  locationId: string
  name: string | null
  ruleLevel: RuleLevel
  categoryId: string | null
  menuItemId: string | null
  modifierId: string | null
  printerId: string | null
  kdsScreenId: string | null
  additionalPrinterIds: string[] | null
  additionalKDSIds: string[] | null
  printCopies: number
  isReference: boolean
  printOnSend: boolean
  showOnKDS: boolean
  priority: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  // Relations
  category?: { id: string; name: string } | null
  menuItem?: { id: string; name: string } | null
  modifier?: { id: string; name: string } | null
  printer?: { id: string; name: string } | null
  kdsScreen?: { id: string; name: string } | null
}

export interface CreatePrintRuleInput {
  name?: string
  ruleLevel: RuleLevel
  categoryId?: string
  menuItemId?: string
  modifierId?: string
  printerId?: string
  kdsScreenId?: string
  additionalPrinterIds?: string[]
  additionalKDSIds?: string[]
  printCopies?: number
  isReference?: boolean
  printOnSend?: boolean
  showOnKDS?: boolean
  priority?: number
}

export interface UpdatePrintRuleInput extends Partial<CreatePrintRuleInput> {
  isActive?: boolean
}

// ============================================
// PRINT JOB TYPES
// ============================================

export type PrintJobType = 'kitchen_ticket' | 'receipt' | 'reference'
export type PrintJobStatus = 'pending' | 'sent' | 'failed'

export interface PrintJob {
  id: string
  locationId: string
  jobType: PrintJobType
  orderId: string | null
  printerId: string
  status: PrintJobStatus
  errorMessage: string | null
  retryCount: number
  content: string | null
  createdAt: Date
  sentAt: Date | null
  printer?: { id: string; name: string; ipAddress: string; port: number }
}

// ============================================
// ROUTING RESOLUTION
// ============================================

export interface ResolvedRouting {
  printers: Array<{
    id: string
    name: string
    ipAddress: string
    port: number
    isReference: boolean
    copies: number
  }>
  kdsScreens: Array<{
    id: string
    name: string
  }>
  printOnSend: boolean
  showOnKDS: boolean
}

export interface RoutingRequest {
  categoryId?: string
  menuItemId?: string
  modifierId?: string
}

// ============================================
// HARDWARE DASHBOARD
// ============================================

export interface HardwareStatus {
  printers: Array<{
    id: string
    name: string
    printerRole: PrinterRole
    ipAddress: string
    isActive: boolean
    lastPingOk: boolean
    lastPingAt: Date | null
  }>
  kdsScreens: Array<{
    id: string
    name: string
    screenType: KDSScreenType
    isActive: boolean
    isOnline: boolean
    lastSeenAt: Date | null
    stationCount: number
  }>
}
