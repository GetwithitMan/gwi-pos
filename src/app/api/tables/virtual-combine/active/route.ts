import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/tables/virtual-combine/active?locationId=xxx
 *
 * Get all active virtual groups for the manager dashboard.
 * Returns grouped data with member tables, orders, and statistics.
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

    // Find all tables that are in a virtual group
    const tablesInGroups = await db.table.findMany({
      where: {
        locationId,
        virtualGroupId: { not: null },
        deletedAt: null,
      },
      include: {
        section: { select: { id: true, name: true, color: true } },
        orders: {
          where: { status: 'open', deletedAt: null },
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true },
            },
            items: {
              where: { deletedAt: null },
              select: { id: true },
            },
            payments: {
              where: { deletedAt: null },
              select: { id: true, amount: true, tipAmount: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    // Group tables by virtualGroupId
    const groupsMap = new Map<string, {
      id: string
      primaryTableId: string
      primaryTableName: string
      groupColor: string
      createdAt: string
      members: typeof tablesInGroups
      totalSpend: number
      totalGuests: number
      totalItems: number
      hasPendingPayments: boolean
      serverId?: string
      serverName: string
    }>()

    for (const table of tablesInGroups) {
      const groupId = table.virtualGroupId!

      if (!groupsMap.has(groupId)) {
        groupsMap.set(groupId, {
          id: groupId,
          primaryTableId: '',
          primaryTableName: '',
          groupColor: table.virtualGroupColor || '#06b6d4',
          createdAt: table.virtualGroupCreatedAt?.toISOString() || new Date().toISOString(),
          members: [],
          totalSpend: 0,
          totalGuests: 0,
          totalItems: 0,
          hasPendingPayments: false,
          serverName: 'Unassigned',
        })
      }

      const group = groupsMap.get(groupId)!
      group.members.push(table)

      // Calculate totals from orders
      const order = table.orders[0]
      if (order) {
        group.totalSpend += Number(order.total)
        group.totalGuests += order.guestCount
        group.totalItems += order.items.length

        if (order.payments.length > 0) {
          group.hasPendingPayments = true
        }
      }

      // Track primary table info
      if (table.virtualGroupPrimary) {
        group.primaryTableId = table.id
        group.primaryTableName = table.name
        if (order?.employee) {
          group.serverId = order.employee.id
          group.serverName = `${order.employee.firstName} ${order.employee.lastName}`
        }
      }
    }

    // Convert to array and format for response
    const groups = Array.from(groupsMap.values()).map((group) => ({
      id: group.id,
      primaryTableId: group.primaryTableId,
      primaryTableName: group.primaryTableName,
      groupColor: group.groupColor,
      createdAt: group.createdAt,
      tableCount: group.members.length,
      totalSpend: group.totalSpend,
      totalGuests: group.totalGuests,
      totalItems: group.totalItems,
      hasPendingPayments: group.hasPendingPayments,
      serverId: group.serverId,
      serverName: group.serverName,
      members: group.members.map((t) => ({
        id: t.id,
        name: t.name,
        abbreviation: t.abbreviation,
        isPrimary: t.virtualGroupPrimary,
        sectionName: t.section?.name,
        currentOrder: t.orders[0]
          ? {
              id: t.orders[0].id,
              orderNumber: t.orders[0].orderNumber,
              total: Number(t.orders[0].total),
              guestCount: t.orders[0].guestCount,
              itemCount: t.orders[0].items.length,
            }
          : null,
      })),
    }))

    // Sort by creation time (oldest first - they've been waiting longest)
    groups.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    // Calculate summary stats
    const summary = {
      totalGroups: groups.length,
      totalTablesLinked: tablesInGroups.length,
      totalGroupSpend: groups.reduce((sum, g) => sum + g.totalSpend, 0),
      highValueGroups: groups.filter((g) => g.totalSpend >= 500).length,
    }

    return NextResponse.json({
      data: {
        summary,
        groups,
      },
    })
  } catch (error) {
    console.error('[VirtualCombine] Get active groups failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to get active virtual groups', details: errorMessage },
      { status: 500 }
    )
  }
}
