/**
 * GET  /api/notifications/mode — Return current notification mode for this location
 * PUT  /api/notifications/mode — Update notification mode (off | shadow | dry_run | primary | forced_legacy)
 *
 * Saves to Location.settings JSONB field as { notificationMode: '...' }.
 * Clears the routing rules cache on change so the dispatcher picks up the new mode immediately.
 *
 * Permission: notifications.manage_providers
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { clearRoutingRulesCache } from '@/lib/notifications/dispatcher'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('notifications-mode')

export const dynamic = 'force-dynamic'

const VALID_MODES = ['off', 'shadow', 'dry_run', 'primary', 'forced_legacy'] as const
type NotificationMode = (typeof VALID_MODES)[number]

// ─── GET /api/notifications/mode ─────────────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_PROVIDERS)
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT settings FROM "Location" WHERE id = $1`,
      locationId
    )

    const settings = (rows[0]?.settings as Record<string, unknown>) || {}
    const mode = (settings.notificationMode as NotificationMode) || 'off'

    return ok({ mode })
  } catch (error) {
    console.error('[Notification Mode] GET error:', error)
    return err('Failed to fetch notification mode', 500)
  }
})

// ─── PUT /api/notifications/mode ─────────────────────────────────────────────

export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_PROVIDERS)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { mode } = body

    if (!mode || !VALID_MODES.includes(mode)) {
      return err(`mode must be one of: ${VALID_MODES.join(', ')}`)
    }

    // Merge into existing Location.settings JSONB (preserve other keys)
    await db.$executeRawUnsafe(
      `UPDATE "Location"
       SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1`,
      locationId,
      JSON.stringify({ notificationMode: mode })
    )

    // Clear routing rules cache so the dispatcher picks up the new mode
    clearRoutingRulesCache()

    // Audit log
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_mode_changed',
        entityType: 'location',
        entityId: locationId,
        details: { mode },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ mode })
  } catch (error) {
    console.error('[Notification Mode] PUT error:', error)
    return err('Failed to update notification mode', 500)
  }
})
