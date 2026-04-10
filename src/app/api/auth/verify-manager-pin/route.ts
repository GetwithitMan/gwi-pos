import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { compare } from 'bcryptjs'
import { withVenue } from '@/lib/with-venue'
import { hasPermission } from '@/lib/auth-utils'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { generateApprovalToken } from '@/lib/approval-tokens'
import { ok } from '@/lib/api-response'

// ── Action → Permission mapping ─────────────────────────────────────────────
// Maps action strings to the permission key(s) required to authorize them.
// When multiple keys are listed, the employee must have ANY ONE of them.
const ACTION_PERMISSION_MAP: Record<string, string[]> = {
  void_order:              ['manager.void_orders'],
  void_item:               ['manager.void_items'],
  refund_payment:          ['manager.refunds'],
  discount_over_threshold: ['manager.discounts'],
  manual_price_override:   ['manager.open_items', 'manager.discounts'],
  open_cash_drawer:        ['pos.cash_drawer', 'pos.no_sale'],
  delete_order:            ['manager.void_orders'],
  close_shift:             ['manager.close_day'],
  override_time_clock:     ['manager.edit_time_entries'],
  override_tax_exempt:     ['manager.tax_exempt'],
  apply_large_comp:        ['manager.void_items'],
  reprint_receipt:         ['pos.access'],
  cash_variance_override:  ['manager.cash_variance_override'],
}

// ── Rate limiter (in-memory, per-IP) ─────────────────────────────────────────
const limiter = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60 * 1000 })

// ── POST /api/auth/verify-manager-pin ────────────────────────────────────────
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)

    const rateCheck = limiter.check(ip)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { authorized: false, error: 'Too many failed attempts. Try again later.' },
        {
          status: 429,
          headers: rateCheck.retryAfter
            ? { 'Retry-After': String(rateCheck.retryAfter) }
            : undefined,
        }
      )
    }

    const body = await request.json()
    const { pin, action, locationId } = body as {
      pin?: string
      action?: string
      locationId?: string
    }

    // ── Input validation ──────────────────────────────────────────────────
    if (!pin || typeof pin !== 'string' || pin.length < 4 || pin.length > 6) {
      return NextResponse.json(
        { authorized: false, error: 'PIN must be 4-6 digits' },
        { status: 400 }
      )
    }

    if (!action || typeof action !== 'string') {
      return NextResponse.json(
        { authorized: false, error: 'Action is required' },
        { status: 400 }
      )
    }

    if (!locationId || typeof locationId !== 'string') {
      return NextResponse.json(
        { authorized: false, error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Resolve required permissions for this action
    const requiredPermissions = ACTION_PERMISSION_MAP[action]
    if (!requiredPermissions) {
      return NextResponse.json(
        { authorized: false, error: `Unknown action: ${action}` },
        { status: 400 }
      )
    }

    // ── Find employees at this location ───────────────────────────────────
    // O(N) scan necessary because we don't know which employee is entering
    // their PIN. bcrypt compare prevents timing attacks.
    const employees = await db.employee.findMany({
      where: {
        locationId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        pin: true,
        firstName: true,
        lastName: true,
        displayName: true,
        role: {
          select: {
            id: true,
            name: true,
            permissions: true,
          },
        },
      },
    })

    // ── Match PIN ─────────────────────────────────────────────────────────
    // Optimization: if only one employee has a PIN and the required permissions,
    // check that one first to avoid unnecessary bcrypt comparisons.
    const employeesWithPin = employees.filter((e) => !!e.pin)
    const candidatesWithPermission = employeesWithPin.filter((e) => {
      const perms = (e.role.permissions as string[]) || []
      return requiredPermissions.some((p) => hasPermission(perms, p))
    })
    // Re-order: check permission-having employees first (most likely to be the correct one)
    const orderedEmployees = [
      ...candidatesWithPermission,
      ...employeesWithPin.filter((e) => !candidatesWithPermission.includes(e)),
    ]

    let matchedEmployee = null
    for (const employee of orderedEmployees) {
      if (!employee.pin) continue
      const pinMatch = await compare(pin, employee.pin)
      if (pinMatch) {
        matchedEmployee = employee
        break
      }
    }

    if (!matchedEmployee) {
      limiter.check(ip) // additional attempt counted
      return NextResponse.json(
        { authorized: false, error: 'Invalid PIN' },
        { status: 401 }
      )
    }

    // ── Check permissions ─────────────────────────────────────────────────
    const permissions = (matchedEmployee.role.permissions as string[]) || []

    // Employee must have at least one of the required permissions
    const hasRequired = requiredPermissions.some((p) =>
      hasPermission(permissions, p)
    )

    if (!hasRequired) {
      return NextResponse.json(
        {
          authorized: false,
          error: `${matchedEmployee.displayName || matchedEmployee.firstName} does not have permission to authorize this action`,
        },
        { status: 403 }
      )
    }

    // ── Success ───────────────────────────────────────────────────────────
    limiter.reset(ip)

    const employeeName = matchedEmployee.displayName
      || `${matchedEmployee.firstName} ${matchedEmployee.lastName}`

    // Generate mutation-bound approval token (HMAC-signed, 5-min TTL)
    const approvalToken = generateApprovalToken(matchedEmployee.id, locationId)

    return ok({
      authorized: true,
      employeeId: matchedEmployee.id,
      employeeName,
      approvalToken,
    })
  } catch (error) {
    console.error('[verify-manager-pin] Error:', error)
    return NextResponse.json(
      { authorized: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
})
