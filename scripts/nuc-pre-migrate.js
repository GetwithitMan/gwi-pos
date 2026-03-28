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
 *
 * KNOWN DUPLICATE MIGRATION PREFIXES:
 *   These exist because multiple migrations were added concurrently in the same sprint.
 *   They are tracked by full filename (not prefix), so execution order within a
 *   duplicate prefix set is alphabetical by filename. DO NOT renumber — that would
 *   cause already-applied migrations to re-run on existing NUCs.
 *
 *   021: 021-dedup-modifier-pricing-discount.js, 021-order-claim-fields.js,
 *        021-pending-datacap-sales.js, 021-print-retry-sos-tracking.js
 *   025: 025-allergen-age-verification.js, 025-seasonal-menu.js
 *   027: 027-cover-charge-qr-ordering.js, 027-server-banking-preorders.js
 *   029: 029-customer-feedback-pour-control.js, 029-reservation-deposits-saved-cards.js
 *   031: 031-marketing-campaigns.js, 031-upsell-rules.js
 *   032: 032-host-delivery.js, 032-third-party-delivery.js
 *   033: 033-report-shares.js, 033-text-to-pay.js
 *   036: 036-overtime-pricing.js, 036-pizza-enhancements.js
 *   (109 duplicate fixed → 109-add-cascade-rules.js stays, gift-card-pool renumbered to 113)
 */
// dotenv: load .env files for local dev / Vercel builds.
// On NUC artifacts, dotenv is not shipped — DATABASE_URL comes from
// the deploy script environment or systemd. Silently skip if missing.
try {
  const dotenvConfig = require('dotenv').config
  dotenvConfig({ path: '.env.local', override: true })
  dotenvConfig({ path: '.env' })
} catch {
  // dotenv not available (artifact deploy) — env already set by caller
}

// tsx: registers TS loader for Prisma 7 generated client.
// Required in both dev (from devDependencies) and artifact (bundled in step 5).
// Prisma 7 generates ESM TypeScript — tsx bridges require() to handle .ts imports.
try {
  require('tsx/cjs/api').register()
} catch {
  // tsx not available — will only work if generated client has been pre-compiled to JS
}

// Guard: Prisma client must be generated
let PrismaClient
try {
  PrismaClient = require('../src/generated/prisma/client').PrismaClient
} catch {
  console.error('[nuc-pre-migrate] FATAL: Prisma client not generated at src/generated/prisma/client. Run: npx prisma generate')
  process.exit(1)
}

const { PrismaPg } = require('@prisma/adapter-pg')
const fs = require('fs')
const path = require('path')

const PREFIX = '[nuc-pre-migrate]'

// ── Validate-only mode ───────────────────────────────────────────────────────
// When NUC_PRE_MIGRATE_VALIDATE_ONLY=1, verify all imports resolved and the
// migrations directory exists, then exit 0 without touching any database.
// Used by the artifact build to prove nuc-pre-migrate.js is runnable from
// the staged artifact — mirrors the real import chain exactly.
if (process.env.NUC_PRE_MIGRATE_VALIDATE_ONLY === '1') {
  console.log(`${PREFIX} Validate-only mode: all imports resolved OK`)
  console.log(`${PREFIX}   PrismaClient: ${typeof PrismaClient === 'function' ? 'OK' : 'MISSING'}`)
  console.log(`${PREFIX}   PrismaPg: ${typeof PrismaPg === 'function' ? 'OK' : 'MISSING'}`)
  console.log(`${PREFIX}   migrations dir: ${fs.existsSync(path.join(__dirname, 'migrations')) ? 'OK' : 'MISSING'}`)
  process.exit(0)
}

// Timeout for the entire migration run (5 minutes). Prevents hung processes
// from blocking NUC service start or Vercel builds indefinitely.
const MIGRATION_TIMEOUT_MS = 5 * 60 * 1000

async function runPrePushMigrations() {
  // Support NEON_MIGRATE flag — when set, run migrations against Neon cloud DB
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
    ? dbUrl.split('@')[1]?.split('/')[0] || 'neon'
    : 'local PG'
  console.log(`${PREFIX} Target: ${targetHost}`)

  const adapter = new PrismaPg({ connectionString: dbUrl })
  const prisma = new PrismaClient({ adapter })

  let lockAcquired = false
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
    lockAcquired = true
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
        if (typeof migration.up !== 'function') {
          throw new Error(`Migration ${file} does not export an up() function`)
        }
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
    // Only release advisory lock if we acquired it
    if (lockAcquired) {
      try {
        await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(20250101)`)
      } catch { /* best-effort */ }
    }
    await prisma.$disconnect()
  }
}

// Global timeout — kill the process if migrations hang (e.g., lock wait, unreachable DB)
const timeout = setTimeout(() => {
  console.error(`${PREFIX} FATAL: Migration runner timed out after ${MIGRATION_TIMEOUT_MS / 1000}s — killing process`)
  process.exit(2)
}, MIGRATION_TIMEOUT_MS)
timeout.unref() // Don't prevent Node from exiting normally

runPrePushMigrations().catch((err) => {
  console.error(`${PREFIX} Fatal error:`, err.message)
  process.exit(1)
})
