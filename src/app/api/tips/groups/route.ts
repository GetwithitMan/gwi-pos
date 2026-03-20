/**
 * Tip Groups API (Skill 252 - Phase 3)
 *
 * GET  - List active tip groups for a location
 * POST - Start a new tip group
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TipGroupStatus } from '@/generated/prisma/client'
import { startTipGroup } from '@/lib/domain/tips/tip-groups'
import type { TipGroupInfo } from '@/lib/domain/tips/tip-groups'
import { dispatchTipGroupUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { queueIfOutageOrFail, OutageQueueFullError } from '@/lib/sync/outage-safe-write'

// ─── GET: List active tip groups for a location ─────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = (searchParams.get('status') || 'active') as TipGroupStatus

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // ── Auth check ────────────────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId || request.headers.get('x-employee-id')
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // ── Query groups ──────────────────────────────────────────────────────

    const groups = await db.tipGroup.findMany({
      where: {
        locationId,
        status,
        deletedAt: null,
      },
      include: {
        template: {
          select: { name: true },
        },
        memberships: {
          where: { deletedAt: null },
          include: {
            employee: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
        segments: {
          where: {
            endedAt: null,
            deletedAt: null,
          },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { startedAt: 'desc' },
    })

    // ── Map to TipGroupInfo shape ─────────────────────────────────────────

    const groupInfos: TipGroupInfo[] = groups.map((group) => {
      const members = group.memberships.map((m) => ({
        id: m.id,
        employeeId: m.employeeId,
        firstName: m.employee.firstName,
        lastName: m.employee.lastName,
        displayName: m.employee.displayName,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
        status: m.status,
        role: m.role,
      }))

      const currentSeg = group.segments[0] ?? null
      const currentSegment = currentSeg
        ? {
            id: currentSeg.id,
            startedAt: currentSeg.startedAt,
            endedAt: currentSeg.endedAt,
            memberCount: currentSeg.memberCount,
            splitJson: currentSeg.splitJson as Record<string, number>,
          }
        : null

      return {
        id: group.id,
        locationId: group.locationId,
        createdBy: group.createdBy,
        ownerId: group.ownerId,
        registerId: group.registerId,
        startedAt: group.startedAt,
        endedAt: group.endedAt,
        status: group.status,
        splitMode: group.splitMode,
        templateName: group.template?.name ?? null,
        members,
        currentSegment,
      }
    })

    return NextResponse.json({ groups: groupInfos })
  } catch (error) {
    console.error('Failed to list tip groups:', error)
    return NextResponse.json(
      { error: 'Failed to list tip groups' },
      { status: 500 }
    )
  }
})

// ─── POST: Start a new tip group ────────────────────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, initialMemberIds, registerId, splitMode, customSplits } = body

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!initialMemberIds || !Array.isArray(initialMemberIds)) {
      return NextResponse.json(
        { error: 'initialMemberIds is required and must be an array' },
        { status: 400 }
      )
    }

    // ── Auth check ────────────────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId || request.headers.get('x-employee-id')
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // ── Validate custom splits if provided ────────────────────────────
    if (splitMode === 'custom' && !customSplits) {
      return NextResponse.json(
        { error: "customSplits is required when splitMode is 'custom'" },
        { status: 400 }
      )
    }

    if (customSplits && typeof customSplits !== 'object') {
      return NextResponse.json(
        { error: 'customSplits must be an object mapping employeeId to decimal percentage' },
        { status: 400 }
      )
    }

    // ── Create the group ──────────────────────────────────────────────────

    const group = await startTipGroup({
      locationId,
      createdBy: requestingEmployeeId!,
      initialMemberIds,
      registerId: registerId || undefined,
      splitMode: splitMode || undefined,
      customSplits: customSplits || undefined,
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('TipGroup', locationId, group.id, 'INSERT')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return NextResponse.json({ error: 'Service temporarily unavailable — outage queue full' }, { status: 507 })
      }
      throw err
    }

    // ── Socket dispatch (fire-and-forget) ─────────────────────────────────

    dispatchTipGroupUpdate(
      locationId,
      { action: 'created', groupId: group.id },
      { async: true }
    ).catch((err) => console.error('[TipGroups] Socket dispatch failed:', err))

    return NextResponse.json({ group }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message === 'EMPLOYEE_IN_ANOTHER_GROUP') {
      return NextResponse.json(
        { error: 'One or more employees are already in an active tip group. They must leave that group first.' },
        { status: 409 }
      )
    }
    console.error('Failed to create tip group:', error)
    return NextResponse.json(
      { error: 'Failed to create tip group' },
      { status: 500 }
    )
  }
})
