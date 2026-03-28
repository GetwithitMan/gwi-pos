/**
 * POST /api/voids/remote-approval/[token]/reject
 *
 * Reject a void request via the web approval page.
 * Sends socket notification to POS terminal.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { dispatchVoidApprovalUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

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
      return err('Invalid approval token')
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
      return notFound('Approval request not found')
    }

    // Check if token has expired
    const now = new Date()
    if (approval.approvalTokenExpiry < now) {
      return err('This approval request has expired')
    }

    // Check if already processed
    if (approval.status !== 'pending') {
      return err(`This request has already been ${approval.status}`)
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
    pushUpstream()

    const managerName =
      approval.manager.displayName ||
      `${approval.manager.firstName} ${approval.manager.lastName}`

    // Dispatch socket notification to POS terminal
    void dispatchVoidApprovalUpdate(approval.locationId, {
      type: 'rejected',
      approvalId: approval.id,
      terminalId: approval.requestingTerminalId || undefined,
      managerName,
    }).catch(err => console.error('[RemoteVoidApproval] Socket dispatch failed:', err))

    return ok({
        success: true,
        message: 'Void request has been rejected',
      })
  } catch (error) {
    console.error('[RemoteVoidApproval] Error rejecting:', error)
    return err('Failed to reject request', 500)
  }
})
