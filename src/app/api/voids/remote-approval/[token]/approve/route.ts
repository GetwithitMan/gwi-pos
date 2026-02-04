/**
 * POST /api/voids/remote-approval/[token]/approve
 *
 * Approve a void request via the web approval page.
 * Generates a 6-digit code and sends socket notification.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateApprovalCode, sendApprovalCodeSMS } from '@/lib/twilio'
import { dispatchVoidApprovalUpdate } from '@/lib/socket-dispatch'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

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
      // If already approved, return the existing code
      if (
        approval.status === 'approved' &&
        approval.approvalCode &&
        approval.approvalCodeExpiry &&
        approval.approvalCodeExpiry > now
      ) {
        return NextResponse.json({
          data: {
            success: true,
            approvalCode: approval.approvalCode,
            expiresAt: approval.approvalCodeExpiry.toISOString(),
            message: 'Already approved - here is your code',
          },
        })
      }

      return NextResponse.json(
        { error: `This request has already been ${approval.status}` },
        { status: 400 }
      )
    }

    // Generate approval code
    const approvalCode = generateApprovalCode()
    const approvalCodeExpiry = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

    // Update approval record
    await db.remoteVoidApproval.update({
      where: { id: approval.id },
      data: {
        status: 'approved',
        approvalCode,
        approvalCodeExpiry,
        approvedAt: now,
      },
    })

    const serverName =
      approval.requestedBy.displayName ||
      `${approval.requestedBy.firstName} ${approval.requestedBy.lastName}`

    const managerName =
      approval.manager.displayName ||
      `${approval.manager.firstName} ${approval.manager.lastName}`

    // Send SMS with approval code to manager (so they can relay it)
    await sendApprovalCodeSMS({
      to: approval.managerPhone,
      code: approvalCode,
      serverName,
    })

    // Dispatch socket notification to POS terminal
    try {
      await dispatchVoidApprovalUpdate(approval.locationId, {
        type: 'approved',
        approvalId: approval.id,
        terminalId: approval.requestingTerminalId || undefined,
        approvalCode,
        managerName,
      })
    } catch (socketError) {
      console.warn('[RemoteVoidApproval] Socket dispatch failed:', socketError)
      // Continue even if socket fails - code is still valid
    }

    return NextResponse.json({
      data: {
        success: true,
        approvalCode,
        expiresAt: approvalCodeExpiry.toISOString(),
        message: `Give code ${approvalCode} to ${serverName}. Valid for 5 minutes.`,
      },
    })
  } catch (error) {
    console.error('[RemoteVoidApproval] Error approving:', error)
    return NextResponse.json(
      { error: 'Failed to approve request' },
      { status: 500 }
    )
  }
}
