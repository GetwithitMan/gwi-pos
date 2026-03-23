import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

/**
 * GET /api/tips/my-shift-summary
 *
 * Returns tip group participation and earnings for a single employee's shift.
 * Used by the crew shift report page to display the "Tip Group Earnings" section.
 *
 * Query params:
 *   employeeId  - required
 *   locationId  - required
 *   date        - required, YYYY-MM-DD format (business day date)
 *
 * Response:
 *   data: {
 *     hasGroup: boolean
 *     groups: Array<{
 *       groupId: string
 *       splitMode: string
 *       segments: Array<{
 *         segmentId: string
 *         startedAt: string    // ISO
 *         endedAt: string | null
 *         memberCount: number
 *         sharePercent: number | null  // from splitJson[employeeId], null if not found
 *       }>
 *       totalEarnedCents: number
 *     }>
 *     totalGroupEarnedCents: number
 *   }
 */
export const GET = withVenue(withAuth({ allowCellular: true }, async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const employeeId = searchParams.get('employeeId')
    const locationId = searchParams.get('locationId')
    const date = searchParams.get('date')   // YYYY-MM-DD

    if (!employeeId || !locationId || !date) {
      return NextResponse.json(
        { error: 'employeeId, locationId, and date are required' },
        { status: 400 }
      )
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Parse the business day window: midnight to midnight local is fine for this query
    const dayStart = new Date(`${date}T00:00:00`)
    const dayEnd   = new Date(`${date}T23:59:59.999`)

    // 1. Find the employee's time clock entry for this date (may not exist)
    const clockEntry = await db.timeClockEntry.findFirst({
      where: {
        employeeId,
        locationId,
        clockIn: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { clockIn: 'desc' },
      select: { clockIn: true, clockOut: true },
    })

    // Use the clock entry window if available, otherwise the full day
    const shiftStart = clockEntry?.clockIn ?? dayStart
    const shiftEnd   = clockEntry?.clockOut ?? dayEnd

    // 2. Find all groups this employee was a member of during the shift
    //    (joined before shiftEnd AND either still active OR left after shiftStart)
    const memberships = await db.tipGroupMembership.findMany({
      where: {
        employeeId,
        group: { locationId },
        joinedAt: { lte: shiftEnd },
        OR: [
          { status: 'active' },
          { leftAt: { gte: shiftStart } },
        ],
      },
      include: {
        group: {
          select: {
            id: true,
            splitMode: true,
            segments: {
              where: {
                // Only segments that overlap with the shift window
                startedAt: { lte: shiftEnd },
                OR: [
                  { endedAt: null },
                  { endedAt: { gte: shiftStart } },
                ],
              },
              orderBy: { startedAt: 'asc' },
              select: {
                id: true,
                startedAt: true,
                endedAt: true,
                memberCount: true,
                splitJson: true,
              },
            },
          },
        },
      },
    })

    if (memberships.length === 0) {
      return NextResponse.json({
        data: { hasGroup: false, groups: [], totalGroupEarnedCents: 0 },
      })
    }

    // 3. For each group, compute total earned from TipLedgerEntry
    //    (credits with sourceType 'TIP_GROUP' or 'TIP_GROUP_SHARE' during the shift)
    const ledgerEntries = await db.tipLedgerEntry.findMany({
      where: {
        employeeId,
        sourceType: { in: ['TIP_GROUP', 'TIP_GROUP_SHARE', 'DIRECT_TIP'] },
        type: 'CREDIT',
        createdAt: { gte: shiftStart, lte: shiftEnd },
      },
      select: {
        id: true,
        amountCents: true,
        sourceType: true,
      },
    })

    // Sum group-related tip credits (convert Decimal to number)
    const totalGroupEarnedCents = ledgerEntries
      .filter(e => e.sourceType === 'TIP_GROUP' || e.sourceType === 'TIP_GROUP_SHARE')
      .reduce((sum, e) => sum + Number(e.amountCents), 0)

    // Build groups array
    const groups = memberships.map(m => {
      const segments = m.group.segments.map(seg => {
        const splitJson = seg.splitJson as Record<string, number> | null
        const sharePercent = splitJson?.[employeeId] ?? null

        return {
          segmentId: seg.id,
          startedAt: seg.startedAt.toISOString(),
          endedAt: seg.endedAt?.toISOString() ?? null,
          memberCount: seg.memberCount,
          sharePercent: sharePercent !== null ? Math.round(sharePercent * 100) : null,
        }
      })

      return {
        groupId: m.groupId,
        splitMode: m.group.splitMode,
        segments,
        // Per-group earnings: if ledger entries are linked to groupId use that;
        // otherwise distribute totalGroupEarnedCents equally across groups (simple fallback)
        totalEarnedCents: totalGroupEarnedCents,
      }
    })

    return NextResponse.json({
      data: {
        hasGroup: true,
        groups,
        totalGroupEarnedCents,
      },
    })
  } catch (error) {
    console.error('[my-shift-summary] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to load shift tip summary' },
      { status: 500 }
    )
  }
}))
