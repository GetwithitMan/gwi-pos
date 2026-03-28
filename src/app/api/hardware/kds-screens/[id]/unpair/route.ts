import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// POST /api/hardware/kds-screens/[id]/unpair - Remove device pairing
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

    // Clear all pairing data
    await db.kDSScreen.update({
      where: { id },
      data: {
        deviceToken: null,
        pairingCode: null,
        pairingCodeExpiresAt: null,
        isPaired: false,
        deviceInfo: Prisma.DbNull,
        // Keep lastKnownIp for troubleshooting history
      },
    })

    void notifyDataChanged({ locationId: screen.locationId, domain: 'hardware', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({
      success: true,
      message: 'Device unpaired successfully',
    })
  } catch (error) {
    console.error('Failed to unpair device:', error)
    return err('Failed to unpair device', 500)
  }
}))
