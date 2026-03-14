/**
 * Entertainment Domain — Pure Pricing Functions
 *
 * All functions here are pure (no DB, no side effects).
 * They encapsulate the pricing logic that was previously inlined in route handlers.
 */

import {
  calculateCharge,
  calculateBlockTimeOvertime,
  getActiveRate,
  type EntertainmentPricing,
  type OvertimeConfig,
  type HappyHourConfig,
  type ChargeBreakdown,
  type PricingWindow,
} from '@/lib/entertainment-pricing'
import type { MenuItemPricingFields } from './types'

// ─── Overtime Config Builder ─────────────────────────────────────────────────

/**
 * Build an OvertimeConfig from raw MenuItem fields.
 * Returns undefined if overtime is not enabled.
 */
export function buildOvertimeConfig(menuItem: {
  overtimeEnabled?: unknown
  overtimeMode?: unknown
  overtimeMultiplier?: unknown
  overtimePerMinuteRate?: unknown
  overtimeFlatFee?: unknown
  overtimeGraceMinutes?: unknown
}): OvertimeConfig | undefined {
  if (!menuItem.overtimeEnabled) return undefined
  return {
    enabled: true,
    mode: (menuItem.overtimeMode as OvertimeConfig['mode']) || 'multiplier',
    multiplier: menuItem.overtimeMultiplier ? Number(menuItem.overtimeMultiplier) : undefined,
    perMinuteRate: menuItem.overtimePerMinuteRate ? Number(menuItem.overtimePerMinuteRate) : undefined,
    flatFee: menuItem.overtimeFlatFee ? Number(menuItem.overtimeFlatFee) : undefined,
    graceMinutes: menuItem.overtimeGraceMinutes != null ? Number(menuItem.overtimeGraceMinutes) : undefined,
  }
}

// ─── Full Pricing Config Builder ─────────────────────────────────────────────

/**
 * Build a full EntertainmentPricing from raw MenuItem fields.
 * Includes happy hour and overtime configuration when present.
 */
export function buildPricingConfig(menuItem: {
  ratePerMinute: unknown
  minimumCharge: unknown
  incrementMinutes: unknown
  graceMinutes: unknown
  happyHourEnabled?: unknown
  happyHourDiscount?: unknown
  happyHourStart?: unknown
  happyHourEnd?: unknown
  happyHourDays?: unknown
  overtimeEnabled?: unknown
  overtimeMode?: unknown
  overtimeMultiplier?: unknown
  overtimePerMinuteRate?: unknown
  overtimeFlatFee?: unknown
  overtimeGraceMinutes?: unknown
  pricingWindows?: unknown
}): EntertainmentPricing {
  return {
    ratePerMinute: Number(menuItem.ratePerMinute) || 0,
    minimumCharge: Number(menuItem.minimumCharge) || 0,
    incrementMinutes: (menuItem.incrementMinutes as number) || 15,
    graceMinutes: (menuItem.graceMinutes as number) || 0,
    happyHour: menuItem.happyHourEnabled
      ? {
          enabled: true,
          discount: (menuItem.happyHourDiscount as number) || 0,
          start: (menuItem.happyHourStart as string) || '00:00',
          end: (menuItem.happyHourEnd as string) || '23:59',
          days: (menuItem.happyHourDays as string[]) || [],
        }
      : undefined,
    overtime: buildOvertimeConfig(menuItem),
    pricingWindows: Array.isArray(menuItem.pricingWindows) ? menuItem.pricingWindows as PricingWindow[] : undefined,
  }
}

// ─── Tiered Price Calculation ────────────────────────────────────────────────

/**
 * Calculate the price for a given duration using timedPricing tiers.
 * Falls back to MenuItem.price if no tiers match.
 */
export function calculateTieredPrice(
  minutes: number,
  timedPricing: Record<string, unknown>,
  fallbackPrice: number
): number {
  if (minutes <= 15 && timedPricing.per15Min) return Number(timedPricing.per15Min)
  if (minutes <= 30 && timedPricing.per30Min) return Number(timedPricing.per30Min)
  if (minutes <= 60 && timedPricing.perHour) return Number(timedPricing.perHour)
  if (timedPricing.perHour) return (minutes / 60) * Number(timedPricing.perHour)
  return fallbackPrice
}

// ─── Initial Block Price ─────────────────────────────────────────────────────

/**
 * Calculate the initial price when starting a block-time session.
 * Checks timedPricing tiers first, then per-minute pricing, then flat rate.
 */
