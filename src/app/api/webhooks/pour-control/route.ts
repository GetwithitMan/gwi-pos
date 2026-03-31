import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok, unauthorized } from '@/lib/api-response'
const log = createChildLogger('webhooks-pour-control')

// Validate webhook signature based on provider
function validateSignature(
  provider: string,
  body: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !secret) return false

  switch (provider) {
    case 'berg':
    case 'barvision':
    case 'tapwatcher':
    case 'generic': {
      // HMAC-SHA256 validation (common pattern)
      const expected = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex')
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      )
    }
    default:
      return false
  }
}

// POST: Receive pour events from hardware systems
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const provider = request.headers.get('x-pour-provider') || 'generic'
    const signature = request.headers.get('x-pour-signature')
    const webhookSecret = process.env.POUR_CONTROL_WEBHOOK_SECRET

    // Fail-closed: reject if webhook secret is not configured
    if (!webhookSecret) {
      return unauthorized('Webhook secret not configured')
    }

    // Validate signature against configured secret
    if (!validateSignature(provider, rawBody, signature, webhookSecret)) {
      return unauthorized('Invalid signature')
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(rawBody)
    } catch {
      return err('Invalid JSON')
    }

    const {
      locationId,
      menuItemId,
      employeeId,
      targetOz,
      actualOz,
      tapId,
      timestamp,
    } = body as {
      locationId?: string
      menuItemId?: string
      employeeId?: string
      targetOz?: number
      actualOz?: number
      tapId?: string
      timestamp?: string
    }

    if (!locationId || typeof targetOz !== 'number' || typeof actualOz !== 'number') {
      return err('locationId, targetOz, and actualOz are required')
    }

    // Load pour control settings for threshold
    const locationRows = await db.$queryRaw<Array<{ settings: Record<string, unknown> }>>`SELECT "settings" FROM "Location" WHERE "id" = ${locationId} LIMIT 1`
    if (locationRows.length === 0) {
      return notFound('Location not found')
    }

    const settings = locationRows[0]?.settings as Record<string, unknown> | undefined
    const pourSettings = settings?.pourControl as { overPourThresholdPercent?: number; trackWaste?: boolean; alertOnOverPour?: boolean } | undefined

    if (!pourSettings?.trackWaste && pourSettings?.trackWaste !== undefined) {
      // Pour tracking disabled — acknowledge but don't store
      return ok({ success: true, stored: false })
    }

    const threshold = pourSettings?.overPourThresholdPercent ?? 15
    const varianceOz = actualOz - targetOz
    const isOverPour = actualOz > targetOz * (1 + threshold / 100)

    // Validate menuItemId belongs to this location (tenant scoping — prevent cross-venue data leak)
    let validatedMenuItemId: string | null = menuItemId || null
    if (menuItemId) {
      const menuItemCheck = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "MenuItem" WHERE "id" = ${menuItemId} AND "locationId" = ${locationId} LIMIT 1`
      if (menuItemCheck.length === 0) {
        log.warn({ menuItemId, locationId }, 'MenuItem does not belong to location — ignoring menuItemId')
        validatedMenuItemId = null
      }
    }

    // Validate employeeId belongs to this location (tenant scoping)
    let validatedEmployeeId: string | null = employeeId || null
    if (employeeId) {
      const empCheck = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Employee" WHERE "id" = ${employeeId} AND "locationId" = ${locationId} LIMIT 1`
      if (empCheck.length === 0) {
        log.warn({ employeeId, locationId }, 'Employee does not belong to location — ignoring employeeId')
        validatedEmployeeId = null
      }
    }

    // Estimate waste cost (using tenant-scoped menuItemId)
    let wasteCost = 0
    if (isOverPour && validatedMenuItemId) {
      const items = await db.$queryRaw<Array<{ cost: number | null }>>`SELECT "cost" FROM "MenuItem" WHERE "id" = ${validatedMenuItemId} AND "locationId" = ${locationId} LIMIT 1`
      const itemCost = Number(items[0]?.cost ?? 0)
      if (itemCost > 0 && targetOz > 0) {
        wasteCost = Math.round((varianceOz * (itemCost / targetOz)) * 100) / 100
      }
    }

    const pouredAt = timestamp ? new Date(timestamp) : new Date()

    await db.$executeRaw`INSERT INTO "PourLog" ("locationId", "menuItemId", "employeeId", "targetOz", "actualOz", "varianceOz", "isOverPour", "wasteCost", "tapId", "source", "pouredAt")
       VALUES (${locationId}, ${validatedMenuItemId}, ${validatedEmployeeId}, ${targetOz}, ${actualOz}, ${varianceOz}, ${isOverPour}, ${wasteCost}, ${tapId || null}, ${provider}, ${pouredAt})`

    // Fire-and-forget: alert on over-pour if enabled
    if (isOverPour && pourSettings?.alertOnOverPour) {
      void import('@/lib/alert-service').then(({ dispatchAlert }) => {
        dispatchAlert({
          severity: 'HIGH',
          errorType: 'over_pour_hardware',
          category: 'pour_control',
          message: `Hardware over-pour: ${actualOz.toFixed(1)}oz / ${targetOz.toFixed(1)}oz target (${provider})${tapId ? ` tap:${tapId}` : ''}`,
          locationId,
          employeeId: employeeId || undefined,
          groupId: `over-pour-hw-${locationId}-${tapId || 'unknown'}`,
        })
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    return ok({ success: true, stored: true, isOverPour })
  } catch (error) {
    console.error('[webhooks/pour-control/POST] Error:', error)
    return err('Webhook processing failed', 500)
  }
}
