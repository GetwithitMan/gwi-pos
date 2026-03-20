/**
 * Migration 089: Fix infrastructure table sequences for Prisma compatibility
 *
 * The installer creates _local_install_state and _local_schema_state with raw SQL
 * (SERIAL PRIMARY KEY), which creates *_id_seq sequences. When these tables were
 * added to the Prisma schema, prisma db push tries to create the same sequences
 * and fails with "relation already exists".
 *
 * Fix: Drop the raw-SQL-created tables so Prisma can recreate them with its own
 * managed sequences. Data in these tables is ephemeral (boot/install state only).
 */
module.exports.up = async function up(prisma) {
  // Drop tables created by installer/bootstrap raw SQL.
  // Prisma db push will recreate them from the schema with proper sequences.
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "_local_install_state" CASCADE`)
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "_local_schema_state" CASCADE`)

  // Also drop any orphaned sequences (in case tables were already dropped but sequences remain)
  await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS "_local_install_state_id_seq" CASCADE`)
  await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS "_local_schema_state_id_seq" CASCADE`)

  console.log('[089] Dropped infrastructure tables + sequences for Prisma recreation')
}
