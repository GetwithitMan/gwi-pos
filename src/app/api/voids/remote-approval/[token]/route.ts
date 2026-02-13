/**
 * GET /api/voids/remote-approval/[token]
 *
 * Fetch approval request details by token for the mobile approval page.
 * Token is a 32-character hex string sent in the SMS link.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // Token should be 32 hex characters
    if (!token || token.length !== 32 || !/^[a-f0-9]+$/i.test(token)) {
      return NextResponse.json(
        { error: 'Invalid approval token', valid: false },
        { status: 400 }
      )
    }

    const approval = await db.remoteVoidApproval.findUnique({
      where: { approvalToken: token },
      include: {
        requestedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
            tabName: true,
            table: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    })

    if (!approval) {
      return NextResponse.json(
        { error: 'Approval request not found', valid: false },
        { status: 404 }
      )
    }

    // Check if token has expired
    const now = new Date()
    if (approval.approvalTokenExpiry < now) {
      return NextResponse.json({
        data: {
          valid: false,
          expired: true,
          status: 'expired',
          message: 'This approval request has expired',
        },
      })
    }

    // Check if already processed
    if (approval.status !== 'pending') {
      return NextResponse.json({
        data: {
          valid: false,
          expired: false,
          status: approval.status,
          message:
            approval.status === 'approved'
              ? 'This request has already been approved'
              : approval.status === 'rejected'
                ? 'This request has been rejected'
                : approval.status === 'used'
                  ? 'This approval code has already been used'
                  : 'This request is no longer pending',
          // Include code if already approved and not expired
          approvalCode:
            approval.status === 'approved' &&
            approval.approvalCodeExpiry &&
            approval.approvalCodeExpiry > now
              ? approval.approvalCode
              : null,
        },
      })
    }

    const serverName =
      approval.requestedBy.displayName ||
      `${approval.requestedBy.firstName} ${approval.requestedBy.lastName}`

    const managerName =
      approval.manager.displayName ||
      `${approval.manager.firstName} ${approval.manager.lastName}`

    return NextResponse.json({
      data: {
        valid: true,
        expired: false,
        status: approval.status,
        approval: {
          id: approval.id,
          serverName,
          managerName,
          itemName: approval.itemName,
          amount: Number(approval.amount),
          voidReason: approval.voidReason,
          voidType: approval.voidType,
          orderNumber: approval.orderNumber,
          tableName: approval.order.table?.name || approval.order.tabName,
          requestedAt: approval.createdAt.toISOString(),
          expiresAt: approval.approvalTokenExpiry.toISOString(),
        },
      },
    })
  } catch (error) {
    console.error('[RemoteVoidApproval] Error fetching by token:', error)
    return NextResponse.json(
      { error: 'Failed to fetch approval details', valid: false },
      { status: 500 }
    )
  }
})
