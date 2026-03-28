/**
 * Notification Worker
 *
 * Processes notification jobs asynchronously:
 * - LISTEN/NOTIFY primary with 5s poll fallback
 * - FOR UPDATE SKIP LOCKED claim
 * - Pre-send revalidation (subject state, target active, provider health, device status)
 * - Rate limit check (in-memory token bucket, Redis when available)
 * - Circuit breaker (atomic increment + RETURNING, error classification per blueprint)
 * - Stuck job recovery on boot
 * - Graceful shutdown (SIGTERM -> drain 60s)
 * - Worker role filtering (executionZone)
 */

import crypto from 'crypto'
import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'
import {
  claimJobs,
  markProcessing,
  completeJob,
  failJob,
  scheduleRetry,
  deadLetterJob,
  suppressJob,
  recordAttempt,
  recoverStuckJobs,
  promoteRetryJobs,
  incrementProviderFailures,
  resetProviderHealth,
  isCircuitOpen,
  transitionToFallback,
} from './notification-repository'
import { getProvider } from './providers'
import type {
  ClaimedJob,
} from './notification-repository'
import type {
  ProviderType,
  TargetType,
  AttemptResult,
  NormalizedErrorCode,
  NotificationPolicySnapshot,
  ExecutionStage,
} from './types'

const log = createChildLogger('notification-worker')

// ─── Worker Config ──────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000       // 5s fallback poll
const BATCH_SIZE = 5                 // Jobs per claim cycle
const PROCESSING_TIMEOUT_S = 120     // 2 min processing timeout
const DRAIN_TIMEOUT_MS = 60_000      // 60s graceful shutdown drain
const RETRY_PROMOTE_INTERVAL_MS = 10_000 // 10s check for promotable retry jobs

// ─── Rate Limit (in-memory token bucket) ────────────────────────────────────

interface TokenBucket {
  tokens: number
  lastRefill: number
  maxTokens: number
  refillRate: number // tokens per second
}

const rateLimitBuckets = new Map<string, TokenBucket>()

function checkRateLimit(providerId: string, maxPerSecond: number = 10): boolean {
  let bucket = rateLimitBuckets.get(providerId)
  const now = Date.now()

  if (!bucket) {
    bucket = { tokens: maxPerSecond, lastRefill: now, maxTokens: maxPerSecond, refillRate: maxPerSecond }
    rateLimitBuckets.set(providerId, bucket)
  }

  // Refill tokens
  const elapsed = (now - bucket.lastRefill) / 1000
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate)
  bucket.lastRefill = now

  if (bucket.tokens < 1) {
    return false // Rate limited
  }

  bucket.tokens -= 1
  return true
}

// ─── Pre-send Revalidation ──────────────────────────────────────────────────

/**
 * Pre-send revalidation checks per blueprint Section 7.3.
 * Returns null if ok, or an AttemptResult reason to suppress.
 */
async function revalidateSubject(
  job: ClaimedJob
): Promise<AttemptResult | null> {
  const { subjectType, subjectId, eventType } = job

  // staff_alert: never suppress
  if (eventType === 'staff_alert') return null

  if (subjectType === 'order') {
    try {
      // eslint-disable-next-line no-restricted-syntax -- cross-tenant pre-send revalidation, no locationId available in worker context
      const order = await db.order.findUnique({
        where: { id: subjectId },
        select: { status: true },
      })
      if (!order) return 'skipped_subject_closed'

      const status = order.status as string

      switch (eventType) {
        case 'order_ready':
        case 'order_delayed':
        case 'order_recalled':
        case 'expo_recall': {
          const allowed = ['in_progress', 'open', 'sent']
          if (!allowed.includes(status)) return 'skipped_subject_closed'
          break
        }
        case 'order_cancelled': {
          // Always send cancellation
          break
        }
        case 'order_picked_up':
        case 'order_created':
        case 'curbside_arrived': {
          const suppress = ['paid', 'voided', 'cancelled', 'closed']
          if (suppress.includes(status)) return 'skipped_subject_closed'
          break
        }
      }
    } catch {
      // If we can't check, allow the send
    }
  }

  if (subjectType === 'waitlist_entry') {
    try {
      // WaitlistEntry is a raw SQL table — query directly
      const rows = await db.$queryRawUnsafe<{ status: string }[]>(
        `SELECT "status" FROM "WaitlistEntry" WHERE "id" = $1 LIMIT 1`,
        subjectId
      )
      if (rows.length === 0) return 'skipped_subject_closed'

      const status = rows[0].status

      switch (eventType) {
        case 'waitlist_ready':
        case 'waitlist_second_call':
        case 'waitlist_final_warning': {
          const allowed = ['waiting', 'notified']
          if (!allowed.includes(status)) return 'skipped_subject_closed'
          break
        }
        case 'waitlist_expired':
        case 'waitlist_added': {
          // Always send
          break
        }
      }
    } catch {
      // If we can't check, allow the send
    }
  }

  return null
}

