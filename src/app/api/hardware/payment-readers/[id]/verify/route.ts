import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Verify payment reader identity via EMVPadReset + optional beep
// EMVPadReset confirms the device is alive and responds to Datacap protocol
export const POST = withVenue(withAuth(async function POST(
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
      return notFound('Payment reader not found')
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

      return ok({
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

      return ok({
        verified: false,
        isOnline: false,
        error: errorMessage,
        responseTimeMs: responseTime,
      })
    }
  } catch (error) {
    console.error('Failed to verify payment reader:', error)
    return err('Failed to verify payment reader', 500)
  }
}))
