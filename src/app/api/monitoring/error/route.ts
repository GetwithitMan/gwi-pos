/**
 * POST /api/monitoring/error
 *
 * Log errors to the ErrorLog table for monitoring and alerting.
 * Accepts errors from both frontend and backend sources.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchAlert } from '@/lib/alert-service'
import { withVenue } from '@/lib/with-venue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ============================================
// POST - Log Error
// ============================================

export const POST = withVenue(async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Validate required fields
    if (!body.severity || !body.errorType || !body.message) {
      return NextResponse.json(
        { error: 'Missing required fields: severity, errorType, message' },
        { status: 400 }
      )
    }

    // Validate severity
    const validSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    if (!validSeverities.includes(body.severity)) {
      return NextResponse.json(
        { error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate error type
    const validErrorTypes = [
      'PAYMENT', 'ORDER', 'API', 'FRONTEND', 'DATABASE',
      'NETWORK', 'BUSINESS_LOGIC', 'PERFORMANCE'
    ]
    if (!validErrorTypes.includes(body.errorType)) {
      return NextResponse.json(
        { error: `Invalid errorType. Must be one of: ${validErrorTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Check for duplicate/grouping (if groupId provided, increment count)
    if (body.groupId) {
      const existingError = await db.errorLog.findFirst({
        where: { groupId: body.groupId },
      })

      if (existingError) {
        // Update existing error with new occurrence
        await db.errorLog.update({
          where: { id: existingError.id },
          data: {
            occurrenceCount: existingError.occurrenceCount + 1,
            lastOccurred: new Date(),
          },
        })

        return NextResponse.json({
          success: true,
          id: existingError.id,
          grouped: true
        })
      }
    }

    // Generate groupId if not provided (hash of errorType + category + message)
    const groupId = body.groupId || generateGroupId(
      body.errorType,
      body.category || 'uncategorized',
      body.message
    )

    // Create error log
    const errorLog = await db.errorLog.create({
      data: {
        // Classification
        severity: body.severity,
        errorType: body.errorType,
        category: body.category || `${body.errorType.toLowerCase()}-error`,

        // Error Details
        message: body.message,
        stackTrace: body.stackTrace,
        errorCode: body.errorCode,

        // Context
        locationId: body.locationId,
        employeeId: body.employeeId,
        path: body.path || 'unknown',
        action: body.action || 'Unknown action',
        component: body.component,

        // Business Context
        orderId: body.orderId,
        tableId: body.tableId,
        paymentId: body.paymentId,
        customerId: body.customerId,

        // Technical Context
        userAgent: body.userAgent,
        browserInfo: body.browserInfo,
        requestBody: body.requestBody,
        responseBody: body.responseBody,
        queryParams: body.queryParams,

        // Performance
        responseTime: body.responseTime,

        // Grouping
        groupId,
        occurrenceCount: 1,
        firstOccurred: new Date(),
        lastOccurred: new Date(),

        // Status
        status: 'NEW',
        alertSent: false,
      },
    })

    // Dispatch alerts based on severity (Phase 4)
    // Fire-and-forget - don't block the response
    dispatchAlert({
      severity: body.severity,
      errorType: body.errorType,
      category: body.category || `${body.errorType.toLowerCase()}-error`,
      message: body.message,
      locationId: body.locationId,
      employeeId: body.employeeId,
      orderId: body.orderId,
      paymentId: body.paymentId,
      stackTrace: body.stackTrace,
      errorCode: body.errorCode,
      path: body.path,
      action: body.action,
      groupId: errorLog.groupId ?? undefined,
      errorLogId: errorLog.id,
    }).catch((err) => {
      // Don't let alert failures crash error logging
      console.error('[Monitoring] Failed to dispatch alert:', err)
    })

    // Still log critical errors to console for immediate visibility
    if (body.severity === 'CRITICAL') {
      console.error('🚨 CRITICAL ERROR LOGGED:', {
        id: errorLog.id,
        type: errorLog.errorType,
        message: errorLog.message,
        orderId: errorLog.orderId,
        paymentId: errorLog.paymentId,
      })
    }

    return NextResponse.json({
      success: true,
      id: errorLog.id,
      groupId: errorLog.groupId,
    })

  } catch (error) {
    // Don't let error logging crash
    console.error('[Monitoring API] Failed to log error:', error)

    return NextResponse.json(
      { error: 'Failed to log error to monitoring system' },
      { status: 500 }
    )
  }
})

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a consistent groupId for similar errors
 * This allows us to group errors and track occurrence counts
 */
function generateGroupId(errorType: string, category: string, message: string): string {
  // Create a simple hash (for grouping, doesn't need to be cryptographically secure)
  const str = `${errorType}:${category}:${message.slice(0, 100)}`
  let hash = 0

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }

  return `group_${Math.abs(hash).toString(36)}`
}
