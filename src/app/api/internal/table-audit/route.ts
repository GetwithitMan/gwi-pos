import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/system-config'
import { withVenue } from '@/lib/with-venue'
import { SYNC_MODELS, LOCAL_ONLY_TABLES, SYSTEM_TABLES } from '@/lib/sync/sync-config'
import { readSchemaState } from '@/lib/venue-schema-state'
import { EXPECTED_SCHEMA_VERSION, EXPECTED_SEED_VERSION, PROVISIONER_VERSION } from '@/lib/version-contract'

/**
 * GET /api/internal/table-audit
 *
 * Diagnostic endpoint that compares actual PostgreSQL tables against
 * the sync-config registry. Returns a JSON report showing coverage
 * gaps in both directions (DB tables missing from config, config
 * entries missing from DB).
 *
 * Headers:
 *   x-api-key: PROVISION_API_KEY or INTERNAL_API_KEY
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  // ── Auth: require internal API key ──────────────────────────────────
  const apiKey = request.headers.get('x-api-key')
  const validKey = config.provisionApiKey || process.env.INTERNAL_API_KEY
  if (!apiKey || !validKey || apiKey !== validKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { db } = await import('@/lib/db')

    // ── 1. Actual PostgreSQL tables ─────────────────────────────────
    const tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    )
    const actualTableNames = tables.map(t => t.table_name)
    const actualSet = new Set(actualTableNames)

    // ── 2. Registered tables from sync-config ───────────────────────
    const syncModelNames = Object.keys(SYNC_MODELS)
    const localOnlyNames = [...LOCAL_ONLY_TABLES]
    const systemTableNames = [...SYSTEM_TABLES]

    // All configured names (union of all three lists)
    const allConfigured = new Set([
      ...syncModelNames,
      ...localOnlyNames,
      ...systemTableNames,
    ])

    // ── 3. Gap analysis ─────────────────────────────────────────────
    // Tables in DB but not in any config list
    const unregistered = actualTableNames.filter(t => !allConfigured.has(t))

    // Tables in config lists but not in DB (stale entries)
    const staleEntries: Array<{ name: string; list: string }> = []
    for (const name of syncModelNames) {
      if (!actualSet.has(name)) {
        staleEntries.push({ name, list: 'SYNC_MODELS' })
      }
    }
    for (const name of localOnlyNames) {
      if (!actualSet.has(name)) {
        staleEntries.push({ name, list: 'LOCAL_ONLY_TABLES' })
      }
    }
    for (const name of systemTableNames) {
      if (!actualSet.has(name)) {
        staleEntries.push({ name, list: 'SYSTEM_TABLES' })
      }
    }

    // ── 4. Schema state ─────────────────────────────────────────────
    const schemaState = await readSchemaState(db)

    // ── 5. Build report ─────────────────────────────────────────────
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalDbTables: actualTableNames.length,
        syncModels: syncModelNames.length,
        localOnlyTables: localOnlyNames.length,
        systemTables: systemTableNames.length,
        unregisteredCount: unregistered.length,
        staleEntryCount: staleEntries.length,
      },
      actualDbTables: actualTableNames,
      syncModels: syncModelNames.sort(),
      localOnlyTables: localOnlyNames.sort(),
      systemTables: systemTableNames.sort(),
      unregistered,
      staleEntries,
      schemaState: schemaState ?? null,
      expectedVersions: {
        schemaVersion: EXPECTED_SCHEMA_VERSION,
        seedVersion: EXPECTED_SEED_VERSION,
        provisionerVersion: PROVISIONER_VERSION,
      },
    })
  } catch (error) {
    console.error('[table-audit] Failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Table audit failed' },
      { status: 500 }
    )
  }
})
