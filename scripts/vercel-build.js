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

  // 2–4. Database-dependent steps: migrations, schema push, post-push regeneration.
  // These require DATABASE_URL / DIRECT_URL pointing at master Neon.
  // Preview deployments (PR branches) may not have DB env vars — skip gracefully.
  const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (directUrl) {
    // 2. Run pre-push migrations on master Neon DB (via PrismaClient + DIRECT_URL)
    console.log('[vercel-build] Running pre-push migrations (master)...')
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
    // constraint changes). Prisma db push runs WITHOUT --accept-data-loss — if Prisma
    // flags a destructive change, the build fails. Developers must write a safe migration
    // in scripts/migrations/ to handle the transition. This is intentional: master Neon
    // is the canonical SOR and must never silently lose data.
    console.log('[vercel-build] Running prisma db push (master)...')
    execSync('npx prisma db push', { stdio: 'inherit' })

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
  } else {
    console.log('[vercel-build] No DATABASE_URL — skipping migrations, db push, and schema regeneration (preview deployment)')
  }

  // 4b. Install minisign for artifact signing (small static binary, ~200KB)
  // Required so generate-artifacts.mjs can sign manifest.json for NUC deploy verification.
  try {
    execSync('which minisign', { stdio: 'pipe' })
    console.log('[vercel-build] minisign already available')
  } catch {
    console.log('[vercel-build] Installing minisign for artifact signing...')
    try {
      execSync('curl -fsSL https://github.com/jedisct1/minisign/releases/download/0.11/minisign-0.11-linux.tar.gz | tar xz -C /tmp && cp /tmp/minisign-linux/x86_64/minisign /usr/local/bin/minisign && chmod +x /usr/local/bin/minisign', { stdio: 'pipe' })
      console.log('[vercel-build] minisign installed')
    } catch (err) {
      console.warn('[vercel-build] WARN: Could not install minisign — manifest will be unsigned:', err.message)
    }
  }

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

  // 9. Remove static manifest so Vercel rewrite to R2 takes effect.
  // build-nuc-artifact.sh writes public/artifacts/manifest.json with the Vercel
  // build's SHA, but the REAL artifact is built by GitHub Actions with a different
  // SHA. The vercel.json rewrite proxies /artifacts/manifest.json to R2's
  // latest/manifest.json (which has the correct SHA). Static files override
  // rewrites, so we must delete it.
  const manifestPath = require('path').join(__dirname, '..', 'public', 'artifacts', 'manifest.json')
  if (require('fs').existsSync(manifestPath)) {
    require('fs').unlinkSync(manifestPath)
    console.log('[vercel-build] Removed static manifest.json — rewrite to R2 will serve the authoritative copy')
  }

  console.log('[vercel-build] Build complete!')
}

main().catch((err) => {
  console.error('[vercel-build] Build failed:', err.message)
  process.exit(1)
})
