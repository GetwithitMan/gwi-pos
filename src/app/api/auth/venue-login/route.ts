import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { verifyPassword } from '@/lib/auth'
import { signVenueToken } from '@/lib/cloud-auth'

/**
 * POST /api/auth/venue-login
 *
 * Venue-local admin login. Validates email + password against the
 * Employee table in this venue's Neon database. On success, issues
 * the same pos-cloud-session cookie that Mission Control would issue,
 * so the rest of the auth middleware works identically.
 *
 * This completely decouples venue admin access from Mission Control /
 * Clerk — no cloud redirect needed.
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

  // Look up the venue location first, then find employee by email within it
  const location = await db.location.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })

  if (!location) {
    return NextResponse.json({ error: 'Venue not configured' }, { status: 404 })
  }

  const employee = await db.employee.findFirst({
    where: {
      locationId: location.id,
      email: { equals: normalizedEmail, mode: 'insensitive' },
      isActive: true,
      deletedAt: null,
    },
    include: { role: true },
  })

  if (!employee) {
    // Use same error message for both "not found" and "wrong password" to avoid user enumeration
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  if (!employee.password) {
    return NextResponse.json(
      { error: 'Admin password not set up yet. Contact your GWI admin to set up your login.', needsSetup: true },
      { status: 403 }
    )
  }

  const valid = await verifyPassword(password, employee.password)
  if (!valid) {
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
