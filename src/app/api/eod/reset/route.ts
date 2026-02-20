import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { getCurrentBusinessDay } from '@/lib/business-day'

/**
 * POST /api/eod/reset
 *
 * End of Day (EOD) reset for a location.
 * This should be called during the EOD closeout process to:
 * 1. Reset all table statuses to 'available'
 * 2. Clear any stale session data
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

    // Collect stats for the reset
    const stats = {
      tablesReset: 0,
      orphanedOrdersClosed: 0,
    }

    // Find tables with occupied status but no open orders (orphaned status)
    const orphanedOccupiedTables = await db.table.findMany({
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
      select: {
        id: true,
        name: true,
      },
    })

    // Find open orders from BEFORE the current business day started — these are stale
    const location = await db.location.findFirst({
      where: { id: locationId },
      select: { settings: true },
    })
    const locSettings = location?.settings as Record<string, unknown> | null
    const dayStartTime = (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const currentBusinessDayStart = getCurrentBusinessDay(dayStartTime).start

    const staleOpenOrders = await db.order.findMany({
      where: {
        locationId,
        status: 'open',
        createdAt: { lt: currentBusinessDayStart },
        deletedAt: null,
      },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        createdAt: true,
      },
    })

    if (dryRun) {
      // Return what WOULD be reset without actually doing it
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
              total: Number(o.total),
              createdAt: o.createdAt.toISOString(),
            })),
          },
        },
        message: 'Dry run complete. No changes made.',
      } })
    }

    const now = new Date()

    // Execute the reset in a transaction
    await db.$transaction(async (tx) => {
      // 1. Reset all tables to 'available' status (except those with open orders)
      const tablesWithOpenOrders = await tx.table.findMany({
        where: {
          locationId,
          deletedAt: null,
          orders: {
            some: {
              status: 'open',
              deletedAt: null,
            },
          },
        },
        select: { id: true },
      })

      const tableIdsWithOrders = new Set(tablesWithOpenOrders.map(t => t.id))

      const tablesToReset = await tx.table.findMany({
        where: {
          locationId,
          deletedAt: null,
          status: { not: 'available' },
          id: { notIn: Array.from(tableIdsWithOrders) },
        },
        select: { id: true },
      })

      if (tablesToReset.length > 0) {
        await tx.table.updateMany({
          where: {
            id: { in: tablesToReset.map(t => t.id) },
          },
          data: {
            status: 'available',
          },
        })
        stats.tablesReset = tablesToReset.length
      }

      // 2. Log stale orders but don't auto-close (requires manual review)
      // This is intentional - we don't want to lose revenue data
      if (staleOpenOrders.length > 0) {
        // Create audit log for each stale order
        for (const order of staleOpenOrders) {
          await tx.auditLog.create({
            data: {
              locationId,
              employeeId: employeeId || null,
              action: 'eod_stale_order_detected',
              entityType: 'order',
              entityId: order.id,
              details: {
                orderNumber: order.orderNumber,
                total: Number(order.total),
                createdAt: order.createdAt.toISOString(),
                message: 'Order open for more than 24 hours detected during EOD reset',
              },
            },
          })
        }
        stats.orphanedOrdersClosed = staleOpenOrders.length

        // Mark stale orders as rolled over
        await tx.order.updateMany({
          where: { id: { in: staleOpenOrders.map((o: any) => o.id) } },
          data: {
            rolledOverAt: now,
            rolledOverFrom: `EOD reset${employeeId ? ` by employee ${employeeId}` : ''}`,
          },
        })
      }

      // 3. Create master audit log for EOD reset
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'eod_reset_completed',
          entityType: 'location',
          entityId: locationId,
          details: {
            tablesReset: stats.tablesReset,
            staleOrdersDetected: stats.orphanedOrdersClosed,
            timestamp: new Date().toISOString(),
          },
        },
      })
    })

    // Notify all terminals about rolled-over orders
    if (staleOpenOrders.length > 0) {
      dispatchOpenOrdersChanged(locationId, { trigger: 'updated' as any }, { async: true }).catch(() => {})
    }

    return NextResponse.json({ data: {
      success: true,
      stats: {
        tablesReset: stats.tablesReset,
        staleOrdersDetected: stats.orphanedOrdersClosed,
      },
      warnings: staleOpenOrders.length > 0
        ? [`${staleOpenOrders.length} stale order(s) detected. Please review manually.`]
        : [],
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

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

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
      select: { settings: true },
    })
    const getSettings = getLocation?.settings as Record<string, unknown> | null
    const getDayStartTime = (getSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const getBusinessDayStart = getCurrentBusinessDay(getDayStartTime).start

    const staleOrderCount = await db.order.count({
      where: {
        locationId,
        status: 'open',
        createdAt: { lt: getBusinessDayStart },
        deletedAt: null,
      },
    })

    const openOrderCount = await db.order.count({
      where: {
        locationId,
        status: 'open',
        deletedAt: null,
      },
    })

    const needsReset = occupiedTablesWithoutOrders > 0 || staleOrderCount > 0

    return NextResponse.json({ data: {
      needsReset,
      summary: {
        occupiedTablesWithoutOrders,
        staleOrders: staleOrderCount,
        currentOpenOrders: openOrderCount,
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