export function calculateInitialBlockPrice(
  minutes: number,
  menuItem: MenuItemPricingFields
): number {
  const fallbackPrice = Number(menuItem.price || 0)

  // 1. Check timedPricing JSON tiers first
  if (menuItem.timedPricing && typeof menuItem.timedPricing === 'object') {
    return calculateTieredPrice(
      minutes,
      menuItem.timedPricing as Record<string, unknown>,
      fallbackPrice
    )
  }

  // 2. Per-minute pricing
  if (Number(menuItem.ratePerMinute || 0) > 0) {
    const pricing: EntertainmentPricing = {
      ratePerMinute: Number(menuItem.ratePerMinute),
      minimumCharge: Number(menuItem.minimumCharge || 0),
      incrementMinutes: menuItem.incrementMinutes || 15,
      graceMinutes: menuItem.graceMinutes || 0,
    }
    const breakdown = calculateCharge(minutes, pricing)
    return breakdown.totalCharge
  }

  // 3. Flat rate fallback
  return fallbackPrice
}

// ─── Extension Price ─────────────────────────────────────────────────────────

/**
 * Calculate the INCREMENTAL charge for extending a session.
 * Preserves any discounts, comps, or happy hour rates on the original block.
 */
export function calculateExtensionCharge(
  oldMinutes: number,
  additionalMinutes: number,
  menuItem: MenuItemPricingFields
): number {
  const newTotalMinutes = oldMinutes + additionalMinutes

  if (menuItem.timedPricing && typeof menuItem.timedPricing === 'object') {
    const tp = menuItem.timedPricing as Record<string, unknown>
    const fallbackPrice = Number(menuItem.price || 0)
    const newTotalTierPrice = calculateTieredPrice(newTotalMinutes, tp, fallbackPrice)
    const oldTotalTierPrice = calculateTieredPrice(oldMinutes, tp, fallbackPrice)
    return Math.max(0, newTotalTierPrice - oldTotalTierPrice)
  }

  if (Number(menuItem.ratePerMinute || 0) > 0) {
    // Per-minute pricing: calculate charge for ONLY the additional minutes
    const pricing: EntertainmentPricing = {
      ratePerMinute: Number(menuItem.ratePerMinute),
      minimumCharge: 0, // No minimum for extensions
      incrementMinutes: menuItem.incrementMinutes || 15,
      graceMinutes: 0, // No grace for extensions
    }
    const breakdown = calculateCharge(additionalMinutes, pricing)
    return breakdown.totalCharge
  }

  // Flat-rate fallback: proportional extension based on MenuItem base duration
  const basePrice = Number(menuItem.price || 0)
  const baseMinutes = menuItem.blockTimeMinutes || 60
  return (additionalMinutes / baseMinutes) * basePrice
}

// ─── Time Override Price ─────────────────────────────────────────────────────

/**
 * Calculate the price for a manager time override based on new total duration.
 * Same logic as initial price calculation but for an arbitrary duration.
 */
export function calculateTimeOverridePrice(
  newDurationMinutes: number,
  menuItem: MenuItemPricingFields
): number {
  return calculateInitialBlockPrice(newDurationMinutes, menuItem)
}

// ─── Pricing Window Extraction ───────────────────────────────────────────────

/**
 * Extract pricingWindows from either a top-level field or nested in timedPricing JSON.
 * This handles the common case where Prisma returns timedPricing as a JSON blob
 * containing the pricingWindows array, but the pricing functions need it as a flat field.
 */
function extractPricingWindows(menuItem: { pricingWindows?: PricingWindow[]; timedPricing?: unknown }): PricingWindow[] | undefined {
  if (menuItem.pricingWindows?.length) return menuItem.pricingWindows
  if (menuItem.timedPricing && typeof menuItem.timedPricing === 'object') {
    const tp = menuItem.timedPricing as Record<string, unknown>
    if (Array.isArray(tp.pricingWindows) && tp.pricingWindows.length > 0) {
      return tp.pricingWindows as PricingWindow[]
    }
  }
  return undefined
}

// ─── Stop Session Price ──────────────────────────────────────────────────────

/**
 * Calculate the final charge when stopping a session.
 * Handles per-minute, tier-based, and flat-rate pricing with overtime.
 */
