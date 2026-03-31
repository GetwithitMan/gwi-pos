/**
 * GET /api/notifications/rules — List routing rules for location
 * POST /api/notifications/rules — Create a routing rule with condition validation
 *
 * Permission: GET = notifications.view_log, POST = notifications.manage_rules
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { clearRoutingRulesCache } from '@/lib/notifications/dispatcher'
import { createChildLogger } from '@/lib/logger'
import { created, err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('notifications-rules')

export const dynamic = 'force-dynamic'

const VALID_EVENT_TYPES = [
  'waitlist_added', 'waitlist_ready', 'waitlist_second_call', 'waitlist_final_warning', 'waitlist_expired',
  'order_created', 'order_ready', 'order_delayed', 'order_picked_up', 'order_cancelled', 'order_recalled',
  'curbside_arrived', 'server_needed', 'expo_recall', 'staff_alert',
]

const VALID_TARGET_TYPES = [
  'guest_pager', 'phone_sms', 'phone_voice', 'order_screen', 'staff_pager', 'table_locator',
]

const VALID_CRITICALITY_CLASSES = ['critical', 'standard', 'informational']

/**
 * GET /api/notifications/rules
 *
 * Query params:
 *   eventType — filter by event type
 *   enabled — 'true' or 'false' to filter by enabled status
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return err(auth.error, auth.status)

    const searchParams = request.nextUrl.searchParams
    const eventType = searchParams.get('eventType')
    const enabledFilter = searchParams.get('enabled')

    const conditions: string[] = [
      `r."locationId" = $1`,
      `r."deletedAt" IS NULL`,
    ]
    const params: unknown[] = [locationId]
    let paramIndex = 2

    if (eventType) {
      conditions.push(`r."eventType" = $${paramIndex}`)
      params.push(eventType)
      paramIndex++
    }

    if (enabledFilter !== null && enabledFilter !== undefined) {
      conditions.push(`r.enabled = $${paramIndex}`)
      params.push(enabledFilter === 'true')
      paramIndex++
    }

    const rules: any[] = await db.$queryRaw`SELECT r.*,
              p.name as "providerName", p."providerType",
              fp.name as "fallbackProviderName"
       FROM "NotificationRoutingRule" r
       LEFT JOIN "NotificationProvider" p ON p.id = r."providerId" AND p."deletedAt" IS NULL
       LEFT JOIN "NotificationProvider" fp ON fp.id = r."fallbackProviderId" AND fp."deletedAt" IS NULL
       WHERE ${conditions.join(' AND ')}
       ORDER BY r."eventType" ASC, r.priority DESC, r."createdAt" ASC`

    return ok(rules)
  } catch (error) {
    console.error('[Notification Rules] GET error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('does not exist') || msg.includes('relation')) {
      return ok([])
    }
    return err(`Failed to fetch rules: ${msg}`, 500)
  }
})

/**
 * POST /api/notifications/rules
 *
 * Body: See NotificationRoutingRule schema in blueprint
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_RULES)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const {
      eventType,
      providerId,
      targetType,
      enabled = true,
      priority = 0,
      messageTemplateId,
      condFulfillmentMode,
      condHasPager,
      condHasPhone,
      condMinPartySize,
      condOrderTypes,
      condDuringBusinessHours,
      retryMaxAttempts = 2,
      retryDelayMs = 2000,
      retryBackoffMultiplier = 1.5,
      retryOnTimeout = false,
      fallbackProviderId,
      escalateToStaff = false,
      alsoEmitDisplayProjection = false,
      stopProcessingAfterMatch = false,
      cooldownSeconds = 0,
      allowManualOverride = true,
      criticalityClass = 'standard',
      effectiveStartAt,
      effectiveEndAt,
    } = body

    // Validate required fields
    if (!eventType || !VALID_EVENT_TYPES.includes(eventType)) {
      return err(`eventType must be one of: ${VALID_EVENT_TYPES.join(', ')}`)
    }
    if (!providerId || typeof providerId !== 'string') {
      return err('providerId is required')
    }
    if (!targetType || !VALID_TARGET_TYPES.includes(targetType)) {
      return err(`targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}`)
    }
    if (!VALID_CRITICALITY_CLASSES.includes(criticalityClass)) {
      return err(`criticalityClass must be one of: ${VALID_CRITICALITY_CLASSES.join(', ')}`)
    }

    // Validate provider exists and check capability compatibility
    const providers: any[] = await db.$queryRaw`SELECT id, capabilities, "providerType" FROM "NotificationProvider"
       WHERE id = ${providerId} AND "locationId" = ${locationId} AND "isActive" = true AND "deletedAt" IS NULL`
    if (providers.length === 0) {
      return notFound('Provider not found or inactive')
    }

    const provider = providers[0]
    const capabilities = provider.capabilities as Record<string, boolean> | null

    // Validate targetType is compatible with provider capabilities
    if (capabilities) {
      const capabilityMap: Record<string, string> = {
        guest_pager: 'canPageNumeric',
        staff_pager: 'canPageNumeric',
        phone_sms: 'canSms',
        phone_voice: 'canVoice',
        order_screen: 'canDisplayPush',
        table_locator: 'canTracking',
      }
      const requiredCap = capabilityMap[targetType]
      if (requiredCap && !capabilities[requiredCap]) {
        return err(`Provider "${provider.providerType}" does not support ${targetType} (missing ${requiredCap})`)
      }
    }

    // Validate fallback provider if specified
    if (fallbackProviderId) {
      const fallback: any[] = await db.$queryRaw`SELECT id FROM "NotificationProvider"
         WHERE id = ${fallbackProviderId} AND "locationId" = ${locationId} AND "isActive" = true AND "deletedAt" IS NULL`
      if (fallback.length === 0) {
        return notFound('Fallback provider not found or inactive')
      }
    }

    // Validate condOrderTypes is an array of strings if provided
    if (condOrderTypes !== undefined && condOrderTypes !== null) {
      if (!Array.isArray(condOrderTypes) || condOrderTypes.some((t: unknown) => typeof t !== 'string')) {
        return err('condOrderTypes must be an array of strings')
      }
    }

    // Create the rule
    const inserted: any[] = await db.$queryRaw`INSERT INTO "NotificationRoutingRule" (
        id, "locationId", "eventType", "providerId", "targetType",
        enabled, priority, "messageTemplateId",
        "condFulfillmentMode", "condHasPager", "condHasPhone", "condMinPartySize",
        "condOrderTypes", "condDuringBusinessHours",
        "retryMaxAttempts", "retryDelayMs", "retryBackoffMultiplier", "retryOnTimeout",
        "fallbackProviderId", "escalateToStaff", "alsoEmitDisplayProjection",
        "stopProcessingAfterMatch", "cooldownSeconds", "allowManualOverride",
        "criticalityClass", "effectiveStartAt", "effectiveEndAt",
        "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, ${locationId}, ${eventType}, ${providerId}, ${targetType},
        ${enabled}, ${priority}, ${messageTemplateId || null},
        ${condFulfillmentMode || null}, ${condHasPager ?? null}, ${condHasPhone ?? null}, ${condMinPartySize ?? null},
        ${condOrderTypes || null}, ${condDuringBusinessHours ?? null},
        ${retryMaxAttempts}, ${retryDelayMs}, ${retryBackoffMultiplier}, ${retryOnTimeout},
        ${fallbackProviderId || null}, ${escalateToStaff}, ${alsoEmitDisplayProjection},
        ${stopProcessingAfterMatch}, ${cooldownSeconds}, ${allowManualOverride},
        ${criticalityClass}, ${effectiveStartAt ? new Date(effectiveStartAt) : null}, ${effectiveEndAt ? new Date(effectiveEndAt) : null},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *`

    const rule = inserted[0]

    // Audit log: notification_rule_created
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_rule_created',
        entityType: 'notification_routing_rule',
        entityId: rule.id,
        details: {
          eventType,
          providerId,
          targetType,
          enabled,
          priority,
          criticalityClass,
          fallbackProviderId: fallbackProviderId || null,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Clear cached routing rules so new rule takes effect immediately
    clearRoutingRulesCache()

    return created(rule)
  } catch (error) {
    console.error('[Notification Rules] POST error:', error)
    return err('Failed to create rule', 500)
  }
})
