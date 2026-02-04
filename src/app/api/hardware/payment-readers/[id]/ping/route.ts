import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Ping payment reader to check connectivity
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const reader = await db.paymentReader.findFirst({
      where: { id, deletedAt: null },
    })

    if (!reader) {
      return NextResponse.json({ error: 'Payment reader not found' }, { status: 404 })
    }

    const startTime = Date.now()

    try {
      // Attempt to connect to the reader's device info endpoint
      // Datacap Direct readers typically respond to /v1/device/info
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

      const response = await fetch(`http://${reader.ipAddress}:${reader.port}/v1/device/info`, {
        method: 'GET',
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseTime = Date.now() - startTime
      const isOnline = response.ok

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

      if (isOnline) {
        const deviceInfo = await response.json().catch(() => null)
        return NextResponse.json({
          success: true,
          isOnline: true,
          responseTimeMs: responseTime,
          deviceInfo,
        })
      } else {
        return NextResponse.json({
          success: false,
          isOnline: false,
          error: `Reader responded with status ${response.status}`,
          responseTimeMs: responseTime,
        })
      }
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
