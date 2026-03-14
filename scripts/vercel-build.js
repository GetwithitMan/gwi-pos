#!/usr/bin/env node
/**
 * Vercel Build Script (v2 — orchestrator)
 *
 * 1. prisma generate
 * 2. Run nuc-pre-migrate.js against master Neon DB (via PrismaClient)
 * 3. prisma db push on master
 * 4. For each venue DB: run nuc-pre-migrate.js + prisma db push
 * 5. next build
 *
 * The migration logic lives in scripts/migrations/ and is shared between
 * NUC (local PG) and Vercel (Neon) via nuc-pre-migrate.js.
 */
const { execSync } = require('child_process')

/**
 * Sync schema to all venue databases on this Neon project.
 *
 * Each venue uses its own DB (gwi_pos_{slug}) on the same Neon endpoint.
 * Vercel build only syncs the master gwi_pos DB by default; this step
 * ensures existing venue DBs stay in sync after schema changes.
 *
 * New venues are handled at provision time (via /api/internal/provision),
 * so they always start with the correct schema — this only covers existing ones.
 */
async function syncVenueSchemas() {
  const { neon } = require('@neondatabase/serverless')
  const sql = neon(process.env.DATABASE_URL)

  // Enumerate all venue DBs on this Neon project (same credentials, different DB name)
  const venueRows = await sql`
    SELECT datname FROM pg_database
    WHERE datname LIKE 'gwi_pos_%' AND datname != 'gwi_pos'
    ORDER BY datname
  `

  if (venueRows.length === 0) {
    console.log('[vercel-build] No venue databases found, skipping venue sync')
    return
  }

  console.log(`[vercel-build] Syncing schema for ${venueRows.length} venue database(s)...`)

  // Replace the DB name portion of a postgres URL (e.g. /gwi_pos? -> /gwi_pos_foo?)
  function swapDb(url, dbName) {
    return url.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
  }

  const basePooler = process.env.DATABASE_URL
  const baseDirect = process.env.DIRECT_URL || process.env.DATABASE_URL

  for (const { datname } of venueRows) {
    const venuePooler = swapDb(basePooler, datname)
    const venueDirect = swapDb(baseDirect, datname)

    console.log(`[vercel-build]   -> ${datname}`)
    try {
      // 1. Run pre-push migrations (shared migration runner via PrismaClient)
      execSync('node scripts/nuc-pre-migrate.js', {
        stdio: 'inherit',
        env: { ...process.env, NEON_MIGRATE: 'true', NEON_DATABASE_URL: venueDirect, DATABASE_URL: venueDirect },
      })

      // 2. Push full Prisma schema
      execSync('npx prisma db push', {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: venuePooler, DIRECT_URL: venueDirect },
      })
    } catch (err) {
      // Log but don't fail the build — a single venue schema error shouldn't block deploy
      console.error(`[vercel-build]   FAILED ${datname}:`, err.message)
    }
  }

  console.log('[vercel-build] Venue schema sync complete')
}

async function main() {
  // 1. Generate Prisma client
  console.log('[vercel-build] Running prisma generate...')
  execSync('npx prisma generate', { stdio: 'inherit' })

  // 2. Run pre-push migrations on master Neon DB (via PrismaClient + DIRECT_URL)
  console.log('[vercel-build] Running pre-push migrations (master)...')
  const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
  execSync('node scripts/nuc-pre-migrate.js', {
    stdio: 'inherit',
    env: { ...process.env, NEON_MIGRATE: 'true', NEON_DATABASE_URL: directUrl },
  })

  // 3. Push full Prisma schema to master
  // No --accept-data-loss: if schema has destructive changes, fail loudly.
  // Pre-push migrations above handle all data-safe schema transitions.
  console.log('[vercel-build] Running prisma db push (master)...')
  execSync('npx prisma db push', { stdio: 'inherit' })

  // 4. Sync schema to all existing venue DBs (same Neon project, different DB name per venue)
  await syncVenueSchemas()

  // 5. Build Next.js
  console.log('[vercel-build] Running next build...')
  execSync('npx next build', { stdio: 'inherit' })

  console.log('[vercel-build] Build complete!')
}

main().catch((err) => {
  console.error('[vercel-build] Build failed:', err.message)
  process.exit(1)
})