/**
 * Check if the target assignment is still active.
 */
async function revalidateTarget(job: ClaimedJob): Promise<AttemptResult | null> {
  try {
    const activeTargets = await (db as any).notificationTargetAssignment.findFirst({
      where: {
        locationId: job.locationId,
        subjectType: job.subjectType,
        subjectId: job.subjectId,
        targetType: job.targetType,
        targetValue: job.targetValue,
        status: 'active',
      },
      select: { id: true },
    })
    // If no assignment exists, check context — target may not use assignments
    if (!activeTargets) {
      // For phone targets from context, skip assignment check
      if (job.targetType === 'phone_sms' || job.targetType === 'phone_voice') {
        return null
      }
      return 'skipped_target_released'
    }
  } catch {
    // If we can't check, allow the send
  }
  return null
}

// ─── Error Classification (per blueprint Section 7.5) ───────────────────────

function classifyError(errorCode: string | undefined): {
  normalized: NormalizedErrorCode
  shouldTripCircuit: boolean
  shouldRetry: boolean
} {
  switch (errorCode) {
    case 'AUTH_FAILED':
      return { normalized: 'AUTH_FAILED', shouldTripCircuit: true, shouldRetry: false }
    case 'RATE_LIMITED':
      return { normalized: 'RATE_LIMITED', shouldTripCircuit: false, shouldRetry: true }
    case 'NETWORK_ERROR':
      return { normalized: 'NETWORK_ERROR', shouldTripCircuit: true, shouldRetry: true }
    case 'DEVICE_NOT_FOUND':
      return { normalized: 'DEVICE_NOT_FOUND', shouldTripCircuit: false, shouldRetry: false }
    case 'TIMEOUT':
      return { normalized: 'TIMEOUT', shouldTripCircuit: false, shouldRetry: false }
    case 'VALIDATION_ERROR':
      return { normalized: 'VALIDATION_ERROR', shouldTripCircuit: false, shouldRetry: false }
    default:
      return { normalized: 'PROVIDER_ERROR', shouldTripCircuit: false, shouldRetry: true }
  }
}

function getNextExecutionStage(current: string, attempt: number): ExecutionStage {
  if (attempt === 1) return 'retry_1'
  if (attempt === 2) return 'retry_2'
  if (attempt === 3) return 'retry_3'
  return 'retry_3'
}

function computeRetryDelay(policy: NotificationPolicySnapshot, attempt: number): number {
  return Math.round(policy.retryDelayMs * Math.pow(policy.retryBackoffMultiplier, attempt - 1))
}

// ─── Fallback Target Resolution ─────────────────────────────────────────────

/**
 * When falling back from a pager provider to an SMS provider, the targetType
 * and targetValue must be re-resolved. A pager number ("12") is not a valid
 * SMS target — we need the customer's phone number from the context snapshot.
 *
 * Returns a targetOverride if channel types differ, or undefined to keep the
 * same target. Returns `{ failed: true }` if fallback cannot proceed (e.g.
 * no phone number available for SMS fallback).
 */
