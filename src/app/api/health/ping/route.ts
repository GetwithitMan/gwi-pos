/**
 * Lightweight Health Ping
 *
 * Returns 200 with { ok: true } and no DB queries.
 * Used by offline-manager and NUC dashboard for 15s pings
 * instead of the full /api/health endpoint which runs
 * multiple DB queries and aggregations.
 *
 * GET /api/health/ping
 */

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true })
}
