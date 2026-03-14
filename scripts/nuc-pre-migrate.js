#!/usr/bin/env node
/**
 * NUC Pre-Migrate Script (v2 — migration runner)
 *
 * Runs numbered migrations from scripts/migrations/ against the target database.
 * Uses a _gwi_migrations tracking table to skip already-applied migrations.
 *
 * Works against both local PG (NUC) and Neon (via PrismaClient with NEON_DATABASE_URL).
 *
 * Usage:
 *   node scripts/nuc-pre-migrate.js                            # local PG
 *   NEON_MIGRATE=true NEON_DATABASE_URL=... node scripts/nuc-pre-migrate.js  # Neon
 *
 * Requires: DATABASE_URL in environment (loaded from /opt/gwi-pos/.env by systemd)
 */
const { config } = require('dotenv')
config({ path: '.env.local', override: true })
config({ path: '.env' })

// tsx/cjs/api registers TypeScript loader so we can require the generated Prisma 7 client
require('tsx/cjs/api').register()
const { PrismaClient } = require('../src/generated/prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const fs = require('fs')
const path = require('path')

const PREFIX = '[nuc-pre-migrate]'

async function runPrePushMigrations() {
  // Support NEON_MIGRATE flag — when set, run migrations against Neon cloud DB
  const isNeon = process.env.NEON_MIGRATE === 'true'
  if (isNeon && !process.env.NEON_DATABASE_URL) {
    console.log(`${PREFIX} NEON_MIGRATE=true but NEON_DATABASE_URL not set — skipping`)
    return
  }

  const targetHost = isNeon
    ? (process.env.NEON_DATABASE_URL || '').split('@')[1]?.split('/')[0] || 'neon'
    : 'local PG'
  console.log(`${PREFIX} Target: ${targetHost}`)

  const dbUrl = isNeon ? process.env.NEON_DATABASE_URL : process.env.DATABASE_URL
  const adapter = new PrismaPg({ connectionString: dbUrl })
  const prisma = new PrismaClient({ adapter })

  try {
    console.log(`${PREFIX} Running pre-push migrations...`)

    // --- Create tracking table ---
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_gwi_migrations" (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // Advisory lock to prevent concurrent migration runners
    // Lock ID 20250101 is arbitrary but unique to this migration runner
    const [lockResult] = await prisma.$queryRawUnsafe(
      `SELECT pg_try_advisory_lock(20250101) as locked`
    )
    if (!lockResult || !lockResult.locked) {
      console.log(`${PREFIX} Another migration runner is active — skipping`)
      return
    }
    console.log(`${PREFIX} Acquired advisory lock`)

    // --- Discover and run pending migrations ---
    const migrationsDir = path.join(__dirname, 'migrations')
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
      const [existing] = await prisma.$queryRawUnsafe(
        `SELECT name FROM "_gwi_migrations" WHERE name = $1`, name
      )
      if (existing) {
        skipped++
        continue
      }

      console.log(`${PREFIX} >> Running ${name}...`)

      // Re-check before running (guards against concurrent runs)
      const [alreadyApplied] = await prisma.$queryRawUnsafe(
        `SELECT name FROM "_gwi_migrations" WHERE name = $1`, name
      )
      if (alreadyApplied) {
        console.log(`${PREFIX}   ⏩ ${name} — already applied (verified)`)
        continue
      }

      try {
        const migration = require(path.join(migrationsDir, file))
        await migration.up(prisma)
        await prisma.$executeRawUnsafe(
          `INSERT INTO "_gwi_migrations" (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, name
        )
        applied++
        console.log(`${PREFIX}   ✅ ${name}`)
      } catch (err) {
        console.error(`${PREFIX}   ❌ FAILED ${name}:`, err.message)
        throw err  // Stop the entire run — don't continue with broken state
      }
    }

    if (skipped > 0) {
      console.log(`${PREFIX} Skipped ${skipped} already-applied migration(s)`)
    }
    console.log(`${PREFIX} Pre-push migrations complete (${applied} applied, ${skipped} skipped)`)
  } finally {
    // Release advisory lock
    try {
      await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(20250101)`)
    } catch { /* best-effort */ }
    await prisma.$disconnect()
  }
}

runPrePushMigrations().catch((err) => {
  console.error(`${PREFIX} Fatal error:`, err.message)
  process.exit(1)
})
