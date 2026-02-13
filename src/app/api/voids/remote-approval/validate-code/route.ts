/**
 * POST /api/voids/remote-approval/validate-code
 *
 * Validates a 6-digit approval code entered at the POS.
 * Returns approval details if valid, marks as "used" to prevent reuse.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

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
      return NextResponse.json(
        { error: 'Missing required fields: orderId, code, employeeId' },
        { status: 400 }
      )
    }

    // Find approved request with matching code
    const approval = await db.remoteVoidApproval.findFirst({
      where: {
        orderId,
        orderItemId: orderItemId || null,
        approvalCode: code,
        status: 'approved',
      },
      include: {
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        requestedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    })

    if (!approval) {
      // Check if code exists but was already used
      const usedApproval = await db.remoteVoidApproval.findFirst({
        where: {
          orderId,
          approvalCode: code,
          status: 'used',
        },
      })

      if (usedApproval) {
        return NextResponse.json(
          { error: 'This approval code has already been used', valid: false },
          { status: 400 }
        )
      }

      return NextResponse.json(
        { error: 'Invalid approval code', valid: false },
        { status: 400 }
      )
    }

    // Check if code has expired
    const now = new Date()
    if (approval.approvalCodeExpiry && approval.approvalCodeExpiry < now) {
      // Mark as expired
      await db.remoteVoidApproval.update({
        where: { id: approval.id },
        data: { status: 'expired' },
      })

      return NextResponse.json(
        { error: 'Approval code has expired', valid: false },
        { status: 400 }
      )
    }

    // Mark as used
    await db.remoteVoidApproval.update({
      where: { id: approval.id },
      data: {
        status: 'used',
        usedAt: now,
      },
    })

    const managerName =
      approval.manager.displayName ||
      `${approval.manager.firstName} ${approval.manager.lastName}`

    return NextResponse.json({
      data: {
        valid: true,
        approvalId: approval.id,
        managerId: approval.managerId,
        managerName,
        voidType: approval.voidType,
        voidReason: approval.voidReason,
        amount: Number(approval.amount),
        itemName: approval.itemName,
        approvedAt: approval.approvedAt?.toISOString(),
      },
    })
  } catch (error) {
    console.error('[RemoteVoidApproval] Error validating code:', error)
    return NextResponse.json(
      { error: 'Failed to validate approval code', valid: false },
      { status: 500 }
    )
  }
})
