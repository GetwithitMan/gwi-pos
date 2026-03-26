import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'
import { createChildLogger } from '@/lib/logger'
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
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 })
    }

    // Validate signature against configured secret
    if (!validateSignature(provider, rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
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
      return NextResponse.json({ error: 'locationId, targetOz, and actualOz are required' }, { status: 400 })
    }

    // Load pour control settings for threshold
    const locationRows = await db.$queryRawUnsafe<Array<{ settings: Record<string, unknown> }>>(
      `SELECT "settings" FROM "Location" WHERE "id" = $1 LIMIT 1`,
      locationId,
    )
    if (locationRows.length === 0) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const settings = locationRows[0]?.settings as Record<string, unknown> | undefined
    const pourSettings = settings?.pourControl as { overPourThresholdPercent?: number; trackWaste?: boolean; alertOnOverPour?: boolean } | undefined

    if (!pourSettings?.trackWaste && pourSettings?.trackWaste !== undefined) {
      // Pour tracking disabled — acknowledge but don't store
      return NextResponse.json({ data: { success: true, stored: false } })
    }

    const threshold = pourSettings?.overPourThresholdPercent ?? 15
    const varianceOz = actualOz - targetOz
    const isOverPour = actualOz > targetOz * (1 + threshold / 100)

    // Estimate waste cost
    let wasteCost = 0
    if (isOverPour && menuItemId) {
      const items = await db.$queryRawUnsafe<Array<{ cost: number | null }>>(
        `SELECT "cost" FROM "MenuItem" WHERE "id" = $1 LIMIT 1`,
        menuItemId,
      )
      const itemCost = Number(items[0]?.cost ?? 0)
      if (itemCost > 0 && targetOz > 0) {
        wasteCost = Math.round((varianceOz * (itemCost / targetOz)) * 100) / 100
      }
    }

    const pouredAt = timestamp ? new Date(timestamp) : new Date()

    await db.$executeRawUnsafe(
      `INSERT INTO "PourLog" ("locationId", "menuItemId", "employeeId", "targetOz", "actualOz", "varianceOz", "isOverPour", "wasteCost", "tapId", "source", "pouredAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      locationId,
      menuItemId || null,
      employeeId || null,
      targetOz,
      actualOz,
      varianceOz,
      isOverPour,
      wasteCost,
      tapId || null,
      provider,
      pouredAt,
    )

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

    return NextResponse.json({ data: { success: true, stored: true, isOverPour } })
  } catch (error) {
    console.error('[webhooks/pour-control/POST] Error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
