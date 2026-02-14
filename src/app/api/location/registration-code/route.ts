import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * Registration Code API (Skill 345)
 *
 * Generates and manages one-time registration codes for NUC provisioning.
 * Codes are 6-char alphanumeric (typo-resistant charset: no 0/O/1/I).
 * Each code expires after 24 hours.
 */

// Typo-resistant charset: no 0, O, 1, I (matches src/lib/utils.ts pattern)
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateRegistrationCode(): string {
  const bytes = randomBytes(6)
  return Array.from(bytes)
    .map((b) => CHARSET[b % CHARSET.length])
    .join('')
}

type UIStatus = 'none' | 'active' | 'expired' | 'used' | 'revoked'

function deriveUIStatus(
  token: { status: string; expiresAt: Date } | null
): UIStatus {
  if (!token) return 'none'
  if (token.status === 'USED') return 'used'
  if (token.status === 'REVOKED') return 'revoked'
  if (token.status === 'PENDING' && new Date() > token.expiresAt) return 'expired'
  if (token.status === 'PENDING') return 'active'
  return 'none'
}

// GET — Current registration code status
export const GET = withVenue(async function GET() {
  try {
    const location = await db.location.findFirst({
      select: { id: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    // Find the most recent token for this location
    const token = await db.serverRegistrationToken.findFirst({
      where: { locationId: location.id },
      orderBy: { createdAt: 'desc' },
      select: {
        token: true,
        status: true,
        expiresAt: true,
        usedAt: true,
      },
    })

    const status = deriveUIStatus(token)

    return NextResponse.json({
      data: {
        code: token?.token ?? null,
        expiresAt: token?.expiresAt?.toISOString() ?? null,
        used: token?.status === 'USED',
        status,
      },
    })
  } catch (error) {
    console.error('Failed to fetch registration code:', error)
    return NextResponse.json(
      { error: 'Failed to fetch registration code' },
      { status: 500 }
    )
  }
})

// POST — Generate a new registration code
export const POST = withVenue(async function POST() {
  try {
    const location = await db.location.findFirst({
      select: { id: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    // Revoke any existing PENDING tokens for this location
    await db.serverRegistrationToken.updateMany({
      where: {
        locationId: location.id,
        status: 'PENDING',
      },
      data: {
        status: 'REVOKED',
      },
    })

    // Generate new token with 24h expiry
    const code = generateRegistrationCode()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const token = await db.serverRegistrationToken.create({
      data: {
        locationId: location.id,
        token: code,
        status: 'PENDING',
        expiresAt,
      },
      select: {
        token: true,
        status: true,
        expiresAt: true,
      },
    })

    return NextResponse.json({
      data: {
        code: token.token,
        expiresAt: token.expiresAt.toISOString(),
        used: false,
        status: 'active' as UIStatus,
      },
    })
  } catch (error) {
    console.error('Failed to generate registration code:', error)
    return NextResponse.json(
      { error: 'Failed to generate registration code' },
      { status: 500 }
    )
  }
})