async function resolveFallbackTarget(
  job: ClaimedJob,
  fallbackProviderId: string
): Promise<{ targetType: string; targetValue: string } | 'no_target' | undefined> {
  // Only re-resolve if original target was a pager type
  const pagerTargetTypes = new Set(['guest_pager', 'staff_pager'])
  if (!pagerTargetTypes.has(job.targetType)) {
    return undefined // Same channel, no re-resolution needed
  }

  try {
    // Look up the fallback provider's capabilities
    const fallbackProvider = await (db as any).notificationProvider.findUnique({
      where: { id: fallbackProviderId },
      select: { capabilities: true },
    })
    if (!fallbackProvider) return undefined

    const caps = fallbackProvider.capabilities as Record<string, boolean> | null
    if (!caps) return undefined

    // If fallback provider can handle pager numbers, no re-resolution needed
    if (caps.canPageNumeric || caps.canPageAlpha) {
      return undefined
    }

    // Fallback provider is SMS-only (or voice) — resolve phone from context
    if (caps.canSms) {
      const ctx = job.contextSnapshot || {}
      const phone = (ctx.phone as string) || (ctx.customerPhone as string) || null
      if (!phone) {
        return 'no_target'
      }
      return { targetType: 'phone_sms', targetValue: phone }
    }

    if (caps.canVoice) {
      const ctx = job.contextSnapshot || {}
      const phone = (ctx.phone as string) || (ctx.customerPhone as string) || null
      if (!phone) {
        return 'no_target'
      }
      return { targetType: 'phone_voice', targetValue: phone }
    }
  } catch (err) {
    log.warn({ err, jobId: job.id, fallbackProviderId }, 'Failed to resolve fallback target — using original')
  }

  return undefined
}

// ─── Process Single Job ─────────────────────────────────────────────────────

