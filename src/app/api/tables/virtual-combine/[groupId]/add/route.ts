import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'

/**
 * POST /api/tables/virtual-combine/[groupId]/add
 *
 * Add a table to an existing virtual group:
 * - Table joins the group with matching color
 * - If table has an order, optionally merge items to primary
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await params
    const body = await request.json()
    const { tableId, locationId, employeeId, mergeExistingOrder = false, offsetX = 0, offsetY = 0 } = body

    if (!tableId || !locationId) {
      return NextResponse.json(
        { error: 'tableId and locationId are required' },
        { status: 400 }
      )
    }

    // Find the virtual group's primary table
    const primaryTable = await db.table.findFirst({
      where: {
        virtualGroupId: groupId,
        virtualGroupPrimary: true,
        locationId,
        deletedAt: null,
      },
      include: {
        orders: {
          where: { status: 'open', deletedAt: null },
        },
      },
    })

    if (!primaryTable) {
      return NextResponse.json(
        { error: 'Virtual group not found' },
        { status: 404 }
      )
    }

    // Find the table to add
    const tableToAdd = await db.table.findFirst({
      where: {
        id: tableId,
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

    if (!tableToAdd) {
      return NextResponse.json(
        { error: 'Table to add not found' },
        { status: 404 }
      )
    }

    // Check if table is already in a group
    if (tableToAdd.virtualGroupId) {
      return NextResponse.json(
        { error: 'Table is already in a virtual group' },
        { status: 400 }
      )
    }

    // Check if table is physically combined
    if (tableToAdd.combinedWithId || (tableToAdd.combinedTableIds && (tableToAdd.combinedTableIds as string[]).length > 0)) {
      return NextResponse.json(
        { error: 'Table is physically combined and cannot be virtually combined' },
        { status: 400 }
      )
    }

    const tableOrder = tableToAdd.orders[0]
    const primaryOrder = primaryTable.orders[0]

    // If table has order and not merging, return requiresAction
    if (tableOrder && !mergeExistingOrder) {
      return NextResponse.json({
        requiresAction: true,
        existingOrder: {
          tableId: tableToAdd.id,
          tableName: tableToAdd.name,
          orderId: tableOrder.id,
          orderNumber: tableOrder.orderNumber,
          itemCount: tableOrder.items.length,
          total: Number(tableOrder.total),
        },
        message: 'Table has an open order that needs to be handled',
      })
    }

    // Start transaction
    const result = await db.$transaction(async (tx) => {
      // Handle existing order merge
      if (tableOrder && mergeExistingOrder) {
        if (primaryOrder) {
          // Move items to primary order with sourceTableId
          await tx.orderItem.updateMany({
            where: {
              orderId: tableOrder.id,
              locationId,
              deletedAt: null,
            },
            data: {
              orderId: primaryOrder.id,
              sourceTableId: tableToAdd.id,
            },
          })

          // Update primary order totals
          const newGuestCount = primaryOrder.guestCount + tableOrder.guestCount
          const combinedSubtotal = Number(primaryOrder.subtotal) + Number(tableOrder.subtotal)
          const combinedTax = Number(primaryOrder.taxTotal) + Number(tableOrder.taxTotal)
          const combinedTotal = Number(primaryOrder.total) + Number(tableOrder.total)

          await tx.order.update({
            where: { id: primaryOrder.id },
            data: {
              guestCount: newGuestCount,
              subtotal: combinedSubtotal,
              taxTotal: combinedTax,
              total: combinedTotal,
              notes: primaryOrder.notes
                ? `${primaryOrder.notes}\n[Added ${tableToAdd.name}]`
                : `[Added ${tableToAdd.name}]`,
            },
          })

          // Mark original order as merged
          await tx.order.update({
            where: { id: tableOrder.id },
            data: {
              status: 'merged',
              notes: `Merged into virtual group on ${primaryTable.name}`,
            },
          })
        } else {
          // No primary order - reassign this order to primary table
          await tx.orderItem.updateMany({
            where: {
              orderId: tableOrder.id,
              locationId,
              deletedAt: null,
            },
            data: {
              sourceTableId: tableToAdd.id,
            },
          })

          await tx.order.update({
            where: { id: tableOrder.id },
            data: {
              tableId: primaryTable.id,
            },
          })
        }
      }

      // Add table to virtual group
      const updatedTable = await tx.table.update({
        where: { id: tableId },
        data: {
          virtualGroupId: groupId,
          virtualGroupPrimary: false,
          virtualGroupColor: primaryTable.virtualGroupColor,
          virtualGroupCreatedAt: primaryTable.virtualGroupCreatedAt,
          virtualGroupOffsetX: offsetX,
          virtualGroupOffsetY: offsetY,
          status: tableOrder || primaryOrder ? 'occupied' : tableToAdd.status,
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
          action: 'virtual_group_member_added',
          entityType: 'table',
          entityId: tableId,
          details: {
            virtualGroupId: groupId,
            primaryTableId: primaryTable.id,
            addedTableId: tableId,
            addedTableName: tableToAdd.name,
            mergedOrder: mergeExistingOrder && !!tableOrder,
          },
        },
      })

      return updatedTable
    })

    // Emit real-time event
    tableEvents.virtualGroupMemberAdded?.({
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
          virtualGroupId: result.virtualGroupId,
          virtualGroupColor: result.virtualGroupColor,
          status: result.status,
          section: result.section,
        },
        message: `${tableToAdd.name} added to virtual group`,
      },
    })
  } catch (error) {
    console.error('[VirtualCombine] Add failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to add table to virtual group', details: errorMessage },
      { status: 500 }
    )
  }
}
