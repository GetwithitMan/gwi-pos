/**
 * Dispatch Policy Engine
 *
 * Evaluates venue dispatch rules to determine if an operation is allowed.
 * Returns structured allow/deny results with reasons for UI display.
 */

// The dispatch policy shape from settings
interface DispatchPolicy {
  assignmentStrategy: 'manual' | 'round_robin' | 'least_loaded' | 'zone_affinity'
  driverAcceptanceRequired: boolean
  cashOnDeliveryAllowed: boolean
  requirePrepaymentAboveAmount: number
  maxLateThresholdMinutes: number
  maxCashBeforeForcedDrop: number
  maxOrdersPerDriverByTimeOfDay: { peak: number; offPeak: number }
  blockDispatchWithoutValidZone: boolean
  voidAfterDispatchRequiresManager: boolean
  cashShortageApprovalRequired: boolean
  proofRequiredForFlaggedCustomers: boolean
  proofRequiredForCashOrders: boolean
  proofRequiredAboveAmount: number
  proofRequiredForAlcohol: boolean
  proofRequiredForApartments: boolean
  driverCannotEndShiftWithOpenRun: boolean
  cannotDispatchSuspendedWithoutOverride: boolean
  cannotMarkDeliveredWithoutRequiredProof: boolean
  holdReadyUntilAllItemsComplete: boolean
}

export interface PolicyCheckResult {
  allowed: boolean
  reason?: string
  requiresOverride?: boolean  // true = can be bypassed with delivery.policy_override permission
}

// ── Dispatch Checks ──

export function canDispatchOrder(
  policy: DispatchPolicy,
  order: { zoneId?: string | null; status: string },
): PolicyCheckResult {
  if (policy.blockDispatchWithoutValidZone && !order.zoneId) {
    return {
      allowed: false,
      reason: 'Order has no valid delivery zone assigned. Assign a zone or use manual pin-drop override.',
      requiresOverride: true,
    }
  }
  return { allowed: true }
}

export function canAssignDriver(
  policy: DispatchPolicy,
  driver: { isSuspended: boolean; isActive: boolean },
): PolicyCheckResult {
  if (!driver.isActive) {
    return { allowed: false, reason: 'Driver profile is inactive.' }
  }
  if (driver.isSuspended && policy.cannotDispatchSuspendedWithoutOverride) {
    return {
      allowed: false,
      reason: 'Driver is suspended. Policy requires override to dispatch to suspended drivers.',
      requiresOverride: true,
    }
  }
  return { allowed: true }
}

export function canEndDriverShift(
  policy: DispatchPolicy,
  hasOpenRun: boolean,
): PolicyCheckResult {
  if (policy.driverCannotEndShiftWithOpenRun && hasOpenRun) {
    return {
      allowed: false,
      reason: 'Driver has an open delivery run. Complete or cancel the run before ending shift.',
    }
  }
  return { allowed: true }
}

export async function canMarkDelivered(
  policy: DispatchPolicy,
  proofMode: string,
  uploadedProofs: { type: 'photo' | 'signature' }[],
): Promise<PolicyCheckResult> {
  if (!policy.cannotMarkDeliveredWithoutRequiredProof) {
    return { allowed: true }
  }

  // Import proof validation inline to avoid circular deps
  const { validateProofSatisfied } = await import('./proof-resolver')
  const { satisfied, missing } = validateProofSatisfied(proofMode as any, uploadedProofs)

  if (!satisfied) {
    return {
      allowed: false,
      reason: `Proof of delivery required: ${missing.join(', ')}. Upload before marking delivered.`,
      requiresOverride: true,
    }
  }
  return { allowed: true }
}

export function canAcceptCashOrder(
  policy: DispatchPolicy,
  orderTotal: number,
): PolicyCheckResult {
  if (!policy.cashOnDeliveryAllowed) {
    return {
      allowed: false,
      reason: 'Cash on delivery is not allowed. Order must be prepaid.',
    }
  }
  if (policy.requirePrepaymentAboveAmount > 0 && orderTotal > policy.requirePrepaymentAboveAmount) {
    return {
      allowed: false,
      reason: `Orders above $${policy.requirePrepaymentAboveAmount.toFixed(2)} must be prepaid.`,
    }
  }
  return { allowed: true }
}