async function processJob(job: ClaimedJob): Promise<void> {
  const policy = job.policySnapshot as unknown as NotificationPolicySnapshot

  // Mode check: shadow/dry_run should not reach here but safety net
  if (policy.notificationMode === 'shadow' || policy.notificationMode === 'dry_run') {
    await suppressJob(db as any, job.id, 'suppressed')
    return
  }

  // Mark as processing
  await markProcessing(db as any, job.id)

  // ── Pre-send revalidation ─────────────────────────────────────────────
  // 1. Subject lifecycle
  const subjectCheck = await revalidateSubject(job)
  if (subjectCheck) {
    await recordSkippedAttempt(job, subjectCheck)
    await suppressJob(db as any, job.id, 'suppressed')
    return
  }

  // 2. Target validity
  const targetCheck = await revalidateTarget(job)
  if (targetCheck) {
    await recordSkippedAttempt(job, targetCheck)
    await suppressJob(db as any, job.id, 'suppressed')
    return
  }

  // 3. Provider health (circuit breaker)
  const circuitOpen = await isCircuitOpen(db as any, job.providerId)
  if (circuitOpen && !job.isProbe) {
    await recordSkippedAttempt(job, 'skipped_circuit_open')
    // Try fallback if available
    if (job.fallbackProviderId) {
      const targetOverride = await resolveFallbackTarget(job, job.fallbackProviderId)
      if (targetOverride === 'no_target') {
        log.warn({ jobId: job.id }, 'No phone number available for SMS fallback — failing job')
        await failJob(db as any, job.id, 'failed')
        return
      }
      await transitionToFallback(db as any, job.id, job.fallbackProviderId, targetOverride)
      return
    }
    await failJob(db as any, job.id, 'failed')
    return
  }

  // 4. Rate limit
  if (!checkRateLimit(job.providerId)) {
    await recordSkippedAttempt(job, 'skipped_rate_limited')
    // Schedule short retry
    const nextAttempt = job.currentAttempt // Don't increment — rate limit is transient
    await scheduleRetry(db as any, job.id, nextAttempt, 2000, job.executionStage)
    return
  }

  // ── Send ──────────────────────────────────────────────────────────────
  const attemptId = crypto.randomUUID()
  const startedAt = new Date()

  try {
    // Get provider config
    const providerRecord = await (db as any).notificationProvider.findUnique({
      where: { id: job.providerId },
      select: { providerType: true, config: true },
    })

    if (!providerRecord) {
      log.error({ jobId: job.id, providerId: job.providerId }, 'Provider not found')
      await failJob(db as any, job.id, 'failed')
      return
    }

    const provider = getProvider(
      providerRecord.providerType as ProviderType,
      providerRecord.config as Record<string, unknown>
    )

    const sendResult = await provider.send({
      targetType: job.targetType as TargetType,
      targetValue: job.targetValue,
      message: job.messageRendered ?? '',
      providerId: job.providerId,
      config: providerRecord.config as Record<string, unknown>,
      metadata: job.contextSnapshot,
    })

    const completedAt = new Date()

    if (sendResult.success) {
      // Record successful attempt
      await recordAttempt(db as any, {
        id: attemptId,
        jobId: job.id,
        providerId: job.providerId,
        providerType: providerRecord.providerType,
        targetType: job.targetType,
        targetValue: job.targetValue,
        messageRendered: job.messageRendered,
        attemptNumber: job.currentAttempt + 1,
        startedAt,
        completedAt,
        result: 'success',
        latencyMs: sendResult.latencyMs,
        rawResponse: sendResult.rawResponse ?? null,
        providerMessageId: sendResult.providerMessageId ?? null,
        providerStatusCode: sendResult.providerStatusCode ?? null,
        deliveryConfidence: sendResult.deliveryConfidence ?? null,
        errorCode: null,
        normalizedError: null,
        isManual: job.dispatchOrigin === 'manual_override',
        isRetry: job.currentAttempt > 0,
      })

      // Complete the job
      await completeJob(db as any, job.id, 'delivered', job.messageRendered ?? undefined)

      // Reset provider health
      void resetProviderHealth(db as any, job.providerId).catch((err) => {
        log.warn({ err, providerId: job.providerId }, 'Failed to reset provider health')
      })
    } else {
      // Send failed
      const { normalized, shouldTripCircuit, shouldRetry } = classifyError(sendResult.errorCode)

      await recordAttempt(db as any, {
        id: attemptId,
        jobId: job.id,
        providerId: job.providerId,
        providerType: providerRecord.providerType,
        targetType: job.targetType,
        targetValue: job.targetValue,
        messageRendered: job.messageRendered,
        attemptNumber: job.currentAttempt + 1,
        startedAt,
        completedAt,
        result: 'provider_failure',
        latencyMs: sendResult.latencyMs,
        rawResponse: sendResult.rawResponse ?? null,
        providerMessageId: sendResult.providerMessageId ?? null,
        providerStatusCode: sendResult.providerStatusCode ?? null,
        deliveryConfidence: null,
        errorCode: sendResult.errorCode ?? null,
        normalizedError: normalized,
        isManual: job.dispatchOrigin === 'manual_override',
        isRetry: job.currentAttempt > 0,
      })

      // Trip circuit breaker if needed
      if (shouldTripCircuit) {
        const forceOpen = normalized === 'AUTH_FAILED'
        const openDuration = forceOpen ? 300_000 : 60_000
        void incrementProviderFailures(db as any, job.providerId, openDuration, forceOpen).catch((err) => {
          log.warn({ err, providerId: job.providerId }, 'Failed to increment provider failures')
        })
      }

      // Check retryOnTimeout policy override
      const effectiveShouldRetry = shouldRetry || (normalized === 'TIMEOUT' && policy.retryOnTimeout === true)

      // Retry or fail
      const nextAttempt = job.currentAttempt + 1
      if (effectiveShouldRetry && nextAttempt < job.maxAttempts) {
        const delayMs = computeRetryDelay(policy, nextAttempt)
        const nextStage = getNextExecutionStage(job.executionStage, nextAttempt)
        await scheduleRetry(db as any, job.id, nextAttempt, delayMs, nextStage)
      } else if (job.fallbackProviderId && job.executionStage !== 'fallback_1') {
        // Transition to fallback — re-resolve target if channel types differ
        const targetOverride = await resolveFallbackTarget(job, job.fallbackProviderId)
        if (targetOverride === 'no_target') {
          log.warn({ jobId: job.id }, 'No phone number available for SMS fallback — failing job')
          await failJob(db as any, job.id, 'failed')
        } else {
          await transitionToFallback(db as any, job.id, job.fallbackProviderId, targetOverride)
        }
      } else if (nextAttempt >= job.maxAttempts) {
        // Exhausted all retries — dead letter
        await deadLetterJob(db as any, job.id, 'failed')
      } else {
        await failJob(db as any, job.id, 'failed')
      }
    }
  } catch (err) {
    const completedAt = new Date()
    log.error({ err, jobId: job.id }, 'Unexpected error processing notification job')

    // Record error attempt
    await recordAttempt(db as any, {
      id: attemptId,
      jobId: job.id,
      providerId: job.providerId,
      providerType: 'unknown',
      targetType: job.targetType,
      targetValue: job.targetValue,
      messageRendered: job.messageRendered,
      attemptNumber: job.currentAttempt + 1,
      startedAt,
      completedAt,
      result: 'network_error',
      latencyMs: completedAt.getTime() - startedAt.getTime(),
      rawResponse: err instanceof Error ? err.message.substring(0, 500) : null,
      providerMessageId: null,
      providerStatusCode: null,
      deliveryConfidence: null,
      errorCode: 'UNKNOWN',
      normalizedError: 'UNKNOWN',
      isManual: false,
      isRetry: job.currentAttempt > 0,
    }).catch((recordErr) => {
      log.error({ err: recordErr, jobId: job.id }, 'Failed to record error attempt')
    })

    // Retry if possible
    const nextAttempt = job.currentAttempt + 1
    if (nextAttempt < job.maxAttempts) {
      const delayMs = computeRetryDelay(policy, nextAttempt)
      const nextStage = getNextExecutionStage(job.executionStage, nextAttempt)
      await scheduleRetry(db as any, job.id, nextAttempt, delayMs, nextStage)
    } else {
      await deadLetterJob(db as any, job.id, 'failed')
    }
  }
}

