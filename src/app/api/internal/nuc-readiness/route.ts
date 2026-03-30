import { config } from '@/lib/system-config'
import { getBootstrapResult, getSchemaRecheckCount } from '@/lib/venue-bootstrap'
import { getWorkerHealth } from '@/lib/worker-registry'
import { getReadinessState } from '@/lib/readiness'
import { isInOutageMode } from '@/lib/sync/upstream-sync-worker'
import { EXPECTED_SCHEMA_VERSION } from '@/lib/version-contract'
import { ok, unauthorized } from '@/lib/api-response'

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
    return unauthorized('Unauthorized')
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

  // Determine sync block state for MC visibility
  const syncBlocked = !readiness?.syncContractReady && (bootstrap?.degradedReasons?.length ?? 0) > 0
  const syncBlockReason = syncBlocked
    ? (bootstrap?.degradedReasons?.join(', ') ?? null)
    : null

  // Filter stale neon warnings if sync workers are actually running
  // (same logic as dashboard/system-overview for consistency)
  let degradedReasons = bootstrap?.degradedReasons ?? []
  if (!isInOutageMode() && syncRunning) {
    degradedReasons = degradedReasons.filter(
      (r: string) => r !== 'neon-unreachable' &&
        r !== 'neon-schema-version-incompatible' &&
        r !== 'neon-core-tables-missing' &&
        r !== 'neon-required-enums-missing' &&
        r !== 'base-seed-missing'
    )
  }

  // Report actual readiness level (ORDERS if at ORDERS, not stale BOOT)
  const actualLevel = readiness?.level ?? null

  return ok({
    // Canonical readiness level — ONE source of truth
    readinessLevel: actualLevel,
    syncContractReady: readiness?.syncContractReady ?? false,
    initialSyncComplete: readiness?.initialSyncComplete ?? false,
    // Schema block reporting — MC uses these to auto-remediate
    syncBlocked: degradedReasons.length > 0 && !readiness?.syncContractReady,
    syncBlockReason: degradedReasons.length > 0 ? degradedReasons.join(', ') : null,
    expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
    observedNeonSchemaVersion: nr?.schemaVersion ?? 'unknown',
    schemaRecheckCount: getSchemaRecheckCount(),
    degradedReasons,
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
