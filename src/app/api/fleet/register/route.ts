import { NextRequest, NextResponse } from 'next/server'
import { masterClient } from '@/lib/db'
import { randomBytes } from 'crypto'

/**
 * Fleet Registration API (Skill 345)
 *
 * Called by installer.run on Ubuntu NUCs during provisioning.
 * Validates a registration code, creates a ServerNode record,
 * and returns environment variables for the NUC.
 *
 * This endpoint runs on the CLOUD instance (Vercel), not on local NUCs.
 * It uses masterClient to look up locations across all venues.
 */

interface RegisterRequest {
  domain: string // e.g., "fruittabar.ordercontrolcenter.com"
  code: string // Registration code from MC admin
  role: 'server' | 'terminal'
}

const VENUE_PARENT_DOMAINS = [
  '.ordercontrolcenter.com',
  '.barpos.restaurant',
]

function extractSlugFromDomain(domain: string): string | null {
  for (const parent of VENUE_PARENT_DOMAINS) {
    if (domain.endsWith(parent)) {
      const slug = domain.slice(0, -parent.length)
      if (slug && !slug.includes('.') && slug !== 'www') {
        return slug
      }
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RegisterRequest

    // Validate request
    if (!body.domain || !body.code || !body.role) {
      return NextResponse.json(
        { error: 'Missing required fields: domain, code, role' },
        { status: 400 }
      )
    }

    if (body.role !== 'server' && body.role !== 'terminal') {
      return NextResponse.json(
        { error: 'Role must be "server" or "terminal"' },
        { status: 400 }
      )
    }

    // Extract slug from domain
    const slug = extractSlugFromDomain(body.domain)
    if (!slug) {
      return NextResponse.json(
        {
          error: `Invalid venue domain. Must end with ${VENUE_PARENT_DOMAINS.join(' or ')}`,
        },
        { status: 400 }
      )
    }

    // Look up location by slug
    const location = await masterClient.location.findFirst({
      where: { slug, isActive: true },
      include: { organization: true },
    })

    if (!location) {
      return NextResponse.json(
        { error: 'Venue not found. Check the domain and try again.' },
        { status: 404 }
      )
    }

    // Validate registration code against ServerRegistrationToken
    const regToken = await masterClient.serverRegistrationToken.findFirst({
      where: { locationId: location.id, token: body.code },
    })

    if (!regToken) {
      return NextResponse.json(
        { error: 'Invalid registration code.' },
        { status: 401 }
      )
    }

    if (regToken.status === 'USED') {
      return NextResponse.json(
        {
          error:
            'Registration code has already been used. Generate a new one from venue settings.',
        },
        { status: 400 }
      )
    }

    if (regToken.status === 'REVOKED') {
      return NextResponse.json(
        {
          error:
            'Registration code has been revoked. Generate a new one from venue settings.',
        },
        { status: 400 }
      )
    }

    if (new Date() > regToken.expiresAt) {
      return NextResponse.json(
        {
          error:
            'Registration code has expired. Generate a new one from venue settings.',
        },
        { status: 400 }
      )
    }

    // Generate secrets for the new server node
    const serverApiKey = randomBytes(32).toString('hex') // 64-char hex
    const nextAuthSecret = randomBytes(32).toString('hex')

    // Generate a unique DB password for local Postgres
    const dbPassword = randomBytes(16).toString('hex')

    // Create ServerNode record
    const serverNode = await masterClient.serverNode.create({
      data: {
        locationId: location.id,
        serverApiKey,
        role: body.role,
        status: 'registered',
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
      },
    })

    // Mark registration token as USED with audit trail
    await masterClient.serverRegistrationToken.update({
      where: { id: regToken.id },
      data: {
        status: 'USED',
        usedAt: new Date(),
        usedByServerNodeId: serverNode.id,
      },
    })

    // Build environment variables for the NUC
    const env: Record<string, string> = {
      // Database (local Postgres on the NUC)
      DATABASE_URL: `postgresql://pulse_pos:${dbPassword}@localhost:5432/pulse_pos`,
      DIRECT_URL: `postgresql://pulse_pos:${dbPassword}@localhost:5432/pulse_pos`,

      // Location identity
      LOCATION_ID: location.id,
      LOCATION_NAME: location.name,

      // Server node identity
      SERVER_NODE_ID: serverNode.id,
      SERVER_API_KEY: serverApiKey,

      // Mission Control
      MISSION_CONTROL_URL:
        process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com',
      SYNC_ENABLED: 'true',
      SYNC_API_URL:
        process.env.SYNC_API_URL || 'https://app.thepasspos.com/api/fleet',

      // App config
      NEXT_PUBLIC_EVENT_PROVIDER: 'socket',
      NEXTAUTH_SECRET: nextAuthSecret,
      PORT: '3000',
      NODE_ENV: 'production',

      // Local Postgres credentials (installer uses these to create DB)
      DB_USER: 'pulse_pos',
      DB_PASSWORD: dbPassword,
      DB_NAME: 'pulse_pos',
    }

    // Terminal role gets minimal env
    if (body.role === 'terminal') {
      return NextResponse.json({
        data: {
          env: {
            LOCATION_ID: location.id,
            LOCATION_NAME: location.name,
            SERVER_NODE_ID: serverNode.id,
          },
          repoUrl: null, // Terminals don't need the repo
        },
      })
    }

    return NextResponse.json({
      data: {
        env,
        repoUrl: 'https://github.com/GetwithitMan/gwi-pos.git',
      },
    })
  } catch (error) {
    console.error('[Fleet Register] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error during registration.' },
      { status: 500 }
    )
  }
}
