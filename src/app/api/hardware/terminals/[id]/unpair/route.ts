import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { withVenue } from '@/lib/with-venue'

// POST unpair a terminal (manager action)
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const terminal = await db.terminal.findUnique({ where: { id } })
    if (!terminal || terminal.deletedAt) {
      return NextResponse.json({ error: 'Terminal not found' }, { status: 404 })
    }

    if (!terminal.isPaired) {
      return NextResponse.json({ error: 'Terminal is not paired' }, { status: 400 })
    }

    // Clear pairing data
    await db.terminal.update({
      where: { id },
      data: {
        isPaired: false,
        isOnline: false,
        deviceToken: null,
        deviceFingerprint: null,
        deviceInfo: Prisma.JsonNull,
        // Keep lastKnownIp and lastSeenAt for audit trail
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Terminal unpaired successfully',
    })
  } catch (error) {
    console.error('Failed to unpair terminal:', error)
    return NextResponse.json({ error: 'Failed to unpair terminal' }, { status: 500 })
  }
})
