import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST /api/hardware/kds-screens/[id]/generate-code - Generate a pairing code
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

    return NextResponse.json({
      pairingCode,
      expiresAt: pairingCodeExpiresAt.toISOString(),
      expiresInSeconds: 300,
      screenName: screen.name,
      slug: screen.slug,
    })
  } catch (error) {
    console.error('Failed to generate pairing code:', error)
    return NextResponse.json({ error: 'Failed to generate pairing code' }, { status: 500 })
  }
})