async function recordSkippedAttempt(job: ClaimedJob, result: AttemptResult): Promise<void> {
  try {
    await recordAttempt(db as any, {
      id: crypto.randomUUID(),
      jobId: job.id,
      providerId: job.providerId,
      providerType: 'skipped',
      targetType: job.targetType,
      targetValue: job.targetValue,
      messageRendered: null,
      attemptNumber: job.currentAttempt,
      startedAt: new Date(),
      completedAt: new Date(),
      result,
      latencyMs: 0,
      rawResponse: null,
      providerMessageId: null,
      providerStatusCode: null,
      deliveryConfidence: null,
      errorCode: null,
      normalizedError: null,
      isManual: false,
      isRetry: false,
    })
  } catch (err) {
    log.warn({ err, jobId: job.id }, 'Failed to record skipped attempt')
  }
}

// ─── Worker Loop ────────────────────────────────────────────────────────────

let isRunning = false
let isShuttingDown = false
let pollTimer: ReturnType<typeof setInterval> | null = null
let retryPromoteTimer: ReturnType<typeof setInterval> | null = null
let listenClient: any = null // pg client for LISTEN/NOTIFY

const workerId = `worker-${process.pid}-${crypto.randomUUID().substring(0, 8)}`

/**
 * Start the notification worker.
 * Call this once during NUC server startup.
 */
