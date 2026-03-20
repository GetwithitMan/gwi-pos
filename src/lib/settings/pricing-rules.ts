// Location Settings — Pricing Rules Engine
// Split from src/lib/settings.ts for maintainability

import { createChildLogger } from '@/lib/logger'
import type { PricingRule, PricingAdjustment, HappyHourSettings } from './types'

const log = createChildLogger('settings')

// ─── Legacy Happy Hour Functions (Deprecated) ───────────────────────────────

/**
 * Get the active happy hour end time for the current schedule.
 * Returns null if happy hour is not active right now.
 * @deprecated Use getPricingRuleEndTime() with the new pricing rules engine instead.
 */
export function getHappyHourEndTime(settings: HappyHourSettings): Date | null {
  if (!settings.enabled) return null

  const now = new Date()
  const currentDay = now.getDay()
  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes()

  for (const schedule of settings.schedules) {
    if (!schedule.dayOfWeek.includes(currentDay)) continue

    const [startHour, startMin] = schedule.startTime.split(':').map(Number)
    const [endHour, endMin] = schedule.endTime.split(':').map(Number)

    const startMinutes = startHour * 60 + startMin
    const endMinutes = endHour * 60 + endMin

    let isActive = false
    if (endMinutes < startMinutes) {
      isActive = currentTimeMinutes >= startMinutes || currentTimeMinutes <= endMinutes
    } else {
      isActive = currentTimeMinutes >= startMinutes && currentTimeMinutes <= endMinutes
    }

    if (isActive) {
      const endDate = new Date(now)
      endDate.setSeconds(0, 0)
      if (endMinutes < startMinutes && currentTimeMinutes < startMinutes) {
        // Past midnight in overnight schedule — end time is today
        endDate.setHours(endHour, endMin)
      } else if (endMinutes < startMinutes) {
        // Before midnight in overnight schedule — end time is tomorrow
        endDate.setDate(endDate.getDate() + 1)
        endDate.setHours(endHour, endMin)
      } else {
        endDate.setHours(endHour, endMin)
      }
      return endDate
    }
  }

  return null
}

/**
 * Check if happy hour is currently active.
 * @deprecated Use isPricingRuleActive() with the new pricing rules engine instead.
 */
export function isHappyHourActive(settings: HappyHourSettings): boolean {
  if (!settings.enabled) return false

  const now = new Date()
  const currentDay = now.getDay() // 0-6, Sunday-Saturday
  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes()

  for (const schedule of settings.schedules) {
    if (!schedule.dayOfWeek.includes(currentDay)) continue

    const [startHour, startMin] = schedule.startTime.split(':').map(Number)
    const [endHour, endMin] = schedule.endTime.split(':').map(Number)

    const startMinutes = startHour * 60 + startMin
    const endMinutes = endHour * 60 + endMin

    // Handle overnight schedules (e.g., 22:00 - 02:00)
    if (endMinutes < startMinutes) {
      // Schedule spans midnight
      if (currentTimeMinutes >= startMinutes || currentTimeMinutes <= endMinutes) {
        return true
      }
    } else {
      // Normal schedule
      if (currentTimeMinutes >= startMinutes && currentTimeMinutes <= endMinutes) {
        return true
      }
    }
  }

  return false
}

/**
 * Calculate happy hour price for an item.
 * @deprecated Use getBestPricingRuleForItem() with the new pricing rules engine instead.
 */
export function getHappyHourPrice(
  originalPrice: number,
  settings: HappyHourSettings,
  itemId?: string,
  categoryId?: string
): { price: number; isDiscounted: boolean } {
  if (!settings.enabled || !isHappyHourActive(settings)) {
    return { price: originalPrice, isDiscounted: false }
  }

  // Check if item qualifies for happy hour
  let qualifies = false
  if (settings.appliesTo === 'all') {
    qualifies = true
  } else if (settings.appliesTo === 'categories' && categoryId) {
    qualifies = settings.categoryIds.includes(categoryId)
  } else if (settings.appliesTo === 'items' && itemId) {
    qualifies = settings.itemIds.includes(itemId)
  }

  if (!qualifies) {
    return { price: originalPrice, isDiscounted: false }
  }

  // Apply discount
  let discountedPrice: number
  if (settings.discountType === 'percent') {
    discountedPrice = originalPrice * (1 - settings.discountValue / 100)
  } else {
    discountedPrice = Math.max(0, originalPrice - settings.discountValue)
  }

  return {
    price: Math.round(discountedPrice * 100) / 100,
    isDiscounted: true,
  }
}

