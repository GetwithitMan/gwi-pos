import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { testPrinterConnection } from '@/lib/printer-connection'
import { executeHardwareCommand } from '@/lib/hardware-command'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// POST test printer connection
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const printer = await db.printer.findUnique({
      where: { id },
    })

    if (!printer) {
      return notFound('Printer not found')
    }

    // Cloud mode: route through NUC via HardwareCommand
    if (process.env.VERCEL) {
      const result = await executeHardwareCommand({
        locationId: printer.locationId,
        commandType: 'PRINTER_PING',
        targetDeviceId: id,
      })

      // Update printer status from remote result
      if (result.resultPayload) {
        await db.printer.update({
          where: { id },
          data: {
            lastPingAt: new Date(),
            lastPingOk: result.success,
          },
        })
      }

      return ok({
        success: result.success,
        responseTime: result.resultPayload?.responseTime,
        error: result.error || result.resultPayload?.error,
        printer: {
          id: printer.id,
          name: printer.name,
          ipAddress: printer.ipAddress,
          port: printer.port,
        },
      })
    }

    // Test the connection
    const result = await testPrinterConnection(printer.ipAddress, printer.port)

    // Update printer status
    await db.printer.update({
      where: { id },
      data: {
        lastPingAt: new Date(),
        lastPingOk: result.success,
      },
    })

    return ok({
      success: result.success,
      responseTime: result.responseTime,
      error: result.error,
      printer: {
        id: printer.id,
        name: printer.name,
        ipAddress: printer.ipAddress,
        port: printer.port,
      },
    })
  } catch (error) {
    console.error('Failed to ping printer:', error)
    return err('Failed to ping printer', 500)
  }
}))
