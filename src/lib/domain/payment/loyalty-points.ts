/**
 * Loyalty Points Domain Logic
 *
 * Pure functions for loyalty points calculations, accrual rules, and redemption.
 * Encapsulates all business rules related to customer loyalty programs.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LoyaltySettings {
  enabled: boolean
  pointsPerDollar: number
  dollarPerPoint: number
  bonusMultipliers: BonusMultiplier[]
  minimumPurchaseForPoints: number
  expirationDays?: number
  tierLevels?: TierLevel[]
}

export interface BonusMultiplier {
  name: string
  multiplier: number
  conditions: {
    dayOfWeek?: number[] // 0-6 (Sunday-Saturday)
    timeRange?: { start: string; end: string }
    minimumSpend?: number
    itemCategories?: string[]
  }
  isActive: boolean
}

export interface TierLevel {
  name: string
  threshold: number // Points needed to reach this tier
  benefits: {
    pointsMultiplier: number
    discountPercent?: number
    freeItemsPerMonth?: number
  }
}

export interface PointsAccrual {
  basePoints: number
  bonusPoints: number
  totalPoints: number
  appliedMultipliers: string[]
}

export interface RedemptionCalculation {
  pointsToRedeem: number
  dollarValue: number
  remainingPoints: number
  canRedeem: boolean
  error?: string
}

// ─── Points Accrual ──────────────────────────────────────────────────────────

/**
 * Calculate base loyalty points earned
 *
 * @param purchaseAmount - Total purchase amount (before points redemption)
 * @param settings - Loyalty program settings
 * @returns Base points earned (before multipliers)
 *
 * @example
 * calculateBasePoints(100.00, { pointsPerDollar: 1, minimumPurchaseForPoints: 5 })
 * // Returns 100
 */
export function calculateBasePoints(
  purchaseAmount: number,
  settings: LoyaltySettings
): number {
  if (!settings.enabled) return 0
  if (purchaseAmount < settings.minimumPurchaseForPoints) return 0

  return Math.floor(purchaseAmount * settings.pointsPerDollar)
}

/**
 * Check if a bonus multiplier applies
 *
 * @param multiplier - Bonus multiplier rule
 * @param context - Transaction context
 * @returns True if multiplier should apply
 */
export function multiplierApplies(
  multiplier: BonusMultiplier,
  context: {
    timestamp: Date
    purchaseAmount: number
    itemCategories: string[]
  }
): boolean {
  if (!multiplier.isActive) return false

  const conditions = multiplier.conditions

  // Check day of week
  if (conditions.dayOfWeek && conditions.dayOfWeek.length > 0) {
    const dayOfWeek = context.timestamp.getDay()
    if (!conditions.dayOfWeek.includes(dayOfWeek)) return false
  }

  // Check time range
  if (conditions.timeRange) {
    const hour = context.timestamp.getHours()
    const minute = context.timestamp.getMinutes()
    const currentTime = hour * 60 + minute

    const [startHour, startMinute] = conditions.timeRange.start.split(':').map(Number)
    const startTime = startHour * 60 + startMinute

    const [endHour, endMinute] = conditions.timeRange.end.split(':').map(Number)
    const endTime = endHour * 60 + endMinute

    if (currentTime < startTime || currentTime > endTime) return false
  }

  // Check minimum spend
  if (conditions.minimumSpend && context.purchaseAmount < conditions.minimumSpend) {
    return false
  }

  // Check item categories
  if (conditions.itemCategories && conditions.itemCategories.length > 0) {
    const hasMatchingCategory = context.itemCategories.some((cat) =>
      conditions.itemCategories!.includes(cat)
    )
    if (!hasMatchingCategory) return false
  }

  return true
}

