import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'

// POST - Verify payment reader identity via EMVPadReset + optional beep
// EMVPadReset confirms the device is alive and responds to Datacap protocol
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { triggerBeep = false } = body

    const reader = await db.paymentReader.findFirst({
      where: { id, deletedAt: null },
    })

    if (!reader) {
      return NextResponse.json({ error: 'Payment reader not found' }, { status: 404 })
    }

    const startTime = Date.now()

    try {
      const client = await getDatacapClient(reader.locationId)
      const response = await client.padReset(id)

      const responseTime = Date.now() - startTime
      const isOnline = response.cmdStatus === 'Success'

      // Update reader status
      await db.paymentReader.update({
        where: { id },
        data: {
          isOnline,
          lastSeenAt: isOnline ? new Date() : reader.lastSeenAt,
          avgResponseTime: responseTime,
          lastError: isOnline ? null : response.textResponse || 'Verification failed',
          lastErrorAt: isOnline ? null : new Date(),
        },
      })

      // Trigger beep via a second pad reset (harmless, causes device activity)
      if (triggerBeep && isOnline) {
        try {
          await client.padReset(id)
        } catch {
          // Beep is optional
        }
      }

      return NextResponse.json({
        verified: isOnline,
        isOnline,
        responseTimeMs: responseTime,
        serialNumber: reader.serialNumber,
        beepTriggered: triggerBeep && isOnline,
      })
    } catch (fetchError) {
      const responseTime = Date.now() - startTime
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Connection failed'

      await db.paymentReader.update({
        where: { id },
        data: {
          isOnline: false,
          lastError: errorMessage,
          lastErrorAt: new Date(),
        },
      })

      return NextResponse.json({
        verified: false,
        isOnline: false,
        error: errorMessage,
        responseTimeMs: responseTime,
      })
    }
  } catch (error) {
    console.error('Failed to verify payment reader:', error)
    return NextResponse.json({ error: 'Failed to verify payment reader' }, { status: 500 })
  }
})
