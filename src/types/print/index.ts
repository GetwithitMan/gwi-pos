/**
 * Print Types — Barrel Export
 *
 * All print-related types consolidated under @/types/print.
 *
 * Usage:
 *   import { PrintTemplateSettings, PrinterSettings } from '@/types/print'
 *   import { DEFAULT_PIZZA_PRINT_SETTINGS } from '@/types/print'
 */

// Basic print settings (kitchen/receipt template defaults)
export type { BasicPrintSettings } from './print-settings'
export { DEFAULT_KITCHEN_TEMPLATE, DEFAULT_RECEIPT_TEMPLATE } from './print-settings'

// Station-based print template engine
export type { ElementConfig, DividerConfig, AlertRule, PrintTemplateSettings } from './print-template-settings'
export {
  DEFAULT_HEADER_ELEMENTS,
  DEFAULT_ALERTS,
  DEFAULT_PRINT_TEMPLATE_SETTINGS,
  mergePrintTemplateSettings,
} from './print-template-settings'

// Per-printer hardware settings
export type { PrinterSettings } from './printer-settings'
export {
  DEFAULT_THERMAL_SETTINGS,
  DEFAULT_IMPACT_SETTINGS,
  getDefaultPrinterSettings,
} from './printer-settings'

// Global receipt settings (location-level)
export type { GlobalReceiptSettings } from './receipt-settings'
export {
  DEFAULT_GLOBAL_RECEIPT_SETTINGS,
  mergeGlobalReceiptSettings,
} from './receipt-settings'

// Pizza-specific print settings
export type { PizzaPrintSettings } from './pizza-print-settings'
export {
  DEFAULT_PIZZA_PRINT_SETTINGS,
  PIZZA_PRINT_PRESETS,
} from './pizza-print-settings'
