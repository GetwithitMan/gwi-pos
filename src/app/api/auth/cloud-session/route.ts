import { NextRequest, NextResponse } from 'next/server'
import { verifyCloudToken } from '@/lib/cloud-auth'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * POST /api/auth/cloud-session
 *
 * Validates a cloud access token from Mission Control,
 * creates an httpOnly session cookie, and returns employee
 * data for the client-side auth store.
 *
 * Called by the /auth/cloud page after MC redirect.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
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

  // Resolve the POS Location record for this cloud session.
  // Priority: JWT posLocationId (provisioned) → findFirst (dev) → auto-create (empty DB)
  const dbSlug = venueSlug || payload.slug
  let locationId: string
  let locationName: string

  try {
    let location: { id: string; name: string } | null = null

    // 1. JWT has posLocationId from provisioning — use it directly
    if (payload.posLocationId) {
      location = await db.location.findUnique({
        where: { id: payload.posLocationId },
        select: { id: true, name: true },
      })
      if (!location) {
        console.warn(`[cloud-auth] JWT posLocationId "${payload.posLocationId}" not found in DB, falling back`)
      }
    }

    // 2. Fallback: find first Location (dev/unprovisioned scenario)
    if (!location) {
      location = await db.location.findFirst({
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      })
    }

    // 3. No Location at all — auto-create (empty database)
    if (!location) {
      let org = await db.organization.findFirst({
        select: { id: true },
      })
      if (!org) {
        org = await db.organization.create({
          data: { name: payload.name ? `${payload.name}'s Organization` : 'Cloud Organization' },
        })
      }

      location = await db.location.create({
        data: {
          name: dbSlug,
          organizationId: org.id,
          timezone: 'America/New_York',
        },
        select: { id: true, name: true },
      })
      console.log('[cloud-auth] Auto-created Location:', location.id, location.name)
    }

    locationId = location.id
    locationName = location.name
  } catch (error) {
    console.error('[cloud-auth] Failed to resolve Location:', error)
    // Last resort fallback — will cause FK errors on writes but at least auth works
    locationId = `cloud-${dbSlug}`
    locationName = dbSlug
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
    permissions: ['admin'],
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
})

/**
 * DELETE /api/auth/cloud-session
 *
 * Clear the cloud session cookie (logout).
 */
export const DELETE = withVenue(async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete('pos-cloud-session')
  return response
})
