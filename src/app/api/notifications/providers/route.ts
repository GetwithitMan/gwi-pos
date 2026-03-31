/**
 * GET /api/notifications/providers — List notification providers (masked config)
 * POST /api/notifications/providers — Create a provider with Zod validation per providerType
 *
 * Permission: GET = notifications.view_log, POST = notifications.manage_providers
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { createChildLogger } from '@/lib/logger'
import { created, err, ok } from '@/lib/api-response'
const log = createChildLogger('notifications-providers')

export const dynamic = 'force-dynamic'

/**
 * Self-bootstrap: create notification tables if they don't exist.
 * Handles the case where MC schema sync hasn't pushed these tables yet.
 */
let tablesBootstrapped = false
async function ensureNotificationTables() {
  if (tablesBootstrapped) return
  try {
    await db.$executeRaw`SELECT 1 FROM "NotificationProvider" LIMIT 0`
    tablesBootstrapped = true
  } catch {
    // Table doesn't exist — create all notification tables
    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS "NotificationProvider" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "providerType" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "isDefault" BOOLEAN NOT NULL DEFAULT false,
        "priority" INTEGER NOT NULL DEFAULT 0,
        "executionZone" TEXT NOT NULL DEFAULT 'any',
        "config" JSONB NOT NULL,
        "configVersion" INTEGER NOT NULL DEFAULT 1,
        "lastValidatedAt" TIMESTAMP(3),
        "lastValidationResult" TEXT,
        "capabilities" JSONB NOT NULL,
        "healthStatus" TEXT NOT NULL DEFAULT 'healthy',
        "lastHealthCheckAt" TIMESTAMP(3),
        "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
        "circuitBreakerOpenUntil" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        CONSTRAINT "NotificationProvider_pkey" PRIMARY KEY ("id")
      )
    `
    await db.$executeRaw`CREATE INDEX IF NOT EXISTS "NotificationProvider_locationId_isActive_idx" ON "NotificationProvider" ("locationId", "isActive")`

    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS "NotificationRoutingRule" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "eventType" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "targetType" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "priority" INTEGER NOT NULL DEFAULT 0,
        "messageTemplateId" TEXT,
        "condFulfillmentMode" TEXT,
        "condHasPager" BOOLEAN,
        "condHasPhone" BOOLEAN,
        "condMinPartySize" INTEGER,
        "condOrderTypes" TEXT[],
        "condDuringBusinessHours" BOOLEAN,
        "retryMaxAttempts" INTEGER NOT NULL DEFAULT 2,
        "retryDelayMs" INTEGER NOT NULL DEFAULT 2000,
        "retryBackoffMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
        "retryOnTimeout" BOOLEAN NOT NULL DEFAULT false,
        "fallbackProviderId" TEXT,
        "escalateToStaff" BOOLEAN NOT NULL DEFAULT false,
        "alsoEmitDisplayProjection" BOOLEAN NOT NULL DEFAULT false,
        "stopProcessingAfterMatch" BOOLEAN NOT NULL DEFAULT false,
        "cooldownSeconds" INTEGER NOT NULL DEFAULT 0,
        "allowManualOverride" BOOLEAN NOT NULL DEFAULT true,
        "criticalityClass" TEXT NOT NULL DEFAULT 'standard',
        "effectiveStartAt" TIMESTAMP(3),
        "effectiveEndAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        CONSTRAINT "NotificationRoutingRule_pkey" PRIMARY KEY ("id")
      )
    `
    await db.$executeRaw`CREATE INDEX IF NOT EXISTS "NotificationRoutingRule_locationId_eventType_enabled_idx" ON "NotificationRoutingRule" ("locationId", "eventType", "enabled")`

    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS "NotificationDevice" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "deviceNumber" TEXT NOT NULL,
        "humanLabel" TEXT,
        "deviceType" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "assignedToSubjectType" TEXT,
        "assignedToSubjectId" TEXT,
        "assignedAt" TIMESTAMP(3),
        "releasedAt" TIMESTAMP(3),
        "returnedAt" TIMESTAMP(3),
        "batteryLevel" INTEGER,
        "lastSeenAt" TIMESTAMP(3),
        "lastSignalState" TEXT,
        "capcode" TEXT,
        "firmwareVersion" TEXT,
        "dockId" TEXT,
        "dockSlot" TEXT,
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        CONSTRAINT "NotificationDevice_pkey" PRIMARY KEY ("id")
      )
    `

    tablesBootstrapped = true
    log.info('Self-bootstrapped notification tables')
  }
}

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
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return err(auth.error, auth.status)

    await ensureNotificationTables()

    const providers: any[] = await db.$queryRaw`SELECT id, "locationId", "providerType", name, "isActive", "isDefault",
              priority, "executionZone", config, "configVersion",
              "lastValidatedAt", "lastValidationResult",
              capabilities, "healthStatus", "lastHealthCheckAt",
              "consecutiveFailures", "circuitBreakerOpenUntil",
              "createdAt", "updatedAt"
       FROM "NotificationProvider"
       WHERE "locationId" = ${locationId} AND "deletedAt" IS NULL
       ORDER BY priority DESC, name ASC`

    // Mask sensitive config fields — never return raw secrets
    const masked = providers.map(p => ({
      ...p,
      config: p.config ? maskConfig(p.config as Record<string, unknown>) : null,
    }))

    return ok(masked)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Notification Providers] GET error:', msg)
    // If the table doesn't exist yet (schema not synced), return empty data
    if (msg.includes('does not exist') || msg.includes('relation')) {
      return ok([])
    }
    return err(`Failed to fetch providers: ${msg}`, 500)
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
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_PROVIDERS)
    if (!auth.authorized) return err(auth.error, auth.status)

    await ensureNotificationTables()

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
      return err(`providerType must be one of: ${VALID_PROVIDER_TYPES.join(', ')}`)
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return err('name is required')
    }
    if (!config || typeof config !== 'object') {
      return err('config object is required')
    }
    if (!VALID_EXECUTION_ZONES.includes(executionZone)) {
      return err(`executionZone must be one of: ${VALID_EXECUTION_ZONES.join(', ')}`)
    }

    // Validate required config fields for provider type
    const requiredFields = REQUIRED_CONFIG_FIELDS[providerType] || []
    const missingFields = requiredFields.filter(f => !config[f])
    if (missingFields.length > 0) {
      return err(`Missing required config fields for ${providerType}: ${missingFields.join(', ')}`)
    }

    // Merge custom capabilities with defaults
    const capabilities = {
      ...(DEFAULT_CAPABILITIES[providerType] || {}),
      ...(customCapabilities || {}),
    }

    // If setting as default, unset any existing default for this location
    if (isDefault) {
      await db.$executeRaw`UPDATE "NotificationProvider"
         SET "isDefault" = false, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "locationId" = ${locationId} AND "isDefault" = true AND "deletedAt" IS NULL`
    }

    const inserted: any[] = await db.$queryRaw`INSERT INTO "NotificationProvider" (
        id, "locationId", "providerType", name, "isActive", "isDefault",
        priority, "executionZone", config, "configVersion",
        capabilities, "healthStatus",
        "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, ${locationId}, ${providerType}, ${name.trim()}, true, ${isDefault},
        ${priority}, ${executionZone}, ${JSON.stringify(config)}::jsonb, 1,
        ${JSON.stringify(capabilities)}::jsonb, 'unknown',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id, "locationId", "providerType", name, "isActive", "isDefault",
                priority, "executionZone", capabilities, "healthStatus", "createdAt"`

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
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Return with masked config
    return created({
        ...provider,
        config: maskConfig(config),
      })
  } catch (error) {
    console.error('[Notification Providers] POST error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return err(`Failed to create provider: ${msg}`, 500)
  }
})
