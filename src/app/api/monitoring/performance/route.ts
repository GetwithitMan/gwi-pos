/**
 * POST /api/monitoring/performance
 *
 * Log slow operations to the PerformanceLog table for monitoring.
 * Tracks operations that exceed their expected thresholds.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ============================================
// POST - Log Performance Issue
// ============================================

export const POST = withVenue(async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Validate required fields
    if (!body.operation || !body.duration || !body.threshold || !body.locationId) {
      return NextResponse.json(
        { error: 'Missing required fields: operation, duration, threshold, locationId' },
        { status: 400 }
      )
    }

    // Validate numbers
    if (typeof body.duration !== 'number' || typeof body.threshold !== 'number') {
      return NextResponse.json(
        { error: 'duration and threshold must be numbers (milliseconds)' },
        { status: 400 }
      )
    }

    // Create performance log
    const performanceLog = await db.performanceLog.create({
      data: {
        locationId: body.locationId,
        operation: body.operation,
        duration: body.duration,
        threshold: body.threshold,
        context: body.context ? JSON.stringify(body.context) : undefined,
        stackTrace: body.stackTrace,
        path: body.path,
        employeeId: body.employeeId,
      },
    })

    // Log warnings for severe performance issues
    const exceededBy = body.duration - body.threshold
    const percentOver = (exceededBy / body.threshold) * 100

    if (percentOver > 100) { // More than 2x threshold
      console.warn(`⚠️ SEVERE PERFORMANCE ISSUE:`, {
        id: performanceLog.id,
        operation: body.operation,
        duration: `${body.duration}ms`,
        threshold: `${body.threshold}ms`,
        exceededBy: `${exceededBy}ms (${percentOver.toFixed(0)}% over)`,
      })

      // TODO Phase 4: Send alert for severe performance degradation
      // if (percentOver > 200) {
      //   await sendPerformanceAlert(performanceLog)
      // }
    }

    return NextResponse.json({
      success: true,
      id: performanceLog.id,
      exceededBy,
      percentOver: percentOver.toFixed(1),
    })

  } catch (error) {
    console.error('[Monitoring API] Failed to log performance issue:', error)

    return NextResponse.json(
      { error: 'Failed to log performance issue' },
      { status: 500 }
    )
  }
})

// ============================================
// Helper: Performance Monitor Utility
// ============================================

/**
 * Utility function for wrapping operations with performance monitoring
 *
 * Usage:
 * ```typescript
 * import { monitorPerformance } from '@/app/api/monitoring/performance/route'
 *
 * const result = await monitorPerformance(
 *   'Database: findMany orders',
 *   2000, // threshold in ms
 *   locationId,
 *   async () => {
 *     return await db.order.findMany({ where: { locationId } })
 *   }
 * )
 * ```
 */
export async function monitorPerformance<T>(
  operation: string,
  threshold: number,
  locationId: string,
  fn: () => Promise<T>,
  context?: any
): Promise<T> {
  const startTime = Date.now()

  try {
    const result = await fn()
    const duration = Date.now() - startTime

    // Only log if threshold exceeded
    if (duration > threshold) {
      // Fire-and-forget logging (don't block the response)
      fetch('/api/monitoring/performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation,
          duration,
          threshold,
          locationId,
          context,
        }),
      }).catch(err => {
        console.error('Failed to log performance issue:', err)
      })
    }

    return result
  } catch (error) {
    const duration = Date.now() - startTime

    // Log performance issue even if operation failed
    fetch('/api/monitoring/performance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: `${operation} (FAILED)`,
        duration,
        threshold,
        locationId,
        context: {
          ...context,
          error: error instanceof Error ? error.message : String(error),
        },
      }),
    }).catch(err => {
      console.error('Failed to log performance issue:', err)
    })

    throw error
  }
}
