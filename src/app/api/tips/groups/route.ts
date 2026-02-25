/**
 * Tip Groups API (Skill 252 - Phase 3)
 *
 * GET  - List active tip groups for a location
 * POST - Start a new tip group
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { TipGroupStatus } from '@prisma/client'
import { startTipGroup } from '@/lib/domain/tips/tip-groups'
import type { TipGroupInfo } from '@/lib/domain/tips/tip-groups'
import { dispatchTipGroupUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

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
    // Any clocked-in employee at this location can view groups
    const requestingEmployeeId = request.headers.get('x-employee-id')
    if (!requestingEmployeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 401 }
      )
    }

    // Verify employee belongs to location
    const employee = await db.employee.findFirst({
      where: {
        id: requestingEmployeeId,
        locationId,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found at this location' },
        { status: 403 }
      )
    }

    // ── Query groups ──────────────────────────────────────────────────────

    const groups = await db.tipGroup.findMany({
      where: {
        locationId,
        status,
        deletedAt: null,
      },
      include: {
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
    const { locationId, initialMemberIds, registerId, splitMode } = body

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
    // The requesting employee becomes the creator
    const requestingEmployeeId = request.headers.get('x-employee-id')
    if (!requestingEmployeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 401 }
      )
    }

    // Verify employee belongs to location
    const employee = await db.employee.findFirst({
      where: {
        id: requestingEmployeeId,
        locationId,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found at this location' },
        { status: 403 }
      )
    }

    // ── Create the group ──────────────────────────────────────────────────

    const group = await startTipGroup({
      locationId,
      createdBy: requestingEmployeeId,
      initialMemberIds,
      registerId: registerId || undefined,
      splitMode: splitMode || undefined,
    })

    // ── Socket dispatch (fire-and-forget) ─────────────────────────────────

    dispatchTipGroupUpdate(
      locationId,
      { action: 'created', groupId: group.id },
      { async: true }
    ).catch((err) => console.error('[TipGroups] Socket dispatch failed:', err))

    return NextResponse.json({ group }, { status: 201 })
  } catch (error) {
    console.error('Failed to create tip group:', error)
    return NextResponse.json(
      { error: 'Failed to create tip group' },
      { status: 500 }
    )
  }
})
