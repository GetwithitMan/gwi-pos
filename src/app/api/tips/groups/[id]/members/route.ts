/**
 * Tip Group Members API (Skill 252 - Phase 3)
 *
 * POST   - Add member to group OR request to join
 * PUT    - Approve a pending join request
 * DELETE - Remove member from group (or self-leave)
 */

import { NextRequest } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  addMemberToGroup,
  removeMemberFromGroup,
  requestJoinGroup,
  approveJoinRequest,
  getGroupInfo,
} from '@/lib/domain/tips/tip-groups'
import { dispatchTipGroupUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { queueIfOutageOrFail, OutageQueueFullError } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('tips.groups.id.members')

// ─── POST: Add member OR request to join ─────────────────────────────────────

export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await params
    const body = await request.json()
    const { employeeId, action } = body

    // ── Validate required fields ──────────────────────────────────────────
    if (!employeeId) {
      return err('employeeId is required')
    }

    if (!action || !['add', 'request'].includes(action)) {
      return err("action is required and must be 'add' or 'request'")
    }

    const requestingEmployeeId = request.headers.get('x-employee-id')

    // ── Handle 'request' action (self-service join request) ─────────────
    if (action === 'request') {
      // Skill 279: Self-join only — prevent spoofing
      if (requestingEmployeeId && requestingEmployeeId !== employeeId) {
        const groupInfo = await getGroupInfo(groupId)
        const groupLocationId = groupInfo?.locationId
        if (groupLocationId) {
          const auth = await requireAnyPermission(requestingEmployeeId, groupLocationId, [PERMISSIONS.TIPS_MANAGE_GROUPS])
          if (!auth.authorized) {
            return forbidden('Can only request to join a group for yourself')
          }
        } else {
          return notFound('Tip group not found')
        }
      }

      const result = await requestJoinGroup({ groupId, employeeId })

      return ok({
        membershipId: result.membershipId,
        status: result.status,
      })
    }

    // ── Handle 'add' action (owner or manager adds member directly) ─────
    // Auth: must be group owner OR have TIPS_MANAGE_GROUPS permission
    const groupInfo = await getGroupInfo(groupId)
    if (!groupInfo) {
      return notFound('Tip group not found')
    }

    const isOwner = requestingEmployeeId === groupInfo.ownerId

    if (!isOwner) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        groupInfo.locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return forbidden('Not authorized. Only the group owner or a manager with tip management permission can add members.')
      }
    }

    const group = await addMemberToGroup({
      groupId,
      employeeId,
      approvedBy: requestingEmployeeId || '',
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('TipGroup', groupInfo.locationId, groupId, 'UPDATE')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    // Fire-and-forget socket dispatch
    dispatchTipGroupUpdate(groupInfo.locationId, {
      action: 'member-joined',
      groupId,
      employeeId,
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in tips.groups.id.members'))

    return ok({ group })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    // Map domain errors to HTTP status codes
    if (message === 'TIP_GROUP_NOT_ACTIVE') {
      return err('Tip group is not active', 409)
    }
    if (message === 'EMPLOYEE_ALREADY_MEMBER') {
      return err('Employee is already a member of this group', 409)
    }
    if (message === 'EMPLOYEE_ALREADY_MEMBER_OR_PENDING') {
      return err('Employee already has an active or pending membership in this group', 409)
    }
    if (message === 'EMPLOYEE_IN_ANOTHER_GROUP') {
      return err('Employee is already in another active tip group. They must leave that group first.', 409)
    }

    console.error('Failed to add member to tip group:', error)
    return err('Failed to add member to tip group', 500)
  }
}))

// ─── PUT: Approve a pending join request ──────────────────────────────────────

export const PUT = withVenue(withAuth({ allowCellular: true }, async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await params
    const body = await request.json()
    const { employeeId } = body

    // ── Validate required fields ──────────────────────────────────────────
    if (!employeeId) {
      return err('employeeId is required')
    }

    const requestingEmployeeId = request.headers.get('x-employee-id')

    // ── Auth: must be group owner OR have TIPS_MANAGE_GROUPS permission ──
    const groupInfo = await getGroupInfo(groupId)
    if (!groupInfo) {
      return notFound('Tip group not found')
    }

    const isOwner = requestingEmployeeId === groupInfo.ownerId

    if (!isOwner) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        groupInfo.locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return forbidden('Not authorized. Only the group owner or a manager with tip management permission can approve join requests.')
      }
    }

    const group = await approveJoinRequest({
      groupId,
      employeeId,
      approvedBy: requestingEmployeeId || '',
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('TipGroup', groupInfo.locationId, groupId, 'UPDATE')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    // Fire-and-forget socket dispatch
    dispatchTipGroupUpdate(groupInfo.locationId, {
      action: 'member-joined',
      groupId,
      employeeId,
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in tips.groups.id.members'))

    return ok({ group })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message === 'NO_PENDING_REQUEST') {
      return notFound('No pending join request found for this employee')
    }
    if (message === 'TIP_GROUP_NOT_ACTIVE') {
      return err('Tip group is not active', 409)
    }
    if (message === 'EMPLOYEE_IN_ANOTHER_GROUP') {
      return err('Employee is already in another active tip group. They must leave that group first.', 409)
    }

    console.error('Failed to approve join request:', error)
    return err('Failed to approve join request', 500)
  }
}))

