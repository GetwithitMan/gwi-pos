import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// Typo-resistant charset: no 0, O, 1, I
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateRegistrationCode(): string {
  const bytes = randomBytes(6)
  return Array.from(bytes).map(b => CHARSET[b % CHARSET.length]).join('')
}

function deriveStatus(token: { status: string; expiresAt: Date }): string {
  if (token.status === 'USED') return 'used'
  if (token.status === 'REVOKED') return 'revoked'
  if (token.status === 'PENDING' && token.expiresAt < new Date()) return 'expired'
  if (token.status === 'PENDING') return 'active'
  return 'none'
}

export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    const token = await db.serverRegistrationToken.findFirst({
      where: { locationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })

    if (!token) {
      return NextResponse.json({ data: { code: null, expiresAt: null, status: 'none', used: false } })
    }

    const status = deriveStatus(token)

    return NextResponse.json({
      data: {
        code: token.token,
        expiresAt: token.expiresAt.toISOString(),
        status,
        used: token.status === 'USED',
      },
    })
  } catch (error) {
    console.error('Failed to fetch registration code:', error)
    return NextResponse.json({ error: 'Failed to fetch registration code' }, { status: 500 })
  }
})

export const POST = withVenue(async function POST() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    // Revoke any existing PENDING tokens for this location
    await db.serverRegistrationToken.updateMany({
      where: {
        locationId,
        status: 'PENDING',
      },
      data: { status: 'REVOKED' },
    })

    // Create new token with 24h expiry
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const token = await db.serverRegistrationToken.create({
      data: {
        locationId,
        token: generateRegistrationCode(),
        expiresAt,
      },
    })

    return NextResponse.json({
      data: {
        code: token.token,
        expiresAt: token.expiresAt.toISOString(),
        status: 'active',
        used: false,
      },
    })
  } catch (error) {
    console.error('Failed to generate registration code:', error)
    return NextResponse.json({ error: 'Failed to generate registration code' }, { status: 500 })
  }
})
