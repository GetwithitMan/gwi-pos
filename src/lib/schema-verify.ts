/**
 * Startup Schema Verification
 *
 * On server boot, verifies that all critical tables and columns exist
 * in the local PostgreSQL database. If something is missing, logs a
 * clear error with the exact table/column that's missing.
 *
 * This catches the case where code expects a column that doesn't exist
 * (e.g., after a rollback that somehow skipped migrations).
 */

import { masterClient } from './db'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('schema-verify')

interface SchemaCheckResult {
  passed: boolean
  missing: Array<{ table: string; column?: string }>
  checked: number
  /** When verification itself throws, the error message is captured here */
  error?: string
}

// ── Shared singleton state via globalThis ────────────────────────────────────
// CRITICAL: server.js (esbuild) and Next.js API routes (Turbopack/Webpack) load
// separate module copies. A module-level `let _lastSchemaResult` creates TWO
// independent singletons — server.ts sets one, API routes read the other (always null).
// Using globalThis ensures both module systems share the same schema verification state.

declare global {
  // eslint-disable-next-line no-var
  var __gwi_schema_result: SchemaCheckResult | null | undefined
}

if (globalThis.__gwi_schema_result === undefined) {
  globalThis.__gwi_schema_result = null
}

/** Returns the most recent schema verification result, or null if not yet run. */
export function getSchemaVerificationResult(): SchemaCheckResult | null {
  return globalThis.__gwi_schema_result ?? null
}

/** Returns true only if schema verification has run AND passed. */
export function isSchemaVerified(): boolean {
  return globalThis.__gwi_schema_result?.passed === true
}

/**
 * Critical tables that MUST exist for the POS to function.
 * Maps table name → array of required columns.
 * This is NOT a full schema check — just the essentials.
 */
const CRITICAL_SCHEMA: Record<string, string[]> = {
  Order: ['id', 'locationId', 'status', 'updatedAt', 'syncedAt', 'lastMutatedBy'],
  OrderItem: ['id', 'orderId', 'locationId', 'updatedAt'],
  Payment: ['id', 'orderId', 'locationId', 'amount', 'status'],
  Employee: ['id', 'locationId', 'pin'],
  Location: ['id', 'name'],
  Organization: ['id'],
  MenuItem: ['id', 'categoryId', 'name', 'price'],
  Category: ['id', 'locationId', 'name'],
  Terminal: ['id', 'locationId'],
  Shift: ['id', 'locationId', 'employeeId'],
  FulfillmentEvent: ['id', 'locationId', 'orderId', 'status'],
  OutageQueueEntry: ['id', 'tableName', 'recordId', 'status'],
}

/**
 * Tables created by raw migrations (not Prisma-managed).
 * Missing = warn, but do NOT block sync. The migration runner will create them.
 * If these are in CRITICAL_SCHEMA, a fresh venue with pending migrations
 * will have sync permanently blocked.
 */
const ADVISORY_SCHEMA: Record<string, string[]> = {
  SocketEventLog: ['id', 'locationId', 'event', 'data', 'room'],
}

/**
 * Verify critical schema elements exist in local PG.
 * Called on server startup — non-blocking, logs warnings.
 */
export async function verifySchema(): Promise<SchemaCheckResult> {
  const missing: SchemaCheckResult['missing'] = []
  let checked = 0

  try {
    // Get all tables in public schema
    const tables = await masterClient.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    )
    const tableSet = new Set(tables.map(t => t.table_name))

    for (const [tableName, requiredColumns] of Object.entries(CRITICAL_SCHEMA)) {
      checked++

      if (!tableSet.has(tableName)) {
        missing.push({ table: tableName })
        continue
      }

      // Check required columns
      const columns = await masterClient.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        tableName
      )
      const columnSet = new Set(columns.map(c => c.column_name))

      for (const col of requiredColumns) {
        checked++
        if (!columnSet.has(col)) {
          missing.push({ table: tableName, column: col })
        }
      }
    }

    // Advisory check — warn but don't fail
    for (const [tableName, requiredColumns] of Object.entries(ADVISORY_SCHEMA)) {
      if (!tableSet.has(tableName)) {
        log.warn(`[SchemaVerify] Advisory: table "${tableName}" missing (created by migration, not Prisma). Sync will proceed; migration runner will create it.`)
        continue
      }
      const columns = await masterClient.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        tableName
      )
      const columnSet = new Set(columns.map(c => c.column_name))
      for (const col of requiredColumns) {
        if (!columnSet.has(col)) {
          log.warn(`[SchemaVerify] Advisory: column "${tableName}.${col}" missing. Migration runner should add it.`)
        }
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('[SCHEMA-VERIFY] CRITICAL: Schema verification failed to execute — proceeding in degraded mode')
    log.error({ err: errorMsg }, '[SchemaVerify] Failed to verify schema')

    // ALWAYS return passed: false when verification itself throws.
    // A broken verification must never look "verified".
    const isProduction = process.env.NODE_ENV === 'production'
    if (isProduction) {
      log.fatal('[SchemaVerify] FATAL: Schema verification error in production — sync workers must NOT start')
    }

    const result: SchemaCheckResult = {
      passed: false,
      missing: [{ table: '_VERIFICATION_ERROR' }],
      checked: 0,
      error: errorMsg,
    }
    globalThis.__gwi_schema_result = result
    return result
  }

  const passed = missing.length === 0

  if (!passed) {
    log.error('[SchemaVerify] CRITICAL: Missing schema elements:', missing)
    log.error('[SchemaVerify] This usually means migrations did not run. Check pre-start.sh logs.')
    if (process.env.NODE_ENV === 'production') {
      log.fatal({ missing }, '[SchemaVerify] FATAL: Schema missing critical elements in production — sync workers must NOT start')
    }
  } else {
    log.info(`[SchemaVerify] Schema OK — ${checked} elements verified`)
  }

  const result: SchemaCheckResult = { passed, missing, checked }
  globalThis.__gwi_schema_result = result
  return result
}
