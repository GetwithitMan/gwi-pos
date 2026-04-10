/**
 * Cellular Terminal Validation
 *
 * Route-level checks for cellular terminals beyond the proxy allowlist.
 * Validates employee binding, re-auth requirements, token capabilities,
 * and ownership gating (preventing cellular mutation of locally-owned orders).
 *
 * The proxy allowlist (route-policies.ts) controls WHICH routes cellular
 * terminals can access. This module validates HOW they access those routes:
 *   - Employee impersonation prevention (bound employee must match claimed)
 *   - Manager re-auth enforcement for sensitive actions (void, comp)
 *   - Refund capability gating (CELLULAR_ROAMING can never refund)
 *   - Ownership gating (cellular cannot mutate locally-owned orders)
 */

import { type NextRequest } from 'next/server'
import { compare } from 'bcryptjs'
import { type AuthContext } from './api-auth-middleware'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cellular-validation')

// ═══════════════════════════════════════════════════════════
// Error class
// ═══════════════════════════════════════════════════════════

export class CellularAuthError extends Error {
  status: number
  constructor(message: string, status: number = 403) {
    super(message)
    this.name = 'CellularAuthError'
    this.status = status
  }
}

// ═══════════════════════════════════════════════════════════
// Employee binding validation
// ═══════════════════════════════════════════════════════════

/**
 * Validate that a cellular terminal's claimed employeeId matches its bound employee.
 * Returns the validated employeeId or throws CellularAuthError.
 *
 * For non-cellular requests, this is a pass-through (LAN terminals handle
 * auth via session cookies).
 *
 * For cellular requests:
 *   - If the token has a bound employee AND the request claims a different one, reject.
 *   - If the token has a bound employee, use it (even if the request doesn't claim one).
 *   - If no bound employee, allow the claimed one (backward compat for pre-binding tokens).
 */
export function validateCellularEmployee(
  auth: AuthContext,
  claimedEmployeeId: string | undefined
): string {
  if (auth.source !== 'cellular') {
    // Not cellular -- pass through (LAN terminals handle auth via session)
    return claimedEmployeeId || auth.employeeId || ''
  }

  // Cellular terminal: if token has a bound employee, enforce it
  const boundEmployeeId = auth.cellularEmployeeId
  if (boundEmployeeId && claimedEmployeeId && claimedEmployeeId !== boundEmployeeId) {
    throw new CellularAuthError(
      `Employee mismatch: terminal bound to ${boundEmployeeId}, request claims ${claimedEmployeeId}`,
      403
    )
  }

  return boundEmployeeId || claimedEmployeeId || ''
}

// ═══════════════════════════════════════════════════════════
// Manager re-auth validation
// ═══════════════════════════════════════════════════════════

/**
 * Validate that a sensitive action has proper manager re-authentication.
 * For cellular terminals, the manager must have authenticated on-device
 * (PIN verification). This function validates the required fields are present;
 * actual PIN hash verification is done at the route level.
 *
 * For non-cellular requests, this is a no-op (LAN handles re-auth via UI).
 */
export function validateManagerReauth(
  auth: AuthContext,
  managerId: string | undefined,
  managerPinHash: string | undefined
): void {
  if (auth.source !== 'cellular') return // LAN handles this via UI

  if (!managerId) {
    throw new CellularAuthError(
      'Manager approval required for this action on cellular terminal',
      403
    )
  }

  if (!managerPinHash) {
    throw new CellularAuthError(
      'Manager PIN verification required for cellular terminal actions',
      403
    )
  }

  // The route must verify the PIN hash against the manager's stored PIN.
  // This function validates that the fields are present -- actual hash
  // comparison is the route's responsibility.
}

// ═══════════════════════════════════════════════════════════
// Refund capability validation
// ═══════════════════════════════════════════════════════════

/**
 * Check if the cellular terminal's token allows refunds.
 * CELLULAR_ROAMING terminals have canRefund=false hardcoded in issueCellularToken().
 *
 * For non-cellular requests, this is a no-op.
 */
export function validateCellularRefund(auth: AuthContext): void {
  if (auth.source !== 'cellular') return

  const canRefund = auth.canRefund
  if (canRefund === false) {
    throw new CellularAuthError(
      'This terminal is not authorized for refunds',
      403
    )
  }
}