// ─── DELETE: Remove member / leave group ──────────────────────────────────────

export const DELETE = withVenue(withAuth({ allowCellular: true }, async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await params
    const employeeId = request.nextUrl.searchParams.get('employeeId')
    const leftAtParam = request.nextUrl.searchParams.get('leftAt')

    // ── Validate required fields ──────────────────────────────────────────
    if (!employeeId) {
      return err('employeeId query parameter is required')
    }

    // ── Parse and validate optional leftAt override ─────────────────────
    let overrideLeftAt: Date | undefined
    if (leftAtParam) {
      const parsed = new Date(leftAtParam)
      if (isNaN(parsed.getTime())) {
        return err('leftAt must be a valid ISO 8601 timestamp')
      }
      if (parsed.getTime() > Date.now()) {
        return err('leftAt must be in the past')
      }
      overrideLeftAt = parsed
    }

    const requestingEmployeeId = request.headers.get('x-employee-id')

    // ── Auth: self (leaving), group owner, or TIPS_MANAGE_GROUPS ─────────
    const isSelf = requestingEmployeeId === employeeId

    if (!isSelf) {
      const groupInfo = await getGroupInfo(groupId)
      if (!groupInfo) {
        return notFound('Tip group not found')
      }

      const isOwner = requestingEmployeeId === groupInfo.ownerId

      if (!isOwner) {
        const auth = await requireAnyPermission(
          requestingEmployeeId,
          groupInfo.locationId,
          [PERMISSIONS.TIPS_MANAGE_GROUPS]
        )
        if (!auth.authorized) {
          return forbidden('Not authorized. Only the employee themselves, the group owner, or a manager with tip management permission can remove members.')
        }
      }
    }

    // ── Override leftAt requires TIPS_MANAGE_GROUPS (even for self-leave) ──
    if (overrideLeftAt && isSelf) {
      const groupInfo = await getGroupInfo(groupId)
      if (groupInfo) {
        const auth = await requireAnyPermission(
          requestingEmployeeId,
          groupInfo.locationId,
          [PERMISSIONS.TIPS_MANAGE_GROUPS]
        )
        if (!auth.authorized) {
          return forbidden('Retroactive leave time requires tip management permission')
        }
      }
    }

    const group = await removeMemberFromGroup({ groupId, employeeId, overrideLeftAt })
    const groupClosed = group === null

    // Fetch locationId for socket dispatch
    // If group was closed, we need the locationId from before closure
    // Use a fresh getGroupInfo if group is still open, otherwise fetch from the group that was just returned
    let locationId: string | null = null
    if (!groupClosed && group) {
      locationId = group.locationId
    } else {
      // Group was closed — we need to look it up (even closed groups still exist in DB)
      const closedGroupInfo = await getGroupInfo(groupId)
      locationId = closedGroupInfo?.locationId ?? null
    }

    // ── Outage queue protection ────────────────────────────────────────────
    if (locationId) {
      try {
        await queueIfOutageOrFail('TipGroup', locationId, groupId, 'UPDATE')
      } catch (err) {
        if (err instanceof OutageQueueFullError) {
          return err('Service temporarily unavailable — outage queue full', 507)
        }
        throw err
      }
    }

    if (locationId) {
      // Dispatch member-left
      dispatchTipGroupUpdate(locationId, {
        action: 'member-left',
        groupId,
        employeeId,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in tips.groups.id.members'))
      if (groupClosed) {
        dispatchTipGroupUpdate(locationId, {
          action: 'closed',
          groupId,
        }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in tips.groups.id.members'))
      }
    }

    return ok({
      group,
      groupClosed,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message === 'TIP_GROUP_NOT_ACTIVE') {
      return err('Tip group is not active', 409)
    }
    if (message === 'EMPLOYEE_NOT_MEMBER') {
      return notFound('Employee is not an active member of this group')
    }

    console.error('Failed to remove member from tip group:', error)
    return err('Failed to remove member from tip group', 500)
  }
}))
