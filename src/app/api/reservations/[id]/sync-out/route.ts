/**
 * Outbound Reservation Sync
 *
 * POST /api/reservations/:id/sync-out
 *
 * Pushes the current reservation state to connected external platforms.
 * Only fires for platforms configured with syncDirection = 'push' or 'bidirectional'.
 *
 * Flow:
 *  1. Load reservation + location settings
 *  2. Find applicable integrations (push/bidirectional + enabled)
 *  3. For each platform, format and send the update
 *  4. Write `integration_sync_out` audit event
 *  5. Return summary
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import type { ReservationIntegration, ReservationPlatform } from '@/lib/settings'

// ─── Platform-Specific Formatters (stubs) ────────────────────────────────────

interface OutboundPayload {
  platform: ReservationPlatform
  endpoint: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

function formatForOpenTable(reservation: Record<string, unknown>, integration: ReservationIntegration): OutboundPayload {
  // TODO: Implement OpenTable REST API posting
  // OpenTable Partner API: POST /reservations or PUT /reservations/{rid}
  return {
    platform: 'opentable',
    endpoint: `https://platform.opentable.com/v1/reservations/${reservation.externalId || ''}`,
    method: reservation.externalId ? 'PUT' : 'POST',
    headers: {
      'Authorization': `Bearer ${integration.apiKey || ''}`,
      'Content-Type': 'application/json',
    },
    body: {
      restaurant_id: integration.restaurantId,
      party_size: reservation.partySize,
      date_time: `${reservation.reservationDate}T${reservation.reservationTime}:00`,
      first_name: (reservation.guestName as string || '').split(' ')[0],
      last_name: (reservation.guestName as string || '').split(' ').slice(1).join(' '),
      phone: reservation.guestPhone,
      email: reservation.guestEmail,
      notes: reservation.specialRequests,
      status: mapStatusToOpenTable(reservation.status as string),
    },
  }
}

function formatForResy(reservation: Record<string, unknown>, integration: ReservationIntegration): OutboundPayload {
  // TODO: Implement Resy API posting
  return {
    platform: 'resy',
    endpoint: `https://api.resy.com/v2/reservations/${reservation.externalId || ''}`,
    method: reservation.externalId ? 'PUT' : 'POST',
    headers: {
      'Authorization': `ResyAPI api_key="${integration.apiKey || ''}"`,
      'Content-Type': 'application/json',
    },
    body: {
      venue_id: integration.restaurantId,
      num_guests: reservation.partySize,
      date: reservation.reservationDate,
      time_slot: reservation.reservationTime,
      first_name: (reservation.guestName as string || '').split(' ')[0],
      last_name: (reservation.guestName as string || '').split(' ').slice(1).join(' '),
      phone_number: reservation.guestPhone,
      email: reservation.guestEmail,
      special_request: reservation.specialRequests,
    },
  }
}

function formatForGoogle(reservation: Record<string, unknown>, integration: ReservationIntegration): OutboundPayload {
  // TODO: Implement Google Reserve / Actions Center API
  return {
    platform: 'google',
    endpoint: `https://mapsbooking.googleapis.com/v1alpha/notification`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${integration.apiKey || ''}`,
      'Content-Type': 'application/json',
    },
    body: {
      booking: {
        booking_id: reservation.externalId || reservation.id,
        slot: {
          start_time: `${reservation.reservationDate}T${reservation.reservationTime}:00`,
          duration_sec: ((reservation.duration as number) || 90) * 60,
        },
        party_size: reservation.partySize,
        status: mapStatusToGoogle(reservation.status as string),
        user_information: {
          given_name: (reservation.guestName as string || '').split(' ')[0],
          family_name: (reservation.guestName as string || '').split(' ').slice(1).join(' '),
          telephone: reservation.guestPhone,
          email: reservation.guestEmail,
        },
      },
    },
  }
}

function formatForYelp(reservation: Record<string, unknown>, integration: ReservationIntegration): OutboundPayload {
  // TODO: Implement Yelp Reservations API
  return {
    platform: 'yelp',
    endpoint: `https://api.yelp.com/v3/reservations/${reservation.externalId || ''}`,
    method: reservation.externalId ? 'PUT' : 'POST',
    headers: {
      'Authorization': `Bearer ${integration.apiKey || ''}`,
      'Content-Type': 'application/json',
    },
    body: {
      restaurant_id: integration.restaurantId,
      covers: reservation.partySize,
      date: reservation.reservationDate,
      time: reservation.reservationTime,
      first_name: (reservation.guestName as string || '').split(' ')[0],
      last_name: (reservation.guestName as string || '').split(' ').slice(1).join(' '),
      phone: reservation.guestPhone,
      email: reservation.guestEmail,
      notes: reservation.specialRequests,
    },
  }
}

function formatForCustom(reservation: Record<string, unknown>, integration: ReservationIntegration): OutboundPayload {
  // Custom platform: send our standard format
  return {
    platform: 'custom',
    endpoint: '', // Would need a configurable outbound URL
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${integration.apiKey || ''}`,
      'Content-Type': 'application/json',
    },
    body: {
      action: 'update',
      reservationId: reservation.id,
      externalId: reservation.externalId,
      guestName: reservation.guestName,
      guestPhone: reservation.guestPhone,
      guestEmail: reservation.guestEmail,
      partySize: reservation.partySize,
      date: reservation.reservationDate,
      time: reservation.reservationTime,
      duration: reservation.duration,
      status: reservation.status,
      specialRequests: reservation.specialRequests,
      source: reservation.source,
    },
  }
}

const FORMATTERS: Record<string, (r: Record<string, unknown>, i: ReservationIntegration) => OutboundPayload> = {
  opentable: formatForOpenTable,
  resy: formatForResy,
  google: formatForGoogle,
  yelp: formatForYelp,
  custom: formatForCustom,
}

function mapStatusToOpenTable(status: string): string {
  const map: Record<string, string> = {
    pending: 'pending',
    confirmed: 'confirmed',
    cancelled: 'cancelled',
    no_show: 'no_show',
    checked_in: 'arrived',
    seated: 'seated',
    completed: 'completed',
  }
  return map[status] || status
}

function mapStatusToGoogle(status: string): string {
  const map: Record<string, string> = {
    pending: 'PENDING',
    confirmed: 'CONFIRMED',
    cancelled: 'CANCELLED',
    no_show: 'NO_SHOW',
    checked_in: 'CONFIRMED',
    seated: 'CONFIRMED',
    completed: 'FULFILLED',
  }
  return map[status] || status
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const locationId = await getLocationId()

  if (!locationId) {
    return NextResponse.json({ error: 'No location found' }, { status: 400 })
  }

  // Load reservation
  const reservation = await db.reservation.findUnique({
    where: { id },
  })

  if (!reservation) {
    return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
  }

  if (reservation.locationId !== locationId) {
    return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
  }

  // Load integration settings
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { settings: true },
  })

  if (!location) {
    return NextResponse.json({ error: 'Location not found' }, { status: 404 })
  }

  const settings = parseSettings(location.settings)
  const integrations = (settings.reservationIntegrations || []).filter(
    (ri: ReservationIntegration) => ri.enabled && (ri.syncDirection === 'push' || ri.syncDirection === 'bidirectional')
  )

  if (integrations.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No outbound integrations configured',
      synced: [],
    })
  }

  // Build reservation data for formatters
  const reservationData: Record<string, unknown> = {
    id: reservation.id,
    externalId: reservation.externalId,
    guestName: reservation.guestName,
    guestPhone: reservation.guestPhone,
    guestEmail: reservation.guestEmail,
    partySize: reservation.partySize,
    reservationDate: reservation.reservationDate instanceof Date
      ? reservation.reservationDate.toISOString().split('T')[0]
      : reservation.reservationDate,
    reservationTime: reservation.reservationTime,
    duration: reservation.duration,
    status: reservation.status,
    specialRequests: reservation.specialRequests,
    source: reservation.source,
  }

  // Sync to each platform
  const results: { platform: string; success: boolean; error?: string }[] = []

  for (const integration of integrations) {
    const formatter = FORMATTERS[integration.platform]
    if (!formatter) {
      results.push({ platform: integration.platform, success: false, error: 'No formatter available' })
      continue
    }

    try {
      const payload = formatter(reservationData, integration)

      // TODO: Make actual HTTP call to external platform
      // For now, log and record the attempt
      console.log(`[SyncOut:${integration.platform}] Would send to ${payload.endpoint}:`, JSON.stringify(payload.body).substring(0, 200))

      // Write audit event
      await db.reservationEvent.create({
        data: {
          reservationId: reservation.id,
          locationId,
          eventType: 'integration_sync_out',
          actor: 'integration',
          actorId: integration.platform,
          details: {
            platform: integration.platform,
            endpoint: payload.endpoint,
            method: payload.method,
            status: 'stub', // Will be 'success' or 'error' when real HTTP calls are implemented
            reservationStatus: reservation.status,
          },
        },
      })

      results.push({ platform: integration.platform, success: true })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      results.push({ platform: integration.platform, success: false, error: errorMsg })

      // Record error in audit
      await db.reservationEvent.create({
        data: {
          reservationId: reservation.id,
          locationId,
          eventType: 'integration_sync_out',
          actor: 'integration',
          actorId: integration.platform,
          details: {
            platform: integration.platform,
            status: 'error',
            error: errorMsg,
          },
        },
      })
    }
  }

  return NextResponse.json({
    success: true,
    reservationId: reservation.id,
    synced: results,
  })
})