// ═══════════════════════════════════════════════════════════
// Header-based helpers (for routes using withVenue, not withAuth)
// ═══════════════════════════════════════════════════════════

/**
 * Check if a request originates from a cellular terminal (via proxy headers).
 */
export function isCellularRequest(request: NextRequest): boolean {
  return request.headers.get('x-cellular-authenticated') === '1'
}

/**
 * Validate employee binding from proxy headers.
 * The proxy sets x-cellular-employee-id from the JWT payload.
 * If the token has a bound employee and the request body claims a different one, reject.
 *
 * Returns the validated employeeId.
 */
export function validateCellularEmployeeFromHeaders(
  request: NextRequest,
  claimedEmployeeId: string | undefined
): string {
  if (!isCellularRequest(request)) {
    return claimedEmployeeId || ''
  }

  const boundEmployeeId = request.headers.get('x-cellular-employee-id')
  if (boundEmployeeId && claimedEmployeeId && claimedEmployeeId !== boundEmployeeId) {
    throw new CellularAuthError(
      `Employee mismatch: terminal bound to ${boundEmployeeId}, request claims ${claimedEmployeeId}`,
      403
    )
  }

  return boundEmployeeId || claimedEmployeeId || ''
}

/**
 * Validate manager re-auth from proxy headers for sensitive cellular actions.
 * Verifies the manager PIN hash against the stored bcrypt hash in the Employee record.
 */
export async function validateManagerReauthFromHeaders(
  request: NextRequest,
  managerId: string | undefined,
  managerPinHash: string | undefined,
  prisma: any
): Promise<void> {
  if (!isCellularRequest(request)) return

  if (!managerId) {
    throw new CellularAuthError(
      'Manager approval required for this action on cellular terminal',
      403
    )
  }

  if (!managerPinHash) {
    throw new CellularAuthError(
      'Manager PIN verification required for cellular terminal actions',
      403
    )
  }

  // Fetch the manager's stored PIN hash from DB and verify
  const employee = await prisma.employee.findUnique({
    where: { id: managerId },
    select: { pin: true },
  })

  if (!employee) {
    throw new CellularAuthError('Manager not found', 404)
  }

  if (!employee.pin) {
    throw new CellularAuthError('Manager has no PIN configured', 403)
  }

  const pinValid = await compare(managerPinHash, employee.pin)
  if (!pinValid) {
    throw new CellularAuthError('Invalid manager PIN', 403)
  }
}

/**
 * Validate refund capability from proxy headers.
 */
export function validateCellularRefundFromHeaders(request: NextRequest): void {
  if (!isCellularRequest(request)) return

  const canRefund = request.headers.get('x-can-refund')
  if (canRefund === 'false') {
    throw new CellularAuthError(
      'This terminal is not authorized for refunds',
      403
    )
  }
}

// ═══════════════════════════════════════════════════════════
// Order ownership gating
// ═══════════════════════════════════════════════════════════

/**
 * Validate that a cellular terminal is allowed to mutate this order.
 * Rejects mutations on orders owned by local terminals to prevent
 * split-brain during active order service.
 *
 * Exception: Payment is always allowed on any order (needed for card processing).
 * Exception: Read access is always allowed.
 *
 * @param isCellular - Whether the request came from a cellular terminal
 * @param orderId - The order being accessed
 * @param operation - 'read' | 'mutate' | 'pay'
 * @param prisma - Prisma client (or transaction client)
 */
export async function validateCellularOrderAccess(
  isCellular: boolean,
  orderId: string,
  operation: 'read' | 'mutate' | 'pay',
  prisma: any
): Promise<void> {
  // LAN terminals always have access
  if (!isCellular) return

  // Read access is always OK
  if (operation === 'read') return

  // Payment is always allowed (cellular terminals need to process cards)
  if (operation === 'pay') return

  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { lastMutatedBy: true, status: true },
  })

  // Let the route handle 404
  if (!order) return

  // Reject mutation if order is locally owned
  if (order.lastMutatedBy === 'local') {
    log.warn(JSON.stringify({
      event: 'cellular_ownership_blocked',
      orderId,
      operation,
      lastMutatedBy: order.lastMutatedBy,
      orderStatus: order.status,
    }))
    throw new CellularAuthError(
      'This order is being managed by a local terminal. Cellular mutation blocked.',
      409 // Conflict
    )
  }
}
