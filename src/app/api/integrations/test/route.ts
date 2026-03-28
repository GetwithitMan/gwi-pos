import { NextRequest } from 'next/server'
import { PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { resolveSlackWebhookUrl } from '@/lib/alert-service'
import { isTwilioConfiguredAsync, sendSMS, maskPhone, formatPhoneE164 } from '@/lib/twilio'
import { db } from '@/lib/db'
import { err, ok } from '@/lib/api-response'

export const POST = withVenue(async function POST(request: NextRequest) {
  const { service, employeeId, locationId: bodyLocationId } = await request.json()

  // Resolve locationId — body → fallback to cached location
  const locationId = bodyLocationId || await getLocationId()
  if (!locationId) {
    return err('Location required')
  }

  // Auth check — require settings.integrations permission
  const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_INTEGRATIONS)
  if (!auth.authorized) return err(auth.error, auth.status)

  try {
    if (service === 'twilio') {
      // Check if Twilio is configured (DB settings or env vars)
      const configured = await isTwilioConfiguredAsync()
      if (!configured) throw new Error('Twilio credentials not configured')

      // Look up the requesting employee's phone number
      const employee = await db.employee.findUnique({
        where: { id: employeeId },
        select: { phone: true, firstName: true },
      })
      if (!employee?.phone) {
        throw new Error('No phone number on your employee profile. Add one in Settings > Employees to receive a test SMS.')
      }

      // Send a real test SMS
      const result = await sendSMS({
        to: employee.phone,
        body: '[GWI POS] Test message — your Twilio integration is working! This was triggered from your POS settings page.',
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to send test SMS')
      }

      const masked = maskPhone(formatPhoneE164(employee.phone))
      return ok({
          success: true,
          message: `Test SMS sent to ${masked}. Check your phone!`,
          messageSid: result.messageSid,
        })
    }

    if (service === 'resend') {
      const apiKey = process.env.RESEND_API_KEY
      if (!apiKey) throw new Error('Resend API key not configured')
      return ok({ success: true, message: 'Resend API key verified' })
    }

    if (service === 'slack') {
      const webhookUrl = await resolveSlackWebhookUrl(locationId)
      if (!webhookUrl) throw new Error('Slack webhook URL not configured — add it in Settings > Integrations > Slack')
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'GWI POS test connection successful' }),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error('Slack webhook returned error')
      return ok({ success: true, message: 'Test message sent to Slack' })
    }

    return err('Unknown service')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Test failed'
    return ok({ success: false, message })
  }
})
