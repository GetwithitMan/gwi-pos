import { NextRequest } from 'next/server'
import { discoverDevice, discoverAllDevices } from '@/lib/datacap/discovery'
import { datacapErrorResponse } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/datacap/discover
 * Discover all Datacap readers on the local network via UDP broadcast.
 * Datacap certification test 1.0 — GetDevicesInfo.
 *
 * Query params:
 *   timeoutMs (optional) — how long to listen, default 5000ms (max 15000ms)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const timeoutMs = Math.min(
      parseInt(searchParams.get('timeoutMs') || '5000', 10),
      15000
    )

    const devices = await discoverAllDevices(timeoutMs)

    return Response.json({
      data: {
        devices,
        count: devices.length,
        discoveryTimeoutMs: timeoutMs,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})

interface DiscoverBySerialRequest {
  serialNumber: string
  timeoutMs?: number // Default: 15000ms (30 retries × 500ms)
}

/**
 * POST /api/datacap/discover
 * Discover a specific Datacap reader by serial number via UDP.
 * Returns the reader's IP address when found.
 *
 * Body: { serialNumber: string, timeoutMs?: number }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json() as DiscoverBySerialRequest
    const { serialNumber } = body

    if (!serialNumber) {
      return Response.json({ error: 'Missing required field: serialNumber' }, { status: 400 })
    }

    const device = await discoverDevice(serialNumber)

    if (!device) {
      return Response.json({
        data: {
          found: false,
          device: null,
          message: `Device with serial number "${serialNumber}" not found on the network`,
        },
      })
    }

    return Response.json({
      data: {
        found: true,
        device,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
