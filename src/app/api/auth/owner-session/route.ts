import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { verifyOwnerToken, signVenueToken } from '@/lib/cloud-auth'
import { config } from '@/lib/system-config'
import { err, forbidden, notFound, unauthorized } from '@/lib/api-response'

export const POST = withVenue(async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { token } = body

  if (!token || typeof token !== 'string') {
    return err('Token required')
  }

  const secret = config.cloudJwtSecret
  if (!secret) return err('Server misconfigured', 500)

  const venueSlug = request.headers.get('x-venue-slug')
  if (!venueSlug) return err('Invalid request context')

  const payload = await verifyOwnerToken(token, secret)
  if (!payload) return unauthorized('Invalid or expired access token')

  // Verify this token authorizes access to the current venue
  if (!payload.venues.includes(venueSlug)) {
    return forbidden('Token not valid for this venue')
  }

  // Find the employee in this venue's DB
  const location = await db.location.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })
  if (!location) return notFound('Venue not configured')

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
