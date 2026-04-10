import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as EmployeeRepository from '@/lib/repositories/employee-repository'
import { compare } from 'bcryptjs'
import { withVenue } from '@/lib/with-venue'
import { getClientIp } from '@/lib/get-client-ip'
import { generateApprovalToken } from '@/lib/approval-tokens'
import { err, ok, unauthorized } from '@/lib/api-response'

// ── Dedicated rate limiter for PIN verification ────────────────────────────
// Stricter than login: 5 failed attempts per IP → 5-minute lockout.
// A 4-digit PIN has only 10,000 combinations — must limit brute-force.
const PIN_MAX_FAILURES = 5
const PIN_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

const pinRateMap = new Map<string, { count: number; windowStart: number }>()

function checkPinRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now()
  const entry = pinRateMap.get(ip)

  if (!entry || now - entry.windowStart > PIN_WINDOW_MS) {
    // Window expired or first attempt — allow
    return { allowed: true }
  }

  if (entry.count >= PIN_MAX_FAILURES) {
    const retryAfterSeconds = Math.ceil((entry.windowStart + PIN_WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }

  return { allowed: true }
}

function recordPinFailure(ip: string): void {
  const now = Date.now()
  const entry = pinRateMap.get(ip)

  if (!entry || now - entry.windowStart > PIN_WINDOW_MS) {
    // Start a new window
    pinRateMap.set(ip, { count: 1, windowStart: now })
  } else {
    entry.count++
  }
}

// ── Per-terminal rate limiter ────────────────────────────────────────────────
// All cellular devices share the same IP, so per-IP limiting is insufficient.
// This secondary limiter counts per terminalId (or employeeId fallback).
// 5 failed PINs per terminal → 30-minute lockout + CRITICAL log.
const TERMINAL_PIN_MAX_FAILURES = 5
const TERMINAL_PIN_WINDOW_MS = 30 * 60 * 1000 // 30 minutes

const terminalPinRateMap = new Map<string, { count: number; windowStart: number }>()

function checkTerminalPinRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now()
  const entry = terminalPinRateMap.get(key)

  if (!entry || now - entry.windowStart > TERMINAL_PIN_WINDOW_MS) {
    return { allowed: true }
  }

  if (entry.count >= TERMINAL_PIN_MAX_FAILURES) {
    const retryAfterSeconds = Math.ceil((entry.windowStart + TERMINAL_PIN_WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }

  return { allowed: true }
}

function recordTerminalPinFailure(key: string, label: string): void {
  const now = Date.now()
  const entry = terminalPinRateMap.get(key)

  if (!entry || now - entry.windowStart > TERMINAL_PIN_WINDOW_MS) {
    terminalPinRateMap.set(key, { count: 1, windowStart: now })
  } else {
    entry.count++
    if (entry.count >= TERMINAL_PIN_MAX_FAILURES) {
      console.error(`CRITICAL: PIN brute force lockout triggered for ${label} "${key}" — ${TERMINAL_PIN_MAX_FAILURES} failed attempts, locked for 30 minutes`)
    }
  }
}

// Clean up stale entries every 60 seconds to prevent memory leaks
const PIN_CLEANUP_INTERVAL = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of pinRateMap) {
    if (now - entry.windowStart > PIN_WINDOW_MS) {
      pinRateMap.delete(key)
    }
  }
  for (const [key, entry] of terminalPinRateMap) {
    if (now - entry.windowStart > TERMINAL_PIN_WINDOW_MS) {
      terminalPinRateMap.delete(key)
    }
  }
}, 60_000)
if (PIN_CLEANUP_INTERVAL && typeof PIN_CLEANUP_INTERVAL === 'object' && 'unref' in PIN_CLEANUP_INTERVAL) {
  PIN_CLEANUP_INTERVAL.unref()
}

