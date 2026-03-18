import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { db, adminDb } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { listShifts } from '@/lib/7shifts-client'
import { getBusinessDate, updateSyncStatus } from '../../integrations/7shifts/_helpers'

// Max age for webhook timestamp replay protection (5 minutes)
const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ─── P0: Multi-location routing via x-company-id ──────────────────────────
  // Match the incoming company ID to the correct location's settings.
  // Never use findFirst() — that breaks multi-venue deployments.
  const incomingCompanyIdStr = request.headers.get('x-company-id')
  const incomingCompanyId = incomingCompanyIdStr ? parseInt(incomingCompanyIdStr, 10) : null

  // Load all locations and find the one whose 7shifts companyId matches
  const locations = await db.location.findMany({
    where: { deletedAt: null },
    select: { id: true, timezone: true, settings: true },
  })

  let matchedLocationId: string | null = null
  let matchedCompanyGuid: string | null = null
  let matchedWebhookSecret: string | null = null
  let matchedTimezone = 'America/New_York'

  // Collect enabled venues for single-venue fallback safety check
  const enabledVenues: typeof locations = []

  for (const loc of locations) {
    const s = parseSettings(loc.settings).sevenShifts
    if (!s?.enabled) continue
    enabledVenues.push(loc)
    if (incomingCompanyId !== null && s.companyId === incomingCompanyId) {
      matchedLocationId = loc.id
      matchedCompanyGuid = s.companyGuid || null
      matchedWebhookSecret = s.webhookSecret || null
      matchedTimezone = loc.timezone || 'America/New_York'
      break
    }
  }

  // Fallback for single-venue: only safe if exactly one venue has 7shifts enabled
  // (ambiguity across multiple venues is a routing and security risk)
  if (!matchedLocationId && incomingCompanyId === null && enabledVenues.length === 1) {
    const loc = enabledVenues[0]
    const s = parseSettings(loc.settings).sevenShifts!
    matchedLocationId = loc.id
    matchedCompanyGuid = s.companyGuid || null
    matchedWebhookSecret = s.webhookSecret || null
    matchedTimezone = loc.timezone || 'America/New_York'
  }

  if (!matchedLocationId) {
    const event = (payload.event as string) || 'unknown'
    // Return 200 to prevent retry storms — this is not a recoverable error on 7shifts' side
    console.error(
      '[7shifts/webhook] No matching location — possible misconfiguration.',
      { companyId: incomingCompanyIdStr, event, enabledVenueCount: enabledVenues.length }
    )
    return NextResponse.json({ received: true })
  }

  // ─── P0: Correct HMAC verification ────────────────────────────────────────
  // 7shifts sends: x-hmac-timestamp + x-hmac-signature
  // Key = "${timestamp}#${companyGuid}"  Message = raw body
  const timestamp = request.headers.get('x-hmac-timestamp')
  const signature = request.headers.get('x-hmac-signature')

  if (timestamp && signature && matchedCompanyGuid) {
    // P0: Replay protection — reject if timestamp is older than 5 minutes
    const tsMs = parseInt(timestamp, 10) * 1000
    if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > MAX_TIMESTAMP_AGE_MS) {
      console.warn('[7shifts/webhook] Replay attack or stale timestamp:', timestamp)
      return NextResponse.json({ error: 'Timestamp expired' }, { status: 401 })
    }

    // Derive key and compute expected signature (hex output, lowercase)
    const hmacKey = `${timestamp}#${matchedCompanyGuid}`
    const expected = createHmac('sha256', hmacKey).update(rawBody).digest('hex')

    try {
      // Normalize: trim whitespace + lowercase before decoding hex.
      // Node Buffer.from(hex) is case-insensitive, but normalize explicitly
      // so any log comparison is also unambiguous.
      const normalizedSig = signature.trim().toLowerCase()
      const sigBuf = Buffer.from(normalizedSig, 'hex')
      const expBuf = Buffer.from(expected, 'hex')
      // Guard against malformed hex that produces a zero-length buffer
      if (sigBuf.length === 0 || sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        console.warn('[7shifts/webhook] Invalid HMAC signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } catch {
      console.warn('[7shifts/webhook] Signature comparison failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else if (matchedWebhookSecret && signature) {
    // Fallback: legacy single-secret HMAC (if deployed before GUID-based signing)
    // Log a warning so we know 7shifts isn't sending the timestamp header we expect
    console.warn('[7shifts/webhook] Using legacy HMAC fallback — x-hmac-timestamp header not present. Update webhook registration if persistent.')
    const expected = createHmac('sha256', matchedWebhookSecret).update(rawBody).digest('hex')
    try {
      const normalizedSig = signature.trim().toLowerCase()
      const sigBuf = Buffer.from(normalizedSig, 'hex')
      const expBuf = Buffer.from(expected, 'hex')
      if (sigBuf.length === 0 || sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        console.warn('[7shifts/webhook] Invalid legacy signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  const event = (payload.event as string) || 'unknown'

  // Return 200 immediately. Fire-and-forget is reliable here because GWI runs on a
  // persistent NUC Node.js process — NOT a serverless function. The process continues
  // executing the void promise after the response is sent. If ever deployed serverless,
  // switch to a DB job table + cron drain instead.
  void processWebhookEvent(event, payload, matchedLocationId, matchedTimezone).catch(console.error)

  return NextResponse.json({ received: true })
}

async function processWebhookEvent(
  event: string,
  payload: Record<string, unknown>,
  locationId: string,
  timezone: string
): Promise<void> {
  switch (event) {
    case 'schedule.published': {
      // P0: Trigger schedule pull using payload dates if available
      const data = payload.data as Record<string, unknown> | undefined
      const startDate = (data?.start as string) || getBusinessDate(timezone, 0)
      const endDate = (data?.end as string) || getBusinessDate(timezone, 14)
      await triggerSchedulePull(locationId, timezone, startDate, endDate)
      break
    }
    case 'time_punch.created':
    case 'time_punch.edited':
    case 'time_punch.deleted':
      break
    case 'user.modified':
    case 'user.deactivated':
      break
    default:
      console.warn(`[7shifts/webhook] Unknown event: ${event}`)
  }
}

/**
 * Fire-and-forget schedule pull triggered by schedule.published webhook.
 * Mirrors the logic in /api/integrations/7shifts/pull-schedule without HTTP round-trip.
 */
async function triggerSchedulePull(
  locationId: string,
  timezone: string,
  startDate: string,
  endDate: string
): Promise<void> {
  // Top-level catch: ensures DB/settings errors before the inner try don't escape
  // as unhandled rejections into the fire-and-forget void chain.
  try {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { id: true, settings: true },
  })
  if (!location) return

  const settings = parseSettings(location.settings)
  const s = settings.sevenShifts
  if (!s?.enabled || !s.clientId || !s.companyId) return

  let upserted = 0
  let deleted = 0
  let skipped = 0

  try {
    const shifts = await listShifts(s, locationId, startDate, endDate)

    const schedule = await db.schedule.findFirst({
      where: { locationId, deletedAt: null },
      select: { id: true },
      orderBy: { weekStart: 'desc' },
    })
    if (!schedule) {
      console.warn('[7shifts/webhook] No schedule for location — skipping pull')
      return
    }

    for (const shift of shifts) {
      const employee = await adminDb.employee.findFirst({
        where: { locationId, sevenShiftsUserId: String(shift.user_id), deletedAt: null },
        select: { id: true },
      })
      if (!employee) { skipped++; continue }

      const shiftDate = new Date(shift.start)
      const startTime = shift.start.slice(11, 16)
      const endTime = shift.end.slice(11, 16)

      if (shift.status === 'deleted') {
        const existing = await db.scheduledShift.findFirst({
          where: { sevenShiftsShiftId: String(shift.id), deletedAt: null },
        })
        if (existing) {
          await db.scheduledShift.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
          deleted++
        }
        continue
      }

      const existing = await db.scheduledShift.findFirst({
        where: { sevenShiftsShiftId: String(shift.id) },
      })
      if (existing) {
        await db.scheduledShift.update({
          where: { id: existing.id },
          data: { date: shiftDate, startTime, endTime, breakMinutes: shift.break_minutes ?? 0, deletedAt: null },
        })
      } else {
        await db.scheduledShift.create({
          data: {
            locationId,
            scheduleId: schedule.id,
            employeeId: employee.id,
            date: shiftDate,
            startTime,
            endTime,
            breakMinutes: shift.break_minutes ?? 0,
            notes: shift.notes ?? null,
            sevenShiftsShiftId: String(shift.id),
          },
        })
      }
      upserted++
    }

    await updateSyncStatus(locationId, {
      lastSchedulePullAt: new Date().toISOString(),
      lastSchedulePullStatus: 'success',
      lastSchedulePullError: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[7shifts/webhook] Schedule pull failed:', message)
    await updateSyncStatus(locationId, {
      lastSchedulePullAt: new Date().toISOString(),
      lastSchedulePullStatus: 'error',
      lastSchedulePullError: message.slice(0, 500),
    })
  }
  } catch (err) {
    // Outer catch: handles setup failures (DB query, settings parse) before inner try
    console.error('[7shifts/webhook] triggerSchedulePull setup failed:', err instanceof Error ? err.message : err)
  }
}
