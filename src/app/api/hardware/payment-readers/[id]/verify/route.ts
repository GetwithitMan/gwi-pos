import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Verify payment reader identity (serial number handshake + optional beep)
export async function POST(
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
      // Attempt to get device info for serial verification
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(`http://${reader.ipAddress}:${reader.port}/v1/device/info`, {
        method: 'GET',
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const responseTime = Date.now() - startTime

      if (!response.ok) {
        await db.paymentReader.update({
          where: { id },
          data: {
            isOnline: false,
            lastError: `Device returned status ${response.status}`,
            lastErrorAt: new Date(),
          },
        })

        return NextResponse.json({
          verified: false,
          error: `Device returned status ${response.status}`,
          responseTimeMs: responseTime,
        })
      }

      const deviceInfo = await response.json()
      const deviceSerial = deviceInfo.serialNumber || deviceInfo.serial || deviceInfo.sn

      // Verify serial number matches
      const serialMatch = deviceSerial === reader.serialNumber

      // Update reader status
      await db.paymentReader.update({
        where: { id },
        data: {
          isOnline: true,
          lastSeenAt: new Date(),
          avgResponseTime: responseTime,
          firmwareVersion: deviceInfo.firmwareVersion || deviceInfo.version || null,
          lastError: serialMatch ? null : 'Serial number mismatch',
          lastErrorAt: serialMatch ? null : new Date(),
        },
      })

      // Trigger beep if requested and serial matches
      if (triggerBeep && serialMatch) {
        try {
          // Datacap Direct readers typically support a beep/alert command
          await fetch(`http://${reader.ipAddress}:${reader.port}/v1/device/beep`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'identify' }),
          })
        } catch {
          // Beep is optional, don't fail if it doesn't work
        }
      }

      return NextResponse.json({
        verified: serialMatch,
        isOnline: true,
        responseTimeMs: responseTime,
        deviceInfo: {
          serialNumber: deviceSerial,
          firmwareVersion: deviceInfo.firmwareVersion || deviceInfo.version,
          model: deviceInfo.model,
        },
        expectedSerial: reader.serialNumber,
        serialMatch,
        beepTriggered: triggerBeep && serialMatch,
        ...(serialMatch ? {} : {
          error: 'Serial number does not match. Expected: ' +
            reader.serialNumber.slice(-6) + ', Got: ' +
            (deviceSerial || 'unknown').slice(-6),
        }),
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
}
