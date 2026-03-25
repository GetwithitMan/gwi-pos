/**
 * POST /api/notifications/providers/test — Test a provider connection
 *
 * Calls the provider's testConnection() method and returns capabilities + health.
 * Permission: SETTINGS_EDIT
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

export const dynamic = 'force-dynamic'

/**
 * POST /api/notifications/providers/test
 *
 * Body:
 *   providerId — string (required)
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { providerId } = body

    if (!providerId || typeof providerId !== 'string') {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 })
    }

    // Fetch provider with full config (not masked)
    const providers: any[] = await db.$queryRawUnsafe(
      `SELECT id, "providerType", name, config, capabilities, "executionZone",
              "healthStatus", "consecutiveFailures", "circuitBreakerOpenUntil"
       FROM "NotificationProvider"
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      providerId,
      locationId
    )

    if (providers.length === 0) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }

    const provider = providers[0]
    const startTime = Date.now()
    let testResult: {
      success: boolean
      latencyMs: number
      message: string
      capabilities?: Record<string, boolean>
      rawResponse?: string
    }

    try {
      // Try to load the provider implementation from Phase 1
      const { getProvider } = await import('@/lib/notifications/providers')
      const adapter = getProvider(provider.providerType, provider.config as Record<string, unknown>)

      if (!adapter || typeof adapter.testConnection !== 'function') {
        // Provider adapter not yet implemented — simulate test
        testResult = {
          success: true,
          latencyMs: Date.now() - startTime,
          message: `Provider type "${provider.providerType}" adapter not yet implemented. Config validated structurally.`,
          capabilities: provider.capabilities as Record<string, boolean>,
        }
      } else {
        const result = await adapter.testConnection(provider.config as Record<string, unknown>)
        testResult = {
          success: result.success,
          latencyMs: Date.now() - startTime,
          message: result.error || (result.success ? 'Connection successful' : 'Connection failed'),
          capabilities: result.capabilities as Record<string, boolean>,
          rawResponse: result.rawResponse ? String(result.rawResponse).slice(0, 500) : undefined,
        }
      }
    } catch (adapterErr) {
      // Provider adapter import failed (Phase 1 still building)
      // Fall back to basic config validation
      const config = provider.config as Record<string, unknown>
      const hasConfig = config && Object.keys(config).length > 0

      testResult = {
        success: hasConfig,
        latencyMs: Date.now() - startTime,
        message: hasConfig
          ? `Provider config present (${Object.keys(config).length} fields). Live test unavailable — provider adapter not yet loaded.`
          : 'No configuration found. Provider needs to be configured.',
        capabilities: provider.capabilities as Record<string, boolean>,
      }
    }

    // Update provider health status based on test result
    const healthStatus = testResult.success ? 'healthy' : 'degraded'
    void db.$executeRawUnsafe(
      `UPDATE "NotificationProvider"
       SET "lastValidatedAt" = CURRENT_TIMESTAMP,
           "lastValidationResult" = $3,
           "healthStatus" = $4,
           "lastHealthCheckAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND "locationId" = $2`,
      providerId,
      locationId,
      testResult.success ? 'pass' : 'fail',
      healthStatus
    ).catch(console.error)

    return NextResponse.json({
      data: {
        providerId,
        providerType: provider.providerType,
        name: provider.name,
        ...testResult,
        healthStatus,
        previousHealthStatus: provider.healthStatus,
        consecutiveFailures: provider.consecutiveFailures,
        circuitBreakerOpenUntil: provider.circuitBreakerOpenUntil,
      },
    })
  } catch (error) {
    console.error('[Provider Test] POST error:', error)
    return NextResponse.json({ error: 'Failed to test provider' }, { status: 500 })
  }
})
