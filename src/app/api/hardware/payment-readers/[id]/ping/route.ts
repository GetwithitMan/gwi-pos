import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getDatacapClient } from '@/lib/datacap/helpers'

// POST - Ping payment reader to check connectivity
// Uses EMVPadReset via DatacapClient — fast (2-3s) and confirms device is alive
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const reader = await db.paymentReader.findFirst({
      where: { id, deletedAt: null },
      include: { location: { select: { id: true } } },
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
          ...(isOnline && { lastError: null, lastErrorAt: null }),
        },
      })

      return NextResponse.json({
        success: isOnline,
        isOnline,
        responseTimeMs: responseTime,
      })
    } catch (fetchError) {
      const responseTime = Date.now() - startTime
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Connection failed'

      // Update reader as offline
      await db.paymentReader.update({
        where: { id },
        data: {
          isOnline: false,
          lastError: errorMessage,
          lastErrorAt: new Date(),
        },
      })

      return NextResponse.json({
        success: false,
        isOnline: false,
        error: errorMessage,
        responseTimeMs: responseTime,
      })
    }
  } catch (error) {
    console.error('Failed to ping payment reader:', error)
    return NextResponse.json({ error: 'Failed to ping payment reader' }, { status: 500 })
  }
}
