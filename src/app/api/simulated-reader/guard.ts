import { NextResponse } from 'next/server'

/**
 * Guard: Block simulated reader routes in production.
 * Returns a 403 response if NODE_ENV is 'production'.
 * Returns null if the request is allowed to proceed.
 */
export function checkSimulatedReaderAccess(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    console.error('[simulated-reader] BLOCKED: Simulated reader route called in production')
    return NextResponse.json(
      { error: 'Simulated reader is not available in production' },
      { status: 403 }
    )
  }
  return null
}
