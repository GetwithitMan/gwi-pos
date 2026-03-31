/**
 * GET /api/notifications/explain — "Why didn't this notify?" diagnostic endpoint
 *
 * Evaluates routing rules for a given subject/event WITHOUT enqueueing.
 * Returns: which rules matched, which didn't and why, what targets exist, provider health.
 *
 * Query params:
 *   subjectType — 'order' | 'waitlist_entry' | 'reservation' | 'staff_task' (required)
 *   subjectId — string (required)
 *   eventType — e.g. 'order_ready', 'waitlist_ready' (required)
 *
 * Permission: notifications.view_log
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

const VALID_SUBJECT_TYPES = ['order', 'waitlist_entry', 'reservation', 'staff_task']

const VALID_EVENT_TYPES = [
  'waitlist_added', 'waitlist_ready', 'waitlist_second_call', 'waitlist_final_warning', 'waitlist_expired',
  'order_created', 'order_ready', 'order_delayed', 'order_picked_up', 'order_cancelled', 'order_recalled',
  'curbside_arrived', 'server_needed', 'expo_recall', 'staff_alert',
]

interface RuleEvaluation {
  ruleId: string
  eventType: string
  providerId: string
  providerName: string | null
  providerType: string | null
  targetType: string
  priority: number
  enabled: boolean
  matched: boolean
  reasons: string[]
  conditionDetails: {
    condFulfillmentMode: { required: string | null; actual: string | null; passed: boolean }
    condHasPager: { required: boolean | null; actual: boolean; passed: boolean }
    condHasPhone: { required: boolean | null; actual: boolean; passed: boolean }
    condMinPartySize: { required: number | null; actual: number | null; passed: boolean }
    condOrderTypes: { required: string[] | null; actual: string | null; passed: boolean }
    condDuringBusinessHours: { required: boolean | null; passed: boolean }
    effectiveWindow: { valid: boolean; reason: string | null }
  }
}

interface TargetInfo {
  id: string
  targetType: string
  targetValue: string
  status: string
  isPrimary: boolean
  providerId: string | null
}

interface ProviderHealth {
  id: string
  name: string
  providerType: string
  isActive: boolean
  healthStatus: string
  consecutiveFailures: number
  circuitBreakerOpenUntil: string | null
  lastHealthCheckAt: string | null
}

/**
 * GET /api/notifications/explain
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
    const subjectType = searchParams.get('subjectType')
    const subjectId = searchParams.get('subjectId')
    const eventType = searchParams.get('eventType')

    // Validate required params
    if (!subjectType || !VALID_SUBJECT_TYPES.includes(subjectType)) {
      return err(`subjectType is required and must be one of: ${VALID_SUBJECT_TYPES.join(', ')}`)
    }
    if (!subjectId) {
      return err('subjectId is required')
    }
    if (!eventType || !VALID_EVENT_TYPES.includes(eventType)) {
      return err(`eventType is required and must be one of: ${VALID_EVENT_TYPES.join(', ')}`)
    }

    // ── Step 1: Get notification mode ──────────────────────────────────────
    let notificationMode = 'off'
    try {
      const locations: any[] = await db.$queryRaw`SELECT settings FROM "Location" WHERE id = ${locationId}`
      if (locations[0]?.settings) {
        const settings = locations[0].settings as Record<string, unknown>
        notificationMode = (settings.notificationMode as string) || 'off'
      }
    } catch {
      // Default to 'off'
    }

    // ── Step 2: Build subject context ──────────────────────────────────────
    let subjectContext: Record<string, unknown> = {}
    let subjectFound = false

    if (subjectType === 'order') {
      const orders: any[] = await db.$queryRaw`SELECT id, "orderNumber", "tabName", "pagerNumber", status, "customerName",
                "fulfillmentMode"
         FROM "Order"
         WHERE id = ${subjectId} AND "locationId" = ${locationId}`
      if (orders[0]) {
        subjectFound = true
        subjectContext = {
          orderNumber: orders[0].orderNumber,
          tabName: orders[0].tabName,
          pagerNumber: orders[0].pagerNumber,
          orderStatus: orders[0].status,
          customerName: orders[0].customerName,
          fulfillmentMode: orders[0].fulfillmentMode,
        }
      }
    } else if (subjectType === 'waitlist_entry') {
      const entries: any[] = await db.$queryRaw`SELECT id, "customerName", "partySize", phone, "pagerNumber", status
         FROM "WaitlistEntry"
         WHERE id = ${subjectId} AND "locationId" = ${locationId}`
      if (entries[0]) {
        subjectFound = true
        subjectContext = {
          customerName: entries[0].customerName,
          partySize: entries[0].partySize,
          phone: entries[0].phone,
          pagerNumber: entries[0].pagerNumber,
          entryStatus: entries[0].status,
        }
      }
    }

    // ── Step 3: Get active target assignments ──────────────────────────────
    const targets: TargetInfo[] = await db.$queryRaw`SELECT id, "targetType", "targetValue", status, "isPrimary", "providerId"
       FROM "NotificationTargetAssignment"
       WHERE "locationId" = ${locationId}
         AND "subjectType" = ${subjectType}
         AND "subjectId" = ${subjectId}
       ORDER BY status ASC, "isPrimary" DESC, "createdAt" DESC` as TargetInfo[]

    const activeTargets = targets.filter(t => t.status === 'active')
    const hasPager = activeTargets.some(t => ['guest_pager', 'staff_pager'].includes(t.targetType))
      || !!subjectContext.pagerNumber
    const hasPhone = activeTargets.some(t => ['phone_sms', 'phone_voice'].includes(t.targetType))
      || !!subjectContext.phone

    // ── Step 4: Get all routing rules for this event type ──────────────────
    const allRules: any[] = await db.$queryRaw`SELECT r.*, p.name as "providerName", p."providerType"
       FROM "NotificationRoutingRule" r
       LEFT JOIN "NotificationProvider" p ON p.id = r."providerId" AND p."deletedAt" IS NULL
       WHERE r."locationId" = ${locationId}
         AND r."eventType" = ${eventType}
         AND r."deletedAt" IS NULL
       ORDER BY r.priority DESC, r."createdAt" ASC`

    // ── Step 5: Evaluate each rule ──────────────────────────────────────────
    const now = new Date()
    const ruleEvaluations: RuleEvaluation[] = allRules.map(rule => {
      const reasons: string[] = []
      let matched = true

      // Check enabled
      if (!rule.enabled) {
        matched = false
        reasons.push('Rule is disabled')
      }

      // Check effective window
      let effectiveWindowValid = true
      let effectiveWindowReason: string | null = null
      if (rule.effectiveStartAt && new Date(rule.effectiveStartAt) > now) {
        effectiveWindowValid = false
        effectiveWindowReason = `Rule not yet effective (starts ${rule.effectiveStartAt})`
        matched = false
        reasons.push(effectiveWindowReason)
      }
      if (rule.effectiveEndAt && new Date(rule.effectiveEndAt) < now) {
        effectiveWindowValid = false
        effectiveWindowReason = `Rule has expired (ended ${rule.effectiveEndAt})`
        matched = false
        reasons.push(effectiveWindowReason)
      }

      // Evaluate conditions
      const condFulfillmentPassed = rule.condFulfillmentMode == null
        || subjectContext.fulfillmentMode === rule.condFulfillmentMode
      if (!condFulfillmentPassed) {
        matched = false
        reasons.push(`Fulfillment mode mismatch: requires "${rule.condFulfillmentMode}", got "${subjectContext.fulfillmentMode || 'none'}"`)
      }

      const condHasPagerPassed = rule.condHasPager == null || rule.condHasPager === hasPager
      if (!condHasPagerPassed) {
        matched = false
        reasons.push(`Has pager mismatch: requires ${rule.condHasPager}, actual ${hasPager}`)
      }

      const condHasPhonePassed = rule.condHasPhone == null || rule.condHasPhone === hasPhone
      if (!condHasPhonePassed) {
        matched = false
        reasons.push(`Has phone mismatch: requires ${rule.condHasPhone}, actual ${hasPhone}`)
      }

      const actualPartySize = typeof subjectContext.partySize === 'number'
        ? subjectContext.partySize as number
        : null
      const condMinPartySizePassed = rule.condMinPartySize == null
        || (actualPartySize != null && actualPartySize >= rule.condMinPartySize)
      if (!condMinPartySizePassed) {
        matched = false
        reasons.push(`Party size too small: requires >= ${rule.condMinPartySize}, got ${actualPartySize ?? 'unknown'}`)
      }

      const condOrderTypesPassed = !rule.condOrderTypes || rule.condOrderTypes.length === 0
        || (subjectContext.orderType && rule.condOrderTypes.includes(subjectContext.orderType))
      if (!condOrderTypesPassed) {
        matched = false
        reasons.push(`Order type mismatch: requires one of [${rule.condOrderTypes?.join(', ')}], got "${subjectContext.orderType || 'none'}"`)
      }

      const condBusinessHoursPassed = rule.condDuringBusinessHours == null // v1: always pass
      if (!condBusinessHoursPassed) {
        matched = false
        reasons.push('Business hours condition not met')
      }

      // Check if targets exist for this rule's target type
      const hasMatchingTarget = activeTargets.some(t => t.targetType === rule.targetType)
      if (!hasMatchingTarget && matched) {
        // Check context fallback
        const contextHasTarget = getContextTargetValue(rule.targetType, subjectContext)
        if (!contextHasTarget) {
          reasons.push(`No active target assignment of type "${rule.targetType}" found for this subject`)
        }
      }

      if (matched && reasons.length === 0) {
        reasons.push('All conditions passed')
      }

      return {
        ruleId: rule.id,
        eventType: rule.eventType,
        providerId: rule.providerId,
        providerName: rule.providerName,
        providerType: rule.providerType,
        targetType: rule.targetType,
        priority: rule.priority,
        enabled: rule.enabled,
        matched,
        reasons,
        conditionDetails: {
          condFulfillmentMode: {
            required: rule.condFulfillmentMode,
            actual: (subjectContext.fulfillmentMode as string) || null,
            passed: condFulfillmentPassed,
          },
          condHasPager: {
            required: rule.condHasPager,
            actual: hasPager,
            passed: condHasPagerPassed,
          },
          condHasPhone: {
            required: rule.condHasPhone,
            actual: hasPhone,
            passed: condHasPhonePassed,
          },
          condMinPartySize: {
            required: rule.condMinPartySize,
            actual: actualPartySize,
            passed: condMinPartySizePassed,
          },
          condOrderTypes: {
            required: rule.condOrderTypes,
            actual: (subjectContext.orderType as string) || null,
            passed: condOrderTypesPassed,
          },
          condDuringBusinessHours: {
            required: rule.condDuringBusinessHours,
            passed: condBusinessHoursPassed,
          },
          effectiveWindow: {
            valid: effectiveWindowValid,
            reason: effectiveWindowReason,
          },
        },
      }
    })

    // ── Step 6: Get provider health status ──────────────────────────────────
    const providerIds = [...new Set(allRules.map((r: any) => r.providerId).filter(Boolean))]
    let providerHealth: ProviderHealth[] = []
    if (providerIds.length > 0) {
      providerHealth = await db.$queryRaw`SELECT id, name, "providerType", "isActive", "healthStatus",
                "consecutiveFailures", "circuitBreakerOpenUntil", "lastHealthCheckAt"
         FROM "NotificationProvider"
         WHERE id = ANY(${providerIds}::text[]) AND "deletedAt" IS NULL` as ProviderHealth[]
    }

    // ── Step 7: Check for recent notification jobs ──────────────────────────
    const recentJobs: any[] = await db.$queryRaw`SELECT id, status, "terminalResult", "createdAt", "completedAt",
              "targetType", "targetValue", "providerId", "dispatchOrigin",
              "ruleExplainSnapshot"
       FROM "NotificationJob"
       WHERE "locationId" = ${locationId}
         AND "subjectType" = ${subjectType}
         AND "subjectId" = ${subjectId}
         AND "eventType" = ${eventType}
       ORDER BY "createdAt" DESC
       LIMIT 10`

    // ── Build explanation ──────────────────────────────────────────────────
    const matchedRules = ruleEvaluations.filter(r => r.matched)
    const unmatchedRules = ruleEvaluations.filter(r => !r.matched)

    const explanation: string[] = []

    if (notificationMode === 'off') {
      explanation.push('BLOCKED: Notification mode is "off" for this location. No notifications will be sent.')
    } else if (notificationMode === 'forced_legacy') {
      explanation.push('BLOCKED: Notification mode is "forced_legacy". New system is bypassed.')
    } else if (notificationMode === 'shadow') {
      explanation.push('MODE: Shadow mode — rules are evaluated and logged but no actual sends occur.')
    } else if (notificationMode === 'dry_run') {
      explanation.push('MODE: Dry run — jobs are enqueued but sends are skipped.')
    }

    if (!subjectFound) {
      explanation.push(`WARNING: Subject ${subjectType}:${subjectId} not found in database.`)
    }

    if (allRules.length === 0) {
      explanation.push(`NO RULES: No routing rules exist for event type "${eventType}" at this location.`)
    } else if (matchedRules.length === 0) {
      explanation.push(`NO MATCH: ${allRules.length} routing rule(s) exist for "${eventType}" but none matched the current conditions.`)
    } else {
      explanation.push(`MATCHED: ${matchedRules.length} of ${allRules.length} rule(s) would fire for "${eventType}".`)
    }

    if (activeTargets.length === 0) {
      explanation.push('NO TARGETS: No active notification target assignments exist for this subject (no pager, no phone).')
    }

    return ok({
        subjectType,
        subjectId,
        eventType,
        notificationMode,
        subjectFound,
        subjectContext,
        explanation,
        rules: {
          total: allRules.length,
          matched: matchedRules.length,
          unmatched: unmatchedRules.length,
          evaluations: ruleEvaluations,
        },
        targets: {
          active: activeTargets,
          all: targets,
        },
        providerHealth,
        recentJobs: recentJobs.map(j => ({
          ...j,
          // Truncate snapshot for readability
          ruleExplainSnapshot: j.ruleExplainSnapshot
            ? (typeof j.ruleExplainSnapshot === 'object' ? j.ruleExplainSnapshot : null)
            : null,
        })),
      })
  } catch (error) {
    console.error('[Notification Explain] GET error:', error)
    return err('Failed to evaluate notification explain', 500)
  }
})

/**
 * Get target value from context as fallback when no formal assignment exists.
 */
function getContextTargetValue(
  targetType: string,
  context: Record<string, unknown>
): string | null {
  switch (targetType) {
    case 'phone_sms':
    case 'phone_voice':
      return (context.phone as string) ?? null
    case 'guest_pager':
    case 'staff_pager':
      return (context.pagerNumber as string) ?? null
    default:
      return null
  }
}
