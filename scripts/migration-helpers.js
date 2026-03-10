/**
 * Shared helper functions for migration scripts.
 *
 * All functions take a PrismaClient instance as the first argument
 * and use $queryRawUnsafe / $executeRawUnsafe for compatibility
 * with both local PG (NUC) and Neon (via PrismaClient).
 */

async function columnExists(prisma, tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    tableName,
    columnName
  )
  return rows.length > 0
}

async function tableExists(prisma, tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    tableName
  )
  return rows.length > 0
}

async function enumValueExists(prisma, typeName, value) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_enum WHERE enumlabel = $1 AND enumtypid = (SELECT oid FROM pg_type WHERE typname = $2) LIMIT 1`,
    value,
    typeName
  )
  return rows.length > 0
}

async function indexExists(prisma, indexName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE indexname = $1 LIMIT 1`,
    indexName
  )
  return rows.length > 0
}

module.exports = { columnExists, tableExists, enumValueExists, indexExists }
