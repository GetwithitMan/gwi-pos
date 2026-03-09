import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { issueCellularToken } from '@/lib/cellular-auth'

const bodySchema = z.object({
  deviceId: z.string().min(1),
  nonce: z.string().min(1),
  deviceFingerprint: z.string().min(1),
})

/**
 * GET /api/auth/cellular-exchange
 * Diagnostic: checks if CELLULAR_TOKEN_SECRET is loaded and crypto works.
 * Safe to call — no side effects. Remove after debugging.
 */
export async function GET() {
  try {
    const secret = process.env.CELLULAR_TOKEN_SECRET
    if (!secret) {
      return NextResponse.json({ error: 'CELLULAR_TOKEN_SECRET not set', envKeys: Object.keys(process.env).filter(k => k.includes('CELLULAR') || k.includes('TOKEN') || k.includes('SECRET')).sort() }, { status: 500 })
    }

    // Test that Web Crypto HMAC works
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const testSig = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode('test')
    )

    return NextResponse.json({
      status: 'ok',
      secretLength: secret.length,
      keyType: key.type,
      sigBytes: new Uint8Array(testSig).length,
      mcUrl: process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com',
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

/**
 * POST /api/auth/cellular-exchange
 *
 * Exchanges a pairing nonce for a cellular JWT.
 * Called by PAX devices after pairing via Mission Control.
 *
 * No auth required — the nonce IS the auth credential.
 * The nonce is verified against Mission Control, which returns
 * the terminalId/locationId/venueSlug bound to that pairing.
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { deviceId, nonce, deviceFingerprint } = parsed.data

    // Verify the nonce with Mission Control
    const mcUrl = process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com'
    const claimKey = process.env.CELLULAR_CLAIM_KEY || ''

    let mcResponse: Response
    try {
      mcResponse = await fetch(`${mcUrl}/api/fleet/cellular/verify-nonce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cellular-claim-key': claimKey,
        },
        body: JSON.stringify({ deviceId, nonce }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      console.error('[cellular-exchange] MC fetch failed:', error)
      return NextResponse.json(
        { error: 'Failed to verify nonce with Mission Control' },
        { status: 502 }
      )
    }

    if (!mcResponse.ok) {
      const errorBody = await mcResponse.text().catch(() => 'unknown')
      console.error(`[cellular-exchange] MC returned ${mcResponse.status}: ${errorBody}`)
      return NextResponse.json(
        { error: `Nonce verification failed: ${mcResponse.status}` },
        { status: mcResponse.status }
      )
    }

    const mcResult = (await mcResponse.json()) as {
      data: {
        valid: boolean
        terminalId: string
        locationId: string
        venueSlug: string
        deviceFingerprint: string
      }
    }

    const mcData = mcResult.data

    // Verify device fingerprint matches what MC has on record
    if (deviceFingerprint !== mcData.deviceFingerprint) {
      console.error(JSON.stringify({
        event: 'cellular_exchange_fingerprint_mismatch',
        deviceId,
        expected: mcData.deviceFingerprint,
        received: deviceFingerprint,
        timestamp: new Date().toISOString(),
      }))
      return NextResponse.json(
        { error: 'Device fingerprint mismatch' },
        { status: 401 }
      )
    }

    // Issue a cellular JWT
    let token: string
    try {
      token = await issueCellularToken(
        mcData.terminalId,
        mcData.locationId,
        mcData.venueSlug,
        deviceFingerprint,
        'CELLULAR_ROAMING'
      )
    } catch (issueError) {
      console.error('[cellular-exchange] Token issuance failed:', issueError)
      const msg = issueError instanceof Error ? issueError.message : 'Token issuance failed'
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    return NextResponse.json({ token })
  } catch (error) {
    console.error('[cellular-exchange] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
