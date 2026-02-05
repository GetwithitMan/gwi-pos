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

export interface EntertainmentPricing {
  ratePerMinute: number    // e.g., 0.25 = $0.25/min
  minimumCharge: number    // e.g., 15.00 = $15 minimum (backward compat)
  incrementMinutes: number // e.g., 15 = 15-min blocks after minimum (backward compat)
  graceMinutes: number     // e.g., 5 = 5 min before next charge
  prepaidPackages?: PrepaidPackage[]
  happyHour?: HappyHourConfig
}

export interface ChargeBreakdown {
  totalCharge: number
  minutesUsed: number
  minutesCoveredByMinimum: number
  overageMinutes: number
  chargeableOverage: number
  extraIncrements: number
  incrementCost: number
}

/**
 * Calculate current charge based on elapsed time
 */
export function calculateCharge(
  elapsedMinutes: number,
  pricing: EntertainmentPricing
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

  const totalCharge = minimumCharge + (extraIncrements * incrementCost)

  return {
    totalCharge,
    minutesUsed: elapsedMinutes,
    minutesCoveredByMinimum,
    overageMinutes,
    chargeableOverage,
    extraIncrements,
    incrementCost,
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
 * Get the active rate based on time (applies happy hour if active)
 */
export function getActiveRate(
  baseRate: number,
  happyHour?: HappyHourConfig,
  time: Date = new Date()
): { rate: number; isHappyHour: boolean; discount: number } {
  if (isHappyHour(time, happyHour)) {
    const discount = happyHour!.discount
    const rate = baseRate * (1 - discount / 100)
    return { rate, isHappyHour: true, discount }
  }
  return { rate: baseRate, isHappyHour: false, discount: 0 }
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
    sessionStartTime
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
