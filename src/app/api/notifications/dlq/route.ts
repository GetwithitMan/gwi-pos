/**
 * DLQ (Dead Letter Queue) Management
 *
 * GET  /api/notifications/dlq — List dead-letter jobs with pagination/filtering
 * POST /api/notifications/dlq — Retry a dead-letter job (creates new job with admin_replay origin)
 * PATCH /api/notifications/dlq — Suppress/resolve a dead-letter job
 *
 * Permission: notifications.replay_dlq
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import crypto from 'crypto'
import { createChildLogger } from '@/lib/logger'
import { err, notFound } from '@/lib/api-response'
const log = createChildLogger('notifications-dlq')

export const dynamic = 'force-dynamic'

/**
 * GET — List dead-letter jobs
 *
 * Query params:
 *   providerId — filter by provider
 *   eventType  — filter by event type
 *   startDate  — ISO date string
 *   endDate    — ISO date string
 *   page       — page number (default 1)
 *   limit      — page size (default 20, max 100)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_REPLAY_DLQ)
    if (!auth.authorized) return err(auth.error, auth.status)

    const { searchParams } = new URL(request.url)
    const providerId = searchParams.get('providerId')
    const eventType = searchParams.get('eventType')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const offset = (page - 1) * limit

    // Build WHERE clauses dynamically
    const conditions: string[] = ['"locationId" = $1', 'status = \'dead_letter\'']
    const params: any[] = [locationId]
    let paramIdx = 2

    if (providerId) {
      conditions.push(`"providerId" = $${paramIdx++}`)
      params.push(providerId)
    }
    if (eventType) {
      conditions.push(`"eventType" = $${paramIdx++}`)
      params.push(eventType)
    }
    if (startDate) {
      const start = new Date(startDate)
      if (!isNaN(start.getTime())) {
        conditions.push(`"createdAt" >= $${paramIdx++}`)
        params.push(start)
      }
    }
    if (endDate) {
      const end = new Date(endDate)
      if (!isNaN(end.getTime())) {
        conditions.push(`"createdAt" < $${paramIdx++}`)
        params.push(end)
      }
    }

    const whereClause = conditions.join(' AND ')

    // Count + fetch in parallel
    const [countRows, jobRows] = await Promise.all([
      db.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM "NotificationJob" WHERE ${whereClause}`,
        ...params
      ),
      db.$queryRawUnsafe<Array<{
        id: string
        eventType: string
        subjectType: string
        subjectId: string
        providerId: string
        targetType: string
        targetValue: string
        terminalResult: string | null
        currentAttempt: number
        maxAttempts: number
        dispatchOrigin: string
        businessStage: string
        sourceEventId: string
        correlationId: string
        resolvedAt: Date | null
        resolvedByEmployeeId: string | null
        createdAt: Date
        lastAttemptAt: Date | null
      }>>(
        `SELECT id, "eventType", "subjectType", "subjectId", "providerId",
                "targetType", "targetValue", "terminalResult", "currentAttempt",
                "maxAttempts", "dispatchOrigin", "businessStage", "sourceEventId",
                "correlationId", "resolvedAt", "resolvedByEmployeeId",
                "createdAt", "lastAttemptAt"
         FROM "NotificationJob"
         WHERE ${whereClause}
         ORDER BY "createdAt" DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        ...params, limit, offset
      ),
    ])

    const totalCount = Number(countRows[0]?.count ?? 0)
    const totalPages = Math.ceil(totalCount / limit)

    const jobs = jobRows.map(j => ({
      id: j.id,
      eventType: j.eventType,
      subjectType: j.subjectType,
      subjectId: j.subjectId,
      providerId: j.providerId,
      targetType: j.targetType,
      targetValue: j.targetValue,
      terminalResult: j.terminalResult,
      currentAttempt: j.currentAttempt,
      maxAttempts: j.maxAttempts,
      dispatchOrigin: j.dispatchOrigin,
      businessStage: j.businessStage,
      sourceEventId: j.sourceEventId,
      correlationId: j.correlationId,
      resolvedAt: j.resolvedAt?.toISOString() ?? null,
      resolvedByEmployeeId: j.resolvedByEmployeeId,
      createdAt: j.createdAt.toISOString(),
      lastAttemptAt: j.lastAttemptAt?.toISOString() ?? null,
    }))

    return NextResponse.json({
      data: jobs,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
      },
    })
  } catch (error) {
    console.error('[DLQ] GET error:', error)
    return err('Failed to fetch dead-letter jobs', 500)
  }
})

/**
 * POST — Retry a dead-letter job
 *
 * Body:
 *   jobId — string (required)
 *
 * Creates a new job with:
 *   - dispatchOrigin: 'admin_replay'
 *   - unique sourceEventId: 'admin_replay:{originalJobId}:{uuid}'
 *   - status: 'pending'
 *   - currentAttempt: 0
 *   - correlationId: same as original (links retry chain)
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_REPLAY_DLQ)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { jobId } = body

    if (!jobId || typeof jobId !== 'string') {
      return err('jobId is required')
    }

    // Fetch the original dead-letter job
    const originalJobs = await db.$queryRawUnsafe<Array<{
      id: string
      locationId: string
      eventType: string
      subjectType: string
      subjectId: string
      maxAttempts: number
      businessStage: string
      executionStage: string
      routingRuleId: string | null
      providerId: string
      fallbackProviderId: string | null
      targetType: string
      targetValue: string
      executionZone: string
      contextSnapshot: any
      messageTemplate: string | null
      policySnapshot: any
      ruleExplainSnapshot: any
      subjectVersion: number
      sourceSystem: string
      correlationId: string
      notificationEngine: string
      status: string
    }>>(
      `SELECT id, "locationId", "eventType", "subjectType", "subjectId",
              "maxAttempts", "businessStage", "executionStage",
              "routingRuleId", "providerId", "fallbackProviderId",
              "targetType", "targetValue", "executionZone",
              "contextSnapshot", "messageTemplate", "policySnapshot",
              "ruleExplainSnapshot", "subjectVersion", "sourceSystem",
              "correlationId", "notificationEngine", status
       FROM "NotificationJob"
       WHERE id = $1 AND "locationId" = $2`,
      jobId, locationId
    )

    if (originalJobs.length === 0) {
      return notFound('Job not found')
    }

    const original = originalJobs[0]

    if (original.status !== 'dead_letter') {
      return err('Only dead_letter jobs can be retried')
    }

    // Generate unique source event ID for replay
    const replayUuid = crypto.randomUUID()
    const newSourceEventId = `admin_replay:${original.id}:${replayUuid}`

    // Compute idempotency key — unique for replay
    const idempotencyKey = crypto.createHash('sha256')
      .update(`${locationId}${original.eventType}${original.subjectId}${original.targetType}${original.targetValue}${original.businessStage}:replay:${replayUuid}`)
      .digest('hex')

    // Create a new job as a retry of the dead-letter job
    const newJobId = crypto.randomUUID()

    await db.$executeRawUnsafe(
      `INSERT INTO "NotificationJob" (
        id, "locationId", "eventType", "subjectType", "subjectId",
        status, "currentAttempt", "maxAttempts", "dispatchOrigin",
        "businessStage", "executionStage", "routingRuleId",
        "providerId", "fallbackProviderId", "targetType", "targetValue",
        "availableAt", "executionZone", "contextSnapshot",
        "messageTemplate", "policySnapshot", "ruleExplainSnapshot",
        "subjectVersion", "sourceSystem", "sourceEventId", "sourceEventVersion",
        "idempotencyKey", "correlationId", "parentJobId",
        "notificationEngine", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        'pending', 0, $6, 'admin_replay',
        $7, 'first_attempt', $8,
        $9, $10, $11, $12,
        NOW(), $13, $14::jsonb,
        $15, $16::jsonb, $17::jsonb,
        $18, $19, $20, 1,
        $21, $22, $23,
        $24, NOW(), NOW()
      )`,
      newJobId,
      locationId,
      original.eventType,
      original.subjectType,
      original.subjectId,
      original.maxAttempts,
      original.businessStage,
      original.routingRuleId,
      original.providerId,
      original.fallbackProviderId,
      original.targetType,
      original.targetValue,
      original.executionZone,
      JSON.stringify(original.contextSnapshot),
      original.messageTemplate,
      JSON.stringify(original.policySnapshot),
      JSON.stringify(original.ruleExplainSnapshot),
      original.subjectVersion,
      original.sourceSystem,
      newSourceEventId,
      idempotencyKey,
      original.correlationId,
      original.id,
      original.notificationEngine,
    )

    // Audit log: notification_dlq_replay
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_dlq_replay',
        entityType: 'notification_job',
        entityId: original.id,
        details: {
          originalJobId: original.id,
          newJobId,
          eventType: original.eventType,
          subjectType: original.subjectType,
          subjectId: original.subjectId,
          targetType: original.targetType,
          targetValue: original.targetValue,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: {
        newJobId,
        originalJobId: original.id,
        sourceEventId: newSourceEventId,
        dispatchOrigin: 'admin_replay',
        correlationId: original.correlationId,
      },
      message: 'Dead-letter job replayed successfully',
    })
  } catch (error) {
    console.error('[DLQ] POST error:', error)
    return err('Failed to retry dead-letter job', 500)
  }
})

/**
 * PATCH — Suppress/resolve a dead-letter job
 *
 * Body:
 *   jobId — string (required)
 *   action — 'suppress' | 'resolve' (required)
 */
