/**
 * POST /api/voids/remote-approval/request
 *
 * Creates a remote void approval request and sends SMS to the selected manager.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  sendVoidApprovalSMS,
  generateApprovalToken,
  isTwilioConfigured,
} from '@/lib/twilio'
import { withVenue } from '@/lib/with-venue'

interface RequestBody {
  locationId: string
  orderId: string
  orderItemId?: string
  voidType: 'item' | 'order' | 'comp'
  managerId: string
  voidReason: string
  amount: number
  itemName: string
  requestedById: string
  terminalId?: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json()

    const {
      locationId,
      orderId,
      orderItemId,
      voidType,
      managerId,
      voidReason,
      amount,
      itemName,
      requestedById,
      terminalId,
    } = body

    // Validate required fields
    if (!locationId || !orderId || !managerId || !voidReason || !requestedById) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Fetch the order to get order number
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, locationId: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Order does not belong to this location' },
        { status: 403 }
      )
    }

    // Fetch the manager
    const manager = await db.employee.findUnique({
      where: { id: managerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        phone: true,
        isActive: true,
      },
    })

    if (!manager || !manager.isActive) {
      return NextResponse.json(
        { error: 'Manager not found or inactive' },
        { status: 404 }
      )
    }

    if (!manager.phone) {
      return NextResponse.json(
        { error: 'Manager does not have a phone number on file' },
        { status: 400 }
      )
    }

    // Fetch the requester (server)
    const requester = await db.employee.findUnique({
      where: { id: requestedById },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      },
    })

    if (!requester) {
      return NextResponse.json(
        { error: 'Requesting employee not found' },
        { status: 404 }
      )
    }

    // Check for existing pending request for this order/item
    const existingPending = await db.remoteVoidApproval.findFirst({
      where: {
        orderId,
        orderItemId: orderItemId || null,
        status: 'pending',
        approvalTokenExpiry: { gt: new Date() },
      },
    })

    if (existingPending) {
      return NextResponse.json(
        {
          error: 'A pending approval request already exists for this item',
          existingApprovalId: existingPending.id,
        },
        { status: 409 }
      )
    }

    // Generate tokens
    const approvalToken = generateApprovalToken()
    const approvalTokenExpiry = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes

    // Create the approval request
    const approval = await db.remoteVoidApproval.create({
      data: {
        locationId,
        orderId,
        orderItemId,
        requestedById,
        voidReason,
        voidType,
        amount,
        itemName,
        orderNumber: order.orderNumber,
        managerId,
        managerPhone: manager.phone,
        approvalToken,
        approvalTokenExpiry,
        requestingTerminalId: terminalId,
        status: 'pending',
      },
    })

    // Send SMS to manager
    const serverName =
      requester.displayName || `${requester.firstName} ${requester.lastName}`

    let smsResult: { success: boolean; messageSid?: string; error?: string } = { success: false }

    if (isTwilioConfigured()) {
      smsResult = await sendVoidApprovalSMS({
        to: manager.phone,
        serverName,
        itemName,
        amount,
        reason: voidReason,
        orderNumber: order.orderNumber,
        approvalToken,
      })

      // Update with Twilio message SID
      if (smsResult.messageSid) {
        await db.remoteVoidApproval.update({
          where: { id: approval.id },
          data: { twilioMessageSid: smsResult.messageSid },
        })
      }
    } else {
      console.warn('[RemoteVoidApproval] Twilio not configured, SMS not sent')
    }

    const managerName =
      manager.displayName || `${manager.firstName} ${manager.lastName}`

    return NextResponse.json({
      data: {
        approvalId: approval.id,
        managerName,
        expiresAt: approvalTokenExpiry.toISOString(),
        smsSent: smsResult.success,
        message: smsResult.success
          ? `Approval request sent to ${managerName}`
          : 'Approval request created (SMS not sent - Twilio not configured)',
      },
    })
  } catch (error) {
    console.error('[RemoteVoidApproval] Error creating request:', error)
    return NextResponse.json(
      { error: 'Failed to create approval request' },
      { status: 500 }
    )
  }
})
