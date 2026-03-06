import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/internal/cloud-identity
 * Returns the current cloud identity from the Location record.
 * Called by support tooling and sync-agent for "who am I?" queries.
 */
export async function GET() {
  // Internal endpoints require INTERNAL_API_SECRET
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
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
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    return NextResponse.json({
      posLocationId: location.id,
      name: location.name,
      slug: location.slug,
      cloudLocationId: location.cloudLocationId,
      cloudOrganizationId: location.cloudOrganizationId,
      cloudEnterpriseId: location.cloudEnterpriseId,
      isBound: !!location.cloudLocationId,
    })
  } catch (err) {
    console.error('[cloud-identity] GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { cloudLocationId, cloudOrganizationId, cloudEnterpriseId } = body

    if (!cloudLocationId) {
      return NextResponse.json({ error: 'cloudLocationId is required' }, { status: 400 })
    }

    // Update the first (only) active location — each NUC has exactly one
    const location = await db.location.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    await db.location.update({
      where: { id: location.id },
      data: {
        cloudLocationId,
        cloudOrganizationId: cloudOrganizationId ?? null,
        cloudEnterpriseId: cloudEnterpriseId ?? null,
      },
    })

    return NextResponse.json({ updated: true, locationId: location.id })
  } catch (err) {
    console.error('[cloud-identity] POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
