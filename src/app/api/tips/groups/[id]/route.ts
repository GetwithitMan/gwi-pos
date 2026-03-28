/**
 * Tip Group Detail API (Skill 252 - Phase 3)
 *
 * GET    - Get group details
 * PUT    - Update group (transfer ownership, change split mode)
 * DELETE - Close group
 */

import { NextRequest } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import {
  getGroupInfo,
  transferGroupOwnership,
  closeGroup,
} from '@/lib/domain/tips/tip-groups'
import { dispatchTipGroupUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, forbidden, notFound, ok, unauthorized } from '@/lib/api-response'

// ─── GET: Get group details ─────────────────────────────────────────────────

export const GET = withVenue(withAuth({ allowCellular: true }, async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const requestingEmployeeId = request.headers.get('x-employee-id')

    if (!requestingEmployeeId) {
      return unauthorized('Employee ID is required')
    }

    // ── Fetch group ───────────────────────────────────────────────────────

    const group = await getGroupInfo(id)

    if (!group) {
      return notFound('Tip group not found')
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Any member of the group, OR TIPS_MANAGE_GROUPS permission
    const isMember = group.members.some(
      (m) => m.employeeId === requestingEmployeeId
    )

    if (!isMember) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        group.locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return forbidden('Not authorized. Must be a group member or have tip management permission.')
      }
    }

    // ── Load all segments with per-member earnings ─────────────────────
    const includeEarnings = request.nextUrl.searchParams.get('includeEarnings') !== 'false'

    let segments: Array<{
      id: string
      startedAt: string
      endedAt: string | null
      memberCount: number
      splitJson: Record<string, number>
      earnings: Array<{ employeeId: string; totalCents: number }>
    }> = []

    if (includeEarnings) {
      const allSegments = await db.tipGroupSegment.findMany({
        where: { groupId: id, deletedAt: null },
        orderBy: { startedAt: 'asc' },
      })

      segments = await Promise.all(allSegments.map(async (seg) => {
        // Aggregate TipLedgerEntry records for this segment's time window
        const segEnd = seg.endedAt || new Date()
        const memberIds = Object.keys((seg.splitJson as Record<string, number>) || {})

        let earnings: Array<{ employeeId: string; totalCents: number }> = []
        if (memberIds.length > 0) {
          const grouped = await db.tipLedgerEntry.groupBy({
            by: ['employeeId'],
            where: {
              sourceType: 'TIP_GROUP',
              employeeId: { in: memberIds },
              createdAt: { gte: seg.startedAt, lt: segEnd },
              deletedAt: null,
            },
            _sum: { amountCents: true },
          })

          earnings = grouped.map(g => ({
            employeeId: g.employeeId,
            totalCents: Number(g._sum.amountCents) || 0,
          }))
        }

        return {
          id: seg.id,
          startedAt: seg.startedAt.toISOString(),
          endedAt: seg.endedAt?.toISOString() || null,
          memberCount: seg.memberCount,
          splitJson: seg.splitJson as Record<string, number>,
          earnings,
        }
      }))
    }

    return ok({ group, segments })
  } catch (error) {
    console.error('Failed to get tip group:', error)
    return err('Failed to get tip group', 500)
  }
}))

// ─── PUT: Update group (transfer ownership, change split mode) ──────────────

export const PUT = withVenue(withAuth({ allowCellular: true }, async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { newOwnerId, splitMode } = body
    const requestingEmployeeId = request.headers.get('x-employee-id')

    if (!requestingEmployeeId) {
      return unauthorized('Employee ID is required')
    }

    // ── Validate at least one field ───────────────────────────────────────

    if (!newOwnerId && !splitMode) {
      return err('At least one of newOwnerId or splitMode is required')
    }

    // ── Fetch group ───────────────────────────────────────────────────────

    const existingGroup = await getGroupInfo(id)

    if (!existingGroup) {
      return notFound('Tip group not found')
    }

    if (existingGroup.status !== 'active') {
      return err('Tip group is not active', 409)
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Group owner OR TIPS_MANAGE_GROUPS permission
    const isOwner = existingGroup.ownerId === requestingEmployeeId

    if (!isOwner) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        existingGroup.locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return forbidden('Not authorized. Must be group owner or have tip management permission.')
      }
    }

    // ── Transfer ownership ────────────────────────────────────────────────

    if (newOwnerId) {
      try {
        await transferGroupOwnership({ groupId: id, newOwnerId })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message === 'NEW_OWNER_NOT_ACTIVE_MEMBER') {
          return err('New owner must be an active member of the group')
        }
        throw err
      }

      // Socket dispatch (fire-and-forget)
      dispatchTipGroupUpdate(
        existingGroup.locationId,
        { action: 'ownership-transferred', groupId: id, newOwnerId },
        { async: true }
      ).catch((err) => console.error('[TipGroups] Socket dispatch failed:', err))
    }

    // ── Update split mode ─────────────────────────────────────────────────

    if (splitMode) {
      await db.tipGroup.update({
        where: { id },
        data: { splitMode },
      })
    }

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('TipGroup', existingGroup.locationId, id, 'UPDATE')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    pushUpstream()

    // ── Return updated group ──────────────────────────────────────────────

    const updatedGroup = await getGroupInfo(id)

    return ok({ group: updatedGroup })
  } catch (error) {
    console.error('Failed to update tip group:', error)
    return err('Failed to update tip group', 500)
  }
}))

// ─── DELETE: Close group ────────────────────────────────────────────────────

export const DELETE = withVenue(withAuth({ allowCellular: true }, async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const requestingEmployeeId = request.headers.get('x-employee-id')

    if (!requestingEmployeeId) {
      return unauthorized('Employee ID is required')
    }

    // ── Fetch group ───────────────────────────────────────────────────────

    const existingGroup = await getGroupInfo(id)

    if (!existingGroup) {
      return notFound('Tip group not found')
    }

    if (existingGroup.status !== 'active') {
      return err('Tip group is already closed', 409)
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Group owner OR TIPS_MANAGE_GROUPS permission
    const isOwner = existingGroup.ownerId === requestingEmployeeId

    if (!isOwner) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        existingGroup.locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return forbidden('Not authorized. Must be group owner or have tip management permission.')
      }
    }

    // ── Close the group ───────────────────────────────────────────────────

    await closeGroup(id)

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('TipGroup', existingGroup.locationId, id, 'UPDATE')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    pushUpstream()

    // ── Socket dispatch (fire-and-forget) ─────────────────────────────────

    dispatchTipGroupUpdate(
      existingGroup.locationId,
      { action: 'closed', groupId: id },
      { async: true }
    ).catch((err) => console.error('[TipGroups] Socket dispatch failed:', err))

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to close tip group:', error)
    return err('Failed to close tip group', 500)
  }
}))
