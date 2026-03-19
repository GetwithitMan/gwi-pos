/**
 * Venue Schema State — owned contract for _venue_schema_state table.
 *
 * Single owner. No other module should read or write this table directly.
 * Tracks schema version, seed version, provisioner version, and repair history.
 */

import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('venue-schema-state')

export interface VenueSchemaState {
  schemaVersion: string
  seedVersion: string
  provisionerVersion: string | null
  provisionedAt: Date | null
  provisionedBy: string | null   // "mc-pipeline" | "nuc-bootstrap" | "vercel-build"
  lastRepairAt: Date | null
  lastRepairBy: string | null
  lastRepairReason: string | null // "bootstrap-empty-db" | "manual-repair" | "heartbeat-retry" | "deploy-upgrade"
  repairCount: number
  appVersion: string | null
}

/**
 * Ensure the _venue_schema_state table exists. Idempotent.
 */
export async function ensureSchemaStateTable(client: { $executeRawUnsafe: (sql: string) => Promise<unknown> }): Promise<void> {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_venue_schema_state" (
      "id"                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      "schemaVersion"       TEXT NOT NULL,
      "seedVersion"         TEXT NOT NULL DEFAULT 'v1',
      "provisionerVersion"  TEXT,
      "provisionedAt"       TIMESTAMPTZ,
      "provisionedBy"       TEXT,
      "lastRepairAt"        TIMESTAMPTZ,
      "lastRepairBy"        TEXT,
      "lastRepairReason"    TEXT,
      "repairCount"         INTEGER NOT NULL DEFAULT 0,
      "appVersion"          TEXT,
      "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

/**
 * Read the current schema state. Returns null if table or row doesn't exist.
 */
export async function readSchemaState(
  client: { $queryRawUnsafe: (sql: string) => Promise<unknown[]> }
): Promise<VenueSchemaState | null> {
  try {
    const rows = await client.$queryRawUnsafe(`
      SELECT "schemaVersion", "seedVersion", "provisionerVersion",
             "provisionedAt", "provisionedBy",
             "lastRepairAt", "lastRepairBy", "lastRepairReason",
             "repairCount", "appVersion"
      FROM "_venue_schema_state"
      WHERE id = 1
    `) as VenueSchemaState[]
    if (rows.length === 0) return null
    return {
      ...rows[0],
      repairCount: Number(rows[0].repairCount),
    }
  } catch {
    // Table doesn't exist yet
    return null
  }
}

/**
 * Write or overwrite the schema state row (upsert).
 */
export async function writeSchemaState(
  client: { $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown> },
  state: Omit<VenueSchemaState, 'repairCount' | 'lastRepairAt' | 'lastRepairBy' | 'lastRepairReason'> & Partial<Pick<VenueSchemaState, 'repairCount' | 'lastRepairAt' | 'lastRepairBy' | 'lastRepairReason'>>
): Promise<void> {
  await ensureSchemaStateTable(client)
  await client.$executeRawUnsafe(`
    INSERT INTO "_venue_schema_state" (
      "id", "schemaVersion", "seedVersion", "provisionerVersion",
      "provisionedAt", "provisionedBy",
      "lastRepairAt", "lastRepairBy", "lastRepairReason",
      "repairCount", "appVersion", "updatedAt"
    ) VALUES (
      1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      "schemaVersion" = $1,
      "seedVersion" = $2,
      "provisionerVersion" = $3,
      "provisionedAt" = COALESCE($4, "_venue_schema_state"."provisionedAt"),
      "provisionedBy" = COALESCE($5, "_venue_schema_state"."provisionedBy"),
      "lastRepairAt" = COALESCE($6, "_venue_schema_state"."lastRepairAt"),
      "lastRepairBy" = COALESCE($7, "_venue_schema_state"."lastRepairBy"),
      "lastRepairReason" = COALESCE($8, "_venue_schema_state"."lastRepairReason"),
      "repairCount" = COALESCE($9, "_venue_schema_state"."repairCount"),
      "appVersion" = $10,
      "updatedAt" = NOW()
  `,
    state.schemaVersion,
    state.seedVersion,
    state.provisionerVersion ?? null,
    state.provisionedAt ?? null,
    state.provisionedBy ?? null,
    state.lastRepairAt ?? null,
    state.lastRepairBy ?? null,
    state.lastRepairReason ?? null,
    state.repairCount ?? 0,
    state.appVersion ?? null,
  )
  log.info({ schemaVersion: state.schemaVersion, seedVersion: state.seedVersion, provisionerVersion: state.provisionerVersion }, 'Schema state written')
}

/**
 * Record a repair event. Increments repairCount.
 */
export async function markRepair(
  client: { $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown> },
  repairedBy: string,
  reason: string
): Promise<void> {
  await client.$executeRawUnsafe(`
    UPDATE "_venue_schema_state"
    SET "lastRepairAt" = NOW(),
        "lastRepairBy" = $1,
        "lastRepairReason" = $2,
        "repairCount" = "repairCount" + 1,
        "updatedAt" = NOW()
    WHERE id = 1
  `, repairedBy, reason)
  log.info({ repairedBy, reason }, 'Schema repair recorded')
}
