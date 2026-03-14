/**
 * Migration 045: CellularDevice + BridgeCheckpoint tables
 *
 * Creates the CellularDevice table on NUC local PG. This table is used by:
 *   - downstream-sync-worker.ts (syncCellularDenyList) — queries for revoked/quarantined devices
 *   - cellular-auth.ts (isRevokedFromDb) — L2 revocation check
 *   - /api/cellular-devices (GET/POST) — admin UI for managing cellular devices
 *
 * Also re-creates BridgeCheckpoint if it's missing (migration 011 may have
 * silently failed on some production NUCs due to its try/catch swallowing errors).
 *
 * The CellularDevice model is defined in Mission Control's Prisma schema but the
 * NUC needs the table locally for raw SQL queries. This migration creates a
 * compatible table structure.
 *
 * Both CREATE statements are idempotent (guarded by tableExists check).
 */

const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[045-cellular-device-tables]'

  // ── CellularDevice ──────────────────────────────────────────────────────────
  try {
    const cdExists = await tableExists(prisma, 'CellularDevice')
    if (cdExists) {
      console.log(`${PREFIX}   CellularDevice table already exists -- skipping`)
    } else {
      console.log(`${PREFIX}   Creating CellularDevice table...`)

      // Create the CellularDeviceStatus enum if it doesn't exist
      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          CREATE TYPE "CellularDeviceStatus" AS ENUM (
            'PENDING_APPROVAL',
            'APPROVED',
            'ACTIVE',
            'REVOKED',
            'QUARANTINED',
            'EXPIRED'
          );
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE "CellularDevice" (
          "id"                TEXT NOT NULL,
          "terminalId"        TEXT NOT NULL,
          "locationId"        TEXT NOT NULL,
          "deviceFingerprint" TEXT NOT NULL,
          "terminalName"      TEXT,
          "status"            "CellularDeviceStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
          "approvedByUserId"  TEXT,
          "approvedAt"        TIMESTAMPTZ,
          "pairingNonce"      TEXT,
          "pairingExpiresAt"  TIMESTAMPTZ,
          "lastSeenAt"        TIMESTAMPTZ,
          "lastIp"            TEXT,
          "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT "CellularDevice_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "CellularDevice_terminalId_key" UNIQUE ("terminalId"),
          CONSTRAINT "CellularDevice_pairingNonce_key" UNIQUE ("pairingNonce"),
          CONSTRAINT "CellularDevice_locationId_fkey"
            FOREIGN KEY ("locationId") REFERENCES "Location"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE
        )
      `)

      // Index on locationId + status for deny list queries
      await prisma.$executeRawUnsafe(`
        CREATE INDEX "CellularDevice_locationId_status_idx"
          ON "CellularDevice" ("locationId", "status")
      `)

      console.log(`${PREFIX}   Done -- CellularDevice table created`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED CellularDevice:`, err.message)
    throw err
  }

  // ── BridgeCheckpoint (re-create if missing) ─────────────────────────────────
  try {
    const bcExists = await tableExists(prisma, 'BridgeCheckpoint')
    if (bcExists) {
      console.log(`${PREFIX}   BridgeCheckpoint table already exists -- skipping`)
    } else {
      console.log(`${PREFIX}   Creating BridgeCheckpoint table (was missing despite migration 011)...`)
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "BridgeCheckpoint" (
          "id"                TEXT NOT NULL,
          "locationId"        TEXT NOT NULL,
          "nodeId"            TEXT NOT NULL,
          "role"              TEXT NOT NULL,
          "leaseExpiresAt"    TIMESTAMPTZ NOT NULL,
          "lastHeartbeat"     TIMESTAMPTZ NOT NULL,
          "lastFulfillmentAt" TIMESTAMPTZ,
          "fulfillmentLag"    INTEGER,
          "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT "BridgeCheckpoint_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "BridgeCheckpoint_locationId_fkey"
            FOREIGN KEY ("locationId") REFERENCES "Location"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE,
          CONSTRAINT "BridgeCheckpoint_locationId_nodeId_key"
            UNIQUE ("locationId", "nodeId")
        )
      `)

      console.log(`${PREFIX}   Done -- BridgeCheckpoint table created`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED BridgeCheckpoint:`, err.message)
    throw err
  }
}

module.exports = { up }
