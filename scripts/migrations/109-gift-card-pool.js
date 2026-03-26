/**
 * Migration 109 — Gift Card Pool, Delivery Tracking, and External Webhook Events
 *
 * Adds:
 *   - 'unactivated' value to GiftCardStatus enum
 *   - New enums: PerformedByType, DeliveryStatus, WebhookProcessingStatus
 *   - Pool/import columns on GiftCard: source, batchId, activatedAt, activatedById
 *   - External tracking on GiftCard: externalProvider, externalTransactionId, externalPageId
 *   - Delivery tracking on GiftCard: deliveryStatus, deliveryAttempts, lastDeliveryAttemptAt, deliveryFailureReason
 *   - Ledger columns on GiftCardTransaction: idempotencyKey, externalReference, performedByType
 *   - ExternalWebhookEvent table (webhook idempotency + replay protection)
 *   - New indexes for pool queries, batch operations, reconciliation
 *
 * Rollback note: Postgres enum values cannot be removed with ALTER TYPE.
 * If rollback needed, leave enum values in place and filter in queries.
 */

const { columnExists, tableExists, enumValueExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[109]'

  // ─── 1. Enum: GiftCardStatus + 'unactivated' ───────────────────────────────
  if (!(await enumValueExists(prisma, 'GiftCardStatus', 'unactivated'))) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "GiftCardStatus" ADD VALUE IF NOT EXISTS 'unactivated'`)
    console.log(`${PREFIX} Added 'unactivated' to GiftCardStatus enum`)
  }

  // ─── 2. Enum: PerformedByType ───────────────────────────────────────────────
  const ptExists = await prisma.$queryRawUnsafe(`SELECT 1 FROM pg_type WHERE typname = 'PerformedByType' LIMIT 1`)
  if (ptExists.length === 0) {
    await prisma.$executeRawUnsafe(`CREATE TYPE "PerformedByType" AS ENUM ('employee', 'system', 'cloud', 'webhook')`)
    console.log(`${PREFIX} Created PerformedByType enum`)
  }

  // ─── 3. Enum: DeliveryStatus ────────────────────────────────────────────────
  const dsExists = await prisma.$queryRawUnsafe(`SELECT 1 FROM pg_type WHERE typname = 'DeliveryStatus' LIMIT 1`)
  if (dsExists.length === 0) {
    await prisma.$executeRawUnsafe(`CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'delivered', 'failed')`)
    console.log(`${PREFIX} Created DeliveryStatus enum`)
  }

  // ─── 4. Enum: WebhookProcessingStatus ───────────────────────────────────────
  const wpsExists = await prisma.$queryRawUnsafe(`SELECT 1 FROM pg_type WHERE typname = 'WebhookProcessingStatus' LIMIT 1`)
  if (wpsExists.length === 0) {
    await prisma.$executeRawUnsafe(`CREATE TYPE "WebhookProcessingStatus" AS ENUM ('received', 'processed', 'failed', 'ignored')`)
    console.log(`${PREFIX} Created WebhookProcessingStatus enum`)
  }

  // ─── 5. GiftCard: Pool/import columns ───────────────────────────────────────
  const gcCols = [
    { name: 'source', sql: `ALTER TABLE "GiftCard" ADD COLUMN "source" TEXT` },
    { name: 'batchId', sql: `ALTER TABLE "GiftCard" ADD COLUMN "batchId" TEXT` },
    { name: 'activatedAt', sql: `ALTER TABLE "GiftCard" ADD COLUMN "activatedAt" TIMESTAMP(3)` },
    { name: 'activatedById', sql: `ALTER TABLE "GiftCard" ADD COLUMN "activatedById" TEXT` },
    { name: 'externalProvider', sql: `ALTER TABLE "GiftCard" ADD COLUMN "externalProvider" TEXT` },
    { name: 'externalTransactionId', sql: `ALTER TABLE "GiftCard" ADD COLUMN "externalTransactionId" TEXT` },
    { name: 'externalPageId', sql: `ALTER TABLE "GiftCard" ADD COLUMN "externalPageId" TEXT` },
    { name: 'deliveryStatus', sql: `ALTER TABLE "GiftCard" ADD COLUMN "deliveryStatus" "DeliveryStatus"` },
    { name: 'deliveryAttempts', sql: `ALTER TABLE "GiftCard" ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0` },
    { name: 'lastDeliveryAttemptAt', sql: `ALTER TABLE "GiftCard" ADD COLUMN "lastDeliveryAttemptAt" TIMESTAMP(3)` },
    { name: 'deliveryFailureReason', sql: `ALTER TABLE "GiftCard" ADD COLUMN "deliveryFailureReason" TEXT` },
  ]

  for (const col of gcCols) {
    if (!(await columnExists(prisma, 'GiftCard', col.name))) {
      await prisma.$executeRawUnsafe(col.sql)
      console.log(`${PREFIX} Added GiftCard.${col.name}`)
    }
  }

  // ─── 6. GiftCardTransaction: Ledger columns ────────────────────────────────
  const gctCols = [
    { name: 'idempotencyKey', sql: `ALTER TABLE "GiftCardTransaction" ADD COLUMN "idempotencyKey" TEXT` },
    { name: 'externalReference', sql: `ALTER TABLE "GiftCardTransaction" ADD COLUMN "externalReference" TEXT` },
    { name: 'performedByType', sql: `ALTER TABLE "GiftCardTransaction" ADD COLUMN "performedByType" "PerformedByType"` },
  ]

  for (const col of gctCols) {
    if (!(await columnExists(prisma, 'GiftCardTransaction', col.name))) {
      await prisma.$executeRawUnsafe(col.sql)
      console.log(`${PREFIX} Added GiftCardTransaction.${col.name}`)
    }
  }

  // ─── 7. GiftCard indexes ───────────────────────────────────────────────────
  const gcIndexes = [
    { name: 'GiftCard_locationId_status_source_idx', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "GiftCard_locationId_status_source_idx" ON "GiftCard" ("locationId", "status", "source")` },
    { name: 'GiftCard_batchId_idx', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "GiftCard_batchId_idx" ON "GiftCard" ("batchId")` },
    { name: 'GiftCard_externalProvider_externalTransactionId_idx', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "GiftCard_externalProvider_externalTransactionId_idx" ON "GiftCard" ("externalProvider", "externalTransactionId")` },
  ]

  for (const idx of gcIndexes) {
    if (!(await indexExists(prisma, idx.name))) {
      await prisma.$executeRawUnsafe(idx.sql)
      console.log(`${PREFIX} Created index ${idx.name}`)
    }
  }

  // ─── 8. GiftCardTransaction indexes ────────────────────────────────────────
  if (!(await indexExists(prisma, 'GiftCardTransaction_externalReference_idx'))) {
    await prisma.$executeRawUnsafe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "GiftCardTransaction_externalReference_idx" ON "GiftCardTransaction" ("externalReference")`
    )
    console.log(`${PREFIX} Created index GiftCardTransaction_externalReference_idx`)
  }

  // Unique constraint for idempotency (giftCardId + idempotencyKey when both non-null)
  if (!(await indexExists(prisma, 'GiftCardTransaction_giftCardId_idempotencyKey_key'))) {
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "GiftCardTransaction_giftCardId_idempotencyKey_key" ON "GiftCardTransaction" ("giftCardId", "idempotencyKey")`
    )
    console.log(`${PREFIX} Created unique index GiftCardTransaction_giftCardId_idempotencyKey_key`)
  }

  // ─── 9. ExternalWebhookEvent table ─────────────────────────────────────────
  if (!(await tableExists(prisma, 'ExternalWebhookEvent'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ExternalWebhookEvent" (
        "id"                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "provider"              TEXT NOT NULL,
        "externalTransactionId" TEXT NOT NULL,
        "eventType"             TEXT NOT NULL,
        "signatureValid"        BOOLEAN NOT NULL DEFAULT false,
        "payload"               JSONB NOT NULL DEFAULT '{}',
        "processingStatus"      "WebhookProcessingStatus" NOT NULL DEFAULT 'received',
        "ignoredReason"         TEXT,
        "relatedGiftCardId"     TEXT,
        "providerPageId"        TEXT,
        "providerMerchantId"    TEXT,
        "attemptCount"          INTEGER NOT NULL DEFAULT 1,
        "receivedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "processedAt"           TIMESTAMP(3),
        "errorMessage"          TEXT
      )
    `)
    console.log(`${PREFIX} Created ExternalWebhookEvent table`)

    // Unique constraint: one receipt per (provider, transaction, event type)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "ExternalWebhookEvent_provider_externalTransactionId_eventType_key"
      ON "ExternalWebhookEvent" ("provider", "externalTransactionId", "eventType")
    `)
    console.log(`${PREFIX} Created unique index on ExternalWebhookEvent`)

    // Processing status index for reconciliation queries
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "ExternalWebhookEvent_provider_processingStatus_idx"
      ON "ExternalWebhookEvent" ("provider", "processingStatus")
    `)
    console.log(`${PREFIX} Created processing status index on ExternalWebhookEvent`)
  }

  console.log(`${PREFIX} Migration complete`)
}