// ─── Pricing Rules Engine Functions ──────────────────────────────────────────

/** Scope specificity for tie-breaking: items > categories > all */
function getScopeSpecificity(appliesTo: PricingRule['appliesTo']): number {
  if (appliesTo === 'items') return 3
  if (appliesTo === 'categories') return 2
  return 1
}

/** Parse "HH:MM" to total minutes since midnight */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * Check if a pricing rule is currently active.
 * Idempotent per order creation: same inputs yield same result.
 */
export function isPricingRuleActive(rule: PricingRule, now?: Date): boolean {
  if (!rule.enabled) return false
  const _now = now ?? new Date()

  if (rule.type === 'recurring') {
    return isRecurringRuleActive(rule, _now)
  } else if (rule.type === 'one-time') {
    return isOneTimeRuleActive(rule, _now)
  } else if (rule.type === 'yearly-recurring') {
    return isYearlyRecurringRuleActive(rule, _now)
  }
  return false
}

function isRecurringRuleActive(rule: PricingRule, now: Date): boolean {
  if (!Array.isArray(rule.schedules)) return false
  const currentDay = now.getDay()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  for (const schedule of rule.schedules) {
    const startMin = parseTimeToMinutes(schedule.startTime)
    const endMin = parseTimeToMinutes(schedule.endTime)

    if (startMin === endMin) continue // zero-length window, skip

    const isCrossMidnight = endMin < startMin

    if (isCrossMidnight) {
      // Cross-midnight: dayOfWeek refers to the START day.
      // Friday 22:00-02:00 → active Fri 22:00-23:59 AND Sat 00:00-01:59
      // Before-midnight portion: current day must be in dayOfWeek, time >= start
      if (schedule.dayOfWeek.includes(currentDay) && currentMinutes >= startMin) {
        return true
      }
      // After-midnight portion: PREVIOUS day must be in dayOfWeek, time < end
      const previousDay = (currentDay + 6) % 7
      if (schedule.dayOfWeek.includes(previousDay) && currentMinutes < endMin) {
        return true
      }
    } else {
      // Normal same-day: start INCLUSIVE, end EXCLUSIVE
      if (schedule.dayOfWeek.includes(currentDay) && currentMinutes >= startMin && currentMinutes < endMin) {
        return true
      }
    }
  }
  return false
}

function isOneTimeRuleActive(rule: PricingRule, now: Date): boolean {
  if (!rule.startDate || !rule.endDate || !rule.startTime || !rule.endTime) return false

  const startMin = parseTimeToMinutes(rule.startTime)
  const endMin = parseTimeToMinutes(rule.endTime)
  if (startMin === endMin) return false

  // Build date boundaries (YYYY-MM-DD format)
  const todayStr = formatLocalDate(now)
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  const isCrossMidnight = endMin < startMin

  if (isCrossMidnight) {
    // Could be in the before-midnight portion (today is start day, time >= start)
    if (todayStr >= rule.startDate && todayStr <= rule.endDate && currentMinutes >= startMin) {
      return true
    }
    // Could be in the after-midnight portion (yesterday was a valid day, time < end)
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = formatLocalDate(yesterday)
    if (yesterdayStr >= rule.startDate && yesterdayStr <= rule.endDate && currentMinutes < endMin) {
      return true
    }
    return false
  }

  // Non-cross-midnight: today must be in range, time in [start, end)
  if (todayStr >= rule.startDate && todayStr <= rule.endDate) {
    return currentMinutes >= startMin && currentMinutes < endMin
  }
  return false
}

