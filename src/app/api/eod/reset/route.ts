import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/eod/reset
 *
 * End of Day (EOD) reset for a location.
 * This should be called during the EOD closeout process to:
 * 1. Reset orphaned virtual groups (tables left linked after order payment)
 * 2. Reset all table statuses to 'available'
 * 3. Clear any stale session data
 *
 * This is a "self-healing" mechanism to prevent abandoned virtual groups
 * from persisting across business days.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, dryRun = false } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Collect stats for the reset
    const stats = {
      virtualGroupsCleared: 0,
      tablesReset: 0,
      orphanedOrdersClosed: 0,
    }

    // Find all tables in virtual groups
    const virtualGroupedTables = await db.table.findMany({
      where: {
        locationId,
        virtualGroupId: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        virtualGroupId: true,
        virtualGroupPrimary: true,
      },
    })

    // Group by virtualGroupId to count unique groups
    const uniqueGroups = new Set(virtualGroupedTables.map(t => t.virtualGroupId))
    stats.virtualGroupsCleared = uniqueGroups.size

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

    // Find any open orders that should have been closed (safety check)
    // These are orders older than 24 hours that are still open
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const staleOpenOrders = await db.order.findMany({
      where: {
        locationId,
        status: 'open',
        createdAt: { lt: twentyFourHoursAgo },
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
      return NextResponse.json({
        dryRun: true,
        wouldReset: {
          virtualGroups: {
            count: stats.virtualGroupsCleared,
            tables: virtualGroupedTables.map(t => ({
              id: t.id,
              name: t.name,
              groupId: t.virtualGroupId,
              isPrimary: t.virtualGroupPrimary,
            })),
          },
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
      })
    }

    // Execute the reset in a transaction
    await db.$transaction(async (tx) => {
      // 1. Reset all virtual group fields on tables
      if (virtualGroupedTables.length > 0) {
        await tx.table.updateMany({
          where: {
            locationId,
            virtualGroupId: { not: null },
          },
          data: {
            virtualGroupId: null,
            virtualGroupPrimary: false,
            virtualGroupColor: null,
            virtualGroupCreatedAt: null,
          },
        })
      }

      // 2. Reset all tables to 'available' status (except those with open orders)
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

      // 3. Log stale orders but don't auto-close (requires manual review)
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
      }

      // 4. Create master audit log for EOD reset
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'eod_reset_completed',
          entityType: 'location',
          entityId: locationId,
          details: {
            virtualGroupsCleared: stats.virtualGroupsCleared,
            tablesReset: stats.tablesReset,
            staleOrdersDetected: stats.orphanedOrdersClosed,
            timestamp: new Date().toISOString(),
          },
        },
      })
    })

    return NextResponse.json({
      success: true,
      stats: {
        virtualGroupsCleared: stats.virtualGroupsCleared,
        tablesReset: stats.tablesReset,
        staleOrdersDetected: stats.orphanedOrdersClosed,
      },
      warnings: staleOpenOrders.length > 0
        ? [`${staleOpenOrders.length} stale order(s) detected. Please review manually.`]
        : [],
      message: 'EOD reset completed successfully',
    })
  } catch (error) {
    console.error('[EOD Reset] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to perform EOD reset', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/eod/reset?locationId=xxx
 *
 * Check EOD reset status - what needs to be cleaned up
 */
export async function GET(request: NextRequest) {
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
    const virtualGroupedTables = await db.table.count({
      where: {
        locationId,
        virtualGroupId: { not: null },
        deletedAt: null,
      },
    })

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

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const staleOrderCount = await db.order.count({
      where: {
        locationId,
        status: 'open',
        createdAt: { lt: twentyFourHoursAgo },
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

    const needsReset = virtualGroupedTables > 0 || occupiedTablesWithoutOrders > 0 || staleOrderCount > 0

    return NextResponse.json({
      needsReset,
      summary: {
        virtualGroupedTables,
        occupiedTablesWithoutOrders,
        staleOrders: staleOrderCount,
        currentOpenOrders: openOrderCount,
      },
      recommendation: needsReset
        ? 'Run EOD reset to clean up orphaned data'
        : 'No reset needed - location is clean',
    })
  } catch (error) {
    console.error('[EOD Reset] Check failed:', error)
    return NextResponse.json(
      { error: 'Failed to check EOD status' },
      { status: 500 }
    )
  }
}
