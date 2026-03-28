#!/usr/bin/env node
/**
 * Deploy-Tools Schema Bootstrap
 *
 * Applies schema.sql to an EMPTY database only.
 * Replaces `prisma db push` for first-time NUC provisioning.
 *
 * Contract:
 *   - Empty DB only (0 public tables)
 *   - Transactional (all-or-nothing)
 *   - Fail hard on any error
 *   - Never run on non-empty DB
 *
 * For existing databases, migrations handle all schema evolution.
 * This is a bootstrapper, not a diff engine.
 */

const { PgCompat } = require('./pg-compat')
const fs = require('fs')
const path = require('path')

const PREFIX = '[deploy-tools:apply-schema]'

async function applySchema() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error(`${PREFIX} FATAL: DATABASE_URL is not set`)
    process.exit(1)
  }

  const schemaPath = path.join(__dirname, '..', 'schema.sql')
  if (!fs.existsSync(schemaPath)) {
    console.error(`${PREFIX} FATAL: schema.sql not found at ${schemaPath}`)
    process.exit(1)
  }

  const schemaSql = fs.readFileSync(schemaPath, 'utf-8')
  const lineCount = schemaSql.split('\n').length
  console.log(`${PREFIX} schema.sql: ${lineCount} lines`)

  const client = new PgCompat(dbUrl)
  await client.connect()

  try {
    // Check if this is an empty database
    const [tableCount] = await client.$queryRawUnsafe(
      `SELECT COUNT(*)::int as cnt FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )

    if (tableCount.cnt === 0) {
      // Empty DB: apply full schema.sql inside a transaction
      console.log(`${PREFIX} Empty database detected — applying full schema.sql`)
      await client.$executeRawUnsafe('BEGIN')
      try {
        await client.$executeRawUnsafe(schemaSql)
        await client.$executeRawUnsafe('COMMIT')
        console.log(`${PREFIX} Full schema applied successfully (${lineCount} lines)`)
      } catch (err) {
        await client.$executeRawUnsafe('ROLLBACK').catch(() => {})
        throw err
      }
    } else {
      // Existing DB: migrations handle incremental changes
      console.log(`${PREFIX} Database has ${tableCount.cnt} tables — schema already in place`)
      console.log(`${PREFIX} Skipping schema.sql (migrations handle incremental changes)`)
    }
  } finally {
    await client.$disconnect()
  }
}

applySchema().catch((err) => {
  console.error(`${PREFIX} Fatal error:`, err.message)
  process.exit(1)
})
