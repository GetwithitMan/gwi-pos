import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { KDSScreenLinkCreateSchema, KDSScreenLinkUpdateSchema } from '@/lib/kds/types'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET — list screen links for a location or specific screen
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const screenId = searchParams.get('screenId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const links = await db.kDSScreenLink.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(screenId ? { sourceScreenId: screenId } : {}),
      },
      include: {
        sourceScreen: { select: { id: true, name: true } },
        targetScreen: { select: { id: true, name: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json({
      data: {
        links: links.map(l => ({
          id: l.id,
          locationId: l.locationId,
          sourceScreenId: l.sourceScreenId,
          sourceScreenName: l.sourceScreen.name,
          targetScreenId: l.targetScreenId,
          targetScreenName: l.targetScreen.name,
          linkType: l.linkType,
          bumpAction: l.bumpAction,
          resetStrikethroughsOnSend: l.resetStrikethroughsOnSend,
          isActive: l.isActive,
          sortOrder: l.sortOrder,
        })),
      },
    })
  } catch (error) {
    console.error('Failed to fetch screen links:', error)
    return NextResponse.json({ error: 'Failed to fetch screen links' }, { status: 500 })
  }
})

// POST — create a screen link
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId: bodyEmployeeId } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Auth
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Validate
    const parsed = KDSScreenLinkCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid link data', details: parsed.error.flatten() }, { status: 400 })
    }

    const { sourceScreenId, targetScreenId, linkType, bumpAction, resetStrikethroughsOnSend, isActive, sortOrder } = parsed.data

    // Cannot link screen to itself
    if (sourceScreenId === targetScreenId) {
      return NextResponse.json({ error: 'Source and target screen must be different' }, { status: 400 })
    }

    // Cycle detection: prevent reverse send_to_next links (Kitchen→Expo AND Expo→Kitchen = infinite loop)
    if (linkType === 'send_to_next') {
      const reverseLink = await db.kDSScreenLink.findFirst({
        where: {
          sourceScreenId: targetScreenId,
          targetScreenId: sourceScreenId,
          linkType: 'send_to_next',
          deletedAt: null,
        },
      })
      if (reverseLink) {
        return NextResponse.json({ error: 'Cannot create reverse send_to_next link — would cause an infinite forwarding loop' }, { status: 400 })
      }
    }

    // Verify both screens exist at the same location
    const [source, target] = await Promise.all([
      db.kDSScreen.findUnique({ where: { id: sourceScreenId }, select: { id: true, locationId: true } }),
      db.kDSScreen.findUnique({ where: { id: targetScreenId }, select: { id: true, locationId: true } }),
    ])

    if (!source || source.locationId !== locationId) {
      return NextResponse.json({ error: 'Source screen not found at this location' }, { status: 400 })
    }
    if (!target || target.locationId !== locationId) {
      return NextResponse.json({ error: 'Target screen not found at this location' }, { status: 400 })
    }

    // Check for duplicate (same source→target→linkType that isn't soft-deleted)
    const existing = await db.kDSScreenLink.findFirst({
      where: {
        sourceScreenId,
        targetScreenId,
        linkType,
        deletedAt: null,
      },
    })
    if (existing) {
      return NextResponse.json({ error: 'A link with this source, target, and type already exists' }, { status: 400 })
    }

    const link = await db.kDSScreenLink.create({
      data: {
        locationId,
        sourceScreenId,
        targetScreenId,
        linkType,
        bumpAction,
        resetStrikethroughsOnSend,
        isActive,
        sortOrder,
      },
      include: {
        sourceScreen: { select: { id: true, name: true } },
        targetScreen: { select: { id: true, name: true } },
      },
    })

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'created', entityId: link.id })
    void pushUpstream()

    return NextResponse.json({
      data: {
        link: {
          id: link.id,
          locationId: link.locationId,
          sourceScreenId: link.sourceScreenId,
          sourceScreenName: link.sourceScreen.name,
          targetScreenId: link.targetScreenId,
          targetScreenName: link.targetScreen.name,
          linkType: link.linkType,
          bumpAction: link.bumpAction,
          resetStrikethroughsOnSend: link.resetStrikethroughsOnSend,
          isActive: link.isActive,
          sortOrder: link.sortOrder,
        },
      },
    })
  } catch (error) {
    console.error('Failed to create screen link:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Duplicate link already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create screen link' }, { status: 500 })
  }
})

// PUT — update a screen link
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, locationId, employeeId: bodyEmployeeId } = body

    if (!id || !locationId) {
      return NextResponse.json({ error: 'id and locationId are required' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const parsed = KDSScreenLinkUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid update data', details: parsed.error.flatten() }, { status: 400 })
    }

    const existing = await db.kDSScreenLink.findUnique({ where: { id } })
    if (!existing || existing.locationId !== locationId) {
      return NextResponse.json({ error: 'Screen link not found' }, { status: 404 })
    }

    const updated = await db.kDSScreenLink.update({
      where: { id },
      data: parsed.data,
      include: {
        sourceScreen: { select: { id: true, name: true } },
        targetScreen: { select: { id: true, name: true } },
      },
    })

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'updated', entityId: id })
    void pushUpstream()

    return NextResponse.json({
      data: {
        link: {
          id: updated.id,
          locationId: updated.locationId,
          sourceScreenId: updated.sourceScreenId,
          sourceScreenName: updated.sourceScreen.name,
          targetScreenId: updated.targetScreenId,
          targetScreenName: updated.targetScreen.name,
          linkType: updated.linkType,
          bumpAction: updated.bumpAction,
          resetStrikethroughsOnSend: updated.resetStrikethroughsOnSend,
          isActive: updated.isActive,
          sortOrder: updated.sortOrder,
        },
      },
    })
  } catch (error) {
    console.error('Failed to update screen link:', error)
    return NextResponse.json({ error: 'Failed to update screen link' }, { status: 500 })
  }
})

// DELETE — soft delete a screen link
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, locationId, employeeId: bodyEmployeeId } = body

    if (!id || !locationId) {
      return NextResponse.json({ error: 'id and locationId are required' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const existing = await db.kDSScreenLink.findUnique({ where: { id } })
    if (!existing || existing.locationId !== locationId) {
      return NextResponse.json({ error: 'Screen link not found' }, { status: 404 })
    }

    await db.kDSScreenLink.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'deleted', entityId: id })
    void pushUpstream()

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete screen link:', error)
    return NextResponse.json({ error: 'Failed to delete screen link' }, { status: 500 })
  }
})
