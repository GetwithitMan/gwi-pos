import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { err, notFound, ok, unauthorized } from '@/lib/api-response'

/**
 * GET /api/internal/cloud-identity
 * Returns the current cloud identity from the Location record.
 * Called by support tooling and sync-agent for "who am I?" queries.
 */
export async function GET(request: Request) {
  // Internal endpoints require INTERNAL_API_SECRET + Bearer token validation
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) {
    return err('Not configured', 503)
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    return unauthorized('Unauthorized')
  }

  try {
    const location = await db.location.findFirst({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        cloudLocationId: true,
        cloudOrganizationId: true,
        cloudEnterpriseId: true,
      },
    })

    if (!location) {
      return notFound('No location found')
    }

    return ok({
      posLocationId: location.id,
      name: location.name,
      slug: location.slug,
      cloudLocationId: location.cloudLocationId,
      cloudOrganizationId: location.cloudOrganizationId,
      cloudEnterpriseId: location.cloudEnterpriseId,
      isBound: !!location.cloudLocationId,
    })
  } catch (caughtErr) {
    console.error('[cloud-identity] GET error:', err)
    return err('Internal error', 500)
  }
}

/**
 * POST /api/internal/cloud-identity
 * Updates cloud identity fields on the Location record.
 * Called by heartbeat.sh and sync-agent after receiving identity from Mission Control.
 *
 * Body: { cloudLocationId, cloudOrganizationId?, cloudEnterpriseId? }
 */
export async function POST(request: NextRequest) {
  // Verify internal secret
  const secret = process.env.INTERNAL_API_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return unauthorized('Unauthorized')
  }

  try {
    const body = await request.json()
    const { cloudLocationId, cloudOrganizationId, cloudEnterpriseId } = body

    if (!cloudLocationId) {
      return err('cloudLocationId is required')
    }

    // Update the first (only) active location — each NUC has exactly one
    const location = await db.location.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    })

    if (!location) {
      return notFound('No location found')
    }

    await db.location.update({
      where: { id: location.id },
      data: {
        cloudLocationId,
        cloudOrganizationId: cloudOrganizationId ?? null,
        cloudEnterpriseId: cloudEnterpriseId ?? null,
      },
    })

    return ok({ updated: true, locationId: location.id })
  } catch (caughtErr) {
    console.error('[cloud-identity] POST error:', err)
    return err('Internal error', 500)
  }
}
