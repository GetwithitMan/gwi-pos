/**
 * Migration 021: Create _pending_datacap_sales table for HA failover double-charge prevention
 *
 * During HA failover, the primary NUC may die between:
 *   1. Card charged at Datacap reader (sale approved)
 *   2. Server returning recordNo to client
 *
 * The client never receives the recordNo, so on VIP failover to the backup,
 * it re-initiates a fresh Datacap sale -> double-charge.
 *
 * This table tracks every Datacap sale attempt from INSERT (before sending to reader)
 * through completion. The backup can detect orphaned "pending" records and flag them
 * for reconciliation instead of allowing a second charge.
 */

const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[021-pending-datacap-sales]'

  const exists = await tableExists(prisma, '_pending_datacap_sales')
  if (exists) {
    console.log(`${PREFIX} _pending_datacap_sales already exists -- skipping`)
    return
  }

  console.log(`${PREFIX} Creating _pending_datacap_sales table...`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_pending_datacap_sales" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "orderId" TEXT NOT NULL,
      "terminalId" TEXT NOT NULL,
      "invoiceNo" TEXT,
      "amount" DECIMAL(10,2) NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "datacapRecordNo" TEXT,
      "datacapRefNumber" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "resolvedAt" TIMESTAMPTZ,
      "locationId" TEXT NOT NULL
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_pending_sales_status
    ON "_pending_datacap_sales" ("status", "locationId")
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_pending_sales_order
    ON "_pending_datacap_sales" ("orderId", "status")
  `)

  console.log(`${PREFIX} Done -- _pending_datacap_sales table created`)
}

module.exports = { up }
