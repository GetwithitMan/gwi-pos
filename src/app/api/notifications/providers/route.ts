/**
 * GET /api/notifications/providers — List notification providers (masked config)
 * POST /api/notifications/providers — Create a provider with Zod validation per providerType
 *
 * Permission: GET = notifications.view_log, POST = notifications.manage_providers
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

export const dynamic = 'force-dynamic'

const VALID_PROVIDER_TYPES = ['jtech', 'lrs', 'retekess', 'sms', 'display', 'shelf', 'voice', 'kiosk']

const VALID_EXECUTION_ZONES = ['any', 'local_nuc', 'cloud']

/**
 * Default capabilities by provider type.
 */
const DEFAULT_CAPABILITIES: Record<string, Record<string, boolean>> = {
  jtech: {
    canPageNumeric: true,
    canPageAlpha: false,
    canSms: false,
    canVoice: false,
    canDisplayPush: false,
    canDeviceInventory: true,
    canDeviceAssignment: true,
    canDeviceRecall: false,
    canOutOfRangeDetection: false,
    canBatteryTelemetry: false,
    canTracking: false,
    canKioskDispense: false,
    canCancellation: false,
    canDeliveryConfirmation: false,
  },
  sms: {
    canPageNumeric: false,
    canPageAlpha: false,
    canSms: true,
    canVoice: false,
    canDisplayPush: false,
    canDeviceInventory: false,
    canDeviceAssignment: false,
    canDeviceRecall: false,
    canOutOfRangeDetection: false,
    canBatteryTelemetry: false,
    canTracking: false,
    canKioskDispense: false,
    canCancellation: false, // W12: Matches actual SMS provider implementation
    canDeliveryConfirmation: false, // W12: Matches actual SMS provider implementation
  },
  lrs: {
    canPageNumeric: true,
    canPageAlpha: true,
    canSms: false,
    canVoice: false,
    canDisplayPush: false,
    canDeviceInventory: true,
    canDeviceAssignment: true,
    canDeviceRecall: true,
    canOutOfRangeDetection: true,
    canBatteryTelemetry: true,
    canTracking: false,
    canKioskDispense: false,
    canCancellation: true,
    canDeliveryConfirmation: false,
  },
  retekess: {
    canPageNumeric: true,
    canPageAlpha: false,
    canSms: false,
    canVoice: false,
    canDisplayPush: false,
    canDeviceInventory: true,
    canDeviceAssignment: true,
    canDeviceRecall: false,
    canOutOfRangeDetection: false,
    canBatteryTelemetry: false,
    canTracking: false,
    canKioskDispense: false,
    canCancellation: false,
    canDeliveryConfirmation: false,
  },
  display: {
    canPageNumeric: false,
    canPageAlpha: false,
    canSms: false,
    canVoice: false,
    canDisplayPush: true,
    canDeviceInventory: false,
    canDeviceAssignment: false,
    canDeviceRecall: false,
    canOutOfRangeDetection: false,
    canBatteryTelemetry: false,
    canTracking: false,
    canKioskDispense: false,
    canCancellation: false,
    canDeliveryConfirmation: false,
  },
  voice: {
    canPageNumeric: false,
    canPageAlpha: false,
    canSms: false,
    canVoice: true,
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
  },
  shelf: {
    canPageNumeric: false,
    canPageAlpha: false,
    canSms: false,
    canVoice: false,
    canDisplayPush: true,
    canDeviceInventory: true,
    canDeviceAssignment: true,
    canDeviceRecall: false,
    canOutOfRangeDetection: false,
    canBatteryTelemetry: false,
    canTracking: false,
    canKioskDispense: true,
    canCancellation: false,
    canDeliveryConfirmation: false,
  },
  kiosk: {
    canPageNumeric: false,
    canPageAlpha: false,
    canSms: false,
    canVoice: false,
    canDisplayPush: false,
    canDeviceInventory: false,
    canDeviceAssignment: true,
    canDeviceRecall: false,
    canOutOfRangeDetection: false,
    canBatteryTelemetry: false,
    canTracking: false,
    canKioskDispense: true,
    canCancellation: false,
    canDeliveryConfirmation: false,
  },
}

/**
 * Required config fields per provider type.
 */
const REQUIRED_CONFIG_FIELDS: Record<string, string[]> = {
  jtech: ['siteCode', 'apiToken', 'deliveryMethod'],
  sms: ['twilioAccountSid', 'twilioAuthToken', 'twilioFromNumber'],
  lrs: ['apiKey', 'systemId'],
  retekess: ['localIp'],
  display: [],   // all fields have defaults or are optional
  voice: [],     // all fields have defaults
  shelf: ['controllerIp', 'controllerPort'],
  kiosk: ['kioskId'],
}

/**
 * Sensitive config keys that must never be returned in GET responses.
 */