/**
 * POST /api/auth/verify-pin
 *
 * Verifies an employee PIN without doing a full login.
 * Used for operations that require PIN confirmation (stock adjustments, voids, etc.)
 *
 * Does NOT create an audit log entry for login - the calling operation
 * should log its own audit entry with the verified employee ID.
 *
 * Rate limited: 5 failed attempts per IP per 5 minutes → 429.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    // Rate limiting — dedicated to verify-pin (stricter than login)
    const ip = getClientIp(request)
    const rateCheck = checkPinRateLimit(ip)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts, try again later' },
        {
          status: 429,
          headers: rateCheck.retryAfterSeconds
            ? { 'Retry-After': String(rateCheck.retryAfterSeconds) }
            : undefined,
        }
      )
    }

    // Per-terminal rate limiting — cellular devices share the same IP, so
    // we also rate-limit by terminalId (from header) or employeeId (from body).
    // This is checked early but the key may update after body parsing.
    const terminalId = request.headers.get('x-terminal-id')

    const { pin, locationId, employeeId } = await request.json()

    // Determine terminal rate-limit key: prefer terminalId, fall back to employeeId
    const terminalRateKey = terminalId || employeeId || null
    const terminalRateLabel = terminalId ? 'terminal' : 'employee'
    if (terminalRateKey) {
      const terminalCheck = checkTerminalPinRateLimit(terminalRateKey)
      if (!terminalCheck.allowed) {
        return NextResponse.json(
          { error: 'Too many failed PIN attempts — terminal locked for 30 minutes' },
          {
            status: 429,
            headers: terminalCheck.retryAfterSeconds
              ? { 'Retry-After': String(terminalCheck.retryAfterSeconds) }
              : undefined,
          }
        )
      }
    }

    if (!pin || pin.length < 4) {
      return err('PIN must be at least 4 digits')
    }

    if (!locationId) {
      return err('locationId is required')
    }

    // Fast path: O(1) — single employee lookup + one compare (tenant-scoped)
    if (employeeId) {
      const employee = await EmployeeRepository.getEmployeeByIdWithSelect(employeeId, locationId, {
        id: true,
        pin: true,
        firstName: true,
        lastName: true,
        isActive: true,
        locationId: true,
        requiresPinChange: true,
        role: { select: { id: true, name: true } },
      })
      if (!employee || !employee.isActive) {
        recordPinFailure(ip)
        if (terminalRateKey) recordTerminalPinFailure(terminalRateKey, terminalRateLabel)
        return unauthorized('Invalid PIN')
      }
      const pinMatch = await compare(pin, employee.pin)
      if (!pinMatch) {
        recordPinFailure(ip)
        if (terminalRateKey) recordTerminalPinFailure(terminalRateKey, terminalRateLabel)
        return unauthorized('Invalid PIN')
      }

      // Generate mutation-bound approval token (HMAC-signed, 5-min TTL)
      const approvalToken = generateApprovalToken(employee.id, locationId)

      return ok({
        employee: {
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          role: employee.role.name,
          requiresPinChange: employee.requiresPinChange ?? false,
        },
        verified: true,
        approvalToken,
      })
    }

    // Fall through to existing O(N) scan for backwards compatibility
    // Get active employees for this location (tenant-scoped via deletedAt guard)
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
        requiresPinChange: true,
        role: {
          select: {
            id: true,
            name: true,
          }
        }
      }
    })

    // Find employee with matching PIN — parallel bcrypt comparisons
    const pinResults = await Promise.all(
      employees.map(emp => compare(pin, emp.pin).then(match => match ? emp : null))
    )
    const matchedEmployee = pinResults.find(r => r !== null) ?? null

    if (!matchedEmployee) {
      recordPinFailure(ip)
      if (terminalRateKey) recordTerminalPinFailure(terminalRateKey, terminalRateLabel)
      return unauthorized('Invalid PIN')
    }

    // Generate mutation-bound approval token (HMAC-signed, 5-min TTL)
    const approvalToken = generateApprovalToken(matchedEmployee.id, locationId)

    // Return minimal employee info for verification
    return ok({
      employee: {
        id: matchedEmployee.id,
        firstName: matchedEmployee.firstName,
        lastName: matchedEmployee.lastName,
        role: matchedEmployee.role.name,
        requiresPinChange: matchedEmployee.requiresPinChange ?? false,
      },
      verified: true,
      approvalToken,
    })
  } catch (error) {
    console.error('PIN verification error:', error)
    return err('Internal server error', 500)
  }
})
