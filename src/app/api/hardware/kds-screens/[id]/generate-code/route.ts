import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// POST /api/hardware/kds-screens/[id]/generate-code - Generate a pairing code
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const screen = await db.kDSScreen.findUnique({
      where: { id },
    })

    if (!screen) {
      return notFound('KDS screen not found')
    }

    // Generate a 6-digit pairing code
    const pairingCode = Math.floor(100000 + Math.random() * 900000).toString()

    // Set expiration to 5 minutes from now
    const pairingCodeExpiresAt = new Date(Date.now() + 5 * 60 * 1000)

    // Update the screen with the new pairing code
    await db.kDSScreen.update({
      where: { id },
      data: {
        pairingCode,
        pairingCodeExpiresAt,
        // Don't reset isPaired - allow re-pairing without losing existing pairing
      },
    })

    void notifyDataChanged({ locationId: screen.locationId, domain: 'hardware', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({
      pairingCode,
      expiresAt: pairingCodeExpiresAt.toISOString(),
      expiresInSeconds: 300,
      screenName: screen.name,
      slug: screen.slug,
    })
  } catch (error) {
    console.error('Failed to generate pairing code:', error)
    return err('Failed to generate pairing code', 500)
  }
}))
