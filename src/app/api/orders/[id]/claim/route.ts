import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { dispatchOrderClaimed, dispatchOrderReleased } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('orders-claim')

/** Claim expiry window in seconds — stale claims are treated as unclaimed */
const CLAIM_EXPIRY_SECONDS = 60

// POST - Claim (soft-lock) an order
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { employeeId, terminalId } = body

    if (!employeeId) {
      return NextResponse.json({ error: 'Missing required field: employeeId' }, { status: 400 })
    }

    const now = new Date()
    const expiryThreshold = new Date(now.getTime() - CLAIM_EXPIRY_SECONDS * 1000)

    // Use a transaction with FOR UPDATE to prevent race conditions
    const result = await db.$transaction(async (tx) => {
      // Lock the order row
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      // Read current claim state via raw query (columns may not be in Prisma schema)
      const rows: any[] = await tx.$queryRawUnsafe(
        `SELECT id, "locationId", "employeeId", "status", "deletedAt",
                "claimedByEmployeeId", "claimedByTerminalId", "claimedAt"
         FROM "Order"
         WHERE id = $1`,
        orderId
      )

      if (rows.length === 0) {
        return { error: 'Order not found', status: 404 }
      }

      const order = rows[0]

      if (order.deletedAt !== null) {
        return { error: 'Order not found', status: 404 }
      }

      // Check if already claimed by ANOTHER employee/terminal
      if (
        order.claimedByEmployeeId &&
        order.claimedAt &&
        new Date(order.claimedAt) > expiryThreshold &&
        order.claimedByEmployeeId !== employeeId
      ) {
        // Active claim by someone else — look up their name
        const claimEmployee = await tx.employee.findUnique({
          where: { id: order.claimedByEmployeeId },
          select: { firstName: true, lastName: true },
        })
        const claimedByName = claimEmployee
          ? `${claimEmployee.firstName} ${claimEmployee.lastName ?? ''}`.trim()
          : 'Unknown'

        return {
          error: 'Order is currently open',
          status: 409,
          claimedBy: {
            employeeId: order.claimedByEmployeeId,
            employeeName: claimedByName,
            terminalId: order.claimedByTerminalId,
            claimedAt: order.claimedAt,
          },
        }
      }

      // Claim the order (new claim, expired claim, or same employee refreshing)
      await tx.$executeRawUnsafe(
        `UPDATE "Order"
         SET "claimedByEmployeeId" = $1,
             "claimedByTerminalId" = $2,
             "claimedAt" = $3
         WHERE id = $4`,
        employeeId,
        terminalId || null,
        now,
        orderId
      )

      return {
        claimed: true,
        locationId: order.locationId,
        employeeId,
        terminalId: terminalId || null,
      }
    })

    // Handle error responses from transaction
    if ('error' in result) {
      const response: any = { error: result.error }
      if ('claimedBy' in result) {
        response.claimedBy = result.claimedBy
      }
      return NextResponse.json(response, { status: result.status })
    }

    // Look up employee name for socket event
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true },
    })
    const employeeName = employee
      ? `${employee.firstName} ${employee.lastName ?? ''}`.trim()
      : null

    // Fire-and-forget socket dispatch
    void dispatchOrderClaimed(result.locationId, {
      orderId,
      employeeId,
      employeeName,
      terminalId: result.terminalId,
      claimedAt: now.toISOString(),
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({ claimed: true })
  } catch (error) {
    console.error('Failed to claim order:', error)
    return NextResponse.json({ error: 'Failed to claim order' }, { status: 500 })
  }
}))

// DELETE - Release a claim on an order
export const DELETE = withVenue(withAuth({ allowCellular: true }, async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    // Try body first, fall back to query params
    let employeeId: string | null = null
    let terminalId: string | null = null

    const body = await request.json().catch(() => null)
    if (body) {
      employeeId = body.employeeId || null
      terminalId = body.terminalId || null
    }
    if (!employeeId) {
      const url = new URL(request.url)
      employeeId = url.searchParams.get('employeeId')
      terminalId = url.searchParams.get('terminalId')
    }

    if (!employeeId) {
      return NextResponse.json({ error: 'Missing required field: employeeId' }, { status: 400 })
    }

    const now = new Date()
    const expiryThreshold = new Date(now.getTime() - CLAIM_EXPIRY_SECONDS * 1000)

    const result = await db.$transaction(async (tx) => {
      // Lock the order row
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      const rows: any[] = await tx.$queryRawUnsafe(
        `SELECT id, "locationId", "claimedByEmployeeId", "claimedByTerminalId", "claimedAt", "deletedAt"
         FROM "Order"
         WHERE id = $1`,
        orderId
      )

      if (rows.length === 0) {
        return { error: 'Order not found', status: 404 }
      }

      const order = rows[0]

      if (order.deletedAt !== null) {
        return { error: 'Order not found', status: 404 }
      }

      // Only release if:
      // 1. The claim belongs to this employee, OR
      // 2. The claim is expired (stale)
      const isOwnClaim = order.claimedByEmployeeId === employeeId
      const isExpired = !order.claimedAt || new Date(order.claimedAt) <= expiryThreshold
      const isUnclaimed = !order.claimedByEmployeeId

      if (!isOwnClaim && !isExpired && !isUnclaimed) {
        return { error: 'Cannot release another employee\'s active claim', status: 403 }
      }

      // Clear the claim
      await tx.$executeRawUnsafe(
        `UPDATE "Order"
         SET "claimedByEmployeeId" = NULL,
             "claimedByTerminalId" = NULL,
             "claimedAt" = NULL
         WHERE id = $1`,
        orderId
      )

      return { released: true, locationId: order.locationId }
    })

    // Handle error responses from transaction
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    // Fire-and-forget socket dispatch
    void dispatchOrderReleased(result.locationId, {
      orderId,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({ released: true })
  } catch (error) {
    console.error('Failed to release order claim:', error)
    return NextResponse.json({ error: 'Failed to release order claim' }, { status: 500 })
  }
}))