export async function startNotificationWorker(
  executionZone: string = 'any'
): Promise<void> {
  if (isRunning) {
    log.warn('Notification worker already running')
    return
  }

  isRunning = true
  isShuttingDown = false

  log.info({ workerId, executionZone }, 'Starting notification worker')

  // ── Stuck job recovery on boot ────────────────────────────────────────
  try {
    const recovered = await recoverStuckJobs(db as any)
    if (recovered > 0) {
      log.info({ recovered }, 'Recovered stuck jobs on boot')
    }
  } catch (err) {
    log.error({ err }, 'Failed to recover stuck jobs on boot')
  }

  // ── Setup LISTEN/NOTIFY ───────────────────────────────────────────────
  try {
    await setupListenNotify(executionZone)
  } catch (err) {
    log.warn({ err }, 'Failed to setup LISTEN/NOTIFY — falling back to poll only')
  }

  // ── Start poll fallback ───────────────────────────────────────────────
  pollTimer = setInterval(async () => {
    if (isShuttingDown) return
    try {
      await pollAndProcess(executionZone)
    } catch (err) {
      log.error({ err }, 'Poll cycle error')
    }
  }, POLL_INTERVAL_MS)
  pollTimer.unref()

  // ── Start retry promotion timer ───────────────────────────────────────
  retryPromoteTimer = setInterval(async () => {
    if (isShuttingDown) return
    try {
      const promoted = await promoteRetryJobs(db as any)
      if (promoted > 0) {
        log.debug({ promoted }, 'Promoted retry jobs to pending')
      }
    } catch (err) {
      log.warn({ err }, 'Failed to promote retry jobs')
    }
  }, RETRY_PROMOTE_INTERVAL_MS)
  retryPromoteTimer.unref()

  // ── Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = async () => {
    if (isShuttingDown) return
    isShuttingDown = true
    log.info({ workerId }, 'Notification worker shutting down (draining)...')

    if (pollTimer) clearInterval(pollTimer)
    if (retryPromoteTimer) clearInterval(retryPromoteTimer)

    // Close LISTEN client
    if (listenClient) {
      try {
        await listenClient.end()
      } catch { /* ignore */ }
    }

    // Wait for in-flight jobs to complete (up to drain timeout)
    const drainStart = Date.now()
    while (inFlightCount > 0 && Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (inFlightCount > 0) {
      log.warn({ inFlightCount }, 'Drain timeout reached — some jobs may be abandoned')
    }

    isRunning = false
    log.info({ workerId }, 'Notification worker stopped')
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

/**
 * Stop the notification worker.
 */
export async function stopNotificationWorker(): Promise<void> {
  isShuttingDown = true
  if (pollTimer) clearInterval(pollTimer)
  if (retryPromoteTimer) clearInterval(retryPromoteTimer)
  if (listenClient) {
    try {
      await listenClient.end()
    } catch { /* ignore */ }
  }
  isRunning = false
}

// ─── LISTEN/NOTIFY Setup ────────────────────────────────────────────────────

async function setupListenNotify(executionZone: string): Promise<void> {
  // Use raw pg client for LISTEN (Prisma doesn't support LISTEN)
  // We import pg dynamically since it might not be available in all environments
  try {
    const pg = await import('pg')
    const client = new pg.default.Client({
      connectionString: process.env.DATABASE_URL,
    })
    await client.connect()

    client.on('notification', (msg) => {
      if (msg.channel === 'notification_jobs' && !isShuttingDown) {
        // Trigger immediate poll on notification
        void pollAndProcess(executionZone).catch((err) => {
          log.error({ err }, 'NOTIFY-triggered poll error')
        })
      }
    })

    client.on('error', (err) => {
      log.warn({ err }, 'LISTEN client error — poll fallback still active')
    })

    await client.query('LISTEN notification_jobs')
    listenClient = client
    log.info('LISTEN/NOTIFY active for notification_jobs')
  } catch (err) {
    log.warn({ err }, 'Could not setup LISTEN/NOTIFY — poll-only mode')
  }
}

// ─── Poll and Process ───────────────────────────────────────────────────────

let inFlightCount = 0

async function pollAndProcess(executionZone: string): Promise<void> {
  if (isShuttingDown) return

  try {
    const jobs = await claimJobs(
      db as any,
      workerId,
      executionZone,
      BATCH_SIZE,
      PROCESSING_TIMEOUT_S
    )

    if (jobs.length === 0) return

    // Process jobs in parallel (bounded by batch size)
    inFlightCount += jobs.length
    await Promise.allSettled(
      jobs.map(async (job) => {
        try {
          await processJob(job)
        } catch (err) {
          log.error({ err, jobId: job.id }, 'Unhandled error processing job')
        } finally {
          inFlightCount--
        }
      })
    )
  } catch (err) {
    log.error({ err }, 'Failed to claim/process jobs')
  }
}

/**
 * Check if the worker is currently running.
 */
export function isWorkerRunning(): boolean {
  return isRunning
}
