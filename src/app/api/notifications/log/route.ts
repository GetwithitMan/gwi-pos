/**
 * GET /api/notifications/log — Notification log search/filter
 *
 * Search notification jobs with filters:
 *   orderId      — find all notifications for an order
 *   pagerNumber  — find by pager number (targetValue)
 *   eventType    — filter by event type
 *   status       — filter by job status
 *   providerId   — filter by provider
 *   startDate    — ISO date (range start)
 *   endDate      — ISO date (range end)
 *   page         — pagination (default 1)
 *   limit        — page size (default 20, max 100)
 *
 * Returns jobs grouped by correlationId to show attempt chains.
 *
 * Permission: notifications.view_log
 * Rate limited: max 30 requests per minute per employee
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

// Rate limiter (per employee, 30/min)
import { createRateLimiter } from '@/lib/rate-limiter'

const limiter = createRateLimiter({ maxAttempts: 30, windowMs: 60_000 })

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Rate limit
    if (!limiter.check(auth.employee.id).allowed) {
      return err('Rate limit exceeded. Max 30 requests per minute.', 429)
    }

    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('orderId')
    const pagerNumber = searchParams.get('pagerNumber')
    const eventType = searchParams.get('eventType')
    const status = searchParams.get('status')
    const providerId = searchParams.get('providerId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const offset = (page - 1) * limit

    // Build WHERE clauses
    const conditions: string[] = ['"locationId" = $1']
    const params: any[] = [locationId]
    let paramIdx = 2

    if (orderId) {
      conditions.push(`"subjectType" = 'order' AND "subjectId" = $${paramIdx++}`)
      params.push(orderId)
    }
    if (pagerNumber) {
      conditions.push(`"targetValue" = $${paramIdx++}`)
      params.push(pagerNumber)
    }
    if (eventType) {
      conditions.push(`"eventType" = $${paramIdx++}`)
      params.push(eventType)
    }
    if (status) {
      conditions.push(`status = $${paramIdx++}`)
      params.push(status)
    }
    if (providerId) {
      conditions.push(`"providerId" = $${paramIdx++}`)
      params.push(providerId)
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

    // Count + fetch jobs
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
        status: string
        currentAttempt: number
        maxAttempts: number
        terminalResult: string | null
        dispatchOrigin: string
        businessStage: string
        executionStage: string
        providerId: string
        fallbackProviderId: string | null
        targetType: string
        targetValue: string
        messageRendered: string | null
        correlationId: string
        parentJobId: string | null
        sourceEventId: string
        createdAt: Date
        completedAt: Date | null
        lastAttemptAt: Date | null
      }>>(
        `SELECT id, "eventType", "subjectType", "subjectId", status,
                "currentAttempt", "maxAttempts", "terminalResult",
                "dispatchOrigin", "businessStage", "executionStage",
                "providerId", "fallbackProviderId", "targetType", "targetValue",
                "messageRendered", "correlationId", "parentJobId",
                "sourceEventId", "createdAt", "completedAt", "lastAttemptAt"
         FROM "NotificationJob"
         WHERE ${whereClause}
         ORDER BY "createdAt" DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        ...params, limit, offset
      ),
    ])

    const totalCount = Number(countRows[0]?.count ?? 0)
    const totalPages = Math.ceil(totalCount / limit)

    // Fetch attempts for these jobs
    const jobIds = jobRows.map(j => j.id)
    let attempts: Array<{
      id: string
      jobId: string
      providerId: string
      providerType: string
      attemptNumber: number
      result: string
      latencyMs: number | null
      errorCode: string | null
      normalizedError: string | null
      startedAt: Date
      completedAt: Date | null
      isRetry: boolean
    }> = []

    if (jobIds.length > 0) {
      // Build IN clause with indexed params
      const inPlaceholders = jobIds.map((_, i) => `$${i + 1}`).join(', ')
      attempts = await db.$queryRawUnsafe(
        `SELECT id, "jobId", "providerId", "providerType",
                "attemptNumber", result, "latencyMs",
                "errorCode", "normalizedError", "startedAt",
                "completedAt", "isRetry"
         FROM "NotificationAttempt"
         WHERE "jobId" IN (${inPlaceholders})
         ORDER BY "attemptNumber" ASC`,
        ...jobIds
      )
    }

    // Group attempts by jobId
    const attemptsByJob = new Map<string, typeof attempts>()
    for (const attempt of attempts) {
      const list = attemptsByJob.get(attempt.jobId) || []
      list.push(attempt)
      attemptsByJob.set(attempt.jobId, list)
    }

    // Group jobs by correlationId to show attempt chains
    const jobsWithAttempts = jobRows.map(j => ({
      id: j.id,
      eventType: j.eventType,
      subjectType: j.subjectType,
      subjectId: j.subjectId,
      status: j.status,
      currentAttempt: j.currentAttempt,
      maxAttempts: j.maxAttempts,
      terminalResult: j.terminalResult,
      dispatchOrigin: j.dispatchOrigin,
      businessStage: j.businessStage,
      executionStage: j.executionStage,
      providerId: j.providerId,
      fallbackProviderId: j.fallbackProviderId,
      targetType: j.targetType,
      targetValue: j.targetValue,
      messageRendered: j.messageRendered,
      correlationId: j.correlationId,
      parentJobId: j.parentJobId,
      sourceEventId: j.sourceEventId,
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt?.toISOString() ?? null,
      lastAttemptAt: j.lastAttemptAt?.toISOString() ?? null,
      attempts: (attemptsByJob.get(j.id) || []).map(a => ({
        id: a.id,
        providerId: a.providerId,
        providerType: a.providerType,
        attemptNumber: a.attemptNumber,
        result: a.result,
        latencyMs: a.latencyMs,
        errorCode: a.errorCode,
        normalizedError: a.normalizedError,
        startedAt: a.startedAt.toISOString(),
        completedAt: a.completedAt?.toISOString() ?? null,
        isRetry: a.isRetry,
      })),
    }))

    return NextResponse.json({
      data: jobsWithAttempts,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
      },
    })
  } catch (error) {
    console.error('[Notification Log] GET error:', error)
    return err('Failed to search notification log', 500)
  }
})
