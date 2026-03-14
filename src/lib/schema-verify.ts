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

interface SchemaCheckResult {
  passed: boolean
  missing: Array<{ table: string; column?: string }>
  checked: number
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
    console.error('[SchemaVerify] Failed to verify schema:', err instanceof Error ? err.message : err)
    return { passed: true, missing: [], checked: 0 } // Fail-open: don't block startup if check fails
  }

  const passed = missing.length === 0

  if (!passed) {
    console.error('[SchemaVerify] CRITICAL: Missing schema elements:', missing)
    console.error('[SchemaVerify] This usually means migrations did not run. Check pre-start.sh logs.')
  } else {
    console.log(`[SchemaVerify] Schema OK — ${checked} elements verified`)
  }

  return { passed, missing, checked }
}
