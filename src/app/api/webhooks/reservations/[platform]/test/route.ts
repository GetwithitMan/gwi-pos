/**
 * Test Connection endpoint for reservation integrations.
 *
 * POST /api/webhooks/reservations/:platform/test
 *
 * Verifies that the integration is properly configured:
 *  - Platform is known
 *  - Integration config exists and is enabled for this location
 *  - Webhook secret is set
 *  - (Future) Outbound API key is valid — for now, just checks config presence
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import type { ReservationIntegration } from '@/lib/settings'
import { RESERVATION_PLATFORMS } from '@/lib/settings'
import { err, ok } from '@/lib/api-response'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params
  const locationId = await getLocationId()

  if (!locationId) {
    return err('No location found')
  }

  // Validate platform is known
  const knownPlatform = RESERVATION_PLATFORMS.find(p => p.platform === platform)
  if (!knownPlatform) {
    return err(`Unknown platform: ${platform}`)
  }

  // Load location settings
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { settings: true },
  })

  if (!location) {
    return err('Location not found')
  }

  const settings = parseSettings(location.settings)
  const integrations = settings.reservationIntegrations || []
  const integration = integrations.find(
    (ri: ReservationIntegration) => ri.platform === platform
  )

  // Check configuration
  const issues: string[] = []

  if (!integration) {
    issues.push('Integration not configured. Save your settings first.')
  } else {
    if (!integration.enabled) issues.push('Integration is disabled.')
    if (!integration.webhookSecret && !integration.apiKey) {
      issues.push('No API key or webhook secret configured.')
    }
  }

  if (issues.length > 0) {
    return NextResponse.json({
      success: false,
      error: issues.join(' '),
      details: issues,
    })
  }

  // TODO: For platforms with outbound APIs (push/bidirectional), make a
  // test API call here to verify credentials. For now, just confirm config.

  return ok({
    success: true,
    message: `${knownPlatform.name} integration is configured and ready to receive webhooks.`,
    webhookUrl: `/api/webhooks/reservations/${platform}`,
    syncDirection: integration!.syncDirection,
    autoConfirmIncoming: integration!.autoConfirmIncoming,
  })
})
