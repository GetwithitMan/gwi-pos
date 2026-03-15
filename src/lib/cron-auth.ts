import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'

/**
 * Verify a cron request's Bearer token against CRON_SECRET using
 * constant-time comparison to prevent timing attacks.
 * Returns null if valid, or a 401 NextResponse if invalid.
 */
export function verifyCronSecret(authHeader: string | null): NextResponse | null {
  const expected = process.env.CRON_SECRET
  if (!expected || !authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const prefix = 'Bearer '
  if (!authHeader.startsWith(prefix)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.slice(prefix.length)

  try {
    const tokenBuf = Buffer.from(token, 'utf8')
    const expectedBuf = Buffer.from(expected, 'utf8')

    if (tokenBuf.length !== expectedBuf.length) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!timingSafeEqual(tokenBuf, expectedBuf)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null // Valid
}
