import { NextRequest, NextResponse } from 'next/server'
import { verifyCloudToken } from '@/lib/cloud-auth'
import { getDbForVenue } from '@/lib/db'

/**
 * POST /api/auth/cloud-session
 *
 * Validates a cloud access token from Mission Control,
 * creates an httpOnly session cookie, and returns employee
 * data for the client-side auth store.
 *
 * Called by the /auth/cloud page after MC redirect.
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { token } = body

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Token required' }, { status: 400 })
  }

  const secret = process.env.PROVISION_API_KEY
  if (!secret) {
    console.error('[cloud-auth] PROVISION_API_KEY not configured')
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 }
    )
  }

  // Validate JWT signature + expiry
  const payload = await verifyCloudToken(token, secret)
  if (!payload) {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    )
  }

  // Verify slug matches the venue this request is for
  const venueSlug = request.headers.get('x-venue-slug')
  if (venueSlug && payload.slug !== venueSlug) {
    return NextResponse.json({ error: 'Venue mismatch' }, { status: 403 })
  }

  // Get the venue's Location record from its database
  const dbSlug = venueSlug || payload.slug
  let locationId: string
  let locationName: string

  try {
    const venueDb = getDbForVenue(dbSlug)
    const location = await venueDb.location.findFirst({
      where: { deletedAt: null },
      select: { id: true, name: true },
    })

    if (!location) {
      return NextResponse.json(
        { error: 'Venue database not provisioned' },
        { status: 404 }
      )
    }

    locationId = location.id
    locationName = location.name
  } catch (error) {
    console.error('[cloud-auth] DB connection failed:', error)
    return NextResponse.json(
      { error: 'Database connection failed' },
      { status: 503 }
    )
  }

  // Build cloud employee for the auth store
  const nameParts = payload.name.split(' ')
  const employee = {
    id: `cloud-${payload.sub}`,
    firstName: nameParts[0] || 'Cloud',
    lastName: nameParts.slice(1).join(' ') || 'Admin',
    displayName: payload.name,
    role: { id: 'cloud-admin', name: 'Cloud Admin' },
    location: { id: locationId, name: locationName },
    permissions: ['all'],
    isDevAccess: false,
  }

  // Return employee data + set httpOnly session cookie
  const response = NextResponse.json({ employee })
  response.cookies.set('pos-cloud-session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60, // 8 hours
  })

  return response
}

/**
 * DELETE /api/auth/cloud-session
 *
 * Clear the cloud session cookie (logout).
 */
export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete('pos-cloud-session')
  return response
}
