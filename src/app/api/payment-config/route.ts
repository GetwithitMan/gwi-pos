import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { parseSettings, mergeWithDefaults } from '@/lib/settings'
import { getLocationSettings, invalidateLocationCache } from '@/lib/location-cache'
import { invalidatePaymentSettings } from '@/lib/payment-settings-cache'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { dispatchSettingsUpdated } from '@/lib/socket-dispatch'

/**
 * GET /api/payment-config
 *
 * Returns the current payment environment so the POS UI can show TEST MODE
 * badges without needing full settings access.
 */
export const GET = withVenue(async function GET() {
  try {
    const location = await db.location.findFirst({ select: { id: true, settings: true } })
    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }
    const settings = parseSettings(location.settings)
    const payments = settings.payments
    const isTestMode = payments.datacapEnvironment
      ? payments.datacapEnvironment === 'cert'
      : payments.testMode
    return NextResponse.json({
      data: {
        isTestMode,
        environment: payments.datacapEnvironment ?? (payments.testMode ? 'cert' : 'production'),
        processor: payments.processor,
      },
    })
  } catch (error) {
    console.error('[payment-config] GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch payment config' }, { status: 500 })
  }
})

/**
 * PUT /api/payment-config
 *
 * Internal-only endpoint — called by the NUC sync agent when it receives an
 * UPDATE_PAYMENT_CONFIG fleet command from Mission Control. No auth required
 * (the sync agent runs on localhost and the server is never internet-exposed).
 *
 * The sync agent RSA-decrypts the fleet command payload and POSTs the
 * plaintext credentials here. We write them into Location.settings.payments
 * using the three datacap* fields so helpers.ts can build a DatacapClient.
 *
 * Body: { processor, environment, merchantId, tokenKey }
 */

const PaymentConfigSchema = z.object({
  processor:   z.enum(['datacap']),
  environment: z.enum(['cert', 'production']),
  merchantId:  z.string().min(1).max(50),
  tokenKey:    z.string().min(32).max(100),
})

export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    // Security: require INTERNAL_API_SECRET or localhost origin
    // This endpoint is called by the NUC sync agent (localhost only) when it receives
    // an UPDATE_PAYMENT_CONFIG fleet command from Mission Control.
    const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '')
    const internalSecret = process.env.INTERNAL_API_SECRET
    if (internalSecret && apiKey !== internalSecret) {
      // Allow localhost for backward compatibility with sync agent
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || ''
      const isLocalhost = ['127.0.0.1', '::1', 'localhost'].includes(ip)
      if (!isLocalhost) {
        return NextResponse.json({ error: 'Unauthorized — internal API secret required' }, { status: 401 })
      }
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = PaymentConfigSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 }
      )
    }

    const { processor, environment, merchantId, tokenKey } = parsed.data

    const location = await db.location.findFirst({ select: { id: true } })
    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    // Deep-merge into existing settings so all other settings are preserved
    const current = parseSettings(await getLocationSettings(location.id))
    const updated = mergeWithDefaults({
      ...current,
      payments: {
        ...current.payments,
        processor,
        datacapMerchantId:  merchantId,
        datacapTokenKey:    tokenKey,
        datacapEnvironment: environment,
        // Keep testMode in sync for any code still reading it
        testMode: environment === 'cert',
      },
    })

    await db.location.update({
      where: { id: location.id },
      data: { settings: updated as object },
    })

    invalidateLocationCache(location.id)
    invalidatePaymentSettings(location.id)

    // Notify cloud sync + push upstream (fire-and-forget)
    void notifyDataChanged({ locationId: location.id, domain: 'settings', action: 'updated' })
    void pushUpstream()

    // Emit settings:updated so all terminals refresh payment configuration
    void dispatchSettingsUpdated(location.id, { changedKeys: ['payments'] }).catch(console.error)

    return NextResponse.json({ data: { updated: true, processor, environment } })
  } catch (error) {
    console.error('[payment-config] Failed to update payment config:', error)
    return NextResponse.json({ error: 'Failed to update payment config' }, { status: 500 })
  }
})
