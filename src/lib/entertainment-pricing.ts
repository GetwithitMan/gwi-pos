/**
 * Entertainment Pricing Calculations
 * Supports per-minute billing with minimum, increments, and grace periods
 */

export interface PrepaidPackage {
  minutes: number
  price: number
  label?: string  // e.g., "1 Hour Special"
}

export interface HappyHourConfig {
  enabled: boolean
  discount: number  // Percentage off (50 = 50% off)
  start: string     // "13:00" (24h format)
  end: string       // "16:00" (24h format)
  days: string[]    // ["monday", "tuesday", ...]
}

export type OvertimeMode = 'multiplier' | 'custom_rate' | 'flat_fee' | 'per_minute'

export interface OvertimeConfig {
  enabled: boolean
  mode: OvertimeMode
  multiplier?: number       // e.g., 1.5, 2.0 — scales base rate per increment
  perMinuteRate?: number    // custom per-minute rate (dollars)
  flatFee?: number          // flat fee for any overtime
  graceMinutes?: number     // grace before overtime kicks in (default 5)
}

export interface PricingWindow {
  id: string                // unique ID for UI key/tracking
  name: string              // "Happy Hour", "Weekend Premium", "Late Night"
  percentAdjust: number     // -50 = 50% off, +25 = 25% extra, 0 = no % change
  dollarAdjust: number      // per minute: -0.05 = $0.05/min off, +0.10 = $0.10/min extra
  startTime: string         // "13:00" (24h format)
  endTime: string           // "16:00" (24h format)
  days: string[]            // ["monday", "tuesday", ...]
  enabled: boolean
  // Legacy fields (backward compat with old type/value format)
  type?: 'discount' | 'surcharge' | 'fixed_rate'
  value?: number
}

export interface EntertainmentPricing {
  ratePerMinute: number    // e.g., 0.25 = $0.25/min
  minimumCharge: number    // e.g., 15.00 = $15 minimum (backward compat)
  incrementMinutes: number // e.g., 15 = 15-min blocks after minimum (backward compat)
  graceMinutes: number     // e.g., 5 = 5 min before next charge
  prepaidPackages?: PrepaidPackage[]
  happyHour?: HappyHourConfig
  overtime?: OvertimeConfig
  pricingWindows?: PricingWindow[]
}

export interface ChargeBreakdown {
  totalCharge: number
  minutesUsed: number
  minutesCoveredByMinimum: number
  overageMinutes: number
  chargeableOverage: number
  extraIncrements: number
  incrementCost: number
  // Overtime breakdown
  overtimeMinutes: number
  overtimeCharge: number
  overtimeMode?: OvertimeMode
}

/**
 * Calculate current charge based on elapsed time.
 * If bookedMinutes is provided AND overtime config exists, applies overtime pricing
 * for any time beyond the booked duration + overtime grace period.
 */
export function calculateCharge(
  elapsedMinutes: number,
  pricing: EntertainmentPricing,
  bookedMinutes?: number
): ChargeBreakdown {
  const { ratePerMinute, minimumCharge, incrementMinutes, graceMinutes } = pricing

  // Minutes covered by minimum charge
  const minutesCoveredByMinimum = ratePerMinute > 0 ? minimumCharge / ratePerMinute : 0
  const incrementCost = incrementMinutes * ratePerMinute

  // If under minimum, return minimum
  if (elapsedMinutes <= minutesCoveredByMinimum) {
    return {
      totalCharge: minimumCharge,
      minutesUsed: elapsedMinutes,
      minutesCoveredByMinimum,
      overageMinutes: 0,
      chargeableOverage: 0,
      extraIncrements: 0,
      incrementCost,
      overtimeMinutes: 0,
      overtimeCharge: 0,
    }
  }

  // Calculate overage beyond minimum
  const overageMinutes = elapsedMinutes - minutesCoveredByMinimum

  // Apply grace period
  const chargeableOverage = Math.max(0, overageMinutes - graceMinutes)

  // Calculate extra increments
  const extraIncrements = chargeableOverage > 0
    ? Math.ceil(chargeableOverage / incrementMinutes)
    : 0

  const baseCharge = minimumCharge + (extraIncrements * incrementCost)

  // Calculate overtime if applicable
  const ot = pricing.overtime
  const otGrace = ot?.graceMinutes ?? 0
  const threshold = bookedMinutes != null ? bookedMinutes + otGrace : null
  let overtimeMinutes = 0
  let overtimeCharge = 0
  let overtimeMode: OvertimeMode | undefined

  if (ot?.enabled && threshold != null && elapsedMinutes > threshold) {
    overtimeMinutes = elapsedMinutes - threshold
    overtimeMode = ot.mode
    overtimeCharge = calculateOvertimeCharge(overtimeMinutes, ot, ratePerMinute, incrementMinutes)
  }

  return {
    totalCharge: baseCharge + overtimeCharge,
    minutesUsed: elapsedMinutes,
    minutesCoveredByMinimum,
    overageMinutes,
    chargeableOverage,
    extraIncrements,
    incrementCost,
    overtimeMinutes,
    overtimeCharge,
    overtimeMode,
  }
}

