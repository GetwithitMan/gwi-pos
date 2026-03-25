/**
 * Notification Repository
 *
 * Raw SQL helpers for the worker hot path.
 * Uses $queryRawUnsafe / $executeRawUnsafe for performance-critical operations.
 * All returns are typed.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { createChildLogger } from '@/lib/logger'
import type { JobStatus, TerminalResult, AttemptResult } from './types'

const log = createChildLogger('notification-repo')

// ─── Typed Row Shapes ───────────────────────────────────────────────────────

export interface ClaimedJob {
  id: string
  locationId: string
  eventType: string
  subjectType: string
  subjectId: string
  status: string
  currentAttempt: number
  maxAttempts: number
  dispatchOrigin: string
  businessStage: string
  executionStage: string
  routingRuleId: string | null
  providerId: string
  fallbackProviderId: string | null
  targetType: string
  targetValue: string
  executionZone: string
  contextSnapshot: Record<string, unknown>
  messageTemplate: string | null
  messageRendered: string | null
  policySnapshot: Record<string, unknown>
  subjectVersion: number
  isProbe: boolean
  sourceSystem: string
  sourceEventId: string
  idempotencyKey: string
  correlationId: string
  parentJobId: string | null
  notificationEngine: string
  createdAt: Date
}

export interface JobRow {
  id: string
  status: string
  currentAttempt: number
  maxAttempts: number
  providerId: string
  fallbackProviderId: string | null
  targetType: string
  targetValue: string
  policySnapshot: Record<string, unknown>
  createdAt: Date
}

// ─── Claim ──────────────────────────────────────────────────────────────────

/**
 * Claim up to `batchSize` pending jobs using FOR UPDATE SKIP LOCKED.
 * Returns claimed jobs ready for processing.
 */
export async function claimJobs(
  prisma: PrismaClient,
  workerId: string,
  executionZone: string,
  batchSize: number = 5,
  processingTimeoutSeconds: number = 120
): Promise<ClaimedJob[]> {
  const now = new Date()
  const timeoutAt = new Date(now.getTime() + processingTimeoutSeconds * 1000)

  // Single query: SELECT + UPDATE in CTE with SKIP LOCKED
  const rows = await prisma.$queryRawUnsafe<ClaimedJob[]>(`
    WITH claimable AS (
      SELECT "id"
      FROM "NotificationJob"
      WHERE "status" = 'pending'
        AND "availableAt" <= $1
        AND ("executionZone" = 'any' OR "executionZone" = $2)
      ORDER BY "availableAt" ASC
      LIMIT $3
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "NotificationJob" nj
    SET
      "status" = 'claimed',
      "claimedByWorkerId" = $4,
      "claimedAt" = $1,
      "processingTimeoutAt" = $5,
      "updatedAt" = $1
    FROM claimable
    WHERE nj."id" = claimable."id"
    RETURNING
      nj."id", nj."locationId", nj."eventType", nj."subjectType", nj."subjectId",
      nj."status", nj."currentAttempt", nj."maxAttempts", nj."dispatchOrigin",
      nj."businessStage", nj."executionStage", nj."routingRuleId", nj."providerId",
      nj."fallbackProviderId", nj."targetType", nj."targetValue", nj."executionZone",
      nj."contextSnapshot", nj."messageTemplate", nj."messageRendered",
      nj."policySnapshot", nj."subjectVersion", nj."isProbe", nj."sourceSystem",
      nj."sourceEventId", nj."idempotencyKey", nj."correlationId",
      nj."parentJobId", nj."notificationEngine", nj."createdAt"
  `, now, executionZone, batchSize, workerId, timeoutAt)

  if (rows.length > 0) {
    log.debug({ workerId, count: rows.length }, 'Claimed notification jobs')
  }

  return rows
}

// ─── Mark Processing ────────────────────────────────────────────────────────

/**
 * Transition a claimed job to processing state.
 */
