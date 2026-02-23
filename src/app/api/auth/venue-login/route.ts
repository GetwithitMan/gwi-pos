import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { verifyPassword } from '@/lib/auth'
import { signVenueToken, signOwnerToken } from '@/lib/cloud-auth'
import { verifyWithClerk } from '@/lib/clerk-verify'

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
  const employee = await db.employee.findFirst({
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
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  // ── MC-authorized owner (no local Employee required) ─────────────
  // Owners added via MC Team tab authenticate through Clerk. MC confirms
  // their venue access and they get an admin-level session directly.
  if (clerkValid) {
    const mcUrl = process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com'
    const provisionKey = process.env.PROVISION_API_KEY || ''
    try {
      const venueRes = await fetch(
        `${mcUrl}/api/owner/venues?email=${encodeURIComponent(normalizedEmail)}`,
        {
          headers: { Authorization: `Bearer ${provisionKey}` },
          signal: AbortSignal.timeout(4000),
        }
      )
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
          // No local Employee record — issue admin session from MC data
          const ownerName = venueData.data?.name || normalizedEmail.split('@')[0]
          const nameParts = ownerName.split(' ')
          const token = await signVenueToken(
            {
              sub: `mc-owner-${normalizedEmail}`,
              email: normalizedEmail,
              name: ownerName,
              slug: venueSlug,
              orgId: 'venue-local',
              role: 'Owner Manager',
              posLocationId: location.id,
            },
            secret
          )

          const employeeData = {
            id: `mc-owner-${normalizedEmail}`,
            firstName: nameParts[0] || ownerName,
            lastName: nameParts.slice(1).join(' ') || '',
            displayName: ownerName,
            role: { id: 'mc-owner', name: 'Owner Manager' },
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
      }
    } catch {
      // MC unreachable — fall through to local employee session if available
    }
  }

  // ── Local employee session ───────────────────────────────────────
  if (!employee) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

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