/**
 * Calculate the overtime surcharge for a block-time session that ran past its booked time.
 * Used when the session had a fixed block duration (e.g., 60 min) and the customer stayed longer.
 */
export function calculateBlockTimeOvertime(
  elapsedMinutes: number,
  bookedMinutes: number,
  overtime: OvertimeConfig,
  baseRatePerMinute: number,
  incrementMinutes: number = 15
): { overtimeMinutes: number; overtimeCharge: number } {
  const otGrace = overtime.graceMinutes ?? 0
  const threshold = bookedMinutes + otGrace
  if (!overtime.enabled || elapsedMinutes <= threshold) {
    return { overtimeMinutes: 0, overtimeCharge: 0 }
  }
  const overtimeMinutes = elapsedMinutes - threshold
  const overtimeCharge = calculateOvertimeCharge(overtimeMinutes, overtime, baseRatePerMinute, incrementMinutes)
  return { overtimeMinutes, overtimeCharge }
}

/**
 * Core overtime charge calculation based on mode.
 */
function calculateOvertimeCharge(
  overtimeMinutes: number,
  ot: OvertimeConfig,
  baseRatePerMinute: number,
  incrementMinutes: number
): number {
  switch (ot.mode) {
    case 'multiplier': {
      // Scale the base rate by multiplier, charge in increments
      const multiplier = ot.multiplier ?? 1.5
      const otRate = baseRatePerMinute * multiplier
      const otIncrements = Math.ceil(overtimeMinutes / incrementMinutes)
      return otIncrements * incrementMinutes * otRate
    }
    case 'custom_rate': {
      // Custom per-minute rate, charge in increments
      const customRate = ot.perMinuteRate ?? baseRatePerMinute
      const otIncrements = Math.ceil(overtimeMinutes / incrementMinutes)
      return otIncrements * incrementMinutes * customRate
    }
    case 'per_minute': {
      // Exact per-minute (no rounding to increments)
      const perMinRate = ot.perMinuteRate ?? baseRatePerMinute
      return overtimeMinutes * perMinRate
    }
    case 'flat_fee': {
      // One-time flat fee regardless of how long overtime is
      return ot.flatFee ?? 0
    }
    default:
      return 0
  }
}

/**
 * Format charge for display
 */
