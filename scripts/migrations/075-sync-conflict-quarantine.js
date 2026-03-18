/**
 * Migration 075: Sync Conflict Quarantine + Watermark Tables
 *
 * Creates SyncConflict table for quarantine records and
 * SyncWatermark table for per-venue sync acknowledgment tracking.
 */

/** @param {import('@prisma/client').PrismaClient} prisma */
export async function up(prisma) {
  // ── SyncConflict table ─────────────────────────────────────────────────
  const syncConflictExists = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'SyncConflict'
    ) as exists
  `)
  if (!syncConflictExists[0]?.exists) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "SyncConflict" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        model TEXT NOT NULL,
        "recordId" TEXT NOT NULL,
        "localVersion" TEXT NOT NULL,
        "cloudVersion" TEXT NOT NULL,
        "localData" JSONB NOT NULL DEFAULT '{}',
        "cloudData" JSONB NOT NULL DEFAULT '{}',
        "detectedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "resolvedAt" TIMESTAMPTZ,
        resolution TEXT
      )
    `)

    // Index for monitoring queries (unresolved conflicts, recent conflicts)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "SyncConflict_resolvedAt_idx" ON "SyncConflict" ("resolvedAt") WHERE "resolvedAt" IS NULL
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "SyncConflict_detectedAt_idx" ON "SyncConflict" ("detectedAt")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "SyncConflict_model_recordId_idx" ON "SyncConflict" (model, "recordId")
    `)

    console.log('[Migration 075] Created SyncConflict table')
  }

  // ── SyncWatermark table ────────────────────────────────────────────────
  const syncWatermarkExists = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'SyncWatermark'
    ) as exists
  `)
  if (!syncWatermarkExists[0]?.exists) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "SyncWatermark" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        "locationId" TEXT NOT NULL UNIQUE,
        "lastAcknowledgedUpstreamAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "lastAcknowledgedDownstreamAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    console.log('[Migration 075] Created SyncWatermark table')
  }
}
