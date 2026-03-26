/**
 * GET /api/notifications/providers/[id] — Single provider detail (masked config)
 * PUT /api/notifications/providers/[id] — Update provider config + name + isActive
 * DELETE /api/notifications/providers/[id] — Soft-delete (set deletedAt, check no active routing rules)
 *
 * Permission: GET = notifications.view_log, PUT/DELETE = notifications.manage_providers
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { clearRoutingRulesCache } from '@/lib/notifications/dispatcher'

export const dynamic = 'force-dynamic'

// ─── Sensitive key masking (mirrors providers/route.ts) ─────────────────────

const SENSITIVE_CONFIG_KEYS = [
  'apiKey', 'apiToken', 'authToken', 'twilioAuthToken', 'twilioAccountSid',
  'password', 'secret', 'siteCode', 'accessToken', 'privateKey',
]

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

// ─── Per-provider Zod schemas for PUT validation ────────────────────────────

const JTechConfigSchema = z.object({
  deliveryMethod: z.enum(['cloud_alert', 'direct_sms', 'local_http']),
  siteCode: z.string().min(1),
  apiToken: z.string().min(1),
  localIp: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Must be a valid IP address').optional(),
  localPort: z.number().default(80),
  defaultPagerType: z.number().min(1).max(2).default(2),
  defaultBaudRate: z.number().min(0).max(1).default(1),
  defaultBeepPattern: z.number().min(1).max(8).default(3),
})

const RetekessConfigSchema = z.object({
  localIp: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Must be a valid IP address'),
  localPort: z.number().default(80),
  protocol: z.enum(['http', 'serial']).default('http'),
  defaultPagerType: z.number().min(1).max(2).default(1),
})

const SmsConfigSchema = z.object({
  twilioAccountSid: z.string().min(1),
  twilioAuthToken: z.string().min(1),
  twilioFromNumber: z.string().min(1),
})

const LrsConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
})

// Fallback: accept any object for provider types that don't have strict schemas yet
const GenericConfigSchema = z.record(z.string(), z.unknown())

const CONFIG_SCHEMAS: Record<string, z.ZodType<any>> = {
  jtech: JTechConfigSchema,
  retekess: RetekessConfigSchema,
  sms: SmsConfigSchema,
  lrs: LrsConfigSchema,
  display: GenericConfigSchema,
  voice: GenericConfigSchema,
  shelf: GenericConfigSchema,
  kiosk: GenericConfigSchema,
}

const VALID_EXECUTION_ZONES = ['any', 'local_nuc', 'cloud']

// ─── GET /api/notifications/providers/[id] ──────────────────────────────────

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId
    )

    if (providers.length === 0) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }

    const provider = providers[0]

    return NextResponse.json({
      data: {
        ...provider,
        config: provider.config ? maskConfig(provider.config as Record<string, unknown>) : null,
      },
    })
  } catch (error) {
    console.error('[Notification Provider] GET [id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch provider' }, { status: 500 })
  }
})

// ─── PUT /api/notifications/providers/[id] ──────────────────────────────────

export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_PROVIDERS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Fetch existing provider
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT id, "providerType", name, config, "isActive", "isDefault",
              priority, "executionZone", "configVersion"
       FROM "NotificationProvider"
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId
    )

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }

    const provider = existing[0]
    const body = await request.json()

    const {
      name,
      config,
      isActive,
      isDefault,
      priority,
      executionZone,
      capabilities: customCapabilities,
    } = body

    // Validate name if provided
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
    }

    // Validate executionZone if provided
    if (executionZone !== undefined && !VALID_EXECUTION_ZONES.includes(executionZone)) {
      return NextResponse.json(
        { error: `executionZone must be one of: ${VALID_EXECUTION_ZONES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate config with Zod schema for the provider type
    let validatedConfig = provider.config
    let newConfigVersion = provider.configVersion

    if (config !== undefined) {
      if (typeof config !== 'object' || config === null) {
        return NextResponse.json({ error: 'config must be an object' }, { status: 400 })
      }

      const schema = CONFIG_SCHEMAS[provider.providerType]
      if (schema) {
        const parseResult = schema.safeParse(config)
        if (!parseResult.success) {
          return NextResponse.json(
            { error: `Invalid config for ${provider.providerType}: ${parseResult.error.message}` },
            { status: 400 }
          )
        }
        validatedConfig = parseResult.data
      } else {
        validatedConfig = config
      }
      newConfigVersion = (provider.configVersion || 1) + 1
    }

    // If setting as default, unset any existing default for this location
    if (isDefault === true) {
      await db.$executeRawUnsafe(
        `UPDATE "NotificationProvider"
         SET "isDefault" = false, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "locationId" = $1 AND "isDefault" = true AND id != $2 AND "deletedAt" IS NULL`,
        locationId,
        id
      )
    }

    // Build SET clause dynamically
    const setClauses: string[] = ['"updatedAt" = CURRENT_TIMESTAMP']
    const values: any[] = []
    let paramIndex = 1

    if (name !== undefined) {
      setClauses.push(`name = $${paramIndex}`)
      values.push(name.trim())
      paramIndex++
    }

    if (config !== undefined) {
      setClauses.push(`config = $${paramIndex}::jsonb`)
      values.push(JSON.stringify(validatedConfig))
      paramIndex++
      setClauses.push(`"configVersion" = $${paramIndex}`)
      values.push(newConfigVersion)
      paramIndex++
    }

    if (isActive !== undefined) {
      setClauses.push(`"isActive" = $${paramIndex}`)
      values.push(Boolean(isActive))
      paramIndex++
    }

    if (isDefault !== undefined) {
      setClauses.push(`"isDefault" = $${paramIndex}`)
      values.push(Boolean(isDefault))
      paramIndex++
    }

    if (priority !== undefined) {
      setClauses.push(`priority = $${paramIndex}`)
      values.push(Number(priority))
      paramIndex++
    }

    if (executionZone !== undefined) {
      setClauses.push(`"executionZone" = $${paramIndex}`)
      values.push(executionZone)
      paramIndex++
    }

    if (customCapabilities !== undefined) {
      setClauses.push(`capabilities = $${paramIndex}::jsonb`)
      values.push(JSON.stringify(customCapabilities))
      paramIndex++
    }

    // Reset validation timestamps on config change
    if (config !== undefined) {
      setClauses.push(`"lastValidatedAt" = NULL`)
      setClauses.push(`"lastValidationResult" = NULL`)
    }

    const updated: any[] = await db.$queryRawUnsafe(
      `UPDATE "NotificationProvider"
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex} AND "locationId" = $${paramIndex + 1} AND "deletedAt" IS NULL
       RETURNING id, "locationId", "providerType", name, "isActive", "isDefault",
                 priority, "executionZone", config, "configVersion",
                 capabilities, "healthStatus", "createdAt", "updatedAt"`,
      ...values,
      id,
      locationId
    )

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Provider not found or already deleted' }, { status: 404 })
    }

    const result = updated[0]

    // Clear routing rules cache on provider config change
    clearRoutingRulesCache()

    // Audit log: notification_provider_updated
    const changedFields = Object.keys(body).filter(k => body[k] !== undefined)
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_provider_updated',
        entityType: 'notification_provider',
        entityId: id,
        details: {
          providerType: provider.providerType,
          changedFields,
          configChanged: config !== undefined,
          newConfigVersion: config !== undefined ? newConfigVersion : undefined,
        },
      },
    }).catch(console.error)

    return NextResponse.json({
      data: {
        ...result,
        config: result.config ? maskConfig(result.config as Record<string, unknown>) : null,
      },
    })
  } catch (error) {
    console.error('[Notification Provider] PUT [id] error:', error)
    return NextResponse.json({ error: 'Failed to update provider' }, { status: 500 })
  }
})

// ─── DELETE /api/notifications/providers/[id] ───────────────────────────────

export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_PROVIDERS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Check provider exists
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT id, "providerType", name
       FROM "NotificationProvider"
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId
    )

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }

    const provider = existing[0]

    // Check for active routing rules referencing this provider
    const activeRules: any[] = await db.$queryRawUnsafe(
      `SELECT id, "eventType"
       FROM "NotificationRoutingRule"
       WHERE ("providerId" = $1 OR "fallbackProviderId" = $1)
         AND "locationId" = $2
         AND "enabled" = true
         AND "deletedAt" IS NULL
       LIMIT 5`,
      id,
      locationId
    )

    if (activeRules.length > 0) {
      const ruleNames = activeRules.map((r: any) => r.eventType || r.id).join(', ')
      return NextResponse.json(
        {
          error: `Cannot delete provider: ${activeRules.length} active routing rule(s) reference it: ${ruleNames}. Deactivate or reassign those rules first.`,
        },
        { status: 409 }
      )
    }

    // Soft-delete
    await db.$executeRawUnsafe(
      `UPDATE "NotificationProvider"
       SET "deletedAt" = CURRENT_TIMESTAMP, "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId
    )

    // Clear routing rules cache
    clearRoutingRulesCache()

    // Audit log: notification_provider_deleted
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_provider_deleted',
        entityType: 'notification_provider',
        entityId: id,
        details: {
          providerType: provider.providerType,
          name: provider.name,
        },
      },
    }).catch(console.error)

    return NextResponse.json({ success: true, message: 'Provider deleted' })
  } catch (error) {
    console.error('[Notification Provider] DELETE [id] error:', error)
    return NextResponse.json({ error: 'Failed to delete provider' }, { status: 500 })
  }
})
