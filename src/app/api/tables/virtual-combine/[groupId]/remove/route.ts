import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'

/**
 * POST /api/tables/virtual-combine/[groupId]/remove
 *
 * Remove a table from a virtual group:
 * - Clears virtual group fields from the table
 * - If primary is removed, promotes another table or dissolves group
 * - Optionally creates a new order with this table's items
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await params
    const body = await request.json()
    const { tableId, locationId, employeeId, createNewOrder = false } = body

    if (!tableId || !locationId) {
      return NextResponse.json(
        { error: 'tableId and locationId are required' },
        { status: 400 }
      )
    }

    // Find all tables in this virtual group
    const allGroupTables = await db.table.findMany({
      where: {
        virtualGroupId: groupId,
        locationId,
        deletedAt: null,
      },
      include: {
        orders: {
          where: { status: 'open', deletedAt: null },
          include: {
            items: {
              where: { deletedAt: null },
            },
          },
        },
      },
    })

    if (allGroupTables.length === 0) {
      return NextResponse.json(
        { error: 'Virtual group not found' },
        { status: 404 }
      )
    }

    const tableToRemove = allGroupTables.find(t => t.id === tableId)
    if (!tableToRemove) {
      return NextResponse.json(
        { error: 'Table not found in this virtual group' },
        { status: 404 }
      )
    }

    // Check if table has open/unpaid order (unless force flag is set)
    // Note: The query already filters for orders with status: 'open'
    const { force = false } = body
    if (!force && tableToRemove.orders.length > 0) {
      // Table has open orders with items = unpaid items
      const hasUnpaidItems = tableToRemove.orders.some(order =>
        order.items.length > 0
      )
      if (hasUnpaidItems) {
        return NextResponse.json(
          {
            error: 'table_has_open_order',
            message: 'Cannot remove table with unpaid items. Pay or transfer items first.',
          },
          { status: 400 }
        )
      }
    }

    const primaryTable = allGroupTables.find(t => t.virtualGroupPrimary)
    const isPrimaryBeingRemoved = tableToRemove.virtualGroupPrimary
    const remainingTables = allGroupTables.filter(t => t.id !== tableId)

    // If only 2 tables and removing one, dissolve the whole group
    if (allGroupTables.length <= 2) {
      // Redirect to dissolve logic
      const result = await db.$transaction(async (tx) => {
        // Clear virtual group from all tables
        for (const table of allGroupTables) {
          await tx.table.update({
            where: { id: table.id },
            data: {
              virtualGroupId: null,
              virtualGroupPrimary: false,
              virtualGroupColor: null,
              virtualGroupCreatedAt: null,
            },
          })
        }

        // Create audit log
        await tx.auditLog.create({
          data: {
            locationId,
            employeeId: employeeId || null,
            action: 'virtual_group_dissolved',
            entityType: 'table',
            entityId: primaryTable?.id || tableId,
            details: {
              virtualGroupId: groupId,
              reason: 'Last table removed',
              removedTableId: tableId,
            },
          },
        })

        return { dissolved: true }
      })

      tableEvents.virtualGroupDissolved?.({
        virtualGroupId: groupId,
        tableIds: allGroupTables.map(t => t.id),
        locationId,
        timestamp: new Date().toISOString(),
        triggeredBy: employeeId,
      })

      return NextResponse.json({
        data: {
          dissolved: true,
          tableIds: allGroupTables.map(t => t.id),
          message: 'Virtual group dissolved (only 2 tables)',
        },
      })
    }

    // Start transaction for removing single table
    const result = await db.$transaction(async (tx) => {
      // Handle items with sourceTableId matching this table
      if (createNewOrder && primaryTable) {
        const primaryOrder = primaryTable.orders[0]
        if (primaryOrder) {
          // Find items that came from this table
          const itemsFromThisTable = primaryOrder.items.filter(
            item => item.sourceTableId === tableId
          )

          if (itemsFromThisTable.length > 0) {
            // Calculate totals
            const subtotal = itemsFromThisTable.reduce(
              (sum, item) => sum + Number(item.itemTotal),
              0
            )
            const modifierTotal = itemsFromThisTable.reduce(
              (sum, item) => sum + Number(item.modifierTotal),
              0
            )

            // Create new order for the removed table
            const newOrder = await tx.order.create({
              data: {
                locationId,
                employeeId: primaryOrder.employeeId,
                orderNumber: primaryOrder.orderNumber,
                displayNumber: `${primaryOrder.displayNumber || primaryOrder.orderNumber}-${tableToRemove.name}`,
                orderType: primaryOrder.orderType,
                orderTypeId: primaryOrder.orderTypeId,
                tableId: tableId,
                guestCount: 1,
                status: 'open',
                subtotal,
                total: subtotal + modifierTotal,
                parentOrderId: primaryOrder.id,
                notes: `Split from virtual group on ${primaryTable.name}`,
              },
            })

            // Move items to new order
            await tx.orderItem.updateMany({
              where: {
                id: { in: itemsFromThisTable.map(i => i.id) },
              },
              data: {
                orderId: newOrder.id,
                sourceTableId: null,
              },
            })

            // Recalculate primary order totals
            const remainingItems = primaryOrder.items.filter(
              item => item.sourceTableId !== tableId
            )
            const remainingSubtotal = remainingItems.reduce(
              (sum, item) => sum + Number(item.itemTotal),
              0
            )
            const remainingModifierTotal = remainingItems.reduce(
              (sum, item) => sum + Number(item.modifierTotal),
              0
            )

            await tx.order.update({
              where: { id: primaryOrder.id },
              data: {
                subtotal: remainingSubtotal,
                total: remainingSubtotal + remainingModifierTotal,
              },
            })
          }
        }
      }

      // If removing primary, promote another table
      if (isPrimaryBeingRemoved && remainingTables.length > 0) {
        const newPrimary = remainingTables[0]
        await tx.table.update({
          where: { id: newPrimary.id },
          data: {
            virtualGroupPrimary: true,
          },
        })
      }

      // Remove table from virtual group
      const updatedTable = await tx.table.update({
        where: { id: tableId },
        data: {
          virtualGroupId: null,
          virtualGroupPrimary: false,
          virtualGroupColor: null,
          virtualGroupCreatedAt: null,
          status: createNewOrder ? 'occupied' : 'available',
        },
        include: {
          section: { select: { id: true, name: true, color: true } },
        },
      })

      // Create audit log
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'virtual_group_member_removed',
          entityType: 'table',
          entityId: tableId,
          details: {
            virtualGroupId: groupId,
            removedTableId: tableId,
            removedTableName: tableToRemove.name,
            wasPrimary: isPrimaryBeingRemoved,
            newPrimaryId: isPrimaryBeingRemoved ? remainingTables[0]?.id : undefined,
            createdNewOrder: createNewOrder,
          },
        },
      })

      return updatedTable
    })

    // Emit real-time event
    tableEvents.virtualGroupMemberRemoved?.({
      virtualGroupId: groupId,
      tableId,
      locationId,
      timestamp: new Date().toISOString(),
      triggeredBy: employeeId,
    })

    return NextResponse.json({
      data: {
        table: {
          id: result.id,
          name: result.name,
          status: result.status,
          section: result.section,
        },
        remainingTables: remainingTables.length,
        message: `${tableToRemove.name} removed from virtual group`,
      },
    })
  } catch (error) {
    console.error('[VirtualCombine] Remove failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to remove table from virtual group', details: errorMessage },
      { status: 500 }
    )
  }
}
