import { NextResponse } from 'next/server'
import { checkSimulatedReaderAccess } from '../../guard'

/**
 * Simulated Datacap Reader - Device Info
 * Mimics GET /v1/device/info on a physical Datacap reader.
 * Returns a simulated reader identity for development/testing.
 * BLOCKED in production via NODE_ENV guard.
 */
export async function GET() {
  const blocked = checkSimulatedReaderAccess()
  if (blocked) return blocked

  console.log('[simulated-reader] GET /device/info')

  return NextResponse.json({
    serialNumber: 'SIM-001-DEV',
    firmwareVersion: 'SIM-1.0.0',
    model: 'GWI Simulated Reader',
    status: 'ready',
  })
}
