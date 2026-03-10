import type { PrismaClient } from '@prisma/client'

const CLAIM_EXPIRY_MS = 60_000 // 60 seconds

/**
 * Check if an order is claimed by another employee.
 * Returns null if unclaimed/expired/same employee, or error object if blocked.
 */
export async function checkOrderClaim(
  db: PrismaClient | any,
  orderId: string,
  requestingEmployeeId: string,
  requestingTerminalId?: string | null,
): Promise<{ error: string; claimedBy: any; status: number } | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      claimedByEmployeeId: true,
      claimedByTerminalId: true,
      claimedAt: true,
      claimedByEmployee: { select: { displayName: true } },
    },
  })

  if (!order?.claimedByEmployeeId || !order?.claimedAt) return null

  // Check if claim is expired
  const claimAge = Date.now() - new Date(order.claimedAt).getTime()
  if (claimAge > CLAIM_EXPIRY_MS) return null

  // Same employee — allow (they own the claim)
  if (order.claimedByEmployeeId === requestingEmployeeId) return null

  return {
    error: `Order is currently being edited by ${order.claimedByEmployee?.displayName || 'another employee'}`,
    claimedBy: {
      employeeId: order.claimedByEmployeeId,
      employeeName: order.claimedByEmployee?.displayName,
      terminalId: order.claimedByTerminalId,
      claimedAt: order.claimedAt,
    },
    status: 409,
  }
}
