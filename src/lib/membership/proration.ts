/**
 * Membership proration calculations.
 * Handles mid-cycle plan changes, signup alignment, and trial conversions.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface MidCycleProration {
  creditAmount: number
  chargeAmount: number
  netAmount: number
  daysRemaining: number
  totalDays: number
}

interface SignupProration {
  proratedAmount: number
  periodStart: Date
  periodEnd: Date
  nextFullBillingDate: Date
}

// ─── Mid-Cycle Plan Change ──────────────────────────────────────────────────

export function calculateProration(params: {
  currentPrice: number
  newPrice: number
  currentPeriodStart: Date
  currentPeriodEnd: Date
  effectiveDate: Date
}): MidCycleProration {
  const { currentPrice, newPrice, currentPeriodStart, currentPeriodEnd, effectiveDate } = params

  const totalDays = daysBetween(currentPeriodStart, currentPeriodEnd)
  const daysRemaining = daysBetween(effectiveDate, currentPeriodEnd)

  if (totalDays <= 0) {
    return { creditAmount: 0, chargeAmount: 0, netAmount: 0, daysRemaining: 0, totalDays: 0 }
  }

  const ratio = daysRemaining / totalDays
  const creditAmount = roundCents(currentPrice * ratio)
  const chargeAmount = roundCents(newPrice * ratio)
  const netAmount = roundCents(chargeAmount - creditAmount)

  return { creditAmount, chargeAmount, netAmount, daysRemaining, totalDays }
}

// ─── Signup Proration (first period alignment) ──────────────────────────────

export function calculateSignupProration(params: {
  price: number
  billingCycle: string
  signupDate: Date
  billingDayOfMonth?: number | null
  billingDayOfWeek?: number | null
}): SignupProration {
  const { price, billingCycle, signupDate, billingDayOfMonth, billingDayOfWeek } = params

  const periodStart = new Date(signupDate)
  const nextFullBillingDate = getNextBillingDate(billingCycle, billingDayOfMonth, billingDayOfWeek, signupDate)
  const periodEnd = new Date(nextFullBillingDate)

  // If signup is on the billing date, no proration needed — charge full price
  if (daysBetween(periodStart, periodEnd) <= 1) {
    const fullEnd = advanceCycle(periodStart, billingCycle)
    return {
      proratedAmount: price,
      periodStart,
      periodEnd: fullEnd,
      nextFullBillingDate: fullEnd,
    }
  }

  // Full cycle length for ratio calculation
  const fullCycleStart = retreatCycle(nextFullBillingDate, billingCycle)
  const fullCycleDays = daysBetween(fullCycleStart, nextFullBillingDate)
  const partialDays = daysBetween(periodStart, periodEnd)

  const proratedAmount = fullCycleDays > 0
    ? roundCents(price * (partialDays / fullCycleDays))
    : price

  return { proratedAmount, periodStart, periodEnd, nextFullBillingDate }
}

// ─── Trial Conversion Proration ─────────────────────────────────────────────

export function calculateTrialConversionProration(params: {
  price: number
  billingCycle: string
  trialEndsAt: Date
  billingDayOfMonth?: number | null
  billingDayOfWeek?: number | null
}): SignupProration {
  // Trial conversion uses the same logic as signup proration,
  // with trialEndsAt as the effective signup date
  return calculateSignupProration({
    price: params.price,
    billingCycle: params.billingCycle,
    signupDate: params.trialEndsAt,
    billingDayOfMonth: params.billingDayOfMonth,
    billingDayOfWeek: params.billingDayOfWeek,
  })
}

// ─── Next Billing Date Calculator ───────────────────────────────────────────

export function getNextBillingDate(
  billingCycle: string,
  billingDayOfMonth?: number | null,
  billingDayOfWeek?: number | null,
  fromDate?: Date
): Date {
  const from = fromDate ? new Date(fromDate) : new Date()

  if (billingCycle === 'weekly') {
    // billingDayOfWeek: 0 = Sunday, 6 = Saturday
    const targetDay = billingDayOfWeek ?? 1 // Default Monday
    const currentDay = from.getDay()
    let daysUntil = targetDay - currentDay
    if (daysUntil <= 0) daysUntil += 7
    const next = new Date(from)
    next.setDate(next.getDate() + daysUntil)
    return startOfDay(next)
  }

  if (billingCycle === 'annual') {
    // Advance to same day next year, anchored to billingDayOfMonth
    const targetDay = Math.min(billingDayOfMonth ?? from.getDate(), 28) // Cap at 28 for safety
    const next = new Date(from)
    next.setFullYear(next.getFullYear() + 1)
    next.setDate(targetDay)
    return startOfDay(next)
  }

  // Monthly (default)
  const targetDay = Math.min(billingDayOfMonth ?? from.getDate(), 28) // Cap at 28 for safety
  const next = new Date(from)
  next.setMonth(next.getMonth() + 1)
  next.setDate(targetDay)

  // If we're past the target day this month, go to next month
  if (from.getDate() >= targetDay) {
    return startOfDay(next)
  }

  // Otherwise, use this month's target day
  const thisMonth = new Date(from)
  thisMonth.setDate(targetDay)
  return startOfDay(thisMonth)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400000
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay))
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100
}

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function advanceCycle(from: Date, billingCycle: string): Date {
  const d = new Date(from)
  switch (billingCycle) {
    case 'weekly':
      d.setDate(d.getDate() + 7)
      break
    case 'annual':
      d.setFullYear(d.getFullYear() + 1)
      break
    case 'monthly':
    default:
      d.setMonth(d.getMonth() + 1)
      break
  }
  return d
}

function retreatCycle(from: Date, billingCycle: string): Date {
  const d = new Date(from)
  switch (billingCycle) {
    case 'weekly':
      d.setDate(d.getDate() - 7)
      break
    case 'annual':
      d.setFullYear(d.getFullYear() - 1)
      break
    case 'monthly':
    default:
      d.setMonth(d.getMonth() - 1)
      break
  }
  return d
}
