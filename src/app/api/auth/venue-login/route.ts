import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { hash } from 'bcryptjs'
import { db, adminDb } from '@/lib/db'
import * as EmployeeRepository from '@/lib/repositories/employee-repository'
import { withVenue } from '@/lib/with-venue'
import { verifyPassword } from '@/lib/auth'
import { signVenueToken, signOwnerToken } from '@/lib/cloud-auth'
import { verifyWithClerk } from '@/lib/clerk-verify'
import { checkLoginRateLimit, recordLoginFailure, recordLoginSuccess } from '@/lib/auth-rate-limiter'

/**
 * POST /api/auth/venue-login
 *
 * Venue admin login. Verifies email + password against the GWI Clerk
 * tenant first (same credentials as Mission Control). If the owner
 * doesn't have a Clerk account yet, falls back to a locally-stored
 * bcrypt password (set during provisioning via /api/auth/venue-setup).
 *
 * On success, issues the same pos-cloud-session cookie that Mission
 * Control would issue — no redirect to MC needed.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  // ── Rate limiting ──────────────────────────────────────────────
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

  const body = await request.json().catch(() => ({}))
  const { email, password } = body

  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const secret = process.env.PROVISION_API_KEY
  if (!secret) {
    console.error('[venue-login] PROVISION_API_KEY not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const venueSlug = request.headers.get('x-venue-slug')
  if (!venueSlug) {
    return NextResponse.json({ error: 'Invalid request context' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()

  // Look up venue location
  const location = await db.location.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })
  if (!location) {
    return NextResponse.json({ error: 'Venue not configured' }, { status: 404 })
  }

  // Find employee by email in this venue's database
  const employee = await adminDb.employee.findFirst({
    where: {
      locationId: location.id,
      email: { equals: normalizedEmail, mode: 'insensitive' },
      isActive: true,
      deletedAt: null,
    },
    include: { role: true },
  })

  // 1. Try Clerk first — same email+password as Mission Control login
  const clerkValid = await verifyWithClerk(normalizedEmail, password)

  // 2. Fallback: local bcrypt password (only if local employee exists)
  let authenticated = clerkValid
  if (!authenticated && employee?.password) {
    authenticated = await verifyPassword(password, employee.password)
  }

  if (!authenticated) {
    recordLoginFailure(ip)
    console.error(`[venue-login] Auth failed for ${normalizedEmail}: clerk=${clerkValid}, hasEmployee=${!!employee}, hasLocalPw=${!!employee?.password}`)
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  // ── MC-authorized owner (no local Employee required) ─────────────
  // Owners added via MC Team tab authenticate through Clerk. MC confirms
  // their venue access and they get an admin-level session directly.
  // If MC is unreachable or MISSION_CONTROL_URL is not configured, fall
  // through to the local employee session below — login MUST work offline.
  if (clerkValid) {
    const mcUrl = process.env.MISSION_CONTROL_URL
    if (!mcUrl) {
      console.warn('[venue-login] MISSION_CONTROL_URL not configured — skipping MC owner/venues check, falling through to local auth')
    } else {
      const provisionKey = process.env.PROVISION_API_KEY || ''
      try {
        const venueRes = await fetch(
          `${mcUrl}/api/owner/venues?email=${encodeURIComponent(normalizedEmail)}`,
          {
            headers: { Authorization: `Bearer ${provisionKey}` },
            signal: AbortSignal.timeout(4000),
          }
        )
        if (!venueRes.ok) {
          console.error(`[venue-login] MC owner/venues returned ${venueRes.status} for ${normalizedEmail}`)
        }
        if (venueRes.ok) {
          const venueData = await venueRes.json()
          const venues: Array<{ slug: string; name: string; domain: string }> = venueData.data?.venues ?? []
          if (venues.length > 1) {
            // Multi-venue owner — return venue picker data instead of a session
            const ownerToken = await signOwnerToken(normalizedEmail, venues.map(v => v.slug), secret)
            return NextResponse.json({
              data: {
                multiVenue: true,
                venues,
                ownerToken,
              },
            })
          }

          // Single venue or MC-only owner — check if they have access to this venue
          const hasAccess = venues.some(v => v.slug === venueSlug)
          if (hasAccess && !employee) {
            // No local Employee record — auto-provision a real Employee so
            // all API routes that require employeeId work correctly.
            const ownerName = venueData.data?.name || normalizedEmail.split('@')[0]
            const nameParts = ownerName.split(' ')

            // Find or create a real employee for this MC owner
            let ownerEmployee = await adminDb.employee.findFirst({
              where: { locationId: location.id, email: { equals: normalizedEmail, mode: 'insensitive' }, deletedAt: null },
              include: { role: true },
            })

            if (!ownerEmployee) {
              // Find admin role for this location
              const allRoles = await db.role.findMany({
                where: { locationId: location.id, deletedAt: null },
                orderBy: { createdAt: 'asc' },
              })
              const adminRole = allRoles.find(r => {
                const perms = (r.permissions as string[]) || []
                return perms.includes('all') || perms.includes('admin') || perms.includes('super_admin')
              }) || allRoles[0]

              if (adminRole) {
                const rawPin = String(randomInt(100000, 1000000))
                const hashedPin = await hash(rawPin, 10)
                const createdOwner = await EmployeeRepository.createEmployee(location.id, {
                  firstName: nameParts[0] || ownerName,
                  lastName: nameParts.slice(1).join(' ') || '',
                  displayName: ownerName,
                  email: normalizedEmail,
                  roleId: adminRole.id,
                  isActive: true,
                  pin: hashedPin,
                })
                // Re-fetch with role include for session data
                ownerEmployee = await EmployeeRepository.getEmployeeByIdWithInclude(
                  createdOwner.id,
                  location.id,
                  { role: true },
                )
                if (ownerEmployee) {
                  console.log(`[venue-login] Auto-provisioned employee ${ownerEmployee.id} for MC owner ${normalizedEmail} at location ${location.id}`)
                }
              }
            }

            // Use real employee ID if provisioned, fall back to prefixed ID
            const employeeId = ownerEmployee?.id || `mc-owner-${normalizedEmail}`
            const roleName = ownerEmployee?.role?.name || 'Owner Manager'
            const roleId = ownerEmployee?.role?.id || 'mc-owner'

            const token = await signVenueToken(
              {
                sub: employeeId,
                email: normalizedEmail,
                name: ownerName,
                slug: venueSlug,
                orgId: 'venue-local',
                role: roleName,
                posLocationId: location.id,
              },
              secret
            )

            const employeeData = {
              id: employeeId,
              firstName: ownerEmployee?.firstName || nameParts[0] || ownerName,
              lastName: ownerEmployee?.lastName || nameParts.slice(1).join(' ') || '',
              displayName: ownerEmployee?.displayName || ownerName,
              role: { id: roleId, name: roleName },
              location: { id: location.id, name: location.name },
              permissions: ['admin'],
              isDevAccess: false,
            }

            const response = NextResponse.json({ data: { employee: employeeData } })
            response.cookies.set('pos-cloud-session', token, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
              path: '/',
              maxAge: 8 * 60 * 60,
            })
            return response
          }

          if (!hasAccess) {
            console.error(`[venue-login] ${normalizedEmail} not authorized for venue ${venueSlug}. Available: ${venues.map(v => v.slug).join(', ') || 'none'}`)
          }
        }
      } catch (err) {
        console.warn(`[venue-login] MC owner/venues call failed — falling through to local auth for ${normalizedEmail}:`, err)
      }
    }
  }

  // ── Local employee session ───────────────────────────────────────
  if (!employee) {
    recordLoginFailure(ip)
    console.error(`[venue-login] No local employee and MC access check failed for ${normalizedEmail} at ${venueSlug}`)
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  // Clear rate limit on success
  recordLoginSuccess(ip, employee.id)

  // Generate a cloud-session-compatible JWT signed with PROVISION_API_KEY
  const token = await signVenueToken(
    {
      sub: employee.id,
      email: employee.email!,
      name: employee.displayName || `${employee.firstName} ${employee.lastName}`,
      slug: venueSlug,
      orgId: 'venue-local',
      role: employee.role.name,
      posLocationId: employee.locationId,
    },
    secret
  )

  const employeeData = {
    id: employee.id,
    firstName: employee.firstName,
    lastName: employee.lastName,
    displayName: employee.displayName || `${employee.firstName} ${employee.lastName}`,
    role: { id: employee.role.id, name: employee.role.name },
    location: { id: location.id, name: location.name },
    permissions: ['admin'],
    isDevAccess: false,
  }

  const response = NextResponse.json({ data: { employee: employeeData } })
  response.cookies.set('pos-cloud-session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60, // 8 hours
  })

  return response
})
