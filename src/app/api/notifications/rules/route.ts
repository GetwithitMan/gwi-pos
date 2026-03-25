/**
 * GET /api/notifications/rules — List routing rules for location
 * POST /api/notifications/rules — Create a routing rule with condition validation
 *
 * Permission: GET = notifications.view_log, POST = notifications.manage_rules
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

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
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

    const rules: any[] = await db.$queryRawUnsafe(
      `SELECT r.*,
              p.name as "providerName", p."providerType",
              fp.name as "fallbackProviderName"
       FROM "NotificationRoutingRule" r
       LEFT JOIN "NotificationProvider" p ON p.id = r."providerId" AND p."deletedAt" IS NULL
       LEFT JOIN "NotificationProvider" fp ON fp.id = r."fallbackProviderId" AND fp."deletedAt" IS NULL
       WHERE ${conditions.join(' AND ')}
       ORDER BY r."eventType" ASC, r.priority DESC, r."createdAt" ASC`,
      ...params
    )

    return NextResponse.json({ data: rules })
  } catch (error) {
    console.error('[Notification Rules] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch rules' }, { status: 500 })
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
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_RULES)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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
      return NextResponse.json(
        { error: `eventType must be one of: ${VALID_EVENT_TYPES.join(', ')}` },
        { status: 400 }
      )
    }
    if (!providerId || typeof providerId !== 'string') {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 })
    }
    if (!targetType || !VALID_TARGET_TYPES.includes(targetType)) {
      return NextResponse.json(
        { error: `targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}` },
        { status: 400 }
      )
    }
    if (!VALID_CRITICALITY_CLASSES.includes(criticalityClass)) {
      return NextResponse.json(
        { error: `criticalityClass must be one of: ${VALID_CRITICALITY_CLASSES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate provider exists and check capability compatibility
    const providers: any[] = await db.$queryRawUnsafe(
      `SELECT id, capabilities, "providerType" FROM "NotificationProvider"
       WHERE id = $1 AND "locationId" = $2 AND "isActive" = true AND "deletedAt" IS NULL`,
      providerId,
      locationId
    )
    if (providers.length === 0) {
      return NextResponse.json({ error: 'Provider not found or inactive' }, { status: 404 })
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
        return NextResponse.json(
          { error: `Provider "${provider.providerType}" does not support ${targetType} (missing ${requiredCap})` },
          { status: 400 }
        )
      }
    }

    // Validate fallback provider if specified
    if (fallbackProviderId) {
      const fallback: any[] = await db.$queryRawUnsafe(
        `SELECT id FROM "NotificationProvider"
         WHERE id = $1 AND "locationId" = $2 AND "isActive" = true AND "deletedAt" IS NULL`,
        fallbackProviderId,
        locationId
      )
      if (fallback.length === 0) {
        return NextResponse.json({ error: 'Fallback provider not found or inactive' }, { status: 404 })
      }
    }

    // Validate condOrderTypes is an array of strings if provided
    if (condOrderTypes !== undefined && condOrderTypes !== null) {
      if (!Array.isArray(condOrderTypes) || condOrderTypes.some((t: unknown) => typeof t !== 'string')) {
        return NextResponse.json({ error: 'condOrderTypes must be an array of strings' }, { status: 400 })
      }
    }

    // Create the rule
    const inserted: any[] = await db.$queryRawUnsafe(
      `INSERT INTO "NotificationRoutingRule" (
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
        gen_random_uuid()::text, $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20,
        $21, $22, $23,
        $24, $25, $26,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *`,
      locationId,
      eventType,
      providerId,
      targetType,
      enabled,
      priority,
      messageTemplateId || null,
      condFulfillmentMode || null,
      condHasPager ?? null,
      condHasPhone ?? null,
      condMinPartySize ?? null,
      condOrderTypes || null,
      condDuringBusinessHours ?? null,
      retryMaxAttempts,
      retryDelayMs,
      retryBackoffMultiplier,
      retryOnTimeout,
      fallbackProviderId || null,
      escalateToStaff,
      alsoEmitDisplayProjection,
      stopProcessingAfterMatch,
      cooldownSeconds,
      allowManualOverride,
      criticalityClass,
      effectiveStartAt ? new Date(effectiveStartAt) : null,
      effectiveEndAt ? new Date(effectiveEndAt) : null
    )

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
    }).catch(console.error)

    return NextResponse.json({ data: rule }, { status: 201 })
  } catch (error) {
    console.error('[Notification Rules] POST error:', error)
    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 })
  }
})
