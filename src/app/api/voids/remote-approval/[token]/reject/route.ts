/**
 * POST /api/voids/remote-approval/[token]/reject
 *
 * Reject a void request via the web approval page.
 * Sends socket notification to POS terminal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchVoidApprovalUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

interface RejectBody {
  reason?: string
}

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const body: RejectBody = await request.json().catch(() => ({}))

    // Validate token format
    if (!token || token.length !== 32 || !/^[a-f0-9]+$/i.test(token)) {
      return NextResponse.json(
        { error: 'Invalid approval token' },
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
      },
    })

    if (!approval) {
      return NextResponse.json(
        { error: 'Approval request not found' },
        { status: 404 }
      )
    }

    // Check if token has expired
    const now = new Date()
    if (approval.approvalTokenExpiry < now) {
      return NextResponse.json(
        { error: 'This approval request has expired' },
        { status: 400 }
      )
    }

    // Check if already processed
    if (approval.status !== 'pending') {
      return NextResponse.json(
        { error: `This request has already been ${approval.status}` },
        { status: 400 }
      )
    }

    // Update approval record
    await db.remoteVoidApproval.update({
      where: { id: approval.id },
      data: {
        status: 'rejected',
        rejectedAt: now,
        rejectionReason: body.reason || null,
      },
    })

    const managerName =
      approval.manager.displayName ||
      `${approval.manager.firstName} ${approval.manager.lastName}`

    // Dispatch socket notification to POS terminal
    try {
      await dispatchVoidApprovalUpdate(approval.locationId, {
        type: 'rejected',
        approvalId: approval.id,
        terminalId: approval.requestingTerminalId || undefined,
        managerName,
      })
    } catch (socketError) {
      console.warn('[RemoteVoidApproval] Socket dispatch failed:', socketError)
    }

    return NextResponse.json({
      data: {
        success: true,
        message: 'Void request has been rejected',
      },
    })
  } catch (error) {
    console.error('[RemoteVoidApproval] Error rejecting:', error)
    return NextResponse.json(
      { error: 'Failed to reject request' },
      { status: 500 }
    )
  }
})