function isYearlyRecurringRuleActive(rule: PricingRule, now: Date): boolean {
  if (!rule.startDate || !rule.endDate || !rule.startTime || !rule.endTime) return false

  const startMin = parseTimeToMinutes(rule.startTime)
  const endMin = parseTimeToMinutes(rule.endTime)
  if (startMin === endMin) return false

  // MM-DD format
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const todayMD = `${month}-${day}`
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  // Feb 29 leap-year check: if rule references 02-29 and this isn't a leap year, skip
  if ((rule.startDate === '02-29' || rule.endDate === '02-29') && !isLeapYear(now.getFullYear())) {
    return false
  }

  const isYearWrap = rule.endDate < rule.startDate  // e.g., Dec 30 - Jan 2
  const isCrossMidnight = endMin < startMin

  // Check if today's MM-DD is in the date range
  let inDateRange: boolean
  if (isYearWrap) {
    inDateRange = todayMD >= rule.startDate || todayMD <= rule.endDate
  } else {
    inDateRange = todayMD >= rule.startDate && todayMD <= rule.endDate
  }

  if (isCrossMidnight) {
    // Before-midnight portion: today in range, time >= start
    if (inDateRange && currentMinutes >= startMin) return true
    // After-midnight portion: yesterday in range, time < end
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const yMonth = String(yesterday.getMonth() + 1).padStart(2, '0')
    const yDay = String(yesterday.getDate()).padStart(2, '0')
    const yesterdayMD = `${yMonth}-${yDay}`
    let yesterdayInRange: boolean
    if (isYearWrap) {
      yesterdayInRange = yesterdayMD >= rule.startDate || yesterdayMD <= rule.endDate
    } else {
      yesterdayInRange = yesterdayMD >= rule.startDate && yesterdayMD <= rule.endDate
    }
    if (yesterdayInRange && currentMinutes < endMin) return true
    return false
  }

  // Non-cross-midnight
  if (inDateRange) {
    return currentMinutes >= startMin && currentMinutes < endMin
  }
  return false
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * Get all currently active pricing rules, sorted by canonical priority.
 * Sort: priority DESC → scope specificity DESC (items > categories > all) → lexical id ASC
 */
export function getActivePricingRules(rules: PricingRule[], now?: Date): PricingRule[] {
  if (!Array.isArray(rules)) {
    log.warn('[PricingRules] getActivePricingRules called with non-array, returning []')
    return []
  }
  const _now = now ?? new Date()
  return rules
    .filter(r => r.enabled && isPricingRuleActive(r, _now))
    .sort((a, b) => {
      // Priority DESC
      if (b.priority !== a.priority) return b.priority - a.priority
      // Scope specificity DESC
      const specDiff = getScopeSpecificity(b.appliesTo) - getScopeSpecificity(a.appliesTo)
      if (specDiff !== 0) return specDiff
      // Lexical id ASC
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/**
 * Calculate adjusted price for an item given a pricing rule.
 * All prices in DOLLARS. Result clamped >= 0, rounded to 2dp.
 */
export function getAdjustedPrice(originalPrice: number, rule: PricingRule): number {
  if (!isFinite(originalPrice) || !isFinite(rule.adjustmentValue)) return originalPrice
  let result: number
  switch (rule.adjustmentType) {
    case 'percent-off':
      result = originalPrice * (1 - rule.adjustmentValue / 100)
      break
    case 'percent-increase':
      result = originalPrice * (1 + rule.adjustmentValue / 100)
      break
    case 'fixed-off':
      result = originalPrice - rule.adjustmentValue
      break
    case 'fixed-increase':
      result = originalPrice + rule.adjustmentValue
      break
    case 'override-price':
      result = rule.adjustmentValue
      break
    default:
      result = originalPrice
  }
  return Math.round(Math.max(0, result) * 100) / 100
}

/**
 * Find the best matching pricing rule for a specific item and return the adjustment.
 * Winner picked by: priority DESC → scope specificity (items > categories > all) → lexical id ASC.
 * Returns null if no matching rule is active.
 */
export function getBestPricingRuleForItem(
  rules: PricingRule[],
  itemId: string,
  categoryId: string,
  originalPrice: number,
  now?: Date
): PricingAdjustment | null {
  const active = getActivePricingRules(rules, now)

  // Filter to rules that match this item's scope
  // Guard: empty/null IDs and null arrays never match — prevents scope bypass
  const matching = active.filter(r => {
    if (r.appliesTo === 'all') return true
    if (r.appliesTo === 'categories') return categoryId && Array.isArray(r.categoryIds) && r.categoryIds.includes(categoryId)
    if (r.appliesTo === 'items') return itemId && Array.isArray(r.itemIds) && r.itemIds.includes(itemId)
    return false
  })

  if (matching.length === 0) return null

  // Already sorted by canonical priority — first match wins
  const winner = matching[0]
  const adjustedPrice = getAdjustedPrice(originalPrice, winner)

  // Validate color — fallback to #10b981 if empty/invalid
  const validColor = /^#[0-9a-fA-F]{6}$/.test(winner.color) ? winner.color : '#10b981'

  // badgeText falls back to ruleName truncated to 20 chars
  const badgeText = winner.badgeText || winner.name.slice(0, 20)

  // Price increases: never show the original (lower) price — customers don't need
  // to know there's a cheaper base price. Force showOriginalPrice off for increases.
  const isIncrease = winner.adjustmentType === 'percent-increase'
    || winner.adjustmentType === 'fixed-increase'
    || (winner.adjustmentType === 'override-price' && adjustedPrice > originalPrice)

  return {
    version: 1,
    ruleId: winner.id,
    ruleName: winner.name,
    adjustmentType: winner.adjustmentType,
    adjustmentValue: winner.adjustmentValue,
    originalPrice,
    adjustedPrice,
    color: validColor,
    showBadge: isIncrease ? false : winner.showBadge,
    showOriginalPrice: isIncrease ? false : winner.showOriginalPrice,
    badgeText,
  }
}

/**
 * Get the end time of a currently active pricing rule (for banner countdown).
 * Returns null if not active.
 */
export function getPricingRuleEndTime(rule: PricingRule, now?: Date): Date | null {
  const _now = now ?? new Date()
  if (!isPricingRuleActive(rule, _now)) return null

  const currentMinutes = _now.getHours() * 60 + _now.getMinutes()

  if (rule.type === 'recurring') {
    if (!Array.isArray(rule.schedules)) return null
    for (const schedule of rule.schedules) {
      const startMin = parseTimeToMinutes(schedule.startTime)
      const endMin = parseTimeToMinutes(schedule.endTime)
      if (startMin === endMin) continue
      const isCrossMidnight = endMin < startMin

      if (isCrossMidnight) {
        const currentDay = _now.getDay()
        const previousDay = (currentDay + 6) % 7
        // Before-midnight portion
        if (schedule.dayOfWeek.includes(currentDay) && currentMinutes >= startMin) {
          const endDate = new Date(_now)
          endDate.setDate(endDate.getDate() + 1)
          endDate.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0)
          return endDate
        }
        // After-midnight portion
        if (schedule.dayOfWeek.includes(previousDay) && currentMinutes < endMin) {
          const endDate = new Date(_now)
          endDate.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0)
          return endDate
        }
      } else {
        if (schedule.dayOfWeek.includes(_now.getDay()) && currentMinutes >= startMin && currentMinutes < endMin) {
          const endDate = new Date(_now)
          endDate.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0)
          return endDate
        }
      }
    }
    return null
  }

  if (rule.type === 'one-time' || rule.type === 'yearly-recurring') {
    if (!rule.endTime) return null
    const endMin = parseTimeToMinutes(rule.endTime)
    const startMin = rule.startTime ? parseTimeToMinutes(rule.startTime) : 0
    const isCrossMidnight = endMin < startMin

    if (isCrossMidnight && currentMinutes >= startMin) {
      // End is tomorrow
      const endDate = new Date(_now)
      endDate.setDate(endDate.getDate() + 1)
      endDate.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0)
      return endDate
    }
    // End is today (or after-midnight portion)
    const endDate = new Date(_now)
    endDate.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0)
    return endDate
  }

  return null
}
