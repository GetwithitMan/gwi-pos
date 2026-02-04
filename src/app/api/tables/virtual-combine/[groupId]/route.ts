import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/tables/virtual-combine/[groupId]?locationId=xxx
 *
 * Get virtual group details with per-table financial breakdown.
 * Used for GroupSummary checkout view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Find all tables in this virtual group with their orders
    const tables = await db.table.findMany({
      where: {
        virtualGroupId: groupId,
        locationId,
        deletedAt: null,
      },
      include: {
        section: { select: { id: true, name: true, color: true } },
        orders: {
          where: { status: 'open', deletedAt: null },
          include: {
            items: {
              where: { deletedAt: null },
              include: {
                menuItem: { select: { id: true, name: true } },
              },
            },
            payments: {
              where: { deletedAt: null },
            },
          },
        },
      },
      orderBy: [
        { virtualGroupPrimary: 'desc' }, // Primary first
        { name: 'asc' },
      ],
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

    const primaryOrder = primaryTable.orders[0] ?? null

    // Type for order items from the query
    type OrderItemWithMenuItem = NonNullable<typeof primaryOrder>['items'][number]

    // Build per-table financial breakdown
    const financials = tables.map((table) => {
      // Get items for this table (based on sourceTableId or direct table assignment)
      let tableItems: OrderItemWithMenuItem[] = []

      if (primaryOrder) {
        if (table.id === primaryTable.id) {
          // Primary table gets items without sourceTableId (or with its own ID)
          tableItems = primaryOrder.items.filter(
            (item) => !item.sourceTableId || item.sourceTableId === table.id
          )
        } else {
          // Secondary tables get items with their sourceTableId
          tableItems = primaryOrder.items.filter(
            (item) => item.sourceTableId === table.id
          )
        }
      }

      // Calculate financials for this table's items
      const subtotal = tableItems.reduce(
        (sum: number, item) => sum + Number(item.itemTotal) + Number(item.modifierTotal),
        0
      )

      // For simplicity, assume tax is embedded in total or calculate based on settings
      // In a real system, you'd calculate tax per item based on tax rate
      const tax = 0 // Placeholder - implement based on your tax settings

      const total = subtotal + tax

      // Calculate payments made against this table's items
      // For virtual groups, payments are on the primary order
      // We'll attribute payments proportionally based on this table's share
      let paid = 0
      if (primaryOrder && primaryOrder.payments.length > 0) {
        const orderTotal = Number(primaryOrder.total)
        const tableShare = orderTotal > 0 ? subtotal / orderTotal : 0
        const totalPaid = primaryOrder.payments.reduce(
          (sum: number, p) => sum + Number(p.amount) + Number(p.tipAmount || 0),
          0
        )
        paid = totalPaid * tableShare
      }

      const remaining = Math.max(0, total - paid)

      return {
        tableId: table.id,
        tableName: table.name,
        tableAbbreviation: table.abbreviation,
        isPrimary: table.virtualGroupPrimary,
        sectionId: table.section?.id,
        sectionName: table.section?.name,
        itemCount: tableItems.length,
        subtotal,
        tax,
        total,
        paid,
        remaining,
        items: tableItems.map((item) => ({
          id: item.id,
          name: item.menuItem?.name || item.name || 'Unknown Item',
          quantity: item.quantity,
          price: Number(item.price),
          modifierTotal: Number(item.modifierTotal),
          itemTotal: Number(item.itemTotal),
          seatNumber: item.seatNumber,
        })),
      }
    })

    // Calculate group totals
    const grandSubtotal = financials.reduce((sum, f) => sum + f.subtotal, 0)
    const grandTax = financials.reduce((sum, f) => sum + f.tax, 0)
    const grandTotal = financials.reduce((sum, f) => sum + f.total, 0)
    const grandPaid = financials.reduce((sum, f) => sum + f.paid, 0)
    const grandRemaining = financials.reduce((sum, f) => sum + f.remaining, 0)
    const totalItems = financials.reduce((sum, f) => sum + f.itemCount, 0)

    return NextResponse.json({
      data: {
        virtualGroupId: groupId,
        groupColor: primaryTable.virtualGroupColor,
        createdAt: primaryTable.virtualGroupCreatedAt?.toISOString(),
        primaryTableId: primaryTable.id,
        primaryTableName: primaryTable.name,
        tableCount: tables.length,
        order: primaryOrder
          ? {
              id: primaryOrder.id,
              orderNumber: primaryOrder.orderNumber,
              displayNumber: primaryOrder.displayNumber,
              status: primaryOrder.status,
            }
          : null,
        totals: {
          subtotal: grandSubtotal,
          tax: grandTax,
          total: grandTotal,
          paid: grandPaid,
          remaining: grandRemaining,
          itemCount: totalItems,
        },
        financials,
      },
    })
  } catch (error) {
    console.error('[VirtualCombine] Get group failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to get virtual group', details: errorMessage },
      { status: 500 }
    )
  }
}
