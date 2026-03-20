/**
 * Venue Bootstrap — Local PG Initialization
 *
 * Runs once at server startup, before sync workers.
 * Checks local PG, reads schema state, verifies Neon readiness.
 *
 * AUTHORITY MODEL:
 * - MC/Neon owns: _venue_schema_state, schema version, provisioning state
 * - NUC owns: local PG, local migrations (_gwi_migrations), _local_schema_state
 * - Bootstrap: OBSERVES Neon state, REPORTS to MC, NEVER MUTATES Neon in production
 *
 * If Neon schema is broken/empty in production, bootstrap blocks sync and logs error.
 * MC must repair via its provisioning pipeline.
 *
 * Dev/test environments retain auto-repair for convenience (applySchemaToEmptyDb).
 */

import { existsSync } from 'fs'
import path from 'path'
import { createChildLogger } from '@/lib/logger'
import { config } from '@/lib/system-config'
import { EXPECTED_SCHEMA_VERSION, EXPECTED_SEED_VERSION, PROVISIONER_VERSION, APP_VERSION } from '@/lib/version-contract'
import { ensureSchemaStateTable, readSchemaState, writeSchemaState, markRepair } from '@/lib/venue-schema-state'
import { checkBaseSeedPresent } from '@/lib/base-seed-check'

const log = createChildLogger('venue-bootstrap')

// ---------------------------------------------------------------------------
// _local_schema_state — NUC-owned local PG tracking (NOT Neon)
//
// This table lives in LOCAL PG only. It records what the NUC knows about its
// own state: which schema version it last observed, which migrations it ran,
// and what the observed Neon state was at boot time.
//
// _venue_schema_state (Neon) is MC-owned. _local_schema_state (local PG) is NUC-owned.
// ---------------------------------------------------------------------------

interface LocalSchemaState {
  schemaVersion: string      // EXPECTED_SCHEMA_VERSION this NUC was built for
  observedNeonVersion: string | null  // What Neon reported at last boot (null if unreachable)
  appVersion: string
  bootedAt: Date
  neonReachable: boolean
  syncBlocked: boolean       // true if bootstrap determined sync is unsafe
  blockReason: string | null // human-readable reason for sync block
}

async function ensureLocalSchemaStateTable(
  client: { $executeRawUnsafe: (sql: string) => Promise<unknown> }
): Promise<void> {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_local_schema_state" (
      "id"                    INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      "schemaVersion"         TEXT NOT NULL,
      "observedNeonVersion"   TEXT,
      "appVersion"            TEXT,
      "bootedAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "neonReachable"         BOOLEAN NOT NULL DEFAULT false,
      "syncBlocked"           BOOLEAN NOT NULL DEFAULT false,
      "blockReason"           TEXT,
      "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function writeLocalSchemaState(
  client: { $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown> },
  state: LocalSchemaState
): Promise<void> {
  await ensureLocalSchemaStateTable(client)
  await client.$executeRawUnsafe(`
    INSERT INTO "_local_schema_state" (
      "id", "schemaVersion", "observedNeonVersion", "appVersion",
      "bootedAt", "neonReachable", "syncBlocked", "blockReason", "updatedAt"
    ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (id) DO UPDATE SET
      "schemaVersion" = $1,
      "observedNeonVersion" = $2,
      "appVersion" = $3,
      "bootedAt" = $4,
      "neonReachable" = $5,
      "syncBlocked" = $6,
      "blockReason" = $7,
      "updatedAt" = NOW()
  `,
    state.schemaVersion,
    state.observedNeonVersion,
    state.appVersion,
    state.bootedAt,
    state.neonReachable,
    state.syncBlocked,
    state.blockReason,
  )
}

// Core tables that must exist for a functional POS
const CORE_TABLES = [
  'Location', 'Role', 'Employee', 'Order', 'Category',
  'MenuItem', 'OrderItem', 'ModifierGroup', 'Modifier',
  'Terminal', 'Section', 'Table',
]

