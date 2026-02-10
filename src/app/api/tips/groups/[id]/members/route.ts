/**
 * Tip Group Members API (Skill 252 - Phase 3)
 *
 * POST   - Add member to group OR request to join
 * PUT    - Approve a pending join request
 * DELETE - Remove member from group (or self-leave)
 */

import { NextRequest, NextResponse } from 'next/server'
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

// ─── POST: Add member OR request to join ─────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await params
    const body = await request.json()
    const { employeeId, action } = body

    // ── Validate required fields ──────────────────────────────────────────
    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required' },
        { status: 400 }
      )
    }

    if (!action || !['add', 'request'].includes(action)) {
      return NextResponse.json(
        { error: "action is required and must be 'add' or 'request'" },
        { status: 400 }
      )
    }

    const requestingEmployeeId = request.headers.get('x-employee-id')

    // ── Handle 'request' action (self-service join request) ─────────────
    if (action === 'request') {
      const result = await requestJoinGroup({ groupId, employeeId })

      return NextResponse.json({
        membershipId: result.membershipId,
        status: result.status,
      })
    }

    // ── Handle 'add' action (owner or manager adds member directly) ─────
    // Auth: must be group owner OR have TIPS_MANAGE_GROUPS permission
    const groupInfo = await getGroupInfo(groupId)
    if (!groupInfo) {
      return NextResponse.json(
        { error: 'Tip group not found' },
        { status: 404 }
      )
    }

    const isOwner = requestingEmployeeId === groupInfo.ownerId

    if (!isOwner) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        groupInfo.locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return NextResponse.json(
          { error: 'Not authorized. Only the group owner or a manager with tip management permission can add members.' },
          { status: 403 }
        )
      }
    }

    const group = await addMemberToGroup({
      groupId,
      employeeId,
      approvedBy: requestingEmployeeId || '',
    })

    // Fire-and-forget socket dispatch
    dispatchTipGroupUpdate(groupInfo.locationId, {
      action: 'member-joined',
      groupId,
      employeeId,
    }, { async: true }).catch(() => {})

    return NextResponse.json({ group })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    // Map domain errors to HTTP status codes
    if (message === 'TIP_GROUP_NOT_ACTIVE') {
      return NextResponse.json(
        { error: 'Tip group is not active' },
        { status: 409 }
      )
    }
    if (message === 'EMPLOYEE_ALREADY_MEMBER') {
      return NextResponse.json(
        { error: 'Employee is already a member of this group' },
        { status: 409 }
      )
    }
    if (message === 'EMPLOYEE_ALREADY_MEMBER_OR_PENDING') {
      return NextResponse.json(
        { error: 'Employee already has an active or pending membership in this group' },
        { status: 409 }
      )
    }

    console.error('Failed to add member to tip group:', error)
    return NextResponse.json(
      { error: 'Failed to add member to tip group' },
      { status: 500 }
    )
  }
}

// ─── PUT: Approve a pending join request ──────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await params
    const body = await request.json()
    const { employeeId } = body

    // ── Validate required fields ──────────────────────────────────────────
    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required' },
        { status: 400 }
      )
    }

    const requestingEmployeeId = request.headers.get('x-employee-id')

    // ── Auth: must be group owner OR have TIPS_MANAGE_GROUPS permission ──
    const groupInfo = await getGroupInfo(groupId)
    if (!groupInfo) {
      return NextResponse.json(
        { error: 'Tip group not found' },
        { status: 404 }
      )
    }

    const isOwner = requestingEmployeeId === groupInfo.ownerId

    if (!isOwner) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        groupInfo.locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return NextResponse.json(
          { error: 'Not authorized. Only the group owner or a manager with tip management permission can approve join requests.' },
          { status: 403 }
        )
      }
    }

    const group = await approveJoinRequest({
      groupId,
      employeeId,
      approvedBy: requestingEmployeeId || '',
    })

    // Fire-and-forget socket dispatch
    dispatchTipGroupUpdate(groupInfo.locationId, {
      action: 'member-joined',
      groupId,
      employeeId,
    }, { async: true }).catch(() => {})

    return NextResponse.json({ group })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message === 'NO_PENDING_REQUEST') {
      return NextResponse.json(
        { error: 'No pending join request found for this employee' },
        { status: 404 }
      )
    }
    if (message === 'TIP_GROUP_NOT_ACTIVE') {
      return NextResponse.json(
        { error: 'Tip group is not active' },
        { status: 409 }
      )
    }

    console.error('Failed to approve join request:', error)
    return NextResponse.json(
      { error: 'Failed to approve join request' },
      { status: 500 }
    )
  }
}

// ─── DELETE: Remove member / leave group ──────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await params
    const employeeId = request.nextUrl.searchParams.get('employeeId')

    // ── Validate required fields ──────────────────────────────────────────
    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId query parameter is required' },
        { status: 400 }
      )
    }

    const requestingEmployeeId = request.headers.get('x-employee-id')

    // ── Auth: self (leaving), group owner, or TIPS_MANAGE_GROUPS ─────────
    const isSelf = requestingEmployeeId === employeeId

    if (!isSelf) {
      const groupInfo = await getGroupInfo(groupId)
      if (!groupInfo) {
        return NextResponse.json(
          { error: 'Tip group not found' },
          { status: 404 }
        )
      }

      const isOwner = requestingEmployeeId === groupInfo.ownerId

      if (!isOwner) {
        const auth = await requireAnyPermission(
          requestingEmployeeId,
          groupInfo.locationId,
          [PERMISSIONS.TIPS_MANAGE_GROUPS]
        )
        if (!auth.authorized) {
          return NextResponse.json(
            { error: 'Not authorized. Only the employee themselves, the group owner, or a manager with tip management permission can remove members.' },
            { status: 403 }
          )
        }
      }
    }

    const group = await removeMemberFromGroup({ groupId, employeeId })
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

    if (locationId) {
      // Dispatch member-left
      dispatchTipGroupUpdate(locationId, {
        action: 'member-left',
        groupId,
        employeeId,
      }, { async: true }).catch(() => {})

      // If group was closed (last member left), also dispatch closed
      if (groupClosed) {
        dispatchTipGroupUpdate(locationId, {
          action: 'closed',
          groupId,
        }, { async: true }).catch(() => {})
      }
    }

    return NextResponse.json({
      group,
      groupClosed,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message === 'TIP_GROUP_NOT_ACTIVE') {
      return NextResponse.json(
        { error: 'Tip group is not active' },
        { status: 409 }
      )
    }
    if (message === 'EMPLOYEE_NOT_MEMBER') {
      return NextResponse.json(
        { error: 'Employee is not an active member of this group' },
        { status: 404 }
      )
    }

    console.error('Failed to remove member from tip group:', error)
    return NextResponse.json(
      { error: 'Failed to remove member from tip group' },
      { status: 500 }
    )
  }
}