export function formatCharge(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/**
 * Calculate minutes until next charge
 */
export function minutesUntilNextCharge(
  elapsedMinutes: number,
  pricing: EntertainmentPricing
): number {
  const minutesCovered = pricing.minimumCharge / pricing.ratePerMinute

  // Still in minimum period
  if (elapsedMinutes < minutesCovered) {
    return Math.ceil(minutesCovered - elapsedMinutes)
  }

  // In overage period - find next increment boundary
  const overageMinutes = elapsedMinutes - minutesCovered
  const currentIncrement = Math.floor((overageMinutes - pricing.graceMinutes) / pricing.incrementMinutes)
  const nextBoundary = minutesCovered + pricing.graceMinutes + ((currentIncrement + 1) * pricing.incrementMinutes)

  return Math.max(0, Math.ceil(nextBoundary - elapsedMinutes))
}

/**
 * Get human-readable pricing summary
 */
export function getPricingSummary(pricing: EntertainmentPricing): string {
  const minutesCovered = Math.round(pricing.minimumCharge / pricing.ratePerMinute)
  const incrementCost = pricing.incrementMinutes * pricing.ratePerMinute
  return `$${pricing.minimumCharge.toFixed(2)} covers ${minutesCovered} min, then $${incrementCost.toFixed(2)} per ${pricing.incrementMinutes} min`
}

/**
 * Default pricing for new entertainment items
 */
export const DEFAULT_PRICING: EntertainmentPricing = {
  ratePerMinute: 0.25,
  minimumCharge: 15.00,
  incrementMinutes: 15,
  graceMinutes: 5,
}

/**
 * Find the first active pricing window that matches the given time.
 * Returns null if no window matches. First match wins (order matters).
 */
export function findActivePricingWindow(
  time: Date,
  windows?: PricingWindow[]
): PricingWindow | null {
  if (!windows?.length) return null

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayName = dayNames[time.getDay()]
  const hours = time.getHours().toString().padStart(2, '0')
  const minutes = time.getMinutes().toString().padStart(2, '0')
  const currentTime = `${hours}:${minutes}`

  for (const w of windows) {
    if (!w.enabled) continue
    if (!w.days.includes(dayName)) continue

    // Handle overnight windows (e.g., 22:00 → 02:00)
    if (w.startTime > w.endTime) {
      if (currentTime >= w.startTime || currentTime < w.endTime) return w
    } else {
      if (currentTime >= w.startTime && currentTime < w.endTime) return w
    }
  }

  return null
}

/**
 * Apply a pricing window to a base rate.
 * Combines percentage adjustment and dollar adjustment:
 *   effectiveRate = baseRate * (1 + percentAdjust/100) + dollarAdjust
 * Falls back to legacy type/value format for backward compat.
 */
export function applyPricingWindow(
  baseRate: number,
  window: PricingWindow
): number {
  // New format: percentAdjust + dollarAdjust
  if (window.percentAdjust !== undefined && window.dollarAdjust !== undefined) {
    const pct = window.percentAdjust || 0
    const dollar = window.dollarAdjust || 0
    return Math.max(0, baseRate * (1 + pct / 100) + dollar)
  }
  // Legacy format: type + value
  switch (window.type) {
    case 'discount':
      return baseRate * (1 - (window.value || 0) / 100)
    case 'surcharge':
      return baseRate * (1 + (window.value || 0) / 100)
    case 'fixed_rate':
      return window.value || baseRate
    default:
      return baseRate
  }
}

/**
 * Check if current time falls within happy hour
 */
export function isHappyHour(
  time: Date,
  happyHour?: HappyHourConfig
): boolean {
  if (!happyHour?.enabled) return false

  // Get day name in lowercase
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayName = dayNames[time.getDay()]

  if (!happyHour.days.includes(dayName)) return false

  // Get current time in HH:MM format
  const hours = time.getHours().toString().padStart(2, '0')
  const minutes = time.getMinutes().toString().padStart(2, '0')
  const currentTime = `${hours}:${minutes}`

  return currentTime >= happyHour.start && currentTime < happyHour.end
}

/**
 * Get the active rate based on time (applies pricing windows or happy hour if active)
 */
export function getActiveRate(
  baseRate: number,
  happyHour?: HappyHourConfig,
  time: Date = new Date(),
  pricingWindows?: PricingWindow[]
): { rate: number; isHappyHour: boolean; discount: number; activeWindow: PricingWindow | null } {
  // Check pricing windows first (new system)
  if (pricingWindows?.length) {
    const window = findActivePricingWindow(time, pricingWindows)
    if (window) {
      const rate = applyPricingWindow(baseRate, window)
      // For backward compat: compute effective discount %, set isHappyHour if rate is lower
      const effectiveDiscount = baseRate > 0 ? Math.round((1 - rate / baseRate) * 100) : 0
      return { rate, isHappyHour: rate < baseRate, discount: effectiveDiscount, activeWindow: window }
    }
  }

  // Fallback to legacy happy hour
  if (isHappyHour(time, happyHour)) {
    const discount = happyHour!.discount
    const rate = baseRate * (1 - discount / 100)
    return { rate, isHappyHour: true, discount, activeWindow: null }
  }
  return { rate: baseRate, isHappyHour: false, discount: 0, activeWindow: null }
}

/**
 * Calculate charge with prepaid package support
 */
export function calculateChargeWithPrepaid(
  elapsedMinutes: number,
  pricing: EntertainmentPricing,
  prepaidPackage?: PrepaidPackage,
  sessionStartTime: Date = new Date()
): {
  totalCharge: number
  prepaidAmount: number
  overageCharge: number
  overageMinutes: number
  activeRate: number
  isHappyHour: boolean
} {
  const { rate: activeRate, isHappyHour: isHH } = getActiveRate(
    pricing.ratePerMinute,
    pricing.happyHour,
    sessionStartTime,
    pricing.pricingWindows
  )

  // If prepaid and still within prepaid time
  if (prepaidPackage && elapsedMinutes <= prepaidPackage.minutes) {
    return {
      totalCharge: prepaidPackage.price,
      prepaidAmount: prepaidPackage.price,
      overageCharge: 0,
      overageMinutes: 0,
      activeRate,
      isHappyHour: isHH,
    }
  }

  // Calculate overage
  const prepaidMinutes = prepaidPackage?.minutes || 0
  const prepaidAmount = prepaidPackage?.price || 0
  const rawOverage = elapsedMinutes - prepaidMinutes
  const overageMinutes = Math.max(0, rawOverage - pricing.graceMinutes)
  const overageCharge = overageMinutes * activeRate
  const totalCharge = prepaidAmount + overageCharge

  return {
    totalCharge,
    prepaidAmount,
    overageCharge,
    overageMinutes,
    activeRate,
    isHappyHour: isHH,
  }
}

/**
 * Get savings for a prepaid package vs open play
 */
export function getPackageSavings(
  pkg: PrepaidPackage,
  ratePerMinute: number
): number {
  const openPlayCost = pkg.minutes * ratePerMinute
  return Math.max(0, openPlayCost - pkg.price)
}

/**
 * Format package for display
 */
export function formatPackage(pkg: PrepaidPackage, ratePerMinute: number): string {
  const savings = getPackageSavings(pkg, ratePerMinute)
  const label = pkg.label || `${pkg.minutes} min`
  if (savings > 0) {
    return `${label} - $${pkg.price.toFixed(2)} (save $${savings.toFixed(2)})`
  }
  return `${label} - $${pkg.price.toFixed(2)}`
}

/**
 * Default prepaid packages
 */
export const DEFAULT_PREPAID_PACKAGES: PrepaidPackage[] = [
  { minutes: 30, price: 10, label: '30 Minutes' },
  { minutes: 60, price: 15, label: '1 Hour' },
  { minutes: 90, price: 20, label: '90 Minutes' },
]
