#!/usr/bin/env node
/**
 * Deploy-Tools Migration Runner
 *
 * Drop-in replacement for nuc-pre-migrate.js.
 * Uses raw pg instead of PrismaClient — no tsx, no Prisma CLI, no generated client.
 *
 * Same tracking table (_gwi_migrations), same advisory lock (20250101),
 * same alphabetical file ordering, same 5-minute timeout.
 *
 * Interface contract:
 *   Inputs:  DATABASE_URL (required), NEON_MIGRATE + NEON_DATABASE_URL (optional)
 *   Outputs: exit 0 = success, exit 1 = failure, exit 2 = timeout
 *   Env:     DEPLOY_TOOLS_VALIDATE_ONLY=1 — verify imports, exit 0
 */

const { PgCompat } = require('./pg-compat')
const fs = require('fs')
const path = require('path')

const PREFIX = '[deploy-tools:migrate]'

// ── Validate-only mode ───────────────────────────────────────────────────────
// Proves imports resolve and migrations directory exists.
// Used by artifact build to verify the shipped artifact is runnable.
if (process.env.DEPLOY_TOOLS_VALIDATE_ONLY === '1') {
  const migrationsDir = path.join(__dirname, '..', 'migrations')
  const migrationCount = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js')).length
    : 0
  console.log(`${PREFIX} Validate-only mode: all imports resolved OK`)
  console.log(`${PREFIX}   PgCompat: ${typeof PgCompat === 'function' ? 'OK' : 'MISSING'}`)
  console.log(`${PREFIX}   migrations dir: ${fs.existsSync(migrationsDir) ? 'OK' : 'MISSING'} (${migrationCount} files)`)
  process.exit(0)
}

const MIGRATION_TIMEOUT_MS = 5 * 60 * 1000

async function runMigrations() {
  const isNeon = process.env.NEON_MIGRATE === 'true'
  if (isNeon && !process.env.NEON_DATABASE_URL) {
    console.log(`${PREFIX} NEON_MIGRATE=true but NEON_DATABASE_URL not set — skipping`)
    return
  }

  const dbUrl = isNeon ? process.env.NEON_DATABASE_URL : process.env.DATABASE_URL
  if (!dbUrl) {
    console.error(`${PREFIX} FATAL: ${isNeon ? 'NEON_DATABASE_URL' : 'DATABASE_URL'} is not set`)
    process.exit(1)
  }

  const targetHost = isNeon
    ? (dbUrl.split('@')[1] || '').split('/')[0] || 'neon'
    : 'local PG'
  console.log(`${PREFIX} Target: ${targetHost}`)

  const client = new PgCompat(dbUrl)
  await client.connect()

  let lockAcquired = false
  try {
    console.log(`${PREFIX} Running migrations...`)

    // Create tracking table (identical to nuc-pre-migrate.js)
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_gwi_migrations" (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // Advisory lock (same lock ID as nuc-pre-migrate.js: 20250101)
    const [lockResult] = await client.$queryRawUnsafe(
      `SELECT pg_try_advisory_lock(20250101) as locked`
    )
    if (!lockResult || !lockResult.locked) {
      console.log(`${PREFIX} Another migration runner is active — skipping`)
      return
    }
    lockAcquired = true
    console.log(`${PREFIX} Acquired advisory lock`)

    // Discover migrations
    const migrationsDir = path.join(__dirname, '..', 'migrations')
    if (!fs.existsSync(migrationsDir)) {
      console.warn(`${PREFIX} No migrations directory found at ${migrationsDir}`)
      return
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.js'))
      .sort()

    let applied = 0
    let skipped = 0

    for (const file of files) {
      const name = path.basename(file, '.js')

      // Check if already applied
      const [existing] = await client.$queryRawUnsafe(
        `SELECT name FROM "_gwi_migrations" WHERE name = $1`, name
      )
      if (existing) {
        skipped++
        continue
      }

      console.log(`${PREFIX} >> Applying ${name}...`)

      const migration = require(path.join(migrationsDir, file))
      if (typeof migration.up !== 'function') {
        throw new Error(`Migration ${file} does not export an up() function`)
      }

      // Pass the PgCompat instance — exposes $executeRawUnsafe/$queryRawUnsafe
      await migration.up(client)

      // Record as applied (ON CONFLICT guards against race conditions)
      await client.$executeRawUnsafe(
        `INSERT INTO "_gwi_migrations" (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, name
      )
      applied++
      console.log(`${PREFIX}    Done: ${name}`)
    }

    if (skipped > 0) {
      console.log(`${PREFIX} Skipped ${skipped} already-applied migration(s)`)
    }
    console.log(`${PREFIX} Migrations complete (${applied} applied, ${skipped} skipped)`)
  } finally {
    if (lockAcquired) {
      try {
        await client.$queryRawUnsafe(`SELECT pg_advisory_unlock(20250101)`)
      } catch { /* best-effort */ }
    }
    await client.$disconnect()
  }
}

// Global timeout
const timeout = setTimeout(() => {
  console.error(`${PREFIX} FATAL: Migration runner timed out after ${MIGRATION_TIMEOUT_MS / 1000}s`)
  process.exit(2)
}, MIGRATION_TIMEOUT_MS)
timeout.unref()

runMigrations().catch((err) => {
  console.error(`${PREFIX} Fatal error:`, err.message)
  process.exit(1)
})
