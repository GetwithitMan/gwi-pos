import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST /api/hardware/kds-screens/[id]/unpair - Remove device pairing
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const screen = await db.kDSScreen.findUnique({
      where: { id },
    })

    if (!screen) {
      return NextResponse.json({ error: 'KDS screen not found' }, { status: 404 })
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

    return NextResponse.json({
      success: true,
      message: 'Device unpaired successfully',
    })
  } catch (error) {
    console.error('Failed to unpair device:', error)
    return NextResponse.json({ error: 'Failed to unpair device' }, { status: 500 })
  }
})