export async function markProcessing(
  prisma: PrismaClient,
  jobId: string
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    UPDATE "NotificationJob"
    SET "status" = 'processing', "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = $1 AND "status" = 'claimed'
  `, jobId)
}

// ─── Complete ───────────────────────────────────────────────────────────────

/**
 * Mark a job as completed with a terminal result.
 */
export async function completeJob(
  prisma: PrismaClient,
  jobId: string,
  terminalResult: TerminalResult,
  messageRendered?: string
): Promise<void> {
  const now = new Date()
  await prisma.$executeRawUnsafe(`
    UPDATE "NotificationJob"
    SET
      "status" = 'completed',
      "terminalResult" = $2,
      "completedAt" = $3,
      "resolvedAt" = $3,
      "lastAttemptAt" = $3,
      "messageRendered" = COALESCE($4, "messageRendered"),
      "updatedAt" = $3
    WHERE "id" = $1
  `, jobId, terminalResult, now, messageRendered ?? null)
}

// ─── Fail ───────────────────────────────────────────────────────────────────

/**
 * Mark a job as failed with a terminal result.
 */
export async function failJob(
  prisma: PrismaClient,
  jobId: string,
  terminalResult: TerminalResult
): Promise<void> {
  const now = new Date()
  await prisma.$executeRawUnsafe(`
    UPDATE "NotificationJob"
    SET
      "status" = 'failed',
      "terminalResult" = $2,
      "completedAt" = $3,
      "resolvedAt" = $3,
      "lastAttemptAt" = $3,
      "updatedAt" = $3
    WHERE "id" = $1
  `, jobId, terminalResult, now)
}

// ─── Retry ──────────────────────────────────────────────────────────────────

/**
 * Schedule a job for retry with backoff delay.
 */
export async function scheduleRetry(
  prisma: PrismaClient,
  jobId: string,
  nextAttempt: number,
  delayMs: number,
  executionStage: string
): Promise<void> {
  const now = new Date()
  const availableAt = new Date(now.getTime() + delayMs)
  await prisma.$executeRawUnsafe(`
    UPDATE "NotificationJob"
    SET
      "status" = 'waiting_retry',
      "currentAttempt" = $2,
      "executionStage" = $3,
      "availableAt" = $4,
      "claimedByWorkerId" = NULL,
      "claimedAt" = NULL,
      "processingTimeoutAt" = NULL,
      "lastAttemptAt" = $5,
      "updatedAt" = $5
    WHERE "id" = $1
  `, jobId, nextAttempt, executionStage, availableAt, now)

  // Return to pending so worker can pick it up again
  await prisma.$executeRawUnsafe(`
    UPDATE "NotificationJob"
    SET "status" = 'pending'
    WHERE "id" = $1 AND "status" = 'waiting_retry' AND "availableAt" <= CURRENT_TIMESTAMP
  `, jobId)
}

/**
 * Make waiting_retry jobs available when their delay has elapsed.
 * Called periodically by the poll loop.
 */
export async function promoteRetryJobs(prisma: PrismaClient): Promise<number> {
  const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    WITH promoted AS (
      UPDATE "NotificationJob"
      SET "status" = 'pending', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "status" = 'waiting_retry' AND "availableAt" <= CURRENT_TIMESTAMP
      RETURNING 1
    )
    SELECT count(*)::bigint as count FROM promoted
  `)
  return Number(result[0]?.count ?? 0)
}

// ─── Dead Letter ────────────────────────────────────────────────────────────

/**
 * Move a job to dead letter queue after exhausting all retries.
 */
export async function deadLetterJob(
  prisma: PrismaClient,
  jobId: string,
  terminalResult: TerminalResult
): Promise<void> {
  const now = new Date()
  await prisma.$executeRawUnsafe(`
    UPDATE "NotificationJob"
    SET
      "status" = 'dead_letter',
      "terminalResult" = $2,
      "completedAt" = $3,
      "resolvedAt" = $3,
      "lastAttemptAt" = $3,
      "updatedAt" = $3
    WHERE "id" = $1
  `, jobId, terminalResult, now)
}

// ─── Suppress ───────────────────────────────────────────────────────────────

/**
 * Mark a job as suppressed (e.g., subject closed, target released).
 */
