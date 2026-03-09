import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { compare } from 'bcryptjs'
import { withVenue } from '@/lib/with-venue'

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

// Clean up stale entries every 60 seconds to prevent memory leaks
const PIN_CLEANUP_INTERVAL = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of pinRateMap) {
    if (now - entry.windowStart > PIN_WINDOW_MS) {
      pinRateMap.delete(key)
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
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
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

    const { pin, locationId, employeeId } = await request.json()

    if (!pin || pin.length < 4) {
      return NextResponse.json(
        { error: 'PIN must be at least 4 digits' },
        { status: 400 }
      )
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Fast path: O(1) — single employee lookup + one compare
    if (employeeId) {
      const employee = await db.employee.findUnique({
        where: { id: employeeId },
        select: {
          id: true,
          pin: true,
          firstName: true,
          lastName: true,
          isActive: true,
          locationId: true,
          requiresPinChange: true,
          role: { select: { id: true, name: true } },
        },
      })
      if (!employee || !employee.isActive || employee.locationId !== locationId) {
        recordPinFailure(ip)
        return NextResponse.json(
          { error: 'Invalid PIN' },
          { status: 401 }
        )
      }
      const pinMatch = await compare(pin, employee.pin)
      if (!pinMatch) {
        recordPinFailure(ip)
        return NextResponse.json(
          { error: 'Invalid PIN' },
          { status: 401 }
        )
      }
      return NextResponse.json({ data: {
        employee: {
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          role: employee.role.name,
          requiresPinChange: employee.requiresPinChange ?? false,
        },
        verified: true,
      } })
    }

    // Fall through to existing O(N) scan for backwards compatibility
    // Get active employees for this location
    const employees = await db.employee.findMany({
      where: {
        locationId,
        isActive: true,
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

    // Find employee with matching PIN
    let matchedEmployee = null
    for (const employee of employees) {
      const pinMatch = await compare(pin, employee.pin)
      if (pinMatch) {
        matchedEmployee = employee
        break
      }
    }

    if (!matchedEmployee) {
      recordPinFailure(ip)
      return NextResponse.json(
        { error: 'Invalid PIN' },
        { status: 401 }
      )
    }

    // Return minimal employee info for verification
    return NextResponse.json({ data: {
      employee: {
        id: matchedEmployee.id,
        firstName: matchedEmployee.firstName,
        lastName: matchedEmployee.lastName,
        role: matchedEmployee.role.name,
        requiresPinChange: matchedEmployee.requiresPinChange ?? false,
      },
      verified: true,
    } })
  } catch (error) {
    console.error('PIN verification error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})
