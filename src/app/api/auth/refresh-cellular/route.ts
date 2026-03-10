import { NextRequest, NextResponse } from 'next/server'
import { refreshCellularToken, verifyCellularTokenWithGrace, verifyPlayIntegrity } from '@/lib/cellular-auth'

/**
 * POST /api/auth/refresh-cellular
 *
 * Refresh a cellular terminal JWT token.
 * Accepts current token in Authorization header.
 * Returns new token or 401/403 if revoked/expired/attestation-failed.
 *
 * Grace period: accepts tokens expired within 4 hours (outage recovery).
 * refreshCellularToken() uses verifyCellularTokenWithGrace() internally,
 * so Android workers can self-heal after extended offline periods.
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

    // Use grace-aware verification for logging context — the token may be expired
    // but still structurally valid (which is expected after an outage)
    const graceResult = await verifyCellularTokenWithGrace(token)
    const oldPayload = graceResult?.payload ?? null

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
        graceExpired: graceResult === null && oldPayload === null,
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
