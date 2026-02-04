import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/tables/virtual-combine/[groupId]/transfer
 *
 * Transfer an entire virtual group to a new server.
 * This is a manager action that reassigns the order to a new employee.
 *
 * Use case: Server's shift ends but their large party is still dining.
 * Manager can transfer the entire group to the closing server in one action.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await params
    const body = await request.json()
    const { newServerId, locationId, managerId, reason } = body

    if (!newServerId || !locationId) {
      return NextResponse.json(
        { error: 'newServerId and locationId are required' },
        { status: 400 }
      )
    }

    // Verify the new server exists and is active
    const newServer = await db.employee.findFirst({
      where: {
        id: newServerId,
        locationId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, firstName: true, lastName: true },
    })

    if (!newServer) {
      return NextResponse.json(
        { error: 'New server not found or not active' },
        { status: 404 }
      )
    }

    // Find all tables in the virtual group
    const groupTables = await db.table.findMany({
      where: {
        virtualGroupId: groupId,
        locationId,
        deletedAt: null,
      },
      include: {
        orders: {
          where: { status: 'open', deletedAt: null },
          select: {
            id: true,
            employeeId: true,
            notes: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        },
      },
    })

    if (groupTables.length === 0) {
      return NextResponse.json(
        { error: 'Virtual group not found' },
        { status: 404 }
      )
    }

    const primaryTable = groupTables.find((t) => t.virtualGroupPrimary)
    if (!primaryTable) {
      return NextResponse.json(
        { error: 'Primary table not found in group' },
        { status: 500 }
      )
    }

    const primaryOrder = primaryTable.orders[0]
    if (!primaryOrder) {
      return NextResponse.json(
        { error: 'No open order found for this group' },
        { status: 400 }
      )
    }

    const previousServer = primaryOrder.employee
    const previousServerId = primaryOrder.employeeId

    // Don't transfer if it's the same server
    if (previousServerId === newServerId) {
      return NextResponse.json({
        data: {
          message: 'Order is already assigned to this server',
          serverId: newServerId,
          serverName: `${newServer.firstName} ${newServer.lastName}`,
        },
      })
    }

    // Execute the transfer in a transaction
    await db.$transaction(async (tx) => {
      // Update the order to the new server
      await tx.order.update({
        where: { id: primaryOrder.id },
        data: {
          employeeId: newServerId,
          notes: primaryOrder.notes
            ? `${primaryOrder.notes}\n[Transferred from ${previousServer?.firstName || 'Unknown'} to ${newServer.firstName} by manager]`
            : `[Transferred from ${previousServer?.firstName || 'Unknown'} to ${newServer.firstName} by manager]`,
        },
      })

      // Create audit log
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: managerId || null,
          action: 'virtual_group_transferred',
          entityType: 'order',
          entityId: primaryOrder.id,
          details: {
            virtualGroupId: groupId,
            previousServerId,
            previousServerName: previousServer
              ? `${previousServer.firstName} ${previousServer.lastName}`
              : 'Unknown',
            newServerId,
            newServerName: `${newServer.firstName} ${newServer.lastName}`,
            tableCount: groupTables.length,
            tableNames: groupTables.map((t) => t.name),
            reason: reason || 'Shift change',
          },
        },
      })
    })

    return NextResponse.json({
      data: {
        transferred: true,
        virtualGroupId: groupId,
        orderId: primaryOrder.id,
        previousServer: previousServer
          ? {
              id: previousServerId,
              name: `${previousServer.firstName} ${previousServer.lastName}`,
            }
          : null,
        newServer: {
          id: newServerId,
          name: `${newServer.firstName} ${newServer.lastName}`,
        },
        tableCount: groupTables.length,
        message: `Group transferred from ${previousServer?.firstName || 'Unknown'} to ${newServer.firstName}`,
      },
    })
  } catch (error) {
    console.error('[VirtualCombine] Transfer failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to transfer virtual group', details: errorMessage },
      { status: 500 }
    )
  }
}
