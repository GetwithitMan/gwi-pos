import { NextRequest, NextResponse } from 'next/server'
import { hasNeonConnection } from '@/lib/neon-client'
import { getUpstreamSyncMetrics } from '@/lib/sync/upstream-sync-worker'
import { getDownstreamSyncMetrics } from '@/lib/sync/downstream-sync-worker'

export async function GET(request: NextRequest) {
  // Internal route — require INTERNAL_API_SECRET or admin session
  const authHeader = request.headers.get('x-internal-secret') || request.headers.get('x-api-key')
  const expectedSecret = process.env.INTERNAL_API_SECRET
  if (expectedSecret && authHeader !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const syncEnabled = process.env.SYNC_ENABLED === 'true'
  const neonConnected = hasNeonConnection()

  const upstream = syncEnabled ? getUpstreamSyncMetrics() : null
  const downstream = syncEnabled ? getDownstreamSyncMetrics() : null

  return NextResponse.json({
    mode: syncEnabled ? 'offline-first' : 'cloud-direct',
    syncEnabled,
    neonConnected,
    upstream: upstream
      ? {
          running: upstream.running,
          lastSyncAt: upstream.lastSyncAt?.toISOString() ?? null,
          pendingCount: upstream.pendingCount,
          rowsSyncedTotal: upstream.rowsSyncedTotal,
          errorCount: upstream.errorCount,
        }
      : null,
    downstream: downstream
      ? {
          running: downstream.running,
          lastSyncAt: downstream.lastSyncAt?.toISOString() ?? null,
          rowsSyncedTotal: downstream.rowsSyncedTotal,
          conflictCount: downstream.conflictCount,
        }
      : null,
  })
}
