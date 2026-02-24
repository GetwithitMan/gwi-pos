import { NextRequest, NextResponse } from 'next/server'
import { sendToPrinter } from '@/lib/printer-connection'
import { withVenue } from '@/lib/with-venue'

// Maximum recommended print buffer size (16KB)
// Larger buffers (logos, high-res bitmaps) can hang sockets on degraded networks
const MAX_RECOMMENDED_BUFFER_SIZE = 16384
const MAX_BUFFER_SIZE = 65536 // Hard limit: 64KB

// POST direct print to a printer on the local network
// This bypasses the main server routing and sends directly to the printer IP
// Used when the main server is down but local network is still up
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const { printerIp, printerPort = 9100, data, skipSizeCheck = false } = await request.json()

    if (!printerIp) {
      return NextResponse.json({ error: 'Printer IP is required' }, { status: 400 })
    }

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Print data is required' }, { status: 400 })
    }

    // Convert data array to Buffer
    const buffer = Buffer.from(data)

    // Size checks to prevent socket hangs on degraded networks
    if (buffer.length > MAX_BUFFER_SIZE) {
      return NextResponse.json(
        {
          error: 'Print data too large',
          code: 'BUFFER_TOO_LARGE',
          size: buffer.length,
          maxSize: MAX_BUFFER_SIZE,
          hint: 'Remove or reduce logo/image size. Text-only tickets recommended for offline printing.',
        },
        { status: 400 }
      )
    }

    // Warn about large buffers (likely contains bitmap logo)
    let warning: string | undefined
    if (buffer.length > MAX_RECOMMENDED_BUFFER_SIZE && !skipSizeCheck) {
      warning = `Large print buffer (${buffer.length} bytes). Consider removing logo for faster offline printing.`
      console.warn(`[DirectPrint] ${warning}`)
    }

    // W1-PR1: Send to printer via shared sendToPrinter and check result
    const result = await sendToPrinter(printerIp, printerPort, buffer)

    if (!result.success) {
      return NextResponse.json(
        {
          error: `Print failed: ${result.error || 'Unknown error'}`,
          code: 'PRINT_ERROR',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ data: {
      success: true,
      message: `Sent ${buffer.length} bytes to ${printerIp}:${printerPort}`,
      bytesSent: buffer.length,
      ...(warning && { warning }),
    } })
  } catch (error) {
    console.error('Direct print failed:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Print failed',
        code: 'PRINT_ERROR',
      },
      { status: 500 }
    )
  }
})
