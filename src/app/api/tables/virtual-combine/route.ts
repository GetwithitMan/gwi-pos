import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'
import {
  calculateVirtualSeatNumbers,
  type TableWithSeats,
} from '@/lib/virtual-group-seats'

// Color palette for virtual groups (distinct from physical combine)
const VIRTUAL_GROUP_COLORS = [
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f472b6', // pink
  '#a855f7', // purple
  '#fb923c', // orange
  '#34d399', // emerald
  '#60a5fa', // blue
  '#fbbf24', // amber
]

/**
 * Get a consistent color for a virtual group based on its ID
 */
function getVirtualGroupColor(groupId: string): string {
  let hash = 0
  for (let i = 0; i < groupId.length; i++) {
    hash = ((hash << 5) - hash) + groupId.charCodeAt(i)
    hash = hash & hash // Convert to 32bit integer
  }
  return VIRTUAL_GROUP_COLORS[Math.abs(hash) % VIRTUAL_GROUP_COLORS.length]
}

/**
 * POST /api/tables/virtual-combine
 *
 * Create a virtual group from selected tables:
 * - Tables remain in their physical positions (no movement)
 * - Each table keeps its own seat numbers (T2-S1 notation)
 * - Tables share a single order on the primary table
 * - All tables get matching pulsing glow color
 *
 * If any tables have existing orders, returns requiresAction=true
 * with the list of orders that need to be handled (merge or close)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      tableIds,
      primaryTableId,
      locationId,
      employeeId,
      existingOrderActions, // Optional: { orderId, action: 'merge' | 'close' }[]
      visualOffsets, // Optional: { tableId: string, offsetX: number, offsetY: number }[]
    } = body

    if (!tableIds || !Array.isArray(tableIds) || tableIds.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 table IDs are required' },
        { status: 400 }
      )
    }

    if (!primaryTableId || !tableIds.includes(primaryTableId)) {
      return NextResponse.json(
        { error: 'primaryTableId must be one of the selected tables' },
        { status: 400 }
      )
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Fetch all selected tables
    const tables = await db.table.findMany({
      where: {
        id: { in: tableIds },
        locationId,
        deletedAt: null,
      },
      include: {
        orders: {
          where: { status: 'open', deletedAt: null },
          include: {
            items: {
              where: { deletedAt: null },
              select: { id: true, name: true, price: true, quantity: true },
            },
          },
        },
      },
    })

    if (tables.length !== tableIds.length) {
      return NextResponse.json(
        { error: 'One or more tables not found' },
        { status: 404 }
      )
    }

    // Check if any table is already in a virtual group
    const alreadyGrouped = tables.find(t => t.virtualGroupId)
    if (alreadyGrouped) {
      return NextResponse.json(
        { error: `Table "${alreadyGrouped.name}" is already in a virtual group` },
        { status: 400 }
      )
    }

    // Check if any table is already physically combined
    const alreadyCombined = tables.find(t => t.combinedWithId || (t.combinedTableIds && (t.combinedTableIds as string[]).length > 0))
    if (alreadyCombined) {
      return NextResponse.json(
        { error: `Table "${alreadyCombined.name}" is already physically combined` },
        { status: 400 }
      )
    }

    // Check for existing orders that need handling
    const tablesWithOrders = tables.filter(t => t.orders.length > 0)
    const secondaryTablesWithOrders = tablesWithOrders.filter(t => t.id !== primaryTableId)

    // If there are secondary tables with orders and no actions provided, return requiresAction
    if (secondaryTablesWithOrders.length > 0 && !existingOrderActions) {
      return NextResponse.json({
        requiresAction: true,
        existingOrders: secondaryTablesWithOrders.map(t => ({
          tableId: t.id,
          tableName: t.name,
          orderId: t.orders[0].id,
          orderNumber: t.orders[0].orderNumber,
          itemCount: t.orders[0].items.length,
          total: Number(t.orders[0].total),
        })),
        message: 'Some tables have open orders that need to be handled',
      })
    }

    // Generate virtual group ID and color
    const virtualGroupId = crypto.randomUUID()
    const virtualGroupColor = getVirtualGroupColor(virtualGroupId)
    const virtualGroupCreatedAt = new Date()

    // Start transaction
    const result = await db.$transaction(async (tx) => {
      const primaryTable = tables.find(t => t.id === primaryTableId)!
      const primaryOrder = primaryTable.orders[0]

      // Handle existing orders on secondary tables
      if (existingOrderActions && Array.isArray(existingOrderActions)) {
        for (const action of existingOrderActions) {
          const { orderId, action: orderAction } = action
          const table = tables.find(t => t.orders.some(o => o.id === orderId))

          if (!table || table.id === primaryTableId) continue

          const order = table.orders.find(o => o.id === orderId)
          if (!order) continue

          if (orderAction === 'merge') {
            // Merge items into primary order
            if (primaryOrder) {
              // Move items to primary order, setting sourceTableId
              await tx.orderItem.updateMany({
                where: {
                  orderId: order.id,
                  locationId,
                  deletedAt: null,
                },
                data: {
                  orderId: primaryOrder.id,
                  sourceTableId: table.id, // Track which table this came from
                },
              })

              // Update primary order totals
              const newGuestCount = primaryOrder.guestCount + order.guestCount
              const combinedSubtotal = Number(primaryOrder.subtotal) + Number(order.subtotal)
              const combinedTax = Number(primaryOrder.taxTotal) + Number(order.taxTotal)
              const combinedTotal = Number(primaryOrder.total) + Number(order.total)

              await tx.order.update({
                where: { id: primaryOrder.id },
                data: {
                  guestCount: newGuestCount,
                  subtotal: combinedSubtotal,
                  taxTotal: combinedTax,
                  total: combinedTotal,
                  notes: primaryOrder.notes
                    ? `${primaryOrder.notes}\n[Merged from ${table.name}]`
                    : `[Merged from ${table.name}]`,
                },
              })

              // Mark original order as merged (prevents double-counting in EOD)
              await tx.order.update({
                where: { id: order.id },
                data: {
                  status: 'merged',
                  notes: `Merged into order #${primaryOrder.orderNumber} (virtual group)`,
                },
              })
            } else {
              // No primary order - reassign this order to primary table
              // and set sourceTableId on items
              await tx.orderItem.updateMany({
                where: {
                  orderId: order.id,
                  locationId,
                  deletedAt: null,
                },
                data: {
                  sourceTableId: table.id,
                },
              })

              await tx.order.update({
                where: { id: order.id },
                data: {
                  tableId: primaryTableId,
                },
              })
            }
          }
          // 'close' action would redirect to payment flow - handled by frontend
        }
      }

      // Update all tables with virtual group info
      for (const table of tables) {
        // Find visual offset for this table (if provided)
        const offset = visualOffsets?.find((o: { tableId: string; offsetX: number; offsetY: number }) => o.tableId === table.id)

        await tx.table.update({
          where: { id: table.id },
          data: {
            virtualGroupId,
            virtualGroupPrimary: table.id === primaryTableId,
            virtualGroupColor,
            virtualGroupCreatedAt,
            // Store visual offsets for rendering after refresh
            virtualGroupOffsetX: offset?.offsetX ?? 0,
            virtualGroupOffsetY: offset?.offsetY ?? 0,
            // Update status to occupied if any table has an order
            status: tablesWithOrders.length > 0 ? 'occupied' : table.status,
          },
        })
      }

      // Handle seat renumbering for virtual group
      // Fetch all seats for the tables in the group
      const allSeats = await tx.seat.findMany({
        where: {
          tableId: { in: tableIds },
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          tableId: true,
          seatNumber: true,
          label: true,
          relativeX: true,
          relativeY: true,
        },
        orderBy: [{ tableId: 'asc' }, { seatNumber: 'asc' }],
      })

      if (allSeats.length > 0) {
        // Prepare table data for virtual seat calculation
        const tablesWithSeats: TableWithSeats[] = tables.map((table) => ({
          id: table.id,
          name: table.name,
          posX: table.posX,
          posY: table.posY,
          seats: allSeats
            .filter((seat) => seat.tableId === table.id)
            .map((seat) => ({
              id: seat.id,
              seatNumber: seat.seatNumber,
              label: seat.label,
              relativeX: seat.relativeX,
              relativeY: seat.relativeY,
            })),
        }))

        // Calculate virtual seat numbers (primary table first, then others clockwise)
        const virtualSeatInfo = calculateVirtualSeatNumbers(
          primaryTableId,
          tablesWithSeats
        )

        // Update each seat with virtual label (e.g., "T1-3")
        for (const seatInfo of virtualSeatInfo) {
          await tx.seat.update({
            where: { id: seatInfo.seatId },
            data: {
              label: seatInfo.virtualLabel, // Store "TableName-SeatNum" format
            },
          })
        }
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'virtual_group_created',
          entityType: 'table',
          entityId: primaryTableId,
          details: {
            virtualGroupId,
            primaryTableId,
            memberTableIds: tableIds,
            tableNames: tables.map(t => t.name),
            groupColor: virtualGroupColor,
            ordersHandled: existingOrderActions?.length || 0,
            seatsRenumbered: allSeats.length,
          },
        },
      })

      // Fetch updated tables for response
      const updatedTables = await tx.table.findMany({
        where: { id: { in: tableIds } },
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

      return updatedTables
    })

    // Emit real-time event
    tableEvents.virtualGroupCreated?.({
      virtualGroupId,
      primaryTableId,
      tableIds,
      groupColor: virtualGroupColor,
      locationId,
      timestamp: new Date().toISOString(),
      triggeredBy: employeeId,
    })

    return NextResponse.json({
      data: {
        virtualGroupId,
        groupColor: virtualGroupColor,
        primaryTableId,
        memberTableIds: tableIds,
        tables: result.map(t => ({
          id: t.id,
          name: t.name,
          virtualGroupId: t.virtualGroupId,
          virtualGroupPrimary: t.virtualGroupPrimary,
          virtualGroupColor: t.virtualGroupColor,
          status: t.status,
          section: t.section,
          currentOrder: t.orders[0]
            ? {
                id: t.orders[0].id,
                orderNumber: t.orders[0].orderNumber,
                guestCount: t.orders[0].guestCount,
                total: Number(t.orders[0].total),
                openedAt: t.orders[0].createdAt.toISOString(),
              }
            : null,
        })),
        message: `Virtual group created with ${tableIds.length} tables`,
      },
    })
  } catch (error) {
    console.error('[VirtualCombine] Failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to create virtual group', details: errorMessage },
      { status: 500 }
    )
  }
}

/**
 * GET /api/tables/virtual-combine?locationId=xxx
 *
 * List all active virtual groups for a location
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

    // Find all tables that are in virtual groups
    const groupedTables = await db.table.findMany({
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
        virtualGroupColor: true,
        virtualGroupCreatedAt: true,
      },
      orderBy: { virtualGroupCreatedAt: 'desc' },
    })

    // Group by virtualGroupId
    const groups = new Map<string, typeof groupedTables>()
    for (const table of groupedTables) {
      const groupId = table.virtualGroupId!
      if (!groups.has(groupId)) {
        groups.set(groupId, [])
      }
      groups.get(groupId)!.push(table)
    }

    // Format response
    const virtualGroups = Array.from(groups.entries()).map(([groupId, tables]) => {
      const primary = tables.find(t => t.virtualGroupPrimary)
      return {
        virtualGroupId: groupId,
        primaryTableId: primary?.id,
        groupColor: primary?.virtualGroupColor,
        createdAt: primary?.virtualGroupCreatedAt,
        tables: tables.map(t => ({
          id: t.id,
          name: t.name,
          isPrimary: t.virtualGroupPrimary,
        })),
      }
    })

    return NextResponse.json({ data: virtualGroups })
  } catch (error) {
    console.error('[VirtualCombine] GET failed:', error)
    return NextResponse.json(
      { error: 'Failed to list virtual groups' },
      { status: 500 }
    )
  }
}
