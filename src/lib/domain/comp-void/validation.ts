/**
 * Comp/Void Validation — PURE + ORCHESTRATION
 *
 * Validates whether a comp or void can proceed.
 * No NextRequest/NextResponse. DB access only via TxClient param.
 */

import { isModifiable } from '@/lib/domain/order-status'
import { exceedsThreshold } from './calculations'
import { resolveAllowedReasonIds } from '@/lib/settings/reason-access'
import type {
  ValidationError,
  OrderForValidation,
  ItemForValidation,
  ApprovalSettings,
  SecuritySettings,
  TxClient,
} from './types'

// ─── Order-Level Checks (pure) ──────────────────────────────────────────────

/**
 * Validate that the order is in a state that allows comp/void.
 * Returns null if valid, or a ValidationError if blocked.
 */
export function validateOrderForCompVoid(
  order: OrderForValidation,
): ValidationError | null {
  // Block modifications if any completed payment exists
  const hasCompletedPayment = order.payments?.some(p => p.status === 'completed') || false
  if (hasCompletedPayment) {
    return {
      error: 'Cannot void/comp item on order with recorded payments. Void the payment first.',
      status: 400,
    }
  }

  if (!isModifiable(order.status)) {
    return {
      error: `Cannot comp/void items on order in '${order.status}' status`,
      status: 400,
    }
  }

  return null
}

/**
 * Validate version for optimistic concurrency control.
 */
export function validateVersion(
  orderVersion: number,
  clientVersion: number | undefined,
): ValidationError | null {
  if (clientVersion != null && orderVersion !== clientVersion) {
    return {
      error: 'Order was modified on another terminal',
      status: 409,
    }
  }
  return null
}

// ─── Item-Level Checks (pure) ───────────────────────────────────────────────

/**
 * Validate that the item exists and is in a compable/voidable state.
 */
export function validateItemForCompVoid(
  item: ItemForValidation | undefined,
): ValidationError | null {
  if (!item) {
    return { error: 'Item not found on this order', status: 404 }
  }
  if (item.status !== 'active') {
    return { error: `Item is already ${item.status}`, status: 400 }
  }
  return null
}

/**
 * V1 FRAUD FIX: Check if item was already sent to kitchen.
 * If sent, require manager approval regardless of threshold and default wasMade=true.
 * Returns { requiresApproval, wasMadeDefault } or a ValidationError if blocked.
 */
export function validateSentItemVoid(
  item: { kitchenStatus?: string; kitchenSentAt?: Date | null },
  hasApprovedById: boolean,
  hasRemoteApprovalCode: boolean,
  wasMadeProvided: boolean | undefined,
): { requiresApproval: boolean; wasMadeDefault: boolean; error: ValidationError | null } {
  const wasSentToKitchen =
    (item.kitchenStatus && item.kitchenStatus !== 'pending') ||
    item.kitchenSentAt != null

  if (!wasSentToKitchen) {
    return { requiresApproval: false, wasMadeDefault: false, error: null }
  }

  // Item was sent to kitchen — food was likely made
  console.warn('[CompVoid] WARNING: Void on sent item requires manager approval — kitchenStatus=%s, kitchenSentAt=%s',
    item.kitchenStatus, item.kitchenSentAt)

  // Require manager approval regardless of amount threshold
  if (!hasApprovedById && !hasRemoteApprovalCode) {
    return {
      requiresApproval: true,
      wasMadeDefault: true,
      error: {
        error: 'Manager approval required — item was already sent to kitchen',
        status: 403,
        requiresApproval: true,
      },
    }
  }

  // If wasMade was not explicitly provided, default to true (food was made if already sent)
  const wasMadeDefault = wasMadeProvided === undefined ? true : false

  return { requiresApproval: true, wasMadeDefault, error: null }
}

/**
 * Validate that the item exists and is in a restorable state (voided/comped).
 */
export function validateItemForRestore(
  item: ItemForValidation | undefined,
): ValidationError | null {
  if (!item) {
    return { error: 'Item not found', status: 404 }
  }
  if (item.status === 'active') {
    return { error: 'Item is already active', status: 400 }
  }
  return null
}

// ─── Approval Checks (pure) ─────────────────────────────────────────────────

/**
 * W4-1: Check if void requires manager approval based on settings and thresholds.
 */
export function validateVoidApproval(
  itemTotal: number,
  approvalSettings: ApprovalSettings,
  hasApprovedById: boolean,
  hasRemoteApprovalCode: boolean,
): ValidationError | null {
  if (!approvalSettings.requireVoidApproval) return null

  const needsApproval = exceedsThreshold(itemTotal, approvalSettings.voidApprovalThreshold)
  if (needsApproval && !hasApprovedById && !hasRemoteApprovalCode) {
    return {
      error: 'Manager approval required for void',
      status: 403,
      requiresApproval: true,
    }
  }

  return null
}

