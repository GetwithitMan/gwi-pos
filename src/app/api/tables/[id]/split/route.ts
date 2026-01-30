import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'

/**
 * POST /api/tables/[id]/split
 *
 * Split a combined table back into its original tables:
 * - Option A: Split evenly (items distributed randomly)
 * - Option B: Split by seat (items follow original seat assignment)
 * - Restore table names
 * - Create new orders for split tables
 * - Audit log the split
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    const body = await request.json()
    const { locationId, employeeId, splitMode = 'even' } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!['even', 'by_seat'].includes(splitMode)) {
      return NextResponse.json(
        { error: 'splitMode must be "even" or "by_seat"' },
        { status: 400 }
      )
    }

    // Fetch the combined table with its orders and combined table data
    const primaryTable = await db.table.findFirst({
      where: { id: tableId, locationId, deletedAt: null },
      include: {
        orders: {
          where: { status: 'open', deletedAt: null },
          include: {
            items: {
              where: { deletedAt: null },
              include: { modifiers: true },
            },
            employee: { select: { id: true, displayName: true } },
          },
        },
      },
    })

    if (!primaryTable) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      )
    }

    const combinedTableIds = (primaryTable.combinedTableIds as string[]) || []

    if (combinedTableIds.length === 0) {
      return NextResponse.json(
        { error: 'This table is not combined with any other tables' },
        { status: 400 }
      )
    }

    // Fetch all the combined tables
    const combinedTables = await db.table.findMany({
      where: {
        id: { in: combinedTableIds },
        locationId,
        deletedAt: null,
      },
    })

    if (combinedTables.length !== combinedTableIds.length) {
      return NextResponse.json(
        { error: 'Some combined tables not found' },
        { status: 400 }
      )
    }

    const currentOrder = primaryTable.orders[0]

    // Start transaction
    const result = await db.$transaction(async (tx) => {
      const restoredTables: string[] = []

      // If there's an active order, we need to split items
      if (currentOrder) {
        const items = currentOrder.items
        const numTables = combinedTables.length + 1 // +1 for primary table

        if (splitMode === 'by_seat') {
          // Group items by their original table (based on seat assignment)
          // For simplicity, we'll assign items with seatNumber to combined tables sequentially
          const itemsByTable: Record<string, typeof items> = {
            [primaryTable.id]: [],
          }
          combinedTables.forEach(t => {
            itemsByTable[t.id] = []
          })

          // Distribute items based on seat number
          // Seats 1-N go to primary, N+1-M go to first combined, etc.
          const primaryCapacity = (primaryTable.capacity || 4) / numTables
          const tableOrder = [primaryTable.id, ...combinedTableIds]

          items.forEach(item => {
            if (item.seatNumber) {
              // Calculate which table this seat belongs to
              const targetTableIndex = Math.min(
                Math.floor((item.seatNumber - 1) / primaryCapacity),
                numTables - 1
              )
              const targetTableId = tableOrder[targetTableIndex]
              itemsByTable[targetTableId].push(item)
            } else {
              // No seat number - stays with primary
              itemsByTable[primaryTable.id].push(item)
            }
          })

          // Create orders for each combined table with their items
          for (const combinedTable of combinedTables) {
            const tableItems = itemsByTable[combinedTable.id]

            if (tableItems.length > 0) {
              // Calculate totals for this subset
              const subtotal = tableItems.reduce(
                (sum, item) => sum + Number(item.price) * item.quantity,
                0
              )
              const taxRate = 0.08 // Should come from location settings
              const taxTotal = subtotal * taxRate
              const total = subtotal + taxTotal

              // Get next order number
              const lastOrder = await tx.order.findFirst({
                where: { locationId },
                orderBy: { orderNumber: 'desc' },
              })
              const nextOrderNumber = (lastOrder?.orderNumber || 0) + 1

              // Create new order for this table
              const newOrder = await tx.order.create({
                data: {
                  locationId,
                  employeeId: currentOrder.employeeId,
                  orderNumber: nextOrderNumber,
                  orderType: currentOrder.orderType,
                  tableId: combinedTable.id,
                  guestCount: Math.ceil(currentOrder.guestCount / numTables),
                  subtotal,
                  taxTotal,
                  total,
                  notes: `Split from order #${currentOrder.orderNumber}`,
                },
              })

              // Move items to new order
              for (const item of tableItems) {
                await tx.orderItem.update({
                  where: { id: item.id },
                  data: { orderId: newOrder.id },
                })
              }

              // Update combined table status and restore original position
              await tx.table.update({
                where: { id: combinedTable.id },
                data: {
                  status: 'occupied',
                  combinedWithId: null,
                  name: combinedTable.originalName || combinedTable.name.split('+').pop() || combinedTable.name,
                  // Restore to admin-defined position
                  posX: combinedTable.originalPosX ?? combinedTable.posX,
                  posY: combinedTable.originalPosY ?? combinedTable.posY,
                },
              })

              restoredTables.push(combinedTable.id)
            } else {
              // No items for this table - just restore it with original position
              await tx.table.update({
                where: { id: combinedTable.id },
                data: {
                  status: 'available',
                  combinedWithId: null,
                  name: combinedTable.originalName || combinedTable.name.split('+').pop() || combinedTable.name,
                  // Restore to admin-defined position
                  posX: combinedTable.originalPosX ?? combinedTable.posX,
                  posY: combinedTable.originalPosY ?? combinedTable.posY,
                },
              })

              restoredTables.push(combinedTable.id)
            }
          }

          // Update primary table order totals (items remaining with primary)
          const primaryItems = itemsByTable[primaryTable.id]
          const primarySubtotal = primaryItems.reduce(
            (sum, item) => sum + Number(item.price) * item.quantity,
            0
          )
          const primaryTax = primarySubtotal * 0.08
          const primaryTotal = primarySubtotal + primaryTax

          await tx.order.update({
            where: { id: currentOrder.id },
            data: {
              subtotal: primarySubtotal,
              taxTotal: primaryTax,
              total: primaryTotal,
              guestCount: Math.ceil(currentOrder.guestCount / numTables),
              notes: currentOrder.notes
                ? `${currentOrder.notes}\n[Split - items distributed by seat]`
                : '[Split - items distributed by seat]',
            },
          })
        } else {
          // Split evenly - distribute items randomly
          const itemsPerTable = Math.ceil(items.length / numTables)
          const shuffledItems = [...items].sort(() => Math.random() - 0.5)

          let itemIndex = 0

          for (const combinedTable of combinedTables) {
            const tableItems = shuffledItems.slice(itemIndex, itemIndex + itemsPerTable)
            itemIndex += itemsPerTable

            if (tableItems.length > 0) {
              // Calculate totals
              const subtotal = tableItems.reduce(
                (sum, item) => sum + Number(item.price) * item.quantity,
                0
              )
              const taxRate = 0.08
              const taxTotal = subtotal * taxRate
              const total = subtotal + taxTotal

              // Get next order number
              const lastOrder = await tx.order.findFirst({
                where: { locationId },
                orderBy: { orderNumber: 'desc' },
              })
              const nextOrderNumber = (lastOrder?.orderNumber || 0) + 1

              // Create new order
              const newOrder = await tx.order.create({
                data: {
                  locationId,
                  employeeId: currentOrder.employeeId,
                  orderNumber: nextOrderNumber,
                  orderType: currentOrder.orderType,
                  tableId: combinedTable.id,
                  guestCount: Math.ceil(currentOrder.guestCount / numTables),
                  subtotal,
                  taxTotal,
                  total,
                  notes: `Split from order #${currentOrder.orderNumber}`,
                },
              })

              // Move items
              for (const item of tableItems) {
                await tx.orderItem.update({
                  where: { id: item.id },
                  data: { orderId: newOrder.id },
                })
              }

              // Update combined table with original position
              await tx.table.update({
                where: { id: combinedTable.id },
                data: {
                  status: 'occupied',
                  combinedWithId: null,
                  name: combinedTable.originalName || combinedTable.name.split('+').pop() || combinedTable.name,
                  // Restore to admin-defined position
                  posX: combinedTable.originalPosX ?? combinedTable.posX,
                  posY: combinedTable.originalPosY ?? combinedTable.posY,
                },
              })

              restoredTables.push(combinedTable.id)
            } else {
              // No items - just restore with original position
              await tx.table.update({
                where: { id: combinedTable.id },
                data: {
                  status: 'available',
                  combinedWithId: null,
                  name: combinedTable.originalName || combinedTable.name.split('+').pop() || combinedTable.name,
                  // Restore to admin-defined position
                  posX: combinedTable.originalPosX ?? combinedTable.posX,
                  posY: combinedTable.originalPosY ?? combinedTable.posY,
                },
              })

              restoredTables.push(combinedTable.id)
            }
          }

          // Recalculate primary table order totals
          const remainingItems = shuffledItems.slice(0, itemsPerTable)
          const primarySubtotal = remainingItems.reduce(
            (sum, item) => sum + Number(item.price) * item.quantity,
            0
          )
          const primaryTax = primarySubtotal * 0.08
          const primaryTotal = primarySubtotal + primaryTax

          await tx.order.update({
            where: { id: currentOrder.id },
            data: {
              subtotal: primarySubtotal,
              taxTotal: primaryTax,
              total: primaryTotal,
              guestCount: Math.ceil(currentOrder.guestCount / numTables),
              notes: currentOrder.notes
                ? `${currentOrder.notes}\n[Split evenly]`
                : '[Split evenly]',
            },
          })
        }
      } else {
        // No order - just restore the combined tables with original positions
        for (const combinedTable of combinedTables) {
          await tx.table.update({
            where: { id: combinedTable.id },
            data: {
              status: 'available',
              combinedWithId: null,
              name: combinedTable.originalName || combinedTable.name.split('+').pop() || combinedTable.name,
              // Restore to admin-defined position
              posX: combinedTable.originalPosX ?? combinedTable.posX,
              posY: combinedTable.originalPosY ?? combinedTable.posY,
            },
          })

          restoredTables.push(combinedTable.id)
        }
      }

      // Restore primary table with original position
      const originalCapacity = Math.floor(
        primaryTable.capacity / (combinedTables.length + 1)
      )

      const updatedPrimary = await tx.table.update({
        where: { id: primaryTable.id },
        data: {
          combinedTableIds: Prisma.JsonNull,
          name: primaryTable.originalName || primaryTable.name.split('+')[0],
          originalName: null,
          capacity: originalCapacity > 0 ? originalCapacity : primaryTable.capacity,
          status: currentOrder ? 'occupied' : 'available',
          // Restore to admin-defined position
          posX: primaryTable.originalPosX ?? primaryTable.posX,
          posY: primaryTable.originalPosY ?? primaryTable.posY,
        },
      })

      // Create audit log
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'tables_split',
          entityType: 'table',
          entityId: primaryTable.id,
          details: {
            primaryTableId: primaryTable.id,
            restoredTableIds: restoredTables,
            splitMode,
            hadActiveOrder: !!currentOrder,
            orderNumber: currentOrder?.orderNumber,
          },
        },
      })

      return {
        primaryTable: updatedPrimary,
        restoredTables,
      }
    })

    // Emit real-time event
    tableEvents.tablesSplit({
      primaryTableId: tableId,
      restoredTableIds: result.restoredTables,
      locationId,
      splitMode,
      timestamp: new Date().toISOString(),
      triggeredBy: employeeId,
    })

    return NextResponse.json({
      data: {
        primaryTableId: result.primaryTable.id,
        primaryTableName: result.primaryTable.name,
        restoredTableIds: result.restoredTables,
        message: `Tables split successfully using ${splitMode} mode`,
      },
    })
  } catch (error) {
    console.error('[TablesSplit] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to split tables' },
      { status: 500 }
    )
  }
}
