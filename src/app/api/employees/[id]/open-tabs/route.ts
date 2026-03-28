import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { withVenue } from '@/lib/with-venue'
import { EmployeeRepository } from '@/lib/repositories'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Check if employee has open tabs/orders
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID is required')
    }

    // Find all open orders for this employee (read from snapshot)
    const openOrders = await db.orderSnapshot.findMany({
      where: {
        employeeId,
        locationId,
        status: { in: ['open', 'sent', 'in_progress'] },
      },
      select: {
        id: true,
        orderNumber: true,
        tabName: true,
        orderType: true,
        totalCents: true,
        guestCount: true,
        createdAt: true,
        tableName: true,
        items: {
          select: {
            id: true,
            name: true,
            quantity: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return ok({
      hasOpenTabs: openOrders.length > 0,
      count: openOrders.length,
      tabs: openOrders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        tabName: order.tabName,
        tableName: order.tableName || null,
        orderType: order.orderType,
        total: order.totalCents / 100,
        guestCount: order.guestCount,
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        createdAt: order.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to check open tabs:', error)
    return err('Failed to check open tabs', 500)
  }
})

// POST - Transfer all tabs to another employee (quick transfer)
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const body = await request.json()
    const { targetEmployeeId, locationId } = body

    if (!targetEmployeeId || !locationId) {
      return err('Target employee ID and location ID are required')
    }

    // Verify target employee exists and is active
    const targetEmployee = await EmployeeRepository.getEmployeeById(targetEmployeeId, locationId)

    if (!targetEmployee || !targetEmployee.isActive) {
      return notFound('Target employee not found or inactive')
    }

    // Query affected orders first (updateMany doesn't return IDs)
    // TODO: OrderRepository.getOrdersByEmployee returns full objects; only need IDs.
    // Consider adding a lightweight select variant.
    const affectedOrdersFull = await db.order.findMany({
      where: {
        employeeId,
        locationId,
        status: { in: ['open', 'sent', 'in_progress'] },
      },
      select: { id: true },
    })
    const affectedOrders = affectedOrdersFull

    // Transfer all open orders to target employee
    // TODO: Batch order update by employeeId -- no single repository method; raw db with locationId guard
    const result = await db.order.updateMany({
      where: {
        employeeId,
        locationId,
        status: { in: ['open', 'sent', 'in_progress'] },
      },
      data: {
        employeeId: targetEmployeeId,
      },
    })

    // Push DB changes upstream to Neon (fire-and-forget)
    pushUpstream()

    // Emit order events for each transferred order (fire-and-forget)
    for (const order of affectedOrders) {
      void emitOrderEvent(locationId, order.id, 'ORDER_METADATA_UPDATED', {
        employeeId: targetEmployeeId,
      })
    }

    return ok({
      success: true,
      transferredCount: result.count,
      message: `${result.count} tab(s) transferred successfully`,
    })
  } catch (error) {
    console.error('Failed to transfer tabs:', error)
    return err('Failed to transfer tabs', 500)
  }
}))
