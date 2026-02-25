#!/usr/bin/env node
/**
 * Vercel Build Script
 *
 * Runs pre-push migrations, applies Prisma migrations to PostgreSQL (Neon), and builds the app.
 * Both dev and prod use the same PostgreSQL engine.
 */
const { execSync } = require('child_process')

/**
 * Run pre-push SQL migrations for columns that can't be added as NOT NULL
 * to tables with existing rows. Adds columns as nullable, backfills from
 * related data, then sets NOT NULL — so prisma db push sees them as matching.
 */
async function runPrePushMigrations() {
  const { neon } = require('@neondatabase/serverless')
  const sql = neon(process.env.DATABASE_URL)

  console.log('[vercel-build] Running pre-push migrations...')

  // --- OrderOwnershipEntry.locationId ---
  const [ooeCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'OrderOwnershipEntry' AND column_name = 'locationId'
  `
  if (!ooeCol) {
    console.log('[vercel-build]   Adding locationId to OrderOwnershipEntry...')
    await sql`ALTER TABLE "OrderOwnershipEntry" ADD COLUMN "locationId" TEXT`
    await sql`
      UPDATE "OrderOwnershipEntry" ooe
      SET "locationId" = oo."locationId"
      FROM "OrderOwnership" oo
      WHERE ooe."orderOwnershipId" = oo.id AND ooe."locationId" IS NULL
    `
    // Fallback: any remaining nulls get first location
    await sql`
      UPDATE "OrderOwnershipEntry"
      SET "locationId" = (SELECT id FROM "Location" LIMIT 1)
      WHERE "locationId" IS NULL
    `
    await sql`ALTER TABLE "OrderOwnershipEntry" ALTER COLUMN "locationId" SET NOT NULL`
    console.log('[vercel-build]   Done — OrderOwnershipEntry.locationId backfilled')
  }

  // --- cloud_event_queue.locationId ---
  const [ceqCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'cloud_event_queue' AND column_name = 'locationId'
  `
  if (!ceqCol) {
    console.log('[vercel-build]   Adding locationId to cloud_event_queue...')
    await sql`ALTER TABLE "cloud_event_queue" ADD COLUMN "locationId" TEXT`
    // Backfill from first location (venueId exists but isn't a FK to Location)
    await sql`
      UPDATE "cloud_event_queue"
      SET "locationId" = (SELECT id FROM "Location" LIMIT 1)
      WHERE "locationId" IS NULL
    `
    await sql`ALTER TABLE "cloud_event_queue" ALTER COLUMN "locationId" SET NOT NULL`
    console.log('[vercel-build]   Done — cloud_event_queue.locationId backfilled')
  }

  // --- OrderOwnershipEntry.deletedAt (nullable, just needs to exist) ---
  const [ooeDelCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'OrderOwnershipEntry' AND column_name = 'deletedAt'
  `
  if (!ooeDelCol) {
    console.log('[vercel-build]   Adding deletedAt to OrderOwnershipEntry...')
    await sql`ALTER TABLE "OrderOwnershipEntry" ADD COLUMN "deletedAt" TIMESTAMPTZ`
    console.log('[vercel-build]   Done — OrderOwnershipEntry.deletedAt added')
  }

  // --- ModifierTemplate.locationId ---
  const [mtCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ModifierTemplate' AND column_name = 'locationId'
  `
  if (!mtCol) {
    console.log('[vercel-build]   Adding locationId to ModifierTemplate...')
    await sql`ALTER TABLE "ModifierTemplate" ADD COLUMN "locationId" TEXT`
    // Backfill from parent ModifierGroupTemplate's locationId
    await sql`
      UPDATE "ModifierTemplate" mt
      SET "locationId" = mgt."locationId"
      FROM "ModifierGroupTemplate" mgt
      WHERE mt."templateId" = mgt.id AND mt."locationId" IS NULL
    `
    // Fallback: any remaining nulls get first location
    await sql`
      UPDATE "ModifierTemplate"
      SET "locationId" = (SELECT id FROM "Location" LIMIT 1)
      WHERE "locationId" IS NULL
    `
    await sql`ALTER TABLE "ModifierTemplate" ALTER COLUMN "locationId" SET NOT NULL`
    console.log('[vercel-build]   Done — ModifierTemplate.locationId backfilled')
  }

  // --- ModifierTemplate.deletedAt (nullable, just needs to exist) ---
  const [mtDelCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ModifierTemplate' AND column_name = 'deletedAt'
  `
  if (!mtDelCol) {
    console.log('[vercel-build]   Adding deletedAt to ModifierTemplate...')
    await sql`ALTER TABLE "ModifierTemplate" ADD COLUMN "deletedAt" TIMESTAMPTZ`
    console.log('[vercel-build]   Done — ModifierTemplate.deletedAt added')
  }

  // --- updatedAt backfill for tables with existing rows ---
  // Prisma @updatedAt doesn't set a default, so adding NOT NULL updatedAt
  // to tables with data fails. Add as nullable, backfill with now(), set NOT NULL.
  // Can't parameterize identifiers (table names) so each table is inline.
  async function needsColumn(table, column) {
    const [col] = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    `
    return !col
  }

  if (await needsColumn('OrderOwnershipEntry', 'updatedAt')) {
    console.log('[vercel-build]   Adding updatedAt to OrderOwnershipEntry...')
    await sql`ALTER TABLE "OrderOwnershipEntry" ADD COLUMN "updatedAt" TIMESTAMPTZ`
    await sql`UPDATE "OrderOwnershipEntry" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL`
    await sql`ALTER TABLE "OrderOwnershipEntry" ALTER COLUMN "updatedAt" SET NOT NULL`
    console.log('[vercel-build]   Done — OrderOwnershipEntry.updatedAt backfilled')
  }

  if (await needsColumn('PaymentReaderLog', 'updatedAt')) {
    console.log('[vercel-build]   Adding updatedAt to PaymentReaderLog...')
    await sql`ALTER TABLE "PaymentReaderLog" ADD COLUMN "updatedAt" TIMESTAMPTZ`
    await sql`UPDATE "PaymentReaderLog" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL`
    await sql`ALTER TABLE "PaymentReaderLog" ALTER COLUMN "updatedAt" SET NOT NULL`
    console.log('[vercel-build]   Done — PaymentReaderLog.updatedAt backfilled')
  }

  if (await needsColumn('TipLedgerEntry', 'updatedAt')) {
    console.log('[vercel-build]   Adding updatedAt to TipLedgerEntry...')
    await sql`ALTER TABLE "TipLedgerEntry" ADD COLUMN "updatedAt" TIMESTAMPTZ`
    await sql`UPDATE "TipLedgerEntry" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL`
    await sql`ALTER TABLE "TipLedgerEntry" ALTER COLUMN "updatedAt" SET NOT NULL`
    console.log('[vercel-build]   Done — TipLedgerEntry.updatedAt backfilled')
  }

  if (await needsColumn('TipTransaction', 'updatedAt')) {
    console.log('[vercel-build]   Adding updatedAt to TipTransaction...')
    await sql`ALTER TABLE "TipTransaction" ADD COLUMN "updatedAt" TIMESTAMPTZ`
    await sql`UPDATE "TipTransaction" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL`
    await sql`ALTER TABLE "TipTransaction" ALTER COLUMN "updatedAt" SET NOT NULL`
    console.log('[vercel-build]   Done — TipTransaction.updatedAt backfilled')
  }

  if (await needsColumn('cloud_event_queue', 'updatedAt')) {
    console.log('[vercel-build]   Adding updatedAt to cloud_event_queue...')
    await sql`ALTER TABLE "cloud_event_queue" ADD COLUMN "updatedAt" TIMESTAMPTZ`
    await sql`UPDATE "cloud_event_queue" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL`
    await sql`ALTER TABLE "cloud_event_queue" ALTER COLUMN "updatedAt" SET NOT NULL`
    console.log('[vercel-build]   Done — cloud_event_queue.updatedAt backfilled')
  }

  // --- Partial unique index on Order(locationId, orderNumber) ---
  // Split orders intentionally share the parent's orderNumber, so we can't use
  // a plain @@unique. Instead, create a partial unique index that only covers
  // root orders (parentOrderId IS NULL). Same pattern as Order_tableId_active_unique.
  //
  // First, deduplicate any root orders with colliding (locationId, orderNumber).
  const dupes = await sql`
    SELECT "locationId", "orderNumber", COUNT(*) as cnt
    FROM "Order"
    WHERE "parentOrderId" IS NULL
    GROUP BY "locationId", "orderNumber"
    HAVING COUNT(*) > 1
  `
  if (dupes.length > 0) {
    console.log(`[vercel-build]   Deduplicating ${dupes.length} duplicate orderNumber groups...`)
    // Use a counter starting above the max existing orderNumber to avoid collisions
    const [maxRow] = await sql`SELECT COALESCE(MAX("orderNumber"), 0) as mx FROM "Order"`
    let nextNum = Math.max(maxRow.mx, 900000) + 1000
    for (const { locationId, orderNumber } of dupes) {
      const orders = await sql`
        SELECT id FROM "Order"
        WHERE "locationId" = ${locationId} AND "orderNumber" = ${orderNumber}
          AND "parentOrderId" IS NULL
        ORDER BY "createdAt" DESC
      `
      // Keep the newest, renumber the rest with unique sequential numbers
      for (let i = 1; i < orders.length; i++) {
        nextNum++
        await sql`UPDATE "Order" SET "orderNumber" = ${nextNum} WHERE id = ${orders[i].id}`
      }
    }
    console.log('[vercel-build]   Done — duplicate orderNumbers resolved')
  }

  // Drop Prisma's plain unique if it exists (from previous deploy), then create partial
  const [plainIdx] = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'Order' AND indexname = 'Order_locationId_orderNumber_key'
  `
  if (plainIdx) {
    console.log('[vercel-build]   Dropping plain unique index Order_locationId_orderNumber_key...')
    await sql`DROP INDEX "Order_locationId_orderNumber_key"`
    console.log('[vercel-build]   Done')
  }

  const [partialIdx] = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'Order' AND indexname = 'Order_locationId_orderNumber_unique'
  `
  if (!partialIdx) {
    console.log('[vercel-build]   Creating partial unique index Order_locationId_orderNumber_unique...')
    await sql`
      CREATE UNIQUE INDEX "Order_locationId_orderNumber_unique"
      ON "Order" ("locationId", "orderNumber")
      WHERE "parentOrderId" IS NULL
    `
    console.log('[vercel-build]   Done — partial unique index created (root orders only)')
  }

  // --- H-SCHEMA-3: Convert tip-related Int fields to Decimal(10,2) ---
  // Prisma db push with --accept-data-loss handles type changes, but we
  // pre-convert to avoid any data truncation issues on tables with existing rows.
  // Uses needsColumn-style checks and inline ALTER TABLE for each field
  // (can't parameterize identifiers in the Neon SQL template).
  async function isIntegerColumn(table, column) {
    const [colInfo] = await sql`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    `
    return colInfo && colInfo.data_type === 'integer'
  }

  if (await isIntegerColumn('TipLedger', 'currentBalanceCents')) {
    console.log('[vercel-build]   Converting TipLedger.currentBalanceCents INT → DECIMAL(10,2)...')
    await sql`ALTER TABLE "TipLedger" ALTER COLUMN "currentBalanceCents" TYPE DECIMAL(10,2)`
    console.log('[vercel-build]   Done')
  }
  if (await isIntegerColumn('TipLedgerEntry', 'amountCents')) {
    console.log('[vercel-build]   Converting TipLedgerEntry.amountCents INT → DECIMAL(10,2)...')
    await sql`ALTER TABLE "TipLedgerEntry" ALTER COLUMN "amountCents" TYPE DECIMAL(10,2)`
    console.log('[vercel-build]   Done')
  }
  if (await isIntegerColumn('TipTransaction', 'amountCents')) {
    console.log('[vercel-build]   Converting TipTransaction.amountCents INT → DECIMAL(10,2)...')
    await sql`ALTER TABLE "TipTransaction" ALTER COLUMN "amountCents" TYPE DECIMAL(10,2)`
    console.log('[vercel-build]   Done')
  }
  if (await isIntegerColumn('TipTransaction', 'ccFeeAmountCents')) {
    console.log('[vercel-build]   Converting TipTransaction.ccFeeAmountCents INT → DECIMAL(10,2)...')
    await sql`ALTER TABLE "TipTransaction" ALTER COLUMN "ccFeeAmountCents" TYPE DECIMAL(10,2)`
    console.log('[vercel-build]   Done')
  }
  if (await isIntegerColumn('TipDebt', 'originalAmountCents')) {
    console.log('[vercel-build]   Converting TipDebt.originalAmountCents INT → DECIMAL(10,2)...')
    await sql`ALTER TABLE "TipDebt" ALTER COLUMN "originalAmountCents" TYPE DECIMAL(10,2)`
    console.log('[vercel-build]   Done')
  }
  if (await isIntegerColumn('TipDebt', 'remainingCents')) {
    console.log('[vercel-build]   Converting TipDebt.remainingCents INT → DECIMAL(10,2)...')
    await sql`ALTER TABLE "TipDebt" ALTER COLUMN "remainingCents" TYPE DECIMAL(10,2)`
    console.log('[vercel-build]   Done')
  }
  if (await isIntegerColumn('CashTipDeclaration', 'amountCents')) {
    console.log('[vercel-build]   Converting CashTipDeclaration.amountCents INT → DECIMAL(10,2)...')
    await sql`ALTER TABLE "CashTipDeclaration" ALTER COLUMN "amountCents" TYPE DECIMAL(10,2)`
    console.log('[vercel-build]   Done')
  }

  // --- H-SCHEMA-2: Convert String columns to Prisma Enums ---
  // Prisma db push cannot cast text → enum on required columns with existing data.
  // We pre-create the enum types and cast the columns so db push sees them as matching.
  async function isTextColumn(table, column) {
    const [colInfo] = await sql`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    `
    return colInfo && (colInfo.data_type === 'text' || colInfo.data_type === 'character varying')
  }

  async function enumTypeExists(typeName) {
    const [row] = await sql`SELECT typname FROM pg_type WHERE typname = ${typeName}`
    return !!row
  }

  // Payment.paymentMethod: String → PaymentMethod enum
  if (await isTextColumn('Payment', 'paymentMethod')) {
    console.log('[vercel-build]   Converting Payment.paymentMethod TEXT → PaymentMethod enum...')
    if (!(await enumTypeExists('PaymentMethod'))) {
      await sql`CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'card', 'credit', 'debit', 'gift_card', 'house_account', 'loyalty', 'loyalty_points')`
    }
    await sql`ALTER TABLE "Payment" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod" USING ("paymentMethod"::text::"PaymentMethod")`
    console.log('[vercel-build]   Done')
  }

  // TipLedgerEntry.type: String → TipLedgerEntryType enum
  if (await isTextColumn('TipLedgerEntry', 'type')) {
    console.log('[vercel-build]   Converting TipLedgerEntry.type TEXT → TipLedgerEntryType enum...')
    if (!(await enumTypeExists('TipLedgerEntryType'))) {
      await sql`CREATE TYPE "TipLedgerEntryType" AS ENUM ('CREDIT', 'DEBIT')`
    }
    await sql`ALTER TABLE "TipLedgerEntry" ALTER COLUMN "type" TYPE "TipLedgerEntryType" USING ("type"::text::"TipLedgerEntryType")`
    console.log('[vercel-build]   Done')
  }

  // TipTransaction.sourceType: String → TipTransactionSourceType enum
  if (await isTextColumn('TipTransaction', 'sourceType')) {
    console.log('[vercel-build]   Converting TipTransaction.sourceType TEXT → TipTransactionSourceType enum...')
    if (!(await enumTypeExists('TipTransactionSourceType'))) {
      await sql`CREATE TYPE "TipTransactionSourceType" AS ENUM ('CARD', 'CASH', 'ADJUSTMENT')`
    }
    await sql`ALTER TABLE "TipTransaction" ALTER COLUMN "sourceType" TYPE "TipTransactionSourceType" USING ("sourceType"::text::"TipTransactionSourceType")`
    console.log('[vercel-build]   Done')
  }

  console.log('[vercel-build] Pre-push migrations complete')
}

async function main() {
  // Generate Prisma client
  console.log('[vercel-build] Running prisma generate...')
  execSync('npx prisma generate', { stdio: 'inherit' })

  // Run pre-push migrations before db push
  await runPrePushMigrations()

  // Sync schema to Neon PostgreSQL
  // --skip-generate: already ran above
  // --accept-data-loss: required for safe type casts (e.g. Float→Decimal) and
  // new unique constraints. Pre-push migrations above handle the real data safety.
  console.log('[vercel-build] Running prisma db push...')
  execSync('npx prisma db push --skip-generate --accept-data-loss', { stdio: 'inherit' })

  // Build Next.js
  console.log('[vercel-build] Running next build...')
  execSync('npx next build', { stdio: 'inherit' })

  console.log('[vercel-build] Build complete!')
}

main().catch((err) => {
  console.error('[vercel-build] Build failed:', err.message)
  process.exit(1)
})
