import { NextResponse } from 'next/server'
import { checkSimulatedReaderAccess } from '../../guard'

/**
 * Simulated Datacap Reader - Device Beep
 * Mimics POST /v1/device/beep on a physical Datacap reader.
 * BLOCKED in production via NODE_ENV guard.
 */
export async function POST() {
  const blocked = checkSimulatedReaderAccess()
  if (blocked) return blocked

  return NextResponse.json({ status: 'ok', beeped: true })
}
