import { NextResponse } from 'next/server'
import { config } from '@/lib/system-config'
import { getBootstrapResult } from '@/lib/venue-bootstrap'
import { getWorkerHealth } from '@/lib/worker-registry'
import { getReadinessState } from '@/lib/readiness'

/**
 * GET /api/internal/nuc-readiness
 *
 * Returns the exact normalized readiness structure that heartbeat needs.
 * Replaces shell/Python JSON reshaping in heartbeat.sh.
 * Auth: x-api-key header.
 */
export async function GET(request: Request) {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== config.provisionApiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const bootstrap = getBootstrapResult()
  const workers = getWorkerHealth()
  const nr = bootstrap?.neonSchemaReady
  const readiness = getReadinessState()

  // Determine if sync workers are running
  const syncRunning = workers.some(
    (w: { name: string; running: boolean }) =>
      w.name.toLowerCase().includes('sync') && w.running
  )

  return NextResponse.json({
    // Canonical readiness level — ONE source of truth
    readinessLevel: readiness?.level ?? null,
    syncContractReady: readiness?.syncContractReady ?? false,
    initialSyncComplete: readiness?.initialSyncComplete ?? false,
    // Existing fields (kept for backward compat with heartbeat consumers)
    localDb: bootstrap?.localDb ?? false,
    neonReachable: bootstrap?.neonReachable ?? false,
    neonSchemaVersion: nr?.schemaVersion ?? null,
    seedVersion: nr?.seedVersion ?? null,
    baseSeedPresent: bootstrap?.seedDataPresent ?? false,
    schemaBehind: nr?.schemaVersionBehind ?? false,
    schemaAhead: nr?.schemaVersionAhead ?? false,
    syncWorkers: syncRunning,
    coreTablesExist: nr?.coreTablesExist ?? false,
    requiredEnumsExist: nr?.requiredEnumsExist ?? false,
    schemaVersionMatch: nr?.schemaVersionMatch ?? false,
  })
}
