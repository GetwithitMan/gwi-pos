import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'

// Helper to restore seats to original positions
async function restoreSeatsForTable(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  tableId: string,
  locationId: string
) {
  // Fetch all seats for this table
  const seats = await tx.seat.findMany({
    where: { tableId, isActive: true, deletedAt: null },
    orderBy: { seatNumber: 'asc' },
  })

  // Restore each seat to its original position
  let seatNum = 1
  for (const seat of seats) {
    // Only restore if original positions were saved
    if (seat.originalRelativeX !== null || seat.originalRelativeY !== null) {
      await tx.seat.update({
        where: { id: seat.id },
        data: {
          relativeX: seat.originalRelativeX ?? seat.relativeX,
          relativeY: seat.originalRelativeY ?? seat.relativeY,
          angle: seat.originalAngle ?? seat.angle,
          originalRelativeX: null,
          originalRelativeY: null,
          originalAngle: null,
          label: String(seatNum),
          seatNumber: seatNum,
        },
      })
      seatNum++
    }
  }
}

/**
 * POST /api/tables/reset-to-default
 *
 * Reset combined tables to their original (admin-defined) positions:
 * - Uncombine all specified tables
 * - Restore original positions (originalPosX, originalPosY)
 * - Restore original names
 * - SKIP tables with open orders (protect active service)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tableIds, locationId, employeeId } = body

    if (!tableIds || !Array.isArray(tableIds) || tableIds.length === 0) {
      return NextResponse.json(
        { error: 'tableIds array is required' },
        { status: 400 }
      )
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Fetch all tables to reset, including their orders
    const tablesToReset = await db.table.findMany({
      where: {
        id: { in: tableIds },
        locationId,
        deletedAt: null,
      },
      include: {
        orders: {
          where: {
            status: { in: ['open', 'in_progress'] },
            deletedAt: null,
          },
        },
      },
    })

    if (tablesToReset.length === 0) {
      return NextResponse.json(
        { error: 'No tables found to reset' },
        { status: 404 }
      )
    }

    // Track reset and skipped tables
    const skippedTableIds: string[] = []

    const result = await db.$transaction(async (tx) => {
      const resetResults: Array<{ id: string; name: string; wasReset: boolean; reason?: string }> = []

      for (const table of tablesToReset) {
        const combinedTableIds = (table.combinedTableIds as string[]) || []

        // CHECK FOR OPEN ORDERS - skip if table has active orders
        if (table.orders.length > 0) {
          resetResults.push({
            id: table.id,
            name: table.name,
            wasReset: false,
            reason: 'open_order',
          })
          skippedTableIds.push(table.id)
          continue
        }

        // If this table has combined tables, uncombine them
        if (combinedTableIds.length > 0) {
          // First, get all the combined tables with their orders
          const combinedTables = await tx.table.findMany({
            where: {
              id: { in: combinedTableIds },
              locationId,
              deletedAt: null,
            },
            include: {
              orders: {
                where: {
                  status: { in: ['open', 'in_progress'] },
                  deletedAt: null,
                },
              },
            },
          })

          // Check if ANY of the combined tables have open orders
          const hasOpenOrders = combinedTables.some(ct => ct.orders.length > 0)
          if (hasOpenOrders) {
            resetResults.push({
              id: table.id,
              name: table.name,
              wasReset: false,
              reason: 'combined_table_has_order',
            })
            skippedTableIds.push(table.id)
            continue
          }

          // Restore each combined table
          for (const combined of combinedTables) {
            await tx.table.update({
              where: { id: combined.id },
              data: {
                combinedWithId: null,
                // Restore position: originalPosX (pre-combine) → defaultPosX (admin default) → posX (current)
                // This ensures tables return to where they were before combining
                posX: combined.originalPosX ?? combined.defaultPosX ?? combined.posX,
                posY: combined.originalPosY ?? combined.defaultPosY ?? combined.posY,
                sectionId: combined.defaultSectionId ?? combined.sectionId,
                // Restore original name if available
                name: combined.originalName || combined.name,
                originalName: null,
                // Clear combine-related original positions (already consumed above)
                originalPosX: null,
                originalPosY: null,
                status: 'available',
              },
            })

            // Restore seats to original positions
            await restoreSeatsForTable(tx, combined.id, locationId)

            resetResults.push({
              id: combined.id,
              name: combined.originalName || combined.name,
              wasReset: true,
            })
          }

          // Calculate original capacity (divide current by number of tables)
          const originalCapacity = Math.floor(
            table.capacity / (combinedTableIds.length + 1)
          )

          // Reset the primary table
          await tx.table.update({
            where: { id: table.id },
            data: {
              combinedTableIds: Prisma.JsonNull,
              // Restore position: originalPosX (pre-combine) → defaultPosX (admin default) → posX (current)
              // Primary table typically doesn't move during combine, but check originalPosX just in case
              posX: table.originalPosX ?? table.defaultPosX ?? table.posX,
              posY: table.originalPosY ?? table.defaultPosY ?? table.posY,
              sectionId: table.defaultSectionId ?? table.sectionId,
              // Restore original name
              name: table.originalName || table.name.split('+')[0],
              originalName: null,
              // Clear combine-related original positions (already consumed above)
              originalPosX: null,
              originalPosY: null,
              // Restore original capacity (approximation)
              capacity: originalCapacity > 0 ? originalCapacity : table.capacity,
              status: 'available',
            },
          })

          // Restore seats to original positions for primary table
          await restoreSeatsForTable(tx, table.id, locationId)

          resetResults.push({
            id: table.id,
            name: table.originalName || table.name.split('+')[0],
            wasReset: true,
          })
        } else if (table.combinedWithId) {
          // This table is combined INTO another - it will be handled by its parent
          continue
        } else {
          // Not combined - reset to admin-defined default position if available
          if (table.defaultPosX !== null || table.defaultPosY !== null) {
            await tx.table.update({
              where: { id: table.id },
              data: {
                posX: table.defaultPosX ?? table.posX,
                posY: table.defaultPosY ?? table.posY,
                sectionId: table.defaultSectionId ?? table.sectionId,
              },
            })

            resetResults.push({
              id: table.id,
              name: table.name,
              wasReset: true,
            })
          } else {
            // No default layout saved - skip this table
            resetResults.push({
              id: table.id,
              name: table.name,
              wasReset: false,
              reason: 'no_default_layout',
            })
          }
        }
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'tables_reset_to_default',
          entityType: 'table',
          entityId: tableIds[0],
          details: {
            tableIds,
            resetResults,
            skippedDueToOrders: skippedTableIds,
          },
        },
      })

      return resetResults
    })

    // Emit real-time events for each reset table
    for (const table of result.filter(r => r.wasReset)) {
      tableEvents.tablesSplit({
        primaryTableId: table.id,
        restoredTableIds: [],
        locationId,
        splitMode: 'even',
        timestamp: new Date().toISOString(),
        triggeredBy: employeeId,
      })
    }

    const resetCount = result.filter(r => r.wasReset).length
    const skippedCount = skippedTableIds.length

    return NextResponse.json({
      data: {
        resetCount,
        skippedCount,
        tables: result,
        skippedTableIds,  // Return IDs for flash feedback on UI
        message: skippedCount > 0
          ? `Reset ${resetCount} table(s). ${skippedCount} table(s) skipped due to open orders.`
          : `Reset ${resetCount} table(s) to default positions`,
      },
    })
  } catch (error) {
    console.error('[TablesResetToDefault] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to reset tables' },
      { status: 500 }
    )
  }
}
