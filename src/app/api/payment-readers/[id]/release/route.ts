import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { releaseLease } from '@/lib/domain/payment-readers/listener-service'

// DELETE /api/payment-readers/[id]/release
//
// Releases the reader lease. Called on:
//   - Manual cancel
//   - Logout
//   - Navigation away
//   - Component unmount
//
// TTL expiry is the authoritative fallback if this never fires.
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: readerId } = await params
    const body = await request.json().catch(() => ({}))
    const { terminalId, sessionId, reason } = body

    if (!terminalId || !sessionId) {
      return NextResponse.json(
        { error: 'Missing required fields: terminalId, sessionId' },
        { status: 400 }
      )
    }

    // Validate reason if provided
    const validReasons = ['manual_cancel', 'logout', 'unmount', 'navigation']
    if (reason && !validReasons.includes(reason)) {
      return NextResponse.json(
        { error: `Invalid reason. Must be one of: ${validReasons.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate reader exists
    const reader = await db.paymentReader.findFirst({
      where: { id: readerId, deletedAt: null },
      select: { id: true, locationId: true, leaseSessionId: true },
    })
    if (!reader) {
      return NextResponse.json({ error: 'Payment reader not found' }, { status: 404 })
    }

    // Validate sessionId matches — reject if wrong session tries to release
    if (reader.leaseSessionId && reader.leaseSessionId !== sessionId) {
      return NextResponse.json(
        { error: 'Session ID does not match current lease', code: 'session_mismatch' },
        { status: 409 }
      )
    }

    // Validate terminal belongs to same location
    const terminal = await db.terminal.findFirst({
      where: { id: terminalId, locationId: reader.locationId, deletedAt: null },
      select: { id: true },
    })
    if (!terminal) {
      return NextResponse.json({ error: 'Terminal not found or does not belong to this location' }, { status: 403 })
    }

    // Release lease
    await releaseLease(readerId, sessionId, reason || 'manual_cancel')

    return NextResponse.json({ data: { ok: true } })
  } catch (error) {
    console.error('Failed to release reader lease:', error)
    return NextResponse.json({ error: 'Failed to release reader lease' }, { status: 500 })
  }
})
