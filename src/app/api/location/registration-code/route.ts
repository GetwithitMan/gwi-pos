import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { masterClient, db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getRequestSlug } from '@/lib/request-context'

/**
 * Registration Code API (Skill 345)
 *
 * Generates and manages one-time registration codes for NUC provisioning.
 * Codes are 6-char alphanumeric (typo-resistant charset: no 0/O/1/I).
 * Each code expires after 24 hours.
 *
 * IMPORTANT: Token CRUD uses masterClient (master DB), NOT venue db.
 * Fleet register (/api/fleet/register) validates tokens against masterClient,
 * so tokens must be stored there. The venue db is only used as a fallback
 * to resolve locationId when no slug is available (e.g., local NUC dev).
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

/**
 * Resolve the locationId from the master database.
 *
 * Priority 1: Use venue slug (from request context) to look up in master DB
 *             — this is the correct path on Vercel cloud subdomains.
 * Priority 2: Fall back to venue db locationId (NUC local dev).
 */
async function resolveLocationId(): Promise<string | null> {
  const slug = getRequestSlug()
  if (slug) {
    const loc = await masterClient.location.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    })
    return loc?.id ?? null
  }
  // Fallback: get locationId from venue DB (should match master DB ID)
  const loc = await db.location.findFirst({ select: { id: true } })
  return loc?.id ?? null
}

// GET — Current registration code status
export const GET = withVenue(async function GET() {
  try {
    const locationId = await resolveLocationId()

    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    // Find the most recent token in the MASTER DB (where fleet register validates)
    const token = await masterClient.serverRegistrationToken.findFirst({
      where: { locationId },
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
    const locationId = await resolveLocationId()

    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    // Revoke any existing PENDING tokens in the MASTER DB
    await masterClient.serverRegistrationToken.updateMany({
      where: {
        locationId,
        status: 'PENDING',
      },
      data: {
        status: 'REVOKED',
      },
    })

    // Generate new token with 24h expiry in the MASTER DB
    const code = generateRegistrationCode()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const token = await masterClient.serverRegistrationToken.create({
      data: {
        locationId,
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
