import { NextRequest, NextResponse } from 'next/server'
import { refreshCellularToken, verifyCellularToken } from '@/lib/cellular-auth'

/**
 * POST /api/auth/refresh-cellular
 *
 * Refresh a cellular terminal JWT token.
 * Accepts current token in Authorization header.
 * Returns new token or 401/403 if revoked/expired.
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

    // TODO: attestation check placeholder
    // When Play Integrity / device attestation is implemented,
    // verify the attestation header here before issuing refresh.
    // const attestation = request.headers.get('x-device-attestation')

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