export function calculateStopCharge(
  actualMinutes: number,
  bookedMinutes: number | null | undefined,
  menuItem: MenuItemPricingFields,
  sessionStartTime: Date | null,
  now: Date
): { charge: number; breakdown: ChargeBreakdown | null; overtimeBreakdown: { overtimeMinutes: number; overtimeCharge: number } | null } {
  const otConfig = buildOvertimeConfig(menuItem)
  let charge = Number(menuItem.price || 0)
  let breakdown: ChargeBreakdown | null = null
  let overtimeBreakdown: { overtimeMinutes: number; overtimeCharge: number } | null = null
  const incrementMin = menuItem.incrementMinutes || 15

  if (Number(menuItem.ratePerMinute || 0) > 0) {
    // Per-minute pricing engine
    const pricing: EntertainmentPricing = {
      ratePerMinute: Number(menuItem.ratePerMinute),
      minimumCharge: Number(menuItem.minimumCharge || 0),
      incrementMinutes: incrementMin,
      graceMinutes: menuItem.graceMinutes || 0,
    }

    // Check happy hour
    let happyHour: HappyHourConfig | undefined
    if (menuItem.happyHourEnabled) {
      happyHour = {
        enabled: true,
        discount: menuItem.happyHourDiscount || 0,
        start: menuItem.happyHourStart || '00:00',
        end: menuItem.happyHourEnd || '23:59',
        days: (Array.isArray(menuItem.happyHourDays) ? menuItem.happyHourDays : []) as string[],
      }
    }

    // Apply happy hour / pricing window rate if active (use session start time for consistency)
    const sessionStart = sessionStartTime || now
    const windows = extractPricingWindows(menuItem)
    const { rate: activeRate } = getActiveRate(pricing.ratePerMinute, happyHour, sessionStart, windows)
    const effectivePricing: EntertainmentPricing = {
      ...pricing,
      ratePerMinute: activeRate,
      overtime: otConfig,
    }

    const bm = bookedMinutes || undefined
    breakdown = calculateCharge(actualMinutes, effectivePricing, bm)
    charge = breakdown.totalCharge
    if (breakdown.overtimeMinutes > 0) {
      overtimeBreakdown = { overtimeMinutes: breakdown.overtimeMinutes, overtimeCharge: breakdown.overtimeCharge }
    }
  } else if (menuItem.timedPricing && typeof menuItem.timedPricing === 'object') {
    // Tier-based pricing from timedPricing JSON
    const tp = menuItem.timedPricing as Record<string, unknown>
    const purchasedMinutes = bookedMinutes || 0
    charge = calculateTieredPrice(purchasedMinutes, tp, charge)

    // Apply overtime for tier-based pricing if session exceeded booked duration
    if (otConfig && purchasedMinutes > 0 && actualMinutes > purchasedMinutes) {
      const tierBaseRate = charge / purchasedMinutes
      overtimeBreakdown = calculateBlockTimeOvertime(
        actualMinutes,
        purchasedMinutes,
        otConfig,
        tierBaseRate,
        incrementMin
      )
      charge += overtimeBreakdown.overtimeCharge
    }
  } else if (otConfig && bookedMinutes && actualMinutes > bookedMinutes) {
    // Flat-rate fallback with overtime
    const flatBaseRate = charge / bookedMinutes
    overtimeBreakdown = calculateBlockTimeOvertime(
      actualMinutes,
      bookedMinutes,
      otConfig,
      flatBaseRate,
      incrementMin
    )
    charge += overtimeBreakdown.overtimeCharge
  }

  return { charge, breakdown, overtimeBreakdown }
}

// ─── Cron Expiry Price ───────────────────────────────────────────────────────

/**
 * Calculate the final charge for a session being expired by the cron job.
 * Same logic as stop but uses buildPricingConfig for full config.
 */
export function calculateExpiryCharge(
  elapsedMinutes: number,
  bookedMinutes: number | undefined,
  menuItem: {
    price: unknown
    ratePerMinute: unknown
    minimumCharge: unknown
    incrementMinutes: number | null
    graceMinutes: number | null
    timedPricing: unknown
    happyHourEnabled: boolean | null
    happyHourDiscount: number | null
    happyHourStart: string | null
    happyHourEnd: string | null
    happyHourDays: unknown
    overtimeEnabled: boolean | null
    overtimeMode: string | null
    overtimeMultiplier: unknown
    overtimePerMinuteRate: unknown
    overtimeFlatFee: unknown
    overtimeGraceMinutes: number | null
    pricingWindows?: PricingWindow[]
  },
  sessionStartTime: Date
): number {
  let newPrice: number = Number(menuItem.price) || 0

  if (menuItem.ratePerMinute != null && Number(menuItem.ratePerMinute) > 0) {
    const pricing = buildPricingConfig(menuItem)
    const windows = extractPricingWindows(menuItem)
    const { rate: activeRate } = getActiveRate(
      pricing.ratePerMinute,
      pricing.happyHour,
      sessionStartTime,
      windows
    )
    const adjustedPricing: EntertainmentPricing = {
      ...pricing,
      ratePerMinute: activeRate,
    }
    const bd = calculateCharge(elapsedMinutes, adjustedPricing, bookedMinutes)
    newPrice = bd.totalCharge
  } else {
    const otConfig = buildOvertimeConfig(menuItem)
    if (otConfig && bookedMinutes && elapsedMinutes > bookedMinutes) {
      const baseRate = newPrice / bookedMinutes
      const incrementMin = menuItem.incrementMinutes || 15
      const otResult = calculateBlockTimeOvertime(
        elapsedMinutes,
        bookedMinutes,
        otConfig,
        baseRate,
        incrementMin
      )
      newPrice += otResult.overtimeCharge
    }
  }

  return newPrice
}
