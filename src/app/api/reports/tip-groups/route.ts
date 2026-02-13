/**
 * Tip Group Report API
 *
 * GET - List tip groups with segments, memberships, and member earnings
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// ─── GET: List tip groups with earnings ─────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const groupId = searchParams.get('groupId')
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // ── Auth check ────────────────────────────────────────────────────────

    const requestingEmployeeId = request.headers.get('x-employee-id')

    const auth = await requireAnyPermission(
      requestingEmployeeId,
      locationId,
      [PERMISSIONS.TIPS_VIEW_LEDGER]
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      )
    }

    // ── Build filters ─────────────────────────────────────────────────────

    const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 50)) : 50
    const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {
      locationId,
      deletedAt: null,
    }

    if (groupId) {
      where.id = groupId
    }

    if (dateFrom || dateTo) {
      where.startedAt = {}
      if (dateFrom) {
        where.startedAt.gte = new Date(dateFrom)
      }
      if (dateTo) {
        const dateToEnd = new Date(dateTo)
        dateToEnd.setHours(23, 59, 59, 999)
        where.startedAt.lte = dateToEnd
      }
    }

    // ── Query groups with segments and memberships ────────────────────────

    const [groups, total] = await Promise.all([
      db.tipGroup.findMany({
        where,
        include: {
          segments: {
            where: { deletedAt: null },
            orderBy: { startedAt: 'asc' },
          },
          memberships: {
            where: { deletedAt: null },
            include: {
              employee: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
            orderBy: { joinedAt: 'asc' },
          },
        },
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.tipGroup.count({ where }),
    ])

    // ── Compute member earnings per group ─────────────────────────────────
    // For each group, aggregate TipLedgerEntry records with sourceType='TIP_GROUP'
    // for the group's members during the group's time range.

    const groupsWithEarnings = await Promise.all(
      groups.map(async (group) => {
        const memberEmployeeIds = group.memberships.map((m) => m.employeeId)

        // Build date filter for ledger entries: group startedAt to endedAt (or now)
        const ledgerDateFilter: { gte: Date; lte: Date } = {
          gte: group.startedAt,
          lte: group.endedAt ?? new Date(),
        }

        // Aggregate earnings by employeeId
        let earningsAgg: { employeeId: string; _sum: { amountCents: number | null } }[] = []
        if (memberEmployeeIds.length > 0) {
          const result = await db.tipLedgerEntry.groupBy({
            by: ['employeeId'],
            where: {
              locationId,
              deletedAt: null,
              sourceType: 'TIP_GROUP',
              employeeId: { in: memberEmployeeIds },
              createdAt: ledgerDateFilter,
            },
            _sum: {
              amountCents: true,
            },
          })
          earningsAgg = result as typeof earningsAgg
        }

        // Build a map of employeeId -> name from memberships
        const employeeNameMap = new Map<string, string>()
        for (const m of group.memberships) {
          const name = [m.employee.firstName, m.employee.lastName]
            .filter(Boolean)
            .join(' ')
          employeeNameMap.set(m.employeeId, name)
        }

        // Build memberEarnings array
        const memberEarnings = earningsAgg.map((agg) => {
          const totalCents = agg._sum.amountCents ?? 0
          return {
            employeeId: agg.employeeId,
            employeeName: employeeNameMap.get(agg.employeeId) ?? 'Unknown',
            totalEarnedCents: totalCents,
            totalEarnedDollars: totalCents / 100,
          }
        })

        // Include members with zero earnings so every member appears
        for (const empId of memberEmployeeIds) {
          if (!memberEarnings.some((e) => e.employeeId === empId)) {
            memberEarnings.push({
              employeeId: empId,
              employeeName: employeeNameMap.get(empId) ?? 'Unknown',
              totalEarnedCents: 0,
              totalEarnedDollars: 0,
            })
          }
        }

        return {
          id: group.id,
          createdBy: group.createdBy,
          ownerId: group.ownerId,
          startedAt: group.startedAt.toISOString(),
          endedAt: group.endedAt?.toISOString() ?? null,
          status: group.status,
          splitMode: group.splitMode,
          segments: group.segments.map((seg) => ({
            id: seg.id,
            startedAt: seg.startedAt.toISOString(),
            endedAt: seg.endedAt?.toISOString() ?? null,
            memberCount: seg.memberCount,
            splitJson: seg.splitJson,
          })),
          memberships: group.memberships.map((m) => ({
            id: m.id,
            employeeId: m.employeeId,
            employeeName: [m.employee.firstName, m.employee.lastName]
              .filter(Boolean)
              .join(' '),
            joinedAt: m.joinedAt.toISOString(),
            leftAt: m.leftAt?.toISOString() ?? null,
            status: m.status,
          })),
          memberEarnings,
        }
      })
    )

    return NextResponse.json({
      groups: groupsWithEarnings,
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to get tip group report:', error)
    return NextResponse.json(
      { error: 'Failed to get tip group report' },
      { status: 500 }
    )
  }
})
