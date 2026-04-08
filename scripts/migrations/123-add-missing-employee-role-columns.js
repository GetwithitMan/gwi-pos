/**
 * Migration 123: Add missing columns to Employee and Role
 *
 * quickBarPreference (Employee) — JSONB, stores user's quick-access bar layout
 * sessionTimeoutMinutes (Role) — INT, per-role idle timeout override
 *
 * These columns were added to the Prisma schema but the migration was missing,
 * causing ColumnNotFound errors on login at all venues (P2022).
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS.
 */

module.exports.up = async function up(prisma) {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "quickBarPreference" JSONB
  `)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "sessionTimeoutMinutes" INTEGER
  `)
}
