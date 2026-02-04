/**
 * Hardware Domain
 *
 * Manages terminals, printers, and peripheral devices.
 *
 * Modules:
 * - H1: Terminals (POS stations, registration)
 * - H2: Printers (receipt, kitchen, label)
 * - H3: Card Readers (payment terminals)
 * - H4: KDS Screens (kitchen display)
 * - H5: Cash Drawers (open, count)
 * - H6: Barcode Scanners (item lookup)
 * - H7: Scales (weight-based items)
 * - H8: Networking (local server, sync)
 */

// Types will be added as we migrate
export type Terminal = {
  id: string
  locationId: string
  name: string
  type: TerminalType
  status: TerminalStatus
  lastSeenAt?: Date
}

export type Printer = {
  id: string
  locationId: string
  name: string
  type: PrinterType
  ipAddress?: string
  port?: number
  isDefault: boolean
}

export type KDSScreen = {
  id: string
  locationId: string
  name: string
  stationId: string
  displayMode: KDSDisplayMode
}

export type TerminalType = 'pos' | 'kds' | 'kiosk' | 'mobile'
export type TerminalStatus = 'online' | 'offline' | 'error'
export type PrinterType = 'receipt' | 'kitchen' | 'label' | 'report'
export type KDSDisplayMode = 'tickets' | 'items' | 'expo'

// Constants
export const PRINTER_TYPES = [
  'receipt',
  'kitchen',
  'label',
  'report',
] as const

export const PRINT_JOB_TYPES = [
  'receipt',
  'kitchen_ticket',
  'bar_ticket',
  'label',
  'report',
  'end_of_day',
] as const
