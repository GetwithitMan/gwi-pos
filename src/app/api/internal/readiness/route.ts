import { NextResponse } from 'next/server'
import { config } from '@/lib/system-config'
import { getBootstrapResult } from '@/lib/venue-bootstrap'
import { EXPECTED_SCHEMA_VERSION, EXPECTED_SEED_VERSION, PROVISIONER_VERSION, APP_VERSION } from '@/lib/version-contract'
import { getWorkerHealth } from '@/lib/worker-registry'

export async function GET(request: Request) {
  // Auth check
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== config.provisionApiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const bootstrap = getBootstrapResult()
  const workers = getWorkerHealth()

  return NextResponse.json({
    ready: bootstrap?.ready ?? false,
    syncContractReady: bootstrap?.syncContractReady ?? false,
    degradedReasons: bootstrap?.degradedReasons ?? [],
    bootstrap: bootstrap ?? null,
    versions: {
      expected: {
        schemaVersion: EXPECTED_SCHEMA_VERSION,
        seedVersion: EXPECTED_SEED_VERSION,
        provisionerVersion: PROVISIONER_VERSION,
      },
      app: APP_VERSION,
    },
    workers,
    config: {
      syncEnabled: config.syncEnabled,
      stationRole: config.stationRole,
      neonConfigured: !!config.neonDatabaseUrl,
      posLocationId: config.posLocationId ?? null,
    },
  })
}
