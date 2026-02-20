import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { parseSettings, mergeWithDefaults } from '@/lib/settings'
import { getLocationSettings, invalidateLocationCache } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

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
  processor:   z.enum(['datacap', 'simulated']),
  environment: z.enum(['cert', 'production']),
  merchantId:  z.string().min(1).max(50),
  tokenKey:    z.string().min(32).max(100),
})

export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
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

    console.log(`[payment-config] Credentials updated — processor=${processor} env=${environment} mid=${merchantId.slice(0, 4)}…`)

    return NextResponse.json({ data: { updated: true, processor, environment } })
  } catch (error) {
    console.error('[payment-config] Failed to update payment config:', error)
    return NextResponse.json({ error: 'Failed to update payment config' }, { status: 500 })
  }
})
