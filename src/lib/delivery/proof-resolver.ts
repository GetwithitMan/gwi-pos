/**
 * Proof of Delivery Resolver
 *
 * Evaluates the effective proof mode for a delivery order based on:
 * 1. Venue baseline setting (proofOfDeliveryMode)
 * 2. Policy escalation conditions (can only ADD capabilities, never remove)
 *
 * Result is frozen on DeliveryOrder.proofMode at dispatch time.
 */

export interface ProofRequirements {
  requiresPhoto: boolean
  requiresSignature: boolean
}

export type ProofMode = 'none' | 'photo' | 'signature' | 'photo_and_signature'

interface ProofEvaluationContext {
  // From venue settings
  baselineMode: ProofMode

  // From dispatch policy
  proofRequiredForFlaggedCustomers: boolean
  proofRequiredForCashOrders: boolean
  proofRequiredAboveAmount: number
  proofRequiredForAlcohol: boolean
  proofRequiredForApartments: boolean

  // From order context
  orderTotal: number
  isCashOrder: boolean
  isCustomerFlagged: boolean
  containsAlcohol: boolean
  isApartment: boolean
}

function parseProofMode(mode: ProofMode): ProofRequirements {
  switch (mode) {
    case 'none': return { requiresPhoto: false, requiresSignature: false }
    case 'photo': return { requiresPhoto: true, requiresSignature: false }
    case 'signature': return { requiresPhoto: false, requiresSignature: true }
    case 'photo_and_signature': return { requiresPhoto: true, requiresSignature: true }
    default: return { requiresPhoto: false, requiresSignature: false }
  }
}

function toProofMode(reqs: ProofRequirements): ProofMode {
  if (reqs.requiresPhoto && reqs.requiresSignature) return 'photo_and_signature'
  if (reqs.requiresPhoto) return 'photo'
  if (reqs.requiresSignature) return 'signature'
  return 'none'
}

/**
 * Evaluate the effective proof mode for a delivery order.
 * Can only escalate (add capabilities), never reduce.
 *
 * @returns ProofMode string to store on DeliveryOrder.proofMode
 */
export function evaluateEffectiveProofMode(ctx: ProofEvaluationContext): ProofMode {
  // 1. Start with baseline
  const result = parseProofMode(ctx.baselineMode)

  // 2. Scan escalation conditions (can only ADD, never remove)

  // Alcohol requires both photo AND signature (age verification)
  if (ctx.proofRequiredForAlcohol && ctx.containsAlcohol) {
    result.requiresPhoto = true
    result.requiresSignature = true
  }

  // High-value orders require photo
  if (ctx.proofRequiredAboveAmount > 0 && ctx.orderTotal > ctx.proofRequiredAboveAmount) {
    result.requiresPhoto = true
  }

  // Flagged customers require photo
  if (ctx.proofRequiredForFlaggedCustomers && ctx.isCustomerFlagged) {
    result.requiresPhoto = true
  }

  // Cash orders require photo
  if (ctx.proofRequiredForCashOrders && ctx.isCashOrder) {
    result.requiresPhoto = true
  }

  // Apartments require photo
  if (ctx.proofRequiredForApartments && ctx.isApartment) {
    result.requiresPhoto = true
  }

  // 3. Return as mode string
  return toProofMode(result)
}

/**
 * Check if proof is required for this mode.
 * Derived: proofRequired = proofMode !== 'none'
 */
export function isProofRequired(proofMode: ProofMode): boolean {
  return proofMode !== 'none'
}

/**
 * Validate that uploaded proof satisfies the required mode.
 */
export function validateProofSatisfied(
  proofMode: ProofMode,
  uploadedProofs: { type: 'photo' | 'signature' }[]
): { satisfied: boolean; missing: string[] } {
  const required = parseProofMode(proofMode)
  const missing: string[] = []

  if (required.requiresPhoto && !uploadedProofs.some(p => p.type === 'photo')) {
    missing.push('photo')
  }
  if (required.requiresSignature && !uploadedProofs.some(p => p.type === 'signature')) {
    missing.push('signature')
  }

  return { satisfied: missing.length === 0, missing }
}
