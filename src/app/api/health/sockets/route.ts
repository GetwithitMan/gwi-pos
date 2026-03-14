import { NextResponse } from 'next/server'
import { getSocketHealthMetrics } from '@/lib/socket-server'
import { getQueueSize } from '@/lib/socket-ack-queue'
import { getLatestEventId } from '@/lib/socket-event-buffer'
import { getUpstreamSyncMetrics } from '@/lib/sync/upstream-sync-worker'
import { getDownstreamSyncMetrics } from '@/lib/sync/downstream-sync-worker'
import { getOutageReplayMetrics } from '@/lib/sync/outage-replay-worker'

export const dynamic = 'force-dynamic'

export async function GET() {
  const socketHealth = getSocketHealthMetrics()
  const ackQueueSize = getQueueSize()
  const upstreamMetrics = getUpstreamSyncMetrics()
  const downstreamMetrics = getDownstreamSyncMetrics()
  const outageMetrics = getOutageReplayMetrics()

  // Try to get relay health (may not be available if Phase 3 not deployed)
  let relayStatus: Record<string, unknown> = { connected: false, note: 'relay not configured' }
  try {
    const { getRelayHealth } = await import('@/lib/cloud-relay-client')
    const health = getRelayHealth()
    relayStatus = {
      connected: health.connected,
      consecutiveFailures: health.consecutiveFailures,
      lastPing: health.lastPingAt ? formatAge(health.lastPingAt) : null,
      fallbackIntervalMs: health.currentFallbackInterval,
    }
  } catch {
    // cloud-relay-client not available yet — that's fine
  }

  const locationId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID || ''
  const latestEventId = getLatestEventId(locationId)

  return NextResponse.json({
    connectedClients: socketHealth.connectedClients,
    eventThroughput: socketHealth.eventThroughput,
    ackQueue: {
      pending: ackQueueSize,
    },
    eventBuffer: {
      latestEventId,
    },
    reconnections: socketHealth.reconnections,
    cfdPairings: socketHealth.cfdPairings,
    relayStatus,
    sync: {
      upstream: {
        lastSyncAt: upstreamMetrics.lastSyncAt?.toISOString() ?? null,
        pendingCount: upstreamMetrics.pendingCount,
        rowsSyncedTotal: upstreamMetrics.rowsSyncedTotal,
        errorCount: upstreamMetrics.errorCount,
      },
      downstream: {
        lastSyncAt: downstreamMetrics.lastSyncAt?.toISOString() ?? null,
        rowsSyncedTotal: downstreamMetrics.rowsSyncedTotal,
        conflictCount: downstreamMetrics.conflictCount,
      },
      outage: {
        running: outageMetrics.running,
        replayedCount: outageMetrics.replayedCount,
        conflictCount: outageMetrics.conflictCount,
        failedCount: outageMetrics.failedCount,
        lastReplayAt: outageMetrics.lastReplayAt?.toISOString() ?? null,
      },
    },
  })
}

function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime()
  if (ms < 1000) return 'just now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}
