import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings, invalidateLocationCache } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { createWebhook, listWebhooks } from '@/lib/7shifts-client'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'

const WEBHOOK_EVENTS = [
  'schedule.published',
  'time_punch.created',
  'time_punch.edited',
  'time_punch.deleted',
  'user.modified',
  'user.deactivated',
]

export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  const body = await request.json().catch(() => ({})) as { employeeId?: string }
  const actor = await getActorFromRequest(request)
  const resolvedEmployeeId = actor.employeeId ?? body.employeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_INTEGRATIONS)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const s = settings.sevenShifts
  if (!s?.clientId || !s.companyId || !s.companyGuid) {
    return NextResponse.json({ error: '7shifts credentials not configured' }, { status: 400 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || ''
  if (!baseUrl) {
    return NextResponse.json({ error: 'APP_URL not configured' }, { status: 500 })
  }

  // Normalize URL: strip trailing slash to avoid duplicates from staging→prod URL changes
  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/webhooks/7shifts`

  // P1: Idempotent registration — list existing webhooks first, skip already-registered events
  let existingEvents = new Set<string>()
  try {
    const existing = await listWebhooks(s, location.id)
    // Match on event + URL (normalized) + method to catch stale registrations
    existingEvents = new Set(
      existing
        .filter(w => w.url.replace(/\/$/, '') === webhookUrl && w.method.toLowerCase() === 'post')
        .map(w => w.event)
    )
    console.log(`[7shifts/register-webhooks] Found ${existing.length} existing webhooks, ${existingEvents.size} matching our URL`)
  } catch (err) {
    console.warn('[7shifts/register-webhooks] Could not list existing webhooks:', err instanceof Error ? err.message : err)
    // Non-fatal — proceed and attempt to create all; duplicates may result but 7shifts handles them
  }

  const registered: string[] = []
  const skipped: string[] = []
  const errors: { event: string; error: string }[] = []

  for (const event of WEBHOOK_EVENTS) {
    if (existingEvents.has(event)) {
      skipped.push(event)
      continue
    }
    try {
      await createWebhook(s, location.id, {
        event,
        url: webhookUrl,
        method: 'post',
        secret: s.webhookSecret || undefined,
      })
      registered.push(event)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[7shifts/register-webhooks] Failed to register ${event}:`, message)
      errors.push({ event, error: message.slice(0, 200) })
    }
  }

  // P1: Persist webhooksRegisteredAt timestamp when all events are covered
  const allCovered = errors.length === 0
  if (allCovered) {
    try {
      await db.location.update({
        where: { id: location.id },
        data: {
          settings: {
            ...settings,
            sevenShifts: { ...s, webhooksRegisteredAt: new Date().toISOString() },
          } as object,
        },
      })
      invalidateLocationCache(location.id)
    } catch {
      // Non-fatal — status flag update failure should not block the response
    }
  }

  return NextResponse.json({ data: { registered, skipped, errors, allCovered } })
})
