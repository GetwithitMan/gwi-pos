/**
 * Notification Dispatcher
 *
 * `notifyEvent()` — the single entry point for all notification triggers.
 *
 * Design rules (Section 6.3):
 * - Never sends directly
 * - Evaluates routing and enqueues durable jobs
 * - Workers process jobs asynchronously
 * - API callers never block on delivery
 *
 * Flow:
 * 1. Check notification mode for location
 * 2. Evaluate source-event dedup once
 * 3. Load enabled routing rules for event (cached 60s)
 * 4. Evaluate conditions, sort by priority
 * 5. For each matched rule: compute idempotency, snapshot policy, render template, persist job, emit NOTIFY
 * 6. Stop on stopProcessingAfterMatch
 * 7. If zero rules matched: log explain
 */

import crypto from 'crypto'
import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'
import { renderMessage } from './template-engine'
import {
  findActiveJobByIdempotencyKey,
  findJobBySourceEvent,
} from './notification-repository'
import type {
  NotificationInput,
  NotificationResult,
  NotificationMode,
  NotificationPolicySnapshot,
  NotificationCapabilities,
  CriticalityClass,
  NotificationEventType,
} from './types'
import { EVENT_CRITICALITY } from './types'

const log = createChildLogger('notification-dispatcher')

// ─── Routing Rules Cache ────────────────────────────────────────────────────

interface CachedRules {
  rules: RoutingRule[]
  fetchedAt: number
}

interface RoutingRule {
  id: string
  locationId: string
  eventType: string
  providerId: string
  targetType: string
  enabled: boolean
  priority: number
  messageTemplateId: string | null
  condFulfillmentMode: string | null
  condHasPager: boolean | null
  condHasPhone: boolean | null
  condMinPartySize: number | null
  condOrderTypes: string[] | null
  condDuringBusinessHours: boolean | null
  retryMaxAttempts: number
  retryDelayMs: number
  retryBackoffMultiplier: number
  retryOnTimeout: boolean
  fallbackProviderId: string | null
  escalateToStaff: boolean
  alsoEmitDisplayProjection: boolean
  stopProcessingAfterMatch: boolean
  cooldownSeconds: number
  allowManualOverride: boolean
  criticalityClass: string
}

const rulesCache = new Map<string, CachedRules>()
const RULES_CACHE_TTL_MS = 60_000 // 60 seconds

async function getRoutingRules(locationId: string, eventType: string): Promise<RoutingRule[]> {
  const cacheKey = `${locationId}:${eventType}`
  const cached = rulesCache.get(cacheKey)

  if (cached && Date.now() - cached.fetchedAt < RULES_CACHE_TTL_MS) {
    return cached.rules
  }

  const rules = await db.notificationRoutingRule.findMany({
    where: {
      locationId,
      eventType,
      enabled: true,
      deletedAt: null,
      OR: [
        { effectiveStartAt: null },
        { effectiveStartAt: { lte: new Date() } },
      ],
      AND: [
        {
          OR: [
            { effectiveEndAt: null },
            { effectiveEndAt: { gte: new Date() } },
          ],
        },
      ],
    },
    orderBy: { priority: 'desc' },
  }) as RoutingRule[]

  rulesCache.set(cacheKey, { rules, fetchedAt: Date.now() })
  return rules
}

// ─── Notification Mode ──────────────────────────────────────────────────────

async function getNotificationMode(locationId: string): Promise<NotificationMode> {
  // Read from location settings. Default: 'off' during rollout.
  try {
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    if (location?.settings && typeof location.settings === 'object') {
      const settings = location.settings as Record<string, unknown>
      const mode = settings.notificationMode as NotificationMode | undefined
      if (mode && ['off', 'shadow', 'dry_run', 'primary', 'forced_legacy'].includes(mode)) {
        return mode
      }
    }
  } catch {
    // Fall through to default
  }
  return 'off'
}

// ─── Condition Evaluation ───────────────────────────────────────────────────

