// Location Settings — Validators
// Split from src/lib/settings.ts for maintainability

import type { PricingRule } from './types'

/** Parse "HH:MM" to total minutes since midnight */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * Validate a pricing rule. Returns array of error messages (empty = valid).
 */
export function validatePricingRule(rule: PricingRule): string[] {
  const errors: string[] = []

  // Name
  if (!rule.name || rule.name.trim().length === 0) {
    errors.push('Name is required')
  } else if (rule.name.length > 50) {
    errors.push('Name must be 50 characters or less')
  } else if (/<[^>]*>/.test(rule.name)) {
    errors.push('Name must not contain HTML tags')
  }

  // Color
  if (!rule.color || !/^#[0-9a-fA-F]{6}$/.test(rule.color)) {
    errors.push('Color must be a valid hex color (#XXXXXX)')
  }

  // Type-specific schedule validation
  if (rule.type === 'recurring') {
    if (!rule.schedules || rule.schedules.length === 0) {
      errors.push('Recurring rules must have at least one schedule')
    } else {
      for (let i = 0; i < rule.schedules.length; i++) {
        const s = rule.schedules[i]
        if (!s.dayOfWeek || s.dayOfWeek.length === 0) {
          errors.push(`Schedule ${i + 1} must have at least one day selected`)
        }
        if (s.startTime === s.endTime) {
          errors.push(`Schedule ${i + 1} has identical start and end times (zero-length window)`)
        }
      }
    }
  } else if (rule.type === 'one-time') {
    if (!rule.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(rule.startDate)) {
      errors.push('One-time rules require a start date (YYYY-MM-DD)')
    }
    if (!rule.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(rule.endDate)) {
      errors.push('One-time rules require an end date (YYYY-MM-DD)')
    }
    if (rule.startDate && rule.endDate && rule.endDate < rule.startDate) {
      errors.push('End date must be on or after start date')
    }
    if (!rule.startTime) errors.push('One-time rules require a start time')
    if (!rule.endTime) errors.push('One-time rules require an end time')
    if (rule.startTime && rule.endTime && rule.startTime === rule.endTime) {
      errors.push('Start time and end time cannot be identical (zero-length window)')
    }
  } else if (rule.type === 'yearly-recurring') {
    if (!rule.startDate || !/^\d{2}-\d{2}$/.test(rule.startDate)) {
      errors.push('Yearly-recurring rules require a start date (MM-DD)')
    }
    if (!rule.endDate || !/^\d{2}-\d{2}$/.test(rule.endDate)) {
      errors.push('Yearly-recurring rules require an end date (MM-DD)')
    }
    // Allow end < start for year-wrap (e.g., Dec 30 - Jan 2)
    if (!rule.startTime) errors.push('Yearly-recurring rules require a start time')
    if (!rule.endTime) errors.push('Yearly-recurring rules require an end time')
    if (rule.startTime && rule.endTime && rule.startTime === rule.endTime) {
      errors.push('Start time and end time cannot be identical (zero-length window)')
    }
  }

  // Adjustment value — guard against NaN/Infinity
  if (!isFinite(rule.adjustmentValue)) {
    errors.push('Adjustment value must be a finite number')
  }
  if (!isFinite(rule.priority)) {
    errors.push('Priority must be a finite number')
  }
  if (rule.adjustmentType === 'override-price') {
    if (rule.adjustmentValue < 0) {
      errors.push('Override price must be >= 0')
    }
  } else if (rule.adjustmentType === 'percent-off' || rule.adjustmentType === 'percent-increase') {
    if (rule.adjustmentValue <= 0) {
      errors.push('Percent adjustment must be > 0')
    }
    if (rule.adjustmentValue > 100) {
      errors.push('Percent adjustment must be <= 100')
    }
  } else if (rule.adjustmentType === 'fixed-off' || rule.adjustmentType === 'fixed-increase') {
    if (rule.adjustmentValue <= 0) {
      errors.push('Fixed adjustment must be > 0')
    }
  }

  // Scope
  if (rule.appliesTo === 'categories') {
    if (!rule.categoryIds || rule.categoryIds.length === 0) {
      errors.push('At least one category must be selected')
    }
  } else if (rule.appliesTo === 'items') {
    if (!rule.itemIds || rule.itemIds.length === 0) {
      errors.push('At least one item must be selected')
    }
  } else if (rule.appliesTo === 'all') {
    if (rule.categoryIds?.length > 0 || rule.itemIds?.length > 0) {
      errors.push('Scope "all" must not have category or item selections')
    }
  }

  // Optional field length limits
  if (rule.badgeText && rule.badgeText.length > 20) {
    errors.push('Badge text must be 20 characters or less')
  }
  if (rule.description && rule.description.length > 200) {
    errors.push('Description must be 200 characters or less')
  }

  return errors
}

