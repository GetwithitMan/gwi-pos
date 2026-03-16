import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults } from '@/lib/settings'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { renderSmsTemplate } from '@/lib/delivery/notifications'

export const dynamic = 'force-dynamic'

const VALID_TEMPLATES = ['orderConfirmed', 'outForDelivery', 'delivered'] as const

/**
 * POST /api/delivery/notifications/test — Test SMS notification rendering
 *
 * Body: { phoneNumber, template: 'orderConfirmed' | 'outForDelivery' | 'delivered' }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Feature gate: require SMS notifications provisioned
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'smsNotificationsProvisioned' })
    if (featureGate) return featureGate

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_SETTINGS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { phoneNumber, template } = body

    // Validate phone number
    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim().length < 7) {
      return NextResponse.json({ error: 'A valid phone number is required' }, { status: 400 })
    }

    // Validate template
    if (!template || !(VALID_TEMPLATES as readonly string[]).includes(template)) {
      return NextResponse.json(
        { error: `Invalid template. Must be one of: ${VALID_TEMPLATES.join(', ')}` },
        { status: 400 }
      )
    }

    // Fetch location settings for SMS templates and venue name
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? {}
    const smsTemplates = (deliveryConfig as any).smsTemplates ?? {}

    // Get the template string (fallback to sensible defaults)
    const defaultTemplates: Record<string, string> = {
      orderConfirmed: 'Hi! Your order #{orderNumber} from {venue} has been confirmed. Estimated delivery: {eta} min.',
      outForDelivery: 'Your order #{orderNumber} from {venue} is out for delivery! Track here: {trackingUrl}',
      delivered: 'Your order #{orderNumber} from {venue} has been delivered. Thank you!',
    }

    const templateString = smsTemplates[template] || defaultTemplates[template] || ''

    if (!templateString) {
      return NextResponse.json(
        { error: `No template configured for '${template}'` },
        { status: 400 }
      )
    }

    // Get venue name from location settings
    const venueName = (settings as any).venueName
      || (settings as any).businessName
      || (settings as any).locationName
      || 'Your Restaurant'

    // Render with test data
    const renderedMessage = renderSmsTemplate(templateString, {
      orderNumber: 'TEST-001',
      venue: venueName,
      eta: '30',
      trackingUrl: 'https://example.com/track/test',
    })

    // TODO: Actually send via Twilio (for now, just validate and return the rendered message)
    // When wiring Twilio, use the createDeliveryNotification() helper from notifications.ts

    return NextResponse.json({
      success: true,
      renderedMessage,
      phoneNumber: phoneNumber.trim(),
      template,
    })
  } catch (error) {
    console.error('[Delivery/Notifications/Test] POST error:', error)
    return NextResponse.json({ error: 'Failed to test notification' }, { status: 500 })
  }
})
