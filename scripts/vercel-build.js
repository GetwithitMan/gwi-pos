#!/usr/bin/env node
/**
 * Vercel Build Script (v2 — orchestrator)
 *
 * 1. prisma generate
 * 2. Run nuc-pre-migrate.js against master Neon DB (via PrismaClient)
 * 3. prisma db push on master
 * 4. next build
 *
 * The migration logic lives in scripts/migrations/ and is shared between
 * NUC (local PG) and Vercel (Neon) via nuc-pre-migrate.js.
 *
 * NOTE: Venue databases are NOT synced during build. The previous approach
 * of looping through every venue DB and running migrations + prisma db push
 * was the #1 source of schema drift — if any venue failed, the build still
 * "succeeded" and that venue was left with a broken schema. Per-venue schema
 * updates are now handled exclusively through the MC provisioning pipeline
 * (via /api/internal/provision + _venue_schema_state tracking), which has
 * proper error handling, retry logic, and state tracking per venue.
 */
const { execSync } = require('child_process')

async function main() {
  // 1. Generate Prisma client
  console.log('[vercel-build] Running prisma generate...')
  execSync('npx prisma generate', { stdio: 'inherit' })

  // 2. Run pre-push migrations on master Neon DB (via PrismaClient + DIRECT_URL)
  console.log('[vercel-build] Running pre-push migrations (master)...')
  const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
  try {
    execSync('node scripts/nuc-pre-migrate.js', {
      stdio: 'inherit',
      env: { ...process.env, NEON_MIGRATE: 'true', NEON_DATABASE_URL: directUrl },
    })
  } catch (migrationErr) {
    console.error('[vercel-build] Migration failed:', migrationErr.message)
    process.exit(1)
  }

  // 3. Push full Prisma schema to master
  // Pre-push migrations (step 2) handle all data safety (column renames, type casts,
  // constraint changes). By the time db push runs, the schema diff is safe.
  // --accept-data-loss removed: migrations guarantee data safety, and this flag
  // could silently drop columns/data if the schema diverges unexpectedly.
  console.log('[vercel-build] Running prisma db push (master)...')
  execSync('npx prisma db push', { stdio: 'inherit' })

  // 4. Venue schema sync disabled — use MC provisioning pipeline for per-venue schema updates
  console.log('[vercel-build] Venue schema sync disabled — use MC provisioning pipeline for per-venue schema updates')

  // 5. Build Next.js
  console.log('[vercel-build] Running next build...')
  execSync('npx next build', { stdio: 'inherit' })

  console.log('[vercel-build] Build complete!')
}

main().catch((err) => {
  console.error('[vercel-build] Build failed:', err.message)
  process.exit(1)
})
