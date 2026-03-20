/**
 * Migration 085: Cellular revocation persistence
 *
 * Ensures the CellularDevice table has the columns needed for persistent
 * revocation tracking:
 *   - revokedAt (TIMESTAMPTZ) — when the device was revoked
 *   - An index on status for fast deny list loading on startup
 *
 * The CellularDevice table itself was created in migration 045 with an enum
 * (CellularDeviceStatus) using uppercase values: REVOKED, QUARANTINED, etc.
 * This migration only adds the revokedAt column and status index if missing.
 *
 * Idempotent: all operations guarded by existence checks.
 */

const { tableExists, columnExists, indexExists } = require('../migration-helpers')

/** @param {import('@prisma/client').PrismaClient} prisma */
module.exports.up = async function up(prisma) {
  const PREFIX = '[085-cellular-revocation-persistence]'

  // Skip if CellularDevice table doesn't exist (pre-migration 045)
  const cdExists = await tableExists(prisma, 'CellularDevice')
  if (!cdExists) {
    console.log(`${PREFIX} CellularDevice table does not exist -- skipping (run migration 045 first)`)
    return
  }

  // ── Add revokedAt column ──────────────────────────────────────────────────
  const hasRevokedAt = await columnExists(prisma, 'CellularDevice', 'revokedAt')
  if (hasRevokedAt) {
    console.log(`${PREFIX} revokedAt column already exists -- skipping`)
  } else {
    console.log(`${PREFIX} Adding revokedAt column to CellularDevice...`)
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CellularDevice" ADD COLUMN "revokedAt" TIMESTAMPTZ`
    )
    console.log(`${PREFIX} Done -- revokedAt column added`)
  }

  // ── Add index on status for deny list startup query ───────────────────────
  const statusIdxName = 'CellularDevice_status_idx'
  const hasStatusIdx = await indexExists(prisma, statusIdxName)
  if (hasStatusIdx) {
    console.log(`${PREFIX} ${statusIdxName} index already exists -- skipping`)
  } else {
    console.log(`${PREFIX} Creating ${statusIdxName} index...`)
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "${statusIdxName}" ON "CellularDevice" ("status") WHERE status IN ('REVOKED', 'QUARANTINED')`
    )
    console.log(`${PREFIX} Done -- ${statusIdxName} index created`)
  }

  // ── Backfill revokedAt for existing revoked devices ───────────────────────
  try {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "CellularDevice" SET "revokedAt" = "updatedAt" WHERE status IN ('REVOKED', 'QUARANTINED') AND "revokedAt" IS NULL`
    )
    if (result > 0) {
      console.log(`${PREFIX} Backfilled revokedAt for ${result} existing revoked/quarantined devices`)
    }
  } catch (err) {
    // Non-fatal — backfill is best-effort
    console.log(`${PREFIX} Backfill revokedAt skipped:`, err.message)
  }

  console.log(`${PREFIX} Migration complete`)
}
