import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'

/**
 * POST /api/tables/virtual-combine/[groupId]/set-primary
 *
 * Change the primary table in a virtual group:
 * - The order moves from the old primary to the new primary
 * - sourceTableId on items is preserved for T-S notation
 * - UI should update to show new primary in order panel header
 *
 * Use case: Server realizes they started the group on the wrong table
 * and needs to switch which table is the "master"
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await params
    const body = await request.json()
    const { newPrimaryTableId, locationId, employeeId } = body

    if (!newPrimaryTableId || !locationId) {
      return NextResponse.json(
        { error: 'newPrimaryTableId and locationId are required' },
        { status: 400 }
      )
    }

    // Find all tables in this virtual group
    const groupTables = await db.table.findMany({
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
        section: { select: { id: true, name: true, color: true } },
      },
    })

    if (groupTables.length === 0) {
      return NextResponse.json(
        { error: 'Virtual group not found' },
        { status: 404 }
      )
    }

    const newPrimaryTable = groupTables.find(t => t.id === newPrimaryTableId)
    if (!newPrimaryTable) {
      return NextResponse.json(
        { error: 'New primary table is not part of this virtual group' },
        { status: 400 }
      )
    }

    const currentPrimaryTable = groupTables.find(t => t.virtualGroupPrimary)
    if (!currentPrimaryTable) {
      return NextResponse.json(
        { error: 'No current primary table found' },
        { status: 500 }
      )
    }

    // If already primary, nothing to do
    if (currentPrimaryTable.id === newPrimaryTableId) {
      return NextResponse.json({
        data: {
          message: 'Table is already the primary',
          primaryTableId: newPrimaryTableId,
        },
      })
    }

    const currentOrder = currentPrimaryTable.orders[0]

    // Execute the switch in a transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Move the order to the new primary table
      if (currentOrder) {
        await tx.order.update({
          where: { id: currentOrder.id },
          data: {
            tableId: newPrimaryTableId,
            notes: currentOrder.notes
              ? `${currentOrder.notes}\n[Primary switched from ${currentPrimaryTable.name} to ${newPrimaryTable.name}]`
              : `[Primary switched from ${currentPrimaryTable.name} to ${newPrimaryTable.name}]`,
          },
        })
      }

      // 2. Update old primary - remove primary flag
      await tx.table.update({
        where: { id: currentPrimaryTable.id },
        data: {
          virtualGroupPrimary: false,
        },
      })

      // 3. Update new primary - set primary flag
      const updatedNewPrimary = await tx.table.update({
        where: { id: newPrimaryTableId },
        data: {
          virtualGroupPrimary: true,
        },
        include: {
          section: { select: { id: true, name: true, color: true } },
          orders: {
            where: { status: 'open', deletedAt: null },
            select: {
              id: true,
              orderNumber: true,
              guestCount: true,
              total: true,
              createdAt: true,
            },
          },
        },
      })

      // 4. Create audit log
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'virtual_group_primary_changed',
          entityType: 'table',
          entityId: newPrimaryTableId,
          details: {
            virtualGroupId: groupId,
            previousPrimaryId: currentPrimaryTable.id,
            previousPrimaryName: currentPrimaryTable.name,
            newPrimaryId: newPrimaryTableId,
            newPrimaryName: newPrimaryTable.name,
            orderId: currentOrder?.id || null,
          },
        },
      })

      return updatedNewPrimary
    })

    // Emit real-time event
    tableEvents.virtualGroupPrimaryChanged?.({
      virtualGroupId: groupId,
      previousPrimaryId: currentPrimaryTable.id,
      newPrimaryId: newPrimaryTableId,
      locationId,
      timestamp: new Date().toISOString(),
      triggeredBy: employeeId,
    })

    return NextResponse.json({
      data: {
        table: {
          id: result.id,
          name: newPrimaryTable.name,
          virtualGroupId: result.virtualGroupId,
          virtualGroupPrimary: result.virtualGroupPrimary,
          virtualGroupColor: result.virtualGroupColor,
          status: result.status,
          section: result.section,
          currentOrder: result.orders[0]
            ? {
                id: result.orders[0].id,
                orderNumber: result.orders[0].orderNumber,
                guestCount: result.orders[0].guestCount,
                total: Number(result.orders[0].total),
                openedAt: result.orders[0].createdAt.toISOString(),
              }
            : null,
        },
        previousPrimaryId: currentPrimaryTable.id,
        message: `Primary table changed from ${currentPrimaryTable.name} to ${newPrimaryTable.name}`,
      },
    })
  } catch (error) {
    console.error('[VirtualCombine] Set primary failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to change primary table', details: errorMessage },
      { status: 500 }
    )
  }
}
