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

// ── Module-level verification state ──────────────────────────────────────────
// Other modules (e.g., server.ts worker registration) can check this flag
// to decide whether to start sync workers. Defaults to null (not yet run).
let _lastSchemaResult: SchemaCheckResult | null = null

/** Returns the most recent schema verification result, or null if not yet run. */
export function getSchemaVerificationResult(): SchemaCheckResult | null {
  return _lastSchemaResult
}

/** Returns true only if schema verification has run AND passed. */
export function isSchemaVerified(): boolean {
  return _lastSchemaResult?.passed === true
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
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
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
    _lastSchemaResult = result
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
  _lastSchemaResult = result
  return result
}