// Required enums
const REQUIRED_ENUMS = ['TabStatus', 'OrderStatus', 'CategoryType', 'FulfillmentType']

export interface SchemaReadiness {
  schemaVersionMatch: boolean
  schemaVersionBehind: boolean
  schemaVersionAhead: boolean
  coreTablesExist: boolean
  requiredEnumsExist: boolean
  baseSeedPresent: boolean
  schemaVersion: string | null
  seedVersion: string | null
}

export interface BootstrapResult {
  localDb: boolean
  localSchemaVersion: string | null
  neonReachable: boolean
  neonSchemaReady: SchemaReadiness | null
  neonRepaired: boolean
  seedDataPresent: boolean
  localBootOk: boolean  // local PG is up and basic Neon connectivity is ok — does NOT mean sync-safe
  syncContractReady: boolean  // matches POS sync-start gate exactly
  degradedReasons: string[]
}

let cachedResult: BootstrapResult | null = null

export function getBootstrapResult(): BootstrapResult | null {
  return cachedResult
}

async function checkCoreTablesExist(
  client: { $queryRawUnsafe: (sql: string) => Promise<unknown[]> }
): Promise<boolean> {
  for (const table of CORE_TABLES) {
    const rows = await client.$queryRawUnsafe(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '${table}'
    `)
    if (rows.length === 0) return false
  }
  return true
}

async function checkEnumsExist(
  client: { $queryRawUnsafe: (sql: string) => Promise<unknown[]> }
): Promise<boolean> {
  for (const enumName of REQUIRED_ENUMS) {
    const rows = await client.$queryRawUnsafe(`
      SELECT 1 FROM pg_type WHERE typname = '${enumName}'
    `)
    if (rows.length === 0) return false
  }
  return true
}

async function countTables(
  client: { $queryRawUnsafe: (sql: string) => Promise<unknown[]> }
): Promise<number> {
  const rows = await client.$queryRawUnsafe(`
    SELECT COUNT(*)::int as count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `) as Array<{ count: number }>
  return rows[0]?.count ?? 0
}

async function buildReadiness(
  client: { $queryRawUnsafe: (sql: string) => Promise<unknown[]> },
  state: { schemaVersion: string; seedVersion: string } | null
): Promise<SchemaReadiness> {
  const schemaVersion = state?.schemaVersion ?? null
  const seedVersion = state?.seedVersion ?? null
  const coreTablesExist = await checkCoreTablesExist(client)
  const requiredEnumsExist = await checkEnumsExist(client)
  const seedResult = await checkBaseSeedPresent(client)

  return {
    schemaVersionMatch: schemaVersion === EXPECTED_SCHEMA_VERSION,
    schemaVersionBehind: schemaVersion !== null && schemaVersion < EXPECTED_SCHEMA_VERSION,
    schemaVersionAhead: schemaVersion !== null && schemaVersion > EXPECTED_SCHEMA_VERSION,
    coreTablesExist,
    requiredEnumsExist,
    baseSeedPresent: seedResult.ok,
    schemaVersion,
    seedVersion,
  }
}

/**
 * Apply schema to an empty Neon DB via schema.sql (generated at build time).
 *
 * !! DEV/TEST ONLY — never called in production (guarded in runBootstrap). !!
 *
 * schema.sql is the complete DDL for all tables, enums, indexes, and constraints.
 * It's generated by `scripts/generate-schema-sql.mjs` during `npm run build`.
 *
 * NOTE: This function uses schema.sql, NOT numbered migrations. Numbered
 * migrations (scripts/migrations/NNN-*.js) are used by nuc-pre-migrate.js
 * during NUC boot for incremental schema updates. This function is a full
 * DDL apply for empty databases only.
 *
 * This is used ONLY for:
 *   1. Empty Neon DBs detected during bootstrap in DEV/TEST (0 tables)
 *   2. NEVER for upgrades (version behind -> version current)
 *   3. NEVER for partial schema repair (some tables exist but not all)
 *   4. NEVER in production — MC is the sole Neon schema authority
 *
 * If you find yourself reaching for this in a new context, STOP and
 * create a proper migration in scripts/migrations/ instead.
 */
async function applySchemaToEmptyDb(
  client: {
    $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown>
    $queryRawUnsafe: (sql: string) => Promise<unknown[]>
  }
): Promise<void> {
  // Load schema SQL from best available source
  const publicPath = path.join(process.cwd(), 'public/schema.sql')
  const prismaPath = path.join(process.cwd(), 'prisma/schema.sql')
  const schemaPath = existsSync(publicPath) ? publicPath : existsSync(prismaPath) ? prismaPath : null
  if (!schemaPath) {
    throw new Error(
      'Cannot repair empty DB: neither public/schema.sql nor prisma/schema.sql found. ' +
      'These files are generated at build time by generate-schema-sql.mjs.'
    )
  }

  log.info({ source: schemaPath.includes('public') ? 'public/schema.sql' : 'prisma/schema.sql' }, 'Applying schema to empty Neon DB')
  const { readFileSync } = await import('fs')
  const sql = readFileSync(schemaPath, 'utf-8')
  await client.$executeRawUnsafe(sql)
  log.info('Schema applied successfully')
}

export async function runBootstrap(): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    localDb: false,
    localSchemaVersion: null,
    neonReachable: false,
    neonSchemaReady: null,
    neonRepaired: false,
    seedDataPresent: false,
    localBootOk: false,
    syncContractReady: false,
    degradedReasons: [],
  }

  try {
    // 1. Check local PG
    const { masterClient } = await import('@/lib/db')
    try {
      await masterClient.$queryRawUnsafe('SELECT 1')
      result.localDb = true
    } catch (err) {
      log.error({ err }, 'Local PG check failed')
      cachedResult = result
      return result
    }

    // 2. Read local _venue_schema_state
    const localState = await readSchemaState(masterClient)
    result.localSchemaVersion = localState?.schemaVersion ?? null

    // 3. Check Neon if configured
    const neonUrl = process.env.NEON_DATABASE_URL
    if (neonUrl) {
      try {
        // PrismaPg everywhere — transient bootstrap connections (not persistent pools).
        // These are short-lived and fall under CONNECTION_BUDGET.LOCAL_RESERVED headroom.
        const { PrismaClient } = await import('@/generated/prisma/client')
        const directUrl = process.env.NEON_DIRECT_URL || neonUrl
        let neonAdapter: any
        if (process.env.VERCEL) {
          const { PrismaPg } = await import('@prisma/adapter-pg')
          neonAdapter = new PrismaPg({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 60000 })
        } else {
          const { PrismaPg } = await import('@prisma/adapter-pg')
          neonAdapter = new PrismaPg({ connectionString: directUrl, max: 2 })
        }
        const neonClient = new PrismaClient({ adapter: neonAdapter })

        try {
          await neonClient.$queryRawUnsafe('SELECT 1')
          result.neonReachable = true

          // Backup/standby: read-only observation only — NEVER mutate Neon
          if (config.stationRole === 'backup') {
            log.info('Station is BACKUP — Neon observation only (no mutations)')
            const neonState = await readSchemaState(neonClient)
            result.neonSchemaReady = await buildReadiness(neonClient, neonState)
            result.degradedReasons.push('backup-readonly-mode')
            // Skip all mutation paths below
          } else {
            // Primary: full check + conditional repair
            const neonState = await readSchemaState(neonClient)
            const tableCount = await countTables(neonClient)

            if (!neonState && tableCount === 0) {
              if (process.env.NODE_ENV === 'production') {
                // PRODUCTION: NUC must NOT mutate Neon schema. MC is the sole authority.
                // Block sync and report the issue for MC to repair via its provisioning pipeline.
                log.error(
                  { worker: 'venue-bootstrap', tableCount: 0 },
                  '[bootstrap] Neon schema is empty — MC must provision this venue. NUC will not mutate Neon in production.'
                )
                result.neonSchemaReady = await buildReadiness(neonClient, null)
                result.degradedReasons.push('neon-empty-needs-mc-provision')
              } else {
                // DEV/TEST: auto-repair via schema.sql for convenience
                log.info('Neon DB is empty — running auto-repair via schema.sql (full DDL apply) [dev/test only]')
                try {
                  await applySchemaToEmptyDb(neonClient)
                  await ensureSchemaStateTable(neonClient)
                  await writeSchemaState(neonClient, {
                    schemaVersion: EXPECTED_SCHEMA_VERSION,
                    seedVersion: EXPECTED_SEED_VERSION,
                    provisionerVersion: PROVISIONER_VERSION,
                    provisionedAt: new Date(),
                    provisionedBy: 'nuc-bootstrap',
                    appVersion: APP_VERSION,
                  })
                  await markRepair(neonClient, 'nuc-bootstrap', 'bootstrap-empty-db')
                  result.neonRepaired = true
                  result.neonSchemaReady = await buildReadiness(neonClient, {
                    schemaVersion: EXPECTED_SCHEMA_VERSION,
                    seedVersion: EXPECTED_SEED_VERSION,
                  })
                } catch (repairErr) {
                  log.error({ err: repairErr }, 'Auto-repair of empty Neon DB failed')
                  result.neonSchemaReady = await buildReadiness(neonClient, null)
                }
              }
            } else if (!neonState && tableCount > 0) {
              // Tables exist but no _venue_schema_state — likely Vercel ran prisma db push
              // or MC provisioned without writing state.
              if (process.env.NODE_ENV === 'production') {
                // PRODUCTION: Do NOT write _venue_schema_state from NUC. MC owns that table.
                // Observe the actual DB state and report as unverified. Sync eligibility
                // depends on core table + enum checks from buildReadiness().
                log.warn(
                  { tableCount, expectedSchema: EXPECTED_SCHEMA_VERSION },
                  '[bootstrap] Neon has tables but no _venue_schema_state — NUC cannot verify schema version. MC must write state. Sync may be blocked.'
                )
                result.neonSchemaReady = await buildReadiness(neonClient, null)
                result.degradedReasons.push('neon-schema-state-missing-needs-mc')
              } else {
                // DEV/TEST: backfill _venue_schema_state for convenience, but mark as UNVERIFIED
                log.warn(
                  { tableCount, expectedSchema: EXPECTED_SCHEMA_VERSION },
                  'Neon DB has tables but no _venue_schema_state — backfilling as UNVERIFIED [dev/test only]'
                )
                try {
                  await ensureSchemaStateTable(neonClient)
                  await writeSchemaState(neonClient, {
                    schemaVersion: 'UNVERIFIED',
                    seedVersion: 'UNVERIFIED',
                    provisionerVersion: PROVISIONER_VERSION,
                    provisionedAt: new Date(),
                    provisionedBy: 'nuc-bootstrap-unverified',
                    appVersion: APP_VERSION,
                  })
                  result.neonSchemaReady = await buildReadiness(neonClient, {
                    schemaVersion: 'UNVERIFIED',
                    seedVersion: 'UNVERIFIED',
                  })
                  result.degradedReasons.push('schema-state-backfilled-unverified')
                  log.warn('Created _venue_schema_state for existing Neon DB — marked as UNVERIFIED backfill')
                } catch (backfillErr) {
                  log.error({ err: backfillErr }, 'Failed to create _venue_schema_state — falling back to degraded')
                  result.neonSchemaReady = await buildReadiness(neonClient, null)
                }
              }
            } else if (neonState) {
              // State exists -- check versions
              if (neonState.schemaVersion < EXPECTED_SCHEMA_VERSION) {
                // Neon is behind — this is MC's responsibility to fix.
                // NUC cannot and should not advance Neon schema.
                // Report the issue and block sync until MC pushes the update.
                log.error({
                  worker: 'venue-bootstrap',
                  expected: EXPECTED_SCHEMA_VERSION,
                  actual: neonState.schemaVersion,
                }, 'Neon schema version behind — sync blocked. MC must push schema update to this venue.')
                result.neonSchemaReady = await buildReadiness(neonClient, neonState)
                result.degradedReasons.push('neon-schema-behind')
              } else if (neonState.schemaVersion > EXPECTED_SCHEMA_VERSION) {
                log.warn(
                  { expected: EXPECTED_SCHEMA_VERSION, actual: neonState.schemaVersion },
                  'Neon schema version ahead of this POS build — safe to proceed'
                )
                result.neonSchemaReady = await buildReadiness(neonClient, neonState)
              } else {
                // Versions match
                result.neonSchemaReady = await buildReadiness(neonClient, neonState)
              }

              // Flag degraded if too many repairs
              if (neonState.repairCount >= 3) {
                log.warn({ repairCount: neonState.repairCount, lastReason: neonState.lastRepairReason },
                  'Neon DB has been repaired 3+ times — marking as degraded')
                result.degradedReasons.push('repeated-schema-repair')
              }
            }
          } // close primary else block
        } finally {
          await neonClient.$disconnect()
        }
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : err }, 'Neon unreachable — operating in local-only mode')
        result.neonReachable = false
        result.degradedReasons.push('neon-unreachable')
      }
    }

    // 4. Check local seed
    const seedResult = await checkBaseSeedPresent(masterClient)
    result.seedDataPresent = seedResult.ok
    if (!seedResult.ok) {
      log.warn({ missing: seedResult.missing }, 'Base seed data incomplete')
      result.degradedReasons.push('seed-data-missing')
    }

    // 5. Determine overall readiness
    const neonOk = !neonUrl || (result.neonSchemaReady?.coreTablesExist ?? true)
    result.localBootOk = result.localDb && neonOk

    // syncContractReady: matches the exact contract server.ts uses for sync workers
    // Schema version: match OR ahead is OK (Vercel deployed newer schema). Only "behind" blocks sync.
    const nsr = result.neonSchemaReady
    const schemaVersionOk = !!nsr && (nsr.schemaVersionMatch || nsr.schemaVersionAhead)
    result.syncContractReady = result.localDb && !!neonUrl && result.neonReachable && !!nsr &&
      nsr.coreTablesExist && nsr.requiredEnumsExist && schemaVersionOk && nsr.baseSeedPresent

    // 6. Write _local_schema_state to local PG (NUC-owned, never Neon)
    // This records what the NUC observed at boot for diagnostics and MC reporting.
    try {
      const { masterClient: localClient } = await import('@/lib/db')
      const syncBlocked = !result.syncContractReady
      const blockReasons = result.degradedReasons.length > 0 ? result.degradedReasons.join(', ') : null
      await writeLocalSchemaState(localClient, {
        schemaVersion: EXPECTED_SCHEMA_VERSION,
        observedNeonVersion: result.neonSchemaReady?.schemaVersion ?? null,
        appVersion: APP_VERSION,
        bootedAt: new Date(),
        neonReachable: result.neonReachable,
        syncBlocked,
        blockReason: syncBlocked ? blockReasons : null,
      })
      log.info('Local schema state written to _local_schema_state')
    } catch (localStateErr) {
      // Non-fatal — local state is diagnostic, not critical path
      log.warn({ err: localStateErr instanceof Error ? localStateErr.message : localStateErr },
        'Failed to write _local_schema_state — non-fatal, continuing')
    }

    log.info({
      localDb: result.localDb,
      localSchemaVersion: result.localSchemaVersion,
      neonReachable: result.neonReachable,
      neonRepaired: result.neonRepaired,
      neonSchemaVersion: result.neonSchemaReady?.schemaVersion ?? 'N/A',
      seedPresent: result.seedDataPresent,
      localBootOk: result.localBootOk,
    }, 'Bootstrap complete')

    cachedResult = result
    return result
  } catch (err) {
    log.error({ err }, 'Bootstrap failed with unexpected error')
    cachedResult = result
    return result
  }
}
