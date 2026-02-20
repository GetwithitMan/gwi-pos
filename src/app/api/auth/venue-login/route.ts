import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { verifyPassword } from '@/lib/auth'
import { signVenueToken } from '@/lib/cloud-auth'

/**
 * Derive the Clerk Frontend API URL from the publishable key.
 * pk_test_Y2hhb... → base64 → "champion-mackerel-95.clerk.accounts.dev$"
 * → FAPI URL: https://champion-mackerel-95.clerk.accounts.dev
 */
function getClerkFapiUrl(): string {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || ''
  if (!pk) return ''
  try {
    const base64 = pk.replace(/^pk_(test|live)_/, '')
    const decoded = Buffer.from(base64, 'base64').toString('utf8').replace(/\$$/, '')
    return `https://${decoded}`
  } catch {
    return ''
  }
}

/**
 * Verify email + password against the Clerk tenant server-to-server.
 * Uses Clerk's Frontend API (FAPI) which accepts plain HTTP requests.
 * Returns true if the credentials are valid in Clerk.
 */
async function verifyWithClerk(email: string, password: string): Promise<boolean> {
  const fapiUrl = getClerkFapiUrl()
  if (!fapiUrl) return false

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(`${fapiUrl}/v1/client/sign_ins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        identifier: email,
        strategy: 'password',
        password,
      }).toString(),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok && res.status !== 422) return false

    const data = await res.json()
    // Successful sign-in: response.status === 'complete'
    return data.response?.status === 'complete'
  } catch {
    clearTimeout(timeout)
    return false
  }
}

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

  if (!employee) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  // 1. Try Clerk first — same email+password as Mission Control login
  const clerkValid = await verifyWithClerk(normalizedEmail, password)

  // 2. Fallback: local bcrypt password (set during provisioning or via venue-setup)
  let authenticated = clerkValid
  if (!authenticated && employee.password) {
    authenticated = await verifyPassword(password, employee.password)
  }

  if (!authenticated) {
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
