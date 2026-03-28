/**
 * Inbound Webhook Endpoint for Reservation Integrations
 *
 * POST /api/webhooks/reservations/:platform
 *
 * Receives reservation data from external platforms (OpenTable, Resy, Google,
 * Yelp, custom). Verifies HMAC signature, normalizes payload, and creates/
 * updates/cancels reservations.
 *
 * Flow:
 *  1. Verify webhook signature (platform-specific, stored in integration config)
 *  2. Parse + normalize incoming payload to common format
 *  3. Look up reservation by (locationId, source, externalId)
 *  4. Create / update / cancel as appropriate
 *  5. Write `integration_sync_in` audit event
 *  6. Return 200 OK with our reservation ID
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import type { ReservationIntegration } from '@/lib/settings'
import { createReservationWithRules } from '@/lib/reservations/create-reservation'
import { transition } from '@/lib/reservations/state-machine'
import type { SourceType } from '@/lib/reservations/state-machine'
import { dispatchReservationChanged } from '@/lib/socket-dispatch'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('webhooks-reservations')

// ─── Rate Limiting (100/min per platform) ───────────────────────────────────
import { createRateLimiter } from '@/lib/rate-limiter'

const limiter = createRateLimiter({ maxAttempts: 100, windowMs: 60_000 })

// ─── Normalized Payload ──────────────────────────────────────────────────────

interface NormalizedWebhookPayload {
  action: 'create' | 'update' | 'cancel'
  externalId: string
  guestName: string
  guestPhone?: string
  guestEmail?: string
  partySize: number
  date: string        // YYYY-MM-DD
  time: string        // HH:MM
  duration?: number
  specialRequests?: string
  source: string
  rawPayload: unknown
}

// ─── Platform Normalizers ────────────────────────────────────────────────────

function normalizeCustom(body: Record<string, unknown>): NormalizedWebhookPayload {
  // Custom platform: expects a well-structured payload matching our format
  const action = (body.action as string) || 'create'
  if (!['create', 'update', 'cancel'].includes(action)) {
    throw new Error(`Invalid action: ${action}. Must be create, update, or cancel.`)
  }

  const externalId = body.externalId as string || body.external_id as string
  if (!externalId) throw new Error('externalId is required')

  const guestName = body.guestName as string || body.guest_name as string || ''
  if (!guestName && action === 'create') throw new Error('guestName is required for create')

  const partySize = Number(body.partySize ?? body.party_size ?? body.covers ?? 0)
  if (action === 'create' && (!partySize || partySize < 1)) throw new Error('partySize must be >= 1')

  const date = body.date as string || body.reservationDate as string || body.reservation_date as string || ''
  const time = body.time as string || body.reservationTime as string || body.reservation_time as string || ''
  if (action === 'create' && (!date || !time)) throw new Error('date (YYYY-MM-DD) and time (HH:MM) are required')

  return {
    action: action as NormalizedWebhookPayload['action'],
    externalId,
    guestName,
    guestPhone: (body.guestPhone as string) || (body.guest_phone as string) || (body.phone as string) || undefined,
    guestEmail: (body.guestEmail as string) || (body.guest_email as string) || (body.email as string) || undefined,
    partySize,
    date,
    time,
    duration: body.duration ? Number(body.duration) : undefined,
    specialRequests: (body.specialRequests as string) || (body.special_requests as string) || (body.notes as string) || undefined,
    source: 'custom',
    rawPayload: body,
  }
}

function normalizeOpenTable(body: Record<string, unknown>): NormalizedWebhookPayload {
  // TODO: Implement when OpenTable API access is available
  // OpenTable webhooks typically include:
  //   { event_type: 'reservation.created' | 'reservation.updated' | 'reservation.cancelled',
  //     reservation: { rid: string, restaurant_id: string, first_name: string, last_name: string,
  //                    phone: string, email: string, party_size: number, date_time: string,
  //                    notes: string, status: string } }

  const eventType = body.event_type as string || ''
  const reservation = (body.reservation || body.data || body) as Record<string, unknown>

  let action: NormalizedWebhookPayload['action'] = 'create'
  if (eventType.includes('cancel')) action = 'cancel'
  else if (eventType.includes('update') || eventType.includes('modified')) action = 'update'

  const dateTime = reservation.date_time as string || reservation.dateTime as string || ''
  const [date, timePart] = dateTime ? dateTime.split('T') : ['', '']
  const time = timePart ? timePart.substring(0, 5) : ''

  return {
    action,
    externalId: (reservation.rid as string) || (reservation.id as string) || '',
    guestName: `${reservation.first_name || ''} ${reservation.last_name || ''}`.trim(),
    guestPhone: reservation.phone as string || undefined,
    guestEmail: reservation.email as string || undefined,
    partySize: Number(reservation.party_size || reservation.partySize || 2),
    date,
    time,
    specialRequests: reservation.notes as string || undefined,
    source: 'opentable',
    rawPayload: body,
  }
}

function normalizeResy(body: Record<string, unknown>): NormalizedWebhookPayload {
  // TODO: Implement when Resy API access is available
  // Resy webhooks typically include:
  //   { type: 'reservation_booked' | 'reservation_edited' | 'reservation_cancelled',
  //     reservation: { resy_token: string, num_guests: number, date: string, time_slot: string,
  //                    first_name: string, last_name: string, phone_number: string, email: string,
  //                    special_request: string } }

  const eventType = body.type as string || ''
  const reservation = (body.reservation || body.data || body) as Record<string, unknown>

  let action: NormalizedWebhookPayload['action'] = 'create'
  if (eventType.includes('cancel')) action = 'cancel'
  else if (eventType.includes('edit')) action = 'update'

  return {
    action,
    externalId: (reservation.resy_token as string) || (reservation.id as string) || '',
    guestName: `${reservation.first_name || ''} ${reservation.last_name || ''}`.trim(),
    guestPhone: reservation.phone_number as string || reservation.phone as string || undefined,
    guestEmail: reservation.email as string || undefined,
    partySize: Number(reservation.num_guests || reservation.party_size || 2),
    date: reservation.date as string || '',
    time: reservation.time_slot as string || reservation.time as string || '',
    specialRequests: reservation.special_request as string || undefined,
    source: 'resy',
    rawPayload: body,
  }
}

function normalizeGoogle(body: Record<string, unknown>): NormalizedWebhookPayload {
  // TODO: Implement when Google Reserve / Actions Center access is available
  // Google Reserve notifications typically use:
  //   { booking: { booking_id: string, slot: { start_time: string, duration_sec: number },
  //                party_size: number, user_information: { given_name: string, family_name: string,
  //                telephone: string, email: string }, status: string } }

  const booking = (body.booking || body.data || body) as Record<string, unknown>
  const slot = (booking.slot || {}) as Record<string, unknown>
  const userInfo = (booking.user_information || booking.user || {}) as Record<string, unknown>
  const status = booking.status as string || ''

  let action: NormalizedWebhookPayload['action'] = 'create'
  if (status === 'CANCELLED' || status === 'cancelled') action = 'cancel'
  else if (body.update_mask) action = 'update'

  const startTime = slot.start_time as string || ''
  const [date, timePart] = startTime ? startTime.split('T') : ['', '']
  const time = timePart ? timePart.substring(0, 5) : ''

  return {
    action,
    externalId: (booking.booking_id as string) || (booking.id as string) || '',
    guestName: `${userInfo.given_name || ''} ${userInfo.family_name || ''}`.trim(),
    guestPhone: userInfo.telephone as string || userInfo.phone as string || undefined,
    guestEmail: userInfo.email as string || undefined,
    partySize: Number(booking.party_size || 2),
    date,
    time,
    duration: slot.duration_sec ? Math.round(Number(slot.duration_sec) / 60) : undefined,
    source: 'google',
    rawPayload: body,
  }
}

function normalizeYelp(body: Record<string, unknown>): NormalizedWebhookPayload {
  // TODO: Implement when Yelp Reservations API access is available
  // Yelp reservation webhooks typically include:
  //   { event: 'reservation.created' | 'reservation.updated' | 'reservation.cancelled',
  //     reservation: { id: string, covers: number, date: string, time: string,
  //                    user: { first_name: string, last_name: string, phone: string, email: string },
  //                    notes: string } }

  const eventType = body.event as string || ''
  const reservation = (body.reservation || body.data || body) as Record<string, unknown>
  const user = (reservation.user || {}) as Record<string, unknown>

  let action: NormalizedWebhookPayload['action'] = 'create'
  if (eventType.includes('cancel')) action = 'cancel'
  else if (eventType.includes('update')) action = 'update'

  return {
    action,
    externalId: reservation.id as string || '',
    guestName: `${user.first_name || reservation.first_name || ''} ${user.last_name || reservation.last_name || ''}`.trim(),
    guestPhone: (user.phone as string) || (reservation.phone as string) || undefined,
    guestEmail: (user.email as string) || (reservation.email as string) || undefined,
    partySize: Number(reservation.covers || reservation.party_size || 2),
    date: reservation.date as string || '',
    time: reservation.time as string || '',
    specialRequests: reservation.notes as string || undefined,
    source: 'yelp',
    rawPayload: body,
  }
}

const NORMALIZERS: Record<string, (body: Record<string, unknown>) => NormalizedWebhookPayload> = {
  opentable: normalizeOpenTable,
  resy: normalizeResy,
  google: normalizeGoogle,
  yelp: normalizeYelp,
  custom: normalizeCustom,
}

// ─── Signature Verification ──────────────────────────────────────────────────

function verifyHmacSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false
  try {
    // Support both hex and base64 encoded signatures
    const computed = createHmac('sha256', secret).update(rawBody).digest('hex')
    const sigHex = signature.replace(/^sha256=/, '').replace(/^hmac-sha256=/, '')

    // Timing-safe comparison
    const a = Buffer.from(computed, 'hex')
    const b = Buffer.from(sigHex, 'hex')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function getSignatureHeader(request: NextRequest, platform: string): string | null {
  // Each platform uses a different header for webhook signatures
  const headers: Record<string, string[]> = {
    opentable: ['x-opentable-signature', 'x-signature'],
    resy: ['x-resy-signature', 'x-signature'],
    google: ['x-google-signature', 'x-signature'],
    yelp: ['x-yelp-signature', 'x-signature'],
    custom: ['x-webhook-signature', 'x-signature', 'x-hub-signature-256'],
  }

  for (const header of (headers[platform] || ['x-signature'])) {
    const value = request.headers.get(header)
    if (value) return value
  }
  return null
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params

  // Validate platform
  if (!NORMALIZERS[platform]) {
    return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 400 })
  }

  // Rate limit
  if (!limiter.check(`webhook:${platform}`).allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded (100/min)' }, { status: 429 })
  }

  // Read raw body for signature verification
  const rawBody = await request.text()
  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  // ─── Resolve Location ──────────────────────────────────────────────
  // Match via locationId in body, or restaurant_id from payload, or fall back to single-venue
  const bodyLocationId = body.locationId as string || body.location_id as string || null
  const bodyRestaurantId = body.restaurantId as string || body.restaurant_id as string || null

  const locations = await db.location.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, timezone: true, settings: true, slug: true },
  })

  let matchedLocation: typeof locations[0] | null = null
  let matchedIntegration: ReservationIntegration | null = null

  for (const loc of locations) {
    const settings = parseSettings(loc.settings)
    const integrations = settings.reservationIntegrations || []
    const integration = integrations.find(
      (ri: ReservationIntegration) => ri.platform === platform && ri.enabled
    )
    if (!integration) continue

    // Match by explicit locationId or restaurantId
    if (bodyLocationId && loc.id === bodyLocationId) {
      matchedLocation = loc
      matchedIntegration = integration
      break
    }
    if (bodyRestaurantId && integration.restaurantId === bodyRestaurantId) {
      matchedLocation = loc
      matchedIntegration = integration
      break
    }

    // Single-venue fallback — if only one venue has this platform enabled
    if (!matchedLocation) {
      matchedLocation = loc
      matchedIntegration = integration
    }
  }

  if (!matchedLocation || !matchedIntegration) {
    return NextResponse.json(
      { error: `No location found with enabled ${platform} integration` },
      { status: 404 }
    )
  }

  // ─── Verify Signature ──────────────────────────────────────────────
  const signature = getSignatureHeader(request, platform)
  if (matchedIntegration.webhookSecret) {
    if (!verifyHmacSignature(rawBody, signature, matchedIntegration.webhookSecret)) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
    }
  }

  // ─── Normalize Payload ─────────────────────────────────────────────
  let normalized: NormalizedWebhookPayload
  try {
    normalized = NORMALIZERS[platform](body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payload normalization failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  if (!normalized.externalId) {
    return NextResponse.json({ error: 'Missing externalId in payload' }, { status: 400 })
  }

  // ─── Process Reservation ───────────────────────────────────────────
  const locationId = matchedLocation.id
  const timezone = matchedLocation.timezone || 'America/New_York'

  try {
    // ─── Idempotency Check ────────────────────────────────────────────
    // Use ExternalWebhookEvent to dedup replayed webhooks. The unique
    // constraint on (provider, externalTransactionId, eventType) prevents
    // double-processing even under concurrent delivery.
    const idempotencyProvider = `reservation:${platform}`
    const idempotencyTxId = normalized.externalId
    const idempotencyEventType = normalized.action

    const existingWebhookEvent = await db.externalWebhookEvent.findUnique({
      where: {
        provider_externalTransactionId_eventType: {
          provider: idempotencyProvider,
          externalTransactionId: idempotencyTxId,
          eventType: idempotencyEventType,
        },
      },
      select: { id: true, processingStatus: true },
    })

    if (existingWebhookEvent && existingWebhookEvent.processingStatus === 'processed') {
      // Already processed — return 200 OK without re-processing
      log.info({ platform, externalId: normalized.externalId, action: normalized.action },
        'Duplicate webhook received — already processed, skipping')
      return NextResponse.json({
        success: true,
        message: 'Webhook already processed (idempotent)',
        reservationId: null,
        deduplicated: true,
      })
    }
    // Look up existing reservation by unique index
    const existing = await db.reservation.findFirst({
      where: {
        locationId,
        source: platform as SourceType,
        externalId: normalized.externalId,
        deletedAt: null,
      },
    })

    let reservationId: string

    if (normalized.action === 'cancel') {
      // ─── Cancel ──────────────────────────────────────────────
      if (!existing) {
        return NextResponse.json({
          success: true,
          message: 'Reservation not found — may have been already cancelled',
          reservationId: null,
        })
      }

      // Only attempt transition if not already in terminal state
      const terminalStatuses = ['cancelled', 'completed', 'no_show']
      if (!terminalStatuses.includes(existing.status)) {
        await transition({
          db,
          reservationId: existing.id,
          locationId,
          to: 'cancelled',
          actor: { type: 'integration', id: platform },
          reason: `Cancelled via ${platform} webhook`,
        })
      }

      reservationId = existing.id
    } else if (existing && normalized.action === 'update') {
      // ─── Update existing ─────────────────────────────────────
      const updateData: Record<string, unknown> = {
        sourceMetadata: normalized.rawPayload as any,
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      }
      if (normalized.guestName) updateData.guestName = normalized.guestName
      if (normalized.guestPhone) updateData.guestPhone = normalized.guestPhone
      if (normalized.guestEmail) updateData.guestEmail = normalized.guestEmail
      if (normalized.partySize) updateData.partySize = normalized.partySize
      if (normalized.date) updateData.reservationDate = new Date(normalized.date + 'T00:00:00')
      if (normalized.time) updateData.reservationTime = normalized.time
      if (normalized.duration) updateData.duration = normalized.duration
      if (normalized.specialRequests) updateData.specialRequests = normalized.specialRequests

      await db.reservation.update({
        where: { id: existing.id },
        data: updateData,
      })

      // Write audit event
      await db.reservationEvent.create({
        data: {
          reservationId: existing.id,
          locationId,
          eventType: 'integration_sync_in',
          actor: 'integration',
          actorId: platform,
          details: {
            platform,
            action: 'update',
            externalId: normalized.externalId,
          },
        },
      })

      reservationId = existing.id
    } else {
      // ─── Create new ──────────────────────────────────────────
      // Use createReservationWithRules for full validation + deposit evaluation
      const settings = parseSettings(matchedLocation.settings)

      const result = await createReservationWithRules({
        locationId,
        guestName: normalized.guestName,
        guestPhone: normalized.guestPhone || null,
        guestEmail: normalized.guestEmail || null,
        partySize: normalized.partySize,
        reservationDate: normalized.date,
        reservationTime: normalized.time,
        duration: normalized.duration,
        specialRequests: normalized.specialRequests || null,
        source: platform as SourceType,
        externalId: normalized.externalId,
        forceBook: true, // Skip availability check for external platforms
        actor: { type: 'integration', id: platform },
        db,
        settings: settings.reservationSettings || {
          defaultTurnTimeMinutes: 90,
          slotIntervalMinutes: 15,
          maxPartySize: 20,
          maxFutureBookingDays: 60,
          noShowGraceMinutes: 15,
          noShowBlacklistAfterCount: 3,
          modificationCutoffHours: 2,
          cancellationCutoffHours: 2,
          serviceEndHour: 4,
          allowOnlineBooking: false,
          autoConfirmNoDeposit: true,
        },
        depositRules: settings.depositRules || {
          enabled: false,
          defaultAmountCents: 0,
          partySizeThreshold: 0,
          perGuestAmountCents: 0,
          depositMode: 'flat' as const,
          percentageOfEstimated: 0,
          refundableBefore: 'always' as const,
          refundCutoffHours: 24,
          nonRefundablePercent: 0,
          forceForOnline: false,
          forceForLargeParty: false,
          largePartyThreshold: 8,
          paymentMethods: ['card' as const],
          expirationMinutes: 60,
        },
        templates: settings.reservationTemplates || {} as any,
        timezone,
        venueInfo: {
          name: matchedLocation.name,
          slug: matchedLocation.slug || '',
          baseUrl: typeof globalThis !== 'undefined' && 'location' in globalThis ? (globalThis as any).location.origin : '',
        },
      })

      // Store sourceMetadata
      await db.reservation.update({
        where: { id: result.reservation.id },
        data: { sourceMetadata: normalized.rawPayload as any, lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' },
      })

      // Auto-confirm if configured
      if (matchedIntegration.autoConfirmIncoming && result.reservation.status === 'pending') {
        try {
          await transition({
            db,
            reservationId: result.reservation.id,
            locationId,
            to: 'confirmed',
            actor: { type: 'integration', id: platform },
            reason: `Auto-confirmed via ${platform} integration`,
          })
        } catch {
          // Non-fatal — reservation was still created
        }
      }

      // Write integration_sync_in event (createReservationWithRules already writes 'created')
      await db.reservationEvent.create({
        data: {
          reservationId: result.reservation.id,
          locationId,
          eventType: 'integration_sync_in',
          actor: 'integration',
          actorId: platform,
          details: {
            platform,
            action: 'create',
            externalId: normalized.externalId,
            autoConfirmed: matchedIntegration.autoConfirmIncoming,
          },
        },
      })

      reservationId = result.reservation.id
    }

    // ─── Record Webhook Event for Idempotency ──────────────────────
    // Upsert so that if a 'received' record exists (from a prior failed attempt),
    // we mark it 'processed'. The unique constraint handles concurrent races.
    try {
      await db.externalWebhookEvent.upsert({
        where: {
          provider_externalTransactionId_eventType: {
            provider: idempotencyProvider,
            externalTransactionId: idempotencyTxId,
            eventType: idempotencyEventType,
          },
        },
        create: {
          provider: idempotencyProvider,
          externalTransactionId: idempotencyTxId,
          eventType: idempotencyEventType,
          signatureValid: !!matchedIntegration.webhookSecret,
          payload: normalized.rawPayload as any,
          processingStatus: 'processed',
          processedAt: new Date(),
        },
        update: {
          processingStatus: 'processed',
          processedAt: new Date(),
          attemptCount: { increment: 1 },
        },
      })
    } catch (webhookEventErr) {
      // Non-fatal — the reservation was already processed successfully.
      // Log and continue so the caller gets a 200.
      log.warn({ err: webhookEventErr, platform, externalId: normalized.externalId },
        'Failed to record ExternalWebhookEvent (non-fatal)')
    }

    // Dispatch socket event
    void dispatchReservationChanged(locationId, {
      reservationId,
      action: normalized.action,
    }).catch(err => log.warn({ err }, 'Background task failed'))
    void notifyDataChanged({ locationId, domain: 'reservations', action: normalized.action === 'cancel' ? 'deleted' : normalized.action === 'create' ? 'created' : 'updated', entityId: reservationId })
    void pushUpstream()

    return NextResponse.json({
      success: true,
      reservationId,
      action: normalized.action,
      externalId: normalized.externalId,
    })
  } catch (err) {
    console.error(`[Webhook:${platform}] Error processing reservation:`, err)
    const message = err instanceof Error ? err.message : 'Internal error processing webhook'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── Test Endpoint ───────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params
  return NextResponse.json({
    platform,
    status: 'active',
    message: `Webhook endpoint for ${platform} reservations is active. Send POST requests to this URL.`,
  })
}
