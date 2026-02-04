import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'

/**
 * POST /api/tables/virtual-combine/[groupId]/dissolve
 *
 * Dissolve a virtual group:
 * - Clears virtualGroupId, virtualGroupPrimary, virtualGroupColor from all tables
 * - Optionally splits the order by table (creates separate orders)
 * - Or keeps all items on the primary table's order
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await params
    const body = await request.json()
    const { locationId, employeeId, splitOrder = false } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Find all tables in this virtual group
    const tables = await db.table.findMany({
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

    if (tables.length === 0) {
      return NextResponse.json(
        { error: 'Virtual group not found' },
        { status: 404 }
      )
    }

    const primaryTable = tables.find(t => t.virtualGroupPrimary)
    if (!primaryTable) {
      return NextResponse.json(
        { error: 'Primary table not found in group' },
        { status: 500 }
      )
    }

    // Check if any table has open orders with items (unless force flag is set)
    // Note: The query already filters for orders with status: 'open'
    const { force = false } = body
    if (!force) {
      const tablesWithUnpaidItems = tables.filter(table =>
        table.orders.some(order => order.items.length > 0)
      )
      if (tablesWithUnpaidItems.length > 0) {
        return NextResponse.json(
          {
            error: 'tables_have_open_orders',
            message: `Cannot dissolve group. ${tablesWithUnpaidItems.length} table(s) have unpaid items.`,
            tablesWithOrders: tablesWithUnpaidItems.map(t => ({ id: t.id, name: t.name })),
          },
          { status: 400 }
        )
      }
    }

    const primaryOrder = primaryTable.orders[0]

    // Start transaction
    await db.$transaction(async (tx) => {
      // Declare itemsByTable outside the if block so it's available in table update loop
      let itemsByTable: Map<string, typeof primaryOrder.items> | null = null

      // If splitting order by table and there's an active order
      if (splitOrder && primaryOrder) {
        // Group items by sourceTableId
        itemsByTable = new Map<string, typeof primaryOrder.items>()

        for (const item of primaryOrder.items) {
          // Items with sourceTableId go to that table
          // Items without stay on primary
          const targetTableId = item.sourceTableId || primaryTable.id
          if (!itemsByTable.has(targetTableId)) {
            itemsByTable.set(targetTableId, [])
          }
          itemsByTable.get(targetTableId)!.push(item)
        }

        // Create new orders for secondary tables
        for (const table of tables) {
          if (table.id === primaryTable.id) continue

          const tableItems = itemsByTable.get(table.id)
          if (!tableItems || tableItems.length === 0) continue

          // Calculate totals for this table's items
          const subtotal = tableItems.reduce(
            (sum, item) => sum + Number(item.itemTotal),
            0
          )
          const modifierTotal = tableItems.reduce(
            (sum, item) => sum + Number(item.modifierTotal),
            0
          )

          // Create new order for this table
          const newOrder = await tx.order.create({
            data: {
              locationId,
              employeeId: primaryOrder.employeeId,
              orderNumber: primaryOrder.orderNumber, // Keep same order number with suffix
              displayNumber: `${primaryOrder.displayNumber || primaryOrder.orderNumber}-${table.name}`,
              orderType: primaryOrder.orderType,
              orderTypeId: primaryOrder.orderTypeId,
              tableId: table.id,
              guestCount: 1,
              status: 'open',
              subtotal,
              total: subtotal + modifierTotal,
              parentOrderId: primaryOrder.id,
              notes: `Split from virtual group on ${primaryTable.name}`,
            },
          })

          // Move items to new order and clear sourceTableId
          await tx.orderItem.updateMany({
            where: {
              id: { in: tableItems.map(i => i.id) },
            },
            data: {
              orderId: newOrder.id,
              sourceTableId: null, // Clear since item now belongs to its actual table
            },
          })
        }

        // Recalculate primary order totals (items that stayed)
        const remainingItems = itemsByTable.get(primaryTable.id) || []
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
            notes: primaryOrder.notes
              ? `${primaryOrder.notes}\n[Split on dissolve]`
              : '[Split on dissolve]',
          },
        })

        // Clear sourceTableId on remaining items
        await tx.orderItem.updateMany({
          where: {
            orderId: primaryOrder.id,
            deletedAt: null,
          },
          data: {
            sourceTableId: null,
          },
        })
      }

      // Clear virtual group from all tables
      for (const table of tables) {
        await tx.table.update({
          where: { id: table.id },
          data: {
            virtualGroupId: null,
            virtualGroupPrimary: false,
            virtualGroupColor: null,
            virtualGroupCreatedAt: null,
            // Update status based on whether table still has an order
            status: splitOrder && table.id !== primaryTable.id
              ? itemsByTable?.get(table.id)?.length ? 'occupied' : 'available'
              : table.status,
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
          entityId: primaryTable.id,
          details: {
            virtualGroupId: groupId,
            tableIds: tables.map(t => t.id),
            tableNames: tables.map(t => t.name),
            splitOrder,
          },
        },
      })
    })

    // Emit real-time event
    tableEvents.virtualGroupDissolved?.({
      virtualGroupId: groupId,
      tableIds: tables.map(t => t.id),
      locationId,
      timestamp: new Date().toISOString(),
      triggeredBy: employeeId,
    })

    return NextResponse.json({
      data: {
        dissolved: true,
        tableIds: tables.map(t => t.id),
        splitOrder,
        message: `Virtual group dissolved${splitOrder ? ' with order split by table' : ''}`,
      },
    })
  } catch (error) {
    console.error('[VirtualCombine] Dissolve failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to dissolve virtual group', details: errorMessage },
      { status: 500 }
    )
  }
}
