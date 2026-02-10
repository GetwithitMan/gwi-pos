/**
 * Tip Group Detail API (Skill 252 - Phase 3)
 *
 * GET    - Get group details
 * PUT    - Update group (transfer ownership, change split mode)
 * DELETE - Close group
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import {
  getGroupInfo,
  transferGroupOwnership,
  closeGroup,
} from '@/lib/domain/tips/tip-groups'
import { dispatchTipGroupUpdate } from '@/lib/socket-dispatch'

// ─── GET: Get group details ─────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const requestingEmployeeId = request.headers.get('x-employee-id')

    if (!requestingEmployeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 401 }
      )
    }

    // ── Fetch group ───────────────────────────────────────────────────────

    const group = await getGroupInfo(id)

    if (!group) {
      return NextResponse.json(
        { error: 'Tip group not found' },
        { status: 404 }
      )
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
        return NextResponse.json(
          { error: 'Not authorized. Must be a group member or have tip management permission.' },
          { status: 403 }
        )
      }
    }

    return NextResponse.json({ group })
  } catch (error) {
    console.error('Failed to get tip group:', error)
    return NextResponse.json(
      { error: 'Failed to get tip group' },
      { status: 500 }
    )
  }
}

// ─── PUT: Update group (transfer ownership, change split mode) ──────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { newOwnerId, splitMode } = body
    const requestingEmployeeId = request.headers.get('x-employee-id')

    if (!requestingEmployeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 401 }
      )
    }

    // ── Validate at least one field ───────────────────────────────────────

    if (!newOwnerId && !splitMode) {
      return NextResponse.json(
        { error: 'At least one of newOwnerId or splitMode is required' },
        { status: 400 }
      )
    }

    // ── Fetch group ───────────────────────────────────────────────────────

    const existingGroup = await getGroupInfo(id)

    if (!existingGroup) {
      return NextResponse.json(
        { error: 'Tip group not found' },
        { status: 404 }
      )
    }

    if (existingGroup.status !== 'active') {
      return NextResponse.json(
        { error: 'Tip group is not active' },
        { status: 409 }
      )
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
        return NextResponse.json(
          { error: 'Not authorized. Must be group owner or have tip management permission.' },
          { status: 403 }
        )
      }
    }

    // ── Transfer ownership ────────────────────────────────────────────────

    if (newOwnerId) {
      try {
        await transferGroupOwnership({ groupId: id, newOwnerId })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message === 'NEW_OWNER_NOT_ACTIVE_MEMBER') {
          return NextResponse.json(
            { error: 'New owner must be an active member of the group' },
            { status: 400 }
          )
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

    // ── Return updated group ──────────────────────────────────────────────

    const updatedGroup = await getGroupInfo(id)

    return NextResponse.json({ group: updatedGroup })
  } catch (error) {
    console.error('Failed to update tip group:', error)
    return NextResponse.json(
      { error: 'Failed to update tip group' },
      { status: 500 }
    )
  }
}

// ─── DELETE: Close group ────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const requestingEmployeeId = request.headers.get('x-employee-id')

    if (!requestingEmployeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 401 }
      )
    }

    // ── Fetch group ───────────────────────────────────────────────────────

    const existingGroup = await getGroupInfo(id)

    if (!existingGroup) {
      return NextResponse.json(
        { error: 'Tip group not found' },
        { status: 404 }
      )
    }

    if (existingGroup.status !== 'active') {
      return NextResponse.json(
        { error: 'Tip group is already closed' },
        { status: 409 }
      )
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
        return NextResponse.json(
          { error: 'Not authorized. Must be group owner or have tip management permission.' },
          { status: 403 }
        )
      }
    }

    // ── Close the group ───────────────────────────────────────────────────

    await closeGroup(id)

    // ── Socket dispatch (fire-and-forget) ─────────────────────────────────

    dispatchTipGroupUpdate(
      existingGroup.locationId,
      { action: 'closed', groupId: id },
      { async: true }
    ).catch((err) => console.error('[TipGroups] Socket dispatch failed:', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to close tip group:', error)
    return NextResponse.json(
      { error: 'Failed to close tip group' },
      { status: 500 }
    )
  }
}
