import { NextResponse } from 'next/server'
import { checkSimulatedReaderAccess } from '../guard'

/**
 * Simulated Datacap Reader - Cancel Transaction
 * Mimics POST /v1/cancel on a physical Datacap reader.
 * BLOCKED in production via NODE_ENV guard.
 */
export async function POST() {
  const blocked = checkSimulatedReaderAccess()
  if (blocked) return blocked

  console.log('[simulated-reader] Transaction cancelled')

  return NextResponse.json({ status: 'cancelled' })
}
