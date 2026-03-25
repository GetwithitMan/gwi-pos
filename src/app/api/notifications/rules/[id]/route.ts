/**
 * GET /api/notifications/rules/[id] — Get a single routing rule
 * PUT /api/notifications/rules/[id] — Update a routing rule
 * DELETE /api/notifications/rules/[id] — Soft-delete a routing rule
 *
 * Permission: GET = notifications.view_log, PUT/DELETE = notifications.manage_rules
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { clearRoutingRulesCache } from '@/lib/notifications/dispatcher'

export const dynamic = 'force-dynamic'

const VALID_TARGET_TYPES = [
  'guest_pager', 'phone_sms', 'phone_voice', 'order_screen', 'staff_pager', 'table_locator',
]

const VALID_CRITICALITY_CLASSES = ['critical', 'standard', 'informational']

/**
 * GET /api/notifications/rules/[id]
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const rules: any[] = await db.$queryRawUnsafe(
      `SELECT r.*,
              p.name as "providerName", p."providerType",
              fp.name as "fallbackProviderName"
       FROM "NotificationRoutingRule" r
       LEFT JOIN "NotificationProvider" p ON p.id = r."providerId" AND p."deletedAt" IS NULL
       LEFT JOIN "NotificationProvider" fp ON fp.id = r."fallbackProviderId" AND fp."deletedAt" IS NULL
       WHERE r.id = $1 AND r."locationId" = $2 AND r."deletedAt" IS NULL`,
      id,
      locationId
    )

    if (rules.length === 0) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    return NextResponse.json({ data: rules[0] })
  } catch (error) {
    console.error('[Notification Rules] GET [id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch rule' }, { status: 500 })
  }
})

/**
 * PUT /api/notifications/rules/[id]
 *
 * Validate provider capability compatibility with targetType on update.
 */
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_RULES)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Verify rule exists
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT id, "providerId", "targetType", "eventType", priority, "criticalityClass"
       FROM "NotificationRoutingRule"
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId
    )
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    const body = await request.json()
    const {
      eventType,
      providerId,
      targetType,
      enabled,
      priority,
      messageTemplateId,
      condFulfillmentMode,
      condHasPager,
      condHasPhone,
      condMinPartySize,
      condOrderTypes,
      condDuringBusinessHours,
      retryMaxAttempts,
      retryDelayMs,
      retryBackoffMultiplier,
      retryOnTimeout,
      fallbackProviderId,
      escalateToStaff,
      alsoEmitDisplayProjection,
      stopProcessingAfterMatch,
      cooldownSeconds,
      allowManualOverride,
      criticalityClass,
      effectiveStartAt,
      effectiveEndAt,
    } = body

    // Validate targetType if provided
    if (targetType !== undefined && !VALID_TARGET_TYPES.includes(targetType)) {
      return NextResponse.json(
        { error: `targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    if (criticalityClass !== undefined && !VALID_CRITICALITY_CLASSES.includes(criticalityClass)) {
      return NextResponse.json(
        { error: `criticalityClass must be one of: ${VALID_CRITICALITY_CLASSES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate provider capability compatibility if provider or targetType changed
    const effectiveProviderId = providerId || existing[0].providerId
    const effectiveTargetType = targetType || existing[0].targetType

    if (providerId || targetType) {
      const providers: any[] = await db.$queryRawUnsafe(
        `SELECT id, capabilities, "providerType" FROM "NotificationProvider"
         WHERE id = $1 AND "locationId" = $2 AND "isActive" = true AND "deletedAt" IS NULL`,
        effectiveProviderId,
        locationId
      )
      if (providers.length === 0) {
        return NextResponse.json({ error: 'Provider not found or inactive' }, { status: 404 })
      }

      const capabilities = providers[0].capabilities as Record<string, boolean> | null
      if (capabilities) {
        const capabilityMap: Record<string, string> = {
          guest_pager: 'canPageNumeric',
          staff_pager: 'canPageNumeric',
          phone_sms: 'canSms',
          phone_voice: 'canVoice',
          order_screen: 'canDisplayPush',
          table_locator: 'canTracking',
        }
        const requiredCap = capabilityMap[effectiveTargetType]
        if (requiredCap && !capabilities[requiredCap]) {
          return NextResponse.json(
            { error: `Provider does not support ${effectiveTargetType} (missing ${requiredCap})` },
            { status: 400 }
          )
        }
      }
    }

    // Build dynamic SET clause
    const setClauses: string[] = [`"updatedAt" = CURRENT_TIMESTAMP`]
    const setParams: unknown[] = []
    let paramIdx = 3 // $1=id, $2=locationId

    function addField(name: string, value: unknown) {
      if (value !== undefined) {
        setClauses.push(`"${name}" = $${paramIdx}`)
        setParams.push(value)
        paramIdx++
      }
    }

    addField('eventType', eventType)
    addField('providerId', providerId)
    addField('targetType', targetType)
    addField('enabled', enabled)
    addField('priority', priority)
    addField('messageTemplateId', messageTemplateId !== undefined ? (messageTemplateId || null) : undefined)
    addField('condFulfillmentMode', condFulfillmentMode !== undefined ? (condFulfillmentMode || null) : undefined)
    addField('condHasPager', condHasPager)
    addField('condHasPhone', condHasPhone)
    addField('condMinPartySize', condMinPartySize)
    addField('condOrderTypes', condOrderTypes !== undefined ? condOrderTypes : undefined)
    addField('condDuringBusinessHours', condDuringBusinessHours)
    addField('retryMaxAttempts', retryMaxAttempts)
    addField('retryDelayMs', retryDelayMs)
    addField('retryBackoffMultiplier', retryBackoffMultiplier)
    addField('retryOnTimeout', retryOnTimeout)
    addField('fallbackProviderId', fallbackProviderId !== undefined ? (fallbackProviderId || null) : undefined)
    addField('escalateToStaff', escalateToStaff)
    addField('alsoEmitDisplayProjection', alsoEmitDisplayProjection)
    addField('stopProcessingAfterMatch', stopProcessingAfterMatch)
    addField('cooldownSeconds', cooldownSeconds)
    addField('allowManualOverride', allowManualOverride)
    addField('criticalityClass', criticalityClass)

    if (effectiveStartAt !== undefined) {
      setClauses.push(`"effectiveStartAt" = $${paramIdx}`)
      setParams.push(effectiveStartAt ? new Date(effectiveStartAt) : null)
      paramIdx++
    }
    if (effectiveEndAt !== undefined) {
      setClauses.push(`"effectiveEndAt" = $${paramIdx}`)
      setParams.push(effectiveEndAt ? new Date(effectiveEndAt) : null)
      paramIdx++
    }

    const updated: any[] = await db.$queryRawUnsafe(
      `UPDATE "NotificationRoutingRule"
       SET ${setClauses.join(', ')}
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
       RETURNING *`,
      id,
      locationId,
      ...setParams
    )

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    // Audit log: notification_rule_updated
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_rule_updated',
        entityType: 'notification_routing_rule',
        entityId: id,
        details: {
          changedFields: Object.keys(body),
          previousEventType: existing[0].eventType,
          previousPriority: existing[0].priority,
          previousCriticalityClass: existing[0].criticalityClass,
        },
      },
    }).catch(console.error)

    // Clear cached routing rules so updates take effect immediately
    clearRoutingRulesCache()

    return NextResponse.json({ data: updated[0] })
  } catch (error) {
    console.error('[Notification Rules] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 })
  }
})

/**
 * DELETE /api/notifications/rules/[id] — Soft-delete
 */
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_RULES)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Fetch rule details before deletion for audit
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT id, "eventType", "providerId", "targetType", priority
       FROM "NotificationRoutingRule"
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId
    )

    const deleted = await db.$executeRawUnsafe(
      `UPDATE "NotificationRoutingRule"
       SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId
    )

    if (deleted === 0) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    // Audit log: notification_rule_deleted
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_rule_deleted',
        entityType: 'notification_routing_rule',
        entityId: id,
        details: existing[0] ? {
          eventType: existing[0].eventType,
          providerId: existing[0].providerId,
          targetType: existing[0].targetType,
          priority: existing[0].priority,
        } : {},
      },
    }).catch(console.error)

    // Clear cached routing rules so deletion takes effect immediately
    clearRoutingRulesCache()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Notification Rules] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 })
  }
})
