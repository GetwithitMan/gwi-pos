import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { KDSScreenLinkCreateSchema, KDSScreenLinkUpdateSchema } from '@/lib/kds/types'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// GET — list screen links for a location or specific screen
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const screenId = searchParams.get('screenId')

    if (!locationId) {
      return err('locationId is required')
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

    return ok({
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
      })
  } catch (error) {
    console.error('Failed to fetch screen links:', error)
    return err('Failed to fetch screen links', 500)
  }
})

// POST — create a screen link
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId: bodyEmployeeId } = body

    if (!locationId) {
      return err('locationId is required')
    }

    // Auth
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Validate
    const parsed = KDSScreenLinkCreateSchema.safeParse(body)
    if (!parsed.success) {
      return err('Invalid link data', 400, parsed.error.flatten())
    }

    const { sourceScreenId, targetScreenId, linkType, bumpAction, resetStrikethroughsOnSend, isActive, sortOrder } = parsed.data

    // Cannot link screen to itself
    if (sourceScreenId === targetScreenId) {
      return err('Source and target screen must be different')
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
        return err('Cannot create reverse send_to_next link — would cause an infinite forwarding loop')
      }
    }

    // Verify both screens exist at the same location
    const [source, target] = await Promise.all([
      db.kDSScreen.findUnique({ where: { id: sourceScreenId }, select: { id: true, locationId: true } }),
      db.kDSScreen.findUnique({ where: { id: targetScreenId }, select: { id: true, locationId: true } }),
    ])

    if (!source || source.locationId !== locationId) {
      return err('Source screen not found at this location')
    }
    if (!target || target.locationId !== locationId) {
      return err('Target screen not found at this location')
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
      return err('A link with this source, target, and type already exists')
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

    return ok({
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
      })
  } catch (error) {
    console.error('Failed to create screen link:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return err('Duplicate link already exists')
    }
    return err('Failed to create screen link', 500)
  }
})

// PUT — update a screen link
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, locationId, employeeId: bodyEmployeeId } = body

    if (!id || !locationId) {
      return err('id and locationId are required')
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return err(auth.error, auth.status)

    const parsed = KDSScreenLinkUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return err('Invalid update data', 400, parsed.error.flatten())
    }

    const existing = await db.kDSScreenLink.findUnique({ where: { id } })
    if (!existing || existing.locationId !== locationId) {
      return notFound('Screen link not found')
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

    return ok({
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
      })
  } catch (error) {
    console.error('Failed to update screen link:', error)
    return err('Failed to update screen link', 500)
  }
})

// DELETE — soft delete a screen link
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, locationId, employeeId: bodyEmployeeId } = body

    if (!id || !locationId) {
      return err('id and locationId are required')
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return err(auth.error, auth.status)

    const existing = await db.kDSScreenLink.findUnique({ where: { id } })
    if (!existing || existing.locationId !== locationId) {
      return notFound('Screen link not found')
    }

    await db.kDSScreenLink.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete screen link:', error)
    return err('Failed to delete screen link', 500)
  }
})
