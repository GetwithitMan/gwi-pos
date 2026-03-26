import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'

// POST generate a new pairing code for this terminal
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const terminal = await db.terminal.findUnique({ where: { id } })
    if (!terminal || terminal.deletedAt) {
      return NextResponse.json({ error: 'Terminal not found' }, { status: 404 })
    }

    // Generate 6-digit code
    const pairingCode = Math.random().toString().slice(2, 8)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes

    await db.terminal.update({
      where: { id },
      data: {
        pairingCode,
        pairingCodeExpiresAt: expiresAt,
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
        // Don't unpair existing device - code generation doesn't unpair
      },
    })

    void notifyDataChanged({ locationId: terminal.locationId, domain: 'hardware', action: 'updated', entityId: terminal.id })
    void pushUpstream()

    return NextResponse.json({ data: {
      pairingCode,
      expiresAt: expiresAt.toISOString(),
      terminalName: terminal.name,
    } })
  } catch (error) {
    console.error('Failed to generate pairing code:', error)
    return NextResponse.json({ error: 'Failed to generate pairing code' }, { status: 500 })
  }
}))