export async function suppressJob(
  prisma: PrismaClient,
  jobId: string,
  reason: TerminalResult
): Promise<void> {
  const now = new Date()
  await prisma.$executeRawUnsafe(`
    UPDATE "NotificationJob"
    SET
      "status" = 'suppressed',
      "terminalResult" = $2,
      "completedAt" = $3,
      "resolvedAt" = $3,
      "updatedAt" = $3
    WHERE "id" = $1
  `, jobId, reason, now)
}

// ─── Record Attempt ─────────────────────────────────────────────────────────

/**
 * Insert an immutable NotificationAttempt record.
 * rawResponse is truncated to 500 chars per blueprint invariant.
 */
export async function recordAttempt(
  prisma: PrismaClient,
  params: {
    id: string
    jobId: string
    providerId: string
    providerType: string
    targetType: string
    targetValue: string
    messageRendered: string | null
    attemptNumber: number
    startedAt: Date
    completedAt: Date | null
    result: AttemptResult
    latencyMs: number | null
    rawResponse: string | null
    providerMessageId: string | null
    providerStatusCode: string | null
    deliveryConfidence: string | null
    errorCode: string | null
    normalizedError: string | null
    isManual: boolean
    isRetry: boolean
  }
): Promise<void> {
  // Truncate rawResponse to 500 chars per blueprint
  const truncatedResponse = params.rawResponse
    ? params.rawResponse.substring(0, 500)
    : null

  await prisma.$executeRawUnsafe(`
    INSERT INTO "NotificationAttempt" (
      "id", "jobId", "providerId", "providerType", "targetType", "targetValue",
      "messageRendered", "attemptNumber", "startedAt", "completedAt", "result",
      "latencyMs", "rawResponse", "providerMessageId", "providerStatusCode",
      "deliveryConfidence", "errorCode", "normalizedError", "isManual", "isRetry"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
  `,
    params.id, params.jobId, params.providerId, params.providerType,
    params.targetType, params.targetValue, params.messageRendered,
    params.attemptNumber, params.startedAt, params.completedAt,
    params.result, params.latencyMs, truncatedResponse,
    params.providerMessageId, params.providerStatusCode,
    params.deliveryConfidence, params.errorCode, params.normalizedError,
    params.isManual, params.isRetry
  )
}

// ─── Stuck Job Recovery ─────────────────────────────────────────────────────

/**
 * Recover stuck jobs on worker boot.
 * Resets claimed/processing jobs whose processingTimeoutAt has passed.
 */
export async function recoverStuckJobs(prisma: PrismaClient): Promise<number> {
  const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    WITH recovered AS (
      UPDATE "NotificationJob"
      SET
        "status" = 'pending',
        "claimedByWorkerId" = NULL,
        "claimedAt" = NULL,
        "processingTimeoutAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "status" IN ('claimed', 'processing')
        AND "processingTimeoutAt" IS NOT NULL
        AND "processingTimeoutAt" < CURRENT_TIMESTAMP
      RETURNING 1
    )
    SELECT count(*)::bigint as count FROM recovered
  `)
  const count = Number(result[0]?.count ?? 0)
  if (count > 0) {
    log.info({ count }, 'Recovered stuck notification jobs')
  }
  return count
}

// ─── Workflow Dedup Check ───────────────────────────────────────────────────

/**
 * Check if an active (non-terminal) job exists with the same idempotency key.
 * Used for Layer 2 workflow dedup.
 */
export async function findActiveJobByIdempotencyKey(
  prisma: PrismaClient,
  idempotencyKey: string
): Promise<{ id: string; status: string } | null> {
  const rows = await prisma.$queryRawUnsafe<{ id: string; status: string }[]>(`
    SELECT "id", "status"
    FROM "NotificationJob"
    WHERE "idempotencyKey" = $1
      AND "status" NOT IN ('failed', 'dead_letter', 'cancelled')
    LIMIT 1
  `, idempotencyKey)

  return rows[0] ?? null
}

// ─── Source Event Dedup Check ───────────────────────────────────────────────

/**
 * Check if a job already exists for this source event.
 * Used for Layer 1 source dedup.
 */
export async function findJobBySourceEvent(
  prisma: PrismaClient,
  locationId: string,
  sourceSystem: string,
  sourceEventId: string,
  sourceEventVersion: number
): Promise<{ id: string } | null> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    SELECT "id"
    FROM "NotificationJob"
    WHERE "locationId" = $1
      AND "sourceSystem" = $2
      AND "sourceEventId" = $3
      AND "sourceEventVersion" = $4
    LIMIT 1
  `, locationId, sourceSystem, sourceEventId, sourceEventVersion)

  return rows[0] ?? null
}

