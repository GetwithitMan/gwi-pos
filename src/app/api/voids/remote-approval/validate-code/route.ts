/**
 * POST /api/voids/remote-approval/validate-code
 *
 * Validates a 6-digit approval code entered at the POS.
 * Returns approval details if valid, marks as "used" to prevent reuse.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

interface ValidateCodeBody {
  orderId: string
  orderItemId?: string
  code: string
  employeeId: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body: ValidateCodeBody = await request.json()
    const { orderId, orderItemId, code, employeeId } = body

    if (!orderId || !code || !employeeId) {
      return err('Missing required fields: orderId, code, employeeId')
    }

    // Atomically find + lock + mark-as-used to prevent double-use race condition
    const result = await db.$transaction(async (tx) => {
      // Lock the approval row with FOR UPDATE to prevent concurrent validation
      const [lockedRow] = await tx.$queryRaw<any[]>`SELECT * FROM "RemoteVoidApproval" WHERE "orderId" = ${orderId} AND "approvalCode" = ${code} FOR UPDATE`

      if (!lockedRow || (lockedRow.orderItemId !== (orderItemId || null) && orderItemId)) {
        // Check if code was already used (for better error message)
        const [usedRow] = await tx.$queryRaw<any[]>`SELECT id FROM "RemoteVoidApproval" WHERE "orderId" = ${orderId} AND "approvalCode" = ${code} AND status = 'used'`
        if (usedRow) {
          return { error: 'This approval code has already been used', status: 400 }
        }
        return { error: 'Invalid approval code', status: 400 }
      }

      if (lockedRow.status === 'used') {
        return { error: 'This approval code has already been used', status: 400 }
      }

      if (lockedRow.status !== 'approved') {
        return { error: 'Invalid approval code', status: 400 }
      }

      // Check if code has expired
      const now = new Date()
      if (lockedRow.approvalCodeExpiry && new Date(lockedRow.approvalCodeExpiry) < now) {
        await tx.remoteVoidApproval.update({
          where: { id: lockedRow.id },
          data: { status: 'expired' },
        })
        return { error: 'Approval code has expired', status: 400 }
      }

      // Mark as used atomically (still under FOR UPDATE lock)
      await tx.remoteVoidApproval.update({
        where: { id: lockedRow.id },
        data: { status: 'used', usedAt: now },
      })

      // Fetch full approval with manager info for response
      const approval = await tx.remoteVoidApproval.findUnique({
        where: { id: lockedRow.id },
        include: {
          manager: {
            select: { id: true, firstName: true, lastName: true, displayName: true },
          },
        },
      })

      return { approval }
    })

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error, valid: false },
        { status: result.status }
      )
    }

    const { approval } = result
    if (!approval) {
      return NextResponse.json(
        { error: 'Invalid approval code', valid: false },
        { status: 400 }
      )
    }

    const managerName =
      approval.manager.displayName ||
      `${approval.manager.firstName} ${approval.manager.lastName}`

    return ok({
        valid: true,
        approvalId: approval.id,
        managerId: approval.managerId,
        managerName,
        voidType: approval.voidType,
        voidReason: approval.voidReason,
        amount: Number(approval.amount),
        itemName: approval.itemName,
        approvedAt: approval.approvedAt?.toISOString(),
      })
  } catch (error) {
    console.error('[RemoteVoidApproval] Error validating code:', error)
    return NextResponse.json(
      { error: 'Failed to validate approval code', valid: false },
      { status: 500 }
    )
  }
})
