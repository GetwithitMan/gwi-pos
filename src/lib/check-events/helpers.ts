/**
 * Check Aggregate — Shared Route Helpers
 *
 * Idempotency via ProcessedCommand and lease ownership validation,
 * extracted so every check route uses the same logic.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getRequestLocationId } from '@/lib/request-context'
import { getActorFromRequest } from '@/lib/api-auth'
import type { NextRequest } from 'next/server'

// ── Idempotency ──────────────────────────────────────────────────────

/**
 * Check whether a commandId has already been processed.
 * Returns the stored JSON result if found, null otherwise.
 */
export async function checkIdempotency(commandId: string): Promise<unknown | null> {
  const existing = await db.processedCommand.findUnique({
    where: { commandId },
  })
  return existing ? JSON.parse(existing.resultJson) : null
}

// ── Lease Validation ─────────────────────────────────────────────────

export interface LeaseValidationResult {
  check: {
    id: string
    locationId: string
    status: string
    tableId: string | null
    terminalId: string | null
    leaseAcquiredAt: Date | null
    employeeId: string
    guestCount: number
    orderType: string
    tabName: string | null
    [key: string]: unknown
  }
}

export interface LeaseValidationError {
  response: NextResponse
}

/**
 * Load a check and verify the requesting terminal holds the editing lease.
 *
 * @param checkId     — the check to validate
 * @param terminalId  — the terminal claiming the lease
 * @param locationId  — must match the check's locationId (tenant isolation)
 * @param opts.allowStatuses — which statuses are acceptable (default: ['draft'])
 */
export async function validateLease(
  checkId: string,
  terminalId: string,
  locationId: string,
  opts?: { allowStatuses?: string[] }
): Promise<LeaseValidationResult | LeaseValidationError> {
  const check = await db.check.findUnique({ where: { id: checkId } })

  if (!check) {
    return { response: NextResponse.json({ error: 'Check not found' }, { status: 404 }) }
  }

  if (check.locationId !== locationId) {
    return { response: NextResponse.json({ error: 'Check not found' }, { status: 404 }) }
  }

  const allowStatuses = opts?.allowStatuses ?? ['draft']
  if (!allowStatuses.includes(check.status)) {
    return {
      response: NextResponse.json(
        { error: `Check status is '${check.status}', expected one of: ${allowStatuses.join(', ')}` },
        { status: 409 }
      ),
    }
  }

  if (check.terminalId !== terminalId) {
    return {
      response: NextResponse.json(
        {
          error: 'LEASE_CONFLICT',
          leaseOwner: check.terminalId,
          leaseAcquiredAt: check.leaseAcquiredAt,
        },
        { status: 409 }
      ),
    }
  }

  return { check: check as LeaseValidationResult['check'] }
}

/** Type guard — true when the result is an error response. */
export function isLeaseError(
  result: LeaseValidationResult | LeaseValidationError
): result is LeaseValidationError {
  return 'response' in result
}

// ── Location Resolution ──────────────────────────────────────────────

/**
 * Resolve locationId from (in priority order):
 *   1. Explicit body field
 *   2. Request context (JWT / cellular)
 *   3. Actor session
 */
export async function resolveLocationId(
  request: NextRequest,
  bodyLocationId?: string
): Promise<string | null> {
  if (bodyLocationId) return bodyLocationId
  const fromCtx = getRequestLocationId()
  if (fromCtx) return fromCtx
  const actor = await getActorFromRequest(request)
  return actor.locationId
}
