import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { executeEodReset } from '@/lib/eod'

// TODO: Migrate db.location, db.table, db.orderSnapshot, db.entertainmentWaitlist,
// and db.order.count calls to repositories once Location/Table/OrderSnapshot repositories exist.
// All queries already include locationId in WHERE clauses.

/**
 * POST /api/eod/reset
 *
 * End of Day (EOD) reset for a location.
 * Delegates all logic to the shared executeEodReset() function.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, dryRun = false } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Auth check — require manager.close_day permission
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.MGR_CLOSE_DAY)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // ── warnBeforeClose: warn if open orders exist during EOD reset ────────
    const location = await db.location.findFirst({
      where: { id: locationId },
      select: { settings: true, timezone: true },
    })
    const locSettings = parseSettings(location?.settings as Record<string, unknown> | null)
    // TZ-FIX: Resolve venue timezone for business day calculations
    const venueTimezone = location?.timezone || 'America/New_York'
    const warnBeforeClose = locSettings.businessDay.warnBeforeClose ?? true
    const confirm = body.confirm === true

    if (!dryRun && warnBeforeClose && !confirm) {
      const currentOpenOrderCount = await db.orderSnapshot.count({
        where: { locationId, status: 'open', deletedAt: null },
      })
      if (currentOpenOrderCount > 0) {
        return NextResponse.json({ data: {
          requiresConfirmation: true,
          warning: `There are ${currentOpenOrderCount} open orders. Are you sure you want to close the business day?`,
          openOrderCount: currentOpenOrderCount,
        } })
      }
    }

    if (dryRun) {
      // Return what WOULD be reset without actually doing it
      const dayStartTime = locSettings.businessDay.dayStartTime ?? '04:00'
      const currentBusinessDayStart = getCurrentBusinessDay(dayStartTime, venueTimezone).start

      const orphanedOccupiedTables = await db.table.findMany({
        where: {
          locationId,
          status: 'occupied',
          deletedAt: null,
          orders: { none: { status: 'open', deletedAt: null } },
        },
        select: { id: true, name: true },
      })

      const staleOpenOrders = await db.orderSnapshot.findMany({
        where: {
          locationId,
          status: 'open',
          OR: [{ businessDayDate: { lt: currentBusinessDayStart } }, { businessDayDate: null, createdAt: { lt: currentBusinessDayStart } }],
          deletedAt: null,
        },
        select: { id: true, orderNumber: true, totalCents: true, createdAt: true },
      })

      // Count open tabs that would be auto-captured
      const eodSettings = locSettings.eod
      let openTabCount = 0
      if (eodSettings?.autoCaptureTabs) {
        openTabCount = await db.order.count({
          where: {
            locationId,
            orderType: 'bar_tab',
            status: 'open',
            deletedAt: null,
            cards: { some: { status: 'authorized', deletedAt: null } },
          },
        })
      }

      return NextResponse.json({ data: {
        dryRun: true,
        wouldReset: {
          orphanedTables: {
            count: orphanedOccupiedTables.length,
            tables: orphanedOccupiedTables.map(t => ({ id: t.id, name: t.name })),
          },
          staleOrders: {
            count: staleOpenOrders.length,
            orders: staleOpenOrders.map(o => ({
              id: o.id,
              orderNumber: o.orderNumber,
              total: o.totalCents / 100,
              createdAt: o.createdAt.toISOString(),
            })),
          },
          openTabsToCapture: openTabCount,
          autoCaptureTabs: eodSettings?.autoCaptureTabs ?? false,
          autoGratuityPercent: eodSettings?.autoGratuityPercent ?? 20,
        },
        message: 'Dry run complete. No changes made.',
      } })
    }

    // Execute the full EOD reset
    const result = await executeEodReset({
      locationId,
      employeeId,
      triggeredBy: 'manual',
    })

    if (result.alreadyRanToday) {
      return NextResponse.json({
        data: {
          success: true,
          alreadyRanToday: true,
          stats: result,
          warning: 'EOD already ran for this business day',
          message: 'EOD reset already completed today',
        },
      })
    }

    return NextResponse.json({ data: {
      success: true,
      stats: {
        tablesReset: result.tablesReset,
        staleOrdersDetected: result.rolledOverOrders,
        entertainmentReset: result.entertainmentReset,
        entertainmentSessionsCharged: result.entertainmentSessionsCharged,
        entertainmentTotalCharges: result.entertainmentTotalCharges,
        waitlistCancelled: result.waitlistCancelled,
        tabsCaptured: result.tabsCaptured,
        tabsCapturedAmount: result.tabsCapturedAmount,
        tabsDeclined: result.tabsDeclined,
        tabsRolledOver: result.tabsRolledOver,
        batchCloseTriggered: result.batchCloseSuccess !== null,
        batchCloseSuccess: result.batchCloseSuccess,
        walkoutDetectionTriggered: true,
      },
      warnings: result.warnings,
      message: 'EOD reset completed successfully',
    } })
  } catch (error) {
    console.error('[EOD Reset] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to perform EOD reset', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
})

/**
 * GET /api/eod/reset?locationId=xxx
 *
 * Check EOD reset status - what needs to be cleaned up
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('employeeId') || searchParams.get('requestingEmployeeId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Auth check — require manager.close_day permission
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.MGR_CLOSE_DAY)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Check for items that would be reset
    const occupiedTablesWithoutOrders = await db.table.count({
      where: {
        locationId,
        status: 'occupied',
        deletedAt: null,
        orders: {
          none: {
            status: 'open',
            deletedAt: null,
          },
        },
      },
    })

    const getLocation = await db.location.findFirst({
      where: { id: locationId },
      select: { settings: true, timezone: true },
    })
    const getSettings = getLocation?.settings as Record<string, unknown> | null
    const parsedSettings = parseSettings(getSettings)
    const getDayStartTime = parsedSettings.businessDay.dayStartTime ?? '04:00'
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct business day
    const getVenueTimezone = getLocation?.timezone || 'America/New_York'
    const getBusinessDayStart = getCurrentBusinessDay(getDayStartTime, getVenueTimezone).start

    // Read from OrderSnapshot (event-sourced projection)
    const staleOrderCount = await db.orderSnapshot.count({
      where: {
        locationId,
        status: 'open',
        OR: [{ businessDayDate: { lt: getBusinessDayStart } }, { businessDayDate: null, createdAt: { lt: getBusinessDayStart } }],
        deletedAt: null,
      },
    })

    const openOrderCount = await db.orderSnapshot.count({
      where: {
        locationId,
        status: 'open',
        deletedAt: null,
      },
    })

    // Count open tabs with authorized cards
    let openTabCount = 0
    const eodSettings = parsedSettings.eod
    if (eodSettings?.autoCaptureTabs) {
      openTabCount = await db.order.count({
        where: {
          locationId,
          orderType: 'bar_tab',
          status: 'open',
          deletedAt: null,
          cards: { some: { status: 'authorized', deletedAt: null } },
        },
      })
    }

    // Count active entertainment sessions and waiting waitlist entries
    const [activeEntertainment, waitingWaitlist] = await Promise.all([
      db.menuItem.count({
        where: {
          locationId,
          itemType: 'timed_rental',
          entertainmentStatus: 'in_use',
        },
      }),
      db.entertainmentWaitlist.count({
        where: {
          locationId,
          deletedAt: null,
          status: { in: ['waiting', 'notified'] },
        },
      }),
    ])

    const needsReset = occupiedTablesWithoutOrders > 0 || staleOrderCount > 0 || openTabCount > 0 || activeEntertainment > 0 || waitingWaitlist > 0

    return NextResponse.json({ data: {
      needsReset,
      summary: {
        occupiedTablesWithoutOrders,
        staleOrders: staleOrderCount,
        currentOpenOrders: openOrderCount,
        openTabsToCapture: openTabCount,
        autoCaptureTabs: eodSettings?.autoCaptureTabs ?? false,
        activeEntertainmentSessions: activeEntertainment,
        waitingWaitlistEntries: waitingWaitlist,
      },
      recommendation: needsReset
        ? 'Run EOD reset to clean up orphaned data'
        : 'No reset needed - location is clean',
    } })
  } catch (error) {
    console.error('[EOD Reset] Check failed:', error)
    return NextResponse.json(
      { error: 'Failed to check EOD status' },
      { status: 500 }
    )
  }
})