/**
 * W5-11: Check if void requires 2FA (remote SMS approval) for large amounts.
 */
export function validateVoid2FA(
  itemTotal: number,
  securitySettings: SecuritySettings,
  hasRemoteApprovalCode: boolean,
): ValidationError | null {
  if (!securitySettings.require2FAForLargeVoids) return null

  if (exceedsThreshold(itemTotal, securitySettings.void2FAThreshold) && !hasRemoteApprovalCode) {
    return {
      error: `Remote manager approval required for void over $${securitySettings.void2FAThreshold}`,
      status: 403,
      requiresRemoteApproval: true,
    }
  }

  return null
}

// ─── Split Parent Guard (orchestration) ─────────────────────────────────────

/**
 * Guard: cannot void/comp on a split parent with unpaid children.
 */
export async function validateSplitParent(
  tx: TxClient,
  order: OrderForValidation,
): Promise<ValidationError | null> {
  if (order.status !== 'split') return null

  const unpaidChildren = await (tx as any).order.count({
    where: {
      parentOrderId: order.id,
      status: { notIn: ['paid', 'closed', 'voided', 'cancelled'] },
      deletedAt: null,
    },
  })

  if (unpaidChildren > 0) {
    return {
      error: `Cannot void split parent with ${unpaidChildren} unpaid split children. Void or pay children first.`,
      status: 400,
    }
  }

  return null
}

// ─── Remote Approval Validation (orchestration) ─────────────────────────────

export interface RemoteApprovalRecord {
  id: string
  orderItemId: string | null
  approvedAt: Date | null
  manager: { id: string; displayName: string | null; firstName: string | null; lastName: string | null }
}

/**
 * Validate a remote approval code if provided.
 * Returns the approval record or null if no code was given.
 * Throws ValidationError via return if code is invalid.
 */
export async function validateRemoteApproval(
  tx: TxClient,
  remoteApprovalCode: string | undefined,
  orderId: string,
  itemId: string,
): Promise<{ approval: RemoteApprovalRecord | null; error: ValidationError | null }> {
  if (!remoteApprovalCode) return { approval: null, error: null }

  const approval = await (tx as any).remoteVoidApproval.findFirst({
    where: {
      approvalCode: remoteApprovalCode,
      status: 'approved',
      orderId,
      approvalCodeExpiry: { gt: new Date() },
    },
    include: {
      manager: {
        select: { id: true, displayName: true, firstName: true, lastName: true },
      },
    },
  })

  if (!approval) {
    return {
      approval: null,
      error: { error: 'Invalid or expired approval code', status: 400 },
    }
  }

  if (approval.orderItemId && approval.orderItemId !== itemId) {
    return {
      approval: null,
      error: { error: 'Approval code is for a different item', status: 400 },
    }
  }

  return { approval, error: null }
}

// ─── Reason Preset Validation (orchestration) ───────────────────────────────

/**
 * Validate reason against configured presets.
 * Backward compatible: if no presets are configured, any reason is accepted.
 */
export async function validateReasonPreset(
  tx: TxClient,
  action: 'comp' | 'void',
  reason: string,
  locationId: string,
  employeeId: string,
): Promise<ValidationError | null> {
  const reasonPresets = action === 'void'
    ? await (tx as any).voidReason.findMany({ where: { locationId, isActive: true, deletedAt: null }, select: { id: true, name: true } })
    : await (tx as any).compReason.findMany({ where: { locationId, isActive: true, deletedAt: null }, select: { id: true, name: true } })

  if (reasonPresets.length === 0) return null

  const reasonMatch = reasonPresets.find(
    (r: { id: string; name: string }) => r.id === reason || r.name.toLowerCase() === reason.toLowerCase()
  )
  if (!reasonMatch) {
    return {
      error: `Invalid ${action} reason. Must be one of the configured presets.`,
      status: 400,
    }
  }

  // Check employee access rules (only if access rules exist for this reason type)
  const reasonType = action === 'comp' ? 'comp_reason' : 'void_reason'
  const { ids: allowedIds, hasRules } = await resolveAllowedReasonIds(locationId, employeeId, reasonType)
  if (hasRules && !allowedIds.includes(reasonMatch.id)) {
    return {
      error: `You do not have access to use this ${action} reason`,
      status: 403,
    }
  }

  return null
}