/**
 * Calculate loyalty points with multipliers
 *
 * @param purchaseAmount - Total purchase amount
 * @param settings - Loyalty settings
 * @param context - Transaction context for bonus rules
 * @returns Points accrual breakdown
 *
 * @example
 * calculateLoyaltyPoints(100.00, settings, {
 *   timestamp: new Date(),
 *   purchaseAmount: 100.00,
 *   itemCategories: ['entrees'],
 * })
 * // Returns { basePoints: 100, bonusPoints: 50, totalPoints: 150, appliedMultipliers: ['Happy Hour'] }
 */
export function calculateLoyaltyPoints(
  purchaseAmount: number,
  settings: LoyaltySettings,
  context: {
    timestamp: Date
    purchaseAmount: number
    itemCategories: string[]
  }
): PointsAccrual {
  const basePoints = calculateBasePoints(purchaseAmount, settings)

  if (basePoints === 0) {
    return {
      basePoints: 0,
      bonusPoints: 0,
      totalPoints: 0,
      appliedMultipliers: [],
    }
  }

  // Apply bonus multipliers
  const appliedMultipliers: string[] = []
  let totalMultiplier = 1

  for (const multiplier of settings.bonusMultipliers) {
    if (multiplierApplies(multiplier, context)) {
      totalMultiplier *= multiplier.multiplier
      appliedMultipliers.push(multiplier.name)
    }
  }

  const totalPoints = Math.floor(basePoints * totalMultiplier)
  const bonusPoints = totalPoints - basePoints

  return {
    basePoints,
    bonusPoints,
    totalPoints,
    appliedMultipliers,
  }
}

// ─── Points Redemption ───────────────────────────────────────────────────────

/**
 * Calculate dollar value of loyalty points
 *
 * @param points - Number of points to redeem
 * @param settings - Loyalty settings
 * @returns Dollar value
 *
 * @example
 * calculatePointsValue(100, { dollarPerPoint: 0.01 })
 * // Returns 1.00
 */
export function calculatePointsValue(points: number, settings: LoyaltySettings): number {
  return Math.round(points * settings.dollarPerPoint * 100) / 100
}

/**
 * Calculate points needed for a dollar amount
 *
 * @param dollarAmount - Desired dollar value
 * @param settings - Loyalty settings
 * @returns Points needed
 *
 * @example
 * calculatePointsForDollars(10.00, { dollarPerPoint: 0.01 })
 * // Returns 1000
 */
export function calculatePointsForDollars(
  dollarAmount: number,
  settings: LoyaltySettings
): number {
  if (settings.dollarPerPoint === 0) return 0
  return Math.ceil(dollarAmount / settings.dollarPerPoint)
}

/**
 * Validate and calculate point redemption
 *
 * @param pointsToRedeem - Points customer wants to redeem
 * @param availablePoints - Points customer has
 * @param orderTotal - Order total amount
 * @param settings - Loyalty settings
 * @returns Redemption calculation with validation
 */
export function calculateRedemption(
  pointsToRedeem: number,
  availablePoints: number,
  orderTotal: number,
  settings: LoyaltySettings
): RedemptionCalculation {
  if (!settings.enabled) {
    return {
      pointsToRedeem: 0,
      dollarValue: 0,
      remainingPoints: availablePoints,
      canRedeem: false,
      error: 'Loyalty program is not enabled',
    }
  }

  if (pointsToRedeem <= 0) {
    return {
      pointsToRedeem: 0,
      dollarValue: 0,
      remainingPoints: availablePoints,
      canRedeem: false,
      error: 'Points to redeem must be greater than 0',
    }
  }

  if (pointsToRedeem > availablePoints) {
    return {
      pointsToRedeem,
      dollarValue: 0,
      remainingPoints: availablePoints,
      canRedeem: false,
      error: `Insufficient points. Available: ${availablePoints}, Requested: ${pointsToRedeem}`,
    }
  }

  const dollarValue = calculatePointsValue(pointsToRedeem, settings)

  if (dollarValue > orderTotal) {
    return {
      pointsToRedeem,
      dollarValue,
      remainingPoints: availablePoints - pointsToRedeem,
      canRedeem: false,
      error: `Point value ($${dollarValue.toFixed(2)}) exceeds order total ($${orderTotal.toFixed(2)})`,
    }
  }

  return {
    pointsToRedeem,
    dollarValue,
    remainingPoints: availablePoints - pointsToRedeem,
    canRedeem: true,
  }
}

