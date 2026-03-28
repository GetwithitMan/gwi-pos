import { NextRequest, NextResponse } from 'next/server'
import { verifyCloudToken } from '@/lib/cloud-auth'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { config } from '@/lib/system-config'
import { err, forbidden, notFound, ok, unauthorized } from '@/lib/api-response'

// TODO(scale): PROVISION_API_KEY is currently used for both MC→POS API auth AND JWT signing.
// Split into separate secrets (PROVISION_API_KEY for API auth, CLOUD_SESSION_SECRET for JWT)
// before scaling to 1000+ merchants to limit blast radius of key compromise.

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
    return err('Token required')
  }

  const secret = config.cloudJwtSecret
  if (!secret) {
    console.error('[cloud-auth] CLOUD_JWT_SECRET (or PROVISION_API_KEY fallback) not configured')
    return err('Server misconfigured', 500)
  }

  // Validate JWT signature + expiry
  const payload = await verifyCloudToken(token, secret)
  if (!payload) {
    return unauthorized('Invalid or expired token')
  }

  // Verify slug matches the venue this request is for
  const venueSlug = request.headers.get('x-venue-slug')
  if (venueSlug && payload.slug !== venueSlug) {
    return forbidden('Venue mismatch')
  }

  // Resolve the POS Location record for this cloud session.
  // Priority: JWT posLocationId (provisioned) → findFirst (dev) → auto-create (empty DB)
  const dbSlug = venueSlug || payload.slug
  let locationId: string
  let locationName: string

  try {
    let location: { id: string; name: string; organizationId: string | null } | null = null

    // 1. JWT has posLocationId from provisioning — use it directly
    if (payload.posLocationId) {
      location = await db.location.findUnique({
        where: { id: payload.posLocationId },
        select: { id: true, name: true, organizationId: true },
      })
      if (!location) {
        console.warn(`[cloud-auth] JWT posLocationId "${payload.posLocationId}" not found in DB, falling back`)
      }
    }

    // 2. Fallback: find first Location (dev/unprovisioned scenario)
    if (!location) {
      location = await db.location.findFirst({
        select: { id: true, name: true, organizationId: true },
        orderBy: { createdAt: 'asc' },
      })
    }

    // M9: Capture organizationId from resolved location before null check
    const resolvedOrgId = location?.organizationId

    // 3. No Location at all — auto-create (empty database)
    if (!location) {
      // Use resolved org if available (defensive), otherwise findFirst
      let org = resolvedOrgId
        ? await db.organization.findUnique({ where: { id: resolvedOrgId }, select: { id: true } })
        : await db.organization.findFirst({ select: { id: true } })
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
        select: { id: true, name: true, organizationId: true },
      })
      if (process.env.NODE_ENV !== 'production') console.log('[cloud-auth] Auto-created Location:', location.id, location.name)
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
  // MC super_admin/sub_admin get full permissions (all reports, all settings)
  const isStaff = payload.role === 'super_admin' || payload.role === 'sub_admin'
  const nameParts = payload.name.split(' ')
  const employee = {
    id: `cloud-${payload.sub}`,
    firstName: nameParts[0] || 'Cloud',
    lastName: nameParts.slice(1).join(' ') || 'Admin',
    displayName: payload.name,
    role: { id: isStaff ? 'super-admin' : 'cloud-admin', name: isStaff ? 'Super Admin' : 'Cloud Admin' },
    location: { id: locationId, name: locationName },
    permissions: isStaff
      ? ['admin', 'reports', 'settings', 'employees', 'inventory', 'menu', 'orders', 'payments', 'shifts', 'tips', 'discounts', 'tables', 'kds', 'hardware', 'system']
      : ['admin'],
    isDevAccess: false,
  }

  // Return employee data + set httpOnly session cookie
  const response = NextResponse.json({ data: { employee } })
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
 * GET /api/auth/cloud-session
 *
 * Re-bootstrap the client auth store from the existing httpOnly
 * session cookie.  Used when the POS auth store has a stale
 * locationId (e.g. after DB routing changes) but the cloud session
 * cookie is still valid.  Returns the same employee shape as POST
 * so the client can call login(data.employee).
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get('pos-cloud-session')?.value
  if (!sessionToken) {
    return unauthorized('No cloud session')
  }

  const secret = config.cloudJwtSecret
  if (!secret) {
    return err('Server misconfigured', 500)
  }

  const payload = await verifyCloudToken(sessionToken, secret)
  if (!payload) {
    return unauthorized('Invalid or expired session')
  }

  // Resolve Location from venue DB (same logic as POST)
  let location: { id: string; name: string } | null = null

  if (payload.posLocationId) {
    location = await db.location.findUnique({
      where: { id: payload.posLocationId },
      select: { id: true, name: true },
    })
  }

  if (!location) {
    location = await db.location.findFirst({
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  if (!location) {
    return notFound('No location in venue database')
  }

  const nameParts = payload.name.split(' ')
  const employee = {
    id: `cloud-${payload.sub}`,
    firstName: nameParts[0] || 'Cloud',
    lastName: nameParts.slice(1).join(' ') || 'Admin',
    displayName: payload.name,
    role: { id: 'cloud-admin', name: 'Cloud Admin' },
    location: { id: location.id, name: location.name },
    permissions: ['admin'],
    isDevAccess: false,
  }

  return ok({ employee })
})

/**
 * DELETE /api/auth/cloud-session
 *
 * Clear the cloud session cookie (logout).
 */
export const DELETE = withVenue(async function DELETE() {
  const response = NextResponse.json({ data: { success: true } })
  response.cookies.delete('pos-cloud-session')
  return response
})
