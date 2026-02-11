/**
 * POST /api/webhooks/twilio/sms
 *
 * Twilio webhook for inbound SMS replies (YES/NO for void approvals).
 * Validates Twilio signature for security.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  validateTwilioSignature,
  parseSMSReply,
  generateApprovalCode,
  sendApprovalCodeSMS,
  formatPhoneE164,
} from '@/lib/twilio'
import { dispatchVoidApprovalUpdate } from '@/lib/socket-dispatch'

// Twilio sends form-urlencoded data
export async function POST(request: NextRequest) {
  try {
    // Parse form data
    const formData = await request.formData()
    const params: Record<string, string> = {}
    formData.forEach((value, key) => {
      params[key] = value.toString()
    })

    // Extract key fields from Twilio webhook
    const from = params.From || ''
    const body = params.Body || ''
    const messageSid = params.MessageSid || ''

    // Validate Twilio signature (if configured)
    const twilioSignature = request.headers.get('X-Twilio-Signature') || ''
    const webhookUrl = request.url

    // Only validate signature in production
    if (process.env.NODE_ENV === 'production') {
      const isValid = validateTwilioSignature(webhookUrl, params, twilioSignature)
      if (!isValid) {
        console.error('[Twilio Webhook] Invalid signature')
        return new NextResponse('Invalid signature', { status: 403 })
      }
    }

    // Parse the reply
    const action = parseSMSReply(body)

    if (action === 'unknown') {
      // Send helpful response via TwiML
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Reply YES to approve or NO to reject the void request.</Message>
</Response>`
      return new NextResponse(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // Find pending approval for this phone number
    const normalizedPhone = formatPhoneE164(from)

    const approval = await db.remoteVoidApproval.findFirst({
      where: {
        managerPhone: normalizedPhone,
        status: 'pending',
        approvalTokenExpiry: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' }, // Get most recent if multiple
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
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>No pending void approval found for your number.</Message>
</Response>`
      return new NextResponse(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    const serverName =
      approval.requestedBy.displayName ||
      `${approval.requestedBy.firstName} ${approval.requestedBy.lastName}`

    const managerName =
      approval.manager.displayName ||
      `${approval.manager.firstName} ${approval.manager.lastName}`

    const now = new Date()

    if (action === 'approve') {
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

      // Dispatch socket notification
      try {
        await dispatchVoidApprovalUpdate(approval.locationId, {
          type: 'approved',
          approvalId: approval.id,
          terminalId: approval.requestingTerminalId || undefined,
          approvalCode,
          managerName,
        })
      } catch (socketError) {
        console.warn('[Twilio Webhook] Socket dispatch failed:', socketError)
      }

      // Also send SMS with code (in case manager wants to relay verbally)
      await sendApprovalCodeSMS({
        to: normalizedPhone,
        code: approvalCode,
        serverName,
      })

      // TwiML response (Twilio will send this as SMS reply)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>APPROVED. Code: ${approvalCode}. Give to ${serverName}. Valid 5 min.</Message>
</Response>`

      return new NextResponse(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    } else {
      // Reject
      await db.remoteVoidApproval.update({
        where: { id: approval.id },
        data: {
          status: 'rejected',
          rejectedAt: now,
          rejectionReason: 'Rejected via SMS',
        },
      })

      // Dispatch socket notification
      try {
        await dispatchVoidApprovalUpdate(approval.locationId, {
          type: 'rejected',
          approvalId: approval.id,
          terminalId: approval.requestingTerminalId || undefined,
          managerName,
        })
      } catch (socketError) {
        console.warn('[Twilio Webhook] Socket dispatch failed:', socketError)
      }

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Void request REJECTED. ${serverName} has been notified.</Message>
</Response>`

      return new NextResponse(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }
  } catch (error) {
    console.error('[Twilio Webhook] Error processing SMS:', error)
    // Return 200 to prevent Twilio from retrying
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Error processing your request. Please try again or use the web link.</Message>
</Response>`
    return new NextResponse(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}