// ─── Fallback Transition ────────────────────────────────────────────────────

/**
 * Transition a job to use its fallback provider.
 */
export async function transitionToFallback(
  prisma: PrismaClient,
  jobId: string,
  fallbackProviderId: string
): Promise<void> {
  const now = new Date()
  await prisma.$executeRawUnsafe(`
    UPDATE "NotificationJob"
    SET
      "status" = 'pending',
      "providerId" = $2,
      "executionStage" = 'fallback_1',
      "currentAttempt" = 0,
      "claimedByWorkerId" = NULL,
      "claimedAt" = NULL,
      "processingTimeoutAt" = NULL,
      "availableAt" = $3,
      "updatedAt" = $3
    WHERE "id" = $1
  `, jobId, fallbackProviderId, now)
}

// ─── Provider Health (Circuit Breaker) ──────────────────────────────────────

/**
 * Atomically increment consecutive failures and check circuit breaker threshold.
 * Returns the new failure count.
 */
export async function incrementProviderFailures(
  prisma: PrismaClient,
  providerId: string,
  openDurationMs: number = 60_000
): Promise<{ consecutiveFailures: number; circuitOpened: boolean }> {
  const openUntil = new Date(Date.now() + openDurationMs)

  const rows = await prisma.$queryRawUnsafe<{
    consecutiveFailures: number
    healthStatus: string
  }[]>(`
    UPDATE "NotificationProvider"
    SET
      "consecutiveFailures" = "consecutiveFailures" + 1,
      "healthStatus" = CASE
        WHEN "consecutiveFailures" + 1 >= 5 THEN 'circuit_open'
        WHEN "consecutiveFailures" + 1 >= 3 THEN 'degraded'
        ELSE "healthStatus"
      END,
      "circuitBreakerOpenUntil" = CASE
        WHEN "consecutiveFailures" + 1 >= 5 THEN $2
        ELSE "circuitBreakerOpenUntil"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = $1
    RETURNING "consecutiveFailures", "healthStatus"
  `, providerId, openUntil)

  const row = rows[0]
  if (!row) {
    return { consecutiveFailures: 0, circuitOpened: false }
  }

  return {
    consecutiveFailures: row.consecutiveFailures,
    circuitOpened: row.healthStatus === 'circuit_open',
  }
}

/**
 * Reset provider health after a successful send.
 */
export async function resetProviderHealth(
  prisma: PrismaClient,
  providerId: string
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    UPDATE "NotificationProvider"
    SET
      "consecutiveFailures" = 0,
      "healthStatus" = 'healthy',
      "circuitBreakerOpenUntil" = NULL,
      "lastHealthCheckAt" = CURRENT_TIMESTAMP,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = $1
  `, providerId)
}

/**
 * Check if a provider's circuit breaker is currently open.
 */
export async function isCircuitOpen(
  prisma: PrismaClient,
  providerId: string
): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{
    healthStatus: string
    circuitBreakerOpenUntil: Date | null
  }[]>(`
    SELECT "healthStatus", "circuitBreakerOpenUntil"
    FROM "NotificationProvider"
    WHERE "id" = $1
  `, providerId)

  const row = rows[0]
  if (!row) return false

  if (row.healthStatus === 'circuit_open' && row.circuitBreakerOpenUntil) {
    return new Date() < row.circuitBreakerOpenUntil
  }

  return false
}
