/**
 * Migration 065 — Custom Pre-Modifiers
 *
 * Adds customPreModifiers JSONB column to Modifier table for custom
 * pre-modifier options (Well Done, Blackened, etc.)
 */
async function up(prisma) {
  async function columnExists(table, column) {
    const result = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = '${table}' AND column_name = '${column}'
    `)
    return result.length > 0
  }

  if (!(await columnExists('Modifier', 'customPreModifiers'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Modifier" ADD COLUMN "customPreModifiers" JSONB
    `)
    console.log('[migration-065] Added customPreModifiers to Modifier')
  }
}

module.exports = { up }
