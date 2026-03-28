/**
 * Tip Group Transfer API
 *
 * POST - Transfer tip group ownership to another employee.
 * Optionally add the new employee to the group and remove the old owner.
 * Fixes the [SHIFT-6] blocker where the last owner can't clock out
 * because they own the tip group.
 *
 * IMPORTANT: Tip ledger entries are IMMUTABLE. This endpoint only changes
 * group membership and ownership — never modifies ledger entries.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  getGroupInfo,
  transferGroupOwnership,
  addMemberToGroup,
  removeMemberFromGroup,
} from '@/lib/domain/tips/tip-groups'
import { dispatchTipGroupUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok, unauthorized } from '@/lib/api-response'
const log = createChildLogger('tips-groups-transfer')

interface TransferPayload {
  toEmployeeId: string
  removeFromEmployee?: boolean // If true, remove the old owner from the group after transfer
}

export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await params
    const body = await request.json() as TransferPayload
    const { toEmployeeId, removeFromEmployee } = body

    const requestingEmployeeId = request.headers.get('x-employee-id')

    if (!requestingEmployeeId) {
      return unauthorized('Employee ID is required (x-employee-id header)')
    }

    if (!toEmployeeId) {
      return err('toEmployeeId is required')
    }

    // ── Fetch the group ─────────────────────────────────────────────────
    const group = await getGroupInfo(groupId)

    if (!group) {
      return notFound('Tip group not found')
    }

    if (group.status !== 'active') {
      return err('Tip group is not active', 409)
    }

    // ── Auth: group owner OR TIPS_MANAGE_GROUPS permission ──────────────
    const isOwner = group.ownerId === requestingEmployeeId
    if (!isOwner) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        group.locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return forbidden('Not authorized. Must be group owner or have tip management permission.')
      }
    }

    // ── Self-transfer guard ─────────────────────────────────────────────
    if (group.ownerId === toEmployeeId) {
      return err('This employee is already the group owner')
    }

    // ── Validate destination employee exists and has an open shift ───────
    const toEmployee = await db.employee.findFirst({
      where: {
        id: toEmployeeId,
        locationId: group.locationId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      },
    })

    if (!toEmployee) {
      return notFound('Destination employee not found or inactive')
    }

    const toShift = await db.shift.findFirst({
      where: {
        employeeId: toEmployeeId,
        locationId: group.locationId,
        status: 'open',
      },
      select: { id: true },
    })

    if (!toShift) {
      return err('Destination employee does not have an open shift')
    }

    // ── Check if toEmployee is already a member ─────────────────────────
    const isMember = group.members.some(
      (m) => m.employeeId === toEmployeeId && m.status === 'active'
    )

    // If not a member, add them to the group first
    if (!isMember) {
      try {
        await addMemberToGroup({
          groupId,
          employeeId: toEmployeeId,
          approvedBy: requestingEmployeeId,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message === 'EMPLOYEE_ALREADY_MEMBER') {
          // Race condition — already added, continue
        } else {
          throw err
        }
      }
    }

    // ── Transfer ownership ──────────────────────────────────────────────
    await transferGroupOwnership({ groupId, newOwnerId: toEmployeeId })

    // ── Optionally remove old owner from the group ──────────────────────
    const previousOwnerId = group.ownerId
    if (removeFromEmployee && previousOwnerId !== toEmployeeId) {
      try {
        await removeMemberFromGroup({
          groupId,
          employeeId: previousOwnerId,
        })
      } catch (err) {
        // If removal fails (e.g., already left), log but don't block
        console.warn(`[TipGroupTransfer] Failed to remove previous owner ${previousOwnerId}:`, err)
      }
    }

    // ── Audit log ───────────────────────────────────────────────────────
    await db.auditLog.create({
      data: {
        locationId: group.locationId,
        employeeId: requestingEmployeeId,
        action: 'tip_group_transferred',
        entityType: 'tip_group',
        entityId: groupId,
        details: {
          groupId,
          fromOwnerId: previousOwnerId,
          toOwnerId: toEmployeeId,
          removeFromEmployee: !!removeFromEmployee,
          addedAsMember: !isMember,
        },
      },
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('TipGroup', group.locationId, groupId, 'UPDATE')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }
    pushUpstream()

    // ── Socket dispatch (fire-and-forget) ───────────────────────────────
    void dispatchTipGroupUpdate(group.locationId, {
      action: 'ownership-transferred',
      groupId,
      newOwnerId: toEmployeeId,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    // ── Return updated group info ───────────────────────────────────────
    const updatedGroup = await getGroupInfo(groupId)

    const toName = toEmployee.displayName ||
      `${toEmployee.firstName} ${toEmployee.lastName}`

    return ok({
        success: true,
        group: updatedGroup,
        transferredTo: { id: toEmployeeId, name: toName },
        previousOwnerId,
      })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message === 'NEW_OWNER_NOT_ACTIVE_MEMBER') {
      return err('New owner must be an active member of the group')
    }

    console.error('Failed to transfer tip group:', error)
    return err('Failed to transfer tip group', 500)
  }
}))
