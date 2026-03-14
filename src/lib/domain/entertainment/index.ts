/**
 * Entertainment Domain Module
 *
 * Business logic for timed-rental entertainment sessions:
 * - Session lifecycle (start, stop, extend, time override, expiry)
 * - Pricing (tiered, per-minute, flat-rate, overtime, happy hour)
 * - Validation (request validation, session state checks)
 *
 * Routes keep: HTTP handling, auth, socket dispatch, audit logging.
 */

// Types
export type {
  TxClient,
  MenuItemPricingFields,
  StartSessionInput,
  StartSessionResult,
  StopReason,
  StopSessionResult,
  ExtendSessionResult,
  StopAllSessionResult,
  ExpireSessionItem,
  WaitlistTimeInfo,
} from './types'

// Pure pricing functions
export {
  buildOvertimeConfig,
  buildPricingConfig,
  calculateTieredPrice,
  calculateInitialBlockPrice,
  calculateExtensionCharge,
  calculateTimeOverridePrice,
  calculateStopCharge,
  calculateExpiryCharge,
} from './pricing'

// Pure validation functions
export {
  validateStartRequest,
  validateSessionStart,
  validateExtendRequest,
  validateExtension,
  validateTimeOverrideRequest,
  validateTimeOverride,
  validateStopRequest,
  validateStopSession,
  formatWaitTime,
  calculateWaitMinutes,
  isSessionExpired,
  calculateMinutesRemaining,
  calculateMinutesElapsed,
  isExpiringSoon,
  validateEntertainmentStatus,
  validateWaitlistStatus,
} from './validation'
export type { EntertainmentStatus } from './validation'

// Session operations (DB-accessing, takes TxClient)
export {
  startSession,
  stopSession,
  extendSession,
  overrideSessionTime,
  expireSession,
  stopAllSessions,
} from './session-operations'
