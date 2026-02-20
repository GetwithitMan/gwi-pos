import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { db } from '@/lib/db'
import { discoverAllDevices } from '@/lib/datacap/discovery'
import { withVenue } from '@/lib/with-venue'

const execAsync = promisify(exec)

// Known payment reader USB vendors / product name fragments
const PAYMENT_READER_VENDORS = [
  'ID TECH',
  'IDTECH',
  'PAX',
  'INGENICO',
  'VERIFONE',
  'DATACAP',
]
const PAYMENT_READER_PRODUCTS = [
  'VP3350', 'VP4880', 'VP3300', 'VP6300',
  'A920', 'A920Pro', 'A77', 'A800', 'IM30', 'A35', 'A30',
  'DX4000', 'DX8000', 'EX6000', 'EX8000',
  'VX520', 'VX690',
]

interface UsbDevice {
  serialNumber: string
  model: string
  vendor: string
  connectionType: 'USB'
}

interface NetworkDevice {
  serialNumber: string
  ipAddress: string
  port: number
  connectionType: 'IP'
}

/** Parse macOS ioreg output for payment reader USB devices */
async function scanUsbDevices(): Promise<UsbDevice[]> {
  try {
    const { stdout } = await execAsync('ioreg -p IOUSB -w0 -l', { timeout: 8000 })
    const devices: UsbDevice[] = []

    // Split into device blocks (each starts with a +-- or | +-o line)
    const blocks = stdout.split(/(?=\| \+-o |\+-o )/)

    for (const block of blocks) {
      // Check if this block is a payment reader by vendor or product name
      const vendorMatch = block.match(/"USB Vendor Name"\s*=\s*"([^"]+)"/)
      const productMatch = block.match(/"USB Product Name"\s*=\s*"([^"]+)"/)
      const serialMatch = block.match(/"USB Serial Number"\s*=\s*"([^"]+)"/)
      const kProductMatch = block.match(/"kUSBProductString"\s*=\s*"([^"]+)"/)
      const kVendorMatch = block.match(/"kUSBVendorString"\s*=\s*"([^"]+)"/)
      const kSerialMatch = block.match(/"kUSBSerialNumberString"\s*=\s*"([^"]+)"/)

      const vendor = vendorMatch?.[1] || kVendorMatch?.[1] || ''
      const product = productMatch?.[1] || kProductMatch?.[1] || ''
      const serial = serialMatch?.[1] || kSerialMatch?.[1] || ''

      if (!serial) continue

      // Check if it's a known payment reader
      const isPaymentVendor = PAYMENT_READER_VENDORS.some(v =>
        vendor.toUpperCase().includes(v)
      )
      const isPaymentProduct = PAYMENT_READER_PRODUCTS.some(p =>
        product.toUpperCase().includes(p.toUpperCase())
      )

      if (isPaymentVendor || isPaymentProduct) {
        devices.push({
          serialNumber: serial,
          model: product || 'Unknown Reader',
          vendor: vendor || 'Unknown Vendor',
          connectionType: 'USB',
        })
      }
    }

    return devices
  } catch {
    // ioreg not available (Linux) — try lsusb
    try {
      const { stdout } = await execAsync('lsusb -v 2>/dev/null | grep -A5 -i "ID TECH\\|IDTECH\\|PAX\\|Ingenico"', { timeout: 5000 })
      // Basic fallback — just log, return empty for now
      console.log('[Scan] lsusb output (Linux):', stdout.slice(0, 200))
    } catch {}
    return []
  }
}

/**
 * GET /api/hardware/payment-readers/scan
 * Scans for USB and network-connected payment readers.
 * Returns detected devices with their connection type and whether they're already registered.
 *
 * Query params:
 *   locationId (required) — to check which serials are already registered
 *   networkTimeoutMs (optional) — UDP discovery window (default 4000ms, max 10000ms)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get('locationId')
  if (!locationId) {
    return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
  }

  const rawTimeout = parseInt(searchParams.get('networkTimeoutMs') || '4000', 10)
  const networkTimeoutMs = Math.min(isNaN(rawTimeout) ? 4000 : rawTimeout, 10000)

  // Run USB scan + network discovery in parallel
  const [usbDevices, networkDevices] = await Promise.all([
    scanUsbDevices(),
    discoverAllDevices(networkTimeoutMs),
  ])

  // Get all already-registered serial numbers for this location
  const registered = await db.paymentReader.findMany({
    where: { locationId, deletedAt: null },
    select: { serialNumber: true, id: true, name: true, connectionType: true },
  })
  const registeredBySerial = new Map(registered.map(r => [r.serialNumber, r]))

  // Build response — annotate each device with registration status
  const usb = usbDevices.map(d => ({
    ...d,
    alreadyRegistered: registeredBySerial.has(d.serialNumber),
    registeredAs: registeredBySerial.get(d.serialNumber)?.name ?? null,
    readerId: registeredBySerial.get(d.serialNumber)?.id ?? null,
  }))

  const network = networkDevices.map(d => ({
    ...d,
    connectionType: 'IP' as const,
    alreadyRegistered: registeredBySerial.has(d.serialNumber),
    registeredAs: registeredBySerial.get(d.serialNumber)?.name ?? null,
    readerId: registeredBySerial.get(d.serialNumber)?.id ?? null,
  }))

  return NextResponse.json({
    data: {
      usb,
      network,
      total: usb.length + network.length,
      scannedAt: new Date().toISOString(),
    },
  })
})