const SENSITIVE_CONFIG_KEYS = [
  'apiKey', 'apiToken', 'authToken', 'twilioAuthToken', 'twilioAccountSid',
  'password', 'secret', 'siteCode', 'accessToken', 'privateKey',
]

/**
 * Mask sensitive fields in config for GET responses.
 * Never returns raw apiToken, siteCode, or other secrets.
 */
function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config }
  for (const key of SENSITIVE_CONFIG_KEYS) {
    if (masked[key] && typeof masked[key] === 'string') {
      const val = masked[key] as string
      masked[key] = val.length > 4 ? `****${val.slice(-4)}` : '****'
    }
  }
  return masked
}

/**
 * GET /api/notifications/providers
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const providers: any[] = await db.$queryRawUnsafe(
      `SELECT id, "locationId", "providerType", name, "isActive", "isDefault",
              priority, "executionZone", config, "configVersion",
              "lastValidatedAt", "lastValidationResult",
              capabilities, "healthStatus", "lastHealthCheckAt",
              "consecutiveFailures", "circuitBreakerOpenUntil",
              "createdAt", "updatedAt"
       FROM "NotificationProvider"
       WHERE "locationId" = $1 AND "deletedAt" IS NULL
       ORDER BY priority DESC, name ASC`,
      locationId
    )

    // Mask sensitive config fields — never return raw secrets
    const masked = providers.map(p => ({
      ...p,
      config: p.config ? maskConfig(p.config as Record<string, unknown>) : null,
    }))

    return NextResponse.json({ data: masked })
  } catch (error) {
    console.error('[Notification Providers] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch providers' }, { status: 500 })
  }
})

/**
 * POST /api/notifications/providers
 *
 * Body:
 *   providerType — string (required)
 *   name — string (required, display name)
 *   config — object (required, provider-specific configuration)
 *   isDefault — boolean (optional)
 *   priority — number (optional)
 *   executionZone — 'any' | 'local_nuc' | 'cloud' (optional)
 *   capabilities — object (optional, override default capabilities)
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_PROVIDERS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const {
      providerType,
      name,
      config,
      isDefault = false,
      priority = 0,
      executionZone = 'any',
      capabilities: customCapabilities,
    } = body

    // Validate required fields
    if (!providerType || !VALID_PROVIDER_TYPES.includes(providerType)) {
      return NextResponse.json(
        { error: `providerType must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` },
        { status: 400 }
      )
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!config || typeof config !== 'object') {
      return NextResponse.json({ error: 'config object is required' }, { status: 400 })
    }
    if (!VALID_EXECUTION_ZONES.includes(executionZone)) {
      return NextResponse.json(
        { error: `executionZone must be one of: ${VALID_EXECUTION_ZONES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate required config fields for provider type
    const requiredFields = REQUIRED_CONFIG_FIELDS[providerType] || []
    const missingFields = requiredFields.filter(f => !config[f])
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required config fields for ${providerType}: ${missingFields.join(', ')}` },
        { status: 400 }
      )
    }

    // Merge custom capabilities with defaults
    const capabilities = {
      ...(DEFAULT_CAPABILITIES[providerType] || {}),
      ...(customCapabilities || {}),
    }

    // If setting as default, unset any existing default for this location
    if (isDefault) {
      await db.$executeRawUnsafe(
        `UPDATE "NotificationProvider"
         SET "isDefault" = false, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "locationId" = $1 AND "isDefault" = true AND "deletedAt" IS NULL`,
        locationId
      )
    }

    const inserted: any[] = await db.$queryRawUnsafe(
      `INSERT INTO "NotificationProvider" (
        id, "locationId", "providerType", name, "isActive", "isDefault",
        priority, "executionZone", config, "configVersion",
        capabilities, "healthStatus",
        "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, true, $4,
        $5, $6, $7::jsonb, 1,
        $8::jsonb, 'unknown',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id, "locationId", "providerType", name, "isActive", "isDefault",
                priority, "executionZone", capabilities, "healthStatus", "createdAt"`,
      locationId,
      providerType,
      name.trim(),
      isDefault,
      priority,
      executionZone,
      JSON.stringify(config),
      JSON.stringify(capabilities)
    )

    const provider = inserted[0]

    // Audit log: notification_provider_created
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_provider_created',
        entityType: 'notification_provider',
        entityId: provider.id,
        details: {
          providerType,
          name: name.trim(),
          isDefault,
          priority,
          executionZone,
          configKeys: Object.keys(config),
        },
      },
    }).catch(console.error)

    // Return with masked config
    return NextResponse.json({
      data: {
        ...provider,
        config: maskConfig(config),
      },
    }, { status: 201 })
  } catch (error) {
    console.error('[Notification Providers] POST error:', error)
    return NextResponse.json({ error: 'Failed to create provider' }, { status: 500 })
  }
})