export const PATCH = withVenue(async function PATCH(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_REPLAY_DLQ)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { jobId, action } = body

    if (!jobId || typeof jobId !== 'string') {
      return err('jobId is required')
    }

    if (action !== 'suppress' && action !== 'resolve') {
      return err('action must be "suppress" or "resolve"')
    }

    // Verify job exists and is dead_letter
    const jobs = await db.$queryRawUnsafe<Array<{ id: string; status: string }>>(
      `SELECT id, status FROM "NotificationJob"
       WHERE id = $1 AND "locationId" = $2`,
      jobId, locationId
    )

    if (jobs.length === 0) {
      return notFound('Job not found')
    }

    if (jobs[0].status !== 'dead_letter') {
      return err('Only dead_letter jobs can be suppressed/resolved')
    }

    // W7: "resolve" should use 'suppressed' (a valid terminal state), not 'cancelled'
    const terminalResult = 'suppressed'
    const newStatus = action === 'suppress' ? 'suppressed' : 'completed'

    await db.$executeRawUnsafe(
      `UPDATE "NotificationJob"
       SET "resolvedAt" = NOW(),
           "resolvedByEmployeeId" = $3,
           "terminalResult" = $4,
           status = $5,
           "updatedAt" = NOW()
       WHERE id = $1 AND "locationId" = $2`,
      jobId,
      locationId,
      auth.employee.id,
      terminalResult,
      newStatus,
    )

    // Audit log: notification_dlq_resolved (suppress/resolve)
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_dlq_resolved',
        entityType: 'notification_job',
        entityId: jobId,
        details: {
          jobId,
          dlqAction: action,
          terminalResult,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: {
        jobId,
        action,
        resolvedAt: new Date().toISOString(),
        resolvedByEmployeeId: auth.employee.id,
      },
      message: `Dead-letter job ${action}d successfully`,
    })
  } catch (error) {
    console.error('[DLQ] PATCH error:', error)
    return err('Failed to update dead-letter job', 500)
  }
})