function evaluateConditions(
  rule: RoutingRule,
  context: Record<string, unknown>
): boolean {
  // condFulfillmentMode
  if (rule.condFulfillmentMode != null) {
    if (context.fulfillmentMode !== rule.condFulfillmentMode) return false
  }

  // condHasPager
  if (rule.condHasPager != null) {
    const hasPager = !!context.pagerNumber
    if (rule.condHasPager !== hasPager) return false
  }

  // condHasPhone
  if (rule.condHasPhone != null) {
    const hasPhone = !!context.phone
    if (rule.condHasPhone !== hasPhone) return false
  }

  // condMinPartySize
  if (rule.condMinPartySize != null) {
    const partySize = typeof context.partySize === 'number' ? context.partySize : 0
    if (partySize < rule.condMinPartySize) return false
  }

  // condOrderTypes
  if (rule.condOrderTypes && rule.condOrderTypes.length > 0) {
    const orderType = context.orderType as string | undefined
    if (!orderType || !rule.condOrderTypes.includes(orderType)) return false
  }

  // condDuringBusinessHours — skip for v1 (would require business hours config)
  // if (rule.condDuringBusinessHours != null) { ... }

  return true
}

// ─── Idempotency Key Computation ────────────────────────────────────────────

function computeIdempotencyKey(
  locationId: string,
  eventType: string,
  subjectId: string,
  targetType: string,
  targetValue: string,
  businessStage: string
): string {
  const raw = `${locationId}:${eventType}:${subjectId}:${targetType}:${targetValue}:${businessStage}`
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 48)
}

// ─── Policy Snapshot ────────────────────────────────────────────────────────

async function buildPolicySnapshot(
  rule: RoutingRule,
  mode: NotificationMode
): Promise<NotificationPolicySnapshot> {
  // Fetch provider capabilities
  let providerHealthStatus = 'healthy'
  let providerCapabilities: NotificationCapabilities = {
    canPageNumeric: false,
    canPageAlpha: false,
    canSms: false,
    canVoice: false,
    canDisplayPush: false,
    canDeviceInventory: false,
    canDeviceAssignment: false,
    canDeviceRecall: false,
    canOutOfRangeDetection: false,
    canBatteryTelemetry: false,
    canTracking: false,
    canKioskDispense: false,
    canCancellation: false,
    canDeliveryConfirmation: false,
  }

  try {
    const provider = await db.notificationProvider.findUnique({
      where: { id: rule.providerId },
      select: { healthStatus: true, capabilities: true },
    })
    if (provider) {
      providerHealthStatus = provider.healthStatus
      if (provider.capabilities && typeof provider.capabilities === 'object') {
        providerCapabilities = provider.capabilities as unknown as NotificationCapabilities
      }
    }
  } catch {
    // Use defaults
  }

  return {
    retryMaxAttempts: rule.retryMaxAttempts,
    retryDelayMs: rule.retryDelayMs,
    retryBackoffMultiplier: rule.retryBackoffMultiplier,
    retryOnTimeout: rule.retryOnTimeout,
    fallbackProviderId: rule.fallbackProviderId,
    escalateToStaff: rule.escalateToStaff,
    criticalityClass: rule.criticalityClass as CriticalityClass,
    cooldownSeconds: rule.cooldownSeconds,
    allowManualOverride: rule.allowManualOverride,
    notificationMode: mode,
    providerHealthStatus,
    providerCapabilities,
  }
}

// ─── Template Rendering ─────────────────────────────────────────────────────

async function renderTemplateForRule(
  rule: RoutingRule,
  context: Record<string, unknown>,
  targetType: string
): Promise<string | null> {
  if (!rule.messageTemplateId) return null

  try {
    const template = await db.notificationTemplate.findUnique({
      where: { id: rule.messageTemplateId },
      select: { body: true, maxLength: true },
    })
    if (!template) return null

    return renderMessage({
      template: template.body,
      variables: context,
      targetType: targetType as import('./types').TargetType,
      maxLength: template.maxLength,
    })
  } catch {
    return null
  }
}

