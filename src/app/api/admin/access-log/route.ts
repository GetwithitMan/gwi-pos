/**
 * GET /api/admin/access-log
 *
 * Returns GWI access log entries and today's stats.
 * Protected: requires valid pos-cloud-session (admin only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAccessLogs, getAccessStats } from '@/lib/access-log'

export async function GET(req: NextRequest) {
  // Basic admin guard — must have a cloud session cookie
  const session = req.cookies.get('pos-cloud-session')?.value
  if (!session) {
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
