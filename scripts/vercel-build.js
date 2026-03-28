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

  // 1b. Pre-generate schema.sql (needed by migrations, will be REGENERATED in step 4)
  console.log('[vercel-build] Pre-generating schema.sql for migrations...')
  execSync('node scripts/generate-schema-sql.mjs', { stdio: 'inherit' })

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
  // --accept-data-loss is used ONLY on Vercel because migrations (step 2) already handle
  // safe column narrowing (e.g., Decimal(65,30) → Decimal(10,2)). Prisma still flags these
  // as "data loss" even after the migration has applied the same change. On NUCs, the flag
  // stays BANNED — pre-start.sh uses bare `prisma db push` which fails loudly on destructive changes.
  console.log('[vercel-build] Running prisma db push (master)...')
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' })

  // 4. REGENERATE schema.sql AFTER db push — this is the FINAL truth.
  // The schema.sql generated in step 1b may be stale if prisma db push applied
  // additional changes (enum alterations, constraint fixes, etc.).
  // MC uses this file to provision new venues — it MUST match the Prisma client exactly.
  console.log('[vercel-build] Regenerating schema.sql (post-push — final truth)...')
  execSync('node scripts/generate-schema-sql.mjs', { stdio: 'inherit' })
  execSync('cp prisma/schema.sql public/schema.sql', { stdio: 'inherit' })
  execSync('node scripts/generate-version-contract.mjs', { stdio: 'inherit' })
  execSync('cp src/generated/version-contract.json public/version-contract.json', { stdio: 'inherit' })
  console.log('[vercel-build] schema.sql + version-contract regenerated from final schema state')

  // 4b. Generate immutable versioned artifacts for fleet rollouts
  // MC pins rollouts to a specific artifact version instead of "whatever is live"
  console.log('[vercel-build] Generating versioned artifacts...')
  execSync('node scripts/generate-artifacts.mjs', { stdio: 'inherit' })

  // 4c. Build deploy-tools artifact (standalone migration runner, pg-only)
  // Ships as a separate artifact alongside the app. Contains migrate.js,
  // apply-schema.js, all migration files, schema.sql, and pg as sole dep.
  // No Prisma CLI, no tsx, no generated client.
  console.log('[vercel-build] Building deploy-tools artifact...')
  execSync('bash deploy-tools/build.sh', { stdio: 'inherit' })

  // 5. Build self-contained installer bundle (modules embedded in installer.run)
  // Without this, installer.run on Vercel is just the orchestrator — no modules.
  // NUCs self-update from this file, so it MUST be the full bundle.
  console.log('[vercel-build] Building installer bundle...')
  execSync('bash scripts/build-installer-bundle.sh', { stdio: 'inherit' })

  // 6. Build Next.js
  console.log('[vercel-build] Running next build...')
  execSync('npx next build', { stdio: 'inherit' })

  // 7. Compile custom server (server.ts → server.js) for NUC artifact
  // Vercel itself doesn't use the custom server, but the NUC artifact does.
  // Must run AFTER next build so standalone output exists.
  console.log('[vercel-build] Building custom server for NUC artifact...')
  execSync('node scripts/build-server.mjs', { stdio: 'inherit' })

  // 8. Build NUC release artifact (pre-built, self-contained, signed)
  // Packages .next/standalone + server.js + Prisma CLI + migrations into a
  // compressed, signed artifact. NUCs download this instead of running npm ci + build.
  // FAIL-CLOSED: If artifact build fails, the entire Vercel build fails.
  // A release without a valid fleet artifact is not a valid release.
  console.log('[vercel-build] Building NUC release artifact...')
  execSync('bash scripts/build-nuc-artifact.sh', { stdio: 'inherit' })

  console.log('[vercel-build] Build complete!')
}

main().catch((err) => {
  console.error('[vercel-build] Build failed:', err.message)
  process.exit(1)
})