// ─── Find Active Target Assignments ─────────────────────────────────────────

async function getActiveTargets(
  locationId: string,
  subjectType: string,
  subjectId: string,
  targetType: string
): Promise<{ targetValue: string; providerId: string | null }[]> {
  const assignments = await db.notificationTargetAssignment.findMany({
    where: {
      locationId,
      subjectType,
      subjectId,
      targetType,
      status: 'active',
    },
    orderBy: [{ isPrimary: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    select: { targetValue: true, providerId: true },
  })
  return assignments
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * notifyEvent() — evaluate routing rules and enqueue durable notification jobs.
 *
 * This function never sends directly. It persists NotificationJob rows
 * and emits Postgres NOTIFY for the worker to pick up.
 */
export async function notifyEvent(input: NotificationInput): Promise<NotificationResult> {
  const result: NotificationResult = {
    jobsEnqueued: 0,
    jobIds: [],
    suppressed: 0,
    deduplicated: 0,
    errors: 0,
  }

  const {
    locationId,
    eventType,
    subjectType,
    subjectId,
    subjectVersion,
    sourceSystem,
    sourceEventId,
    sourceEventVersion = 1,
    dispatchOrigin,
    businessStage,
    correlationId = crypto.randomUUID(),
    contextSnapshot,
    isProbe = false,
  } = input

  // ── Step 1: Check notification mode ──────────────────────────────────────
  const mode = await getNotificationMode(locationId)

  if (mode === 'off') {
    log.debug({ locationId, eventType }, 'Notification mode is off — skipping')
    return result
  }

  if (mode === 'forced_legacy') {
    log.debug({ locationId, eventType }, 'Notification mode is forced_legacy — skipping')
    return result
  }

  // ── Step 2: Source-event dedup (Layer 1) ─────────────────────────────────
  const existingSource = await findJobBySourceEvent(
    db as any,
    locationId,
    sourceSystem,
    sourceEventId,
    sourceEventVersion
  )
  if (existingSource) {
    log.debug({ locationId, sourceEventId, existingJobId: existingSource.id }, 'Source event dedup — job already exists')
    result.deduplicated++
    return result
  }

  // ── Step 3: Load routing rules (cached 60s) ─────────────────────────────
  const rules = await getRoutingRules(locationId, eventType)

  if (rules.length === 0) {
    log.info(
      { locationId, eventType },
      'No routing rules matched for notification event'
    )
    return result
  }

  // ── Step 4–6: Evaluate conditions, enqueue jobs ─────────────────────────
  for (const rule of rules) {
    // Evaluate conditions
    if (!evaluateConditions(rule, contextSnapshot)) {
      continue
    }

    // Get active target assignments for this rule's target type
    const targets = await getActiveTargets(locationId, subjectType, subjectId, rule.targetType)

    // If no targets assigned, try context-provided values
    let targetEntries = targets.map(t => ({
      targetValue: t.targetValue,
      providerId: t.providerId ?? rule.providerId,
    }))

    if (targetEntries.length === 0) {
      // Fall back to context snapshot for phone/pager
      const contextValue = getContextTargetValue(rule.targetType, contextSnapshot)
      if (contextValue) {
        targetEntries = [{ targetValue: contextValue, providerId: rule.providerId }]
      }
    }

    if (targetEntries.length === 0) {
      log.debug({ locationId, eventType, targetType: rule.targetType }, 'No targets found for rule — skipping')
      continue
    }

    for (const target of targetEntries) {
      // ── Layer 2: Workflow dedup ────────────────────────────────────────
      const idempotencyKey = computeIdempotencyKey(
        locationId, eventType, subjectId,
        rule.targetType, target.targetValue, businessStage
      )

      // Manual overrides bypass workflow dedup
      if (dispatchOrigin !== 'manual_override') {
        const existingJob = await findActiveJobByIdempotencyKey(db as any, idempotencyKey)
        if (existingJob) {
          log.debug({ idempotencyKey, existingJobId: existingJob.id }, 'Workflow dedup — active job exists')
          result.deduplicated++
          continue
        }
      }

      // ── Snapshot policy ────────────────────────────────────────────────
      const policySnapshot = await buildPolicySnapshot(rule, mode)

      // ── Render template ────────────────────────────────────────────────
      const messageRendered = await renderTemplateForRule(
        rule, contextSnapshot, rule.targetType
      )

      // ── Determine criticality ──────────────────────────────────────────
      const criticality = EVENT_CRITICALITY[eventType as NotificationEventType] ?? 'standard'

      // ── Persist job ────────────────────────────────────────────────────
      try {
        const jobId = crypto.randomUUID()

        // In shadow/dry_run mode, mark as suppressed immediately
        const effectiveStatus = (mode === 'shadow' || mode === 'dry_run')
          ? 'suppressed'
          : 'pending'

        try {
          await db.notificationJob.create({
            data: {
              id: jobId,
              locationId,
              eventType,
              subjectType,
              subjectId,
              status: effectiveStatus,
              currentAttempt: 0,
              maxAttempts: rule.retryMaxAttempts,
              dispatchOrigin,
              businessStage,
              executionStage: 'first_attempt',
              routingRuleId: rule.id,
              providerId: target.providerId,
              fallbackProviderId: rule.fallbackProviderId,
              targetType: rule.targetType,
              targetValue: target.targetValue,
              executionZone: 'any',
              contextSnapshot: contextSnapshot as any,
              messageTemplate: rule.messageTemplateId,
              messageRendered,
              policySnapshot: policySnapshot as any,
              ruleExplainSnapshot: {
                ruleId: rule.id,
                rulePriority: rule.priority,
                conditionsEvaluated: true,
                criticality,
              } as any,
              subjectVersion,
              isProbe,
              sourceSystem,
              sourceEventId,
              sourceEventVersion,
              idempotencyKey,
              correlationId,
              notificationEngine: 'v1',
            },
          })
        } catch (insertErr: any) {
          // PostgreSQL unique violation (23505) — treat as dedup, not error
          if (insertErr?.code === 'P2002' || insertErr?.meta?.code === '23505' || String(insertErr?.code) === '23505') {
            log.debug({ sourceEventId, idempotencyKey }, 'Source-event dedup caught via unique constraint')
            result.deduplicated++
            continue
          }
          throw insertErr
        }

        if (effectiveStatus === 'suppressed') {
          result.suppressed++
        } else {
          result.jobsEnqueued++
          result.jobIds.push(jobId)

          // ── Emit Postgres NOTIFY for worker ──────────────────────────
          try {
            await db.$executeRawUnsafe(`SELECT pg_notify('notification_jobs', $1)`, jobId)
          } catch (notifyErr) {
            // NOTIFY failure is non-fatal — worker poll will catch it
            log.warn({ err: notifyErr, jobId }, 'Failed to emit NOTIFY for notification job')
          }
        }
      } catch (err) {
        log.error(
          { err, locationId, eventType, sourceEventId },
          'Failed to enqueue notification job'
        )
        result.errors++

        // Critical event enqueue rule: if enqueue fails for critical events,
        // fire fallback direct Twilio SMS
        if (criticality === 'critical') {
          log.error(
            { locationId, eventType, subjectId, targetValue: target.targetValue },
            'CRITICAL: Notification job enqueue failed for critical event — manual repair needed'
          )
          // Phase 2 will add direct Twilio fallback here
        }
      }
    }

    // ── Stop on stopProcessingAfterMatch ─────────────────────────────────
    if (rule.stopProcessingAfterMatch) {
      break
    }
  }

  return result
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

/**
 * Clear the routing rules cache (call after rule updates).
 */
export function clearRoutingRulesCache(): void {
  rulesCache.clear()
}