// ─── Tier System ─────────────────────────────────────────────────────────────

/**
 * Determine customer's loyalty tier
 *
 * @param totalPoints - Customer's lifetime points
 * @param tierLevels - Configured tier levels
 * @returns Current tier level or undefined if no tiers configured
 */
export function determineTier(
  totalPoints: number,
  tierLevels?: TierLevel[]
): TierLevel | undefined {
  if (!tierLevels || tierLevels.length === 0) return undefined

  // Sort tiers by threshold descending
  const sortedTiers = [...tierLevels].sort((a, b) => b.threshold - a.threshold)

  // Find the highest tier the customer qualifies for
  for (const tier of sortedTiers) {
    if (totalPoints >= tier.threshold) {
      return tier
    }
  }

  return undefined
}

/**
 * Calculate points needed for next tier
 *
 * @param currentPoints - Customer's current points
 * @param tierLevels - Configured tier levels
 * @returns Points needed for next tier, or null if at highest tier
 */
export function pointsToNextTier(
  currentPoints: number,
  tierLevels?: TierLevel[]
): number | null {
  if (!tierLevels || tierLevels.length === 0) return null

  // Sort tiers by threshold ascending
  const sortedTiers = [...tierLevels].sort((a, b) => a.threshold - b.threshold)

  // Find the next tier above current points
  for (const tier of sortedTiers) {
    if (currentPoints < tier.threshold) {
      return tier.threshold - currentPoints
    }
  }

  // Already at highest tier
  return null
}

// ─── Points Expiration ───────────────────────────────────────────────────────

/**
 * Check if points have expired
 *
 * @param pointsEarnedDate - Date points were earned
 * @param settings - Loyalty settings with expiration rules
 * @returns True if points have expired
 */
export function arePointsExpired(
  pointsEarnedDate: Date,
  settings: LoyaltySettings
): boolean {
  if (!settings.expirationDays) return false

  const expirationDate = new Date(pointsEarnedDate)
  expirationDate.setDate(expirationDate.getDate() + settings.expirationDays)

  return new Date() > expirationDate
}

/**
 * Calculate expiration date for points
 *
 * @param earnedDate - Date points were earned
 * @param settings - Loyalty settings
 * @returns Expiration date or null if points don't expire
 */
export function calculateExpirationDate(
  earnedDate: Date,
  settings: LoyaltySettings
): Date | null {
  if (!settings.expirationDays) return null

  const expirationDate = new Date(earnedDate)
  expirationDate.setDate(expirationDate.getDate() + settings.expirationDays)

  return expirationDate
}

// ─── Default Settings ────────────────────────────────────────────────────────

/**
 * Default loyalty settings for new locations
 */
export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: false,
  pointsPerDollar: 1, // 1 point per dollar spent
  dollarPerPoint: 0.01, // 1 cent per point redeemed
  bonusMultipliers: [],
  minimumPurchaseForPoints: 5.0,
  expirationDays: 365, // 1 year
  tierLevels: [
    {
      name: 'Bronze',
      threshold: 0,
      benefits: {
        pointsMultiplier: 1,
      },
    },
    {
      name: 'Silver',
      threshold: 500,
      benefits: {
        pointsMultiplier: 1.25,
        discountPercent: 5,
      },
    },
    {
      name: 'Gold',
      threshold: 1000,
      benefits: {
        pointsMultiplier: 1.5,
        discountPercent: 10,
        freeItemsPerMonth: 1,
      },
    },
  ],
}
