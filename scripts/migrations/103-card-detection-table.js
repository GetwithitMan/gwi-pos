/**
 * Migration 103 — Create CardDetection table
 *
 * Short-lived audit/resolution store for passive card reads.
 * recordNo scrubbed after 24h, rows deleted after 30d.
 *
 * Indexes:
 *   - readerId + createdAt DESC — per-reader detection history
 *   - terminalId + createdAt DESC — per-terminal detection history
 *   - status + decisionExpiresAt — expiry cron query
 *   - matchedOrderId + createdAt DESC — order-scoped detection lookup
 *   - locationId + detectionId — fast detection resolution by location
 */

const { tableExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[103]'

  // ─── CardDetection table ──────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'CardDetection'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CardDetection" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "detectionId" TEXT NOT NULL,
        "readerId" TEXT NOT NULL,
        "terminalId" TEXT NOT NULL,
        "sessionId" TEXT NOT NULL,
        "recordNo" TEXT,
        "cardType" TEXT,
        "cardLast4" TEXT,
        "cardholderName" TEXT,
        "entryMethod" TEXT,
        "walletType" TEXT,
        "matchKind" TEXT NOT NULL,
        "matchedOrderId" TEXT,
        "decisionExpiresAt" TIMESTAMP(3) NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "actionTaken" TEXT,
        "actionResult" TEXT,
        "resolvedAt" TIMESTAMP(3),
        "resolvedByUserId" TEXT,
        "resolvedByTerminalId" TEXT,
        "leaseVersion" INTEGER,
        "suppressedReason" TEXT,
        "errorCode" TEXT,
        "promptShownAt" TIMESTAMP(3),
        "promptDismissedAt" TIMESTAMP(3),
        "locationId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log(`${PREFIX} Created CardDetection table`)
  } else {
    console.log(`${PREFIX} CardDetection table already exists`)
  }

  // Unique constraint on detectionId
  if (!(await indexExists(prisma, 'CardDetection_detectionId_key'))) {
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "CardDetection_detectionId_key" ON "CardDetection" ("detectionId")`)
    console.log(`${PREFIX} Created CardDetection_detectionId_key unique index`)
  }

  // Index: readerId + createdAt DESC
  if (!(await indexExists(prisma, 'CardDetection_readerId_createdAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CardDetection_readerId_createdAt_idx" ON "CardDetection" ("readerId", "createdAt" DESC)`)
    console.log(`${PREFIX} Created CardDetection_readerId_createdAt_idx`)
  }

  // Index: terminalId + createdAt DESC
  if (!(await indexExists(prisma, 'CardDetection_terminalId_createdAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CardDetection_terminalId_createdAt_idx" ON "CardDetection" ("terminalId", "createdAt" DESC)`)
    console.log(`${PREFIX} Created CardDetection_terminalId_createdAt_idx`)
  }

  // Index: status + decisionExpiresAt
  if (!(await indexExists(prisma, 'CardDetection_status_decisionExpiresAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CardDetection_status_decisionExpiresAt_idx" ON "CardDetection" ("status", "decisionExpiresAt")`)
    console.log(`${PREFIX} Created CardDetection_status_decisionExpiresAt_idx`)
  }

  // Index: matchedOrderId + createdAt DESC
  if (!(await indexExists(prisma, 'CardDetection_matchedOrderId_createdAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CardDetection_matchedOrderId_createdAt_idx" ON "CardDetection" ("matchedOrderId", "createdAt" DESC)`)
    console.log(`${PREFIX} Created CardDetection_matchedOrderId_createdAt_idx`)
  }

  // Index: locationId + detectionId
  if (!(await indexExists(prisma, 'CardDetection_locationId_detectionId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CardDetection_locationId_detectionId_idx" ON "CardDetection" ("locationId", "detectionId")`)
    console.log(`${PREFIX} Created CardDetection_locationId_detectionId_idx`)
  }

  console.log(`${PREFIX} Migration 103 complete — CardDetection table created`)
}
