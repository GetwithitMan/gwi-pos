import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { compare } from 'bcryptjs'
import { withVenue } from '@/lib/with-venue'
import { checkLoginRateLimit, recordLoginFailure, recordLoginSuccess } from '@/lib/auth-rate-limiter'
import { setSessionCookie } from '@/lib/auth-session'

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    // ── Rate limiting (W1-S1) ──────────────────────────────────
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'

    const rateCheck = checkLoginRateLimit(ip)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.reason },
        {
          status: 429,
          headers: rateCheck.retryAfterSeconds
            ? { 'Retry-After': String(rateCheck.retryAfterSeconds) }
            : undefined,
        }
      )
    }

    const { pin, locationId } = await request.json()

    if (!pin || pin.length < 4) {
      return NextResponse.json(
        { error: 'PIN must be at least 4 digits' },
        { status: 400 }
      )
    }

    // locationId is optional — database-per-venue isolation already scopes queries.
    // When provided, it adds defense-in-depth filtering.

    // Get active employees scoped by location (if provided)
    // Note: PINs are hashed so we must compare each one (can't query directly)
    const employees = await db.employee.findMany({
      where: {
        isActive: true,
        ...(locationId ? { locationId } : {}),
      },
      include: {
        role: true,
        location: true,
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
      // Record failure for rate limiting — no employee ID since PIN didn't match
      recordLoginFailure(ip)

      // Log failed attempt
      if (locationId) {
        void db.auditLog.create({
          data: {
            locationId,
            action: 'login_failed',
            entityType: 'auth',
            details: { reason: 'invalid_pin', ip },
            ipAddress: ip,
          },
        }).catch(console.error)
      }

      return NextResponse.json(
        { error: 'Invalid PIN' },
        { status: 401 }
      )
    }

    // Fetch available roles from EmployeeRole junction table
    const employeeRoles = await db.employeeRole.findMany({
      where: {
        employeeId: matchedEmployee.id,
        deletedAt: null,
      },
      include: {
        role: {
          select: {
            id: true,
            name: true,
            cashHandlingMode: true,
          },
        },
      },
      orderBy: { isPrimary: 'desc' }, // Primary role first
    })

    const availableRoles = employeeRoles.map(er => ({
      id: er.role.id,
      name: er.role.name,
      cashHandlingMode: er.role.cashHandlingMode,
      isPrimary: er.isPrimary,
    }))

    // Log the login
    await db.auditLog.create({
      data: {
        locationId: matchedEmployee.locationId,
        employeeId: matchedEmployee.id,
        action: 'login',
        entityType: 'employee',
        entityId: matchedEmployee.id,
        ipAddress: ip,
      },
    })

    // Handle permissions - convert old object format to array if needed
    let permissions: string[] = []
    const rawPermissions = matchedEmployee.role.permissions

    if (Array.isArray(rawPermissions)) {
      // New format: already an array of permission strings
      permissions = rawPermissions as string[]
    } else if (rawPermissions && typeof rawPermissions === 'object') {
      // Old format: object like {orders: ['create', 'read'], menu: ['read']}
      // Convert to flat array for backwards compatibility, but also grant admin access for managers
      if (matchedEmployee.role.name === 'Manager' || matchedEmployee.role.name === 'Owner') {
        permissions = ['admin'] // Give full access to old manager roles
      }
    }

    // Check for dev access (Super Admin or has dev.access permission)
    const isDevAccess = permissions.includes('all') || permissions.includes('dev.access')

    // ── Set signed httpOnly session cookie (W1-S3) ─────────────
    await setSessionCookie({
      employeeId: matchedEmployee.id,
      locationId: matchedEmployee.locationId,
      roleId: matchedEmployee.role.id,
      roleName: matchedEmployee.role.name,
      permissions,
    })

    // Clear rate limit state on success
    recordLoginSuccess(ip, matchedEmployee.id)

    return NextResponse.json({ data: {
      employee: {
        id: matchedEmployee.id,
        firstName: matchedEmployee.firstName,
        lastName: matchedEmployee.lastName,
        displayName: matchedEmployee.displayName || `${matchedEmployee.firstName} ${matchedEmployee.lastName.charAt(0)}.`,
        role: {
          id: matchedEmployee.role.id,
          name: matchedEmployee.role.name,
        },
        location: {
          id: matchedEmployee.location.id,
          name: matchedEmployee.location.name,
        },
        defaultScreen: matchedEmployee.defaultScreen || null,
        permissions,
        isDevAccess,
        availableRoles,
        requiresPinChange: matchedEmployee.requiresPinChange ?? false,
      },
    } })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})
