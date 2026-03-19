import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { verifyOwnerToken } from '@/lib/cloud-auth'
import { signVenueToken } from '@/lib/cloud-auth'

export const POST = withVenue(async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { token } = body

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Token required' }, { status: 400 })
  }

  const secret = process.env.PROVISION_API_KEY
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })

  const venueSlug = request.headers.get('x-venue-slug')
  if (!venueSlug) return NextResponse.json({ error: 'Invalid request context' }, { status: 400 })

  const payload = await verifyOwnerToken(token, secret)
  if (!payload) return NextResponse.json({ error: 'Invalid or expired access token' }, { status: 401 })

  // Verify this token authorizes access to the current venue
  if (!payload.venues.includes(venueSlug)) {
    return NextResponse.json({ error: 'Token not valid for this venue' }, { status: 403 })
  }

  // Find the employee in this venue's DB
  const location = await db.location.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })
  if (!location) return NextResponse.json({ error: 'Venue not configured' }, { status: 404 })

  const employee = await db.employee.findFirst({
    where: {
      locationId: location.id,
      email: { equals: payload.email, mode: 'insensitive' },
      isActive: true,
      deletedAt: null,
    },
    include: { role: true },
  })

  if (!employee) {
    return NextResponse.json(
      { error: 'Your account is not set up for this venue. Contact GWI support.', notSetup: true },
      { status: 403 }
    )
  }

  const sessionToken = await signVenueToken(
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
  response.cookies.set('pos-cloud-session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60,
  })
  return response
})
