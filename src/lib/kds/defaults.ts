/**
 * KDS Overhaul — Default values
 *
 * Single source of truth for default config values.
 * Used by admin page, device settings, auth route, and KDS client.
 * DB-persisted screen record is the SoT; these fill null/undefined only.
 */

import type { KDSOrderBehavior, KDSDisplayMode } from './types'

export const DEFAULT_DISPLAY_MODE: KDSDisplayMode = 'tiled'

export const DEFAULT_ORDER_BEHAVIOR: KDSOrderBehavior = {
  tapToStart: false,
  mergeCards: false,
  mergeWindowMinutes: 5,
  newCardPerSend: false,
  moveCompletedToBottom: false,
  strikeThroughModifiers: false,
  resetTimerOnRecall: false,
  intelligentSort: false,
  showAllDayCounts: false,
  allDayCountResetHour: 4, // 4 AM reset
  orderTrackerEnabled: false,
  sendSmsOnReady: false,
  printOnBump: false,
  printerId: null,
}

// Transition times default to null → use global agingWarning/lateWarning from screen record
export const DEFAULT_TRANSITION_TIMES = null

// Order type filters default to null → show all order types
export const DEFAULT_ORDER_TYPE_FILTERS = null

/**
 * Merge persisted orderBehavior with defaults.
 * Only fills missing keys — never overwrites what's in DB.
 */
export function mergeOrderBehavior(persisted: Partial<KDSOrderBehavior> | null | undefined): KDSOrderBehavior {
  if (!persisted) return { ...DEFAULT_ORDER_BEHAVIOR }
  return { ...DEFAULT_ORDER_BEHAVIOR, ...persisted }
}
