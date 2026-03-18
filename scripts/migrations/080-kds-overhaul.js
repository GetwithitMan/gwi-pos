// Migration 080: KDS Overhaul — Screen Communication + Foundation
// Creates KDSScreenLink table, adds new fields to KDSScreen and OrderItem.
// Backfills kdsFinalCompleted=true on existing completed items to prevent
// them from appearing as "in expo" after migration.

async function up(prisma) {
  // ── KDSScreenLink table ──
  const hasTable = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'KDSScreenLink'
  `)
  if (hasTable.length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "KDSScreenLink" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "sourceScreenId" TEXT NOT NULL,
        "targetScreenId" TEXT NOT NULL,
        "linkType" TEXT NOT NULL DEFAULT 'send_to_next',
        "bumpAction" TEXT NOT NULL DEFAULT 'bump',
        "resetStrikethroughsOnSend" BOOLEAN NOT NULL DEFAULT false,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        CONSTRAINT "KDSScreenLink_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "KDSScreenLink_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "KDSScreenLink_sourceScreenId_fkey"
          FOREIGN KEY ("sourceScreenId") REFERENCES "KDSScreen"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "KDSScreenLink_targetScreenId_fkey"
          FOREIGN KEY ("targetScreenId") REFERENCES "KDSScreen"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "KDSScreenLink_sourceScreenId_targetScreenId_linkType_key"
      ON "KDSScreenLink"("sourceScreenId", "targetScreenId", "linkType")
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "KDSScreenLink_locationId_idx" ON "KDSScreenLink"("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "KDSScreenLink_sourceScreenId_idx" ON "KDSScreenLink"("sourceScreenId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "KDSScreenLink_targetScreenId_idx" ON "KDSScreenLink"("targetScreenId")`)
  }

  // ── KDSScreen new columns ──
  const kdsColumns = [
    { col: 'displayMode', sql: `ALTER TABLE "KDSScreen" ADD COLUMN "displayMode" TEXT NOT NULL DEFAULT 'tiled'` },
    { col: 'transitionTimes', sql: `ALTER TABLE "KDSScreen" ADD COLUMN "transitionTimes" JSONB` },
    { col: 'orderBehavior', sql: `ALTER TABLE "KDSScreen" ADD COLUMN "orderBehavior" JSONB` },
    { col: 'orderTypeFilters', sql: `ALTER TABLE "KDSScreen" ADD COLUMN "orderTypeFilters" JSONB` },
  ]
  for (const { col, sql } of kdsColumns) {
    const exists = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'KDSScreen' AND column_name = '${col}'
    `)
    if (exists.length === 0) {
      await prisma.$executeRawUnsafe(sql)
    }
  }

  // ── OrderItem new columns ──
  const oiColumns = [
    { col: 'completedBy', sql: `ALTER TABLE "OrderItem" ADD COLUMN "completedBy" TEXT` },
    { col: 'kdsForwardedToScreenId', sql: `ALTER TABLE "OrderItem" ADD COLUMN "kdsForwardedToScreenId" TEXT` },
    { col: 'kdsFinalCompleted', sql: `ALTER TABLE "OrderItem" ADD COLUMN "kdsFinalCompleted" BOOLEAN NOT NULL DEFAULT false` },
  ]
  for (const { col, sql } of oiColumns) {
    const exists = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'OrderItem' AND column_name = '${col}'
    `)
    if (exists.length === 0) {
      await prisma.$executeRawUnsafe(sql)
    }
  }

  // ── Backfill: Mark existing completed items as kdsFinalCompleted=true ──
  // Prevents old completed items from appearing as forwarded-but-not-final on Expo
  const hasKdfCol = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'OrderItem' AND column_name = 'kdsFinalCompleted'
  `)
  if (hasKdfCol.length > 0) {
    await prisma.$executeRawUnsafe(`
      UPDATE "OrderItem"
      SET "kdsFinalCompleted" = true
      WHERE "isCompleted" = true AND "kdsFinalCompleted" = false
    `)
  }

  // ── Index for Expo query performance ──
  const hasIdx = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'OrderItem_kdsForwardedToScreenId_kdsFinalCompleted_idx'
  `)
  if (hasIdx.length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "OrderItem_kdsForwardedToScreenId_kdsFinalCompleted_idx"
      ON "OrderItem"("kdsForwardedToScreenId", "kdsFinalCompleted")
    `)
  }
}

module.exports = { up }