/**
 * Check for overlapping pricing rules. Only enabled rules participate.
 * Returns overlap diagnostics with severity levels.
 */
export function checkPricingRuleOverlaps(rules: PricingRule[]): Array<{
  ruleA: PricingRule
  ruleB: PricingRule
  severity: 'info' | 'warning' | 'error'
  description: string
}> {
  const enabled = rules.filter(r => r.enabled)
  const results: Array<{ ruleA: PricingRule; ruleB: PricingRule; severity: 'info' | 'warning' | 'error'; description: string }> = []

  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const a = enabled[i]
      const b = enabled[j]

      // Check time overlap
      if (!hasTimeOverlap(a, b)) continue

      // Check scope overlap
      if (!hasScopeOverlap(a, b)) continue

      // Determine severity
      const samePriority = a.priority === b.priority
      const sameScopeType = a.appliesTo === b.appliesTo

      if (samePriority && sameScopeType) {
        results.push({
          ruleA: a,
          ruleB: b,
          severity: 'error',
          description: `"${a.name}" and "${b.name}" have the same priority (${a.priority}), same scope type (${a.appliesTo}), and overlapping time/items — unpredictable winner`,
        })
      } else if (samePriority) {
        results.push({
          ruleA: a,
          ruleB: b,
          severity: 'warning',
          description: `"${a.name}" and "${b.name}" have the same priority (${a.priority}) but different scope types — specificity will determine winner`,
        })
      } else {
        results.push({
          ruleA: a,
          ruleB: b,
          severity: 'info',
          description: `"${a.name}" (priority ${a.priority}) and "${b.name}" (priority ${b.priority}) overlap but priority ordering is clear`,
        })
      }
    }
  }

  return results
}

/** Check if two rules have overlapping time windows */
function hasTimeOverlap(a: PricingRule, b: PricingRule): boolean {
  // For recurring rules, check schedule day+time overlap
  if (a.type === 'recurring' && b.type === 'recurring') {
    for (const sa of a.schedules) {
      for (const sb of b.schedules) {
        // Check shared days
        const sharedDays = sa.dayOfWeek.filter(d => sb.dayOfWeek.includes(d))
        if (sharedDays.length === 0) continue
        // Check time window overlap
        if (timeWindowsOverlap(
          parseTimeToMinutes(sa.startTime), parseTimeToMinutes(sa.endTime),
          parseTimeToMinutes(sb.startTime), parseTimeToMinutes(sb.endTime)
        )) return true
      }
    }
    return false
  }
  // Simplification: for mixed types or date-based, assume overlap if any time windows overlap
  // This is conservative — better to warn than miss
  return true
}

/** Check if two time windows (possibly cross-midnight) overlap */
function timeWindowsOverlap(s1: number, e1: number, s2: number, e2: number): boolean {
  // Convert to linear ranges. Cross-midnight extends past 1440.
  const ranges1 = e1 <= s1 ? [[s1, 1440], [0, e1]] : [[s1, e1]]
  const ranges2 = e2 <= s2 ? [[s2, 1440], [0, e2]] : [[s2, e2]]

  for (const [a0, a1] of ranges1) {
    for (const [b0, b1] of ranges2) {
      if (a0 < b1 && b0 < a1) return true
    }
  }
  return false
}

/** Check if two rules have overlapping scope (could affect same items) */
function hasScopeOverlap(a: PricingRule, b: PricingRule): boolean {
  // 'all' overlaps with everything
  if (a.appliesTo === 'all' || b.appliesTo === 'all') return true

  // Both items — check intersection (guard against null/undefined arrays)
  if (a.appliesTo === 'items' && b.appliesTo === 'items') {
    if (!Array.isArray(a.itemIds) || !Array.isArray(b.itemIds)) return false
    return a.itemIds.some(id => b.itemIds.includes(id))
  }
  // Both categories — check intersection (guard against null/undefined arrays)
  if (a.appliesTo === 'categories' && b.appliesTo === 'categories') {
    if (!Array.isArray(a.categoryIds) || !Array.isArray(b.categoryIds)) return false
    return a.categoryIds.some(id => b.categoryIds.includes(id))
  }
  // Mixed items/categories — conservative: assume overlap (items could be in those categories)
  return true
}
