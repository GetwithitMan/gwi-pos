/**
 * Payment Domain Module
 *
 * Pure business logic functions for payment-related operations.
 * All functions are side-effect free and easily testable.
 */

// ─── Tip Calculations ────────────────────────────────────────────────────────

export {
  calculateTipAmount,
  calculateTipPercent,
  getSuggestedTips,
  shouldApplyAutoGratuity,
  calculateAutoGratuity,
  validateTipAmount,
  calculateTipOut,
  calculateTipDistribution,
  calculateTipShares,
  calculateTipPool,
  DEFAULT_TIP_SETTINGS,
} from './tip-calculations'

export type {
  TipSettings,
  TipOutRule,
  TipDistribution,
} from './tip-calculations'

// ─── Loyalty Points ──────────────────────────────────────────────────────────

export {
  calculateBasePoints,
  multiplierApplies,
  calculateLoyaltyPoints,
  calculatePointsValue,
  calculatePointsForDollars,
  calculateRedemption,
  determineTier,
  pointsToNextTier,
  arePointsExpired,
  calculateExpirationDate,
  DEFAULT_LOYALTY_SETTINGS,
} from './loyalty-points'

export type {
  LoyaltySettings,
  BonusMultiplier,
  TierLevel,
  PointsAccrual,
  RedemptionCalculation,
} from './loyalty-points'

// ─── Dual Pricing ────────────────────────────────────────────────────────────

export {
  calculateDualPrice,
  dualPricingApplies,
  calculateOrderPricing,
  formatPriceForDisplay,
  getAdjustmentLabel,
  validateDualPricingCompliance,
  DEFAULT_DUAL_PRICING_SETTINGS,
} from './dual-pricing'

export type {
  DualPricingSettings,
  PricingCalculation,
  OrderPricingBreakdown,
} from './dual-pricing'

// ─── Validators ──────────────────────────────────────────────────────────────

export {
  validatePayment,
  validatePayments,
  validateAmount,
  validateSplitPayment,
  validateRefund,
  combineValidations,
  isValid,
} from './validators'

export type { ValidationResult } from './validators'
