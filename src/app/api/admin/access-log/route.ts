/**
 * GET /api/admin/access-log
 *
 * Returns GWI access log entries and today's stats.
 * Protected: requires valid pos-cloud-session (admin only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAccessLogs, getAccessStats } from '@/lib/access-log'

export async function GET(req: NextRequest) {
  // Accept either a cloud session cookie (admin UI) or INTERNAL_API_SECRET bearer token (MC proxy)
  const session = req.cookies.get('pos-cloud-session')?.value
  const bearer = req.headers.get('authorization')
  const internalSecret = process.env.INTERNAL_API_SECRET
  const hasBearerAuth = internalSecret && bearer === `Bearer ${internalSecret}`

  if (!session && !hasBearerAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limitParam = req.nextUrl.searchParams.get('limit')
  const limit = Math.min(parseInt(limitParam ?? '100', 10), 500)

  const [logs, stats] = await Promise.all([
    getAccessLogs(limit),
    getAccessStats(),
  ])

  return NextResponse.json({ logs, stats })
}
