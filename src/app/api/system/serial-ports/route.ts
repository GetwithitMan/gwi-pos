import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// GET - List available serial ports on the system
export const GET = withVenue(async function GET() {
  try {
    // Dynamic import — serialport is a native module that may not be available
    // in all environments (e.g., Vercel edge, CI). Fail gracefully.
    let SerialPort: { list: () => Promise<Array<{ path: string; manufacturer?: string; serialNumber?: string; pnpId?: string; vendorId?: string; productId?: string }>> }
    try {
      SerialPort = await import('serialport').then((m) => m.SerialPort)
    } catch {
      // serialport not installed or not available in this environment
      return ok({ ports: [], note: 'Serial port detection not available in this environment' })
    }

    const ports = await SerialPort.list()

    return ok({
        ports: ports.map((p) => ({
          path: p.path,
          manufacturer: p.manufacturer || null,
          serialNumber: p.serialNumber || null,
          pnpId: p.pnpId || null,
          vendorId: p.vendorId || null,
          productId: p.productId || null,
        })),
      })
  } catch (error) {
    console.error('Failed to list serial ports:', error)
    return err('Failed to list serial ports', 500)
  }
})