export function canVoidAfterDispatch(
  policy: DispatchPolicy,
  hasManagerPermission: boolean,
): PolicyCheckResult {
  if (policy.voidAfterDispatchRequiresManager && !hasManagerPermission) {
    return {
      allowed: false,
      reason: 'Voiding after dispatch requires manager approval.',
    }
  }
  return { allowed: true }
}

export function shouldForceCashDrop(
  policy: DispatchPolicy,
  cashCollectedCents: number,
): boolean {
  const thresholdCents = policy.maxCashBeforeForcedDrop * 100
  return cashCollectedCents >= thresholdCents
}

export function requiresCashShortageApproval(
  policy: DispatchPolicy,
  varianceCents: number,
): boolean {
  // > $50 variance ALWAYS requires approval (non-overridable safety net)
  if (Math.abs(varianceCents) > 5000) return true
  // Policy-configured check
  return policy.cashShortageApprovalRequired && varianceCents < 0
}

// ── Peak Hours Evaluation ──

/**
 * Check if current time is within peak hours.
 * Evaluated in venue local timezone.
 */
export function isPeakHour(
  peakHours: { start: string; end: string }[],
  timezone: string,
  now?: Date,
): boolean {
  if (!peakHours.length) return false

  const currentTime = now || new Date()
  // Format current time in venue timezone as HH:MM
  const timeStr = currentTime.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })

  return peakHours.some(({ start, end }) => {
    if (start <= end) {
      // Normal range (e.g., 11:00 - 14:00)
      return timeStr >= start && timeStr <= end
    } else {
      // Cross-midnight (e.g., 22:00 - 02:00)
      return timeStr >= start || timeStr <= end
    }
  })
}

/**
 * Get max orders per driver based on current peak/off-peak status.
 */
export function getMaxOrdersPerDriver(
  policy: DispatchPolicy,
  peakHours: { start: string; end: string }[],
  timezone: string,
): number {
  const peak = isPeakHour(peakHours, timezone)
  return peak ? policy.maxOrdersPerDriverByTimeOfDay.peak : policy.maxOrdersPerDriverByTimeOfDay.offPeak
}

// ── Auto-Suggest Scoring (v1: fixed weights) ──

interface DriverCandidate {
  driverId: string
  driverName: string
  activeOrderCount: number
  zoneMatch: boolean
  minutesSinceLastRun: number
}

interface SuggestionResult {
  driverId: string
  driverName: string
  score: number
  reason: string
  estimatedPickupMinutes: number
}

const LOAD_WEIGHT = 30
const ZONE_WEIGHT = 25
const ROTATION_WEIGHT = 20

export function suggestDrivers(
  candidates: DriverCandidate[],
  maxOrdersPerDriver: number,
): SuggestionResult[] {
  return candidates
    .filter(c => c.activeOrderCount < maxOrdersPerDriver)
    .map(candidate => {
      // Lower load = higher score (inverse)
      const loadScore = LOAD_WEIGHT * (1 - candidate.activeOrderCount / Math.max(maxOrdersPerDriver, 1))
      // Zone match = full points
      const zoneScore = candidate.zoneMatch ? ZONE_WEIGHT : 0
      // Longer since last run = higher score (rotation fairness), cap at 60 min
      const rotationScore = ROTATION_WEIGHT * Math.min(candidate.minutesSinceLastRun / 60, 1)

      const totalScore = Math.round(loadScore + zoneScore + rotationScore)

      const reasons: string[] = []
      if (candidate.zoneMatch) reasons.push('zone match')
      if (candidate.activeOrderCount === 0) reasons.push('no active orders')
      else reasons.push(`${candidate.activeOrderCount} active`)
      if (candidate.minutesSinceLastRun > 30) reasons.push('longest idle')

      return {
        driverId: candidate.driverId,
        driverName: candidate.driverName,
        score: totalScore,
        reason: reasons.join(', '),
        estimatedPickupMinutes: 5, // v1: fixed estimate, Phase 2: actual calculation
      }
    })
    .sort((a, b) => b.score - a.score)
}
