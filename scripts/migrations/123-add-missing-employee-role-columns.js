/**
 * Migration 123: Add all missing columns/tables across venues
 *
 * Fixes P2022 ColumnNotFound errors that break login and other endpoints.
 * These columns/tables were added to the Prisma schema but migrations
 * were never created, so NUC databases are missing them.
 *
 * Missing columns:
 *   - Employee.quickBarPreference (JSONB) — quick-access bar layout
 *   - Role.sessionTimeoutMinutes (INTEGER) — per-role idle timeout
 *
 * Missing tables:
 *   - IntegrationRetryEntry — 7shifts/MarginEdge retry queue
 *
 * Missing column on existing table:
 *   - _gwi_sync_state.updated_at (TIMESTAMP) — sync state tracking
 *
 * All operations use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS for idempotency.
 */

module.exports.up = async function up(prisma) {
  // Employee missing column
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "quickBarPreference" JSONB
  `)

  // Role missing column
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "sessionTimeoutMinutes" INTEGER
  `)

  // _gwi_sync_state missing column
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "_gwi_sync_state" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
  `)

  // IntegrationRetryEntry table (for 7shifts/MarginEdge retry queue)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "IntegrationRetryEntry" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "locationId" TEXT NOT NULL,
      "integration" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "payload" JSONB,
      "retryCount" INTEGER NOT NULL DEFAULT 0,
      "maxRetries" INTEGER NOT NULL DEFAULT 5,
      "lastError" TEXT,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "nextRetryAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" TIMESTAMP(3),
      PRIMARY KEY ("id")
    )
  `)
}
