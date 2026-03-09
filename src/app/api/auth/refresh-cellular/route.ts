import { NextRequest, NextResponse } from 'next/server'
import { refreshCellularToken, verifyCellularToken, verifyPlayIntegrity } from '@/lib/cellular-auth'

/**
 * POST /api/auth/refresh-cellular
 *
 * Refresh a cellular terminal JWT token.
 * Accepts current token in Authorization header.
 * Returns new token or 401/403 if revoked/expired/attestation-failed.
 *
 * Play Integrity:
 * - If `x-play-integrity-token` header is present, verify device attestation
 * - Reject if device does not MEET_DEVICE_INTEGRITY (rooted/non-certified)
 * - If header is absent, log warning but allow (gradual rollout)
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 })
    }

    // Verify old token is at least structurally valid for logging
    const oldPayload = await verifyCellularToken(token)

    // Play Integrity attestation check
    const integrityToken = request.headers.get('x-play-integrity-token')
    if (integrityToken) {
      const attestation = await verifyPlayIntegrity(integrityToken)
      if (!attestation.valid) {
        console.error(JSON.stringify({
          event: 'cellular_refresh_attestation_failed',
          terminalId: oldPayload?.terminalId ?? 'unknown',
          verdict: attestation.verdict,
          deviceRecognitionVerdict: attestation.deviceRecognitionVerdict,
          error: attestation.error,
          timestamp: new Date().toISOString(),
        }))
        return NextResponse.json(
          { error: 'Device attestation failed' },
          { status: 403 }
        )
      }
    } else {
      // No attestation token provided — allow for gradual rollout but log warning
      if (oldPayload) {
        console.warn(JSON.stringify({
          event: 'cellular_refresh_no_attestation',
          terminalId: oldPayload.terminalId,
          timestamp: new Date().toISOString(),
        }))
      }
    }

    const newToken = await refreshCellularToken(token)

    if (!newToken) {
      console.error(JSON.stringify({
        event: 'cellular_refresh_denied',
        terminalId: oldPayload?.terminalId ?? 'unknown',
        reason: oldPayload ? 'revoked_or_idle' : 'invalid_token',
        timestamp: new Date().toISOString(),
      }))
      return NextResponse.json({ error: 'Token refresh denied' }, { status: 401 })
    }

    return NextResponse.json({ token: newToken })
  } catch (error) {
    console.error('[refresh-cellular] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
