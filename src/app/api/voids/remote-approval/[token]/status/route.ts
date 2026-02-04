/**
 * GET /api/voids/remote-approval/[token]/status
 *
 * Check the status of a remote void approval request.
 * Used for polling fallback when socket not available.
 * Note: 'token' here is the approval request ID (for status checks)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: id } = await params

    const approval = await db.remoteVoidApproval.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        approvalCode: true,
        approvalCodeExpiry: true,
        approvalTokenExpiry: true,
        approvedAt: true,
        rejectedAt: true,
        rejectionReason: true,
        manager: {
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
      return NextResponse.json(
        { error: 'Approval request not found' },
        { status: 404 }
      )
    }

    // Check if request has expired
    const now = new Date()
    if (approval.status === 'pending' && approval.approvalTokenExpiry < now) {
      // Mark as expired
      await db.remoteVoidApproval.update({
        where: { id },
        data: { status: 'expired' },
      })
      approval.status = 'expired'
    }

    // Check if approval code has expired
    if (
      approval.status === 'approved' &&
      approval.approvalCodeExpiry &&
      approval.approvalCodeExpiry < now
    ) {
      // Mark as expired (code expired before use)
      await db.remoteVoidApproval.update({
        where: { id },
        data: { status: 'expired' },
      })
      approval.status = 'expired'
    }

    const managerName =
      approval.manager.displayName ||
      `${approval.manager.firstName} ${approval.manager.lastName}`

    return NextResponse.json({
      data: {
        id: approval.id,
        status: approval.status,
        managerName,
        approvedAt: approval.approvedAt?.toISOString() || null,
        rejectedAt: approval.rejectedAt?.toISOString() || null,
        rejectionReason: approval.rejectionReason,
        // Only include code if approved and not expired
        approvalCode:
          approval.status === 'approved' &&
          approval.approvalCodeExpiry &&
          approval.approvalCodeExpiry > now
            ? approval.approvalCode
            : null,
        codeExpiresAt: approval.approvalCodeExpiry?.toISOString() || null,
        requestExpiresAt: approval.approvalTokenExpiry.toISOString(),
      },
    })
  } catch (error) {
    console.error('[RemoteVoidApproval] Error checking status:', error)
    return NextResponse.json(
      { error: 'Failed to check approval status' },
      { status: 500 }
    )
  }
}
